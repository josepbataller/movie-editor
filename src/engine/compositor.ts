import { Project, VisualClip, Effects, Transform, fittedSize, fadeFactor, isVisual } from '@/shared/types';
import { renderTextFrame } from './textRender';
import { animatedState } from './animation';

export function cssFilter(fx: Effects): string {
  const parts: string[] = [];
  if (fx.brightness !== 0) parts.push(`brightness(${1 + fx.brightness})`);
  if (fx.contrast !== 1) parts.push(`contrast(${fx.contrast})`);
  if (fx.saturation !== 1 && !fx.grayscale) parts.push(`saturate(${fx.saturation})`);
  if (fx.grayscale) parts.push('grayscale(1)');
  else if (fx.hue !== 0) parts.push(`hue-rotate(${fx.hue}deg)`);
  if (fx.sepia) parts.push('sepia(1)');
  if (fx.invert) parts.push('invert(1)');
  if (fx.blur > 0) parts.push(`blur(${fx.blur}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

export interface Source { source: CanvasImageSource; w: number; h: number }

/** The live preview registers its media lookup here so other views (Title Studio) can composite frames. */
export const previewSource: { lookup: SourceLookup | null } = { lookup: null };
/** Resolves the pixels for a clip at a timeline time (video frame, image, or rendered text). */
export type SourceLookup = (clip: VisualClip, time: number) => Source | null;

/** Visual clips active at `time`, bottom layer first. */
export function activeVisualClips(project: Project, time: number): VisualClip[] {
  const order = new Map(project.tracks.map((t, i) => [t.id, i]));
  const hidden = new Set(project.tracks.filter((t) => t.hidden).map((t) => t.id));
  return project.clips
    .filter(isVisual)
    .filter((c) => !hidden.has(c.trackId) && c.start <= time && time < c.start + c.duration)
    .sort((a, b) => (order.get(a.trackId)! - order.get(b.trackId)!) || a.start - b.start);
}

export interface ClipBounds { cx: number; cy: number; w: number; h: number; rotation: number }

/** Where a clip is drawn in project pixel space (centre + size, before rotation), using the given transform. */
export function clipBoundsWith(project: Project, clip: VisualClip, tf: Transform, srcW: number, srcH: number, time: number): ClipBounds {
  let fitted: { w: number; h: number };
  if (clip.type === 'text') {
    fitted = { w: project.width, h: (srcH / srcW) * project.width };
  } else {
    fitted = fittedSize(srcW, srcH, project.width, project.height, tf.fit);
  }
  const w = fitted.w * tf.scale;
  const h = fitted.h * tf.scale;
  const cx = project.width / 2 + tf.x;
  let cy = project.height / 2 + tf.y;
  if (clip.type === 'text' && clip.text.animation === 'scroll-up') {
    const local = time - clip.start;
    const top = project.height - (local * (project.height + h)) / clip.duration;
    cy = top + h / 2 + tf.y;
  }
  return { cx, cy, w, h, rotation: tf.rotation };
}

export function clipBounds(project: Project, clip: VisualClip, srcW: number, srcH: number, time: number): ClipBounds {
  const { transform } = animatedState(clip, time - clip.start);
  return clipBoundsWith(project, clip, transform, srcW, srcH, time);
}

/** Rendered pixels for a text clip at a timeline time. */
export function textSource(clip: VisualClip, project: Project, time: number): Source | null {
  if (clip.type !== 'text') return null;
  const f = renderTextFrame(clip.text, project.width, project.height, time - clip.start, clip.duration);
  return { source: f.canvas, w: f.w, h: f.h };
}

export function drawFrame(ctx: CanvasRenderingContext2D, project: Project, time: number, lookup: SourceLookup) {
  const { width: W, height: H } = project;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillStyle = project.backgroundColor;
  ctx.fillRect(0, 0, W, H);

  for (const clip of activeVisualClips(project, time)) {
    const src = lookup(clip, time);
    if (!src) continue;
    const local = time - clip.start;
    const { transform: tf, effects } = animatedState(clip, local);
    const b = clipBoundsWith(project, clip, tf, src.w, src.h, time);
    const alpha = tf.opacity * fadeFactor(local, clip.duration, clip.fadeIn, clip.fadeOut);
    if (alpha <= 0.001) continue;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = clip.type === 'text' && !clip.animations?.length ? 'none' : cssFilter(effects);
    ctx.translate(b.cx, b.cy);
    if (b.rotation) ctx.rotate((b.rotation * Math.PI) / 180);
    ctx.scale(tf.flipH ? -1 : 1, tf.flipV ? -1 : 1);
    try {
      ctx.drawImage(src.source, -b.w / 2, -b.h / 2, b.w, b.h);
    } catch {
      // media not ready yet
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Hit-test visual clips at a point in project pixel space; returns top-most first. */
export function hitTest(project: Project, time: number, px: number, py: number, lookup: SourceLookup): VisualClip | null {
  const clips = activeVisualClips(project, time).reverse();
  for (const clip of clips) {
    const src = lookup(clip, time);
    if (!src) continue;
    const b = clipBounds(project, clip, src.w, src.h, time);
    // Inverse-rotate the point into the clip's local space.
    const a = (-b.rotation * Math.PI) / 180;
    const dx = px - b.cx;
    const dy = py - b.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return clip;
  }
  return null;
}
