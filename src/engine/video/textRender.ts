import type { TextProps } from '@/shared/types';
import { ease } from './animation';
import { drawBackdrop } from './backdrops';

// Text rendering for titles / credits.
//
//  renderText(t, W, H)                      -> static layout ("block") canvas, cached.
//  renderTextFrame(t, W, H, localT, dur)    -> the frame to draw at a given moment, with the
//                                              animated backdrop and entrance / exit animations.
//
// Both the live preview and the frame-by-frame exporter use these, so the output
// matches exactly. 'scroll-up' without a backdrop returns the block canvas (its motion
// is applied by the compositor / by an FFmpeg overlay expression in the fast export path).

const cache = new Map<string, HTMLCanvasElement>();

function fontString(t: TextProps, size = t.fontSize): string {
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${size}px "${t.fontFamily}", "Segoe UI", Arial, sans-serif`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (line && ctx.measureText(test.trimEnd()).width > maxWidth && w.trim()) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else {
        line = test;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

interface Layout {
  lines: string[];
  lineH: number;
  pad: number;
  boxW: number;
  boxX: number;
  blockW: number;
  blockH: number;
  blockX: number;
  textX: number;
  twoCol: boolean;
}

/** Credits-style "Role | Name" lines (also accepts " - " and ": " separators). */
function splitColumns(line: string): [string, string] | null {
  const m = /^(.*?)\s*(?:\||\s-\s|:\s)\s*(.+)$/.exec(line);
  return m && m[1] && m[2] ? [m[1].trim(), m[2].trim()] : null;
}

function layout(t: TextProps, frameW: number, content = t.content): Layout {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = fontString(t);
  measure.letterSpacing = `${t.letterSpacing || 0}px`;
  const boxW = Math.max(50, frameW * Math.min(1, Math.max(0.1, t.boxWidth)));
  const pad = t.background ? t.backgroundPadding : 0;
  const twoCol = t.layout === 'two-column';
  const lines = twoCol ? (content || ' ').split('\n') : wrapLines(measure, content || ' ', boxW - pad * 2);
  const lineH = t.fontSize * t.lineHeight;
  const textW = twoCol ? boxW - pad * 2 : Math.max(...lines.map((l) => measure.measureText(l).width), 1);
  const blockW = Math.min(boxW, textW + pad * 2);
  const blockH = lines.length * lineH + pad * 2;
  const boxX = (frameW - boxW) / 2;
  let blockX: number;
  if (t.align === 'left') blockX = boxX;
  else if (t.align === 'right') blockX = boxX + boxW - blockW;
  else blockX = (frameW - blockW) / 2;
  const textX = t.align === 'left' ? blockX + pad : t.align === 'right' ? blockX + blockW - pad : blockX + blockW / 2;
  return { lines, lineH, pad, boxW, boxX, blockW, blockH, blockX, textX, twoCol };
}

function setupText(ctx: CanvasRenderingContext2D, t: TextProps) {
  ctx.font = fontString(t);
  ctx.letterSpacing = `${t.letterSpacing || 0}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = t.align;
}

function drawLine(ctx: CanvasRenderingContext2D, t: TextProps, line: string, x: number, y: number) {
  const glow = t.glow ?? 0;
  if (glow > 0) {
    // neon: a few blurred passes of the glow colour underneath
    ctx.save();
    ctx.shadowColor = t.glowColor ?? t.color;
    ctx.fillStyle = t.glowColor ?? t.color;
    for (const k of [2.2, 1.2, 0.5]) { ctx.shadowBlur = t.fontSize * k * glow; ctx.fillText(line, x, y); }
    ctx.restore();
  }
  if (t.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = t.fontSize * 0.12;
    ctx.shadowOffsetX = t.fontSize * 0.03;
    ctx.shadowOffsetY = t.fontSize * 0.03;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
  if (t.outline) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, t.fontSize * 0.06);
    ctx.strokeStyle = t.outline;
    ctx.strokeText(line, x, y);
  }
  ctx.fillStyle = t.color;
  ctx.fillText(line, x, y);
}

/** One layout line: either a normal line or a "Role | Name" pair around the centre gap. */
function drawLayoutLine(ctx: CanvasRenderingContext2D, t: TextProps, L: Layout, line: string, y: number) {
  const cols = L.twoCol ? splitColumns(line) : null;
  if (!cols) { ctx.textAlign = L.twoCol ? 'center' : t.align; drawLine(ctx, t, line, L.twoCol ? L.blockX + L.blockW / 2 : L.textX, y); return; }
  const gap = t.fontSize * 0.6;
  const mid = L.blockX + L.blockW / 2;
  ctx.textAlign = 'right';
  ctx.save(); ctx.globalAlpha *= 0.75; drawLine(ctx, t, cols[0], mid - gap / 2, y); ctx.restore();
  ctx.textAlign = 'left';
  drawLine(ctx, t, cols[1], mid + gap / 2, y);
}

function drawBackground(ctx: CanvasRenderingContext2D, t: TextProps, L: Layout, y: number) {
  if (!t.background) return;
  ctx.fillStyle = t.background;
  ctx.beginPath();
  ctx.roundRect(L.blockX, y, L.blockW, L.blockH, Math.min(16, L.pad));
  ctx.fill();
}

const hasBackdrop = (t: TextProps) => !!t.backdrop && t.backdrop !== 'none';

/** Static block canvas: frameW x frameH for normal titles, frameW x blockH for scrolling credits / crawl. */
export function renderText(t: TextProps, frameW: number, frameH: number, content = t.content): HTMLCanvasElement {
  const key = JSON.stringify([t, frameW, frameH, content]);
  const hit = cache.get(key);
  if (hit) return hit;

  const L = layout(t, frameW, content);
  const tall = t.animation === 'scroll-up' || t.animation === 'crawl';
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(frameW);
  canvas.height = Math.round(tall ? L.blockH + t.fontSize : frameH);
  const ctx = canvas.getContext('2d')!;
  const blockY = tall ? t.fontSize / 2 : (frameH - L.blockH) / 2;

  drawBackground(ctx, t, L, blockY);
  setupText(ctx, t);
  L.lines.forEach((line, i) => drawLayoutLine(ctx, t, L, line, blockY + L.pad + L.lineH * i + L.lineH / 2));

  if (cache.size > 60) cache.delete(cache.keys().next().value!);
  cache.set(key, canvas);
  return canvas;
}

export interface TextFrame { canvas: HTMLCanvasElement; w: number; h: number; mode: 'frame' | 'block' }

// A scratch canvas reused for every animated frame (avoids allocating per frame).
let scratch: HTMLCanvasElement | null = null;
function scratchCanvas(w: number, h: number): CanvasRenderingContext2D {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
  const ctx = scratch.getContext('2d')!;
  resetContext(ctx, w, h);
  return ctx;
}

function resetContext(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // reset() also drops any clip region left by a previous frame
  if (typeof (ctx as any).reset === 'function') (ctx as any).reset();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = 'transparent';
  ctx.clearRect(0, 0, w, h);
}

// Second scratch canvas for uncached partial renders (typewriter), so it can be
// composited onto the main scratch canvas by the exit animation.
let scratch2: HTMLCanvasElement | null = null;
function renderPartial(t: TextProps, frameW: number, frameH: number, content: string): HTMLCanvasElement {
  if (!scratch2) scratch2 = document.createElement('canvas');
  const W = Math.round(frameW), H = Math.round(frameH);
  if (scratch2.width !== W || scratch2.height !== H) { scratch2.width = W; scratch2.height = H; }
  const ctx = scratch2.getContext('2d')!;
  resetContext(ctx, W, H);
  const L = layout(t, frameW, content);
  const blockY = (frameH - L.blockH) / 2;
  drawBackground(ctx, t, L, blockY);
  setupText(ctx, t);
  L.lines.forEach((line, i) => drawLayoutLine(ctx, t, L, line, blockY + L.pad + L.lineH * i + L.lineH / 2));
  return scratch2;
}

/** The text clip at local time `localT` of a clip lasting `duration` seconds. */
export function renderTextFrame(t: TextProps, frameW: number, frameH: number, localT: number, duration: number): TextFrame {
  const W = Math.round(frameW), H = Math.round(frameH);
  const bd = hasBackdrop(t);

  if (t.animation === 'scroll-up' && !bd) {
    const c = renderText(t, frameW, frameH);
    return { canvas: c, w: c.width, h: c.height, mode: 'block' };
  }
  if (t.animation === 'crawl') return renderCrawl(t, W, H, localT, duration);

  const D = Math.max(0.01, Math.min(t.animationDuration, duration));
  const E = Math.max(0.01, Math.min(t.exitDuration, duration));
  const pin = t.animation === 'none' || t.animation === 'scroll-up' ? 1 : Math.min(1, localT / D); // entrance progress 0..1
  const pout = t.exitAnimation === 'none' ? 0 : Math.min(1, Math.max(0, (localT - (duration - E)) / E)); // exit progress 0..1

  // Progressive / per-letter animations draw their own content.
  if (t.animation === 'typewriter' && pin < 1) {
    const n = Math.floor(t.content.length * pin);
    const partial = t.content.slice(0, n) + (Math.floor(localT * 3) % 2 === 0 ? '|' : ' ');
    return applyExit(renderPartial(t, frameW, frameH, partial), t, W, H, pout, localT);
  }
  if ((t.animation === 'letters' || t.animation === 'rise') && pin < 1) return renderLetters(t, W, H, pin, pout, localT, t.animation === 'rise');
  if (t.animation === 'wave') return renderWave(t, W, H, localT, pin, pout);

  const block = renderText(t, frameW, frameH);
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  const p = ease('ease', pin);
  let alpha = 1, sx = 1, sy = 1, dx = 0, dy = 0, blur = 0, rot = 0;
  let clipW: number | null = null;
  let glitch = 0;

  switch (t.animation) {
    case 'fade': alpha = p; break;
    case 'slide-left': dx = (1 - p) * W; alpha = Math.min(1, p * 2); break;
    case 'slide-right': dx = -(1 - p) * W; alpha = Math.min(1, p * 2); break;
    case 'slide-up': dy = (1 - p) * H; alpha = Math.min(1, p * 2); break;
    case 'slide-down': dy = -(1 - p) * H; alpha = Math.min(1, p * 2); break;
    case 'zoom-in': sx = sy = 0.2 + 0.8 * p; alpha = p; break;
    case 'zoom-out': sx = sy = 2.5 - 1.5 * p; alpha = p; break;
    case 'pop': sx = sy = pin >= 1 ? 1 : ease('elastic', pin); alpha = Math.min(1, pin * 4); break;
    case 'blur-in': blur = (1 - p) * 30; alpha = p; break;
    case 'wipe': clipW = p * W; break;
    case 'spin-in': rot = (1 - p) * -Math.PI; sx = sy = 0.3 + 0.7 * p; alpha = Math.min(1, p * 2); break;
    case 'flip-in': sx = Math.max(0.001, Math.cos((1 - p) * Math.PI / 2)); alpha = Math.min(1, p * 3); break;
    case 'glitch': glitch = 1 - p; alpha = Math.min(1, p * 4 + 0.3); break;
    case 'scroll-up': {
      // credits with a backdrop: same motion as the compositor's block mode
      const blockH = block.height;
      dy = (H - (localT * (H + blockH)) / Math.max(0.01, duration) + blockH / 2) - H / 2;
      break;
    }
    default: break;
  }

  if (pout > 0) {
    const q = ease('ease', pout);
    switch (t.exitAnimation) {
      case 'fade': alpha *= 1 - q; break;
      case 'slide-left': dx += -q * W; alpha *= Math.min(1, (1 - q) * 2); break;
      case 'slide-right': dx += q * W; alpha *= Math.min(1, (1 - q) * 2); break;
      case 'slide-up': dy += -q * H; alpha *= Math.min(1, (1 - q) * 2); break;
      case 'slide-down': dy += q * H; alpha *= Math.min(1, (1 - q) * 2); break;
      case 'zoom-out': sx *= 1 - 0.8 * q; sy *= 1 - 0.8 * q; alpha *= 1 - q; break;
      case 'zoom-in': sx *= 1 + 1.5 * q; sy *= 1 + 1.5 * q; alpha *= 1 - q; break;
      case 'blur-out': blur += q * 30; alpha *= 1 - q; break;
      case 'wipe': clipW = (clipW ?? W) - q * W; break;
      case 'flip-out': sx *= Math.max(0.001, Math.cos(q * Math.PI / 2)); break;
      case 'glitch': glitch = Math.max(glitch, q); alpha *= 1 - q * 0.6; break;
      default: break;
    }
  }

  const isScroll = t.animation === 'scroll-up';
  const drawBlock = (ox = 0, oy = 0) => {
    if (isScroll) ctx.drawImage(block, -W / 2 + ox, -block.height / 2 + oy, W, block.height);
    else ctx.drawImage(block, -W / 2 + ox, -H / 2 + oy, W, H);
  };
  ctx.save();
  if (clipW !== null) { ctx.beginPath(); ctx.rect(0, 0, Math.max(0, clipW), H); ctx.clip(); }
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (blur > 0.2) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.translate(W / 2 + dx, H / 2 + dy);
  if (rot) ctx.rotate(rot);
  ctx.scale(Math.max(0.001, sx), Math.max(0.001, sy));
  if (glitch > 0.02) {
    // RGB split + horizontal slice jitter, driven by a time-seeded pseudo random
    const seed = Math.floor(localT * 30);
    const jit = (k: number) => (((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1) + 1) % 1;
    const amt = glitch * W * 0.03;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.filter = `${ctx.filter === 'none' ? '' : ctx.filter} hue-rotate(-60deg) saturate(3)`; drawBlock((jit(1) - 0.5) * amt * 2, 0);
    ctx.filter = `hue-rotate(120deg) saturate(3)`; drawBlock((jit(2) - 0.5) * amt * 2, 0);
    ctx.restore();
    // sliced bands
    for (let i = 0; i < 6; i++) {
      if (jit(10 + i) > glitch * 0.9) continue;
      const y = (jit(20 + i) - 0.5) * H, h = 6 + jit(30 + i) * 40;
      ctx.save(); ctx.beginPath(); ctx.rect(-W, y, 2 * W, h); ctx.clip(); drawBlock((jit(40 + i) - 0.5) * amt * 4, 0); ctx.restore();
    }
    ctx.globalAlpha *= 0.85;
  }
  drawBlock();
  ctx.restore();
  return { canvas: scratch!, w: W, h: H, mode: 'frame' };
}

function applyExit(block: HTMLCanvasElement, t: TextProps, W: number, H: number, pout: number, localT: number): TextFrame {
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  ctx.save();
  const q = ease('ease', pout);
  let alpha = 1, s = 1, sx = 1, dx = 0, dy = 0, blur = 0;
  if (pout > 0) {
    switch (t.exitAnimation) {
      case 'fade': alpha = 1 - q; break;
      case 'slide-left': dx = -q * W; break;
      case 'slide-right': dx = q * W; break;
      case 'slide-up': dy = -q * H; break;
      case 'slide-down': dy = q * H; break;
      case 'zoom-out': s = 1 - 0.8 * q; alpha = 1 - q; break;
      case 'zoom-in': s = 1 + 1.5 * q; alpha = 1 - q; break;
      case 'blur-out': blur = q * 30; alpha = 1 - q; break;
      case 'flip-out': sx = Math.max(0.001, Math.cos(q * Math.PI / 2)); break;
      case 'wipe': ctx.beginPath(); ctx.rect(0, 0, (1 - q) * W, H); ctx.clip(); break;
      case 'glitch': alpha = 1 - q * 0.6; dx = (Math.sin(localT * 90) * q * W) / 40; break;
    }
  }
  ctx.globalAlpha = alpha;
  if (blur > 0.2) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.translate(W / 2 + dx, H / 2 + dy);
  ctx.scale(s * sx, s);
  ctx.drawImage(block, -W / 2, -H / 2, W, H);
  ctx.restore();
  return { canvas: scratch!, w: W, h: H, mode: 'frame' };
}

/** Per-character layout helper: calls fn(ch, x, y, index, total) for every character. */
function eachChar(ctx: CanvasRenderingContext2D, t: TextProps, L: Layout, H: number, fn: (ch: string, x: number, y: number, i: number, total: number) => void) {
  const blockY = (H - L.blockH) / 2;
  setupText(ctx, t);
  ctx.textAlign = 'left';
  const total = L.lines.reduce((n, l) => n + l.length, 0) || 1;
  let index = 0;
  L.lines.forEach((line, li) => {
    const y = blockY + L.pad + L.lineH * li + L.lineH / 2;
    const lineW = ctx.measureText(line).width;
    let x = t.align === 'left' ? L.blockX + L.pad : t.align === 'right' ? L.blockX + L.blockW - L.pad - lineW : L.blockX + (L.blockW - lineW) / 2;
    for (const ch of line) { fn(ch, x, y, index, total); x += ctx.measureText(ch).width; index++; }
  });
  return blockY;
}

/** Letter-by-letter entrance: each character drops (or rises) in with a stagger. */
function renderLetters(t: TextProps, W: number, H: number, pin: number, pout: number, localT: number, rise: boolean): TextFrame {
  const L = layout(t, W);
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  drawBackground(ctx, t, L, (H - L.blockH) / 2);
  eachChar(ctx, t, L, H, (ch, x, y, i, total) => {
    const startP = (i / total) * 0.7;
    const lp = Math.min(1, Math.max(0, (pin - startP) / 0.3));
    if (lp <= 0) return;
    const e = rise ? ease('bounce', lp) : ease('ease', lp);
    ctx.save();
    ctx.globalAlpha = Math.min(1, lp * 2) * (1 - pout);
    ctx.translate(0, (1 - e) * (rise ? t.fontSize * 1.2 : -t.fontSize * 0.8));
    if (rise) { ctx.translate(x, y); ctx.rotate((1 - e) * 0.4); ctx.translate(-x, -y); }
    drawLine(ctx, t, ch, x, y);
    ctx.restore();
  });
  return { canvas: scratch!, w: W, h: H, mode: 'frame' };
}

/** Letters bob on a sine wave for the whole clip (entrance fades in, exit fades out). */
function renderWave(t: TextProps, W: number, H: number, localT: number, pin: number, pout: number): TextFrame {
  const L = layout(t, W);
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  drawBackground(ctx, t, L, (H - L.blockH) / 2);
  ctx.globalAlpha = Math.min(1, pin * 2) * (1 - pout);
  eachChar(ctx, t, L, H, (ch, x, y, i) => {
    const dy = Math.sin(localT * 4 + i * 0.5) * t.fontSize * 0.18;
    drawLine(ctx, t, ch, x, y + dy);
  });
  return { canvas: scratch!, w: W, h: H, mode: 'frame' };
}

/**
 * Star Wars style opening crawl: the text block lies on a plane tilted away from the
 * camera and scrolls into the distance. Rendered per destination scanline (a "Mode 7"
 * projection), so lines really converge towards the vanishing point.
 */
function renderCrawl(t: TextProps, W: number, H: number, localT: number, duration: number): TextFrame {
  const block = renderText(t, W, H);               // W x blockH text, transparent background
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  const tilt = Math.min(0.95, Math.max(0.15, t.perspective ?? 0.6));
  const horizon = H * (0.08 + (1 - tilt) * 0.22);  // steeper tilt -> higher vanishing point
  const F = H * (0.25 + (1 - tilt) * 1.2);         // focal length: how fast text shrinks with distance
  const blockH = block.height;
  const gFar = F * 1.4;                            // distance at which the last line is small enough to end (keeps most of the clip readable)
  const p = duration > 0 ? localT / duration : 0;
  const s = p * (blockH + gFar);                    // scroll: top row reaches the bottom edge at t=0

  const nearScale = 1.25;                           // text a bit bigger than the frame at the bottom
  for (let y = Math.ceil(horizon) + 1; y < H; y++) {
    const v = (y - horizon) / (H - horizon);        // 1 at the bottom (near), ->0 at the horizon (far)
    const g = F * (1 / v - 1);                      // ground distance of this scanline
    const r = s - g;                                // block row that lands on this scanline
    if (r < 0 || r >= blockH) continue;
    const sw = W * v * nearScale;
    const alpha = Math.min(1, v * 2.2) * Math.min(1, (blockH - r) / (t.fontSize * 0.5) + 0.2);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(block, 0, r, W, 1, (W - sw) / 2, y, sw, 1);
  }
  ctx.globalAlpha = 1;
  return { canvas: scratch!, w: W, h: H, mode: 'frame' };
}

export const FONT_CHOICES = [
  'Segoe UI', 'Arial', 'Arial Black', 'Impact', 'Georgia', 'Times New Roman', 'Trebuchet MS',
  'Verdana', 'Tahoma', 'Courier New', 'Consolas', 'Comic Sans MS', 'Palatino Linotype', 'Garamond',
  'Franklin Gothic Medium', 'Bahnschrift', 'Cambria', 'Candara', 'Calibri', 'Lucida Console',
  'Segoe Script', 'Segoe Print', 'Book Antiqua', 'Century Gothic', 'Copperplate Gothic Bold', 'Rockwell',
];
