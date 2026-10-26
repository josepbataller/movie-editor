import { useEffect, useRef, useState } from 'react';
import { useStudio } from '@/store/useStudio';
import { PatternClip, NoteEvent, DRUM_NOTES, noteName, SynthPatch, DrumKitPatch, beatsToSeconds } from '@/shared/audioTypes';
import { getEngine } from '@/engine/audio/engine';
import { DRUM_KITS, SYNTH_PRESETS } from '@/engine/audio/presets';

// Note editor for pattern clips: a step sequencer for drum kits, a piano roll for synths,
// plus quick instrument controls. Click = add/toggle, drag = move, drag right edge = length,
// right-click = delete, Shift+click = cycle velocity. The computer keyboard plays notes.

const KEY_ROW = 'awsedftgyhujkolp;'; // C D# style layout starting at the base octave

export default function PatternEditor({ clipId }: { clipId: string }) {
  const clip = useStudio((s) => s.session.clips.find((c) => c.id === clipId && c.type === 'pattern') as PatternClip | undefined);
  const track = useStudio((s) => s.session.tracks.find((t) => t.id === clip?.trackId));
  const grid = useStudio((s) => s.gridDivision);
  const bpm = useStudio((s) => s.session.bpm);
  const st = useStudio.getState;
  if (!clip || !track?.instrument) return null;
  const isDrums = track.instrument.kind === 'drums';

  const setLengthBars = (bars: number) => {
    const beats = Math.max(1, bars) * st().session.beatsPerBar;
    st().updateClip(clip.id, { lengthBeats: beats, duration: beatsToSeconds(beats, bpm), notes: clip.notes.filter((n) => n.start < beats) } as Partial<PatternClip>);
  };
  const beatsPerBar = st().session.beatsPerBar;

  return (
    <div className="pattern-editor">
      <div className="pe-head">
        <strong>{isDrums ? '🥁 Step sequencer' : '🎹 Piano roll'}</strong>
        <input className="track-name" value={clip.name} onFocus={() => st().commit()} onChange={(e) => st().updateClip(clip.id, { name: e.target.value }, { commit: false })} style={{ width: 160 }} />
        <label className="small dim">Length
          <select value={Math.round(clip.lengthBeats / beatsPerBar)} onChange={(e) => setLengthBars(Number(e.target.value))}>
            {[1, 2, 4, 8, 16].map((b) => <option key={b} value={b}>{b} bar{b > 1 ? 's' : ''}</option>)}
          </select>
        </label>
        <label className="small dim">Sound
          <select value={track.instrument.name} onChange={(e) => { const inst = [...DRUM_KITS, ...SYNTH_PRESETS].find((i) => i.name === e.target.value); if (inst) st().setInstrument(track.id, inst); }}>
            <optgroup label="Drums">{DRUM_KITS.map((k) => <option key={k.name} value={k.name}>{k.name}</option>)}</optgroup>
            <optgroup label="Synths">{SYNTH_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</optgroup>
          </select>
        </label>
        <button className="small" onClick={() => st().setNotes(clip.id, [])} disabled={!clip.notes.length}>Clear</button>
        <span className="dim small" style={{ marginLeft: 8 }}>{isDrums ? 'Click a cell to toggle · Shift+click: accent' : 'Click: add note · drag: move · right edge: length · right-click: delete · keys A W S E D…: play'}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button className="small" onClick={() => st().openEditor(null)} title="Close">✕</button>
      </div>
      <div className="pe-body">
        {isDrums ? <StepSequencer clip={clip} grid={grid} trackId={track.id} /> : <PianoRoll clip={clip} grid={grid} trackId={track.id} />}
        <InstrumentControls trackId={track.id} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function usePatternPlayhead(clip: PatternClip): number | null {
  const t = useStudio((s) => s.currentTime);
  const playing = useStudio((s) => s.playing);
  const bpm = useStudio((s) => s.session.bpm);
  if (!playing) return null;
  const local = t - clip.start;
  if (local < 0 || local > clip.duration) return null;
  return (local * bpm) / 60; // beats
}

function StepSequencer({ clip, grid, trackId }: { clip: PatternClip; grid: number; trackId: string }) {
  const st = useStudio.getState;
  const step = Math.min(grid, 1);                       // beats per step (quarter at most)
  const steps = Math.round(clip.lengthBeats / step);
  const playBeat = usePatternPlayhead(clip);
  const toggle = (pitch: number, i: number, accent: boolean) => {
    const start = i * step;
    const existing = clip.notes.find((n) => n.pitch === pitch && Math.abs(n.start - start) < 1e-6);
    if (existing) {
      if (accent) st().updateNote(clip.id, existing.id, { velocity: existing.velocity >= 1 ? 0.6 : 1 });
      else st().removeNotes(clip.id, [existing.id]);
    } else {
      st().addNote(clip.id, { pitch, start, length: step, velocity: accent ? 1 : 0.8 });
      void getEngine().noteOn(trackId, pitch, accent ? 1 : 0.8);
    }
  };
  const beatsPerBar = st().session.beatsPerBar;
  return (
    <div className="step-seq">
      <div className="step-grid" style={{ gridTemplateColumns: `90px repeat(${steps}, minmax(18px, 1fr))` }}>
        <div />
        {Array.from({ length: steps }, (_, i) => <div key={i} className={`step-num ${(i * step) % beatsPerBar === 0 ? 'bar' : ''}`}>{(i * step) % 1 === 0 ? (i * step) % beatsPerBar + 1 : ''}</div>)}
        {DRUM_NOTES.map((d) => (
          <RowFragment key={d.note}>
            <button className="pad-name" onClick={() => getEngine().noteOn(trackId, d.note)} title="Click to hear">{d.name}</button>
            {Array.from({ length: steps }, (_, i) => {
              const start = i * step;
              const n = clip.notes.find((n) => n.pitch === d.note && Math.abs(n.start - start) < 1e-6);
              const active = playBeat != null && playBeat >= start && playBeat < start + step;
              return (
                <div key={i} className={`step ${n ? 'on' : ''} ${n && n.velocity >= 1 ? 'accent' : ''} ${(start % beatsPerBar) < 1e-6 ? 'bar' : ''} ${active ? 'now' : ''}`}
                  onMouseDown={(e) => { if (e.button === 0) toggle(d.note, i, e.shiftKey); }} onContextMenu={(e) => { e.preventDefault(); if (n) st().removeNotes(clip.id, [n.id]); }} />
              );
            })}
          </RowFragment>
        ))}
      </div>
    </div>
  );
}
function RowFragment({ children }: { children: React.ReactNode }) { return <>{children}</>; }

// ---------------------------------------------------------------------------

const ROW_H = 14;
const LOW = 24, HIGH = 96; // C1..C7

function PianoRoll({ clip, grid, trackId }: { clip: PatternClip; grid: number; trackId: string }) {
  const st = useStudio.getState;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pxPerBeat, setPxPerBeat] = useState(48);
  const playBeat = usePatternPlayhead(clip);
  const [selected, setSelected] = useState<string | null>(null);
  const rows = HIGH - LOW + 1;
  const W = clip.lengthBeats * pxPerBeat;
  const H = rows * ROW_H;
  const beatsPerBar = st().session.beatsPerBar;
  const pitchAtY = (y: number) => HIGH - Math.floor(y / ROW_H);
  const yOfPitch = (p: number) => (HIGH - p) * ROW_H;
  const snapBeat = (b: number) => Math.round(b / grid) * grid;

  // open centred on the clip's notes (or around C4 when empty)
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const centre = clip.notes.length ? Math.round(clip.notes.reduce((a, n) => a + n.pitch, 0) / clip.notes.length) : 66;
    el.scrollTop = Math.max(0, yOfPitch(centre) - el.clientHeight / 2);
  }, [clip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // computer keyboard playing
  useEffect(() => {
    const down = new Set<number>();
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
      const idx = KEY_ROW.indexOf(e.key.toLowerCase());
      if (idx < 0 || e.ctrlKey || e.metaKey) return;
      const semis = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16][idx];
      const pitch = 60 + semis;
      if (e.type === 'keydown') { if (down.has(pitch)) return; down.add(pitch); void getEngine().noteOn(trackId, pitch); }
      else { down.delete(pitch); getEngine().noteOff(trackId, pitch); }
    };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); };
  }, [trackId]);

  const onGridDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const pitch = pitchAtY(y);
    const start = Math.max(0, Math.min(clip.lengthBeats - grid, snapBeat(x / pxPerBeat - grid / 2)));
    const id = st().addNote(clip.id, { pitch, start, length: grid, velocity: 0.85 });
    setSelected(id);
    void getEngine().noteOn(trackId, pitch, 0.85);
    setTimeout(() => getEngine().noteOff(trackId, pitch), 250);
    // drag to extend the new note
    const move = (ev: MouseEvent) => {
      const bx = (ev.clientX - rect.left) / pxPerBeat;
      const len = Math.max(grid, snapBeat(bx) - start);
      st().updateNote(clip.id, id, { length: Math.min(len, clip.lengthBeats - start) }, { commit: false });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const onNoteDown = (e: React.MouseEvent, n: NoteEvent, mode: 'move' | 'resize') => {
    e.stopPropagation();
    if (e.button === 2) { st().removeNotes(clip.id, [n.id]); return; }
    if (e.button !== 0) return;
    setSelected(n.id);
    if (e.shiftKey) { st().updateNote(clip.id, n.id, { velocity: n.velocity >= 1 ? 0.5 : Math.min(1, n.velocity + 0.25) }); return; }
    const startX = e.clientX, startY = e.clientY;
    let committed = false;
    const move = (ev: MouseEvent) => {
      if (!committed) { st().commit(); committed = true; }
      const db = (ev.clientX - startX) / pxPerBeat;
      if (mode === 'move') {
        const dp = -Math.round((ev.clientY - startY) / ROW_H);
        const start = Math.max(0, Math.min(clip.lengthBeats - n.length, snapBeat(n.start + db)));
        const pitch = Math.max(LOW, Math.min(HIGH, n.pitch + dp));
        st().updateNote(clip.id, n.id, { start, pitch }, { commit: false });
      } else {
        st().updateNote(clip.id, n.id, { length: Math.max(grid, Math.min(clip.lengthBeats - n.start, snapBeat(n.length + db))) }, { commit: false });
      }
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.stopPropagation(); st().removeNotes(clip.id, [selected]); setSelected(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected, clip.id]);

  return (
    <div className="piano-roll">
      <div className="pr-tools">
        <span className="dim small">Zoom</span>
        <input type="range" min={16} max={160} value={pxPerBeat} onChange={(e) => setPxPerBeat(Number(e.target.value))} />
      </div>
      <div className="pr-scroll" ref={wrapRef}>
        <div className="pr-inner" style={{ width: 60 + W, height: H }}>
          <div className="pr-keys" style={{ height: H }}>
            {Array.from({ length: rows }, (_, i) => { const p = HIGH - i; const black = [1, 3, 6, 8, 10].includes(p % 12); return (
              <div key={p} className={`pr-key ${black ? 'black' : ''} ${p % 12 === 0 ? 'c' : ''}`} style={{ top: i * ROW_H, height: ROW_H }}
                onMouseDown={() => { void getEngine().noteOn(trackId, p); }} onMouseUp={() => getEngine().noteOff(trackId, p)} onMouseLeave={() => getEngine().noteOff(trackId, p)}>
                {p % 12 === 0 ? noteName(p) : ''}
              </div>); })}
          </div>
          <div className="pr-grid" style={{ left: 60, width: W, height: H, backgroundSize: `${pxPerBeat * beatsPerBar}px ${ROW_H * 12}px, ${pxPerBeat}px ${ROW_H}px, ${pxPerBeat * grid}px ${ROW_H}px` }}
            onMouseDown={onGridDown} onContextMenu={(e) => e.preventDefault()}>
            {Array.from({ length: rows }, (_, i) => { const p = HIGH - i; return [1, 3, 6, 8, 10].includes(p % 12) ? <div key={p} className="pr-black-row" style={{ top: i * ROW_H, height: ROW_H }} /> : null; })}
            {clip.notes.map((n) => (
              <div key={n.id} className={`pr-note ${selected === n.id ? 'selected' : ''}`}
                style={{ left: n.start * pxPerBeat, top: yOfPitch(n.pitch) + 1, width: Math.max(4, n.length * pxPerBeat - 1), height: ROW_H - 2, opacity: 0.55 + n.velocity * 0.45 }}
                onMouseDown={(e) => onNoteDown(e, n, 'move')} onContextMenu={(e) => { e.preventDefault(); st().removeNotes(clip.id, [n.id]); }}
                title={`${noteName(n.pitch)} · ${n.length} beats · vel ${Math.round(n.velocity * 100)}%`}>
                <span className="pr-note-label">{n.length * pxPerBeat > 30 ? noteName(n.pitch) : ''}</span>
                <div className="pr-resize" onMouseDown={(e) => onNoteDown(e, n, 'resize')} />
              </div>
            ))}
            {playBeat != null && <div className="pr-playhead" style={{ left: playBeat * pxPerBeat }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function InstrumentControls({ trackId }: { trackId: string }) {
  const track = useStudio((s) => s.session.tracks.find((t) => t.id === trackId));
  const st = useStudio.getState;
  const inst = track?.instrument;
  if (!inst) return null;
  const upd = (patch: Record<string, unknown>) => st().updateInstrument(trackId, patch as Partial<typeof inst>, { commit: false });
  const K = ({ label, value, min, max, step = 0.01, onChange, fmt }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) => (
    <label className="knob"><span className="knob-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={() => st().commit()} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="knob-value">{fmt ? fmt(value) : Number(value.toFixed(2))}</span></label>
  );
  if (inst.kind === 'drums') {
    const d = inst as DrumKitPatch;
    return (
      <div className="inst-controls">
        <div className="inst-title">Kit: {d.name}</div>
        <div className="knobs">
          <K label="Tune" value={d.tune} min={-12} max={12} step={1} onChange={(v) => upd({ tune: v })} fmt={(v) => `${v > 0 ? '+' : ''}${v} st`} />
          <K label="Decay" value={d.decay} min={0.3} max={2.5} onChange={(v) => upd({ decay: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <K label="Punch" value={d.punch} min={0} max={1} onChange={(v) => upd({ punch: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <K label="Level" value={d.gain} min={0} max={1.5} onChange={(v) => upd({ gain: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
        </div>
      </div>
    );
  }
  const p = inst as SynthPatch;
  const sub = (key: 'filter' | 'ampEnv' | 'lfo' | 'osc1' | 'osc2' | 'fm', patch: Record<string, unknown>) => upd({ [key]: { ...(p as any)[key], ...patch } });
  return (
    <div className="inst-controls">
      <div className="inst-title">Synth: {p.name}</div>
      <div className="knobs">
        <label className="knob"><span className="knob-label">Osc 1</span>
          <select value={p.osc1.wave} onChange={(e) => sub('osc1', { wave: e.target.value })}><option>sawtooth</option><option>square</option><option>triangle</option><option>sine</option><option>noise</option></select></label>
        <label className="knob"><span className="knob-label">Osc 2</span>
          <select value={p.osc2.wave} onChange={(e) => sub('osc2', { wave: e.target.value })}><option>sawtooth</option><option>square</option><option>triangle</option><option>sine</option><option>noise</option></select></label>
        <K label="Osc 2 level" value={p.osc2.level} min={0} max={1} onChange={(v) => sub('osc2', { level: v })} />
        <K label="Detune" value={p.osc2.detune} min={-50} max={50} step={1} onChange={(v) => sub('osc2', { detune: v })} fmt={(v) => `${v} ct`} />
        <K label="Sub" value={p.sub} min={0} max={1} onChange={(v) => upd({ sub: v })} />
        <K label="Unison" value={p.unison} min={0} max={4} step={1} onChange={(v) => upd({ unison: v })} fmt={(v) => `${v}`} />
      </div>
      <div className="knobs">
        <K label="Cutoff" value={Math.log2(p.filter.cutoff)} min={Math.log2(40)} max={Math.log2(16000)} step={0.01} onChange={(v) => sub('filter', { cutoff: Math.pow(2, v) })} fmt={() => `${Math.round(p.filter.cutoff)} Hz`} />
        <K label="Resonance" value={p.filter.resonance} min={0.1} max={20} step={0.1} onChange={(v) => sub('filter', { resonance: v })} />
        <K label="Filter env" value={p.filter.envAmount} min={-5000} max={8000} step={50} onChange={(v) => sub('filter', { envAmount: v })} fmt={(v) => `${v}`} />
        <K label="Attack" value={p.ampEnv.attack} min={0.001} max={3} step={0.001} onChange={(v) => sub('ampEnv', { attack: v })} fmt={(v) => `${Math.round(v * 1000)} ms`} />
        <K label="Decay" value={p.ampEnv.decay} min={0.01} max={3} step={0.01} onChange={(v) => sub('ampEnv', { decay: v })} fmt={(v) => `${Math.round(v * 1000)} ms`} />
        <K label="Sustain" value={p.ampEnv.sustain} min={0} max={1} onChange={(v) => sub('ampEnv', { sustain: v })} />
        <K label="Release" value={p.ampEnv.release} min={0.01} max={4} step={0.01} onChange={(v) => sub('ampEnv', { release: v })} fmt={(v) => `${Math.round(v * 1000)} ms`} />
        <K label="Glide" value={p.glide} min={0} max={0.5} step={0.005} onChange={(v) => upd({ glide: v })} fmt={(v) => `${Math.round(v * 1000)} ms`} />
        <K label="FM amount" value={p.fm.amount} min={0} max={1000} step={5} onChange={(v) => sub('fm', { amount: v })} fmt={(v) => `${v}`} />
        <K label="Level" value={p.gain} min={0} max={1} onChange={(v) => upd({ gain: v })} />
      </div>
    </div>
  );
}
