import { useState } from 'react';
import { useProject } from '@/store/useProject';
import { Clip, VisualClip, DEFAULT_EFFECTS, DEFAULT_TRANSFORM, fittedSize, ANIMATABLE, AnimatableProperty, AnimationSegment } from '@/shared/types';
import { FONT_CHOICES } from '@/engine/video/textRender';
import { ANIMATION_PRESETS, newSegment } from '@/engine/video/animation';
import { openClipInStudio } from '@/engine/audio/bridge';

// ---------- small form controls ----------

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <div className="section-title" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'}</span> {title}
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step = 0.01, onChange, onReset, unit = '' }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; onReset?: () => void; unit?: string;
}) {
  const commit = () => useProject.getState().commit();
  return (
    <div className="field">
      <label onDoubleClick={onReset} title={onReset ? 'Double-click to reset' : undefined}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={commit} onChange={(e) => onChange(Number(e.target.value))} />
      <input
        type="number" className="num" min={min} max={max} step={step} value={Number(value.toFixed(3))}
        onFocus={commit}
        onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) onChange(v); }}
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check field">
      <input type="checkbox" checked={value} onChange={(e) => { useProject.getState().commit(); onChange(e.target.checked); }} /> {label}
    </label>
  );
}

// ---------- inspector ----------

export default function Inspector() {
  const selectedIds = useProject((s) => s.selectedClipIds);
  const clip = useProject((s) => s.project.clips.find((c) => c.id === selectedIds[0]));

  if (!clip) return <ProjectInspector />;
  return (
    <div className="inspector">
      <div className="inspector-head">
        <input
          className="clip-title"
          value={clip.name}
          onFocus={() => useProject.getState().commit()}
          onChange={(e) => useProject.getState().updateClip(clip.id, { name: e.target.value }, { commit: false })}
        />
        <span className="dim small">{clip.type}{selectedIds.length > 1 ? ` · ${selectedIds.length} selected` : ''}</span>
      </div>
      <TimingSection clip={clip} />
      <LinkSection clip={clip} />
      {clip.type === 'text' && <TextSection clip={clip} />}
      <AnimationsSection clip={clip} />
      {clip.type !== 'audio' && <LayoutSection clip={clip} />}
      {clip.type !== 'audio' && <TransformSection clip={clip} />}
      {(clip.type === 'video' || clip.type === 'image') && <EffectsSection clip={clip} />}
      {clip.type !== 'audio' && <FadeSection clip={clip} />}
      {(clip.type === 'video' || clip.type === 'audio') && <AudioSection clip={clip} />}
    </div>
  );
}

function ProjectInspector() {
  const project = useProject((s) => s.project);
  const update = useProject((s) => s.updateProjectSettings);
  const splitAudio = useProject((s) => s.splitAudioOnImport);
  const presets = [
    ['1920×1080 (16:9)', 1920, 1080], ['1280×720 (16:9)', 1280, 720], ['3840×2160 (4K)', 3840, 2160],
    ['1080×1920 (9:16 vertical)', 1080, 1920], ['1080×1080 (1:1)', 1080, 1080], ['1440×1080 (4:3)', 1440, 1080],
  ] as const;
  const current = presets.find(([, w, h]) => w === project.width && h === project.height)?.[0] ?? 'custom';
  return (
    <div className="inspector">
      <div className="inspector-head"><strong>Project settings</strong><span className="dim small">Select a clip to edit it</span></div>
      <Section title="Canvas">
        <div className="field">
          <label>Name</label>
          <input value={project.name} onChange={(e) => update({ name: e.target.value })} />
        </div>
        <div className="field">
          <label>Size</label>
          <select value={current} onChange={(e) => { const p = presets.find(([n]) => n === e.target.value); if (p) update({ width: p[1], height: p[2] }); }}>
            {presets.map(([n]) => <option key={n} value={n}>{n}</option>)}
            <option value="custom">Custom…</option>
          </select>
        </div>
        <div className="field">
          <label>Width</label><input type="number" className="num" value={project.width} min={16} step={2} onChange={(e) => update({ width: Math.max(16, Number(e.target.value) || 16) })} />
          <label>Height</label><input type="number" className="num" value={project.height} min={16} step={2} onChange={(e) => update({ height: Math.max(16, Number(e.target.value) || 16) })} />
        </div>
        <div className="field">
          <label>Frame rate</label>
          <select value={project.fps} onChange={(e) => update({ fps: Number(e.target.value) })}>
            {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
          </select>
        </div>
        <div className="field">
          <label>Background</label>
          <input type="color" value={project.backgroundColor} onChange={(e) => update({ backgroundColor: e.target.value })} />
        </div>
      </Section>
      <Section title="Import options">
        <label className="check field">
          <input type="checkbox" checked={splitAudio} onChange={(e) => useProject.getState().setSplitAudioOnImport(e.target.checked)} />
          Put video sound on a separate (linked) audio track
        </label>
        <div className="dim small">Linked clips move together; use "Unlink" in the inspector to edit them independently.</div>
      </Section>
      <Section title="Tips" defaultOpen={false}>
        <ul className="tips">
          <li>Import media (Ctrl+I) then drag files onto the timeline, or double-click to append.</li>
          <li>Drag clips on the preview to move them; wheel = scale, Alt+wheel = rotate.</li>
          <li>Space plays, S splits at the playhead, Del deletes, Ctrl+Z undoes.</li>
          <li>Higher video tracks appear on top of lower ones.</li>
          <li>Ctrl+wheel on the timeline zooms.</li>
        </ul>
      </Section>
    </div>
  );
}

function TimingSection({ clip }: { clip: Clip }) {
  const st = useProject.getState;
  const asset = useProject((s) => ('assetId' in clip ? s.project.assets.find((a) => a.id === clip.assetId) : undefined));
  const canSpeed = clip.type === 'video' || clip.type === 'audio';
  return (
    <Section title="Timing">
      <div className="field">
        <label>Start</label>
        <input type="number" className="num" step={0.1} min={0} value={Number(clip.start.toFixed(2))} onFocus={() => st().commit()} onChange={(e) => { if (e.target.value === '') return; st().moveClip(clip.id, Number(e.target.value), clip.trackId, { commit: false }); }} />
        <span className="unit">s</span>
        <label>Length</label>
        <input type="number" className="num" step={0.1} min={0.1} value={Number(clip.duration.toFixed(2))} onFocus={() => st().commit()} onChange={(e) => { if (e.target.value === '') return; st().trimClip(clip.id, 'end', Number(e.target.value) - clip.duration, { commit: false }); }} />
        <span className="unit">s</span>
      </div>
      {canSpeed && (
        <Slider label="Speed" value={clip.speed} min={0.25} max={4} step={0.05} unit="×"
          onChange={(v) => {
            const s = Math.max(0.1, v);
            // keep the same source range: duration scales inversely
            const srcLen = clip.duration * clip.speed;
            let dur = srcLen / s;
            if (asset && asset.kind !== 'image') dur = Math.min(dur, (asset.duration - clip.inPoint) / s);
            st().updateClip(clip.id, { speed: s, duration: Math.max(0.1, dur) }, { commit: false });
          }}
          onReset={() => st().updateClip(clip.id, { speed: 1, duration: clip.duration * clip.speed })}
        />
      )}
      {asset && asset.kind !== 'image' && (
        <div className="dim small">Source offset {clip.inPoint.toFixed(2)}s of {asset.duration.toFixed(2)}s</div>
      )}
    </Section>
  );
}

function LayoutSection({ clip }: { clip: VisualClip }) {
  const project = useProject((s) => s.project);
  const asset = useProject((s) => ('assetId' in clip ? s.project.assets.find((a) => a.id === clip.assetId) : undefined));
  const st = useProject.getState;
  const W = project.width, H = project.height;
  const fitted = fittedSize(asset?.width || W, asset?.height || H, W, H, clip.transform.fit);
  const m = Math.round(W * 0.02);

  // Position a clip so that it occupies a rectangle (in frame fractions).
  const place = (fx: number, fy: number, fw: number, fh: number) => {
    const targetW = W * fw - (fw < 1 ? m * 2 : 0);
    const targetH = H * fh - (fh < 1 ? m * 2 : 0);
    const scale = Math.min(targetW / fitted.w, targetH / fitted.h);
    const cx = W * (fx + fw / 2);
    const cy = H * (fy + fh / 2);
    st().updateTransform(clip.id, { scale: Math.round(scale * 1000) / 1000, x: Math.round(cx - W / 2), y: Math.round(cy - H / 2), rotation: 0 });
  };
  const B = ({ label, title, onClick }: { label: string; title: string; onClick: () => void }) => <button onClick={onClick} title={title}>{label}</button>;
  return (
    <Section title="Screen layout">
      <div className="btn-grid">
        <B label="Full" title="Fill the frame" onClick={() => place(0, 0, 1, 1)} />
        <B label="◰ PiP" title="Picture-in-picture top-left" onClick={() => place(0, 0, 0.33, 0.33)} />
        <B label="◳ PiP" title="Picture-in-picture top-right" onClick={() => place(0.67, 0, 0.33, 0.33)} />
        <B label="◱ PiP" title="Picture-in-picture bottom-left" onClick={() => place(0, 0.67, 0.33, 0.33)} />
        <B label="◲ PiP" title="Picture-in-picture bottom-right" onClick={() => place(0.67, 0.67, 0.33, 0.33)} />
        <B label="◧ Left" title="Left half" onClick={() => place(0, 0, 0.5, 1)} />
        <B label="◨ Right" title="Right half" onClick={() => place(0.5, 0, 0.5, 1)} />
        <B label="⬒ Top" title="Top half" onClick={() => place(0, 0, 1, 0.5)} />
        <B label="⬓ Bottom" title="Bottom half" onClick={() => place(0, 0.5, 1, 0.5)} />
        <B label="▘ ¼" title="Top-left quarter" onClick={() => place(0, 0, 0.5, 0.5)} />
        <B label="▝ ¼" title="Top-right quarter" onClick={() => place(0.5, 0, 0.5, 0.5)} />
        <B label="▖ ¼" title="Bottom-left quarter" onClick={() => place(0, 0.5, 0.5, 0.5)} />
        <B label="▗ ¼" title="Bottom-right quarter" onClick={() => place(0.5, 0.5, 0.5, 0.5)} />
      </div>
      {clip.type !== 'text' && (
        <div className="field">
          <label>Fit</label>
          <select value={clip.transform.fit} onChange={(e) => st().updateTransform(clip.id, { fit: e.target.value as any })}>
            <option value="contain">Fit inside (letterbox)</option>
            <option value="cover">Fill frame (crop)</option>
            <option value="stretch">Stretch</option>
          </select>
        </div>
      )}
    </Section>
  );
}

function TransformSection({ clip }: { clip: VisualClip }) {
  const st = useProject.getState;
  const project = useProject((s) => s.project);
  const t = clip.transform;
  const up = (patch: Partial<typeof t>) => st().updateTransform(clip.id, patch, { commit: false });
  return (
    <Section title="Position & size">
      <Slider label="X" value={t.x} min={-project.width} max={project.width} step={1} unit="px" onChange={(v) => up({ x: v })} onReset={() => st().updateTransform(clip.id, { x: 0 })} />
      <Slider label="Y" value={t.y} min={-project.height} max={project.height} step={1} unit="px" onChange={(v) => up({ y: v })} onReset={() => st().updateTransform(clip.id, { y: 0 })} />
      <Slider label="Scale" value={t.scale} min={0.05} max={4} step={0.01} unit="×" onChange={(v) => up({ scale: v })} onReset={() => st().updateTransform(clip.id, { scale: 1 })} />
      <Slider label="Rotation" value={t.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => up({ rotation: v })} onReset={() => st().updateTransform(clip.id, { rotation: 0 })} />
      <Slider label="Opacity" value={t.opacity} min={0} max={1} step={0.01} onChange={(v) => up({ opacity: v })} onReset={() => st().updateTransform(clip.id, { opacity: 1 })} />
      <div className="row">
        <button onClick={() => st().updateTransform(clip.id, { rotation: ((t.rotation - 90 + 180) % 360 + 360) % 360 - 180 })}>↺ 90°</button>
        <button onClick={() => st().updateTransform(clip.id, { rotation: ((t.rotation + 90 + 180) % 360 + 360) % 360 - 180 })}>↻ 90°</button>
        <button className={t.flipH ? 'on' : ''} onClick={() => st().updateTransform(clip.id, { flipH: !t.flipH })}>⇋ Flip H</button>
        <button className={t.flipV ? 'on' : ''} onClick={() => st().updateTransform(clip.id, { flipV: !t.flipV })}>⇅ Flip V</button>
        <button onClick={() => st().updateTransform(clip.id, { ...DEFAULT_TRANSFORM, fit: t.fit })}>Reset</button>
      </div>
    </Section>
  );
}

function EffectsSection({ clip }: { clip: Clip & { type: 'video' | 'image' } }) {
  const st = useProject.getState;
  const fx = clip.effects;
  const up = (patch: Partial<typeof fx>) => st().updateEffects(clip.id, patch, { commit: false });
  const set = (patch: Partial<typeof fx>) => st().updateEffects(clip.id, patch);
  const presets: [string, Partial<typeof fx>][] = [
    ['None', { ...DEFAULT_EFFECTS }],
    ['B&W', { ...DEFAULT_EFFECTS, grayscale: true, contrast: 1.1 }],
    ['Sepia', { ...DEFAULT_EFFECTS, sepia: true }],
    ['Vivid', { ...DEFAULT_EFFECTS, saturation: 1.5, contrast: 1.15 }],
    ['Faded', { ...DEFAULT_EFFECTS, saturation: 0.7, brightness: 0.08, contrast: 0.9 }],
    ['Cool', { ...DEFAULT_EFFECTS, hue: 20, saturation: 1.1 }],
    ['Warm', { ...DEFAULT_EFFECTS, hue: -15, saturation: 1.15, brightness: 0.03 }],
    ['Dreamy', { ...DEFAULT_EFFECTS, blur: 3, brightness: 0.1, saturation: 1.2 }],
  ];
  return (
    <Section title="Effects & colour">
      <div className="btn-grid">
        {presets.map(([n, p]) => <button key={n} onClick={() => set(p)}>{n}</button>)}
      </div>
      <Slider label="Brightness" value={fx.brightness} min={-1} max={1} onChange={(v) => up({ brightness: v })} onReset={() => set({ brightness: 0 })} />
      <Slider label="Contrast" value={fx.contrast} min={0} max={3} onChange={(v) => up({ contrast: v })} onReset={() => set({ contrast: 1 })} />
      <Slider label="Saturation" value={fx.saturation} min={0} max={3} onChange={(v) => up({ saturation: v })} onReset={() => set({ saturation: 1 })} />
      <Slider label="Hue" value={fx.hue} min={-180} max={180} step={1} unit="°" onChange={(v) => up({ hue: v })} onReset={() => set({ hue: 0 })} />
      <Slider label="Blur" value={fx.blur} min={0} max={40} step={0.5} unit="px" onChange={(v) => up({ blur: v })} onReset={() => set({ blur: 0 })} />
      <div className="row">
        <Toggle label="Black & white" value={fx.grayscale} onChange={(v) => up({ grayscale: v })} />
        <Toggle label="Sepia" value={fx.sepia} onChange={(v) => up({ sepia: v })} />
        <Toggle label="Invert" value={fx.invert} onChange={(v) => up({ invert: v })} />
      </div>
    </Section>
  );
}

function FadeSection({ clip }: { clip: VisualClip }) {
  const st = useProject.getState;
  const max = Math.max(0, clip.duration / 2);
  return (
    <Section title="Fade (video)">
      <Slider label="Fade in" value={clip.fadeIn} min={0} max={Math.max(0.1, max)} step={0.1} unit="s" onChange={(v) => st().updateClip(clip.id, { fadeIn: v }, { commit: false })} onReset={() => st().updateClip(clip.id, { fadeIn: 0 })} />
      <Slider label="Fade out" value={clip.fadeOut} min={0} max={Math.max(0.1, max)} step={0.1} unit="s" onChange={(v) => st().updateClip(clip.id, { fadeOut: v }, { commit: false })} onReset={() => st().updateClip(clip.id, { fadeOut: 0 })} />
      <div className="row">
        <button onClick={() => st().updateClip(clip.id, { fadeIn: Math.min(1, max), fadeOut: Math.min(1, max) })}>Fade both 1s</button>
        <button onClick={() => st().updateClip(clip.id, { fadeIn: 0, fadeOut: 0 })}>None</button>
      </div>
    </Section>
  );
}

function AudioSection({ clip }: { clip: Clip & { type: 'video' | 'audio' } }) {
  const st = useProject.getState;
  const asset = useProject((s) => s.project.assets.find((a) => a.id === clip.assetId));
  const a = clip.audio;
  const max = Math.max(0.1, clip.duration / 2);
  if (asset && !asset.hasAudio) return <Section title="Audio"><div className="dim small">This media has no audio track.</div></Section>;
  return (
    <Section title="Audio">
      <div className="row">
        <button className={a.muted ? 'on' : ''} onClick={() => st().updateAudio(clip.id, { muted: !a.muted })}>{a.muted ? '🔇 Muted' : '🔊 Sound on'}</button>
        <button onClick={() => openClipInStudio(clip)} title="Edit this sound in the Audio Studio (EQ, effects, precise fades); send the result back with 'Send to video'">🎛 Open in Audio Studio</button>
      </div>
      <Slider label="Volume" value={a.volume} min={0} max={3} step={0.01} unit="×" onChange={(v) => st().updateAudio(clip.id, { volume: v }, { commit: false })} onReset={() => st().updateAudio(clip.id, { volume: 1 })} />
      <Slider label="Fade in" value={a.fadeIn} min={0} max={max} step={0.1} unit="s" onChange={(v) => st().updateAudio(clip.id, { fadeIn: v }, { commit: false })} onReset={() => st().updateAudio(clip.id, { fadeIn: 0 })} />
      <Slider label="Fade out" value={a.fadeOut} min={0} max={max} step={0.1} unit="s" onChange={(v) => st().updateAudio(clip.id, { fadeOut: v }, { commit: false })} onReset={() => st().updateAudio(clip.id, { fadeOut: 0 })} />
      <div className="dim small">Preview volume is capped at 1×; values above 1× apply on export.</div>
    </Section>
  );
}

function TextSection({ clip }: { clip: Clip & { type: 'text' } }) {
  const st = useProject.getState;
  const t = clip.text;
  const up = (patch: Partial<typeof t>, commit = false) => st().updateText(clip.id, patch, { commit });
  const templates: [string, Partial<typeof t>][] = [
    ['Title', { fontSize: 110, bold: true, align: 'center', animation: 'none', background: '', outline: '', shadow: true, boxWidth: 0.8 }],
    ['Subtitle', { fontSize: 48, bold: false, align: 'center', animation: 'none', background: 'rgba(0,0,0,0.55)', backgroundPadding: 16, boxWidth: 0.9 }],
    ['Lower third', { fontSize: 44, bold: true, align: 'left', animation: 'none', background: 'rgba(20,20,20,0.7)', backgroundPadding: 20, boxWidth: 0.9 }],
    ['Credits', { fontSize: 54, bold: false, align: 'center', animation: 'scroll-up', background: '', lineHeight: 1.6, boxWidth: 0.7 }],
    ['Outline', { fontSize: 100, bold: true, align: 'center', outline: '#000000', shadow: false, background: '' }],
  ];
  return (
    <Section title="Text">
      <button className="primary" style={{ width: '100%', marginBottom: 6 }} onClick={() => st().setTitleStudio(clip.id)}>
        ✨ Open Title Studio (templates, animations, live preview)
      </button>
      <textarea
        className="text-content" rows={5} value={t.content}
        onFocus={() => st().commit()}
        onChange={(e) => up({ content: e.target.value })}
        placeholder="Type your title or credits here…"
      />
      <div className="btn-grid">
        {templates.map(([n, p]) => (
          <button key={n} onClick={() => {
            up(p, true);
            if (n === 'Lower third') st().updateTransform(clip.id, { y: Math.round(useProject.getState().project.height * 0.35), x: 0 }, { commit: false });
            else st().updateTransform(clip.id, { x: 0, y: 0 }, { commit: false });
          }}>{n}</button>
        ))}
      </div>
      <div className="field">
        <label>Animation</label>
        <select value={t.animation} onChange={(e) => up({ animation: e.target.value as any }, true)}>
          <option value="none">Static</option>
          <option value="scroll-up">Scroll up (credits)</option>
        </select>
      </div>
      <div className="field">
        <label>Font</label>
        <select value={t.fontFamily} onChange={(e) => up({ fontFamily: e.target.value }, true)} style={{ fontFamily: t.fontFamily }}>
          {FONT_CHOICES.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
      </div>
      <Slider label="Size" value={t.fontSize} min={10} max={400} step={1} unit="px" onChange={(v) => up({ fontSize: v })} />
      <Slider label="Line height" value={t.lineHeight} min={0.8} max={3} step={0.05} onChange={(v) => up({ lineHeight: v })} />
      <Slider label="Box width" value={t.boxWidth} min={0.1} max={1} step={0.01} onChange={(v) => up({ boxWidth: v })} />
      <div className="row">
        <button className={t.bold ? 'on' : ''} onClick={() => up({ bold: !t.bold }, true)}><b>B</b></button>
        <button className={t.italic ? 'on' : ''} onClick={() => up({ italic: !t.italic }, true)}><i>I</i></button>
        <button className={t.align === 'left' ? 'on' : ''} onClick={() => up({ align: 'left' }, true)}>⇤</button>
        <button className={t.align === 'center' ? 'on' : ''} onClick={() => up({ align: 'center' }, true)}>↔</button>
        <button className={t.align === 'right' ? 'on' : ''} onClick={() => up({ align: 'right' }, true)}>⇥</button>
      </div>
      <div className="field">
        <label>Colour</label>
        <input type="color" value={t.color} onFocus={() => st().commit()} onChange={(e) => up({ color: e.target.value })} />
        <Toggle label="Shadow" value={t.shadow} onChange={(v) => up({ shadow: v })} />
      </div>
      <div className="field">
        <label>Outline</label>
        <input type="checkbox" checked={!!t.outline} onChange={(e) => up({ outline: e.target.checked ? '#000000' : '' }, true)} />
        {t.outline && <input type="color" value={t.outline} onFocus={() => st().commit()} onChange={(e) => up({ outline: e.target.value })} />}
      </div>
      <div className="field">
        <label>Background</label>
        <input type="checkbox" checked={!!t.background} onChange={(e) => up({ background: e.target.checked ? 'rgba(0,0,0,0.6)' : '' }, true)} />
        {t.background && (
          <>
            <input type="color" value={rgbaToHex(t.background)} onFocus={() => st().commit()} onChange={(e) => up({ background: hexToRgba(e.target.value, alphaOf(t.background)) })} />
            <input type="range" min={0} max={1} step={0.05} value={alphaOf(t.background)} onPointerDown={() => st().commit()} onChange={(e) => up({ background: hexToRgba(rgbaToHex(t.background), Number(e.target.value)) })} title="Background opacity" />
          </>
        )}
      </div>
      {t.background && <Slider label="Padding" value={t.backgroundPadding} min={0} max={120} step={1} unit="px" onChange={(v) => up({ backgroundPadding: v })} />}
    </Section>
  );
}

// ---------- links (video <-> separated audio) ----------

function LinkSection({ clip }: { clip: Clip }) {
  const st = useProject.getState;
  const selected = useProject((s) => s.selectedClipIds);
  // select the stable clips array (a fresh filtered array per call would re-render forever)
  const clips = useProject((s) => s.project.clips);
  const linked = clip.linkId ? clips.filter((c) => c.linkId === clip.linkId && c.id !== clip.id) : [];
  const asset = useProject((s) => ('assetId' in clip ? s.project.assets.find((a) => a.id === clip.assetId) : undefined));
  const canSeparate = clip.type === 'video' && asset?.hasAudio && !linked.some((c) => c.type === 'audio');
  const canLink = selected.length >= 2 && !clip.linkId;
  if (!linked.length && !canSeparate && !canLink) return null;
  return (
    <Section title="Linked clips" defaultOpen={false}>
      {linked.length > 0 && (
        <div className="dim small" style={{ marginBottom: 6 }}>
          Moves together with {linked.map((c) => `${c.type === 'audio' ? '🎵' : '🎬'} ${c.name}`).join(', ')}.
        </div>
      )}
      <div className="row">
        {linked.length > 0 && <button onClick={() => st().unlinkClips([clip.id, ...linked.map((c) => c.id)])} title="Edit video and audio independently">🔗 Unlink</button>}
        {canSeparate && <button onClick={() => st().separateAudio(clip.id)} title="Move the sound to an audio track">🎵 Separate audio</button>}
        {canLink && <button onClick={() => st().linkClips(selected)} title="Link the selected clips so they move together">🔗 Link selected</button>}
      </div>
    </Section>
  );
}

// ---------- animations over time ----------

function AnimationsSection({ clip }: { clip: Clip }) {
  const st = useProject.getState;
  const currentTime = useProject((s) => s.currentTime);
  const segs = clip.animations ?? [];
  const isAudio = clip.type === 'audio';
  const [prop, setProp] = useState<AnimatableProperty>(isAudio ? 'volume' : 'blur');
  const atPlayhead = Math.min(Math.max(0, currentTime - clip.start), Math.max(0, clip.duration - 0.5));
  const props = (Object.keys(ANIMATABLE) as AnimatableProperty[]).filter((p) => (isAudio ? p === 'volume' : p !== 'volume' || clip.type === 'video'));
  const presets = ANIMATION_PRESETS.filter((p) => (isAudio ? p.id === 'duck' : p.id !== 'duck' || clip.type === 'video'));

  return (
    <Section title={`Animations ${segs.length ? `(${segs.length})` : ''}`} defaultOpen={segs.length > 0}>
      <div className="dim small" style={{ marginBottom: 6 }}>
        Change a property over a time range inside the clip: ramp up, hold, ramp down. Presets start at the playhead when it is inside the clip.
      </div>
      <div className="btn-grid presets">
        {presets.map((p) => (
          <button key={p.id} title={p.description} onClick={() => st().addAnimations(clip.id, p.build(clip.duration, atPlayhead))}>
            <span className="preset-icon">{p.icon}</span>{p.label}
          </button>
        ))}
      </div>
      <div className="field">
        <label>Custom</label>
        <select value={prop} onChange={(e) => setProp(e.target.value as AnimatableProperty)}>
          {props.map((p) => <option key={p} value={p}>{ANIMATABLE[p].label}</option>)}
        </select>
        <button onClick={() => st().addAnimation(clip.id, newSegment(prop, clip.duration, atPlayhead))}>+ Add</button>
      </div>
      {segs.map((s) => <SegmentEditor key={s.id} clip={clip} seg={s} />)}
      {segs.length > 1 && <div className="row"><button onClick={() => st().clearAnimations(clip.id)}>Remove all animations</button></div>}
    </Section>
  );
}

function SegmentEditor({ clip, seg }: { clip: Clip; seg: AnimationSegment }) {
  const st = useProject.getState;
  const meta = ANIMATABLE[seg.property];
  const up = (patch: Partial<AnimationSegment>, commit = false) => st().updateAnimation(clip.id, seg.id, patch, { commit });
  const D = clip.duration;
  const len = Math.max(0, seg.end - seg.start);
  return (
    <div className="segment">
      <div className="segment-head">
        <strong>{meta.label}</strong>
        <span className="dim small">{seg.start.toFixed(1)}s → {seg.end.toFixed(1)}s</span>
        <button className="small" style={{ marginLeft: 'auto' }} onClick={() => st().removeAnimation(clip.id, seg.id)} title="Remove">✕</button>
      </div>
      {/* visual envelope */}
      <div className="envelope" title="Ramp up · hold · ramp down">
        <div className="env-bar" style={{ left: `${(seg.start / D) * 100}%`, width: `${(len / D) * 100}%` }}>
          <div className="env-ramp in" style={{ width: len ? `${Math.min(100, (seg.rampIn / len) * 100)}%` : 0 }} />
          <div className="env-ramp out" style={{ width: len ? `${Math.min(100, (seg.rampOut / len) * 100)}%` : 0 }} />
        </div>
      </div>
      <Slider label="Amount" value={seg.value} min={meta.min} max={meta.max} step={meta.step} unit={meta.unit} onChange={(v) => up({ value: v })} />
      <div className="field">
        <label>From</label>
        <input type="number" className="num" step={0.1} min={0} max={D} value={Number(seg.start.toFixed(2))} onFocus={() => st().commit()}
          onChange={(e) => { if (e.target.value === '') return; const v = Math.min(Math.max(0, Number(e.target.value)), seg.end - 0.05); up({ start: v }); }} />
        <span className="unit">s</span>
        <label>To</label>
        <input type="number" className="num" step={0.1} min={0} max={D} value={Number(seg.end.toFixed(2))} onFocus={() => st().commit()}
          onChange={(e) => { if (e.target.value === '') return; const v = Math.max(Math.min(D, Number(e.target.value)), seg.start + 0.05); up({ end: v }); }} />
        <span className="unit">s</span>
      </div>
      <div className="field">
        <label>Ramp up</label>
        <input type="number" className="num" step={0.1} min={0} max={len} value={Number(seg.rampIn.toFixed(2))} onFocus={() => st().commit()}
          onChange={(e) => { if (e.target.value === '') return; up({ rampIn: Math.min(len, Math.max(0, Number(e.target.value))) }); }} />
        <span className="unit">s</span>
        <label>Ramp down</label>
        <input type="number" className="num" step={0.1} min={0} max={len} value={Number(seg.rampOut.toFixed(2))} onFocus={() => st().commit()}
          onChange={(e) => { if (e.target.value === '') return; up({ rampOut: Math.min(len, Math.max(0, Number(e.target.value))) }); }} />
        <span className="unit">s</span>
      </div>
      {seg.property !== 'volume' && <div className="field">
        <label>Easing</label>
        <select value={seg.easing} onChange={(e) => up({ easing: e.target.value as AnimationSegment['easing'] }, true)}>
          <option value="linear">Linear</option><option value="ease">Smooth</option><option value="bounce">Bounce</option><option value="elastic">Elastic</option>
        </select>
        <label className="check small" title="Oscillate back and forth (times per second)">
          <input type="checkbox" checked={!!seg.oscillate} onChange={(e) => up({ oscillate: e.target.checked ? 2 : undefined }, true)} /> Wobble
        </label>
        {seg.oscillate ? <input type="number" className="num" step={0.5} min={0.5} max={30} value={seg.oscillate} onFocus={() => st().commit()} onChange={(e) => { if (e.target.value === '') return; up({ oscillate: Math.max(0.5, Number(e.target.value)) }); }} /> : null}
        {seg.oscillate ? <span className="unit">/s</span> : null}
      </div>}
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
