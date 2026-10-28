import type { TextBackdrop } from '@/shared/types';

// Animated full-frame backgrounds for title clips (starfield, nebula, film grain…).
// Deterministic in `t` (seconds), so the live preview and the frame exporter agree.

/** Small deterministic PRNG so star positions etc. are stable between frames. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

const starCache = new Map<string, { x: number; y: number; z: number; tw: number }[]>();
function stars(W: number, H: number, count: number) {
  const key = `${W}x${H}:${count}`;
  let s = starCache.get(key);
  if (!s) {
    const r = rng(1234);
    s = Array.from({ length: count }, () => ({ x: r() * W, y: r() * H, z: 0.3 + r() * 0.7, tw: r() * Math.PI * 2 }));
    starCache.set(key, s);
  }
  return s;
}

export function drawBackdrop(ctx: CanvasRenderingContext2D, kind: TextBackdrop | undefined, W: number, H: number, t: number, c1 = '#000000', c2 = '#1a237e') {
  if (!kind || kind === 'none') return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  switch (kind) {
    case 'solid': {
      ctx.fillStyle = c1; ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'starfield': {
      ctx.fillStyle = c1; ctx.fillRect(0, 0, W, H);
      // faint milky way band
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, rgba(c2, 0.18)); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // stars slowly drifting outwards from the centre, twinkling
      const list = stars(W, H, Math.round((W * H) / 2600));
      const cx = W / 2, cy = H / 2;
      for (const s of list) {
        const drift = 1 + t * 0.012 * s.z;
        let x = cx + (s.x - cx) * drift, y = cy + (s.y - cy) * drift;
        // wrap stars that left the frame back near the centre
        if (x < 0 || x > W || y < 0 || y > H) { x = cx + ((s.x - cx) * drift) % (W / 2); y = cy + ((s.y - cy) * drift) % (H / 2); }
        const tw = 0.55 + 0.45 * Math.sin(t * (1 + s.z * 2) + s.tw);
        const r = s.z * 1.6 * (W / 1280);
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.65 * s.z) * tw})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'nebula': {
      ctx.fillStyle = c1; ctx.fillRect(0, 0, W, H);
      const blobs = [[0.3, 0.4, 0.45, c2], [0.7, 0.6, 0.4, '#b85fa8'], [0.5, 0.25, 0.3, '#2bb3c4'], [0.2, 0.8, 0.35, c2]] as const;
      blobs.forEach(([bx, by, br, col], i) => {
        const x = W * (bx + 0.05 * Math.sin(t * 0.15 + i)), y = H * (by + 0.05 * Math.cos(t * 0.12 + i * 2));
        const rad = Math.max(W, H) * br;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, rgba(col, 0.55)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      });
      // sprinkle of stars
      for (const s of stars(W, H, 160)) { ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * s.z})`; ctx.fillRect(s.x, s.y, 1.5, 1.5); }
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
      ctx.fillStyle = c1; ctx.fillRect(0, 0, W, H);
      // grain: a seeded speckle pattern that changes every frame
      const r = rng(Math.floor(t * 24) * 7919 + 17);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      const n = Math.round((W * H) / 900);
      for (let i = 0; i < n; i++) ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
      // scratches
      if (r() < 0.25) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; const x = r() * W; ctx.fillRect(x, 0, 1, H); }
      // vignette + flicker
      const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(255,240,200,${0.03 + 0.03 * Math.sin(t * 17)})`; ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'matrix': {
      ctx.fillStyle = c1; ctx.fillRect(0, 0, W, H);
      const col = Math.max(14, Math.round(W / 70));
      const cols = Math.ceil(W / col);
      ctx.font = `${col}px Consolas, monospace`;
      ctx.textBaseline = 'top';
      const r = rng(99);
      for (let i = 0; i < cols; i++) {
        const speed = 60 + r() * 140, offset = r() * H * 3, len = 8 + Math.floor(r() * 14);
        const head = ((t * speed + offset) % (H + len * col)) - len * col;
        for (let k = 0; k < len; k++) {
          const y = head + k * col;
          if (y < -col || y > H) continue;
          const ch = String.fromCharCode(0x30a0 + Math.floor(((i * 31 + k * 17 + Math.floor(t * 8 + i)) * 7) % 96));
          const fade = k / len;
          ctx.fillStyle = k === len - 1 ? '#d8ffd8' : rgba(c2 === '#1a237e' ? '#39ff14' : c2, 0.15 + 0.85 * fade);
          ctx.fillText(ch, i * col, y);
        }
      }
      break;
    }
    case 'bokeh': {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, c1); g.addColorStop(1, c2);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const r = rng(4242);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 28; i++) {
        const bx = r() * W, by = r() * H, rad = (20 + r() * 70) * (W / 1280), sp = 0.1 + r() * 0.3, ph = r() * 6.28;
        const x = bx + Math.sin(t * sp + ph) * 40, y = by - ((t * 15 * sp) % (H + 200)) + 100;
        const yy = ((y % (H + 200)) + H + 200) % (H + 200) - 100;
        const gg = ctx.createRadialGradient(x, yy, rad * 0.2, x, yy, rad);
        const hue = (i * 37) % 360;
        gg.addColorStop(0, `hsla(${hue},80%,70%,0.35)`); gg.addColorStop(0.8, `hsla(${hue},80%,60%,0.12)`); gg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, yy, rad, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'scanlines': {
      ctx.fillStyle = c1; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = rgba(c2, 0.25);
      const roll = (t * 40) % 6;
      for (let y = -6 + roll; y < H; y += 3) ctx.fillRect(0, y, W, 1);
      // rolling bright bar like an old CRT
      const bar = ((t * 120) % (H + 200)) - 100;
      const g = ctx.createLinearGradient(0, bar - 60, 0, bar + 60);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, bar - 60, W, 120);
      break;
    }
  }
  ctx.restore();
}

export const BACKDROP_LABELS: Record<TextBackdrop, string> = {
  none: 'None (transparent)', solid: 'Solid colour', starfield: 'Starfield (space)', nebula: 'Nebula', gradient: 'Moving gradient',
  film: 'Old film (grain, vignette)', matrix: 'Matrix rain', bokeh: 'Bokeh lights', scanlines: 'CRT scanlines',
};
