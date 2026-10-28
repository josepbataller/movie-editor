import type { SampleClip } from '@/shared/audioTypes';
import { useStudio } from '@/store/useStudio';
import { useProject } from '@/store/useProject';
import { getEngine, audioBufferToWav } from './engine';
import { processRegion, normalize, gainRegion, slice, reverseBuffer } from './spectral';
import { saveBufferAsAsset, decodeFile } from './recording';

// "Render in place" operations on sample clips, shared by the clip editor UI and the
// AI assistant tools. Each op bakes the clip as heard (range, rate, reverse), processes
// the audio, saves a new WAV asset and swaps the clip to it (non-destructive: revertable).

export type ClipOp =
  | { type: 'spectral'; t0: number; t1: number; f0: number; f1: number; gainDb?: number; mode?: 'attenuate' | 'remove' | 'isolate' }
  | { type: 'normalize'; peakDb?: number }
  | { type: 'gain'; t0?: number; t1?: number; db: number }
  | { type: 'trim'; t0: number; t1: number }
  | { type: 'reverse' }
  | { type: 'pitch'; semitones: number }
  | { type: 'tempo'; factor: number }
  | { type: 'denoise'; strength?: number }
  | { type: 'loudnorm' };

export function describeOp(op: ClipOp): string {
  switch (op.type) {
    case 'spectral': return `${op.mode ?? 'attenuate'} ${Math.round(op.f0)}–${Math.round(op.f1)} Hz, ${op.t0.toFixed(2)}–${op.t1.toFixed(2)} s${op.mode === 'attenuate' || !op.mode ? ` (${op.gainDb ?? -18} dB)` : ''}`;
    case 'normalize': return `normalize to ${op.peakDb ?? -1} dBFS`;
    case 'gain': return `gain ${op.db > 0 ? '+' : ''}${op.db} dB${op.t0 != null ? ` from ${op.t0}s to ${op.t1}s` : ''}`;
    case 'trim': return `trim to ${op.t0}–${op.t1} s`;
    case 'reverse': return 'reverse';
    case 'pitch': return `pitch shift ${op.semitones > 0 ? '+' : ''}${op.semitones} st`;
    case 'tempo': return `time stretch ×${(1 / op.factor).toFixed(2)} length`;
    case 'denoise': return `noise reduction ${op.strength ?? 12} dB`;
    case 'loudnorm': return 'loudness normalization (-16 LUFS)';
  }
}

/** The clip exactly as heard (range, rate, reverse) rendered to a buffer. */
export async function bakeClip(clip: SampleClip): Promise<AudioBuffer> {
  const engine = getEngine();
  const asset = useProject.getState().project.assets.find((a) => a.id === clip.assetId);
  if (!asset) throw new Error('Clip media not found');
  const buf = (await engine.loadAsset(asset)) ?? engine.getBuffer(clip.assetId);
  if (!buf) throw new Error('Could not decode the clip audio');
  const sr = buf.sampleRate;
  const len = Math.max(1, Math.ceil(clip.duration * sr));
  const octx = new OfflineAudioContext(buf.numberOfChannels, len, sr);
  const src = octx.createBufferSource();
  src.buffer = clip.reverse ? reverseBuffer((ch, l, r) => octx.createBuffer(ch, l, r), buf) : buf;
  src.playbackRate.value = clip.rate;
  src.connect(octx.destination);
  src.start(0, clip.reverse ? Math.max(0, buf.duration - clip.inPoint - clip.duration * clip.rate) : clip.inPoint);
  return octx.startRendering();
}

async function viaFfmpeg(input: AudioBuffer, op: Parameters<typeof window.api.processAudio>[1]): Promise<AudioBuffer> {
  const tmp = await window.api.tempPath(`clip-${Date.now()}.wav`);
  await window.api.writeBinary(tmp, audioBufferToWav(input));
  const res = await window.api.processAudio(tmp, op);
  if (!res.ok || !res.path) throw new Error(res.error ?? 'FFmpeg failed');
  return decodeFile(res.path);
}

/** Apply an op to a sample clip (render in place). Returns the new asset id. */
export async function applyClipOp(clipId: string, op: ClipOp): Promise<string> {
  const st = useStudio.getState();
  const clip = st.session.clips.find((c) => c.id === clipId);
  if (!clip || clip.type !== 'sample') throw new Error('Not an audio clip');
  const mk = getEngine().createBuffer;
  const input = await bakeClip(clip);
  const full = { t0: 0, t1: clip.duration };
  let out: AudioBuffer;
  switch (op.type) {
    case 'spectral': {
      const mode = op.mode ?? 'attenuate';
      const gain = mode === 'remove' ? 0 : mode === 'isolate' ? 0 : Math.pow(10, (op.gainDb ?? -18) / 20);
      out = processRegion(mk, input, { t0: op.t0, t1: op.t1, f0: op.f0, f1: op.f1 }, gain, mode === 'isolate');
      break;
    }
    case 'normalize': out = normalize(mk, input, op.peakDb ?? -1); break;
    case 'gain': out = gainRegion(mk, input, op.t0 ?? full.t0, op.t1 ?? full.t1, Math.pow(10, op.db / 20)); break;
    case 'trim': out = slice(mk, input, op.t0, op.t1); break;
    case 'reverse': out = reverseBuffer(mk, input); break;
    case 'pitch': out = await viaFfmpeg(input, { type: 'pitch', semitones: op.semitones }); break;
    case 'tempo': out = await viaFfmpeg(input, { type: 'tempo', factor: op.factor }); break;
    case 'denoise': out = await viaFfmpeg(input, { type: 'denoise', strength: op.strength ?? 12 }); break;
    case 'loudnorm': out = await viaFfmpeg(input, { type: 'loudnorm' }); break;
  }
  const id = await saveBufferAsAsset(out, `${clip.name}-${op.type}`);
  if (!id) throw new Error('Could not save the processed audio');
  useStudio.getState().replaceClipAudio(clipId, id, out.duration);
  return id;
}
