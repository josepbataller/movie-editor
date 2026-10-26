import { useEffect, useRef, useState } from 'react';
import { useStudio } from '@/store/useStudio';
import { AudioEffect, AudioEffectType, EFFECT_LABELS, EqBand, uidA } from '@/shared/audioTypes';
import { getEngine } from '@/engine/audio/engine';
import { eqResponse } from '@/engine/audio/effects';

// Effects chain editor for a track or the master bus. The EQ shows its response curve over the
// live spectrum of the signal, with draggable bands (drag = frequency/gain, wheel = Q).

const ADDABLE: AudioEffectType[] = ['eq', 'filter', 'compressor', 'reverb', 'delay', 'chorus', 'distortion', 'bitcrusher'];

export default function FxPanel({ target, embedded = false }: { target: string | 'master'; embedded?: boolean }) {
  const st = useStudio.getState;
  const track = useStudio((s) => (target === 'master' ? null : s.session.tracks.find((t) => t.id === target)));
  const clip = useStudio((s) => (target === 'master' ? null : s.session.clips.find((c) => c.id === target)));
  const effects = useStudio((s) => {
    if (target === 'master') return s.session.masterEffects;
    const t = s.session.tracks.find((t) => t.id === target);
    if (t) return t.effects;
    const c = s.session.clips.find((c) => c.id === target);
    return c && c.type === 'sample' ? c.effects : undefined;
  }) ?? [];
  const [adding, setAdding] = useState<AudioEffectType>('eq');
  const title = target === 'master' ? 'Master bus' : track?.name ?? (clip ? `clip "${clip.name}"` : '');

  return (
    <div className="fx-panel">
      <div className="fx-head">
        <strong>FX · {title}</strong>
        <span className="dim small">Signal flows left → right</span>
        <span style={{ marginLeft: 'auto' }} />
        <select value={adding} onChange={(e) => setAdding(e.target.value as AudioEffectType)}>
          {ADDABLE.map((t) => <option key={t} value={t}>{EFFECT_LABELS[t]}</option>)}
        </select>
        <button className="primary small" onClick={() => st().addEffect(target, adding)}>+ Add</button>
        {!embedded && <button className="small" onClick={() => st().openFx(null)} title="Close">✕</button>}
      </div>
      <div className="fx-chain">
        {effects.length === 0 && <div className="dim small" style={{ padding: 16 }}>No effects yet. Add an Equalizer to shape frequencies, a Compressor to even out levels, Reverb/Delay for space…</div>}
        {effects.map((fx, i) => (
          <div key={fx.id} className={`fx-card ${fx.enabled ? '' : 'bypassed'} ${fx.type}`}>
            <div className="fx-card-head">
              <label className="check"><input type="checkbox" checked={fx.enabled} onChange={(e) => st().updateEffect(target, fx.id, { enabled: e.target.checked } as Partial<AudioEffect>)} /></label>
              <strong>{EFFECT_LABELS[fx.type]}</strong>
              <span style={{ marginLeft: 'auto' }} />
              <button className="tiny" disabled={i === 0} onClick={() => st().moveEffect(target, fx.id, -1)} title="Move earlier">◀</button>
              <button className="tiny" disabled={i === effects.length - 1} onClick={() => st().moveEffect(target, fx.id, 1)} title="Move later">▶</button>
              <button className="tiny" onClick={() => st().removeEffect(target, fx.id)} title="Remove">✕</button>
            </div>
            <EffectBody fx={fx} target={target} analyserId={clip ? clip.trackId : target} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Knob({ label, value, min, max, step = 0.01, unit = '', onChange, format }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; format?: (v: number) => string }) {
  const commit = () => useStudio.getState().commit();
  return (
    <label className="knob">
      <span className="knob-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={commit} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="knob-value">{format ? format(value) : `${Number(value.toFixed(2))}${unit}`}</span>
    </label>
  );
}

function EffectBody({ fx, target, analyserId }: { fx: AudioEffect; target: string | 'master'; analyserId: string | 'master' }) {
  const st = useStudio.getState;
  const up = (patch: Record<string, unknown>) => st().updateEffect(target, fx.id, patch as Partial<AudioEffect>, { commit: false });
  const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`) + ' Hz';
  const ms = (v: number) => `${Math.round(v * 1000)} ms`;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  switch (fx.type) {
    case 'eq': return <EqEditor fx={fx} target={target} analyserId={analyserId} />;
    case 'filter': return (
      <div className="knobs">
        <label className="knob"><span className="knob-label">Mode</span>
          <select value={fx.mode} onChange={(e) => st().updateEffect(target, fx.id, { mode: e.target.value } as Partial<AudioEffect>)}>
            <option value="lowpass">Low-pass (cut highs)</option><option value="highpass">High-pass (cut lows)</option><option value="bandpass">Band-pass</option>
          </select></label>
        <Knob label="Cutoff" value={Math.log2(fx.frequency)} min={Math.log2(20)} max={Math.log2(20000)} step={0.01} onChange={(v) => up({ frequency: Math.pow(2, v) })} format={() => hz(fx.frequency)} />
        <Knob label="Resonance" value={fx.q} min={0.1} max={20} step={0.1} onChange={(v) => up({ q: v })} />
      </div>);
    case 'reverb': return (
      <div className="knobs">
        <Knob label="Size / decay" value={fx.decay} min={0.2} max={10} step={0.1} unit=" s" onChange={(v) => up({ decay: v })} />
        <Knob label="Pre-delay" value={fx.preDelay} min={0} max={0.2} step={0.001} onChange={(v) => up({ preDelay: v })} format={ms} />
        <Knob label="Tone" value={fx.tone} min={0} max={1} onChange={(v) => up({ tone: v })} format={(v) => (v < 0.4 ? 'dark' : v > 0.7 ? 'bright' : 'neutral')} />
        <Knob label="Mix" value={fx.mix} min={0} max={1} onChange={(v) => up({ mix: v })} format={pct} />
      </div>);
    case 'delay': return (
      <div className="knobs">
        <label className="knob"><span className="knob-label">Time</span>
          <select value={fx.sync ? String(fx.division) : 'free'} onChange={(e) => { const v = e.target.value; if (v === 'free') st().updateEffect(target, fx.id, { sync: false } as Partial<AudioEffect>); else st().updateEffect(target, fx.id, { sync: true, division: Number(v) } as Partial<AudioEffect>); }}>
            <option value="0.25">1/16</option><option value="0.5">1/8</option><option value={String(2 / 3)}>1/8 triplet</option><option value="0.75">dotted 1/8</option><option value="1">1/4</option><option value="1.5">dotted 1/4</option><option value="2">1/2</option><option value="free">free (ms)</option>
          </select></label>
        {!fx.sync && <Knob label="Delay" value={fx.time} min={0.01} max={2} step={0.001} onChange={(v) => up({ time: v })} format={ms} />}
        <Knob label="Feedback" value={fx.feedback} min={0} max={0.95} onChange={(v) => up({ feedback: v })} format={pct} />
        <Knob label="Tone" value={fx.tone} min={0} max={1} onChange={(v) => up({ tone: v })} format={pct} />
        <Knob label="Mix" value={fx.mix} min={0} max={1} onChange={(v) => up({ mix: v })} format={pct} />
        <label className="check small"><input type="checkbox" checked={fx.pingPong} onChange={(e) => st().updateEffect(target, fx.id, { pingPong: e.target.checked } as Partial<AudioEffect>)} /> Ping-pong</label>
      </div>);
    case 'compressor': return (
      <div className="knobs">
        <Knob label="Threshold" value={fx.threshold} min={-60} max={0} step={0.5} unit=" dB" onChange={(v) => up({ threshold: v })} />
        <Knob label="Ratio" value={fx.ratio} min={1} max={20} step={0.1} unit=":1" onChange={(v) => up({ ratio: v })} />
        <Knob label="Attack" value={fx.attack} min={0} max={0.3} step={0.001} onChange={(v) => up({ attack: v })} format={ms} />
        <Knob label="Release" value={fx.release} min={0.02} max={1} step={0.01} onChange={(v) => up({ release: v })} format={ms} />
        <Knob label="Knee" value={fx.knee} min={0} max={40} step={1} unit=" dB" onChange={(v) => up({ knee: v })} />
        <Knob label="Makeup" value={fx.makeup} min={0} max={24} step={0.5} unit=" dB" onChange={(v) => up({ makeup: v })} />
      </div>);
    case 'distortion': return (
      <div className="knobs">
        <Knob label="Drive" value={fx.drive} min={0} max={1} onChange={(v) => up({ drive: v })} format={pct} />
        <Knob label="Tone" value={fx.tone} min={0} max={1} onChange={(v) => up({ tone: v })} format={pct} />
        <Knob label="Mix" value={fx.mix} min={0} max={1} onChange={(v) => up({ mix: v })} format={pct} />
      </div>);
    case 'chorus': return (
      <div className="knobs">
        <Knob label="Rate" value={fx.rate} min={0.05} max={8} step={0.05} unit=" Hz" onChange={(v) => up({ rate: v })} />
        <Knob label="Depth" value={fx.depth} min={0} max={0.015} step={0.0005} onChange={(v) => up({ depth: v })} format={(v) => `${(v * 1000).toFixed(1)} ms`} />
        <Knob label="Mix" value={fx.mix} min={0} max={1} onChange={(v) => up({ mix: v })} format={pct} />
      </div>);
    case 'bitcrusher': return (
      <div className="knobs">
        <Knob label="Bits" value={fx.bits} min={2} max={16} step={1} onChange={(v) => up({ bits: v })} format={(v) => `${v} bit`} />
        <Knob label="Downsample" value={fx.downsample} min={1} max={40} step={1} onChange={(v) => up({ downsample: v })} format={(v) => `÷${v}`} />
        <Knob label="Mix" value={fx.mix} min={0} max={1} onChange={(v) => up({ mix: v })} format={pct} />
      </div>);
    default: return <div className="dim small">This effect has no editable parameters.</div>;
  }
}

// ---------------------------------------------------------------------------
// Parametric EQ with live spectrum
// ---------------------------------------------------------------------------

const FMIN = 20, FMAX = 20000, DB_RANGE = 18;
const fToX = (f: number, w: number) => (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * w;
const xToF = (x: number, w: number) => FMIN * Math.pow(FMAX / FMIN, x / w);
const dbToY = (db: number, h: number) => h / 2 - (db / DB_RANGE) * (h / 2);
const yToDb = (y: number, h: number) => ((h / 2 - y) / (h / 2)) * DB_RANGE;
const BAND_COLORS = ['#ff7f50', '#ffd166', '#7cb342', '#2bb3c4', '#b85fa8', '#4f8cff', '#d9534f', '#9aa1b1'];

function EqEditor({ fx, target, analyserId }: { fx: Extract<AudioEffect, { type: 'eq' }>; target: string | 'master'; analyserId: string | 'master' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState<string | null>(fx.bands[2]?.id ?? null);
  const st = useStudio.getState;
  const fxRef = useRef(fx); fxRef.current = fx;
  const selRef = useRef(sel); selRef.current = sel;
  const W = 640, H = 220;

  // draw loop: spectrum + response + band handles
  useEffect(() => {
    const engine = getEngine();
    const freqs = new Float32Array(W);
    for (let x = 0; x < W; x++) freqs[x] = xToF(x, W);
    let raf = 0;
    let spec: Float32Array<ArrayBuffer> | null = null;
    const tick = () => {
      const c = ref.current;
      if (c) {
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0f1014'; ctx.fillRect(0, 0, W, H);
        // grid
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.font = '10px Segoe UI'; ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = fToX(f, W); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, H - 4); }
        for (const db of [-12, -6, 0, 6, 12]) { const y = dbToY(db, H); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.fillText(`${db > 0 ? '+' : ''}${db}`, 3, y - 2); }
        // live spectrum
        const an = engine.getAnalyser(analyserId);
        if (an) {
          if (!spec || spec.length !== an.frequencyBinCount) spec = new Float32Array(an.frequencyBinCount);
          an.getFloatFrequencyData(spec);
          ctx.beginPath();
          ctx.moveTo(0, H);
          const sr = engine.ctx.sampleRate;
          for (let x = 0; x < W; x++) {
            const f = freqs[x];
            const bin = Math.min(spec.length - 1, Math.round((f / (sr / 2)) * spec.length));
            const db = spec[bin]; // typically -100..0
            const y = H - Math.min(1, Math.max(0, (db + 90) / 90)) * H;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(W, H); ctx.closePath();
          ctx.fillStyle = 'rgba(79,140,255,0.22)'; ctx.fill();
        }
        // response curve
        const resp = eqResponse(engine.ctx, fxRef.current.bands, freqs);
        ctx.beginPath();
        for (let x = 0; x < W; x++) { const y = dbToY(Math.max(-DB_RANGE, Math.min(DB_RANGE, resp[x])), H); x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.stroke();
        // handles
        fxRef.current.bands.forEach((b, i) => {
          const x = fToX(b.frequency, W);
          const y = b.type === 'lowpass' || b.type === 'highpass' || b.type === 'notch' ? H / 2 : dbToY(b.gain, H);
          ctx.beginPath(); ctx.arc(x, y, selRef.current === b.id ? 8 : 6, 0, Math.PI * 2);
          ctx.fillStyle = b.enabled ? BAND_COLORS[i % BAND_COLORS.length] : '#555'; ctx.fill();
          ctx.strokeStyle = selRef.current === b.id ? '#fff' : 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = '#000'; ctx.font = 'bold 9px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), x, y + 3); ctx.textAlign = 'left';
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyserId]);

  const bandAt = (x: number, y: number): EqBand | null => {
    let best: EqBand | null = null, bd = 14;
    for (const b of fx.bands) {
      const bx = fToX(b.frequency, W);
      const by = b.type === 'lowpass' || b.type === 'highpass' || b.type === 'notch' ? H / 2 : dbToY(b.gain, H);
      const d = Math.hypot(bx - x, by - y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  };
  const updBand = (id: string, patch: Partial<EqBand>, commit = false) =>
    st().updateEffect(target, fx.id, { bands: fxRef.current.bands.map((b) => (b.id === id ? { ...b, ...patch } : b)) } as Partial<AudioEffect>, { commit });

  const onDown = (e: React.MouseEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const sx = W / rect.width, sy = H / rect.height;
    const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
    let b = bandAt(x, y);
    if (!b) {
      if (e.detail === 2) { // double-click on empty space: new peaking band
        st().commit();
        const nb: EqBand = { id: uidA(), type: 'peaking', frequency: xToF(x, W), gain: yToDb(y, H), q: 1, enabled: true };
        st().updateEffect(target, fx.id, { bands: [...fx.bands, nb] } as Partial<AudioEffect>, { commit: false });
        setSel(nb.id);
      }
      return;
    }
    setSel(b.id);
    st().commit();
    const id = b.id;
    const move = (ev: MouseEvent) => {
      const mx = (ev.clientX - rect.left) * sx, my = (ev.clientY - rect.top) * sy;
      const cur = fxRef.current.bands.find((bb) => bb.id === id)!;
      const patch: Partial<EqBand> = { frequency: Math.min(FMAX, Math.max(FMIN, xToF(mx, W))) };
      if (!(cur.type === 'lowpass' || cur.type === 'highpass' || cur.type === 'notch')) patch.gain = Math.max(-DB_RANGE, Math.min(DB_RANGE, yToDb(my, H)));
      updBand(id, patch);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const onWheel = (e: React.WheelEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const b = bandAt((e.clientX - rect.left) * (W / rect.width), (e.clientY - rect.top) * (H / rect.height)) ?? fx.bands.find((bb) => bb.id === sel);
    if (!b) return;
    updBand(b.id, { q: Math.min(30, Math.max(0.1, b.q * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) });
  };

  const selected = fx.bands.find((b) => b.id === sel) ?? null;
  return (
    <div className="eq">
      <canvas ref={ref} width={W} height={H} className="eq-canvas" onMouseDown={onDown} onWheel={onWheel}
        title="Drag a band: frequency / gain · wheel: width (Q) · double-click empty space: new band" />
      <div className="eq-bands">
        {fx.bands.map((b, i) => (
          <button key={b.id} className={`band-chip ${sel === b.id ? 'on' : ''} ${b.enabled ? '' : 'off'}`} style={{ borderColor: BAND_COLORS[i % BAND_COLORS.length] }} onClick={() => setSel(b.id)}>
            {i + 1} · {b.frequency >= 1000 ? `${(b.frequency / 1000).toFixed(1)}k` : Math.round(b.frequency)}
          </button>
        ))}
        {selected && (
          <div className="band-edit">
            <select value={selected.type} onChange={(e) => updBand(selected.id, { type: e.target.value as EqBand['type'] }, true)}>
              <option value="peaking">Bell</option><option value="lowshelf">Low shelf</option><option value="highshelf">High shelf</option>
              <option value="highpass">High-pass (cut lows)</option><option value="lowpass">Low-pass (cut highs)</option><option value="notch">Notch (kill)</option>
            </select>
            <label className="check small"><input type="checkbox" checked={selected.enabled} onChange={(e) => updBand(selected.id, { enabled: e.target.checked }, true)} /> On</label>
            <span className="dim small">{Math.round(selected.frequency)} Hz · {selected.gain > 0 ? '+' : ''}{selected.gain.toFixed(1)} dB · Q {selected.q.toFixed(2)}</span>
            <button className="tiny" onClick={() => { st().commit(); st().updateEffect(target, fx.id, { bands: fx.bands.filter((b) => b.id !== selected.id) } as Partial<AudioEffect>, { commit: false }); setSel(null); }}>Remove band</button>
          </div>
        )}
      </div>
    </div>
  );
}
