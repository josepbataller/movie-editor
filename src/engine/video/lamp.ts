import { ease } from './animation';

// A desk lamp (Luxo-style) for the "lamp" title animation: it hops in from the right,
// lands on one letter, squashes it flat with a few bounces, settles in its place, turns
// to the camera and switches off. Everything is a function of time so preview and
// export agree. Coordinates: the lamp "foot" (bottom centre of the base) is at (x, y);
// the lamp faces left (-x); `L` is its size unit (≈ 0.45 × font size).

export interface LampPose {
  x: number; y: number; L: number;
  squashX: number; squashY: number;   // body squash & stretch
  crouch: number;                     // 0..1 arms folded on landing
  aim: number;                        // radians the head points below the horizontal (facing left)
  face: number;                       // 0..1 head turned towards the camera
  light: number;                      // 0..1 bulb intensity
  shadow: number;                     // 0..1 contact shadow strength
}

export interface LampState extends LampPose {
  letterSy: number;                   // vertical scale of the letter being squashed (1 = intact)
  dark: number;                       // 0..1 room darkening after the light goes off
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The choreography at progress `u` (0..1 = the entrance duration; > 1 holds the final pose).
 * ground = baseline of the target letter, letterTop = its top when intact, xT = its centre.
 */
export function lampChoreography(u: number, xStart: number, xT: number, ground: number, letterH: number, L: number): LampState {
  const A = 0.5, B = 0.8, S = 0.9, K = 0.95;
  const SY = [1, 0.62, 0.3, 0.08];
  const base: LampState = { x: xT, y: ground - letterH * 0.08, L, squashX: 1, squashY: 1, crouch: 0, aim: 0, face: 1, light: 0, shadow: 1, letterSy: 0.08, dark: 1 };
  if (u >= 1) return base;

  // squash on take-off / landing, stretch mid-air
  const squash = (h: number, amount: number) => {
    const s = h < 0.1 ? 1 - h / 0.1 : h > 0.9 ? (h - 0.9) / 0.1 : 0;
    const air = 4 * h * (1 - h) * (1 - s);
    return { s, squashY: 1 - amount * s + 0.08 * air, squashX: 1 + amount * 0.8 * s - 0.04 * air };
  };

  if (u < A) {
    // three hops from off-screen right; the last one lands on top of the letter
    const p = u / A, hop = Math.min(2, Math.floor(p * 3)), h = p * 3 - hop;
    const xs = [xStart, lerp(xStart, xT, 0.42), lerp(xStart, xT, 0.76), xT];
    const yEnd = hop === 2 ? ground - letterH : ground;
    const hopH = L * 1.4;
    const y = lerp(ground, yEnd, ease('ease', h)) - hopH * 4 * h * (1 - h);
    const q = squash(h, 0.18);
    return { ...base, x: lerp(xs[hop], xs[hop + 1], h), y, squashX: q.squashX, squashY: q.squashY, crouch: q.s * 0.7, aim: 0.45, face: 0, light: 1,
      shadow: clamp01(1 - (ground - y) / (2.5 * L)) * 0.8 + 0.2, letterSy: 1, dark: 0 };
  }
  if (u < B) {
    // three bounces on the letter, each landing flattens it a bit more
    const p = (u - A) / (B - A), b = Math.min(2, Math.floor(p * 3)), h = p * 3 - b;
    const letterSy = h > 0.85 ? lerp(SY[b], SY[b + 1], ease('ease', (h - 0.85) / 0.15)) : SY[b];
    const top = ground - letterH * letterSy;
    const bounceH = L * (1.1 - b * 0.25);
    const q = squash(h, 0.26);
    return { ...base, x: xT, y: top - bounceH * 4 * h * (1 - h), squashX: q.squashX, squashY: q.squashY, crouch: q.s * 0.8, aim: 0.65, face: 0, light: 1, shadow: 1, letterSy, dark: 0 };
  }
  if (u < S) {
    // settle and turn to the camera
    const p = ease('ease', (u - B) / (S - B));
    return { ...base, squashY: 1 - 0.12 * (1 - p) * Math.cos(p * Math.PI * 1.5), squashX: 1 + 0.08 * (1 - p), aim: 0.65 * (1 - p), face: p, light: 1, dark: 0 };
  }
  if (u < K) return { ...base, light: 1, dark: 0 };
  // click: light off, room goes dark
  const off = clamp01((u - K) / (1 - K));
  return { ...base, light: off < 0.3 ? 1 - off / 0.3 : 0, dark: ease('ease', off) };
}

export function drawLamp(ctx: CanvasRenderingContext2D, p: LampPose) {
  const { L } = p;
  ctx.save();
  // contact shadow on the floor
  if (p.shadow > 0) {
    ctx.fillStyle = `rgba(20,30,40,${0.22 * p.shadow})`;
    ctx.beginPath(); ctx.ellipse(p.x, p.y + L * 0.04, L * (0.5 + 0.5 * (1 - p.shadow)), L * 0.09, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.translate(p.x, p.y);
  ctx.scale(p.squashX, p.squashY);

  // base
  const bg = ctx.createLinearGradient(0, -L * 0.12, 0, 0);
  bg.addColorStop(0, '#aeb6bf'); bg.addColorStop(0.5, '#7b848e'); bg.addColorStop(1, '#4a5159');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(-L * 0.44, -L * 0.12, L * 0.88, L * 0.12, L * 0.04); ctx.fill();

  // arms (facing left): lower arm leans back, upper arm reaches forward
  const j0 = { x: 0, y: -L * 0.12 };
  const len1 = L * 1.15 * (1 - 0.3 * p.crouch), len2 = L * 0.95 * (1 - 0.15 * p.crouch);
  const a1 = { x: 0.3, y: -1 }, n1 = Math.hypot(a1.x, a1.y);
  const elbow = { x: j0.x + (a1.x / n1) * len1, y: j0.y + (a1.y / n1) * len1 };
  const a2 = { x: -0.92, y: -0.3 - 0.5 * p.crouch }, n2 = Math.hypot(a2.x, a2.y);
  const head = { x: elbow.x + (a2.x / n2) * len2, y: elbow.y + (a2.y / n2) * len2 };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#6e767f'; ctx.lineWidth = L * 0.075;
  ctx.beginPath(); ctx.moveTo(j0.x, j0.y); ctx.lineTo(elbow.x, elbow.y); ctx.lineTo(head.x, head.y); ctx.stroke();
  // springs: thin parallel wires on the lower arm
  ctx.strokeStyle = '#4a5159'; ctx.lineWidth = L * 0.018;
  ctx.beginPath(); ctx.moveTo(j0.x - L * 0.06, j0.y); ctx.lineTo(elbow.x - L * 0.06, elbow.y + L * 0.05); ctx.stroke();
  ctx.fillStyle = '#3b4249';
  for (const j of [j0, elbow]) { ctx.beginPath(); ctx.arc(j.x, j.y, L * 0.065, 0, Math.PI * 2); ctx.fill(); }

  // head: side view (cone) crossfaded with the front view (circle looking at the camera)
  const ang = Math.PI - p.aim;                       // facing left, tilted down by aim
  const dir = { x: Math.cos(ang), y: Math.sin(ang) }, nrm = { x: -dir.y, y: dir.x };
  const back = { x: head.x - dir.x * L * 0.1, y: head.y - dir.y * L * 0.1 };
  const front = { x: head.x + dir.x * L * 0.45, y: head.y + dir.y * L * 0.45 };
  const side = 1 - p.face;
  if (side > 0.01) {
    ctx.save(); ctx.globalAlpha *= side;
    if (p.light > 0.01) {
      // light cone on the scene
      const far = { x: front.x + dir.x * L * 2.8, y: front.y + dir.y * L * 2.8 }, spread = L * 0.3 + L * 2.8 * 0.42;
      const g = ctx.createLinearGradient(front.x, front.y, far.x, far.y);
      g.addColorStop(0, `rgba(255,250,225,${0.45 * p.light})`); g.addColorStop(1, 'rgba(255,250,225,0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(front.x + nrm.x * L * 0.3, front.y + nrm.y * L * 0.3); ctx.lineTo(far.x + nrm.x * spread, far.y + nrm.y * spread);
      ctx.lineTo(far.x - nrm.x * spread, far.y - nrm.y * spread); ctx.lineTo(front.x - nrm.x * L * 0.3, front.y - nrm.y * L * 0.3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // shade
    const sg = ctx.createLinearGradient(head.x + nrm.x * L * 0.3, head.y + nrm.y * L * 0.3, head.x - nrm.x * L * 0.3, head.y - nrm.y * L * 0.3);
    sg.addColorStop(0, '#c3cad2'); sg.addColorStop(0.5, '#7d858e'); sg.addColorStop(1, '#3e454c');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(back.x + nrm.x * L * 0.12, back.y + nrm.y * L * 0.12); ctx.lineTo(front.x + nrm.x * L * 0.32, front.y + nrm.y * L * 0.32);
    ctx.lineTo(front.x - nrm.x * L * 0.32, front.y - nrm.y * L * 0.32); ctx.lineTo(back.x - nrm.x * L * 0.12, back.y - nrm.y * L * 0.12); ctx.closePath(); ctx.fill();
    // opening with the bulb
    ctx.save(); ctx.translate(front.x, front.y); ctx.rotate(ang);
    ctx.fillStyle = p.light > 0.01 ? `rgba(255,246,200,${0.6 + 0.4 * p.light})` : '#2a2e33';
    ctx.beginPath(); ctx.ellipse(0, 0, L * 0.1, L * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (p.light > 0.01) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const bulb = ctx.createRadialGradient(front.x, front.y, 0, front.x, front.y, L * 0.5);
      bulb.addColorStop(0, `rgba(255,250,220,${0.8 * p.light})`); bulb.addColorStop(1, 'rgba(255,250,220,0)');
      ctx.fillStyle = bulb; ctx.beginPath(); ctx.arc(front.x, front.y, L * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
  if (p.face > 0.01) {
    ctx.save(); ctx.globalAlpha *= p.face;
    const c = { x: head.x - L * 0.12, y: head.y - L * 0.05 };
    if (p.light > 0.01) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(c.x, c.y, L * 0.1, c.x, c.y, L * 1.6);
      glow.addColorStop(0, `rgba(255,250,220,${0.75 * p.light})`); glow.addColorStop(1, 'rgba(255,250,220,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(c.x, c.y, L * 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    const rim = ctx.createRadialGradient(c.x - L * 0.1, c.y - L * 0.1, L * 0.05, c.x, c.y, L * 0.36);
    rim.addColorStop(0, '#b8c0c8'); rim.addColorStop(1, '#3e454c');
    ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(c.x, c.y, L * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.light > 0.01 ? `rgba(255,246,200,${0.7 + 0.3 * p.light})` : '#23272c';
    ctx.beginPath(); ctx.arc(c.x, c.y, L * 0.27, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.light > 0.01 ? '#ffffff' : '#3a3f45';
    ctx.beginPath(); ctx.arc(c.x, c.y, L * 0.11, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Index of the letter the lamp should land on: the first I-like narrow letter, else the middle one. */
export function pickLampTarget(chars: { ch: string }[]): number {
  const printable = chars.map((c, i) => ({ i, ch: c.ch })).filter((c) => /\S/.test(c.ch));
  if (!printable.length) return -1;
  for (const pref of ['I', 'i', 'l', '1', 'T', 'J', 'L']) { const hit = printable.find((c) => c.ch === pref); if (hit) return hit.i; }
  return printable[Math.floor(printable.length / 2)].i;
}
