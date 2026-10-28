import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import type { Project, ExportSettings, ExportProgress, MediaAsset } from '../src/shared/types';
import { buildFfmpegCommand, buildFramesCommand } from './exportBuilder';

const require = createRequire(__filename);

// ffmpeg-static / ffprobe-static resolve to paths inside node_modules; when the
// app is packaged with asar they live in app.asar.unpacked instead.
function unpacked(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked');
}
const FFMPEG: string = unpacked(require('ffmpeg-static') as string);
const FFPROBE: string = unpacked((require('ffprobe-static') as { path: string }).path);

const TEMP_DIR = path.join(os.tmpdir(), 'movie-editor');
fs.mkdirSync(TEMP_DIR, { recursive: true });

let win: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Crash / error log: %APPDATA%/Movie Editor/logs/main.log (rotated at 2 MB)
// ---------------------------------------------------------------------------
// Chromium quits the whole app ("GPU process isn't usable. Goodbye.") after a few GPU-process
// crashes (flaky drivers, heavy canvas use). Keep running instead: it falls back to software.
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'main.log');
function logLine(kind: string, msg: string) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${kind}] ${msg}
`);
  } catch { /* logging must never throw */ }
}
process.on('uncaughtException', (err) => logLine('main-exception', err?.stack ?? String(err)));
process.on('unhandledRejection', (err: any) => logLine('main-rejection', err?.stack ?? String(err)));
app.on('child-process-gone', (_e, d) => logLine('child-gone', `${d.type} reason=${d.reason} exit=${d.exitCode} ${d.name ?? ''}`));
function memorySummary(): string {
  return app.getAppMetrics().map((m) => `${m.type}:${Math.round(m.memory.workingSetSize / 1024)}MB`).join(' ');
}
let exportProc: ChildProcess | null = null;
let rendererDirty = false;
let forceClose = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#17181c',
    title: 'Movie Editor',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Forward startup flags / a double-clicked .mvproj path to the preload script.
      additionalArguments: process.argv.filter((a) => a.startsWith('--open=') || a.startsWith('--seek=') || a.startsWith('--export=') || a.startsWith('--select=') || a === '--studio' || a.startsWith('--workspace=') || a.startsWith('--export-audio=') || a.startsWith('--studio-fx=') || a.startsWith('--studio-editor=') || a.startsWith('--studio-') || a.startsWith('--studio-play=') || /\.mvproj$/i.test(a)),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow <video>/<img> to load local files via file:// (local-only app).
      webSecurity: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  win.on('closed', () => (win = null));

  // Closing with unsaved changes: ask the user (Save / Don't save / Cancel).
  win.on('close', (e) => {
    if (forceClose || !rendererDirty || !win) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      title: 'Unsaved changes',
      message: 'You have unsaved changes in this project.',
      detail: 'Do you want to save them before closing? Unsaved work is also kept in an automatic recovery copy.',
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice === 0) {
      // Renderer saves (may show a Save dialog), then calls app:closeNow.
      win.webContents.send('app:saveAndClose');
    } else if (choice === 1) {
      forceClose = true;
      win.close();
    }
  });

  // Forward renderer console errors to the terminal (useful when run from a shell) and the log.
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error('[renderer]', message);
    if (level >= 3) logLine('renderer-error', message);
  });

  // If the renderer dies (out of memory, GPU/driver crash…) don't leave a dead window:
  // log why and reload — the autosave recovery prompt brings the work back.
  win.webContents.on('render-process-gone', (_e, details) => {
    logLine('renderer-gone', `reason=${details.reason} exit=${details.exitCode} mem=${memorySummary()}`);
    if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) setTimeout(() => win?.webContents.reload(), 500);
  });
  win.webContents.on('unresponsive', () => logLine('renderer-unresponsive', memorySummary()));

  // Debug aid: `--metrics` prints process memory every 5 s.
  if (process.argv.includes('--metrics')) setInterval(() => console.log('[metrics]', memorySummary()), 5000);

  // Debug aid: `electron . --screenshot=out.png` captures the window after load and quits.
  const shot = process.argv.find((a) => a.startsWith('--screenshot='));
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const out = shot.split('=')[1];
        try {
          // the viz process is flaky here: retry a few times before falling back
          let img: Electron.NativeImage | null = null;
          for (let i = 0; i < 4 && !img; i++) {
            try { img = await win!.webContents.capturePage(); } catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, 700)); }
          }
          fs.writeFileSync(out, img!.toPNG());
        } catch (err) {
          // capturePage can fail when the GPU/viz process is flaky; fall back to the main canvas pixels
          console.error('[screenshot] capturePage failed, saving canvas instead:', String(err));
          const dataUrl: string = await win!.webContents.executeJavaScript(
            `(document.querySelector('.ce-spec') || document.querySelector('.eq-canvas') || document.querySelector('.studio canvas') || document.querySelector('.preview canvas')).toDataURL('image/png')`,
          );
          fs.writeFileSync(out, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
        }
        forceClose = true;
        app.quit();
      }, 6000);
    });
  }
}

app.whenReady().then(() => {
  logLine('start', `v${app.getVersion()} electron ${process.versions.electron}`);
  // Local app: allow microphone access for Audio Studio recording without prompting.
  const { session } = require('electron') as typeof import('electron');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture' as string);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  exportProc?.kill();
  for (const dec of decoders.values()) dec.proc.kill('SIGKILL');
  app.quit();
});

ipcMain.on('app:setDirty', (_e, dirty: boolean) => { rendererDirty = !!dirty; });
ipcMain.on('app:closeNow', () => { forceClose = true; win?.close(); });
ipcMain.handle('app:autosavePath', () => path.join(app.getPath('userData'), 'autosave.mvproj'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

function hashPath(p: string): string {
  return crypto.createHash('md5').update(p).digest('hex').slice(0, 16);
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tif', '.tiff']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.wma', '.opus']);

type ProbeResult = Omit<MediaAsset, 'id' | 'thumbnail' | 'waveform'>;

async function probe(filePath: string): Promise<ProbeResult> {
  const { stdout, code, stderr } = await run(FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ]);
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr.trim() || 'unknown error'}`);
  const info = JSON.parse(stdout);
  const streams: any[] = info.streams ?? [];
  const ext = path.extname(filePath).toLowerCase();
  const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = streams.find((s) => s.codec_type === 'audio');

  const isImage = IMAGE_EXT.has(ext) || (v && !a && (Number(v.nb_frames) === 1 || /image2|png_pipe|_pipe/.test(info.format?.format_name ?? '')));
  const duration = Number(info.format?.duration ?? v?.duration ?? a?.duration ?? 0) || 0;

  let fps: number | undefined;
  if (v?.r_frame_rate) {
    const [n, d] = String(v.r_frame_rate).split('/').map(Number);
    if (n && d) fps = n / d;
  }

  let kind: MediaAsset['kind'] = 'video';
  if (isImage) kind = 'image';
  else if (!v || AUDIO_EXT.has(ext)) kind = 'audio';

  // Account for display rotation metadata (phone videos).
  let width = v?.width ? Number(v.width) : undefined;
  let height = v?.height ? Number(v.height) : undefined;
  const rot = Number(v?.tags?.rotate ?? v?.side_data_list?.find((s: any) => s.rotation != null)?.rotation ?? 0);
  if (width && height && Math.abs(rot % 180) === 90) [width, height] = [height, width];

  return {
    path: filePath,
    name: path.basename(filePath),
    kind,
    duration: kind === 'image' ? 0 : duration,
    width,
    height,
    fps,
    hasVideo: !!v && kind !== 'audio',
    hasAudio: !!a,
  };
}

// ---------------------------------------------------------------------------
// IPC: dialogs & files
// ---------------------------------------------------------------------------

ipcMain.handle('dialog:openMedia', async () => {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Import media',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'mts', 'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('dialog:saveProject', async (_e, defaultName: string) => {
  const res = await dialog.showSaveDialog(win!, {
    title: 'Save project',
    defaultPath: `${defaultName || 'project'}.mvproj`,
    filters: [{ name: 'Movie Editor project', extensions: ['mvproj'] }],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('dialog:openProject', async () => {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: 'Movie Editor project', extensions: ['mvproj', 'json'] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dialog:confirmDiscard', async (_e, what: string) => {
  const { response } = await dialog.showMessageBox(win!, {
    type: 'question',
    title: 'Unsaved changes',
    message: 'You have unsaved changes in this project.',
    detail: `Save them before ${what}?`,
    buttons: ['Save', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  return (['save', 'discard', 'cancel'] as const)[response];
});

ipcMain.handle('dialog:ask', async (_e, title: string, message: string, buttons: string[], defaultId: number) => {
  const { response } = await dialog.showMessageBox(win!, { type: 'question', title, message, buttons, defaultId, cancelId: buttons.length - 1, noLink: true });
  return response;
});

ipcMain.handle('dialog:export', async (_e, defaultName: string, format: string) => {
  const res = await dialog.showSaveDialog(win!, {
    title: 'Export video',
    defaultPath: path.join(app.getPath('videos'), `${defaultName || 'movie'}.${format}`),
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('fs:write', async (_e, filePath: string, content: string) => {
  await fs.promises.writeFile(filePath, content, 'utf8');
});
ipcMain.handle('fs:read', async (_e, filePath: string) => fs.promises.readFile(filePath, 'utf8'));
ipcMain.handle('fs:exists', async (_e, filePath: string) => fs.existsSync(filePath));
ipcMain.handle('fs:delete', async (_e, filePath: string) => { await fs.promises.unlink(filePath).catch(() => {}); });
ipcMain.handle('shell:showInFolder', async (_e, filePath: string) => shell.showItemInFolder(filePath));

// ---------------------------------------------------------------------------
// IPC: media analysis
// ---------------------------------------------------------------------------

ipcMain.handle('media:probe', async (_e, filePath: string) => probe(filePath));

ipcMain.handle('media:thumbnail', async (_e, filePath: string, at: number) => {
  const out = path.join(TEMP_DIR, `thumb-${hashPath(filePath)}-${Math.round(at * 1000)}.jpg`);
  if (fs.existsSync(out)) return out;
  const args = ['-y', '-v', 'error'];
  if (at > 0) args.push('-ss', String(at));
  args.push('-i', filePath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out);
  const { code } = await run(FFMPEG, args);
  if (code !== 0 && at > 0) {
    // Retry from the very beginning for very short files.
    const retry = await run(FFMPEG, ['-y', '-v', 'error', '-i', filePath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out]);
    if (retry.code !== 0) return null;
  } else if (code !== 0) return null;
  return fs.existsSync(out) ? out : null;
});

ipcMain.handle('media:waveform', async (_e, filePath: string) => {
  const out = path.join(TEMP_DIR, `wave-${hashPath(filePath)}.png`);
  if (fs.existsSync(out)) return out;
  const { code } = await run(FFMPEG, [
    '-y', '-v', 'error', '-i', filePath,
    '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=2400x64:colors=0x9ad0ff:scale=sqrt',
    '-frames:v', '1', out,
  ]);
  return code === 0 && fs.existsSync(out) ? out : null;
});

ipcMain.handle('media:extractWav', async (_e, filePath: string) => {
  const out = path.join(TEMP_DIR, `wav-${hashPath(filePath)}.wav`);
  if (fs.existsSync(out)) return out;
  const { code } = await run(FFMPEG, ['-y', '-v', 'error', '-i', filePath, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  return code === 0 && fs.existsSync(out) ? out : null;
});

ipcMain.handle('fs:writeBinary', async (_e, filePath: string, data: ArrayBuffer) => {
  await fs.promises.writeFile(filePath, Buffer.from(data));
});

ipcMain.handle('app:tempPath', async (_e, name: string) => path.join(TEMP_DIR, name));
ipcMain.handle('fs:ensureDir', async (_e, dir: string) => { await fs.promises.mkdir(dir, { recursive: true }); });

ipcMain.handle('audio:encode', async (_e, wavPath: string, outPath: string, format: string, bitrate = '320k') => {
  const args = ['-y', '-v', 'error', '-i', wavPath];
  if (format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', bitrate);
  else if (format === 'flac') args.push('-c:a', 'flac');
  else if (format === 'm4a' || format === 'aac') args.push('-c:a', 'aac', '-b:a', bitrate);
  else if (format === 'ogg') args.push('-c:a', 'libvorbis', '-q:a', '6');
  else args.push('-c:a', 'pcm_s16le');
  args.push(outPath);
  const { code, stderr } = await run(FFMPEG, args);
  return code === 0 ? { ok: true } : { ok: false, error: stderr.trim().split('\n').slice(-3).join('\n') };
});

/**
 * Offline audio processing with FFmpeg (used by the clip editor's render-in-place tools):
 * pitch shift / time stretch via rubberband, denoise via afftdn, loudness normalisation.
 */
ipcMain.handle('audio:process', async (_e, inPath: string, op: { type: 'pitch'; semitones: number } | { type: 'tempo'; factor: number } | { type: 'denoise'; strength: number } | { type: 'loudnorm' } | { type: 'filter'; graph: string }) => {
  const out = path.join(TEMP_DIR, `proc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`);
  let af: string;
  switch (op.type) {
    case 'pitch': af = `rubberband=pitch=${Math.pow(2, op.semitones / 12).toFixed(6)}:tempo=1:pitchq=quality:transients=crisp`; break;
    case 'tempo': af = `rubberband=tempo=${Math.max(0.1, op.factor).toFixed(6)}:pitch=1:pitchq=quality`; break;
    case 'denoise': af = `afftdn=nr=${Math.min(97, Math.max(0.01, op.strength)).toFixed(2)}:nf=-30:tn=1`; break;
    case 'loudnorm': af = 'loudnorm=I=-16:TP=-1.5:LRA=11'; break;
    case 'filter': af = op.graph; break;
  }
  const { code, stderr } = await run(FFMPEG, ['-y', '-v', 'error', '-i', inPath, '-af', af, '-ar', '48000', '-c:a', 'pcm_f32le', out]);
  return code === 0 && fs.existsSync(out) ? { ok: true, path: out } : { ok: false, error: stderr.trim().split('\n').slice(-3).join('\n') };
});

ipcMain.handle('dialog:exportAudio', async (_e, defaultName: string, format: string) => {
  const res = await dialog.showSaveDialog(win!, {
    title: 'Export audio',
    defaultPath: path.join(app.getPath('music'), `${defaultName || 'mix'}.${format}`),
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('media:writeTempPng', async (_e, dataUrl: string, name: string) => {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const out = path.join(TEMP_DIR, `${name}-${Date.now()}.png`);
  await fs.promises.writeFile(out, Buffer.from(base64, 'base64'));
  return out;
});

// ---------------------------------------------------------------------------
// IPC: export
// ---------------------------------------------------------------------------

const sendProgress = (p: ExportProgress) => win?.webContents.send('export:progress', p);

function parseTime(stderrChunk: string): number | null {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderrChunk);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function logCommand(args: string[], graph: string) {
  fs.promises.writeFile(
    path.join(TEMP_DIR, 'last-export-command.txt'),
    `${FFMPEG} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n\n${graph}`,
  ).catch(() => {});
}

interface RunningExport {
  proc: ChildProcess;
  cancelled: boolean;
  stderr: string;
  outputPath: string;
  totalDuration: number;
  done: Promise<{ ok: boolean; error?: string; cancelled?: boolean }>;
}

function spawnExport(args: string[], outputPath: string, totalDuration: number, reportTime: boolean): RunningExport {
  const proc = spawn(FFMPEG, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  exportProc = proc;
  // FFmpeg may exit while we are still writing frames: swallow EPIPE instead of crashing the main process.
  proc.stdin?.on('error', () => {});
  const state: RunningExport = { proc, cancelled: false, stderr: '', outputPath, totalDuration, done: null as any };
  state.done = new Promise((resolve) => {
    proc.stderr!.on('data', (d) => {
      const s = d.toString();
      state.stderr += s;
      if (state.stderr.length > 20000) state.stderr = state.stderr.slice(-10000);
      const t = parseTime(s);
      if (reportTime && t != null) sendProgress({ percent: Math.min(99, (t / totalDuration) * 100), timeSeconds: t });
    });
    proc.on('error', (err) => {
      exportProc = null;
      sendProgress({ percent: 0, timeSeconds: 0, error: err.message });
      resolve({ ok: false, error: err.message });
    });
    proc.on('close', (code) => {
      exportProc = null;
      if (state.cancelled) {
        sendProgress({ percent: 0, timeSeconds: 0, cancelled: true });
        fs.promises.unlink(outputPath).catch(() => {});
        resolve({ ok: false, cancelled: true });
      } else if (code === 0) {
        sendProgress({ percent: 100, timeSeconds: totalDuration, done: true });
        resolve({ ok: true });
      } else {
        const lines = state.stderr.trim().split('\n').filter((l) => !l.startsWith('frame=')).slice(-6).join('\n');
        sendProgress({ percent: 0, timeSeconds: 0, error: `FFmpeg exited with code ${code}.\n${lines}` });
        resolve({ ok: false, error: lines });
      }
    });
  });
  return state;
}

let running: RunningExport | null = null;

ipcMain.handle('export:cancel', async () => {
  if (!running) return;
  running.cancelled = true;
  try { running.proc.stdin?.destroy(); } catch { /* ignore */ }
  running.proc.kill('SIGKILL');
});

// Engine 'graph': FFmpeg does everything.
ipcMain.handle('export:start', async (_e, project: Project, settings: ExportSettings) => {
  if (running) throw new Error('An export is already running.');
  let built;
  try {
    built = buildFfmpegCommand(project, settings);
  } catch (err: any) {
    sendProgress({ percent: 0, timeSeconds: 0, error: err.message });
    return { ok: false, error: err.message };
  }
  // The filter graph can exceed Windows command-line limits, so pass it via a script file.
  const scriptPath = path.join(TEMP_DIR, `graph-${Date.now()}.txt`);
  await fs.promises.writeFile(scriptPath, built.filterGraph, 'utf8');
  const args = ['-hide_banner', '-v', 'error', '-stats', ...built.inputArgs, '-filter_complex_script', scriptPath, ...built.outputArgs];
  logCommand(args, built.filterGraph);
  running = spawnExport(args, settings.outputPath, built.totalDuration, true);
  const result = await running.done;
  running = null;
  return result;
});

// Engine 'frames': the renderer streams raw RGBA frames; FFmpeg encodes and mixes audio.
ipcMain.handle('export:framesStart', async (_e, project: Project, settings: ExportSettings) => {
  if (running) throw new Error('An export is already running.');
  let built;
  try {
    built = buildFramesCommand(project, settings);
  } catch (err: any) {
    sendProgress({ percent: 0, timeSeconds: 0, error: err.message });
    return { ok: false, error: err.message };
  }
  const scriptPath = path.join(TEMP_DIR, `graph-${Date.now()}.txt`);
  await fs.promises.writeFile(scriptPath, built.filterGraph, 'utf8');
  const args = ['-hide_banner', '-v', 'error', ...built.inputArgs, '-filter_complex_script', scriptPath, ...built.outputArgs];
  logCommand(args, built.filterGraph);
  running = spawnExport(args, settings.outputPath, built.totalDuration, false);
  return { ok: true, totalFrames: Math.ceil(built.totalDuration * settings.fps) };
});

ipcMain.handle('export:framesPush', async (_e, rgba: ArrayBuffer) => {
  const r = running;
  if (!r) return { ok: false, error: 'No export running' };
  if (r.cancelled) return { ok: false, cancelled: true };
  const stopped = async () => {
    // FFmpeg already exited: report its real result (error / cancelled) instead of hanging.
    const res = await r.done;
    running = null;
    return res.ok ? { ok: false, error: 'FFmpeg stopped early' } : { ok: false, error: res.error ?? 'FFmpeg stopped', cancelled: res.cancelled };
  };
  if (!r.proc.stdin || r.proc.stdin.destroyed || r.proc.exitCode !== null) return stopped();
  const buf = Buffer.from(rgba);
  const okNow = r.proc.stdin.write(buf);
  if (!okNow) {
    // wait for the pipe to drain, but give up if FFmpeg dies meanwhile
    const drained = await Promise.race([
      new Promise<boolean>((resolve) => r.proc.stdin!.once('drain', () => resolve(true))),
      r.done.then(() => false),
    ]);
    if (!drained) return stopped();
  }
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Frame decoders for the frame engine: FFmpeg decodes a clip's source segment
// sequentially to raw RGBA (seeking <video> frame by frame is far too slow).
// ---------------------------------------------------------------------------

interface Decoder { proc: ChildProcess; frameSize: number; ended: boolean; error?: string }
const decoders = new Map<string, Decoder>();

function readExact(proc: ChildProcess, n: number): Promise<Buffer | null> {
  const out = proc.stdout!;
  return new Promise((resolve) => {
    const tryRead = () => {
      const chunk = out.read(n) as Buffer | null;
      if (chunk) { cleanup(); resolve(chunk); return; }
      if ((out as any).readableEnded || out.destroyed) {
        // flush whatever is left (a partial frame is dropped)
        cleanup(); resolve(null);
      }
    };
    const onEnd = () => { cleanup(); resolve(null); };
    const cleanup = () => { out.off('readable', tryRead); out.off('end', onEnd); out.off('close', onEnd); out.off('error', onEnd); };
    out.on('readable', tryRead);
    out.on('end', onEnd);
    out.on('close', onEnd);
    out.on('error', onEnd);
    tryRead();
  });
}

ipcMain.handle('decode:open', async (_e, id: string, opts: { path: string; inPoint: number; srcDuration: number; speed: number; fps: number; width: number; height: number }) => {
  decoders.get(id)?.proc.kill('SIGKILL');
  const r3 = (n: number) => Number(n.toFixed(3));
  const vf = `setpts=(PTS-STARTPTS)/${r3(opts.speed)},fps=${opts.fps},scale=${opts.width}:${opts.height}:flags=bicubic,format=rgba`;
  const args = ['-hide_banner', '-v', 'error', '-ss', String(r3(opts.inPoint)), '-t', String(r3(opts.srcDuration)), '-i', opts.path, '-an', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'];
  const proc = spawn(FFMPEG, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const dec: Decoder = { proc, frameSize: opts.width * opts.height * 4, ended: false };
  proc.stderr!.on('data', (d) => { dec.error = (dec.error ?? '') + d.toString(); });
  proc.on('close', () => { dec.ended = true; });
  decoders.set(id, dec);
  return { ok: true };
});

ipcMain.handle('decode:next', async (_e, id: string) => {
  const dec = decoders.get(id);
  if (!dec) return null;
  const buf = await readExact(dec.proc, dec.frameSize);
  return buf; // Buffer -> Uint8Array in the renderer; null at end of stream
});

ipcMain.handle('decode:close', async (_e, id: string) => {
  const dec = decoders.get(id);
  if (!dec) return;
  decoders.delete(id);
  try { dec.proc.stdout?.destroy(); } catch { /* ignore */ }
  dec.proc.kill('SIGKILL');
});

ipcMain.handle('decode:closeAll', async () => {
  for (const [id, dec] of decoders) { try { dec.proc.stdout?.destroy(); } catch { /* ignore */ } dec.proc.kill('SIGKILL'); decoders.delete(id); }
});

ipcMain.handle('export:framesFinish', async () => {
  const r = running;
  if (!r) return { ok: false, error: 'No export running' };
  try { r.proc.stdin?.end(); } catch { /* ignore */ }
  const result = await r.done;
  running = null;
  return result;
});
