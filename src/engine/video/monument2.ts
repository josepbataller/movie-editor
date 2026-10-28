import type { TextProps } from '@/shared/types';
import { drawBackdrop } from './backdrops';
import { ease } from './animation';
import { fontString, layer, scratchCanvas, frameOf, type TextFrame } from './textRender';

type Point = { x: number; y: number; z: number };
const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** Canvas-only perspective scene. All motion is a function of clip time, including light. */
export function renderMonument2(t: TextProps, W: number, H: number, localT: number, duration: number): TextFrame {
  const ctx = scratchCanvas(W, H);
  const D = Math.max(1, Math.min(t.animationDuration, duration));
  const time = Math.max(0, Math.min(localT, D));
  const p = ease('ease', clamp(time / D));
  drawBackdrop(ctx, t.backdrop, W, H, time, t.backdropColor, t.backdropColor2);
  const exit = t.exitAnimation === 'none' ? 1 : 1 - ease('ease', clamp((localT - duration + t.exitDuration) / Math.max(0.01, t.exitDuration)));
  const lines = t.content.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return frameOf(ctx, W, H);

  // World coordinates: y points up, negative z is towards the viewer.
  const heights = lines.map((_, i) => i === 0 ? 150 : 112);
  // Leave headroom for the rear edge of the slab above as the camera orbits.
  const tierSpacing = 48;
  const total = heights.reduce((a, b) => a + b + tierSpacing, 0) + 100;
  const size = Math.min(W / 1280, H / 720) * Math.min(1, 550 / total) * Math.max(0.15, t.fontSize / 210);
  const yaw = -0.58 + 0.34 * p, pitch = 0.13 + 0.025 * p;
  const distance = 1750 + 200 * p;
  const project = (x: number, y: number, z: number): Point => {
    const rx = x * Math.cos(yaw) + z * Math.sin(yaw);
    const rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
    const yy = y - total * 0.48;
    const ry = yy * Math.cos(pitch) - rz * Math.sin(pitch);
    const depth = rz * Math.cos(pitch) + yy * Math.sin(pitch);
    const k = 1900 / Math.max(300, distance + depth);
    return { x: W / 2 + (rx * k + (1 - p) * 40) * size, y: H * (0.53 + (t.offsetY ?? 0)) - ry * k * size, z: depth };
  };
  const polygon = (points: Point[], color: string | CanvasGradient, edge = false) => {
    ctx.beginPath(); points.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    if (edge) { ctx.strokeStyle = 'rgba(255,222,151,0.35)'; ctx.lineWidth = Math.max(0.5, size); ctx.stroke(); }
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, top: string, front: string, side: string) => {
    const v = [project(x-w/2,y,z), project(x+w/2,y,z), project(x+w/2,y+h,z), project(x-w/2,y+h,z),
      project(x-w/2,y,z+d), project(x+w/2,y,z+d), project(x+w/2,y+h,z+d), project(x-w/2,y+h,z+d)];
    polygon([v[0],v[4],v[7],v[3]], side);
    polygon([v[1],v[5],v[6],v[2]], side);
    const grad = ctx.createLinearGradient(0, v[2].y, 0, v[1].y);
    grad.addColorStop(0, front); grad.addColorStop(1, '#241624');
    polygon([v[0],v[1],v[2],v[3]], grad, true);
    polygon([v[3],v[2],v[6],v[7]], top, true);
  };
  // A textured letter plane is split into narrow strips: each gets its own projected basis.
  // This preserves perspective across long words without WebGL or external assets.
  const plane = (image: HTMLCanvasElement, w: number, h: number, y: number, z: number) => {
    const strips = 24;
    for (let j = 0; j < strips; j++) {
      const sx = image.width * j / strips, sw = image.width / strips;
      const x = -w/2 + w*j/strips;
      const a = project(x, y+h, z), b = project(x+w/strips, y+h, z), c = project(x, y, z);
      ctx.save();
      ctx.transform((b.x-a.x)/sw, (b.y-a.y)/sw, (c.x-a.x)/image.height, (c.y-a.y)/image.height, a.x, a.y);
      ctx.drawImage(image, sx, 0, sw, image.height, 0, 0, sw+1, image.height);
      ctx.restore();
    }
  };

  ctx.save(); ctx.globalAlpha = exit * clamp(localT * 2);
  // Rooftop and radial architectural wings anchor the monument in a physical space.
  box(0, -400, -175, 1250, 400, 720, '#3f3347', '#362636', '#191827');
  box(0, 0, -100, 990, 24, 450, '#bc8d53', '#86603a', '#443045');
  box(0, 24, -55, 850, 64, 330, '#ac793d', '#916232', '#3d2932');
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 3; i++) box(sign * (470 + i*48), 0, 30+i*60, 65, 52-i*12, 90, '#936847', '#62422f', '#2e2538');
  }
  // Art Deco fluting across the foundation, projected like the rest of the building.
  for (let x = -380; x <= 380; x += 38) box(x, 27, -58, 8, 54, 3, '#d2a65b', '#b18443', '#4c3028');

  let y = total;
  const rows = lines.map((line, i) => {
    const h = heights[i]; y -= h + tierSpacing;
    const m = layer('monument2-measure', 1, 1);
    m.font = fontString(t, h / 0.75); m.letterSpacing = `${t.letterSpacing || 0}px`;
    const width = Math.max(1, m.measureText(line).width);
    return { line, h, y, w: Math.min(i === 0 ? 520 : 760, width), fontSize: h/0.75 };
  });
  // Draw from the lower tiers upward so the front lettering hides rear extrusion.
  for (let i = rows.length-1; i >= 0; i--) {
    const row = rows[i], slabW = Math.max(row.w + 46, 560 + i*80);
    box(0, row.y-2, -42, slabW+18, 11, 142, '#f0c879', '#af7940', '#755039');
    box(0, row.y+9, -32, slabW, 15, 120, '#f9d787', '#b58142', '#60402c');
    const tw = Math.ceil(Math.min(2048, Math.max(64, row.w*2))), th = Math.ceil(row.h*2+12);
    const texture = layer('monument2-letters', tw, th);
    texture.font = fontString(t, row.fontSize*2); texture.letterSpacing = `${(t.letterSpacing || 0)*2}px`;
    texture.textAlign = 'center'; texture.textBaseline = 'alphabetic';
    const metric = texture.measureText(row.line);
    const glyphHeight = Math.max(1, metric.actualBoundingBoxAscent + metric.actualBoundingBoxDescent);
    // Fit the actual ink, rather than the font's line box, to each architectural tier.
    const paintLetters = (fill: string | CanvasGradient, outline: boolean) => {
      texture.save(); texture.translate(tw/2, th-4);
      texture.scale(Math.min(1, (tw-10)/Math.max(1, metric.width)), (th-8)/glyphHeight);
      texture.translate(0, -metric.actualBoundingBoxDescent);
      texture.fillStyle = fill; texture.fillText(row.line, 0, 0);
      if (outline) { texture.strokeStyle = '#fff0b3'; texture.lineWidth = 1.1; texture.strokeText(row.line, 0, 0); }
      texture.restore();
    };
    paintLetters(t.extrudeColor || '#654019', false);
    for (let z = 60; z >= 0; z -= 6) plane(texture.canvas, row.w, row.h, row.y+24, z);
    texture.clearRect(0,0,tw,th);
    // Sky reflection and a travelling highlight change with the same clock as the lamps.
    const gold = texture.createLinearGradient(-tw/2, -glyphHeight, tw*0.25, 0);
    gold.addColorStop(0, '#fff1b4'); gold.addColorStop(0.24, '#f6cd74'); gold.addColorStop(0.48, '#ae6a30');
    gold.addColorStop(0.56, '#ffe7a0'); gold.addColorStop(0.8, t.color); gold.addColorStop(1, '#91603c');
    paintLetters(gold, true);
    texture.globalCompositeOperation = 'source-atop';
    const sweep = tw * (0.5 + 0.55*Math.sin(time*0.65+i*0.7));
    const shine = texture.createLinearGradient(sweep-tw*0.2,0,sweep+tw*0.2,0);
    shine.addColorStop(0,'#fff8d500'); shine.addColorStop(0.5,'#fff8d57a'); shine.addColorStop(1,'#fff8d500');
    texture.fillStyle = shine; texture.fillRect(0,0,tw,th); texture.globalCompositeOperation = 'source-over';
    plane(texture.canvas, row.w, row.h, row.y+24, -1);
  }

  // Foreground lamp fixtures share their projected origins with the light cones.
  for (const [i, x] of [-510, -395, 395, 510].entries()) {
    const z = i % 2 ? -110 : -20;
    box(x, 0, z, 50, 36, 55, '#b68b55', '#70543f', '#292535');
    const origin = project(x, 61, z+10);
    const angle = Math.sin(time*0.61 + i*1.7)*0.72 + (x < 0 ? 0.2 : -0.2);
    const length = H*1.25;
    const end = { x: origin.x+Math.sin(angle)*length, y: origin.y-Math.cos(angle)*length };
    const spread = W*0.075;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const beam = ctx.createLinearGradient(origin.x,origin.y,end.x,end.y);
    beam.addColorStop(0, 'rgba(255,240,200,0.32)'); beam.addColorStop(0.55,'rgba(205,218,255,0.12)'); beam.addColorStop(1,'rgba(205,218,255,0)');
    polygon([origin,{x:end.x-spread,y:end.y,z:0},{x:end.x+spread,y:end.y,z:0}],beam);
    ctx.restore();
    ctx.save(); ctx.translate(origin.x,origin.y); ctx.rotate(angle);
    ctx.fillStyle = '#171a2c'; ctx.fillRect(-13*size,-7*size,26*size,19*size);
    ctx.fillStyle = '#fff1cb'; ctx.beginPath(); ctx.ellipse(0,-7*size,12*size,4*size,0,0,Math.PI*2); ctx.fill();
    ctx.restore();
    const glow = ctx.createRadialGradient(origin.x,origin.y,0,origin.x,origin.y,Math.max(1,30*size));
    glow.addColorStop(0,'rgba(255,229,168,0.6)'); glow.addColorStop(1,'rgba(255,229,168,0)');
    ctx.fillStyle = glow; ctx.fillRect(origin.x-30*size,origin.y-30*size,60*size,60*size);
  }
  ctx.restore();
  return frameOf(ctx, W, H);
}
