import type { Project, VisualClip, ExportSettings, VideoClip } from '@/shared/types';
import { drawFrame, textSource, Source } from './compositor';

// Frame-by-frame export engine.
//
// Video clips are decoded sequentially by FFmpeg (in the main process) to raw
// RGBA at the export frame rate — seeking a <video> element frame by frame is
// far too slow. Each decoded frame is copied into a per-clip canvas, the scene
// is composited with the same drawFrame() the live preview uses, and the result
// is streamed as raw RGBA back to FFmpeg for encoding (audio is mixed there too).

function toImageData(data: Uint8Array, w: number, h: number): ImageData {
  const arr = new Uint8ClampedArray(w * h * 4);
  arr.set(data.subarray(0, arr.length));
  return new ImageData(arr, w, h);
}

export interface FrameExportProgress { frame: number; totalFrames: number; percent: number }

interface ClipDecoder {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  nextIndex: number;   // index of the next frame FFmpeg will hand us
  hasFrame: boolean;
  ended: boolean;
}

export async function exportFrames(
  project: Project,
  settings: ExportSettings,
  onProgress: (p: FrameExportProgress) => void,
  isCancelled: () => boolean,
): Promise<{ ok: boolean; error?: string; cancelled?: boolean }> {
  const W = Math.max(2, Math.round(settings.width / 2) * 2);
  const H = Math.max(2, Math.round(settings.height / 2) * 2);
  const fps = settings.fps;

  const start = (await window.api.startFrameExport(project, settings)) as { ok: boolean; error?: string; totalFrames?: number };
  if (!start.ok) return { ok: false, error: start.error };
  const totalFrames = start.totalFrames ?? 0;

  // Images: plain <img> elements.
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(project.clips.filter((c) => c.type === 'image').map((c) => new Promise<void>((res) => {
    const asset = project.assets.find((a) => a.id === (c as { assetId: string }).assetId);
    if (!asset) return res();
    const img = new Image();
    img.onload = () => res();
    img.onerror = () => res();
    img.src = window.api.fileUrl(asset.path);
    images.set(c.id, img);
  })));

  const decoders = new Map<string, ClipDecoder>();

  // Decode at the source size, capped so huge sources don't flood the IPC channel.
  const decodeSize = (clip: VideoClip) => {
    const asset = project.assets.find((a) => a.id === clip.assetId)!;
    let w = asset.width || project.width, h = asset.height || project.height;
    const cap = Math.max(W, H) * 1.5;
    const s = Math.min(1, cap / Math.max(w, h));
    w = Math.max(2, Math.round((w * s) / 2) * 2);
    h = Math.max(2, Math.round((h * s) / 2) * 2);
    return { w, h };
  };

  const openDecoder = async (clip: VideoClip): Promise<ClipDecoder> => {
    const asset = project.assets.find((a) => a.id === clip.assetId)!;
    const { w, h } = decodeSize(clip);
    await window.api.decodeOpen(clip.id, {
      path: asset.path, inPoint: clip.inPoint, srcDuration: clip.duration * clip.speed + 1 / fps,
      speed: clip.speed, fps, width: w, height: h,
    });
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const dec: ClipDecoder = { canvas, ctx: canvas.getContext('2d')!, w, h, nextIndex: 0, hasFrame: false, ended: false };
    decoders.set(clip.id, dec);
    return dec;
  };

  /** Advance the clip's decoder so its canvas holds the frame for local time `local`. */
  const advance = async (clip: VideoClip, local: number) => {
    let dec = decoders.get(clip.id);
    if (!dec) dec = await openDecoder(clip);
    const want = Math.max(0, Math.floor(local * fps + 1e-6));
    while (!dec.ended && dec.nextIndex <= want) {
      const data = await window.api.decodeNext(clip.id);
      if (!data) { dec.ended = true; break; }
      if (dec.nextIndex === want) {
        // only paint the frame we actually need (skipped frames are just consumed)
        const img = toImageData(data, dec.w, dec.h);
        dec.ctx.putImageData(img, 0, 0);
        dec.hasFrame = true;
      } else if (dec.nextIndex === want - 1 || !dec.hasFrame) {
        // keep the most recent frame around in case the stream ends early
        const img = toImageData(data, dec.w, dec.h);
        dec.ctx.putImageData(img, 0, 0);
        dec.hasFrame = true;
      }
      dec.nextIndex++;
    }
  };

  const closeDecoder = async (id: string) => {
    if (!decoders.has(id)) return;
    decoders.delete(id);
    await window.api.decodeClose(id);
  };

  // Draw at project resolution, then scale to the export size (keeps effect px consistent with the preview).
  const stage = document.createElement('canvas');
  stage.width = project.width;
  stage.height = project.height;
  const sctx = stage.getContext('2d')!;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  octx.imageSmoothingQuality = 'high';

  const lookup = (clip: VisualClip, time: number): Source | null => {
    if (clip.type === 'text') return textSource(clip, project, time);
    if (clip.type === 'image') {
      const img = images.get(clip.id);
      if (!img || !img.complete || !img.naturalWidth) return null;
      return { source: img, w: img.naturalWidth, h: img.naturalHeight };
    }
    const dec = decoders.get(clip.id);
    if (!dec || !dec.hasFrame) return null;
    return { source: dec.canvas, w: dec.w, h: dec.h };
  };

  const stats = { decode: 0, draw: 0, read: 0, push: 0 };
  let finished = false;
  try {
    for (let f = 0; f < totalFrames; f++) {
      if (isCancelled()) {
        await window.api.cancelExport();
        return { ok: false, cancelled: true };
      }
      const t = (f + 0.5) / fps; // sample mid-frame

      let t0 = performance.now();
      for (const c of project.clips) {
        if (c.type !== 'video') continue;
        const active = c.start <= t && t < c.start + c.duration;
        if (active) await advance(c, t - c.start);
        else if (decoders.has(c.id) && t >= c.start + c.duration) await closeDecoder(c.id);
      }
      stats.decode += performance.now() - t0; t0 = performance.now();

      drawFrame(sctx, project, t, lookup);
      octx.drawImage(stage, 0, 0, W, H);
      stats.draw += performance.now() - t0; t0 = performance.now();
      const data = octx.getImageData(0, 0, W, H);
      stats.read += performance.now() - t0; t0 = performance.now();
      const res = (await window.api.pushFrame(data.data.buffer)) as { ok: boolean; error?: string; cancelled?: boolean };
      stats.push += performance.now() - t0;
      if (!res.ok) return res.cancelled ? { ok: false, cancelled: true } : { ok: false, error: res.error ?? 'Encoder stopped' };

      if (f % 3 === 0 || f === totalFrames - 1) onProgress({ frame: f + 1, totalFrames, percent: ((f + 1) / totalFrames) * 100 });
      if (f % 60 === 59) console.warn(`[frames] ${f + 1}/${totalFrames} decode=${stats.decode.toFixed(0)}ms draw=${stats.draw.toFixed(0)}ms read=${stats.read.toFixed(0)}ms push=${stats.push.toFixed(0)}ms`);
    }
    finished = true;
    return (await window.api.finishFrameExport()) as { ok: boolean; error?: string; cancelled?: boolean };
  } finally {
    await window.api.decodeCloseAll();
    // an exception or early return must not leave the encoder running in the main process
    if (!finished) await window.api.cancelExport().catch(() => {});
  }
}
