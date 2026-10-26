import type { TextProps } from '@/shared/types';
import { ease } from './animation';

// Text rendering for titles / credits.
//
//  renderText(t, W, H)                      -> static layout ("block") canvas, cached.
//  renderTextFrame(t, W, H, localT, dur)    -> the frame to draw at a given moment,
//                                              with entrance / exit animations applied.
//
// Both the live preview and the frame-by-frame exporter use these, so the output
// matches exactly. 'scroll-up' returns the block canvas (its motion is applied by the
// compositor / by an FFmpeg overlay expression in the fast export path).

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
}

function layout(t: TextProps, frameW: number, content = t.content): Layout {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = fontString(t);
  measure.letterSpacing = `${t.letterSpacing || 0}px`;
  const boxW = Math.max(50, frameW * Math.min(1, Math.max(0.1, t.boxWidth)));
  const pad = t.background ? t.backgroundPadding : 0;
  const lines = wrapLines(measure, content || ' ', boxW - pad * 2);
  const lineH = t.fontSize * t.lineHeight;
  const textW = Math.max(...lines.map((l) => measure.measureText(l).width), 1);
  const blockW = Math.min(boxW, textW + pad * 2);
  const blockH = lines.length * lineH + pad * 2;
  const boxX = (frameW - boxW) / 2;
  let blockX: number;
  if (t.align === 'left') blockX = boxX;
  else if (t.align === 'right') blockX = boxX + boxW - blockW;
  else blockX = (frameW - blockW) / 2;
  const textX = t.align === 'left' ? blockX + pad : t.align === 'right' ? blockX + blockW - pad : blockX + blockW / 2;
  return { lines, lineH, pad, boxW, boxX, blockW, blockH, blockX, textX };
}

function setupText(ctx: CanvasRenderingContext2D, t: TextProps) {
  ctx.font = fontString(t);
  ctx.letterSpacing = `${t.letterSpacing || 0}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = t.align;
}

function drawLine(ctx: CanvasRenderingContext2D, t: TextProps, line: string, x: number, y: number) {
  if (t.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = t.fontSize * 0.12;
    ctx.shadowOffsetX = t.fontSize * 0.03;
    ctx.shadowOffsetY = t.fontSize * 0.03;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
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

function drawBackground(ctx: CanvasRenderingContext2D, t: TextProps, L: Layout, y: number) {
  if (!t.background) return;
  ctx.fillStyle = t.background;
  ctx.beginPath();
  ctx.roundRect(L.blockX, y, L.blockW, L.blockH, Math.min(16, L.pad));
  ctx.fill();
}

/** Static block canvas: frameW x frameH for normal titles, frameW x blockH for scrolling credits. */
export function renderText(t: TextProps, frameW: number, frameH: number, content = t.content): HTMLCanvasElement {
  const key = JSON.stringify([t, frameW, frameH, content]);
  const hit = cache.get(key);
  if (hit) return hit;

  const L = layout(t, frameW, content);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(frameW);
  canvas.height = Math.round(t.animation === 'scroll-up' ? L.blockH + t.fontSize : frameH);
  const ctx = canvas.getContext('2d')!;
  const blockY = t.animation === 'scroll-up' ? t.fontSize / 2 : (frameH - L.blockH) / 2;

  drawBackground(ctx, t, L, blockY);
  setupText(ctx, t);
  L.lines.forEach((line, i) => drawLine(ctx, t, line, L.textX, blockY + L.pad + L.lineH * i + L.lineH / 2));

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
  L.lines.forEach((line, i) => drawLine(ctx, t, line, L.textX, blockY + L.pad + L.lineH * i + L.lineH / 2));
  return scratch2;
}

/** The text clip at local time `localT` of a clip lasting `duration` seconds. */
export function renderTextFrame(t: TextProps, frameW: number, frameH: number, localT: number, duration: number): TextFrame {
  const W = Math.round(frameW), H = Math.round(frameH);

  if (t.animation === 'scroll-up') {
    const c = renderText(t, frameW, frameH);
    return { canvas: c, w: c.width, h: c.height, mode: 'block' };
  }
  if (t.animation === 'crawl') return renderCrawl(t, W, H, localT, duration);

  const D = Math.max(0.01, Math.min(t.animationDuration, duration));
  const E = Math.max(0.01, Math.min(t.exitDuration, duration));
  const pin = t.animation === 'none' ? 1 : Math.min(1, localT / D);            // entrance progress 0..1
  const pout = t.exitAnimation === 'none' ? 0 : Math.min(1, Math.max(0, (localT - (duration - E)) / E)); // exit progress 0..1

  // Progressive-content animations draw a partial block.
  if (t.animation === 'typewriter' && pin < 1) {
    const n = Math.floor(t.content.length * pin);
    const partial = t.content.slice(0, n) + (Math.floor(localT * 3) % 2 === 0 ? '|' : ' ');
    const c = renderPartial(t, frameW, frameH, partial);
    return applyExit(c, t, W, H, pout);
  }
  if (t.animation === 'letters' && pin < 1) {
    return renderLetters(t, W, H, pin, pout);
  }

  const block = renderText(t, frameW, frameH);
  const ctx = scratchCanvas(W, H);
  const p = ease('ease', pin);
  let alpha = 1, sx = 1, sy = 1, dx = 0, dy = 0, blur = 0;
  let clipW: number | null = null;

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
      default: break;
    }
  }

  ctx.save();
  if (clipW !== null) { ctx.beginPath(); ctx.rect(0, 0, Math.max(0, clipW), H); ctx.clip(); }
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (blur > 0.2) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.translate(W / 2 + dx, H / 2 + dy);
  ctx.scale(Math.max(0.001, sx), Math.max(0.001, sy));
  ctx.drawImage(block, -W / 2, -H / 2, W, H);
  ctx.restore();
  return { canvas: scratch!, w: W, h: H, mode: 'frame' };
}

function applyExit(block: HTMLCanvasElement, t: TextProps, W: number, H: number, pout: number): TextFrame {
  if (pout <= 0) return { canvas: block, w: W, h: H, mode: 'frame' };
  // Reuse the main path's exit handling by temporarily treating the block as "entered".
  const tt: TextProps = { ...t, animation: 'none' };
  const ctx = scratchCanvas(W, H);
  ctx.save();
  const q = ease('ease', pout);
  let alpha = 1, s = 1, dx = 0, dy = 0, blur = 0;
  switch (tt.exitAnimation) {
    case 'fade': alpha = 1 - q; break;
    case 'slide-left': dx = -q * W; break;
    case 'slide-right': dx = q * W; break;
    case 'slide-up': dy = -q * H; break;
    case 'slide-down': dy = q * H; break;
    case 'zoom-out': s = 1 - 0.8 * q; alpha = 1 - q; break;
    case 'zoom-in': s = 1 + 1.5 * q; alpha = 1 - q; break;
    case 'blur-out': blur = q * 30; alpha = 1 - q; break;
    case 'wipe': ctx.beginPath(); ctx.rect(0, 0, (1 - q) * W, H); ctx.clip(); break;
  }
  ctx.globalAlpha = alpha;
  if (blur > 0.2) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.translate(W / 2 + dx, H / 2 + dy);
  ctx.scale(s, s);
  ctx.drawImage(block, -W / 2, -H / 2, W, H);
  ctx.restore();
  return { canvas: scratch!, w: W, h: H, mode: 'frame' };
}

/** Letter-by-letter entrance: each character drops in with a stagger. */
function renderLetters(t: TextProps, W: number, H: number, pin: number, pout: number): TextFrame {
  const L = layout(t, W);
  const ctx = scratchCanvas(W, H);
  const blockY = (H - L.blockH) / 2;
  drawBackground(ctx, t, L, blockY);
  setupText(ctx, t);
  ctx.textAlign = 'left';
  const total = L.lines.reduce((n, l) => n + l.length, 0) || 1;
  let index = 0;
  L.lines.forEach((line, li) => {
    const y = blockY + L.pad + L.lineH * li + L.lineH / 2;
    const lineW = ctx.measureText(line).width;
    let x = t.align === 'left' ? L.blockX + L.pad : t.align === 'right' ? L.blockX + L.blockW - L.pad - lineW : L.blockX + (L.blockW - lineW) / 2;
    for (const ch of line) {
      const w = ctx.measureText(ch).width;
      // each letter animates over a window of the total progress
      const startP = (index / total) * 0.7;
      const lp = Math.min(1, Math.max(0, (pin - startP) / 0.3));
      if (lp > 0) {
        const e = ease('ease', lp);
        ctx.save();
        ctx.globalAlpha = e * (1 - pout);
        ctx.translate(0, (1 - e) * -t.fontSize * 0.8);
        drawLine(ctx, t, ch, x, y);
        ctx.restore();
      }
      x += w;
      index++;
    }
  });
  return { canvas: scratch!, w: W, h: H, mode: 'frame' };
}

/** Star Wars style opening crawl: lines recede into the distance as they scroll up. */
function renderCrawl(t: TextProps, W: number, H: number, localT: number, duration: number): TextFrame {
  const L = layout(t, W);
  const ctx = scratchCanvas(W, H);
  const p = duration > 0 ? localT / duration : 0;
  const totalH = L.lines.length * L.lineH;
  // the block travels from below the frame to far beyond the top
  const travel = H + totalH * 1.1;
  const top0 = H - p * travel;
  const horizon = H * 0.12; // where the text vanishes

  setupText(ctx, t);
  ctx.textAlign = 'center';
  L.lines.forEach((line, i) => {
    const yLinear = top0 + i * L.lineH + L.lineH / 2;          // where the line would be without perspective
    if (yLinear > H + L.lineH || yLinear < horizon) return;
    const depth = Math.min(1, Math.max(0, (H - yLinear) / (H - horizon)));   // 0 at bottom, 1 at horizon
    const persp = 1 - depth;                                                 // perspective factor
    const scale = 0.18 + 0.82 * Math.pow(persp, 1.4);
    const y = horizon + (H * 1.08 - horizon) * Math.pow(persp, 1.25);        // compress distance towards the horizon
    const alpha = Math.min(1, Math.max(0, (1 - depth) * 1.6)) * (depth > 0.9 ? (1 - depth) * 10 : 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, y);
    ctx.scale(scale, scale);
    drawLine(ctx, t, line, 0, 0);
    ctx.restore();
  });
  return { canvas: scratch!, w: W, h: H, mode: 'frame' };
}

export const FONT_CHOICES = [
  'Segoe UI', 'Arial', 'Arial Black', 'Impact', 'Georgia', 'Times New Roman', 'Trebuchet MS',
  'Verdana', 'Tahoma', 'Courier New', 'Consolas', 'Comic Sans MS', 'Palatino Linotype', 'Garamond',
  'Franklin Gothic Medium', 'Bahnschrift', 'Cambria', 'Candara', 'Calibri', 'Lucida Console',
  'Segoe Script', 'Segoe Print', 'Book Antiqua', 'Century Gothic', 'Copperplate Gothic Bold', 'Rockwell',
];
