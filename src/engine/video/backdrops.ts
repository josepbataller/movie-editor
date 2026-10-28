import type { TextBackdrop } from '@/shared/types';

// Animated full-frame backgrounds for title clips (starfield, nebula, disco lights, clouds…).
// Deterministic in `t` (seconds), so the live preview and the frame exporter agree.
// Every backdrop takes two colours (c1 = base/background, c2 = accent); each one picks
// sensible defaults when the template did not override them.

/** Small deterministic PRNG so particle positions etc. are stable between frames. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function hexToRgb(hex: string): [number, number, number] {
  // accepts #rgb / #rrggbb; anything else (names, rgba()) falls back to mid grey instead of NaN
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = /^[0-9a-f]{6}$/i.test(h) ? parseInt(h, 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
const mod = (a: number, n: number) => ((a % n) + n) % n;
const hashf = (a: number, b: number) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };

interface Particle { x: number; y: number; z: number; tw: number; r: number }
const particleCache = new Map<string, Particle[]>();
/** Stable set of `count` particles for a frame size (positions 0..1, depth 0.3..1, phase, random). */
function particles(key: string, count: number, seed = 1234): Particle[] {
  const k = `${key}:${count}:${seed}`;
  let s = particleCache.get(k);
  if (!s) {
    const r = rng(seed);
    s = Array.from({ length: count }, () => ({ x: r(), y: r(), z: 0.3 + r() * 0.7, tw: r() * Math.PI * 2, r: r() }));
    particleCache.set(k, s);
  }
  return s;
}

function fill(ctx: CanvasRenderingContext2D, W: number, H: number, c: string) { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); }

function verticalGradient(ctx: CanvasRenderingContext2D, W: number, H: number, top: string, bottom: string) {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

/** A soft cloud made of a few overlapping ellipses. */
function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, alpha: number) {
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  const parts = [[0, 0, 0.5, 0.26], [-0.3, 0.08, 0.32, 0.18], [0.3, 0.06, 0.34, 0.2], [0.05, -0.1, 0.3, 0.2]];
  for (const [dx, dy, rw, rh] of parts) { ctx.beginPath(); ctx.ellipse(x + dx * w, y + dy * w, rw * w, rh * w, 0, 0, Math.PI * 2); ctx.fill(); }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, points = 4) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.4;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}


/** Premiere-night beams sweeping the sky from below the frame. */
function searchlightBeams(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, S: number) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const lights = [[0.2, 0.9], [0.4, -0.7], [0.6, 0.6], [0.8, -0.8]];
  lights.forEach(([bx, sp], i) => {
    const a = -Math.PI / 2 + Math.sin(t * sp * 0.5 + i) * 0.55;
    const x0 = bx * W, y0 = H * 1.05, len = H * 2;
    const g = ctx.createLinearGradient(x0, y0, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
    g.addColorStop(0, 'rgba(255,250,230,0.55)'); g.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x0 - 10 * S, y0); ctx.lineTo(x0 + 10 * S, y0);
    ctx.lineTo(x0 + Math.cos(a + 0.05) * len, y0 + Math.sin(a + 0.05) * len); ctx.lineTo(x0 + Math.cos(a - 0.05) * len, y0 + Math.sin(a - 0.05) * len); ctx.closePath(); ctx.fill();
  });
  ctx.restore();
}

/** A fairy-tale castle: lit stone towers with blue conical roofs, drawn around (bx, by) = base centre, u = height unit. */
function drawCastle(ctx: CanvasRenderingContext2D, bx: number, by: number, u: number, t: number) {
  // warm glow behind the castle
  const glow = ctx.createRadialGradient(bx, by - u * 0.25, 0, bx, by - u * 0.25, u * 0.9);
  glow.addColorStop(0, 'rgba(255,180,90,0.35)'); glow.addColorStop(1, 'rgba(255,180,90,0)');
  ctx.fillStyle = glow; ctx.fillRect(bx - u, by - u * 1.2, u * 2, u * 1.3);
  const towers = [
    { dx: -0.86, w: 0.12, h: 0.2, roof: 0.14 }, { dx: 0.86, w: 0.12, h: 0.22, roof: 0.15 },
    { dx: -0.6, w: 0.15, h: 0.27, roof: 0.17 }, { dx: 0.6, w: 0.15, h: 0.3, roof: 0.19 },
    { dx: -0.34, w: 0.12, h: 0.36, roof: 0.19 }, { dx: 0.34, w: 0.12, h: 0.4, roof: 0.21 },
    { dx: -0.14, w: 0.14, h: 0.46, roof: 0.23 }, { dx: 0.14, w: 0.14, h: 0.5, roof: 0.25 },
    { dx: 0, w: 0.2, h: 0.62, roof: 0.3 },
  ];
  const stone = (x: number, y: number, w: number, h: number) => {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#f6cf92'); g.addColorStop(0.5, '#d9994a'); g.addColorStop(1, '#8a5520');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    // windows
    const cols = Math.max(1, Math.round(w / (u * 0.045))), rows = Math.max(1, Math.round(h / (u * 0.07)));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const flick = 0.75 + 0.25 * Math.sin(t * 3 + r * 7 + c * 13);
      ctx.fillStyle = (r * 3 + c) % 4 === 0 ? 'rgba(60,40,20,0.6)' : 'rgba(255,236,170,' + (0.85 * flick).toFixed(2) + ')';
      ctx.fillRect(x + w * (c + 0.5) / cols - u * 0.008, y + h * (r + 0.4) / rows, u * 0.016, u * 0.03);
    }
  };
  const roof = (x: number, y: number, w: number, h: number) => {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#4a6fd1'); g.addColorStop(0.5, '#1e2f70'); g.addColorStop(1, '#0d1740');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x - w * 0.12, y); ctx.lineTo(x + w * 1.12, y); ctx.lineTo(x + w / 2, y - h); ctx.closePath(); ctx.fill();
    // spire + pennant
    ctx.strokeStyle = '#e8d7a8'; ctx.lineWidth = Math.max(1, u * 0.006);
    ctx.beginPath(); ctx.moveTo(x + w / 2, y - h); ctx.lineTo(x + w / 2, y - h - u * 0.06); ctx.stroke();
    ctx.fillStyle = '#e63946'; ctx.beginPath(); ctx.moveTo(x + w / 2, y - h - u * 0.06); ctx.lineTo(x + w / 2 + u * 0.03, y - h - u * 0.045); ctx.lineTo(x + w / 2, y - h - u * 0.03); ctx.closePath(); ctx.fill();
  };
  // curtain walls with battlements
  const wallH = u * 0.17, wallW = u * 1.9;
  stone(bx - wallW / 2, by - wallH, wallW, wallH);
  ctx.fillStyle = '#c98a3d';
  for (let x = bx - wallW / 2; x < bx + wallW / 2; x += u * 0.06) ctx.fillRect(x, by - wallH - u * 0.025, u * 0.03, u * 0.025);
  // gate
  ctx.fillStyle = '#2a1a0a'; ctx.beginPath(); ctx.moveTo(bx - u * 0.05, by); ctx.lineTo(bx - u * 0.05, by - u * 0.09); ctx.arc(bx, by - u * 0.09, u * 0.05, Math.PI, 0); ctx.lineTo(bx + u * 0.05, by); ctx.fill();
  // towers, back to front (shortest first so the keep ends up on top)
  for (const tw of towers) {
    const w = tw.w * u, h = tw.h * u, x = bx + tw.dx * u - w / 2;
    stone(x, by - h, w, h);
    ctx.fillStyle = '#c98a3d'; ctx.fillRect(x - w * 0.08, by - h - u * 0.01, w * 1.16, u * 0.012);
    roof(x, by - h, w, tw.roof * u);
  }
}

export function drawBackdrop(ctx: CanvasRenderingContext2D, kind: TextBackdrop | undefined, W: number, H: number, t: number, c1 = '#000000', c2 = '#1a237e') {
  if (!kind || kind === 'none') return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  const S = W / 1280; // size scale so particles look the same at any resolution
  switch (kind) {
    case 'solid': fill(ctx, W, H, c1); break;

    case 'starfield': {
      fill(ctx, W, H, c1);
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, rgba(c2, 0.18)); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;
      for (const s of particles('stars', Math.round((W * H) / 2600))) {
        const drift = 1 + t * 0.012 * s.z;
        let x = cx + (s.x * W - cx) * drift, y = cy + (s.y * H - cy) * drift;
        if (x < 0 || x > W || y < 0 || y > H) { x = cx + ((s.x * W - cx) * drift) % (W / 2); y = cy + ((s.y * H - cy) * drift) % (H / 2); }
        const tw = 0.55 + 0.45 * Math.sin(t * (1 + s.z * 2) + s.tw);
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.65 * s.z) * tw})`;
        ctx.beginPath(); ctx.arc(x, y, s.z * 1.6 * S, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'nebula': {
      fill(ctx, W, H, c1);
      const blobs = [[0.3, 0.4, 0.45, c2], [0.7, 0.6, 0.4, '#b85fa8'], [0.5, 0.25, 0.3, '#2bb3c4'], [0.2, 0.8, 0.35, c2]] as const;
      blobs.forEach(([bx, by, br, col], i) => {
        const x = W * (bx + 0.05 * Math.sin(t * 0.15 + i)), y = H * (by + 0.05 * Math.cos(t * 0.12 + i * 2));
        const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * br);
        g.addColorStop(0, rgba(col, 0.55)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      });
      for (const s of particles('nebstars', 160)) { ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * s.z})`; ctx.fillRect(s.x * W, s.y * H, 1.5, 1.5); }
      break;
    }
    case 'gradient': {
      const a = t * 0.2;
      const g = ctx.createLinearGradient(W / 2 + Math.cos(a) * W, H / 2 + Math.sin(a) * H, W / 2 - Math.cos(a) * W, H / 2 - Math.sin(a) * H);
      g.addColorStop(0, c1); g.addColorStop(1, c2);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'film': {
      fill(ctx, W, H, c1);
      const r = rng(Math.floor(t * 24) * 7919 + 17);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      const n = Math.round((W * H) / 900);
      for (let i = 0; i < n; i++) ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
      if (r() < 0.25) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(r() * W, 0, 1, H); }
      const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(255,240,200,${0.03 + 0.03 * Math.sin(t * 17)})`; ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'matrix': {
      fill(ctx, W, H, c1);
      const col = Math.max(14, Math.round(W / 70));
      const cols = Math.ceil(W / col);
      ctx.font = `${col}px Consolas, monospace`;
      ctx.textBaseline = 'top';
      const r = rng(99);
      const green = c2 === '#1a237e' ? '#39ff14' : c2;
      for (let i = 0; i < cols; i++) {
        const speed = 60 + r() * 140, offset = r() * H * 3, len = 8 + Math.floor(r() * 14);
        const head = ((t * speed + offset) % (H + len * col)) - len * col;
        for (let k = 0; k < len; k++) {
          const y = head + k * col;
          if (y < -col || y > H) continue;
          const ch = String.fromCharCode(0x30a0 + Math.floor(((i * 31 + k * 17 + Math.floor(t * 8 + i)) * 7) % 96));
          ctx.fillStyle = k === len - 1 ? '#d8ffd8' : rgba(green, 0.15 + 0.85 * (k / len));
          ctx.fillText(ch, i * col, y);
        }
      }
      break;
    }
    case 'bokeh': {
      verticalGradient(ctx, W, H, c1, c2);
      const r = rng(4242);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 28; i++) {
        const bx = r() * W, by = r() * H, rad = (20 + r() * 70) * S, sp = 0.1 + r() * 0.3, ph = r() * 6.28;
        const x = bx + Math.sin(t * sp + ph) * 40, yy = mod(by - t * 15 * sp + 100, H + 200) - 100;
        const gg = ctx.createRadialGradient(x, yy, rad * 0.2, x, yy, rad);
        const hue = (i * 37) % 360;
        gg.addColorStop(0, `hsla(${hue},80%,70%,0.35)`); gg.addColorStop(0.8, `hsla(${hue},80%,60%,0.12)`); gg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, yy, rad, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'scanlines': {
      fill(ctx, W, H, c1);
      ctx.fillStyle = rgba(c2, 0.25);
      const roll = (t * 40) % 6;
      for (let y = -6 + roll; y < H; y += 3) ctx.fillRect(0, y, W, 1);
      const bar = ((t * 120) % (H + 200)) - 100;
      const g = ctx.createLinearGradient(0, bar - 60, 0, bar + 60);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, bar - 60, W, 120);
      break;
    }

    // ---- party ----------------------------------------------------------------
    case 'disco': {
      // coloured beams sweeping from a mirror ball at the top, plus glitter squares
      fill(ctx, W, H, c1);
      const cx = W / 2, cy = -H * 0.1;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 9; i++) {
        const a = Math.PI / 2 + Math.sin(t * 0.7 + i * 1.3) * 0.9 + (i - 4) * 0.22;
        const hue = (i * 40 + t * 60) % 360;
        const len = Math.max(W, H) * 1.6;
        const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        g.addColorStop(0, `hsla(${hue},100%,65%,0.55)`); g.addColorStop(1, `hsla(${hue},100%,60%,0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a - 0.06) * len, cy + Math.sin(a - 0.06) * len);
        ctx.lineTo(cx + Math.cos(a + 0.06) * len, cy + Math.sin(a + 0.06) * len);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const p of particles('disco', 90)) {
        const on = Math.sin(t * (3 + p.z * 5) + p.tw) > 0.6;
        if (!on) continue;
        ctx.fillStyle = `hsla(${(p.r * 360 + t * 90) % 360},100%,75%,0.8)`;
        const s = (6 + p.z * 10) * S;
        ctx.fillRect(p.x * W - s / 2, p.y * H - s / 2, s, s);
      }
      // the mirror ball
      const g = ctx.createRadialGradient(cx, cy + H * 0.08, 0, cx, cy + H * 0.08, H * 0.14);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.6, 'rgba(200,200,220,0.5)'); g.addColorStop(1, 'rgba(200,200,220,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy + H * 0.08, H * 0.14, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'confetti': {
      fill(ctx, W, H, c1);
      const colors = ['#ff5252', '#ffd740', '#69f0ae', '#40c4ff', '#e040fb', '#ff6e40', '#ffffff'];
      for (const p of particles('confetti', 140)) {
        const speed = 40 + p.z * 110, sway = Math.sin(t * (1 + p.z) + p.tw) * 30 * S;
        const y = mod(p.y * H + t * speed * S, H + 40) - 20, x = p.x * W + sway;
        const w = (8 + p.z * 8) * S, h = (4 + p.r * 6) * S;
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * (2 + p.z * 4) + p.tw); ctx.scale(1, Math.abs(Math.sin(t * 3 + p.tw)) * 0.8 + 0.2);
        ctx.fillStyle = colors[Math.floor(p.r * colors.length)]; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
      }
      break;
    }
    case 'fireworks': {
      verticalGradient(ctx, W, H, c1, '#0b0820');
      ctx.globalCompositeOperation = 'lighter';
      const r = rng(777);
      for (let i = 0; i < 6; i++) {
        const period = 2.2 + r() * 1.5, offset = r() * 3, bx = 0.15 + r() * 0.7, by = 0.15 + r() * 0.45, hue = r() * 360;
        const lt = mod(t + offset, period);
        const n = 26;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + i, sp = (0.35 + ((k * 7919) % 13) / 40) * H * 0.9;
          const x = bx * W + Math.cos(a) * sp * lt * 0.6, y = by * H + Math.sin(a) * sp * lt * 0.6 + lt * lt * 60 * S;
          const alpha = Math.max(0, 1 - lt / (period * 0.6));
          ctx.fillStyle = `hsla(${hue + k * 3},100%,${65 + 30 * Math.max(0, 1 - lt * 3)}%,${alpha})`;
          ctx.beginPath(); ctx.arc(x, y, Math.max(0.4, 2.5 - lt) * S, 0, Math.PI * 2); ctx.fill();
        }
      }
      break;
    }
    case 'hearts': {
      verticalGradient(ctx, W, H, c1, c2);
      for (const p of particles('hearts', 40)) {
        const y = mod(p.y * H - t * (25 + p.z * 60) * S, H + 120) - 60, x = p.x * W + Math.sin(t + p.tw) * 25 * S;
        const s = (14 + p.z * 26) * S;
        ctx.fillStyle = `rgba(255,${80 + p.r * 100},${120 + p.r * 80},${0.35 + 0.5 * p.z})`;
        ctx.beginPath(); ctx.moveTo(x, y + s * 0.3);
        ctx.bezierCurveTo(x - s, y - s * 0.5, x - s * 0.4, y - s * 1.1, x, y - s * 0.4);
        ctx.bezierCurveTo(x + s * 0.4, y - s * 1.1, x + s, y - s * 0.5, x, y + s * 0.3);
        ctx.fill();
      }
      break;
    }
    case 'bubbles': {
      verticalGradient(ctx, W, H, c1, c2);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5 * S;
      for (const p of particles('bubbles', 45)) {
        const y = mod(p.y * H - t * (30 + p.z * 70) * S, H + 160) - 80, x = p.x * W + Math.sin(t * 1.3 + p.tw) * 20 * S, rad = (8 + p.z * 30) * S;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(x - rad * 0.35, y - rad * 0.35, rad * 0.2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'glitter': {
      fill(ctx, W, H, c1);
      const gold = c2 === '#1a237e' ? '#ffd54f' : c2;
      for (const p of particles('glitter', 220)) {
        const tw = Math.max(0, Math.sin(t * (2 + p.z * 6) + p.tw));
        if (tw < 0.2) continue;
        ctx.fillStyle = rgba(gold, tw * (0.5 + p.z * 0.5));
        const y = mod(p.y * H + t * 12 * S, H);
        star(ctx, p.x * W, y, (2 + p.z * 5) * tw * S);
      }
      break;
    }

    // ---- sky / nature -------------------------------------------------------
    case 'clouds': {
      verticalGradient(ctx, W, H, c1, c2);
      for (const p of particles('clouds', 9)) {
        const w = (260 + p.z * 420) * S;
        const x = mod(p.x * W + t * (12 + p.z * 18) * S + w, W + w * 2) - w, y = p.y * H;
        cloud(ctx, x, y, w, 0.55 + p.z * 0.4);
      }
      break;
    }
    case 'moon': {
      // night sky, big moon, slow clouds crossing it
      verticalGradient(ctx, W, H, c1, c2);
      for (const s of particles('moonstars', 140)) { ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.5 * Math.sin(t * 2 + s.tw) * s.z})`; ctx.fillRect(s.x * W, s.y * H * 0.8, 1.6 * S, 1.6 * S); }
      const mx = W * 0.5, my = H * 0.4, mr = H * 0.23;
      const halo = ctx.createRadialGradient(mx, my, mr * 0.9, mx, my, mr * 1.8);
      halo.addColorStop(0, 'rgba(220,230,255,0.35)'); halo.addColorStop(1, 'rgba(220,230,255,0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
      const mg = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.2, mx, my, mr);
      mg.addColorStop(0, '#fffbe8'); mg.addColorStop(1, '#cfd2dc');
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(120,125,140,0.25)';
      for (const c of [[0.2, -0.3, 0.18], [-0.35, 0.1, 0.22], [0.1, 0.4, 0.14], [-0.1, -0.05, 0.1]]) { ctx.beginPath(); ctx.arc(mx + c[0] * mr, my + c[1] * mr, c[2] * mr, 0, Math.PI * 2); ctx.fill(); }
      for (const p of particles('moonclouds', 5)) {
        const w = (320 + p.z * 380) * S;
        cloud(ctx, mod(p.x * W + t * (10 + p.z * 14) * S + w, W + w * 2) - w, H * (0.5 + p.y * 0.45), w, 0.1 + p.z * 0.12);
      }
      break;
    }
    case 'sunburst': {
      // rotating rays from the centre (retro poster / cartoon intro)
      fill(ctx, W, H, c1);
      const cx = W / 2, cy = H / 2, n = 18, R = Math.max(W, H);
      ctx.fillStyle = c2;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2 + t * 0.15, a1 = a0 + Math.PI / n;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); ctx.closePath(); ctx.fill();
      }
      const v = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.7);
      v.addColorStop(0, 'rgba(255,255,255,0.25)'); v.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'rays': {
      // soft god-rays from the centre, slowly pulsing (streaming-service intro)
      fill(ctx, W, H, c1);
      const cx = W / 2, cy = H / 2, R = Math.max(W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2 + Math.sin(t * 0.3 + i) * 0.05;
        const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        const alpha = 0.12 + 0.1 * Math.sin(t * 1.5 + i * 0.7);
        g.addColorStop(0, rgba(c2, alpha)); g.addColorStop(1, rgba(c2, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a - 0.04) * R, cy + Math.sin(a - 0.04) * R); ctx.lineTo(cx + Math.cos(a + 0.04) * R, cy + Math.sin(a + 0.04) * R); ctx.closePath(); ctx.fill();
      }
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5);
      g.addColorStop(0, rgba(c2, 0.35)); g.addColorStop(1, rgba(c2, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'searchlights': {
      // premiere-night beams sweeping the sky from below the frame
      verticalGradient(ctx, W, H, c1, c2);
      searchlightBeams(ctx, W, H, t, S);
      for (const s of particles('slstars', 80)) { ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.4 * s.z})`; ctx.fillRect(s.x * W, s.y * H * 0.7, 1.5 * S, 1.5 * S); }
      break;
    }
    case 'castle': {
      // fairy-tale night: deep blue sky, pink cloud streaks, lit castle on a lake with its reflection
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, c1); sky.addColorStop(0.7, c2); sky.addColorStop(1, '#0a1e46');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      for (const s of particles('castlestars', 150)) { ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.55 * s.z * (0.6 + 0.4 * Math.sin(t * 2 + s.tw))).toFixed(2) + ')'; ctx.fillRect(s.x * W, s.y * H * 0.6, 1.6 * S, 1.6 * S); }
      for (const p of particles('castleclouds', 8)) {
        const w = (260 + p.z * 420) * S, h = (10 + p.z * 22) * S;
        const x = mod(p.x * W + t * 5 * S + w, W + w * 2) - w, y = H * (0.3 + p.y * 0.24);
        const g = ctx.createRadialGradient(x, y, 0, x, y, w);
        g.addColorStop(0, 'rgba(255,140,170,0.6)'); g.addColorStop(0.5, 'rgba(255,170,150,0.3)'); g.addColorStop(1, 'rgba(255,140,170,0)');
        ctx.save(); ctx.translate(x, y); ctx.scale(1, h / w); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, w, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      const horizon = H * 0.66;
      // distant hills and the lake
      ctx.fillStyle = '#071233'; ctx.beginPath(); ctx.moveTo(0, horizon);
      for (let x = 0; x <= W; x += 20) ctx.lineTo(x, horizon - (10 + 14 * Math.sin(x / (170 * S)) + 8 * Math.sin(x / (61 * S))) * S);
      ctx.lineTo(W, horizon); ctx.closePath(); ctx.fill();
      const lake = ctx.createLinearGradient(0, horizon, 0, H); lake.addColorStop(0, '#0d2a63'); lake.addColorStop(1, '#03091c');
      ctx.fillStyle = lake; ctx.fillRect(0, horizon, W, H - horizon);
      for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(255,225,160,' + (0.4 + 0.5 * hashf(i, 3)).toFixed(2) + ')'; ctx.fillRect(hashf(i, 1) * W, horizon - 3 * S, 3 * S, 2 * S); }
      // reflection first (so the castle base covers its top edge), then the castle
      ctx.save(); ctx.translate(0, horizon * 2); ctx.scale(1, -0.45); ctx.globalAlpha = 0.28;
      drawCastle(ctx, W / 2, horizon, H * 0.55, t);
      ctx.restore();
      ctx.fillStyle = 'rgba(3,9,28,0.25)';
      for (let y = horizon + 4; y < H; y += 7 * S) ctx.fillRect(0, y + Math.sin(t * 2 + y) * 1.5, W, 2 * S);
      drawCastle(ctx, W / 2, horizon, H * 0.55, t);
      break;
    }
    case 'premiere': {
      // sunset over the studio lot: purple-to-orange sky, dark clouds with lit rims, searchlights
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, c1); sky.addColorStop(0.55, c2); sky.addColorStop(1, '#ffb070');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      for (const s of particles('premstars', 60)) { ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + 0.4 * s.z).toFixed(2) + ')'; ctx.fillRect(s.x * W, s.y * H * 0.35, 1.5 * S, 1.5 * S); }
      for (const p of particles('premclouds', 9)) {
        const w = (220 + p.z * 380) * S;
        const x = mod(p.x * W + t * (6 + p.z * 8) * S + w, W + w * 2) - w, y = H * (0.25 + p.y * 0.5);
        // soft cloud: dark purple body with a lit orange upper rim
        ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.22);
        const body = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.5);
        body.addColorStop(0, 'rgba(70,25,80,0.6)'); body.addColorStop(0.7, 'rgba(70,25,80,0.35)'); body.addColorStop(1, 'rgba(70,25,80,0)');
        ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, 0, w * 0.5, 0, Math.PI * 2); ctx.fill();
        const rim = ctx.createRadialGradient(0, -w * 0.1, 0, 0, -w * 0.1, w * 0.45);
        rim.addColorStop(0, 'rgba(255,180,120,0.5)'); rim.addColorStop(1, 'rgba(255,180,120,0)');
        ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(0, -w * 0.1, w * 0.45, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      searchlightBeams(ctx, W, H, t, S);
      break;
    }
    case 'sunset': {
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.7); sky.addColorStop(0, c1); sky.addColorStop(1, c2);
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      const sx = W / 2, sy = H * 0.62 - Math.min(H * 0.1, t * 2 * S), sr = H * 0.22;
      const halo = ctx.createRadialGradient(sx, sy, sr * 0.8, sx, sy, sr * 2.5);
      halo.addColorStop(0, 'rgba(255,170,80,0.5)'); halo.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
      const sun = ctx.createLinearGradient(0, sy - sr, 0, sy + sr); sun.addColorStop(0, '#fff1a8'); sun.addColorStop(1, '#ff6f61');
      ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
      // retro horizontal cuts in the sun + sea
      ctx.fillStyle = c2; for (let i = 0; i < 6; i++) ctx.fillRect(0, sy + sr * (0.1 + i * 0.16), W, sr * 0.02 * (i + 1));
      const sea = ctx.createLinearGradient(0, H * 0.68, 0, H); sea.addColorStop(0, '#2a1a4a'); sea.addColorStop(1, '#05030f');
      ctx.fillStyle = sea; ctx.fillRect(0, H * 0.68, W, H * 0.32);
      ctx.fillStyle = 'rgba(255,200,120,0.25)';
      for (let i = 0; i < 12; i++) { const y = H * 0.7 + i * H * 0.025; const w = W * (0.06 + i * 0.03) * (0.8 + 0.2 * Math.sin(t * 2 + i)); ctx.fillRect(sx - w / 2, y, w, 2 * S); }
      break;
    }
    case 'ocean': {
      verticalGradient(ctx, W, H, c1, c2);
      ctx.lineWidth = 2 * S;
      for (let i = 0; i < 9; i++) {
        const y0 = H * (0.3 + i * 0.08);
        ctx.strokeStyle = `rgba(255,255,255,${0.12 + i * 0.03})`;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 8) ctx.lineTo(x, y0 + Math.sin(x / (90 * S) + t * (1 + i * 0.1) + i) * 14 * S + Math.sin(x / (37 * S) - t * 1.7) * 5 * S);
        ctx.stroke();
      }
      break;
    }
    case 'aurora': {
      fill(ctx, W, H, c1);
      ctx.globalCompositeOperation = 'lighter';
      const colors = [c2, '#2ee6a6', '#7c4dff', '#2ee6a6'];
      colors.forEach((col, i) => {
        ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 12) {
          const y = H * (0.25 + i * 0.08) + Math.sin(x / (160 * S) + t * 0.5 + i * 1.7) * H * 0.08 + Math.sin(x / (50 * S) - t * 0.8) * H * 0.02;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H); ctx.closePath();
        const g = ctx.createLinearGradient(0, H * 0.15, 0, H * 0.75); g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.3, rgba(col, 0.28)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
      for (const s of particles('aurstars', 120)) { ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * s.z})`; ctx.fillRect(s.x * W, s.y * H * 0.6, 1.5 * S, 1.5 * S); }
      break;
    }
    case 'rain': {
      verticalGradient(ctx, W, H, c1, c2);
      ctx.strokeStyle = 'rgba(200,220,255,0.45)'; ctx.lineWidth = 1.2 * S;
      ctx.beginPath();
      for (const p of particles('rain', 260)) {
        const len = (14 + p.z * 26) * S, y = mod(p.y * H + t * (700 + p.z * 600) * S, H + len) - len, x = p.x * W - (y * 0.08);
        ctx.moveTo(x, y); ctx.lineTo(x - len * 0.08, y + len);
      }
      ctx.stroke();
      break;
    }
    case 'snow': {
      verticalGradient(ctx, W, H, c1, c2);
      for (const p of particles('snow', 220)) {
        const y = mod(p.y * H + t * (30 + p.z * 70) * S, H + 20) - 10, x = p.x * W + Math.sin(t * (0.6 + p.z) + p.tw) * 30 * S;
        ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.6 * p.z})`; ctx.beginPath(); ctx.arc(x, y, (1.2 + p.z * 3) * S, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'leaves': {
      verticalGradient(ctx, W, H, c1, c2);
      const colors = ['#e65100', '#ff8f00', '#c62828', '#f9a825', '#6d4c41'];
      for (const p of particles('leaves', 60)) {
        const y = mod(p.y * H + t * (40 + p.z * 60) * S, H + 60) - 30, x = p.x * W + Math.sin(t * (0.8 + p.z) + p.tw) * 60 * S;
        const s = (10 + p.z * 14) * S;
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * (1 + p.z) + p.tw); ctx.fillStyle = colors[Math.floor(p.r * colors.length)];
        ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      break;
    }
    case 'petals': {
      verticalGradient(ctx, W, H, c1, c2);
      for (const p of particles('petals', 70)) {
        const y = mod(p.y * H + t * (35 + p.z * 50) * S, H + 60) - 30, x = p.x * W + Math.sin(t * (0.7 + p.z) + p.tw) * 50 * S;
        const s = (6 + p.z * 10) * S;
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * 1.5 + p.tw); ctx.fillStyle = `rgba(255,${160 + p.r * 60},${190 + p.r * 50},0.85)`;
        ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      break;
    }
    case 'fire': {
      fill(ctx, W, H, c1);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of particles('fire', 90)) {
        const life = mod(t * (0.6 + p.z * 0.8) + p.tw, 1);
        const x = W * (0.5 + (p.x - 0.5) * 1.2) + Math.sin(life * 6 + p.tw) * 30 * S, y = H * (1.05 - life * 0.9);
        const rad = (40 + p.r * 80) * S * (1 - life * 0.7);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(255,${200 - life * 170},${60 - life * 60},${0.35 * (1 - life)})`); g.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'lightning': {
      verticalGradient(ctx, W, H, c1, c2);
      const r = rng(Math.floor(t * 2.5) * 31 + 7);
      const flashAt = r() * 0.4, lt = mod(t, 0.4);
      const flash = Math.abs(lt - flashAt) < 0.08 ? (1 - Math.abs(lt - flashAt) / 0.08) : 0;
      if (flash > 0) {
        ctx.fillStyle = `rgba(230,235,255,${flash * 0.35})`; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = `rgba(255,255,255,${flash})`; ctx.lineWidth = 3 * S; ctx.shadowColor = '#9fb4ff'; ctx.shadowBlur = 20 * S;
        let x = r() * W, y = 0;
        ctx.beginPath(); ctx.moveTo(x, y);
        while (y < H * 0.8) { x += (r() - 0.5) * 80 * S; y += 20 + r() * 40 * S; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      // rain in the storm
      ctx.strokeStyle = 'rgba(200,210,240,0.3)'; ctx.lineWidth = S; ctx.shadowBlur = 0; ctx.beginPath();
      for (const p of particles('storm', 160)) { const y = mod(p.y * H + t * 900 * S, H + 30) - 30; ctx.moveTo(p.x * W, y); ctx.lineTo(p.x * W - 3 * S, y + 22 * S); }
      ctx.stroke();
      break;
    }

    // ---- graphic / retro -----------------------------------------------------
    case 'halftone': {
      // comic-book dot screen, dots breathe slowly
      fill(ctx, W, H, c1);
      const step = 22 * S;
      ctx.fillStyle = rgba(c2, 0.55);
      for (let y = 0; y < H + step; y += step) for (let x = ((y / step) % 2) * step / 2; x < W + step; x += step) {
        const d = Math.hypot(x - W / 2, y - H / 2) / Math.max(W, H);
        const rad = step * 0.42 * (0.35 + 0.65 * d) * (0.9 + 0.1 * Math.sin(t * 3 + d * 10));
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'speedlines': {
      // anime speed lines rushing towards the centre
      fill(ctx, W, H, c1);
      const cx = W / 2, cy = H / 2, R = Math.max(W, H);
      const r = rng(Math.floor(t * 18));
      ctx.fillStyle = c2;
      for (let i = 0; i < 70; i++) {
        const a = r() * Math.PI * 2, w = 0.004 + r() * 0.012, inner = R * (0.18 + r() * 0.25);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a - w) * R, cy + Math.sin(a - w) * R); ctx.lineTo(cx + Math.cos(a + w) * R, cy + Math.sin(a + w) * R); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'comicflip': {
      // fast-flipping comic panels: columns of coloured frames racing upwards (used inside the "marvel" entrance)
      fill(ctx, W, H, c1);
      const cols = 7, cw = W / cols;
      const palette = [c2, '#ffffff', '#1b1b1b', '#f5d142', '#2a6fdb', c2, '#e8e8e8', c2];
      const r = rng(5);
      for (let i = 0; i < cols; i++) {
        const speed = (1400 + r() * 900) * S, ph = r() * 1000, ch = (90 + r() * 120) * S;
        const off = mod(t * speed + ph, ch);
        for (let y = -ch + off; y < H; y += ch) {
          const idx = Math.floor((y + 50000 - off) / ch + i * 3);
          ctx.fillStyle = palette[mod(idx * 7 + i, palette.length)];
          ctx.fillRect(i * cw, y, cw - 3 * S, ch - 4 * S);
          ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(i * cw, y + ch * 0.35, cw - 3 * S, ch * 0.08);
        }
      }
      // motion blur streaks
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < cols; i++) ctx.fillRect(i * cw + cw * 0.3, 0, cw * 0.1, H);
      break;
    }
    case 'grid': {
      // synthwave: perspective floor grid scrolling towards the camera, sun on the horizon
      verticalGradient(ctx, W, H, c1, c2);
      const hy = H * 0.55;
      const sun = ctx.createLinearGradient(0, hy - H * 0.3, 0, hy); sun.addColorStop(0, '#ffe36b'); sun.addColorStop(1, '#ff2d95');
      ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(W / 2, hy, H * 0.28, Math.PI, 0); ctx.fill();
      ctx.fillStyle = c1; ctx.fillRect(0, hy, W, H - hy);
      ctx.strokeStyle = '#ff2d95'; ctx.lineWidth = 1.5 * S; ctx.shadowColor = '#ff2d95'; ctx.shadowBlur = 6 * S;
      ctx.beginPath();
      for (let i = -12; i <= 12; i++) { ctx.moveTo(W / 2 + i * W * 0.04, hy); ctx.lineTo(W / 2 + i * W * 0.5, H); }
      const n = 12, scroll = mod(t * 0.5, 1);
      for (let k = 0; k < n; k++) { const v = (k + scroll) / n; const y = hy + (H - hy) * v * v; ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      ctx.shadowBlur = 0;
      break;
    }
    case 'plasma': {
      // smooth colour blobs (lava-lamp / 70s)
      fill(ctx, W, H, c1);
      ctx.globalCompositeOperation = 'lighter';
      const cols = [c2, '#ff6f61', '#ffd166', '#06d6a0', '#118ab2'];
      cols.forEach((col, i) => {
        const x = W * (0.5 + 0.35 * Math.sin(t * 0.4 + i * 1.9)), y = H * (0.5 + 0.35 * Math.cos(t * 0.33 + i * 1.3)), rad = Math.max(W, H) * (0.3 + 0.1 * Math.sin(t + i));
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, rgba(col, 0.5)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      });
      break;
    }
    case 'static': {
      // TV noise, slightly tinted
      const r = rng(Math.floor(t * 30) * 1237 + 3);
      fill(ctx, W, H, c1);
      const cell = 4 * S;
      for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) { const v = r(); if (v > 0.5) { ctx.fillStyle = `rgba(255,255,255,${(v - 0.5) * 0.9})`; ctx.fillRect(x, y, cell, cell); } }
      const bar = mod(t * 200, H + 100) - 50;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, bar, W, 30 * S);
      break;
    }
    case 'stripes': {
      // diagonal moving stripes (sports / broadcast)
      fill(ctx, W, H, c1);
      ctx.fillStyle = c2;
      const w = 90 * S, off = mod(t * 160 * S, w * 2);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-0.4); ctx.translate(-W, -H);
      for (let x = -w * 2 + off; x < W * 2 + w; x += w * 2) ctx.fillRect(x, 0, w, H * 2);
      ctx.restore();
      break;
    }
    case 'checker': {
      fill(ctx, W, H, c1);
      ctx.fillStyle = c2;
      const s = 80 * S, off = mod(t * 40 * S, s * 2);
      for (let y = -s * 2; y < H + s; y += s) for (let x = -s * 2 + off; x < W + s * 2; x += s * 2) ctx.fillRect(x + (Math.round(y / s) % 2) * s, y, s, s);
      break;
    }
    case 'memphis': {
      // 90s pattern: squiggles, triangles, dots bobbing around
      fill(ctx, W, H, c1);
      const colors = [c2, '#ff6f91', '#ffc75f', '#2ec4b6', '#845ec2'];
      ctx.lineWidth = 5 * S; ctx.lineCap = 'round';
      particles('memphis', 36).forEach((p, i) => {
        const x = p.x * W + Math.sin(t + p.tw) * 10 * S, y = p.y * H + Math.cos(t * 1.2 + p.tw) * 10 * S, s = (18 + p.z * 30) * S;
        const col = colors[i % colors.length];
        ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.tw + t * 0.2);
        if (i % 3 === 0) { ctx.beginPath(); ctx.moveTo(-s, 0); for (let k = 0; k <= 8; k++) ctx.lineTo(-s + (k / 8) * 2 * s, Math.sin(k * 1.6) * s * 0.4); ctx.stroke(); }
        else if (i % 3 === 1) { ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s, s * 0.8); ctx.lineTo(-s, s * 0.8); ctx.closePath(); ctx.stroke(); }
        else { for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(-s + k * s, 0, s * 0.18, 0, Math.PI * 2); ctx.fill(); } }
        ctx.restore();
      });
      break;
    }
    case 'paper': {
      // warm paper with fibres and a soft vignette (letters, invitations)
      fill(ctx, W, H, c1);
      const r = rng(31);
      ctx.strokeStyle = 'rgba(0,0,0,0.05)'; ctx.lineWidth = S;
      for (let i = 0; i < 300; i++) { const x = r() * W, y = r() * H; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 30 * S, y + (r() - 0.5) * 6 * S); ctx.stroke(); }
      const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, Math.max(W, H) * 0.8);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, rgba(c2, 0.35));
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'chalkboard': {
      fill(ctx, W, H, c1);
      const r = rng(77);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 1200; i++) ctx.fillRect(r() * W, r() * H, (1 + r() * 3) * S, (1 + r() * 2) * S);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      for (let i = 0; i < 6; i++) { ctx.save(); ctx.translate(r() * W, r() * H); ctx.rotate((r() - 0.5) * 0.4); ctx.fillRect(-200 * S, 0, 400 * S, 40 * S); ctx.restore(); }
      ctx.strokeStyle = c2; ctx.lineWidth = 18 * S; ctx.strokeRect(9 * S, 9 * S, W - 18 * S, H - 18 * S);
      break;
    }
    case 'hud': {
      // sci-fi interface: rotating rings, ticks and a sweeping radar line
      fill(ctx, W, H, c1);
      const cx = W / 2, cy = H / 2;
      ctx.strokeStyle = rgba(c2, 0.55); ctx.lineWidth = 1.5 * S;
      for (let i = 1; i <= 4; i++) {
        const R = H * 0.12 * i;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * (i % 2 ? 0.2 : -0.15) * (5 - i));
        ctx.setLineDash([R * 0.3, R * 0.12 * i]); ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(c2, 0.2);
      for (let x = 0; x < W; x += 60 * S) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 60 * S) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      const a = t * 1.2, R = H * 0.5;
      const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.addColorStop(0, rgba(c2, 0)); g.addColorStop(1, rgba(c2, 0.5));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a - 0.6, a); ctx.closePath(); ctx.fill();
      break;
    }
    case 'blueprint': {
      fill(ctx, W, H, c1);
      ctx.strokeStyle = rgba(c2, 0.35); ctx.lineWidth = S;
      const s = 40 * S, off = mod(t * 10 * S, s);
      for (let x = -s + off; x < W; x += s) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = -s + off; y < H; y += s) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.strokeStyle = rgba(c2, 0.7); ctx.lineWidth = 2 * S;
      for (let x = -s * 5 + off; x < W; x += s * 5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = -s * 5 + off; y < H; y += s * 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      break;
    }
  }
  ctx.restore();
}

export const BACKDROP_LABELS: Record<TextBackdrop, string> = {
  none: 'None (transparent)', solid: 'Solid colour', starfield: 'Starfield (space)', nebula: 'Nebula', gradient: 'Moving gradient',
  film: 'Old film (grain, vignette)', matrix: 'Matrix rain', bokeh: 'Bokeh lights', scanlines: 'CRT scanlines',
  disco: 'Disco lights', confetti: 'Confetti', fireworks: 'Fireworks', hearts: 'Floating hearts', bubbles: 'Bubbles', glitter: 'Glitter sparkles',
  clouds: 'Sky with clouds', moon: 'Moon night', sunburst: 'Sunburst rays', rays: 'God rays', searchlights: 'Premiere searchlights', sunset: 'Retro sunset',
  ocean: 'Ocean waves', aurora: 'Aurora', rain: 'Rain', snow: 'Snow', leaves: 'Autumn leaves', petals: 'Cherry petals', fire: 'Fire', lightning: 'Storm',
  halftone: 'Comic halftone', speedlines: 'Anime speed lines', comicflip: 'Flipping comic pages', grid: 'Synthwave grid', plasma: 'Plasma / lava lamp',
  static: 'TV static', stripes: 'Diagonal stripes', checker: 'Checkerboard', memphis: '90s Memphis shapes', paper: 'Paper', chalkboard: 'Chalkboard',
  hud: 'Sci-fi HUD', blueprint: 'Blueprint grid', castle: 'Fairy-tale castle at night', premiere: 'Sunset lot with searchlights',
};
