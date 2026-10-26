import { useEffect, useRef, useState } from 'react';
import { useProject } from '@/store/useProject';
import { TextProps, TextAnimation, TextExitAnimation, DEFAULT_TEXT, fadeFactor } from '@/shared/types';
import { renderTextFrame, FONT_CHOICES } from '@/engine/video/textRender';
import { clipBoundsWith, drawFrame, previewSource } from '@/engine/video/compositor';

// Title Studio: a focused, Canva-like editor for one text clip with a live,
// scrubbable animation preview. Everything it writes goes straight to the store,
// so the timeline / inspector stay in sync.

interface Template { id: string; label: string; emoji: string; hint: string; text: Partial<TextProps>; y?: number; bg?: string }

const TEMPLATES: Template[] = [
  { id: 'title', label: 'Big title', emoji: '🎬', hint: 'Bold centred title, fades in and out',
    text: { fontFamily: 'Segoe UI', fontSize: 120, bold: true, italic: false, color: '#ffffff', align: 'center', shadow: true, outline: '', background: '', animation: 'fade', animationDuration: 0.8, exitAnimation: 'fade', exitDuration: 0.6, letterSpacing: 0, lineHeight: 1.2, boxWidth: 0.85 } },
  { id: 'starwars', label: 'Star Wars crawl', emoji: '🌌', hint: 'Yellow text receding into space',
    text: { fontFamily: 'Franklin Gothic Medium', fontSize: 64, bold: true, italic: false, color: '#FFE81F', align: 'center', shadow: false, outline: '', background: '', animation: 'crawl', exitAnimation: 'none', letterSpacing: 1, lineHeight: 1.35, boxWidth: 0.7 }, bg: '#000000' },
  { id: 'pulp', label: 'Pulp Fiction', emoji: '💼', hint: 'Yellow condensed caps that pop in',
    text: { fontFamily: 'Impact', fontSize: 150, bold: false, italic: false, color: '#F9D71C', align: 'center', shadow: false, outline: '#000000', background: '', animation: 'pop', animationDuration: 0.5, exitAnimation: 'fade', exitDuration: 0.3, letterSpacing: 6, lineHeight: 1.0, boxWidth: 0.9 }, bg: '#000000' },
  { id: 'credits', label: 'Rolling credits', emoji: '📜', hint: 'Classic end credits scrolling up',
    text: { fontFamily: 'Georgia', fontSize: 54, bold: false, italic: false, color: '#ffffff', align: 'center', shadow: false, outline: '', background: '', animation: 'scroll-up', exitAnimation: 'none', letterSpacing: 1, lineHeight: 1.7, boxWidth: 0.7 } },
  { id: 'lower', label: 'Lower third', emoji: '📰', hint: 'Name tag that slides in at the bottom',
    text: { fontFamily: 'Segoe UI', fontSize: 46, bold: true, italic: false, color: '#ffffff', align: 'left', shadow: false, outline: '', background: 'rgba(20,20,30,0.78)', backgroundPadding: 22, animation: 'slide-right', animationDuration: 0.6, exitAnimation: 'slide-left', exitDuration: 0.5, letterSpacing: 0, lineHeight: 1.25, boxWidth: 0.9 }, y: 0.36 },
  { id: 'typewriter', label: 'Typewriter', emoji: '⌨️', hint: 'Letters typed one by one',
    text: { fontFamily: 'Courier New', fontSize: 64, bold: true, italic: false, color: '#9dff9d', align: 'left', shadow: false, outline: '', background: 'rgba(0,0,0,0.7)', backgroundPadding: 30, animation: 'typewriter', animationDuration: 2.5, exitAnimation: 'fade', exitDuration: 0.5, letterSpacing: 2, lineHeight: 1.4, boxWidth: 0.8 } },
  { id: 'kinetic', label: 'Kinetic', emoji: '⚡', hint: 'Letters drop in one after another',
    text: { fontFamily: 'Arial Black', fontSize: 130, bold: true, italic: false, color: '#ffffff', align: 'center', shadow: true, outline: '', background: '', animation: 'letters', animationDuration: 1.4, exitAnimation: 'zoom-in', exitDuration: 0.5, letterSpacing: 2, lineHeight: 1.1, boxWidth: 0.9 } },
  { id: 'elegant', label: 'Elegant', emoji: '🕊', hint: 'Serif italic with a soft blur-in',
    text: { fontFamily: 'Georgia', fontSize: 96, bold: false, italic: true, color: '#f5efe0', align: 'center', shadow: true, outline: '', background: '', animation: 'blur-in', animationDuration: 1.2, exitAnimation: 'blur-out', exitDuration: 1, letterSpacing: 4, lineHeight: 1.3, boxWidth: 0.8 } },
  { id: 'impact', label: 'Impact', emoji: '💥', hint: 'Huge outlined caps zooming in',
    text: { fontFamily: 'Impact', fontSize: 180, bold: false, italic: false, color: '#ff3b3b', align: 'center', shadow: true, outline: '#ffffff', background: '', animation: 'zoom-out', animationDuration: 0.5, exitAnimation: 'zoom-out', exitDuration: 0.4, letterSpacing: 4, lineHeight: 1.0, boxWidth: 0.95 } },
  { id: 'subtitle', label: 'Subtitle', emoji: '💬', hint: 'Readable caption near the bottom',
    text: { fontFamily: 'Segoe UI', fontSize: 48, bold: false, italic: false, color: '#ffffff', align: 'center', shadow: true, outline: '#000000', background: '', animation: 'fade', animationDuration: 0.2, exitAnimation: 'fade', exitDuration: 0.2, letterSpacing: 0, lineHeight: 1.25, boxWidth: 0.9 }, y: 0.38 },
  { id: 'wipe', label: 'Wipe reveal', emoji: '🧹', hint: 'Revealed left to right',
    text: { fontFamily: 'Bahnschrift', fontSize: 110, bold: true, italic: false, color: '#ffffff', align: 'center', shadow: false, outline: '', background: '', animation: 'wipe', animationDuration: 1, exitAnimation: 'wipe', exitDuration: 0.8, letterSpacing: 8, lineHeight: 1.2, boxWidth: 0.9 } },
  { id: 'retro', label: 'Retro', emoji: '📼', hint: 'Orange 80s look that slides up',
    text: { fontFamily: 'Copperplate Gothic Bold', fontSize: 110, bold: true, italic: false, color: '#ff9a3c', align: 'center', shadow: true, outline: '#4a148c', background: '', animation: 'slide-up', animationDuration: 0.8, exitAnimation: 'slide-down', exitDuration: 0.6, letterSpacing: 3, lineHeight: 1.2, boxWidth: 0.9 } },
];

const ENTRANCES: [TextAnimation, string][] = [
  ['none', 'None'], ['fade', 'Fade in'], ['slide-left', 'Slide in from right'], ['slide-right', 'Slide in from left'],
  ['slide-up', 'Slide in from bottom'], ['slide-down', 'Slide in from top'], ['zoom-in', 'Zoom in'], ['zoom-out', 'Zoom out (from big)'],
  ['pop', 'Pop (elastic)'], ['blur-in', 'Blur in'], ['typewriter', 'Typewriter'], ['letters', 'Letter by letter'], ['wipe', 'Wipe'],
  ['scroll-up', 'Rolling credits (whole clip)'], ['crawl', 'Star Wars crawl (whole clip)'],
];
const EXITS: [TextExitAnimation, string][] = [
  ['none', 'None'], ['fade', 'Fade out'], ['slide-left', 'Slide out left'], ['slide-right', 'Slide out right'],
  ['slide-up', 'Slide out up'], ['slide-down', 'Slide out down'], ['zoom-out', 'Shrink away'], ['zoom-in', 'Grow away'], ['blur-out', 'Blur out'], ['wipe', 'Wipe out'],
];

export default function TitleStudio({ clipId }: { clipId: string }) {
  const project = useProject((s) => s.project);
  const clip = useProject((s) => s.project.clips.find((c) => c.id === clipId));
  const close = () => useProject.getState().setTitleStudio(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const [localT, setLocalT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [tab, setTab] = useState<'templates' | 'style' | 'animation'>('templates');
  const [scale, setScale] = useState(0.5);
  const wrapRef = useRef<HTMLDivElement>(null);
  const localRef = useRef(0);
  localRef.current = localT;

  // Snapshot of the main preview (what's behind the title) taken when the studio opens.
  useEffect(() => {
    // Background = the scene at the clip's start, without this title (composited with the preview's media).
    const snap = document.createElement('canvas');
    snap.width = project.width; snap.height = project.height;
    const ctx = snap.getContext('2d')!;
    ctx.fillStyle = project.backgroundColor;
    ctx.fillRect(0, 0, snap.width, snap.height);
    if (clip && previewSource.lookup) {
      try { drawFrame(ctx, { ...project, clips: project.clips.filter((c) => c.id !== clipId) }, clip.start + 0.01, previewSource.lookup); } catch { /* ignore */ }
    }
    snapshotRef.current = snap;
    // start the preview at the clip's beginning
    if (clip) useProject.getState().setCurrentTime(clip.start);
    useProject.getState().setPlaying(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit the canvas
  useEffect(() => {
    const wrap = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const { width, height } = wrap.getBoundingClientRect();
      setScale(Math.max(0.05, Math.min((width - 16) / project.width, (height - 16) / project.height)));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  // Render loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const st = useProject.getState();
      const c = st.project.clips.find((x) => x.id === clipId);
      const canvas = canvasRef.current;
      if (c && c.type === 'text' && canvas) {
        let t = localRef.current;
        if (playing) {
          t += dt;
          if (t > c.duration + 0.4) t = 0; // loop with a short pause at the end
          localRef.current = t;
          setLocalT(t);
        }
        const ctx = canvas.getContext('2d')!;
        const p = st.project;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        if (snapshotRef.current) ctx.drawImage(snapshotRef.current, 0, 0);
        else { ctx.fillStyle = p.backgroundColor; ctx.fillRect(0, 0, p.width, p.height); }
        const tt = Math.min(t, c.duration - 0.001);
        if (tt >= 0 && tt < c.duration) {
          const f = renderTextFrame(c.text, p.width, p.height, tt, c.duration);
          const b = clipBoundsWith(p, c, c.transform, f.w, f.h, c.start + tt);
          ctx.save();
          ctx.globalAlpha = c.transform.opacity * fadeFactor(tt, c.duration, c.fadeIn, c.fadeOut);
          ctx.translate(b.cx, b.cy);
          if (b.rotation) ctx.rotate((b.rotation * Math.PI) / 180);
          ctx.drawImage(f.canvas, -b.w / 2, -b.h / 2, b.w, b.h);
          ctx.restore();
          // safe-area guide
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.setLineDash([10, 10]);
          ctx.lineWidth = 2;
          ctx.strokeRect(p.width * 0.05, p.height * 0.05, p.width * 0.9, p.height * 0.9);
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clipId, playing]);

  if (!clip || clip.type !== 'text') return null;
  const t = clip.text;
  const st = useProject.getState;
  const up = (patch: Partial<TextProps>, commit = true) => st().updateText(clipId, patch, { commit });
  const restart = () => { localRef.current = 0; setLocalT(0); setPlaying(true); };

  const applyTemplate = (tpl: Template) => {
    st().commit();
    up({ ...tpl.text }, false);
    st().updateTransform(clipId, { x: 0, y: tpl.y ? Math.round(project.height * tpl.y) : 0, scale: 1, rotation: 0 }, { commit: false });
    if (tpl.bg) st().updateProjectSettings({ backgroundColor: tpl.bg });
    if (tpl.text.animation === 'crawl' && clip.duration < 15) st().updateClip(clipId, { duration: 20 }, { commit: false });
    if (tpl.text.animation === 'scroll-up' && clip.duration < 8) st().updateClip(clipId, { duration: 12 }, { commit: false });
    restart();
  };

  // Drag the text on the canvas to move it
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const toP = (ev: { clientX: number; clientY: number }) => ({
      x: ((ev.clientX - rect.left) / rect.width) * project.width,
      y: ((ev.clientY - rect.top) / rect.height) * project.height,
    });
    const start = toP(e);
    const ox = clip.transform.x, oy = clip.transform.y;
    let committed = false;
    const move = (ev: MouseEvent) => {
      const p = toP(ev);
      if (!committed) { st().commit(); committed = true; }
      st().updateTransform(clipId, { x: Math.round(ox + p.x - start.x), y: Math.round(oy + p.y - start.y) }, { commit: false });
    };
    const upH = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', upH); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', upH);
  };

  const wholeClip = t.animation === 'scroll-up' || t.animation === 'crawl';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="studio">
        <div className="studio-head">
          <strong>✨ Title Studio</strong>
          <span className="dim small">Drag the text to position it · changes apply live to the timeline</span>
          <button className="primary" style={{ marginLeft: 'auto' }} onClick={close}>Done</button>
        </div>
        <div className="studio-body">
          <div className="studio-left">
            <div className="studio-canvas-wrap" ref={wrapRef}>
              <canvas ref={canvasRef} width={project.width} height={project.height}
                style={{ width: project.width * scale, height: project.height * scale }} onMouseDown={onMouseDown} />
            </div>
            <div className="studio-transport">
              <button onClick={() => setPlaying(!playing)}>{playing ? '❚❚' : '▶'}</button>
              <button onClick={restart} title="Restart">⟲</button>
              <input type="range" min={0} max={clip.duration} step={0.01} value={Math.min(localT, clip.duration)}
                onChange={(e) => { setPlaying(false); localRef.current = Number(e.target.value); setLocalT(Number(e.target.value)); }} style={{ flex: 1 }} />
              <span className="timecode small">{Math.min(localT, clip.duration).toFixed(2)}s / {clip.duration.toFixed(1)}s</span>
              <label className="small dim">Length
                <input type="number" className="num" min={0.5} step={0.5} value={Number(clip.duration.toFixed(1))}
                  onFocus={() => st().commit()}
                  onChange={(e) => { if (e.target.value === '') return; st().trimClip(clipId, 'end', Number(e.target.value) - clip.duration, { commit: false }); }} /> s
              </label>
            </div>
            <textarea className="studio-text" rows={4} value={t.content} placeholder="Type your text…"
              onFocus={() => st().commit()} onChange={(e) => up({ content: e.target.value }, false)} />
          </div>

          <div className="studio-right">
            <div className="tabs">
              <button className={tab === 'templates' ? 'on' : ''} onClick={() => setTab('templates')}>Templates</button>
              <button className={tab === 'style' ? 'on' : ''} onClick={() => setTab('style')}>Style</button>
              <button className={tab === 'animation' ? 'on' : ''} onClick={() => setTab('animation')}>Animation</button>
            </div>

            {tab === 'templates' && (
              <div className="template-grid">
                {TEMPLATES.map((tpl) => (
                  <button key={tpl.id} className="template" onClick={() => applyTemplate(tpl)} title={tpl.hint}>
                    <span className="template-preview" style={{
                      fontFamily: tpl.text.fontFamily, color: tpl.text.color, fontWeight: tpl.text.bold ? 700 : 400,
                      fontStyle: tpl.text.italic ? 'italic' : 'normal', background: tpl.bg ?? (tpl.text.background || '#2a2d36'),
                      WebkitTextStroke: tpl.text.outline ? `1px ${tpl.text.outline}` : undefined, letterSpacing: (tpl.text.letterSpacing ?? 0) / 4,
                    }}>{tpl.emoji} Aa</span>
                    <span className="template-label">{tpl.label}</span>
                  </button>
                ))}
              </div>
            )}

            {tab === 'style' && (
              <div className="studio-form">
                <div className="field"><label>Font</label>
                  <select value={t.fontFamily} onChange={(e) => up({ fontFamily: e.target.value })} style={{ fontFamily: t.fontFamily }}>
                    {FONT_CHOICES.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                  </select>
                </div>
                <Range label="Size" value={t.fontSize} min={10} max={400} step={1} onChange={(v) => up({ fontSize: v }, false)} />
                <Range label="Spacing" value={t.letterSpacing} min={-5} max={40} step={0.5} onChange={(v) => up({ letterSpacing: v }, false)} />
                <Range label="Line height" value={t.lineHeight} min={0.8} max={3} step={0.05} onChange={(v) => up({ lineHeight: v }, false)} />
                <Range label="Box width" value={t.boxWidth} min={0.1} max={1} step={0.01} onChange={(v) => up({ boxWidth: v }, false)} />
                <div className="row">
                  <button className={t.bold ? 'on' : ''} onClick={() => up({ bold: !t.bold })}><b>B</b></button>
                  <button className={t.italic ? 'on' : ''} onClick={() => up({ italic: !t.italic })}><i>I</i></button>
                  <button className={t.align === 'left' ? 'on' : ''} onClick={() => up({ align: 'left' })}>⇤</button>
                  <button className={t.align === 'center' ? 'on' : ''} onClick={() => up({ align: 'center' })}>↔</button>
                  <button className={t.align === 'right' ? 'on' : ''} onClick={() => up({ align: 'right' })}>⇥</button>
                  <button onClick={() => up({ content: t.content.toUpperCase() })} title="UPPERCASE">AA</button>
                </div>
                <div className="field"><label>Colour</label>
                  <input type="color" value={t.color} onFocus={() => st().commit()} onChange={(e) => up({ color: e.target.value }, false)} />
                  <label className="check"><input type="checkbox" checked={t.shadow} onChange={(e) => up({ shadow: e.target.checked })} /> Shadow</label>
                </div>
                <div className="field"><label>Outline</label>
                  <input type="checkbox" checked={!!t.outline} onChange={(e) => up({ outline: e.target.checked ? '#000000' : '' })} />
                  {t.outline && <input type="color" value={t.outline} onFocus={() => st().commit()} onChange={(e) => up({ outline: e.target.value }, false)} />}
                </div>
                <div className="field"><label>Background</label>
                  <input type="checkbox" checked={!!t.background} onChange={(e) => up({ background: e.target.checked ? 'rgba(0,0,0,0.6)' : '' })} />
                  {t.background && (
                    <>
                      <input type="color" value={rgbaToHex(t.background)} onFocus={() => st().commit()} onChange={(e) => up({ background: hexToRgba(e.target.value, alphaOf(t.background)) }, false)} />
                      <input type="range" min={0} max={1} step={0.05} value={alphaOf(t.background)} onPointerDown={() => st().commit()} onChange={(e) => up({ background: hexToRgba(rgbaToHex(t.background), Number(e.target.value)) }, false)} title="Background opacity" />
                    </>
                  )}
                </div>
                {t.background && <Range label="Padding" value={t.backgroundPadding} min={0} max={120} step={1} onChange={(v) => up({ backgroundPadding: v }, false)} />}
                <div className="field"><label>Scene bg</label>
                  <input type="color" value={project.backgroundColor} onChange={(e) => st().updateProjectSettings({ backgroundColor: e.target.value })} />
                  <span className="dim small">Project background (behind everything)</span>
                </div>
                <div className="row">
                  <button onClick={() => { st().commit(); up({ ...DEFAULT_TEXT, content: t.content }, false); st().updateTransform(clipId, { x: 0, y: 0, scale: 1, rotation: 0 }, { commit: false }); }}>Reset style</button>
                </div>
              </div>
            )}

            {tab === 'animation' && (
              <div className="studio-form">
                <div className="field"><label>Entrance</label>
                  <select value={t.animation} onChange={(e) => { up({ animation: e.target.value as TextAnimation }); restart(); }}>
                    {ENTRANCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                {!wholeClip && t.animation !== 'none' && (
                  <Range label="Duration" value={t.animationDuration} min={0.1} max={Math.max(0.5, clip.duration)} step={0.1} unit="s" onChange={(v) => up({ animationDuration: v }, false)} />
                )}
                {!wholeClip && (
                  <>
                    <div className="field"><label>Exit</label>
                      <select value={t.exitAnimation} onChange={(e) => { up({ exitAnimation: e.target.value as TextExitAnimation }); localRef.current = Math.max(0, clip.duration - t.exitDuration - 0.3); setPlaying(true); }}>
                        {EXITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    {t.exitAnimation !== 'none' && (
                      <Range label="Duration" value={t.exitDuration} min={0.1} max={Math.max(0.5, clip.duration)} step={0.1} unit="s" onChange={(v) => up({ exitDuration: v }, false)} />
                    )}
                  </>
                )}
                {wholeClip && <div className="dim small">This animation runs across the whole clip: make the clip longer for a slower roll.</div>}
                <div className="dim small" style={{ marginTop: 10 }}>
                  Tip: for extra motion (spin, shake, zoom…), close this window and use <b>Animations</b> in the inspector — they stack on top of the text animation.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Range({ label, value, min, max, step, unit = '', onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  const commit = () => useProject.getState().commit();
  return (
    <div className="field">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={commit} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" className="num" min={min} max={max} step={step} value={Number(value.toFixed(2))} onFocus={commit} onChange={(e) => { if (e.target.value === '') return; onChange(Number(e.target.value)); }} />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

function rgbaToHex(c: string): string {
  if (c.startsWith('#')) return c.slice(0, 7);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (!m) return '#000000';
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}
function alphaOf(c: string): number {
  const m = /rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/.exec(c);
  return m ? Number(m[1]) : 1;
}
function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
