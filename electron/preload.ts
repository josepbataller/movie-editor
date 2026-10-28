import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api = {
  openMediaDialog: (): Promise<string[]> => ipcRenderer.invoke('dialog:openMedia'),
  probeMedia: (filePath: string) => ipcRenderer.invoke('media:probe', filePath),
  generateThumbnail: (filePath: string, at: number) => ipcRenderer.invoke('media:thumbnail', filePath, at),
  generateWaveform: (filePath: string) => ipcRenderer.invoke('media:waveform', filePath),
  writeTempPng: (dataUrl: string, name: string): Promise<string> => ipcRenderer.invoke('media:writeTempPng', dataUrl, name),
  /** Extract a file's audio to a temp WAV (fallback when Chromium can't decode the container). */
  extractWav: (filePath: string): Promise<string | null> => ipcRenderer.invoke('media:extractWav', filePath),
  /** Write binary data (e.g. a rendered WAV) to a file. */
  writeBinary: (filePath: string, data: ArrayBuffer): Promise<void> => ipcRenderer.invoke('fs:writeBinary', filePath, data),
  /** Encode a WAV to mp3/flac/aac/ogg with FFmpeg. */
  encodeAudio: (wavPath: string, outPath: string, format: string, bitrate?: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('audio:encode', wavPath, outPath, format, bitrate),
  audioExportDialog: (defaultName: string, format: string): Promise<string | null> => ipcRenderer.invoke('dialog:exportAudio', defaultName, format),
  // --- AI assistant ---
  aiGetSettings: () => ipcRenderer.invoke('ai:getSettings'),
  aiSaveSettings: (s: unknown) => ipcRenderer.invoke('ai:saveSettings', s),
  aiChat: (req: unknown) => ipcRenderer.invoke('ai:chat', req),
  aiTest: (): Promise<{ ok: boolean; text: string }> => ipcRenderer.invoke('ai:test'),
  aiTranscribe: (wavPath: string, language?: string): Promise<string> => ipcRenderer.invoke('ai:transcribe', wavPath, language),
  aiListChats: () => ipcRenderer.invoke('ai:listChats'),
  aiLoadChat: (id: string) => ipcRenderer.invoke('ai:loadChat', id),
  aiSaveChat: (chat: unknown) => ipcRenderer.invoke('ai:saveChat', chat),
  aiDeleteChat: (id: string) => ipcRenderer.invoke('ai:deleteChat', id),
  /** Offline FFmpeg processing of a WAV (pitch shift, time stretch, denoise, loudness) -> new temp WAV path. */
  processAudio: (inPath: string, op: { type: 'pitch'; semitones: number } | { type: 'tempo'; factor: number } | { type: 'denoise'; strength: number } | { type: 'loudnorm' } | { type: 'filter'; graph: string }): Promise<{ ok: boolean; path?: string; error?: string }> => ipcRenderer.invoke('audio:process', inPath, op),
  tempPath: (name: string): Promise<string> => ipcRenderer.invoke('app:tempPath', name),
  ensureDir: (dir: string): Promise<void> => ipcRenderer.invoke('fs:ensureDir', dir),

  saveProjectDialog: (defaultName: string): Promise<string | null> => ipcRenderer.invoke('dialog:saveProject', defaultName),
  openProjectDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openProject'),
  /** Native "Save / Don't save / Cancel" prompt. */
  confirmDiscard: (what: string): Promise<'save' | 'discard' | 'cancel'> => ipcRenderer.invoke('dialog:confirmDiscard', what),
  /** Generic native question with custom buttons; resolves with the index clicked. */
  ask: (title: string, message: string, buttons: string[], defaultId = 0): Promise<number> => ipcRenderer.invoke('dialog:ask', title, message, buttons, defaultId),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write', filePath, content),
  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:read', filePath),
  fileExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', filePath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('fs:delete', filePath),
  /** Path of the crash-recovery autosave file (in the user's app-data folder). */
  autosavePath: (): Promise<string> => ipcRenderer.invoke('app:autosavePath'),

  // --- window close handshake ---
  /** Tell the main process whether there are unsaved changes (drives the close prompt). */
  setDirty: (dirty: boolean) => ipcRenderer.send('app:setDirty', dirty),
  /** Main asks the renderer to save before closing; the callback must call closeNow() when done. */
  onSaveAndClose: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('app:saveAndClose', listener);
    return () => { ipcRenderer.removeListener('app:saveAndClose', listener); };
  },
  closeNow: () => ipcRenderer.send('app:closeNow'),

  // --- export ---
  exportDialog: (defaultName: string, format: string): Promise<string | null> => ipcRenderer.invoke('dialog:export', defaultName, format),
  startExport: (project: unknown, settings: unknown) => ipcRenderer.invoke('export:start', project, settings),
  /** Frame-by-frame engine: open the encoder, then push raw RGBA frames, then finish. */
  startFrameExport: (project: unknown, settings: unknown) => ipcRenderer.invoke('export:framesStart', project, settings),
  pushFrame: (rgba: ArrayBuffer) => ipcRenderer.invoke('export:framesPush', rgba),
  finishFrameExport: () => ipcRenderer.invoke('export:framesFinish'),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  /** Sequential FFmpeg frame decoders used by the frame engine. */
  decodeOpen: (id: string, opts: { path: string; inPoint: number; srcDuration: number; speed: number; fps: number; width: number; height: number }) => ipcRenderer.invoke('decode:open', id, opts),
  decodeNext: (id: string): Promise<Uint8Array | null> => ipcRenderer.invoke('decode:next', id),
  decodeClose: (id: string) => ipcRenderer.invoke('decode:close', id),
  decodeCloseAll: () => ipcRenderer.invoke('decode:closeAll'),
  onExportProgress: (cb: (p: unknown) => void) => {
    const listener = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on('export:progress', listener);
    return () => { ipcRenderer.removeListener('export:progress', listener); };
  },
  showInFolder: (filePath: string) => ipcRenderer.invoke('shell:showInFolder', filePath),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** Project file passed on the command line (`--open=path` or a bare .mvproj path). */
  startupProject: (process.argv.find((a) => a.startsWith('--open='))?.slice(7) ?? process.argv.find((a) => /\.mvproj$/i.test(a))) || null,
  /** Debug: `--export=<out.mp4>` exports the startup project with the frame engine, then quits. */
  startupExport: process.argv.find((a) => a.startsWith('--export='))?.slice(9) ?? null,
  /** Debug: `--select=<clipId>` selects a clip; `--studio` opens the Title Studio for it. */
  startupSelect: process.argv.find((a) => a.startsWith('--select='))?.slice(9) ?? null,
  startupStudio: process.argv.includes('--studio'),
  /** Debug: `--workspace=audio` opens the Audio Studio; `--export-audio=<out.wav>` renders the studio mix headlessly and quits. */
  startupWorkspace: (process.argv.find((a) => a.startsWith('--workspace='))?.slice(12) ?? null) as 'video' | 'audio' | null,
  startupAudioExport: process.argv.find((a) => a.startsWith('--export-audio='))?.slice(15) ?? null,
  /** Debug: `--studio-fx=<trackId|master>` opens an effects chain; `--studio-editor=<clipId>` opens a pattern editor. */
  /** Debug: `--studio-play=<seconds>` plays the studio session for N seconds (surfaces scheduling errors) and quits. */
  startupStudioPlay: Number(process.argv.find((a) => a.startsWith('--studio-play='))?.slice(14) ?? 0) || 0,
  startupStudioFx: process.argv.find((a) => a.startsWith('--studio-fx='))?.slice(12) ?? null,
  startupFlags: process.argv.filter((a) => a.startsWith('--studio-') || a === '--assistant'),
  /** Debug: `--assistant-prompt=<text>` sends a message to the assistant headlessly, logs the outcome and quits. */
  startupAssistantPrompt: process.argv.find((a) => a.startsWith('--assistant-prompt='))?.slice(19) ?? null,
  startupStudioClip: process.argv.find((a) => a.startsWith('--studio-clip='))?.slice(14) ?? null,
  startupStudioEditor: process.argv.find((a) => a.startsWith('--studio-editor='))?.slice(16) ?? null,
  /** Debug: `--seek=<seconds>` positions the playhead after the startup project loads. */
  startupSeek: Number(process.argv.find((a) => a.startsWith('--seek='))?.slice(7) ?? 0) || 0,
  fileUrl: (filePath: string): string => {
    // file:// URL usable by <video>/<img> in the renderer
    const p = filePath.replace(/\\/g, '/');
    return encodeURI('file:///' + p.replace(/^\/+/, '')).replace(/#/g, '%23').replace(/\?/g, '%3F');
  },
};

contextBridge.exposeInMainWorld('api', api);
export type Api = typeof api;
