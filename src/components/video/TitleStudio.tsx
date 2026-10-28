import { useEffect, useRef, useState } from 'react';
import { useProject } from '@/store/useProject';
import { TextProps, TextAnimation, TextExitAnimation, TextBackdrop, DEFAULT_TEXT, fadeFactor } from '@/shared/types';
import { BACKDROP_LABELS } from '@/engine/video/backdrops';
import { renderTextFrame, FONT_CHOICES } from '@/engine/video/textRender';
import { clipBoundsWith, drawFrame, previewSource } from '@/engine/video/compositor';

// Title Studio: a focused, Canva-like editor for one text clip with a live,
// scrubbable animation preview. Everything it writes goes straight to the store,
// so the timeline / inspector stay in sync.

interface Template { id: string; label: string; emoji: string; hint: string; text: Partial<TextProps>; y?: number; bg?: string; duration?: number; content?: string }

const TEMPLATES: Template[] = [
  { id: 'title', label: 'Big title', emoji: '🎬', hint: 'Bold centred title, fades in and out',
    text: { fontFamily: 'Segoe UI', fontSize: 120, bold: true, italic: false, color: '#ffffff', align: 'center', shadow: true, outline: '', background: '', animation: 'fade', animationDuration: 0.8, exitAnimation: 'fade', exitDuration: 0.6, letterSpacing: 0, lineHeight: 1.2, boxWidth: 0.85, glow: 0, backdrop: 'none', layout: 'block' } },
  { id: 'cinematic', label: 'Cinematic', emoji: '🎞', hint: 'Wide-spaced caps, slow fade — trailer style',
    text: { fontFamily: 'Bahnschrift', fontSize: 92, bold: false, italic: false, color: '#e8e4d8', align: 'center', shadow: false, outline: '', background: '', animation: 'blur-in', animationDuration: 1.6, exitAnimation: 'fade', exitDuration: 1.2, letterSpacing: 18, lineHeight: 1.4, boxWidth: 0.9, glow: 0, backdrop: 'film', backdropColor: '#0a0a0c', layout: 'block' } },
  { id: 'starwars', label: 'Star Wars crawl', emoji: '🌌', hint: 'Yellow text on a tilted plane receding into a starfield',
    text: { fontFamily: 'Franklin Gothic Medium', fontSize: 58, bold: true, italic: false, color: '#FFE81F', align: 'center', shadow: false, outline: '', background: '', animation: 'crawl', exitAnimation: 'none', letterSpacing: 1, lineHeight: 1.3, boxWidth: 0.74, glow: 0, backdrop: 'starfield', backdropColor: '#000000', backdropColor2: '#1a237e', layout: 'block', perspective: 0.62 }, duration: 30 },
  { id: 'galaxy', label: 'Galaxy title', emoji: '🪐', hint: 'Blue "A long time ago…" style text over space',
    text: { fontFamily: 'Franklin Gothic Medium', fontSize: 64, bold: false, italic: false, color: '#4bd5ee', align: 'center', shadow: false, outline: '', background: '', animation: 'fade', animationDuration: 1.5, exitAnimation: 'fade', exitDuration: 1.2, letterSpacing: 1, lineHeight: 1.4, boxWidth: 0.8, glow: 0.25, glowColor: '#4bd5ee', backdrop: 'starfield', backdropColor: '#000000', backdropColor2: '#1a237e', layout: 'block' }, duration: 6 },
  { id: 'logo-zoom', label: 'Logo zoom away', emoji: '🚀', hint: 'Huge outlined logo text flying into the distance',
    text: { fontFamily: 'Impact', fontSize: 260, bold: false, italic: false, color: '#000000', align: 'center', shadow: false, outline: '#FFE81F', background: '', animation: 'none', animationDuration: 0.3, exitAnimation: 'zoom-out', exitDuration: 6, letterSpacing: 6, lineHeight: 0.9, boxWidth: 0.95, glow: 0, backdrop: 'starfield', backdropColor: '#000000', backdropColor2: '#1a237e', layout: 'block' }, duration: 7 },
  { id: 'pulp', label: 'Pulp Fiction', emoji: '💼', hint: 'Yellow condensed caps that pop in',
    text: { fontFamily: 'Impact', fontSize: 150, bold: false, italic: false, color: '#F9D71C', align: 'center', shadow: false, outline: '#000000', background: '', animation: 'pop', animationDuration: 0.5, exitAnimation: 'fade', exitDuration: 0.3, letterSpacing: 6, lineHeight: 1.0, boxWidth: 0.9, glow: 0, backdrop: 'solid', backdropColor: '#000000', layout: 'block' } },
  { id: 'credits', label: 'Rolling credits', emoji: '📜', hint: 'Classic end credits scrolling up',
    text: { fontFamily: 'Georgia', fontSize: 54, bold: false, italic: false, color: '#ffffff', align: 'center', shadow: false, outline: '', background: '', animation: 'scroll-up', exitAnimation: 'none', letterSpacing: 1, lineHeight: 1.7, boxWidth: 0.7, glow: 0, backdrop: 'none', layout: 'block' }, duration: 20 },
  { id: 'credits2', label: 'Film credits (2 columns)', emoji: '🎥', hint: 'Role | Name pairs, dimmed role on the left — write lines like "Director | Josep"',
    text: { fontFamily: 'Georgia', fontSize: 48, bold: false, italic: false, color: '#ffffff', align: 'center', shadow: false, outline: '', background: '', animation: 'scroll-up', exitAnimation: 'none', letterSpacing: 1, lineHeight: 1.9, boxWidth: 0.85, glow: 0, backdrop: 'solid', backdropColor: '#000000', layout: 'two-column' }, duration: 25,
    content: 'Director | Your Name\nProducer | Your Name\nMusic | Your Name\nEditing | Movie Editor\n\nThanks for watching' },
  { id: 'neon', label: 'Neon nights', emoji: '💡', hint: 'Glowing neon sign that flickers in',
    text: { fontFamily: 'Segoe Script', fontSize: 130, bold: true, italic: false, color: '#ffffff', align: 'center', shadow: false, outline: '', background: '', animation: 'glitch', animationDuration: 1.2, exitAnimation: 'glitch', exitDuration: 0.8, letterSpacing: 2, lineHeight: 1.2, boxWidth: 0.9, glow: 0.9, glowColor: '#ff2d95', backdrop: 'gradient', backdropColor: '#120a2a', backdropColor2: '#2a0a3a', layout: 'block' } },
  { id: 'glitch', label: 'Glitch', emoji: '📺', hint: 'RGB split and slices, CRT scanlines behind',
    text: { fontFamily: 'Consolas', fontSize: 120, bold: true, italic: false, color: '#e8fff0', align: 'center', shadow: false, outline: '', background: '', animation: 'glitch', animationDuration: 1.5, exitAnimation: 'glitch', exitDuration: 0.8, letterSpacing: 4, lineHeight: 1.1, boxWidth: 0.9, glow: 0.2, glowColor: '#39ff14', backdrop: 'scanlines', backdropColor: '#050806', backdropColor2: '#39ff14', layout: 'block' } },
  { id: 'matrix', label: 'Matrix', emoji: '🟩', hint: 'Green glyph rain with typed text',
    text: { fontFamily: 'Consolas', fontSize: 72, bold: true, italic: false, color: '#b6ffb6', align: 'left', shadow: false, outline: '', background: '', animation: 'typewriter', animationDuration: 3, exitAnimation: 'glitch', exitDuration: 0.6, letterSpacing: 3, lineHeight: 1.3, boxWidth: 0.8, glow: 0.5, glowColor: '#39ff14', backdrop: 'matrix', backdropColor: '#000000', backdropColor2: '#39ff14', layout: 'block' } },
  { id: 'noir', label: 'Film noir', emoji: '🕵', hint: 'Old film grain, serif caps, typewriter',
    text: { fontFamily: 'Courier New', fontSize: 70, bold: true, italic: false, color: '#f0eadc', align: 'center', shadow: true, outline: '', background: '', animation: 'typewriter', animationDuration: 2.5, exitAnimation: 'fade', exitDuration: 1, letterSpacing: 3, lineHeight: 1.4, boxWidth: 0.85, glow: 0, backdrop: 'film', backdropColor: '#0c0b09', layout: 'block' } },
  { id: 'bokeh', label: 'Bokeh / wedding', emoji: '💍', hint: 'Soft lights, script font rising letter by letter',
    text: { fontFamily: 'Segoe Script', fontSize: 110, bold: false, italic: false, color: '#fff7f0', align: 'center', shadow: true, outline: '', background: '', animation: 'rise', animationDuration: 2, exitAnimation: 'blur-out', exitDuration: 1.2, letterSpacing: 1, lineHeight: 1.3, boxWidth: 0.9, glow: 0.3, glowColor: '#ffd1a1', backdrop: 'bokeh', backdropColor: '#2a1430', backdropColor2: '#5a2a3a', layout: 'block' } },
  { id: 'nebula', label: 'Nebula dream', emoji: '🌠', hint: 'Colourful nebula, text waving gently',
    text: { fontFamily: 'Century Gothic', fontSize: 100, bold: true, italic: false, color: '#ffffff', align: 'center', shadow: false, outline: '', background: '', animation: 'wave', animationDuration: 1, exitAnimation: 'fade', exitDuration: 1, letterSpacing: 6, lineHeight: 1.2, boxWidth: 0.9, glow: 0.4, glowColor: '#8ab4ff', backdrop: 'nebula', backdropColor: '#05030f', backdropColor2: '#3a1c8a', layout: 'block' } },
  { id: 'lower', label: 'Lower third', emoji: '📰', hint: 'Name tag that slides in at the bottom',
    text: { fontFamily: 'Segoe UI', fontSize: 46, bold: true, italic: false, color: '#ffffff', align: 'left', shadow: false, outline: '', background: 'rgba(20,20,30,0.78)', backgroundPadding: 22, animation: 'slide-right', animationDuration: 0.6, exitAnimation: 'slide-left', exitDuration: 0.5, letterSpacing: 0, lineHeight: 1.25, boxWidth: 0.9, glow: 0, backdrop: 'none', layout: 'block' }, y: 0.36 },
  { id: 'kinetic', label: 'Kinetic', emoji: '⚡', hint: 'Letters drop in one after another',
    text: { fontFamily: 'Arial Black', fontSize: 130, bold: true, italic: false, color: '#ffffff', align: 'center', shadow: true, outline: '', background: '', animation: 'letters', animationDuration: 1.4, exitAnimation: 'zoom-in', exitDuration: 0.5, letterSpacing: 2, lineHeight: 1.1, boxWidth: 0.9, glow: 0, backdrop: 'none', layout: 'block' } },
  { id: 'spin', label: 'Spin in', emoji: '🌀', hint: 'Spins and grows into place, flips out',
    text: { fontFamily: 'Impact', fontSize: 140, bold: false, italic: false, color: '#ffd166', align: 'center', shadow: true, outline: '#000000', background: '', animation: 'spin-in', animationDuration: 0.9, exitAnimation: 'flip-out', exitDuration: 0.6, letterSpacing: 3, lineHeight: 1.1, boxWidth: 0.9, glow: 0, backdrop: 'none', layout: 'block' } },
  { id: 'comic', label: 'Comic pop', emoji: '💥', hint: 'Bouncy outlined caps, like a comic panel',
    text: { fontFamily: 'Comic Sans MS', fontSize: 150, bold: true, italic: false, color: '#ffeb3b', align: 'center', shadow: true, outline: '#d32f2f', background: '', animation: 'pop', animationDuration: 0.6, exitAnimation: 'zoom-in', exitDuration: 0.4, letterSpacing: 2, lineHeight: 1.0, boxWidth: 0.9, glow: 0, backdrop: 'none', layout: 'block' } },
  { id: 'elegant', label: 'Elegant', emoji: '🕊', hint: 'Serif italic with a soft blur-in',
    text: { fontFamily: 'Georgia', fontSize: 96, bold: false, italic: true, color: '#f5efe0', align: 'center', shadow: true, outline: '', background: '', animation: 'blur-in', animationDuration: 1.2, exitAnimation: 'blur-out', exitDuration: 1, letterSpacing: 4, lineHeight: 1.3, boxWidth: 0.8, glow: 0, backdrop: 'none', layout: 'block' } },
  { id: 'subtitle', label: 'Subtitle', emoji: '💬', hint: 'Readable caption near the bottom',
    text: { fontFamily: 'Segoe UI', fontSize: 48, bold: false, italic: false, color: '#ffffff', align: 'center', shadow: true, outline: '#000000', background: '', animation: 'fade', animationDuration: 0.2, exitAnimation: 'fade', exitDuration: 0.2, letterSpacing: 0, lineHeight: 1.25, boxWidth: 0.9, glow: 0, backdrop: 'none', layout: 'block' }, y: 0.38 },
  { id: 'retro', label: 'Retro wave', emoji: '📼', hint: '80s orange on a moving purple gradient',
    text: { fontFamily: 'Copperplate Gothic Bold', fontSize: 110, bold: true, italic: false, color: '#ff9a3c', align: 'center', shadow: true, outline: '#4a148c', background: '', animation: 'slide-up', animationDuration: 0.8, exitAnimation: 'slide-down', exitDuration: 0.6, letterSpacing: 3, lineHeight: 1.2, boxWidth: 0.9, glow: 0.4, glowColor: '#ff2d95', backdrop: 'gradient', backdropColor: '#1a0533', backdropColor2: '#ff2d95', layout: 'block' } },
];

/** The classic three-shot opening: blue intro text → logo flying away → crawl, as consecutive clips. */
const STAR_WARS_SEQUENCE: { tpl: string; content: string; duration: number }[] = [
  { tpl: 'galaxy', content: 'A long time ago in a galaxy far,\nfar away....', duration: 6 },
  { tpl: 'logo-zoom', content: 'MOVIE\nEDITOR', duration: 7 },
  { tpl: 'starwars', content: 'Episode IV\nA NEW CUT\n\nIt is a period of creative unrest. Armed with a laptop and a pair of headphones, a lone editor has begun to assemble the greatest home movie ever made.\n\nSomewhere between the shaky shots and the forgotten audio, a story is waiting to be told....', duration: 40 },
];

const ENTRANCES: [TextAnimation, string][] = [
  ['none', 'None'], ['fade', 'Fade in'], ['slide-left', 'Slide in from right'], ['slide-right', 'Slide in from left'],
  ['slide-up', 'Slide in from bottom'], ['slide-down', 'Slide in from top'], ['zoom-in', 'Zoom in'], ['zoom-out', 'Zoom out (from big)'],
  ['pop', 'Pop (elastic)'], ['blur-in', 'Blur in'], ['typewriter', 'Typewriter'], ['letters', 'Letter by letter'], ['rise', 'Letters rise & settle'], ['wave', 'Wave (whole clip)'], ['wipe', 'Wipe'],
  ['spin-in', 'Spin in'], ['flip-in', 'Flip in'], ['glitch', 'Glitch'],
  ['scroll-up', 'Rolling credits (whole clip)'], ['crawl', 'Star Wars crawl (whole clip)'],
];
const EXITS: [TextExitAnimation, string][] = [
  ['none', 'None'], ['fade', 'Fade out'], ['slide-left', 'Slide out left'], ['slide-right', 'Slide out right'],
  ['slide-up', 'Slide out up'], ['slide-down', 'Slide out down'], ['zoom-out', 'Shrink away'], ['zoom-in', 'Grow away'], ['blur-out', 'Blur out'], ['wipe', 'Wipe out'],
  ['flip-out', 'Flip out'], ['glitch', 'Glitch out'],
];
const BACKDROPS: [TextBackdrop, string][] = (Object.keys(BACKDROP_LABELS) as TextBackdrop[]).map((k) => [k, BACKDROP_LABELS[k]]);

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
    if (tpl.duration) st().updateClip(clipId, { duration: tpl.duration }, { commit: false });
    if (tpl.content && (!t.content.trim() || t.content === 'My Title' || t.content === DEFAULT_TEXT.content)) up({ content: tpl.content }, false);
    up({ ...tpl.text }, false);
    st().updateTransform(clipId, { x: 0, y: tpl.y ? Math.round(project.height * tpl.y) : 0, scale: 1, rotation: 0 }, { commit: false });
    if (tpl.bg) st().updateProjectSettings({ backgroundColor: tpl.bg });
    // templates without an explicit duration still get a sensible length for whole-clip animations
    if (!tpl.duration && tpl.text.animation === 'crawl' && clip.duration < 15) st().updateClip(clipId, { duration: 20 }, { commit: false });
    if (!tpl.duration && tpl.text.animation === 'scroll-up' && clip.duration < 8) st().updateClip(clipId, { duration: 12 }, { commit: false });
    restart();
  };

  /** Replace this clip by the three Star Wars shots placed one after another. */
  const buildStarWarsSequence = () => {
    const base = clip;
    st().commit();
    let start = base.start;
    STAR_WARS_SEQUENCE.forEach((shot, i) => {
      const tpl = TEMPLATES.find((x) => x.id === shot.tpl)!;
      const text = { ...DEFAULT_TEXT, ...tpl.text, content: shot.content } as TextProps;
      if (i === 0) {
        st().updateText(clipId, text, { commit: false });
        st().updateClip(clipId, { duration: shot.duration, name: 'Star Wars: intro' }, { commit: false });
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
                <button className="template sequence" onClick={buildStarWarsSequence} title="Creates three consecutive clips: blue intro text, the logo flying away, and the crawl — all over a starfield">
                  <span className="template-preview" style={{ background: '#000', color: '#FFE81F', fontFamily: 'Franklin Gothic Medium', fontWeight: 700 }}>🌌 ★ ★ ★</span>
                  <span className="template-label">Star Wars opening (3 clips)</span>
                </button>
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
                {wholeClip && <div className="dim small">This animation runs across the whole clip: make the clip longer for a slower roll (a crawl usually needs 30–60 s).</div>}
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
