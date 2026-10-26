import { useStudio } from '@/store/useStudio';
import { useProject, uid } from '@/store/useProject';
import { getEngine, audioBufferToWav } from './engine';
import { importFiles } from '@/engine/project/importMedia';

// Recording workflow and "render in place" helpers for the Audio Studio.
//
// Recording: arm a track, press ●. The transport starts (after a one-bar count-in when
// enabled), the microphone is captured in sync with playback, and on stop the take is
// saved as a WAV in the project's media folder, imported as an asset and placed as a
// clip on the armed track where the recording started.

const takeCounter = { n: 0 };

/** Folder where recordings / renders are written: next to the project file, else the temp dir. */
async function mediaFolder(): Promise<string> {
  const projectPath = useProject.getState().projectPath;
  if (projectPath) {
    const dir = projectPath.replace(/[\\/][^\\/]+$/, '') + '\\Movie Editor Audio';
    try { await window.api.ensureDir(dir); return dir; } catch { /* fall through */ }
  }
  const t = await window.api.tempPath('');
  return t.replace(/[\\/]+$/, '');
}

function stamp() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }

/** Save a buffer as WAV, import it as a media asset and make it playable immediately. Returns the asset id. */
export async function saveBufferAsAsset(buffer: AudioBuffer, baseName: string): Promise<string | null> {
  const dir = await mediaFolder();
  const safe = baseName.replace(/[^\w\- ]+/g, '_').slice(0, 40);
  const path = `${dir}\\${safe}-${stamp()}.wav`;
  await window.api.writeBinary(path, audioBufferToWav(buffer));
  await importFiles([path]);
  const asset = useProject.getState().project.assets.find((a) => a.path === path);
  if (!asset) return null;
  getEngine().registerBuffer(asset.id, buffer);
  return asset.id;
}

let recordStartTimeline = 0;

export async function startRecording(): Promise<void> {
  const st = useStudio.getState();
  const engine = getEngine();
  if (st.recording) return;
  // the mic always records onto an AUDIO track: the armed one, else the first, else a new one
  const armed = st.session.tracks.find((t) => t.id === st.armedTrackId);
  let trackId = armed?.kind === 'audio' ? armed.id : (st.session.tracks.find((t) => t.kind === 'audio')?.id ?? null);
  if (!trackId) { trackId = st.addTrack('audio'); useStudio.getState().updateTrack(trackId, { name: 'Recording' }, { commit: false }); }
  if (useStudio.getState().armedTrackId !== trackId) useStudio.getState().armTrack(trackId);
  try {
    if (!engine.recorder.inputOpen) await engine.recorder.openInput(st.inputDeviceId ?? undefined, engine.masterAnalyser);
    engine.recorder.setMonitor(st.monitorInput);
  } catch (e: any) {
    alert(`Microphone not available: ${e?.message ?? e}`);
    return;
  }
  st.setRecording(true);
  const from = st.currentTime;
  recordStartTimeline = from;
  if (st.countIn && !st.playing) {
    // one bar of clicks without moving the transport, then start exactly at `from`
    await engine.countIn(1);
    if (!useStudio.getState().recording) return; // cancelled during count-in
  }
  if (!useStudio.getState().playing) {
    useStudio.getState().setPlaying(true);
    // engine.play() is async (resume + preload): wait until its clock is running
    for (let i = 0; i < 200 && !engine.playing; i++) await new Promise((r) => setTimeout(r, 10));
    if (!useStudio.getState().recording) return;
  }
  // the take is placed where the engine's clock is at this instant (compensates the start latency)
  recordStartTimeline = engine.timelineAt(engine.ctx.currentTime);
  engine.recorder.start();
}

export async function stopRecording(): Promise<void> {
  const st = useStudio.getState();
  const engine = getEngine();
  if (!st.recording) return;
  st.setRecording(false);
  const result = engine.recorder.stop();
  st.setPlaying(false);
  if (!result) return;
  const trackId = st.armedTrackId;
  takeCounter.n++;
  const assetId = await saveBufferAsAsset(result.buffer, `Take ${takeCounter.n}`);
  if (!assetId || !trackId) return;
  const name = useProject.getState().project.assets.find((a) => a.id === assetId)?.name ?? 'Take';
  const id = useStudio.getState().addSampleClip(trackId, assetId, name, Math.max(0, recordStartTimeline), result.buffer.duration);
  useStudio.getState().select([id]);
  useStudio.getState().setCurrentTime(recordStartTimeline);
}

export async function toggleRecording() {
  if (useStudio.getState().recording) await stopRecording(); else await startRecording();
}

/** Decode a temp WAV produced by FFmpeg processing into an AudioBuffer. */
export async function decodeFile(path: string): Promise<AudioBuffer> {
  const data = await (await fetch(window.api.fileUrl(path))).arrayBuffer();
  return getEngine().ctx.decodeAudioData(data);
}

export const newAssetId = uid;
