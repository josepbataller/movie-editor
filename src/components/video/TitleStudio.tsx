import { useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '@/store/useProject';
import { TextProps, TextAnimation, TextExitAnimation, TextBackdrop, TextFill, DEFAULT_TEXT, fadeFactor, ANIMATABLE, AnimatableProperty } from '@/shared/types';
import { BACKDROP_LABELS } from '@/engine/video/backdrops';
import { renderTextFrame, FONT_CHOICES } from '@/engine/video/textRender';
import { clipBoundsWith, drawFrame, previewSource, cssFilter } from '@/engine/video/compositor';
import { animatedState, ANIMATION_PRESETS, newSegment } from '@/engine/video/animation';
import { TITLE_TEMPLATES, TEMPLATE_CATEGORIES, TemplateCategory, TitleTemplate, templateStyle, findTemplate, STAR_WARS_SEQUENCE } from '@/engine/video/titleTemplates';
import { loadFont, fontFamilyFromPath } from '@/engine/video/fonts';

// Title Studio: a focused, Canva-like editor for one text clip with a live,
// scrubbable animation preview. Everything it writes goes straight to the store,
// so the timeline / inspector stay in sync. Templates live in engine/video/titleTemplates.ts.

const ENTRANCES: [TextAnimation, string][] = [
  ['none', 'None'], ['fade', 'Fade in'], ['slide-left', 'Slide in from right'], ['slide-right', 'Slide in from left'],
  ['slide-up', 'Slide in from bottom'], ['slide-down', 'Slide in from top'], ['zoom-in', 'Zoom in'], ['zoom-out', 'Zoom out (from big)'],
  ['pop', 'Pop (elastic)'], ['bounce-in', 'Bounce in from top'], ['stamp', 'Stamp (slam + shake)'], ['swing', 'Swing (pendulum)'],
  ['blur-in', 'Blur in'], ['focus', 'Focus (blur + zoom)'], ['flicker', 'Flicker (neon)'], ['tracking-in', 'Tracking (spacing tightens)'],
  ['typewriter', 'Typewriter'], ['letters', 'Letter by letter'], ['rise', 'Letters rise & settle'], ['words', 'Word by word'],
  ['elastic-letters', 'Letters bounce in'], ['scatter-in', 'Letters fly in'], ['flip-letters', 'Letters flip in'],
  ['wipe', 'Wipe'], ['blinds', 'Blinds'], ['split', 'Split (from centre)'], ['pixelate', 'Pixelate in'],
  ['spin-in', 'Spin in'], ['flip-in', 'Flip in'], ['glitch', 'Glitch'],
  ['shine', 'Shine (light sweep)'], ['spotlight', 'Spotlight sweep'], ['lamp', 'Hopping desk lamp (Pixar style)'], ['sparkle', 'Sparkle comet (fairy dust)'], ['marvel', 'Comic pages (Marvel style)'],
  ['studios', 'Silver plate + bars (Marvel Studios style)'], ['globe', 'Letters around a globe (Universal style)'], ['monument', 'Gold monument (20th Century style)'],
  ['wave', 'Wave (whole clip)'], ['rainbow', 'Rainbow cycle (whole clip)'], ['pulse', 'Pulse to the beat (whole clip)'],
  ['scroll-up', 'Rolling credits (whole clip)'], ['crawl', 'Star Wars crawl (whole clip)'],
];
const EXITS: [TextExitAnimation, string][] = [
  ['none', 'None'], ['fade', 'Fade out'], ['slide-left', 'Slide out left'], ['slide-right', 'Slide out right'],
  ['slide-up', 'Slide out up'], ['slide-down', 'Slide out down'], ['zoom-out', 'Shrink away'], ['zoom-in', 'Grow away'], ['blur-out', 'Blur out'],
  ['wipe', 'Wipe out'], ['blinds-out', 'Blinds out'], ['split-out', 'Split out'], ['pixelate-out', 'Pixelate out'],
  ['flip-out', 'Flip out'], ['spin-out', 'Spin away'], ['drop-out', 'Drop (gravity)'], ['glitch', 'Glitch out'], ['flicker-out', 'Flicker out'],
  ['tracking-out', 'Tracking (spacing spreads)'], ['scatter', 'Letters scatter'], ['letters-out', 'Letters drop out'],
];
const FILLS: [TextFill, string][] = [
  ['solid', 'Solid colour'], ['gradient', 'Gradient (2 colours)'], ['rainbow', 'Rainbow'], ['gold', 'Gold'], ['silver', 'Silver'], ['chrome', 'Chrome'], ['fire', 'Fire'], ['ice', 'Ice'],
];
const BACKDROPS: [TextBackdrop, string][] = (Object.keys(BACKDROP_LABELS) as TextBackdrop[]).map((k) => [k, BACKDROP_LABELS[k]]);

/** CSS approximation of a fill for the template thumbnails. */
const FILL_CSS: Record<TextFill, string> = {
  solid: '', gradient: '', rainbow: 'linear-gradient(90deg,#ff3b3b,#ffe14d,#3ddc84,#2ec4ff,#7a5cff)',
  gold: 'linear-gradient(#fff2b0,#f6c343 45%,#a66f00 50%,#f9d976 60%,#c58a00)', silver: 'linear-gradient(#fff,#cfd3d8 45%,#6f767e 50%,#e6e9ec 60%,#9aa1a8)',
  chrome: 'linear-gradient(#e9f3ff,#6a7f99 48%,#1d2a3a 50%,#dfe9f5 55%,#3a4b61)', fire: 'linear-gradient(#fff5a0,#ffb000,#ff4500,#7a0000)', ice: 'linear-gradient(#fff,#bfefff,#3aa0ff)',
};

export default function TitleStudio({ clipId }: { clipId: string }) {
  const project = useProject((s) => s.project);
  const clip = useProject((s) => s.project.clips.find((c) => c.id === clipId));
  const close = () => useProject.getState().setTitleStudio(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const [localT, setLocalT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [tab, setTab] = useState<'templates' | 'style' | 'animation' | 'motion'>('templates');
  const [category, setCategory] = useState<TemplateCategory | 'all'>('all');
  const [query, setQuery] = useState('');
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

  // Render loop (same compositing as the main preview: text frame + stacked clip animations)
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
          const { transform: tf, effects } = animatedState(c, tt);
          const b = clipBoundsWith(p, c, tf, f.w, f.h, c.start + tt);
          ctx.save();
          ctx.globalAlpha = tf.opacity * fadeFactor(tt, c.duration, c.fadeIn, c.fadeOut);
          ctx.filter = c.animations?.length ? cssFilter(effects) : 'none';
          ctx.translate(b.cx, b.cy);
          if (b.rotation) ctx.rotate((b.rotation * Math.PI) / 180);
          ctx.scale(tf.flipH ? -1 : 1, tf.flipV ? -1 : 1);
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

  const visibleTemplates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TITLE_TEMPLATES.filter((tpl) => (category === 'all' || tpl.category === category) && (!q || `${tpl.label} ${tpl.hint} ${tpl.id}`.toLowerCase().includes(q)));
  }, [category, query]);

  if (!clip || clip.type !== 'text') return null;
  const t = clip.text;
  const st = useProject.getState;
  const up = (patch: Partial<TextProps>, commit = true) => st().updateText(clipId, patch, { commit });
  const restart = () => { localRef.current = 0; setLocalT(0); setPlaying(true); };
  const segs = clip.animations ?? [];

  /** Longest duration this clip can take without running into the next clip on its track. */
  const maxDuration = () => {
    const next = st().project.clips.filter((c) => c.trackId === clip.trackId && c.id !== clipId && c.start >= clip.start + 0.001).sort((a, b) => a.start - b.start)[0];
    return next ? Math.max(0.5, next.start - clip.start) : Infinity;
  };
  const setDuration = (d: number) => st().updateClip(clipId, { duration: Math.min(d, maxDuration()) }, { commit: false });

  const applyTemplate = (tpl: TitleTemplate) => {
    st().commit();
    if (tpl.duration) setDuration(tpl.duration);
    const placeholder = !t.content.trim() || t.content === 'My Title' || t.content === DEFAULT_TEXT.content || TITLE_TEMPLATES.some((x) => x.content === t.content);
    if (tpl.content && placeholder) up({ content: tpl.content }, false);
    up(templateStyle(tpl), false);
    st().updateTransform(clipId, { x: 0, y: tpl.y ? Math.round(project.height * tpl.y) : 0, scale: 1, rotation: 0 }, { commit: false });
    if (tpl.bg) st().updateProjectSettings({ backgroundColor: tpl.bg });
    // templates without an explicit duration still get a sensible length for whole-clip animations
    if (!tpl.duration && tpl.text.animation === 'crawl' && clip.duration < 15) setDuration(20);
    if (!tpl.duration && tpl.text.animation === 'scroll-up' && clip.duration < 8) setDuration(12);
    if (!tpl.duration && (tpl.text.animationDuration ?? 0) + (tpl.text.exitDuration ?? 0) + 1 > clip.duration) setDuration(Math.ceil((tpl.text.animationDuration ?? 0) + (tpl.text.exitDuration ?? 0) + 1.5));
    restart();
  };

  /** Replace this clip by the three Star Wars shots placed one after another. */
  const buildStarWarsSequence = () => {
    const base = clip;
    st().commit();
    let start = base.start;
    STAR_WARS_SEQUENCE.forEach((shot, i) => {
      const tpl = findTemplate(shot.tpl)!;
      const text = { ...DEFAULT_TEXT, ...templateStyle(tpl), content: shot.content } as TextProps;
      if (i === 0) {
        st().updateText(clipId, text, { commit: false });
        st().updateClip(clipId, { duration: Math.min(shot.duration, maxDuration()), name: 'Star Wars: intro' }, { commit: false });
        st().updateTransform(clipId, { x: 0, y: 0, scale: 1, rotation: 0 }, { commit: false });
      } else {
        const id = st().addTextClip({ trackId: base.trackId, start, text, duration: shot.duration });
        st().updateClip(id, { name: i === 1 ? 'Star Wars: logo' : 'Star Wars: crawl', fadeIn: 0, fadeOut: 0 }, { commit: false });
        // addTextClip commits on its own: fold it into this single undo step
        useProject.setState((s) => ({ past: s.past.slice(0, -1) }));
        // the clip may have been pushed later if something was in the way: continue from where it really landed
        const placed = useProject.getState().project.clips.find((c) => c.id === id);
        if (placed) start = placed.start;
      }
      start += shot.duration;
    });
    st().updateProjectSettings({ backgroundColor: '#000000' });
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
  const atPlayhead = Math.min(Math.max(0, localT), Math.max(0, clip.duration - 0.5));
  const motionPresets = ANIMATION_PRESETS.filter((p) => p.id !== 'duck');

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
              <button className={tab === 'motion' ? 'on' : ''} onClick={() => setTab('motion')} title="Extra motion & effects over time (zoom, spin, blur, brightness…) stacked on the text animation">Motion FX{segs.length ? ` (${segs.length})` : ''}</button>
            </div>

            {tab === 'templates' && (
              <>
                <div className="template-filters">
                  <input type="search" placeholder={`Search ${TITLE_TEMPLATES.length} templates…`} value={query} onChange={(e) => setQuery(e.target.value)} />
                  <div className="chips">
                    {TEMPLATE_CATEGORIES.map((c) => <button key={c.id} className={`chip ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}>{c.label}</button>)}
                  </div>
                </div>
                <div className="template-grid">
                  {(category === 'all' || category === 'movies') && !query && (
                    <button className="template sequence" onClick={buildStarWarsSequence} title="Creates three consecutive clips: blue intro text, the logo flying away, and the crawl — all over a starfield">
                      <span className="template-preview" style={{ background: '#000', color: '#FFE81F', fontFamily: 'Franklin Gothic Medium', fontWeight: 700 }}>🌌 ★ ★ ★</span>
                      <span className="template-label">Star Wars opening (3 clips)</span>
                    </button>
                  )}
                  {visibleTemplates.map((tpl) => {
                    const s = tpl.text;
                    const fillCss = s.fill && s.fill !== 'solid' ? (s.fill === 'gradient' ? `linear-gradient(${s.color},${s.fillColor2 ?? '#888'})` : FILL_CSS[s.fill]) : '';
                    const previewBg = tpl.bg ?? (s.background || (s.backdrop && s.backdrop !== 'none' ? `linear-gradient(135deg, ${s.backdropColor ?? '#000'}, ${s.backdropColor2 ?? '#1a237e'})` : '#2a2d36'));
                    return (
                      <button key={tpl.id} className="template" onClick={() => applyTemplate(tpl)} title={tpl.hint}>
                        <span className="template-preview" style={{
                          fontFamily: s.fontFamily, color: s.color, fontWeight: s.bold === false ? 400 : 700,
                          fontStyle: s.italic ? 'italic' : 'normal', background: previewBg,
                          WebkitTextStroke: s.outline ? `1px ${s.outline}` : undefined, letterSpacing: (s.letterSpacing ?? 0) / 4,
                          textShadow: s.extrude ? `2px 2px 0 ${s.extrudeColor ?? '#222'}` : (s.glow ? `0 0 8px ${s.glowColor ?? s.color}` : undefined),
                        }}>
                          <span style={fillCss ? { background: fillCss, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', WebkitTextStroke: undefined } : undefined}>{tpl.emoji} Aa</span>
                        </span>
                        <span className="template-label">{tpl.label}</span>
                      </button>
                    );
                  })}
                  {visibleTemplates.length === 0 && <div className="dim small" style={{ gridColumn: '1 / -1', padding: 12 }}>No template matches "{query}".</div>}
                </div>
              </>
            )}

            {tab === 'style' && (
              <div className="studio-form">
                <div className="field"><label>Font</label>
                  <select value={t.fontFamily} onChange={(e) => up({ fontFamily: e.target.value })} style={{ fontFamily: t.fontFamily }}>
                    {(project.fonts?.length ?? 0) > 0 && (
                      <optgroup label="Project font files">
                        {project.fonts!.map((f) => <option key={f.path} value={f.family} style={{ fontFamily: f.family }}>{f.family}</option>)}
                      </optgroup>
                    )}
                    {!FONT_CHOICES.includes(t.fontFamily) && !project.fonts?.some((f) => f.family === t.fontFamily) && <option value={t.fontFamily}>{t.fontFamily}</option>}
                    {FONT_CHOICES.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                  </select>
                  <button className="small" title="Load a .ttf / .otf font file (e.g. a fan font like Waltograph for the Disney look); it is remembered with the project" onClick={async () => {
                    const path = await window.api.openFontDialog();
                    if (!path) return;
                    const family = fontFamilyFromPath(path);
                    if (!(await loadFont(family, path))) { alert('Could not load that font file.'); return; }
                    st().addFont({ family, path });
                    up({ fontFamily: family });
                  }}>Font file…</button>
                </div>
                <Range label="Size" value={t.fontSize} min={10} max={400} step={1} onChange={(v) => up({ fontSize: v }, false)} />
                <Range label="Spacing" value={t.letterSpacing} min={-5} max={60} step={0.5} onChange={(v) => up({ letterSpacing: v }, false)} />
                <Range label="Line height" value={t.lineHeight} min={0.8} max={3} step={0.05} onChange={(v) => up({ lineHeight: v }, false)} />
                <Range label="Box width" value={t.boxWidth} min={0.1} max={1} step={0.01} onChange={(v) => up({ boxWidth: v }, false)} />
                {!wholeClip && <Range label="Vertical" value={t.offsetY ?? 0} min={-0.45} max={0.45} step={0.01} onChange={(v) => up({ offsetY: v }, false)} />}
                <div className="row">
                  <button className={t.bold ? 'on' : ''} onClick={() => up({ bold: !t.bold })}><b>B</b></button>
                  <button className={t.italic ? 'on' : ''} onClick={() => up({ italic: !t.italic })}><i>I</i></button>
                  <button className={t.align === 'left' ? 'on' : ''} onClick={() => up({ align: 'left' })}>⇤</button>
                  <button className={t.align === 'center' ? 'on' : ''} onClick={() => up({ align: 'center' })}>↔</button>
                  <button className={t.align === 'right' ? 'on' : ''} onClick={() => up({ align: 'right' })}>⇥</button>
                  <button onClick={() => up({ content: t.content.toUpperCase() })} title="UPPERCASE">AA</button>
                </div>
                <div className="field"><label>Fill</label>
                  <select value={t.fill ?? 'solid'} onChange={(e) => up({ fill: e.target.value as TextFill })}>
                    {FILLS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="field"><label>Colour</label>
                  <input type="color" value={t.color} onFocus={() => st().commit()} onChange={(e) => up({ color: e.target.value }, false)} />
                  {t.fill === 'gradient' && <input type="color" value={t.fillColor2 ?? '#888888'} onFocus={() => st().commit()} onChange={(e) => up({ fillColor2: e.target.value }, false)} title="Second gradient colour" />}
                  <label className="check"><input type="checkbox" checked={t.shadow} onChange={(e) => up({ shadow: e.target.checked })} /> Shadow</label>
                </div>
                <div className="field"><label>Outline</label>
                  <input type="checkbox" checked={!!t.outline} onChange={(e) => up({ outline: e.target.checked ? '#000000' : '' })} />
                  {t.outline && <input type="color" value={t.outline} onFocus={() => st().commit()} onChange={(e) => up({ outline: e.target.value }, false)} />}
                </div>
                {t.outline && <Range label="Outline width" value={t.outlineWidth ?? 0.06} min={0.01} max={0.2} step={0.005} onChange={(v) => up({ outlineWidth: v }, false)} />}
                <Range label="3D depth" value={t.extrude ?? 0} min={0} max={40} step={1} unit="px" onChange={(v) => up({ extrude: v }, false)} />
                {(t.extrude ?? 0) > 0 && (
                  <div className="field"><label>3D colour</label>
                    <input type="color" value={t.extrudeColor ?? '#222222'} onFocus={() => st().commit()} onChange={(e) => up({ extrudeColor: e.target.value }, false)} />
                  </div>
                )}
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
                <Range label="Glow" value={t.glow ?? 0} min={0} max={1} step={0.05} onChange={(v) => up({ glow: v }, false)} />
                {(t.glow ?? 0) > 0 && (
                  <div className="field"><label>Glow colour</label>
                    <input type="color" value={t.glowColor ?? t.color} onFocus={() => st().commit()} onChange={(e) => up({ glowColor: e.target.value }, false)} />
                  </div>
                )}
                <div className="field"><label>Layout</label>
                  <select value={t.layout ?? 'block'} onChange={(e) => up({ layout: e.target.value as 'block' | 'two-column' })}>
                    <option value="block">Text block</option>
                    <option value="two-column">Two columns (Role | Name)</option>
                  </select>
                </div>
                <div className="field"><label>Backdrop</label>
                  <select value={t.backdrop ?? 'none'} onChange={(e) => up({ backdrop: e.target.value as TextBackdrop })}>
                    {BACKDROPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                {t.backdrop && t.backdrop !== 'none' && (
                  <div className="field"><label>Backdrop colours</label>
                    <input type="color" value={t.backdropColor ?? '#000000'} onFocus={() => st().commit()} onChange={(e) => up({ backdropColor: e.target.value }, false)} />
                    <input type="color" value={t.backdropColor2 ?? '#1a237e'} onFocus={() => st().commit()} onChange={(e) => up({ backdropColor2: e.target.value }, false)} />
                    <span className="dim small">Animated backgrounds export with the precise engine.</span>
                  </div>
                )}
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
                {t.animation === 'crawl' && <Range label="Tilt" value={t.perspective ?? 0.6} min={0.15} max={0.95} step={0.01} onChange={(v) => up({ perspective: v }, false)} />}
                {t.animation === 'studios' && <div className="dim small">Silver plate: the first word is cut out of the plate (the backdrop colour shows through), the remaining words go in silver between two bars. Write e.g. "MYNAME STUDIOS".</div>}
                {t.animation === 'globe' && <div className="dim small">The letters sweep round the planet and settle in front. Fewer letters = bigger letters; the "Vertical" slider moves the whole globe.</div>}
                {t.animation === 'monument' && <div className="dim small">One line per tier (e.g. "20th / CENTURY / MYNAME"): the first line is the biggest; each line stands on a bronze step. Works best with the "Sunset lot with searchlights" backdrop.</div>}
                {t.animation === 'lamp' && <div className="dim small">Desk lamp: it lands on the first I (or the middle letter), flattens it, turns to the camera and switches off at the end of the entrance (the picture goes dark). Make the entrance ~5–6 s and end the clip ~1 s later for the classic cut. Exits act as a fade.</div>}
                {t.animation === 'marvel' && <div className="dim small">Comic pages: the first backdrop colour is the final page colour (red), the second is the paper the pages flip on (white). Make the entrance ~4 s and the clip ~7 s.</div>}
                {wholeClip && <div className="dim small">This animation runs across the whole clip: make the clip longer for a slower roll (a crawl usually needs 30–60 s).</div>}
                <div className="dim small" style={{ marginTop: 10 }}>
                  Tip: the <b>Motion FX</b> tab adds zoom, spin, shake, blur, brightness… over any time range, stacked on top of this animation.
                </div>
              </div>
            )}

            {tab === 'motion' && (
              <div className="studio-form">
                <div className="dim small" style={{ marginBottom: 6 }}>
                  Effects over time, stacked on the text animation: presets start at the preview time ({atPlayhead.toFixed(1)} s) when it is inside the clip. Fine-tune ranges and ramps in the inspector's <b>Animations</b> section.
                </div>
                <div className="btn-grid presets">
                  {motionPresets.map((p) => (
                    <button key={p.id} title={p.description} onClick={() => { st().addAnimations(clipId, p.build(clip.duration, atPlayhead)); setPlaying(true); }}>
                      <span className="preset-icon">{p.icon}</span>{p.label}
                    </button>
                  ))}
                </div>
                <CustomMotion clipId={clipId} duration={clip.duration} at={atPlayhead} />
                {segs.map((s) => (
                  <div key={s.id} className="segment">
                    <div className="segment-head">
                      <strong>{ANIMATABLE[s.property].label}</strong>
                      <span className="dim small">{s.start.toFixed(1)}s → {s.end.toFixed(1)}s · {s.value > 0 ? '+' : ''}{s.value}{ANIMATABLE[s.property].unit}{s.oscillate ? ` · ${s.oscillate}/s` : ''}</span>
                      <button className="small" style={{ marginLeft: 'auto' }} onClick={() => st().removeAnimation(clipId, s.id)} title="Remove">✕</button>
                    </div>
                    <Range label="Amount" value={s.value} min={ANIMATABLE[s.property].min} max={ANIMATABLE[s.property].max} step={ANIMATABLE[s.property].step} unit={ANIMATABLE[s.property].unit} onChange={(v) => st().updateAnimation(clipId, s.id, { value: v }, { commit: false })} />
                    <Range label="From" value={s.start} min={0} max={clip.duration} step={0.1} unit="s" onChange={(v) => st().updateAnimation(clipId, s.id, { start: Math.min(v, s.end - 0.1) }, { commit: false })} />
                    <Range label="To" value={s.end} min={0} max={clip.duration} step={0.1} unit="s" onChange={(v) => st().updateAnimation(clipId, s.id, { end: Math.max(v, s.start + 0.1) }, { commit: false })} />
                  </div>
                ))}
                {segs.length > 1 && <div className="row"><button onClick={() => st().clearAnimations(clipId)}>Remove all motion effects</button></div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Custom" property picker for a new motion segment (same as the inspector). */
function CustomMotion({ clipId, duration, at }: { clipId: string; duration: number; at: number }) {
  const [prop, setProp] = useState<AnimatableProperty>('blur');
  const props = (Object.keys(ANIMATABLE) as AnimatableProperty[]).filter((p) => p !== 'volume');
  return (
    <div className="field">
      <label>Custom</label>
      <select value={prop} onChange={(e) => setProp(e.target.value as AnimatableProperty)}>
        {props.map((p) => <option key={p} value={p}>{ANIMATABLE[p].label}</option>)}
      </select>
      <button onClick={() => useProject.getState().addAnimation(clipId, newSegment(prop, duration, at))}>+ Add</button>
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
