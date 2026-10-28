// Translates a Project into FFmpeg command lines.
//
// Two engines:
//  * 'graph'  – every visual clip is an FFmpeg input, pre-processed into RGBA
//               (scale/flip/effects/rotate/opacity/fades), delayed with tpad and
//               overlaid on a background in layer order. Fast, but static per clip.
//  * 'frames' – the renderer draws every frame on a canvas (same code as the live
//               preview) and streams raw RGBA into FFmpeg's stdin. Supports all
//               animations. Audio is always mixed by FFmpeg (amix) in both engines.

import type { Project, VisualClip, ExportSettings, MediaAsset, Transform, AnimationSegment } from '../src/shared/types';
import { fittedSize, isVisual, hasAudio, PER_FRAME_TEXT_ANIMATIONS } from '../src/shared/types';

export interface BuiltCommand {
  inputArgs: string[];
  filterGraph: string;
  outputArgs: string[];
  totalDuration: number;
}

const r = (n: number, d = 3) => Number(n.toFixed(d));
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function ffColor(css: string): string {
  // ffmpeg accepts 0xRRGGBB and named colours; css '#rrggbb' -> '0xrrggbb'
  if (css.startsWith('#')) return '0x' + css.slice(1);
  return css;
}

function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5; }
  while (s > 100) { out.push('atempo=100'); s /= 100; }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${r(s, 4)}`);
  return out;
}

export function projectDuration(project: Project): number {
  return project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}

/** True when the project uses features only the frame-by-frame engine can render. */
export function needsFrameEngine(project: Project): boolean {
  return project.clips.some((c) => {
    if (c.type === 'audio') return false;
    if (c.animations?.some((a) => a.property !== 'volume')) return true;
    if (c.type === 'text' && PER_FRAME_TEXT_ANIMATIONS.includes(c.text.animation)) return true;
    if (c.type === 'text' && c.text.exitAnimation !== 'none' && c.text.exitAnimation !== 'fade') return true;
    if (c.type === 'text' && c.text.backdrop && c.text.backdrop !== 'none') return true;
    if (c.type === 'text' && (c.text.glow ?? 0) > 0 && c.text.animation === 'scroll-up') return true;
    return false;
  });
}

/** Linear-ramp envelope of a volume segment as an FFmpeg expression in `t` (seconds into the clip). */
function volumeExpr(segs: AnimationSegment[]): string {
  const parts = segs.map((s) => {
    const ri = Math.max(0.001, s.rampIn), ro = Math.max(0.001, s.rampOut);
    const env = s.rampOut > 0
      ? `min(1,min((t-${r(s.start)})/${r(ri)},(${r(s.end)}-t)/${r(ro)}))`
      : `min(1,(t-${r(s.start)})/${r(ri)})`;
    return `(${r(s.value)}*if(between(t,${r(s.start)},${r(s.end)}),${env},0))`;
  });
  return `max(0,1+${parts.join('+')})`;
}

/** Appends the audio part of the graph (one input per sounding clip, amix) and returns the output label. */
function appendAudio(project: Project, inputArgs: string[], filters: string[], inputCount: number, total: number): number {
  const assets = new Map<string, MediaAsset>(project.assets.map((a) => [a.id, a]));
  const trackById = new Map(project.tracks.map((t) => [t.id, t]));
  const audioLabels: string[] = [];

  for (const clip of project.clips) {
    if (!hasAudio(clip)) continue;
    const track = trackById.get(clip.trackId);
    if (!track || track.muted) continue;
    if (clip.type === 'video' && track.hidden) continue; // hidden layer: silent, like the preview
    if (clip.audio.muted || clip.audio.volume <= 0) continue;
    const asset = assets.get(clip.assetId);
    if (!asset || !asset.hasAudio) continue;

    const idx = inputCount++;
    inputArgs.push('-ss', r(clip.inPoint).toString(), '-t', r(clip.duration * clip.speed).toString(), '-i', asset.path);

    const chain: string[] = ['asetpts=PTS-STARTPTS', ...atempoChain(clip.speed)];
    if (clip.audio.volume !== 1) chain.push(`volume=${r(clip.audio.volume)}`);
    const volSegs = (clip.animations ?? []).filter((a) => a.property === 'volume');
    if (volSegs.length) chain.push(`volume='${volumeExpr(volSegs)}':eval=frame`);
    if (clip.audio.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${r(clip.audio.fadeIn)}`);
    if (clip.audio.fadeOut > 0) {
      chain.push(`afade=t=out:st=${r(Math.max(0, clip.duration - clip.audio.fadeOut))}:d=${r(clip.audio.fadeOut)}`);
    }
    chain.push(`atrim=0:${r(clip.duration)}`);
    chain.push('aformat=sample_rates=48000:channel_layouts=stereo');
    const ms = Math.round(clip.start * 1000);
    if (ms > 0) chain.push(`adelay=${ms}:all=1`);
    const label = `a${idx}`;
    filters.push(`[${idx}:a]${chain.join(',')}[${label}]`);
    audioLabels.push(label);
  }
  if (audioLabels.length === 0) {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${r(total)}[aout]`);
  } else if (audioLabels.length === 1) {
    filters.push(`[${audioLabels[0]}]apad,atrim=0:${r(total)}[aout]`);
  } else {
    filters.push(
      `${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,apad,atrim=0:${r(total)}[aout]`,
    );
  }
  return inputCount;
}

function encodingArgs(settings: ExportSettings, total: number, mapVideo: string): string[] {
  const out: string[] = ['-map', mapVideo, '-map', '[aout]', '-r', String(settings.fps), '-t', r(total).toString()];
  const crf = { high: 18, medium: 23, low: 28 }[settings.quality];
  if (settings.format === 'webm') {
    out.push('-c:v', 'libvpx-vp9', '-crf', String(crf + 12), '-b:v', '0', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '160k');
  } else {
    out.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k');
    if (settings.format === 'mp4') out.push('-movflags', '+faststart');
  }
  out.push('-y', settings.outputPath);
  return out;
}

// ---------------------------------------------------------------------------
// Engine 'frames': video arrives as raw RGBA on stdin (input 0), audio via the graph.
// ---------------------------------------------------------------------------

export function buildFramesCommand(project: Project, settings: ExportSettings): BuiltCommand {
  const total = projectDuration(project);
  if (total <= 0) throw new Error('The timeline is empty.');
  const W = even(settings.width), H = even(settings.height);
  const inputArgs: string[] = ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(settings.fps), '-i', 'pipe:0'];
  const filters: string[] = ['[0:v]format=yuv420p[vout]'];
  appendAudio(project, inputArgs, filters, 1, total);
  return { inputArgs, filterGraph: filters.join(';\n'), outputArgs: encodingArgs(settings, total, '[vout]'), totalDuration: total };
}

// ---------------------------------------------------------------------------
// Engine 'graph'
// ---------------------------------------------------------------------------

export function buildFfmpegCommand(project: Project, settings: ExportSettings): BuiltCommand {
  const total = projectDuration(project);
  if (total <= 0) throw new Error('The timeline is empty.');

  const W = even(settings.width);
  const H = even(settings.height);
  const fps = settings.fps;
  const sx = W / project.width;
  const sy = H / project.height;
  const assets = new Map<string, MediaAsset>(project.assets.map((a) => [a.id, a]));
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  const trackById = new Map(project.tracks.map((t) => [t.id, t]));

  const inputArgs: string[] = [];
  const filters: string[] = [];
  let inputCount = 0;

  // ---- Visual clips, ordered bottom layer first ----
  const visual = project.clips
    .filter(isVisual)
    .filter((c) => !trackById.get(c.trackId)?.hidden)
    .sort((a, b) => (trackIndex.get(a.trackId)! - trackIndex.get(b.trackId)!) || a.start - b.start);

  const videoLabels: { label: string; clip: VisualClip }[] = [];

  for (const clip of visual) {
    const idx = inputCount++;
    let fitted: { w: number; h: number };

    if (clip.type === 'text') {
      const png = settings.textImages[clip.id];
      const size = settings.textImageSizes[clip.id];
      if (!png || !size) throw new Error(`Missing rendered image for text clip "${clip.name}"`);
      inputArgs.push('-loop', '1', '-framerate', String(fps), '-t', r(clip.duration).toString(), '-i', png);
      // Text PNGs are rendered project-width; keep their aspect.
      fitted = { w: project.width, h: (size.h / size.w) * project.width };
    } else {
      const asset = assets.get(clip.assetId);
      if (!asset) throw new Error(`Missing media for clip "${clip.name}"`);
      const srcW = asset.width || project.width;
      const srcH = asset.height || project.height;
      fitted = fittedSize(srcW, srcH, project.width, project.height, clip.transform.fit);
      if (clip.type === 'image') {
        if (/\.gif$/i.test(asset.path)) {
          // the gif demuxer has no 'loop' option; loop the animation forever and cut with -t
          inputArgs.push('-ignore_loop', '0', '-t', r(clip.duration).toString(), '-i', asset.path);
        } else {
          inputArgs.push('-loop', '1', '-framerate', String(fps), '-t', r(clip.duration).toString(), '-i', asset.path);
        }
      } else {
        const srcDur = clip.duration * clip.speed;
        inputArgs.push('-ss', r(clip.inPoint).toString(), '-t', r(srcDur).toString(), '-i', asset.path);
      }
    }

    const tf: Transform = clip.transform;
    const outW = Math.max(2, Math.round(fitted.w * tf.scale * sx));
    const outH = Math.max(2, Math.round(fitted.h * tf.scale * sy));

    const chain: string[] = [];
    if (clip.type === 'video' && clip.speed !== 1) {
      chain.push(`setpts=(PTS-STARTPTS)/${r(clip.speed, 4)}`);
    } else {
      chain.push('setpts=PTS-STARTPTS');
    }
    chain.push(`fps=${fps}`);
    chain.push(`scale=${outW}:${outH}:flags=bicubic`);
    if (tf.flipH) chain.push('hflip');
    if (tf.flipV) chain.push('vflip');

    if (clip.type !== 'text') {
      const fx = clip.effects;
      const eq: string[] = [];
      if (fx.brightness !== 0) eq.push(`brightness=${r(fx.brightness)}`);
      if (fx.contrast !== 1) eq.push(`contrast=${r(fx.contrast)}`);
      if (fx.saturation !== 1 && !fx.grayscale) eq.push(`saturation=${r(fx.saturation)}`);
      if (eq.length) chain.push(`eq=${eq.join(':')}`);
      if (fx.grayscale) chain.push('hue=s=0');
      else if (fx.hue !== 0) chain.push(`hue=h=${r(fx.hue)}`);
      if (fx.sepia) chain.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
      if (fx.invert) chain.push('negate');
      if (fx.blur > 0) chain.push(`gblur=sigma=${r(fx.blur * sx)}`);
    }

    chain.push('format=rgba');
    if (tf.rotation % 360 !== 0) {
      const a = r((tf.rotation * Math.PI) / 180, 5);
      chain.push(`rotate=${a}:ow=rotw(${a}):oh=roth(${a}):c=none`);
    }
    if (tf.opacity < 1) chain.push(`colorchannelmixer=aa=${r(tf.opacity)}`);
    // Clip fades, plus text "fade" entrance/exit animations as separate alpha fades (they multiply, like the preview).
    const fadeIns = [clip.fadeIn];
    const fadeOuts = [clip.fadeOut];
    if (clip.type === 'text') {
      if (clip.text.animation === 'fade') fadeIns.push(Math.min(clip.text.animationDuration, clip.duration));
      if (clip.text.exitAnimation === 'fade') fadeOuts.push(Math.min(clip.text.exitDuration, clip.duration));
    }
    for (const d of fadeIns) if (d > 0) chain.push(`fade=t=in:st=0:d=${r(d)}:alpha=1`);
    for (const d of fadeOuts) if (d > 0) chain.push(`fade=t=out:st=${r(Math.max(0, clip.duration - d))}:d=${r(d)}:alpha=1`);
    chain.push(`trim=0:${r(clip.duration)}`);
    if (clip.start > 0) chain.push(`tpad=start_duration=${r(clip.start)}:color=black@0`);

    const label = `v${idx}`;
    filters.push(`[${idx}:v]${chain.join(',')}[${label}]`);
    videoLabels.push({ label, clip });
  }

  // ---- Compose ----
  filters.push(`color=c=${ffColor(project.backgroundColor)}:s=${W}x${H}:r=${fps}:d=${r(total)},format=rgba[base]`);
  let current = 'base';
  videoLabels.forEach(({ label, clip }, i) => {
    const tf = clip.transform;
    const X = r(tf.x * sx);
    const Y = r(tf.y * sy);
    const end = r(clip.start + clip.duration);
    const xExpr = `(W-w)/2+(${X})`;
    let yExpr = `(H-h)/2+(${Y})`;
    if (clip.type === 'text' && clip.text.animation === 'scroll-up') {
      // Scroll from fully below the frame to fully above it over the clip duration.
      yExpr = `H-(t-${r(clip.start)})*(H+h)/${r(clip.duration)}+(${Y})`;
    }
    const out = i === videoLabels.length - 1 ? 'vcomp' : `o${i}`;
    filters.push(
      `[${current}][${label}]overlay=x='${xExpr}':y='${yExpr}':eval=frame:enable='between(t,${r(clip.start)},${end})':eof_action=pass:format=auto[${out}]`,
    );
    current = out;
  });
  if (current === 'base') filters.push('[base]null[vcomp]');
  filters.push('[vcomp]format=yuv420p[vout]');

  appendAudio(project, inputArgs, filters, inputCount, total);

  return { inputArgs, filterGraph: filters.join(';\n'), outputArgs: encodingArgs(settings, total, '[vout]'), totalDuration: total };
}
