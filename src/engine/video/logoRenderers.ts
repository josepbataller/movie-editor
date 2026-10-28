import type { TextProps } from '@/shared/types';
import { ease } from './animation';
import { drawBackdrop } from './backdrops';
import { drawLine, setupText, fontString, layer, scratchCanvas, frameOf, TextFrame } from './textRender';

// Studio-logo recreations that need their own geometry (not just a styled text block):
//  'studios'  — silver plate with the first word knocked out in the backdrop colour, the rest
//               in silver between two bars (Marvel Studios style)
//  'globe'    — chrome letters wrapping around a slowly turning planet (Universal style)
//  'monument' — gold 3D lines stacked on bronze tiers, slow camera settle (20th Century style)
// They are whole-clip renderers: the entrance plays over animationDuration, then the pose
// holds; exits are applied as a fade of the logo (the backdrop stays).

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const hash = (a: number, b: number) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };

function timing(t: TextProps, localT: number, duration: number) {
  const D = Math.max(1, Math.min(t.animationDuration, duration));
  const E = Math.max(0.01, Math.min(t.exitDuration, duration));
  const pout = t.exitAnimation === 'none' ? 0 : clamp01((localT - (duration - E)) / E);
  return { D, u: clamp01(localT / D), exitAlpha: 1 - ease('ease', pout) };
}

function silverGradient(ctx: CanvasRenderingContext2D, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#f6f8fa'); g.addColorStop(0.35, '#c9ced4'); g.addColorStop(0.5, '#8f979f'); g.addColorStop(0.65, '#dde1e6'); g.addColorStop(1, '#9aa1a8');
  return g;
}

/** Brushed-metal streaks over a rectangle (horizontal hairlines of random brightness). */
function brush(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  for (let yy = y; yy < y + h; yy += 2) {
    const v = hash(Math.round(yy), seed);
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.18})` : `rgba(0,0,0,${(0.5 - v) * 0.14})`;
    ctx.fillRect(x, yy, w, 1);
  }
}

function vignette(ctx: CanvasRenderingContext2D, W: number, H: number, strength: number) {
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------------------
// 'studios'
// ---------------------------------------------------------------------------

export function renderStudios(t: TextProps, W: number, H: number, localT: number, duration: number): TextFrame {
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  vignette(ctx, W, H, 0.6);
  const { u, exitAlpha } = timing(t, localT, duration);
  const p = ease('ease', u);
  const words = t.content.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? ' ', rest = words.slice(1).join(' ');
  const fs = t.fontSize;

  // build the logo on a layer in frame coordinates, centred on (W/2, H/2)
  const m = layer('fx', W, H);
  m.font = fontString(t); m.letterSpacing = `${t.letterSpacing || 0}px`; m.textBaseline = 'middle'; m.textAlign = 'left';
  const w1 = m.measureText(first).width, padX = fs * 0.14, plateW = w1 + padX * 2, plateH = fs * 0.98;
  const gap = fs * 0.16, w2 = rest ? m.measureText(rest).width : 0;
  const total = plateW + (rest ? gap + w2 : 0);
  const x0 = W / 2 - total / 2, cy = H / 2;
  // plate
  m.fillStyle = silverGradient(m, cy - plateH / 2, cy + plateH / 2);
  m.fillRect(x0, cy - plateH / 2, plateW, plateH);
  brush(m, x0, cy - plateH / 2, plateW, plateH, 3);
  // knock the first word out of the plate so the backdrop shows through
  m.globalCompositeOperation = 'destination-out';
  m.fillStyle = '#000'; m.fillText(first, x0 + padX, cy + fs * 0.02);
  m.globalCompositeOperation = 'source-over';
  m.lineWidth = Math.max(1, fs * 0.012); m.strokeStyle = 'rgba(40,20,20,0.55)';
  m.strokeText(first, x0 + padX, cy + fs * 0.02);
  if (rest) {
    // second word in silver, slightly taller, between two bars
    const x2 = x0 + plateW + gap;
    m.font = fontString(t, fs * 1.04);
    m.fillStyle = silverGradient(m, cy - plateH / 2, cy + plateH / 2);
    m.fillText(rest, x2, cy + fs * 0.02);
    const barH = fs * 0.055;
    m.fillRect(x2, cy - plateH / 2, w2, barH);
    m.fillRect(x2, cy + plateH / 2 - barH, w2, barH);
    m.fillStyle = 'rgba(0,0,0,0.25)'; m.fillRect(x2, cy - plateH / 2 + barH, w2, 1); m.fillRect(x2, cy + plateH / 2 - barH - 1, w2, 1);
  }
  // light sweep across the logo in the middle of the entrance
  if (u > 0.35 && u < 0.8) {
    const k = (u - 0.35) / 0.45;
    const b = layer('px', W, H);
    const sx = x0 - fs + k * (total + fs * 2), band = fs * 0.6;
    const g = b.createLinearGradient(sx - band, 0, sx + band, plateH);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    b.globalCompositeOperation = 'destination-in'; b.drawImage(m.canvas, 0, 0);
    m.globalCompositeOperation = 'lighter'; m.drawImage(b.canvas, 0, 0); m.globalCompositeOperation = 'source-over';
  }
  // slow settle from slightly larger, fade in
  const scale = 1.1 - 0.1 * p;
  ctx.save();
  ctx.globalAlpha = Math.min(1, u * 3) * exitAlpha;
  ctx.translate(W / 2, H / 2 + (t.offsetY ?? 0) * H); ctx.scale(scale, scale);
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = fs * 0.2; ctx.shadowOffsetY = fs * 0.06;
  ctx.drawImage(m.canvas, -W / 2, -H / 2);
  ctx.restore();
  return frameOf(ctx, W, H);
}

// ---------------------------------------------------------------------------
// 'globe'
// ---------------------------------------------------------------------------

interface Blob { lon: number; lat: number; r: number; k: number }
let continents: Blob[] | null = null;
function continentBlobs(): Blob[] {
  if (continents) return continents;
  const out: Blob[] = [];
  const clusters = [[-1.2, -0.5], [-0.9, 0.3], [0.2, -0.3], [0.6, 0.35], [1.6, -0.1], [2.6, 0.5], [-2.4, 0.1]];
  clusters.forEach(([lon, lat], ci) => {
    const n = 6 + (ci % 3);
    for (let i = 0; i < n; i++) out.push({ lon: lon + (hash(ci, i) - 0.5) * 0.9, lat: lat + (hash(ci, i + 50) - 0.5) * 0.5, r: 0.09 + hash(ci, i + 100) * 0.14, k: hash(ci, i + 150) });
  });
  return (continents = out);
}

function drawGlobe(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, time: number) {
  // sun behind the top-left limb
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const sun = ctx.createRadialGradient(cx - R * 0.55, cy - R * 0.8, 0, cx - R * 0.55, cy - R * 0.8, R * 1.1);
  sun.addColorStop(0, 'rgba(255,250,235,0.95)'); sun.addColorStop(0.15, 'rgba(255,230,190,0.55)'); sun.addColorStop(1, 'rgba(255,220,180,0)');
  ctx.fillStyle = sun; ctx.fillRect(cx - R * 2, cy - R * 2.5, R * 4, R * 3);
  const streak = ctx.createLinearGradient(cx - R * 2.2, 0, cx + R * 1.2, 0);
  streak.addColorStop(0, 'rgba(255,240,220,0)'); streak.addColorStop(0.4, 'rgba(255,240,220,0.35)'); streak.addColorStop(1, 'rgba(255,240,220,0)');
  ctx.fillStyle = streak; ctx.fillRect(cx - R * 2.2, cy - R * 0.82, R * 3.4, R * 0.04);
  // atmosphere
  const atm = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.22);
  atm.addColorStop(0, 'rgba(110,170,255,0.6)'); atm.addColorStop(1, 'rgba(110,170,255,0)');
  ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  const ocean = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.4, R * 0.1, cx, cy, R);
  ocean.addColorStop(0, '#3f86dc'); ocean.addColorStop(0.65, '#0f3b84'); ocean.addColorStop(1, '#04122e');
  ctx.fillStyle = ocean; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  // continents on a slowly turning sphere
  const rot = time * 0.1;
  for (const b of continentBlobs()) {
    const lon = b.lon + rot, cl = Math.cos(lon);
    if (cl <= 0.03) continue;
    const x = cx + R * Math.sin(lon) * Math.cos(b.lat), y = cy + R * Math.sin(b.lat);
    const rx = b.r * R * cl, ry = b.r * R * Math.cos(b.lat) * 0.85;
    const day = 0.35 + 0.65 * clamp01((cx - x) / R + 0.9);
    ctx.fillStyle = `rgba(${Math.round((90 + b.k * 70) * day)},${Math.round((130 + b.k * 40) * day)},${Math.round((60 + b.k * 30) * day)},0.95)`;
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2); ctx.fill();
  }
  // cloud wisps
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  for (let i = 0; i < 14; i++) {
    const lon = hash(i, 7) * Math.PI * 2 + time * 0.14, lat = (hash(i, 8) - 0.5) * 2.4;
    if (Math.cos(lon) <= 0.05) continue;
    ctx.beginPath(); ctx.ellipse(cx + R * Math.sin(lon) * Math.cos(lat), cy + R * Math.sin(lat), R * (0.12 + hash(i, 9) * 0.2) * Math.cos(lon), R * 0.035, 0, 0, Math.PI * 2); ctx.fill();
  }
  // night side + city lights
  const night = ctx.createLinearGradient(cx - R * 0.3, 0, cx + R, 0);
  night.addColorStop(0, 'rgba(0,0,20,0)'); night.addColorStop(1, 'rgba(0,0,20,0.85)');
  ctx.fillStyle = night; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  for (const b of continentBlobs()) {
    const lon = b.lon + rot, cl = Math.cos(lon);
    if (cl <= 0.1) continue;
    const x = cx + R * Math.sin(lon) * Math.cos(b.lat), y = cy + R * Math.sin(b.lat);
    if (x < cx + R * 0.15) continue;
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = `rgba(255,210,120,${0.4 + 0.5 * hash(k, b.k * 100)})`;
      ctx.fillRect(x + (hash(k, b.k * 10) - 0.5) * b.r * R * 1.4 * cl, y + (hash(k, b.k * 20) - 0.5) * b.r * R, 1.5, 1.5);
    }
  }
  // specular highlight
  const spec = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.5, 0, cx - R * 0.45, cy - R * 0.5, R * 0.7);
  spec.addColorStop(0, 'rgba(255,255,255,0.35)'); spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.restore();
  // rim light
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(180,215,255,0.45)'; ctx.lineWidth = Math.max(1, R * 0.012);
  ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI * 0.9, Math.PI * 1.9); ctx.stroke();
  ctx.restore();
}

export function renderGlobe(t: TextProps, W: number, H: number, localT: number, duration: number): TextFrame {
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  const { u, exitAlpha } = timing(t, localT, duration);
  const p = 1 - Math.pow(1 - u, 3); // ease-out: fast sweep, gentle settle
  const cx = W / 2, cy = H / 2 + (t.offsetY ?? 0) * H, R = H * 0.3;

  setupText(ctx, t);
  ctx.textAlign = 'center';
  const chars = [...t.content.replace(/\s+/g, ' ')];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const ls = t.letterSpacing || 0;
  const totalW = widths.reduce((a, b) => a + b, 0) + ls * Math.max(0, chars.length - 1);
  const ringR = Math.max(R * 1.12, totalW / (Math.PI * 0.82)); // the word spans at most ~150° at the front
  // angle of each letter's centre, word centred at 0
  const angles: number[] = [];
  let acc = 0;
  chars.forEach((_, i) => { acc += widths[i] / 2; angles.push(acc / ringR); acc += widths[i] / 2 + ls; });
  const span = (acc - ls) / ringR;
  const rot = (1 - p) * Math.PI * 1.2; // starts behind on the right, sweeps round to the front
  const pos = chars.map((ch, i) => {
    const a = angles[i] - span / 2 + rot;
    const z = Math.cos(a);
    return { ch, z, x: cx + ringR * Math.sin(a), y: cy + z * R * 0.1, s: 0.6 + 0.4 * (z + 1) / 2, sx: Math.max(0.22, Math.abs(z)) };
  });
  const drawChar = (c: typeof pos[number], alpha: number) => {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(c.x, c.y); ctx.scale(c.sx * c.s, c.s);
    drawLine(ctx, t, c.ch, 0, 0); ctx.restore();
  };
  ctx.globalAlpha = exitAlpha;
  for (const c of pos) if (c.z < 0) drawChar(c, 0.35 + 0.25 * (c.z + 1));
  drawGlobe(ctx, cx, cy, R, localT);
  setupText(ctx, t); ctx.textAlign = 'center';
  for (const c of pos.slice().sort((a, b) => a.z - b.z)) if (c.z >= 0) drawChar(c, 1);
  ctx.globalAlpha = 1;
  return frameOf(ctx, W, H);
}

// ---------------------------------------------------------------------------
// 'monument'
// ---------------------------------------------------------------------------

export function renderMonument(t: TextProps, W: number, H: number, localT: number, duration: number): TextFrame {
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  const { u, exitAlpha } = timing(t, localT, duration);
  const p = ease('ease', u);
  const lines = t.content.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) lines.push(' ');
  const fs = t.fontSize;
  const sizes = lines.map((_, i) => (i === 0 ? fs : fs * 0.74));
  const slabH = fs * 0.17;
  const rows = sizes.map((s) => s * 0.9);
  const total = rows.reduce((a, b) => a + b, 0) + slabH * lines.length;

  const zoom = 1.18 - 0.18 * p, pan = (1 - p) * W * 0.06;
  ctx.save();
  ctx.globalAlpha = Math.min(1, u * 4) * exitAlpha;
  ctx.translate(W / 2 + pan, H / 2 + (t.offsetY ?? 0) * H);
  ctx.scale(zoom, zoom);
  ctx.transform(1, -0.07, 0, 1, 0, 0); // slight shear: the monument is seen from a low three-quarter angle
  ctx.translate(0, -total / 2);
  let y = 0, prevSlab = 0;
  lines.forEach((line, i) => {
    const size = sizes[i];
    const tt: TextProps = { ...t, fontSize: size, fill: t.fill === 'solid' ? 'gold' : t.fill, extrude: Math.round(size * 0.13), extrudeColor: t.extrudeColor ?? '#4a3208', shadow: false, glow: 0, background: '' };
    setupText(ctx, tt); ctx.textAlign = 'center';
    const w = ctx.measureText(line).width;
    const slabW = Math.max(w + size * 0.55, prevSlab + size * 0.3);
    prevSlab = slabW;
    drawLine(ctx, tt, line, 0, y + size * 0.5);
    y += rows[i];
    // bronze tier the line stands on: lit top face + darker front
    const top = ctx.createLinearGradient(0, y, 0, y + slabH * 0.35);
    top.addColorStop(0, '#e2b35a'); top.addColorStop(1, '#a87a2a');
    ctx.fillStyle = top; ctx.fillRect(-slabW / 2, y, slabW, slabH * 0.35);
    const front = ctx.createLinearGradient(0, y + slabH * 0.35, 0, y + slabH);
    front.addColorStop(0, '#7a5416'); front.addColorStop(1, '#3a2706');
    ctx.fillStyle = front; ctx.fillRect(-slabW / 2, y + slabH * 0.35, slabW, slabH * 0.65);
    ctx.fillStyle = 'rgba(255,230,160,0.35)'; ctx.fillRect(-slabW / 2, y, slabW, 1.5);
    y += slabH;
  });
  // pedestal
  const pw = prevSlab + fs * 0.6, ph = fs * 0.55;
  const ped = ctx.createLinearGradient(0, y, 0, y + ph);
  ped.addColorStop(0, '#5a4220'); ped.addColorStop(1, '#17110a');
  ctx.fillStyle = ped; ctx.fillRect(-pw / 2, y, pw, ph);
  ctx.fillStyle = 'rgba(255,220,150,0.25)'; ctx.fillRect(-pw / 2, y, pw, 2);
  // inset panel line on the pedestal
  ctx.strokeStyle = 'rgba(255,220,150,0.18)'; ctx.lineWidth = 2; ctx.strokeRect(-pw / 2 + fs * 0.15, y + ph * 0.25, pw - fs * 0.3, ph * 0.5);
  ctx.restore();
  return frameOf(ctx, W, H);
}

// ---------------------------------------------------------------------------
// 'ribbons' (streaming ident): the big red initial with a folded-ribbon shade, which bursts into
// a fan of coloured light ribbons rushing past the camera, then the full word fades in.
// ---------------------------------------------------------------------------

const RIBBON_HUES = [355, 10, 25, 40, 55, 90, 140, 170, 200, 230, 260, 290, 320];

export function renderRibbons(t: TextProps, W: number, H: number, localT: number, duration: number): TextFrame {
  const ctx = scratchCanvas(W, H);
  drawBackdrop(ctx, t.backdrop, W, H, localT, t.backdropColor, t.backdropColor2);
  const { u, exitAlpha } = timing(t, localT, duration);
  const word = t.content.trim() || 'N';
  const initial = [...word][0];
  const cx = W / 2, cy = H / 2 + (t.offsetY ?? 0) * H;
  const big = t.fontSize * 2.4;
  const bigT: TextProps = { ...t, fontSize: big, fill: 'solid', glow: 0, outline: '', extrude: 0, shadow: false, background: '' };

  // measure the initial
  const m = layer('fx', W, H);
  m.font = fontString(bigT); m.textBaseline = 'middle'; m.textAlign = 'center';
  const letterW = m.measureText(initial).width, letterH = big * 0.75;

  // phase A (0–0.42): the initial grows in; a diagonal darker band gives the folded-ribbon look
  if (u < 0.6) {
    const a = clamp01(u / 0.42);
    const s = 0.85 + 0.15 * ease('ease', a);
    const fadeOut = u > 0.42 ? 1 - clamp01((u - 0.42) / 0.14) : 1;
    m.fillStyle = t.color; m.fillText(initial, cx, cy + big * 0.03);
    m.globalCompositeOperation = 'source-atop';
    const band = m.createLinearGradient(cx - letterW / 2, cy - letterH / 2, cx + letterW / 2, cy + letterH / 2);
    band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(0.42, 'rgba(0,0,0,0)'); band.addColorStop(0.47, 'rgba(0,0,0,0.45)'); band.addColorStop(0.58, 'rgba(0,0,0,0.45)'); band.addColorStop(0.63, 'rgba(0,0,0,0)'); band.addColorStop(1, 'rgba(0,0,0,0.25)');
    m.fillStyle = band; m.fillRect(0, 0, W, H);
    // sweep of light down the diagonal stroke
    const k = (a * 1.6 - 0.3);
    const sweep = m.createLinearGradient(cx - letterW / 2, cy - letterH / 2, cx + letterW / 2, cy + letterH / 2);
    sweep.addColorStop(clamp01(k - 0.12), 'rgba(255,255,255,0)'); sweep.addColorStop(clamp01(k), 'rgba(255,255,255,0.45)'); sweep.addColorStop(clamp01(k + 0.12), 'rgba(255,255,255,0)');
    m.fillStyle = sweep; m.fillRect(0, 0, W, H);
    m.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.globalAlpha = Math.min(1, a * 3) * fadeOut * exitAlpha;
    ctx.translate(cx, cy); ctx.scale(s, s); ctx.drawImage(m.canvas, -cx, -cy); ctx.restore();
  }

  // phase B (0.38–0.8): coloured ribbons burst out of the letter and fly past the camera
  if (u > 0.38 && u < 0.82) {
    const b = clamp01((u - 0.38) / 0.44);
    const zoom = 1 + Math.pow(b, 2.2) * 26;
    const fade = Math.min(1, b * 5) * (1 - clamp01((b - 0.55) / 0.45));
    const N = 54, w0 = (letterW * 1.15) / N;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fade * exitAlpha;
    for (let i = 0; i < N; i++) {
      const x0 = cx + (i / (N - 1) - 0.5) * letterW * 1.15;
      const hue = RIBBON_HUES[Math.floor(hash(i, 1) * RIBBON_HUES.length)];
      const depth = 0.6 + hash(i, 2) * 0.9;                   // ribbons at different depths zoom at different speeds
      const z = 1 + (zoom - 1) * depth;
      const x = cx + (x0 - cx) * z, w = Math.max(1.5, w0 * z * (0.6 + hash(i, 3)));
      if (x + w < 0 || x - w > W) continue;
      const top = cy - letterH / 2 * z * (0.8 + hash(i, 4) * 0.6), bot = cy + letterH / 2 * z * (0.8 + hash(i, 5) * 0.6);
      const g = ctx.createLinearGradient(0, top, 0, bot);
      const l = 55 + hash(i, 6) * 15;
      g.addColorStop(0, 'hsla(' + hue + ',95%,' + l + '%,0)'); g.addColorStop(0.25, 'hsla(' + hue + ',95%,' + l + '%,0.9)'); g.addColorStop(0.75, 'hsla(' + hue + ',95%,' + l + '%,0.9)'); g.addColorStop(1, 'hsla(' + hue + ',95%,' + l + '%,0)');
      ctx.fillStyle = g; ctx.fillRect(x - w / 2, Math.max(-H, top), w, Math.min(3 * H, bot - top));
    }
    ctx.restore();
    // bright core flash as the burst starts
    const flash = Math.max(0, 1 - b * 3);
    if (flash > 0) { const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, letterH); fg.addColorStop(0, 'rgba(255,230,230,' + (0.8 * flash).toFixed(2) + ')'); fg.addColorStop(1, 'rgba(255,230,230,0)'); ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H); }
  }

  // phase C (0.62–1): the full word settles in
  if (u > 0.62) {
    const c = ease('ease', clamp01((u - 0.62) / 0.3));
    ctx.save(); ctx.globalAlpha = c * exitAlpha;
    ctx.translate(cx, cy); ctx.scale(1.06 - 0.06 * c, 1.06 - 0.06 * c); ctx.translate(-cx, -cy);
    setupText(ctx, t); ctx.textAlign = 'center';
    drawLine(ctx, t, word, cx, cy);
    ctx.restore();
  }
  return frameOf(ctx, W, H);
}
