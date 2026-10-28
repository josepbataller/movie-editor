import type { TextProps, TextAnimation, TextExitAnimation } from '@/shared/types';
import { ease } from './animation';
import { drawBackdrop } from './backdrops';
import { drawLamp, lampChoreography, pickLampTarget } from './lamp';
import { renderStudios, renderGlobe, renderMonument, renderRibbons } from './logoRenderers';

// Text rendering for titles / credits.
//
//  renderText(t, W, H)                      -> static layout ("block") canvas, cached.
//  renderTextFrame(t, W, H, localT, dur)    -> the frame to draw at a given moment, with the
//                                              animated backdrop and entrance / exit animations.
//
// Both the live preview and the frame-by-frame exporter use these, so the output
// matches exactly. 'scroll-up' without a backdrop returns the block canvas (its motion
// is applied by the compositor / by an FFmpeg overlay expression in the fast export path).
//
// Letter styling (fill gradients, 3D extrusion, outline, glow, shadow) lives in drawLine so
// every renderer — static block, per-letter staggers, masks — looks the same.

const cache = new Map<string, HTMLCanvasElement>();
/** Drop cached static renders (after a font file finishes loading). */
export function clearTextCache() { cache.clear(); }

export function fontString(t: TextProps, size = t.fontSize): string {
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

export interface Layout {
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

export function layout(t: TextProps, frameW: number, content = t.content): Layout {
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

export function setupText(ctx: CanvasRenderingContext2D, t: TextProps) {
  ctx.font = fontString(t);
  ctx.letterSpacing = `${t.letterSpacing || 0}px`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = t.align;
}

const RAINBOW = ['#ff3b3b', '#ff9f1c', '#ffe14d', '#3ddc84', '#2ec4ff', '#7a5cff', '#ff4fd8'];
const METALS: Record<string, [number, string][]> = {
  gold: [[0, '#fff2b0'], [0.45, '#f6c343'], [0.5, '#a66f00'], [0.6, '#f9d976'], [1, '#c58a00']],
  silver: [[0, '#ffffff'], [0.45, '#cfd3d8'], [0.5, '#6f767e'], [0.6, '#e6e9ec'], [1, '#9aa1a8']],
  chrome: [[0, '#e9f3ff'], [0.48, '#6a7f99'], [0.5, '#1d2a3a'], [0.55, '#dfe9f5'], [1, '#3a4b61']],
  fire: [[0, '#fff5a0'], [0.4, '#ffb000'], [0.75, '#ff4500'], [1, '#7a0000']],
  ice: [[0, '#ffffff'], [0.5, '#bfefff'], [1, '#3aa0ff']],
};

/** Fill for one line of text at (x, y): solid colour or a vertical/horizontal gradient. */
function fillStyleFor(ctx: CanvasRenderingContext2D, t: TextProps, line: string, x: number, y: number, extent?: { x0: number; w: number }): string | CanvasGradient {
  const f = t.fill ?? 'solid';
  if (f === 'solid') return t.color;
  if (f === 'rainbow') {
    const w = extent ? extent.w : Math.max(1, ctx.measureText(line).width);
    const x0 = extent ? extent.x0 : ctx.textAlign === 'left' ? x : ctx.textAlign === 'right' ? x - w : x - w / 2;
    const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    RAINBOW.forEach((c, i) => g.addColorStop(i / (RAINBOW.length - 1), c));
    return g;
  }
  const half = t.fontSize / 2;
  const g = ctx.createLinearGradient(0, y - half, 0, y + half);
  const stops: [number, string][] = f === 'gradient' ? [[0, t.color], [1, t.fillColor2 ?? '#888888']] : METALS[f] ?? [[0, t.color], [1, t.color]];
  for (const [p, c] of stops) g.addColorStop(p, c);
  return g;
}

export function drawLine(ctx: CanvasRenderingContext2D, t: TextProps, line: string, x: number, y: number, extent?: { x0: number; w: number }) {
  const glow = t.glow ?? 0;
  if (glow > 0) {
    // neon: a few blurred passes of the glow colour underneath
    ctx.save();
    ctx.shadowColor = t.glowColor ?? t.color;
    ctx.fillStyle = t.glowColor ?? t.color;
    for (const k of [2.2, 1.2, 0.5]) { ctx.shadowBlur = t.fontSize * k * glow; ctx.fillText(line, x, y); }
    ctx.restore();
  }
  const depth = Math.round(t.extrude ?? 0);
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
  if (depth > 0) {
    // 3D extrusion: stacked copies going down-right; only the deepest one casts the shadow
    ctx.fillStyle = t.extrudeColor ?? '#222222';
    ctx.fillText(line, x + depth * 0.7, y + depth);
    ctx.shadowColor = 'transparent';
    for (let i = depth - 1; i >= 1; i--) ctx.fillText(line, x + i * 0.7, y + i);
  }
  if (t.outline) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, t.fontSize * (t.outlineWidth ?? 0.06));
    ctx.strokeStyle = t.outline;
    ctx.strokeText(line, x, y);
  }
  ctx.fillStyle = fillStyleFor(ctx, t, line, x, y, extent);
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

export function drawBackground(ctx: CanvasRenderingContext2D, t: TextProps, L: Layout, y: number) {
  if (!t.background) return;
  ctx.fillStyle = t.background;
  ctx.beginPath();
  ctx.roundRect(L.blockX, y, L.blockW, L.blockH, Math.min(16, L.pad));
  ctx.fill();
}

const hasBackdrop = (t: TextProps) => !!t.backdrop && t.backdrop !== 'none';
/** Top of the (frame-mode) text block: centred, shifted by offsetY. */
export const blockTop = (t: TextProps, frameH: number, L: Layout) => (frameH - L.blockH) / 2 + (t.offsetY ?? 0) * frameH;

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
  const blockY = tall ? t.fontSize / 2 : blockTop(t, frameH, L);

  drawBackground(ctx, t, L, blockY);
  setupText(ctx, t);
  L.lines.forEach((line, i) => drawLayoutLine(ctx, t, L, line, blockY + L.pad + L.lineH * i + L.lineH / 2));

  if (cache.size > 60) cache.delete(cache.keys().next().value!);
  cache.set(key, canvas);
  return canvas;
}

export interface TextFrame { canvas: HTMLCanvasElement; w: number; h: number; mode: 'frame' | 'block' }

// Scratch canvases reused for every animated frame (avoid allocating per frame):
// 'main' is the returned frame, the others are intermediate layers (masks, partial renders).
const layers = new Map<string, HTMLCanvasElement>();
export function layer(name: string, w: number, h: number): CanvasRenderingContext2D {
  let c = layers.get(name);
  if (!c) { c = document.createElement('canvas'); layers.set(name, c); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d')!;
  resetContext(ctx, w, h);
  return ctx;
}
export const scratchCanvas = (w: number, h: number) => layer('main', w, h);
export const frameOf = (ctx: CanvasRenderingContext2D, W: number, H: number): TextFrame => ({ canvas: ctx.canvas, w: W, h: H, mode: 'frame' });

function resetContext(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // reset() also drops any clip region left by a previous frame
  if (typeof (ctx as any).reset === 'function') (ctx as any).reset();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = 'transparent';
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, w, h);
}

/** Uncached frame-sized render of (possibly modified) props: typewriter partials, tracking changes. */
function renderPartial(t: TextProps, frameW: number, frameH: number, content: string): HTMLCanvasElement {
  const W = Math.round(frameW), H = Math.round(frameH);
  const ctx = layer('partial', W, H);
  const L = layout(t, frameW, content);
  const blockY = blockTop(t, frameH, L);
  drawBackground(ctx, t, L, blockY);
  setupText(ctx, t);
  L.lines.forEach((line, i) => drawLayoutLine(ctx, t, L, line, blockY + L.pad + L.lineH * i + L.lineH / 2));
  return ctx.canvas;
}

/** Deterministic pseudo-random in [0,1) from two integers (per-letter directions, flicker). */
const hash = (a: number, b: number) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };

const STAGGER_IN: TextAnimation[] = ['letters', 'rise', 'words', 'elastic-letters', 'scatter-in', 'flip-letters'];
const STAGGER_OUT: TextExitAnimation[] = ['scatter', 'letters-out'];

/** The text clip at local time `localT` of a clip lasting `duration` seconds. */
export function renderTextFrame(t: TextProps, frameW: number, frameH: number, localT: number, duration: number): TextFrame {
  const W = Math.round(frameW), H = Math.round(frameH);
  const bd = hasBackdrop(t);

  if (t.animation === 'scroll-up' && !bd) {
    const c = renderText(t, frameW, frameH);
    return { canvas: c, w: c.width, h: c.height, mode: 'block' };
  }
  if (t.animation === 'crawl') return renderCrawl(t, W, H, localT, duration);
  if (t.animation === 'lamp') return renderLamp(t, W, H, localT, duration);
  if (t.animation === 'studios') return renderStudios(t, W, H, localT, duration);
  if (t.animation === 'globe') return renderGlobe(t, W, H, localT, duration);
  if (t.animation === 'monument') return renderMonument(t, W, H, localT, duration);
  if (t.animation === 'ribbons') return renderRibbons(t, W, H, localT, duration);

  const D = Math.max(0.01, Math.min(t.animationDuration, duration));
  const E = Math.max(0.01, Math.min(t.exitDuration, duration));
  const pin = t.animation === 'none' || t.animation === 'scroll-up' ? 1 : Math.min(1, localT / D); // entrance progress 0..1
  const pout = t.exitAnimation === 'none' ? 0 : Math.min(1, Math.max(0, (localT - (duration - E)) / E)); // exit progress 0..1
  const isScroll = t.animation === 'scroll-up';

  // Progressive / per-letter animations draw their own content.
  if (t.animation === 'typewriter' && pin < 1) {
    const n = Math.floor(t.content.length * pin);
    const partial = t.content.slice(0, n) + (Math.floor(localT * 3) % 2 === 0 ? '|' : ' ');
    return applyExit(renderPartial(t, frameW, frameH, partial), t, W, H, pout, localT);
  }
  const perLetterOk = t.layout !== 'two-column'; // eachChar lays out plain lines only
  if (perLetterOk && STAGGER_IN.includes(t.animation) && pin < 1) return renderStagger(t, W, H, t.animation, pin, localT, 1 - pout);
  if (perLetterOk && STAGGER_OUT.includes(t.exitAnimation) && pout > 0 && !isScroll) return renderStagger(t, W, H, t.exitAnimation, pout, localT, 1);
  if (perLetterOk && t.animation === 'wave') return renderWave(t, W, H, localT, pin, pout);
  if (t.animation === 'marvel' && pin < 1) return renderMarvel(t, W, H, pin, localT);

  let block: HTMLCanvasElement = renderText(t, frameW, frameH);
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  const p = ease('ease', pin);
  const q = ease('ease', pout);
  let alpha = 1, sx = 1, sy = 1, dx = 0, dy = 0, blur = 0, rot = 0, pivotY = 0, hue = 0, pixel = 0;
  let clipW: number | null = null;
  let clipRects: [number, number, number, number][] | null = null;
  let glitch = 0;
  let mask: CanvasImageSource | null = null; // replaces the block when a light mask is applied
  const post: (() => void)[] = [];           // overlays drawn after the text, in frame coordinates
  const fs = t.fontSize;

  // tracking (letter spacing) changes need a re-layout, so the block is re-rendered uncached
  if (!isScroll && t.animation === 'tracking-in' && pin < 1) block = renderPartial({ ...t, letterSpacing: t.letterSpacing + (1 - p) * fs * 0.35 }, frameW, frameH, t.content);
  else if (!isScroll && t.exitAnimation === 'tracking-out' && pout > 0) block = renderPartial({ ...t, letterSpacing: t.letterSpacing + q * fs * 0.35 }, frameW, frameH, t.content);

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
    case 'tracking-in': alpha = p; break;
    case 'bounce-in': dy = -(1 - ease('bounce', pin)) * H * 0.8; alpha = Math.min(1, pin * 4); break;
    case 'stamp': {
      // slams down from huge to normal, then shakes off the impact
      if (pin < 0.5) { const k = 1 - pin / 0.5; sx = sy = 1 + 2.5 * k * k; alpha = 1 - k * 0.6; }
      else { const k = 1 - (pin - 0.5) / 0.5; dx = Math.sin(localT * 70) * k * W * 0.008; dy = Math.cos(localT * 55) * k * H * 0.01; }
      break;
    }
    case 'swing': rot = Math.sin(pin * Math.PI * 3) * (1 - pin) * 0.5; pivotY = -H * 0.45; alpha = Math.min(1, pin * 3); break;
    case 'focus': blur = (1 - p) * 18; sx = sy = 1.3 - 0.3 * p; alpha = p; break;
    case 'flicker': alpha = pin >= 1 ? 1 : hash(Math.floor(localT * 24), 3) < 0.25 + pin * 0.8 ? 1 : 0.08; break;
    case 'blinds': { const n = 8, h = H / n; clipRects = Array.from({ length: n }, (_, i) => [0, i * h, W, h * p]); break; }
    case 'split': clipRects = [[(W - p * W) / 2, 0, p * W, H]]; alpha = Math.min(1, p * 3); break;
    case 'pixelate': pixel = 1 + (1 - p) * 40; alpha = Math.min(1, p * 3); break;
    case 'shine': alpha = Math.min(1, pin * 3); break;
    case 'rainbow': hue = localT * 120; alpha = p; break;
    case 'pulse': sx = sy = 1 + 0.05 * Math.sin(localT * Math.PI * 4); alpha = p; break;
    case 'sparkle': alpha = p; break;
    case 'spotlight': {
      if (pin >= 1) break; // entrance over: plain text, no halo
      // a light hops along the text and only reveals what it touches, then opens up
      const lx = W * (0.12 + 0.76 * p), ly = H / 2 + (t.offsetY ?? 0) * H - Math.abs(Math.sin(p * Math.PI * 3)) * fs * 1.2;
      const r = fs * 1.3 * (1 + (pin > 0.8 ? Math.pow((pin - 0.8) / 0.2, 2) * 12 : 0));
      const halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, r * 1.6);
      halo.addColorStop(0, 'rgba(255,250,230,0.28)'); halo.addColorStop(1, 'rgba(255,250,230,0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
      const m = layer('fx', W, H);
      m.drawImage(block, 0, 0);
      m.globalCompositeOperation = 'destination-in';
      const g = m.createRadialGradient(lx, ly, r * 0.6, lx, ly, r);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = g; m.fillRect(0, 0, W, H);
      mask = m.canvas;
      break;
    }
    case 'scroll-up': {
      // credits with a backdrop: same motion as the compositor's block mode
      const blockH = block.height;
      dy = (H - (localT * (H + blockH)) / Math.max(0.01, duration) + blockH / 2) - H / 2;
      break;
    }
    default: break;
  }

  if (t.animation === 'shine' && pin < 1) {
    // glossy light band sweeping diagonally across the letters
    post.push(() => {
      const m = layer('fx', W, H);
      const x0 = (p * 1.8 - 0.4) * W, band = W * 0.18;
      const g = m.createLinearGradient(x0 - band, 0, x0 + band, H * 0.6);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      m.fillStyle = g; m.fillRect(0, 0, W, H);
      m.globalCompositeOperation = 'destination-in';
      m.drawImage(block, 0, 0);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.9; ctx.drawImage(m.canvas, 0, 0); ctx.restore();
    });
  }
  if (t.animation === 'sparkle' && localT < D + 0.6) {
    // a comet of sparkles traces an arc over the title (fairy-dust style)
    post.push(() => {
      const prog = Math.min(1, localT / (D + 0.4));
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 28; k++) {
        const pp = prog - k * 0.012;
        if (pp < 0) continue;
        const a = Math.PI - pp * Math.PI;
        const x = W / 2 + Math.cos(a) * W * 0.42 + (hash(k, 1) - 0.5) * k * 3, y = H * 0.62 - Math.sin(a) * H * 0.48 + (hash(k, 2) - 0.5) * k * 3;
        const fadeOut = Math.max(0, 1 - (localT - D) / 0.6);
        const tw = 0.5 + 0.5 * Math.sin(localT * 20 + k);
        ctx.fillStyle = `rgba(255,${235 - k * 3},${170 + k * 2},${(1 - k / 30) * tw * fadeOut})`;
        const r = (k === 0 ? fs * 0.22 : fs * 0.11 * (1 - k / 30)) * (0.7 + 0.3 * tw);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const ang = (i / 8) * Math.PI * 2 - Math.PI / 2; const rr = i % 2 === 0 ? r : r * 0.4; ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr); }
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    });
  }

  if (pout > 0) {
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
      case 'tracking-out': alpha *= 1 - q; break;
      case 'pixelate-out': pixel = Math.max(pixel, 1 + q * 40); alpha *= 1 - q * q; break;
      case 'blinds-out': { const n = 8, h = H / n; clipRects = Array.from({ length: n }, (_, i) => [0, i * h, W, h * (1 - q)]); break; }
      case 'split-out': clipRects = [[(W - (1 - q) * W) / 2, 0, (1 - q) * W, H]]; alpha *= Math.min(1, (1 - q) * 3); break;
      case 'spin-out': rot += q * Math.PI * 2; sx *= 1 - q; sy *= 1 - q; alpha *= 1 - q; break;
      case 'drop-out': dy += pout * pout * H * 1.3; rot += pout * 0.35; break;
      case 'flicker-out': alpha *= hash(Math.floor(localT * 24), 5) < 1.05 - q ? 1 - q * 0.5 : 0.05; break;
      default: break;
    }
  }

  let img: CanvasImageSource = mask ?? block;
  if (pixel > 1.5) {
    // pixelation: shrink to a tiny canvas and scale back up without smoothing
    const pw = Math.max(1, Math.round(W / pixel)), ph = Math.max(1, Math.round(block.height / pixel));
    const sm = layer('px', pw, ph);
    sm.drawImage(img, 0, 0, pw, ph);
    img = sm.canvas;
  }
  const drawBlock = (ox = 0, oy = 0) => {
    if (isScroll) ctx.drawImage(img, -W / 2 + ox, -block.height / 2 + oy, W, block.height);
    else ctx.drawImage(img, -W / 2 + ox, -H / 2 + oy, W, H);
  };
  ctx.save();
  if (clipW !== null) { ctx.beginPath(); ctx.rect(0, 0, Math.max(0, clipW), H); ctx.clip(); }
  if (clipRects) { ctx.beginPath(); for (const [x, y, w, h] of clipRects) ctx.rect(x, y, Math.max(0, w), Math.max(0, h)); ctx.clip(); }
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  const filters: string[] = [];
  if (blur > 0.2) filters.push(`blur(${blur.toFixed(1)}px)`);
  if (hue) filters.push(`hue-rotate(${hue.toFixed(0)}deg)`);
  if (filters.length) ctx.filter = filters.join(' ');
  if (pixel > 1.5) ctx.imageSmoothingEnabled = false;
  ctx.translate(W / 2 + dx, H / 2 + dy);
  if (rot) { ctx.translate(0, pivotY); ctx.rotate(rot); ctx.translate(0, -pivotY); }
  ctx.scale(Math.max(0.001, sx), Math.max(0.001, sy));
  if (glitch > 0.02) {
    // RGB split + horizontal slice jitter, driven by a time-seeded pseudo random
    const seed = Math.floor(localT * 30);
    const jit = (k: number) => hash(seed, k);
    const amt = glitch * W * 0.03;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.filter = `${ctx.filter === 'none' ? '' : ctx.filter} hue-rotate(-60deg) saturate(3)`; drawBlock((jit(1) - 0.5) * amt * 2, 0);
    ctx.filter = `hue-rotate(120deg) saturate(3)`; drawBlock((jit(2) - 0.5) * amt * 2, 0);
    ctx.restore();
    for (let i = 0; i < 6; i++) {
      if (jit(10 + i) > glitch * 0.9) continue;
      const y = (jit(20 + i) - 0.5) * H, h = 6 + jit(30 + i) * 40;
      ctx.save(); ctx.beginPath(); ctx.rect(-W, y, 2 * W, h); ctx.clip(); drawBlock((jit(40 + i) - 0.5) * amt * 4, 0); ctx.restore();
    }
    ctx.globalAlpha *= 0.85;
  }
  drawBlock();
  ctx.restore();
  for (const fn of post) fn();
  return frameOf(ctx, W, H);
}

function applyExit(block: HTMLCanvasElement, t: TextProps, W: number, H: number, pout: number, localT: number): TextFrame {
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  ctx.save();
  const q = ease('ease', pout);
  let alpha = 1, s = 1, sx = 1, dx = 0, dy = 0, blur = 0;
  if (pout > 0) {
    switch (t.exitAnimation) {
      case 'fade': case 'tracking-out': case 'letters-out': case 'scatter': alpha = 1 - q; break;
      case 'slide-left': dx = -q * W; break;
      case 'slide-right': dx = q * W; break;
      case 'slide-up': dy = -q * H; break;
      case 'slide-down': case 'drop-out': dy = q * H; break;
      case 'zoom-out': s = 1 - 0.8 * q; alpha = 1 - q; break;
      case 'zoom-in': s = 1 + 1.5 * q; alpha = 1 - q; break;
      case 'blur-out': blur = q * 30; alpha = 1 - q; break;
      case 'flip-out': sx = Math.max(0.001, Math.cos(q * Math.PI / 2)); break;
      case 'spin-out': s = 1 - q; alpha = 1 - q; break;
      case 'wipe': case 'split-out': case 'blinds-out': ctx.beginPath(); ctx.rect(0, 0, (1 - q) * W, H); ctx.clip(); break;
      case 'glitch': case 'flicker-out': alpha = 1 - q * 0.6; dx = (Math.sin(localT * 90) * q * W) / 40; break;
      case 'pixelate-out': alpha = 1 - q * q; break;
    }
  }
  ctx.globalAlpha = alpha;
  if (blur > 0.2) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.translate(W / 2 + dx, H / 2 + dy);
  ctx.scale(s * sx, s);
  ctx.drawImage(block, -W / 2, -H / 2, W, H);
  ctx.restore();
  return frameOf(ctx, W, H);
}

export interface CharInfo { ch: string; x: number; y: number; w: number; i: number; total: number; word: number; words: number; line: { x0: number; w: number } }

/** Per-character layout helper: calls fn for every character with its position, index and word index. */
export function eachChar(ctx: CanvasRenderingContext2D, t: TextProps, L: Layout, H: number, fn: (c: CharInfo) => void) {
  const blockY = blockTop(t, H, L);
  setupText(ctx, t);
  ctx.textAlign = 'left';
  const total = L.lines.reduce((n, l) => n + l.length, 0) || 1;
  const words = Math.max(1, L.lines.reduce((n, l) => n + (l.trim() ? l.trim().split(/\s+/).length : 0), 0));
  let index = 0, word = 0;
  L.lines.forEach((line, li) => {
    const y = blockY + L.pad + L.lineH * li + L.lineH / 2;
    const lineW = ctx.measureText(line).width;
    let x = t.align === 'left' ? L.blockX + L.pad : t.align === 'right' ? L.blockX + L.blockW - L.pad - lineW : L.blockX + (L.blockW - lineW) / 2;
    const lineExtent = { x0: x, w: Math.max(1, lineW) };
    let inWord = false;
    for (const ch of line) {
      const w = ctx.measureText(ch).width;
      if (/\s/.test(ch)) { if (inWord) word++; inWord = false; } else inWord = true;
      fn({ ch, x, y, w, i: index, total, word: Math.min(word, words - 1), words, line: lineExtent });
      x += w; index++;
    }
    if (inWord) word++;
  });
  return blockY;
}

/**
 * Staggered per-letter (or per-word) entrances and exits: each unit starts a little after
 * the previous one and plays its own short move. `prog` is the entrance or exit progress.
 */
function renderStagger(t: TextProps, W: number, H: number, mode: TextAnimation | TextExitAnimation, prog: number, localT: number, alphaMul: number): TextFrame {
  const L = layout(t, W);
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  drawBackground(ctx, t, L, blockTop(t, H, L));
  const fs = t.fontSize;
  const exiting = mode === 'scatter' || mode === 'letters-out';
  const byWord = mode === 'words';
  eachChar(ctx, t, L, H, (c) => {
    const unit = byWord ? c.word / c.words : c.i / c.total;
    const lp = Math.min(1, Math.max(0, (prog - unit * 0.7) / 0.3));
    if (!exiting && lp <= 0) return;
    if (exiting && lp >= 1) return;
    const e = ease(mode === 'rise' ? 'bounce' : mode === 'elastic-letters' || mode === 'words' ? 'elastic' : 'ease', lp);
    const cx = c.x + c.w / 2, cy = c.y;
    ctx.save();
    ctx.globalAlpha = alphaMul * (exiting ? 1 - lp : Math.min(1, lp * 2));
    switch (mode) {
      case 'letters': ctx.translate(0, (1 - e) * -fs * 0.8); break;
      case 'rise': ctx.translate(0, (1 - e) * fs * 1.2); ctx.translate(cx, cy); ctx.rotate((1 - e) * 0.4); ctx.translate(-cx, -cy); break;
      case 'words': case 'elastic-letters': ctx.translate(cx, cy); ctx.scale(Math.max(0.001, e), Math.max(0.001, e)); ctx.translate(-cx, -cy); break;
      case 'scatter-in': {
        const a = hash(c.i, 7) * Math.PI * 2, d = (1 - e) * W * 0.5;
        ctx.translate(Math.cos(a) * d, Math.sin(a) * d); ctx.translate(cx, cy); ctx.rotate((1 - e) * (hash(c.i, 8) - 0.5) * 6); ctx.translate(-cx, -cy); break;
      }
      case 'flip-letters': ctx.translate(cx, cy); ctx.scale(Math.max(0.001, Math.cos((1 - e) * Math.PI / 2)), 1); ctx.translate(-cx, -cy); break;
      case 'scatter': {
        const a = hash(c.i, 7) * Math.PI * 2, d = e * W * 0.6;
        ctx.translate(Math.cos(a) * d, Math.sin(a) * d - e * e * H * 0.3); ctx.translate(cx, cy); ctx.rotate(e * (hash(c.i, 8) - 0.5) * 8); ctx.translate(-cx, -cy); break;
      }
      case 'letters-out': ctx.translate(0, lp * lp * fs * 1.6); ctx.translate(cx, cy); ctx.rotate(lp * (hash(c.i, 9) - 0.5) * 1.2); ctx.translate(-cx, -cy); break;
    }
    drawLine(ctx, t, c.ch, c.x, c.y, c.line);
    ctx.restore();
  });
  return frameOf(ctx, W, H);
}

/** Letters bob on a sine wave for the whole clip (entrance fades in, exit fades out). */
function renderWave(t: TextProps, W: number, H: number, localT: number, pin: number, pout: number): TextFrame {
  const L = layout(t, W);
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  drawBackground(ctx, t, L, blockTop(t, H, L));
  ctx.globalAlpha = Math.min(1, pin * 2) * (1 - pout);
  eachChar(ctx, t, L, H, (c) => {
    const dy = Math.sin(localT * 4 + c.i * 0.5) * t.fontSize * 0.18;
    drawLine(ctx, t, c.ch, c.x, c.y + dy, c.line);
  });
  return frameOf(ctx, W, H);
}

/**
 * Comic-studio logo: the camera starts inside the letters, which are filled with fast
 * flipping comic pages on a white page; it pulls back to reveal the word, then the pages
 * freeze to the brand colour (backdropColor) with the letters in the text colour.
 */
function renderMarvel(t: TextProps, W: number, H: number, pin: number, localT: number): TextFrame {
  const red = t.backdropColor ?? '#ec1d24', white = t.backdropColor2 ?? '#ffffff';
  const ctx = scratchCanvas(W, H);
  const maskProps: TextProps = { ...t, color: '#ffffff', fill: 'solid', glow: 0, shadow: false, outline: '', extrude: 0, background: '' };
  const pa = Math.min(1, pin / 0.72), pb = Math.max(0, (pin - 0.72) / 0.28);
  const zoom = 1 + 3.2 * Math.pow(1 - pa, 2);
  // the comic pages seen through the letter shapes (pattern first, then cut by the text mask:
  // Chromium treats an opaque full-canvas fillRect under 'source-in' as a clear, so never do it that way round)
  const m = layer('fx', W, H);
  drawBackdrop(m, 'comicflip', W, H, localT * (1 - pb * 0.8), red, red);
  m.globalCompositeOperation = 'destination-in';
  m.drawImage(renderText(maskProps, W, H), 0, 0);
  // page: white, turning to red while the pages freeze
  ctx.fillStyle = white; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = red; ctx.globalAlpha = pb; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.save();
  const cy = H / 2 + (t.offsetY ?? 0) * H;
  ctx.translate(W / 2, cy); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -cy + (1 - pa) * t.fontSize * 0.1);
  ctx.globalAlpha = 1 - pb;
  ctx.drawImage(m.canvas, 0, 0);
  ctx.globalAlpha = pb;
  ctx.drawImage(renderText(t, W, H), 0, 0);
  ctx.restore();
  // a soft white flash at the moment the pages freeze
  const flash = Math.max(0, 1 - Math.abs(pin - 0.72) / 0.08);
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.6})`; ctx.fillRect(0, 0, W, H); }
  return frameOf(ctx, W, H);
}

/**
 * Desk-lamp logo (Pixar style): the word is on screen, the lamp hops in from the right,
 * flattens one letter with a few bounces, takes its place, looks at the camera and switches
 * off. The choreography spans animationDuration; afterwards the final pose holds. Exits are
 * applied as a fade of the text + lamp.
 */
function renderLamp(t: TextProps, W: number, H: number, localT: number, duration: number): TextFrame {
  const L = layout(t, W);
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  const D = Math.max(2, Math.min(t.animationDuration, duration));
  const E = Math.max(0.01, Math.min(t.exitDuration, duration));
  const pout = t.exitAnimation === 'none' ? 0 : Math.min(1, Math.max(0, (localT - (duration - E)) / E));
  const chars: CharInfo[] = [];
  eachChar(ctx, t, L, H, (c) => chars.push(c));
  const ti = pickLampTarget(chars);
  const fs = t.fontSize, unit = fs * 0.52;
  const target = ti >= 0 ? chars[ti] : null;
  const ground = (target ? target.y : H / 2) + fs * 0.35, letterH = fs * 0.7;
  const xT = target ? target.x + target.w / 2 : W / 2;
  const st = lampChoreography(localT / D, W + unit * 1.2, xT, ground, letterH, unit);

  ctx.globalAlpha = 1 - ease('ease', pout);
  drawBackground(ctx, t, L, blockTop(t, H, L));
  setupText(ctx, t);
  ctx.textAlign = 'left';
  for (const c of chars) {
    if (c === target) {
      if (st.letterSy < 0.03) continue;
      // squash the letter towards its baseline
      ctx.save(); ctx.translate(xT, ground); ctx.scale(1, st.letterSy); ctx.translate(-xT, -ground);
      drawLine(ctx, t, c.ch, c.x, c.y, c.line); ctx.restore();
    } else drawLine(ctx, t, c.ch, c.x, c.y, c.line);
  }
  drawLamp(ctx, st);
  if (st.dark > 0) { ctx.fillStyle = 'rgba(0,0,0,' + (st.dark * 0.92).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
  ctx.globalAlpha = 1;
  return frameOf(ctx, W, H);
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
  return frameOf(ctx, W, H);
}

export const FONT_CHOICES = [
  'Segoe UI', 'Segoe UI Black', 'Arial', 'Arial Black', 'Impact', 'Georgia', 'Times New Roman', 'Trebuchet MS',
  'Verdana', 'Tahoma', 'Courier New', 'Consolas', 'Comic Sans MS', 'Palatino Linotype', 'Garamond',
  'Franklin Gothic Medium', 'Bahnschrift', 'Cambria', 'Candara', 'Calibri', 'Lucida Console',
  'Segoe Script', 'Segoe Print', 'Book Antiqua', 'Century Gothic', 'Copperplate Gothic Bold', 'Rockwell', 'Rockwell Extra Bold',
  // decorative fonts that ship with Windows / Office (fall back to Segoe UI when missing)
  'Bauhaus 93', 'Broadway', 'Brush Script MT', 'Castellar', 'Chiller', 'Cooper Black', 'Elephant', 'Engravers MT', 'Forte', 'Freestyle Script',
  'Gill Sans Ultra Bold', 'Goudy Stout', 'Harlow Solid Italic', 'Haettenschweiler', 'Imprint MT Shadow', 'Jokerman', 'Kunstler Script',
  'Lucida Calligraphy', 'Lucida Handwriting', 'Magneto', 'Matura MT Script Capitals', 'Mistral', 'Monotype Corsiva', 'Niagara Solid',
  'OCR A Extended', 'Old English Text MT', 'Onyx', 'Papyrus', 'Perpetua Titling MT', 'Playbill', 'Pristina', 'Ravie', 'Showcard Gothic',
  'Snap ITC', 'Stencil', 'Tempus Sans ITC', 'Viner Hand ITC', 'Vivaldi', 'Vladimir Script', 'Agency FB', 'Bernard MT Condensed', 'Britannic Bold',
  'Colonna MT', 'Felix Titling', 'Gigi', 'Ink Free', 'Algerian', 'Bookman Old Style', 'Centaur', 'Gabriola',
];
