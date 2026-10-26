import { useEffect, useRef, useState } from 'react';
import { useStudio } from '@/store/useStudio';
import { useProject } from '@/store/useProject';
import { SampleClip, FadeCurve } from '@/shared/audioTypes';
import { getEngine, peaks } from '@/engine/audio/engine';
import { spectrogram, processRegion, normalize, gainRegion, slice, reverseBuffer, Spectrogram } from '@/engine/audio/spectral';
import { saveBufferAsAsset, decodeFile } from '@/engine/audio/recording';
import { audioBufferToWav } from '@/engine/audio/engine';
import FxPanel from './FxPanel';

// Clip editor for sample clips: waveform + spectrogram of the clip's audio, a
// time/frequency selection, non-destructive "render in place" tools (every
// process writes a new WAV and swaps the clip to it; the original stays in the
// media library), playback settings and a clip-level effects chain.

interface Selection { t0: number; t1: number; f0: number; f1: number }  // seconds (clip-local) / Hz

const FMIN = 30;
const W = 1100, WAVE_H = 90, SPEC_H = 220;

export default function ClipEditor({ clipId }: { clipId: string }) {
  const clip = useStudio((s) => s.session.clips.find((c) => c.id === clipId && c.type === 'sample') as SampleClip | undefined);
  const asset = useProject((s) => s.project.assets.find((a) => a.id === clip?.assetId));
  const [tab, setTab] = useState<'edit' | 'fx'>('edit');
  if (!clip) return null;
  return (
    <div className="clip-editor">
      <div className="pe-head">
        <strong>🎚 Clip editor</strong>
        <input className="track-name" value={clip.name} style={{ width: 200 }} onFocus={() => useStudio.getState().commit()} onChange={(e) => useStudio.getState().updateClip(clip.id, { name: e.target.value }, { commit: false })} />
        <span className="dim small">{asset?.name}{clip.sourceAssetId ? ' · processed copy' : ''}</span>
        <div className="tabs inline">
          <button className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>Edit</button>
          <button className={tab === 'fx' ? 'on' : ''} onClick={() => setTab('fx')}>Clip effects{clip.effects?.length ? ` (${clip.effects.length})` : ''}</button>
        </div>
        <span style={{ marginLeft: 'auto' }} />
        <button className="small" onClick={() => useStudio.getState().openClipEditor(null)} title="Close">✕</button>
      </div>
      {tab === 'fx' ? <FxPanel target={clip.id} embedded /> : <ClipEditBody clip={clip} />}
    </div>
  );
}

function ClipEditBody({ clip }: { clip: SampleClip }) {
  const st = useStudio.getState;
  const assets = useProject((s) => s.project.assets);
  const asset = assets.find((a) => a.id === clip.assetId);
  const [sel, setSel] = useState<Selection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [spec, setSpec] = useState<Spectrogram | null>(null);
  const [, bump] = useState(0);
  const [dB, setDb] = useState(-18);
  const [semis, setSemis] = useState(0);
  const [stretch, setStretch] = useState(100);
  const [denoise, setDenoise] = useState(12);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const engine = getEngine();
  const buffer = engine.getBuffer(clip.assetId);
  const sr = buffer?.sampleRate ?? 48000;
  const fmax = sr / 2;

  // source range covered by the clip (in buffer seconds)
  const from = clip.reverse && buffer ? Math.max(0, buffer.duration - clip.inPoint - clip.duration * clip.rate) : clip.inPoint;
  const to = from + clip.duration * clip.rate;

  useEffect(() => { if (!buffer && asset) void engine.loadAsset(asset).then(() => bump((n) => n + 1)); }, [buffer, asset, engine]);

  // spectrogram (computed once per clip range)
  useEffect(() => {
    if (!buffer) return;
    const id = setTimeout(() => setSpec(spectrogram(buffer, from, to, W, 1024)), 0);
    return () => clearTimeout(id);
  }, [buffer, from, to]);

  const yOfFreq = (f: number) => SPEC_H - (Math.log(Math.max(FMIN, f) / FMIN) / Math.log(fmax / FMIN)) * SPEC_H;
  const freqOfY = (y: number) => FMIN * Math.pow(fmax / FMIN, (SPEC_H - y) / SPEC_H);
  const xOfT = (t: number) => (t / clip.duration) * W;
  const tOfX = (x: number) => (x / W) * clip.duration;

  // draw waveform
  useEffect(() => {
    const c = waveRef.current; if (!c || !buffer) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, WAVE_H);
    ctx.fillStyle = '#0f1014'; ctx.fillRect(0, 0, W, WAVE_H);
    const pk = peaks(buffer, from, to, W);
    ctx.fillStyle = '#7cc4ff';
    const mid = WAVE_H / 2;
    for (let x = 0; x < W; x++) {
      const i = clip.reverse ? W - 1 - x : x;
      const mn = pk[i * 2] * clip.gain, mx = pk[i * 2 + 1] * clip.gain;
      ctx.fillRect(x, mid - Math.max(0.5, mx * mid), 1, Math.max(1, (mx - mn) * mid));
    }
    if (sel) { ctx.fillStyle = 'rgba(255,209,102,0.25)'; ctx.fillRect(xOfT(sel.t0), 0, xOfT(sel.t1) - xOfT(sel.t0), WAVE_H); }
  }, [buffer, from, to, clip.gain, clip.reverse, sel]);

  // draw spectrogram + selection
  useEffect(() => {
    const c = specRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, SPEC_H);
    ctx.fillStyle = '#07080b'; ctx.fillRect(0, 0, W, SPEC_H);
    if (spec) {
      const img = ctx.createImageData(W, SPEC_H);
      const d = img.data;
      for (let y = 0; y < SPEC_H; y++) {
        const f = freqOfY(y);
        const bin = Math.min(spec.bins - 1, Math.max(0, Math.round((f / fmax) * spec.bins)));
        for (let x = 0; x < W; x++) {
          const frame = Math.min(spec.frames - 1, Math.floor(((clip.reverse ? W - 1 - x : x) / W) * spec.frames));
          const v = spec.data[frame * spec.bins + bin]; // -100..0 dB
          const p = Math.min(1, Math.max(0, (v + 90) / 90));
          const o = (y * W + x) * 4;
          // colour map: black -> deep blue -> magenta -> orange -> yellow -> white
          const r = p < 0.5 ? p * 2 * 180 : 180 + (p - 0.5) * 2 * 75;
          const g = p < 0.6 ? p * 60 : (p - 0.6) * 2.5 * 220 + 36;
          const b = p < 0.4 ? p * 2.5 * 200 : 200 - (p - 0.4) * 1.6 * 200;
          d[o] = r; d[o + 1] = g; d[o + 2] = Math.max(0, b); d[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    // frequency grid
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px Segoe UI';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { if (f >= fmax) continue; const y = yOfFreq(f); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), 3, y - 2); }
    if (sel) {
      const x0 = xOfT(sel.t0), x1 = xOfT(sel.t1), y0 = yOfFreq(sel.f1), y1 = yOfFreq(sel.f0);
      ctx.fillStyle = 'rgba(255,209,102,0.18)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
  }, [spec, sel, clip.reverse, fmax]);

  // selection by dragging (spectrogram: time+freq, waveform: time only)
  const startDrag = (e: React.MouseEvent<HTMLCanvasElement>, withFreq: boolean) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = W / rect.width, sy = SPEC_H / rect.height;
    const x0 = (e.clientX - rect.left) * sx, y0 = (e.clientY - rect.top) * sy;
    const move = (ev: MouseEvent) => {
      const x1 = Math.min(W, Math.max(0, (ev.clientX - rect.left) * sx)), y1 = Math.min(SPEC_H, Math.max(0, (ev.clientY - rect.top) * sy));
      const t0 = tOfX(Math.min(x0, x1)), t1 = tOfX(Math.max(x0, x1));
      if (withFreq) setSel({ t0, t1, f0: freqOfY(Math.max(y0, y1)), f1: freqOfY(Math.min(y0, y1)) });
      else setSel({ t0, t1, f0: FMIN, f1: fmax });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  // ---- processing (render in place) ----

  /** The clip exactly as heard (range, rate, reverse) rendered to a buffer, so processes work on what you see. */
  const bake = async (): Promise<AudioBuffer> => {
    const buf = buffer!;
    const len = Math.max(1, Math.ceil(clip.duration * sr));
    const octx = new OfflineAudioContext(buf.numberOfChannels, len, sr);
    const src = octx.createBufferSource();
    let b = buf;
    if (clip.reverse) b = reverseBuffer((ch, l, r) => octx.createBuffer(ch, l, r), buf);
    src.buffer = b; src.playbackRate.value = clip.rate;
    src.connect(octx.destination);
    src.start(0, clip.reverse ? Math.max(0, buf.duration - clip.inPoint - clip.duration * clip.rate) : clip.inPoint);
    return octx.startRendering();
  };
  const commitBuffer = async (label: string, out: AudioBuffer) => {
    const id = await saveBufferAsAsset(out, `${clip.name}-${label}`);
    if (!id) throw new Error('Could not save the processed audio');
    st().replaceClipAudio(clip.id, id, out.duration);
    setSel(null);
  };
  const run = async (label: string, fn: (input: AudioBuffer) => Promise<AudioBuffer> | AudioBuffer) => {
    if (!buffer) return;
    setBusy(label);
    try { await commitBuffer(label, await fn(await bake())); }
    catch (e: any) { alert(`${label} failed: ${e?.message ?? e}`); }
    finally { setBusy(null); }
  };
  const viaFfmpeg = async (input: AudioBuffer, op: Parameters<typeof window.api.processAudio>[1]) => {
    const tmp = await window.api.tempPath(`clip-${Date.now()}.wav`);
    await window.api.writeBinary(tmp, audioBufferToWav(input));
    const res = await window.api.processAudio(tmp, op);
    if (!res.ok || !res.path) throw new Error(res.error ?? 'FFmpeg failed');
    return decodeFile(res.path);
  };
  const mk = engine.createBuffer;
  // the spectrogram shows source frequencies; processing runs on the baked (rate-applied) audio
  const region = sel ? { ...sel, f0: sel.f0 * clip.rate, f1: sel.f1 * clip.rate } : { t0: 0, t1: clip.duration, f0: FMIN, f1: fmax };
  const hasSel = !!sel;

  const audition = async () => {
    const b = buffer; if (!b) return;
    const t0 = sel?.t0 ?? 0, t1 = sel?.t1 ?? clip.duration;
    await engine.previewAsset(clip.assetId, from + t0 * clip.rate, Math.max(0.05, (t1 - t0) * clip.rate));
  };

  return (
    <div className="ce-body">
      <div className="ce-canvases">
        <canvas ref={waveRef} width={W} height={WAVE_H} className="ce-wave" onMouseDown={(e) => startDrag(e, false)} title="Drag to select a time range" />
        <canvas ref={specRef} width={W} height={SPEC_H} className="ce-spec" onMouseDown={(e) => startDrag(e, true)} title="Drag to select a time × frequency region" />
        <div className="row small dim" style={{ padding: '4px 8px' }}>
          {sel ? <>Selection: {sel.t0.toFixed(2)}–{sel.t1.toFixed(2)} s · {Math.round(sel.f0)}–{Math.round(sel.f1)} Hz <button className="tiny" onClick={() => setSel(null)}>clear</button></> : 'Drag on the spectrogram to select frequencies over time (e.g. a hum, a whistle, a cough); drag on the waveform for a time range.'}
          <button className="tiny" style={{ marginLeft: 8 }} onClick={audition}>▶ Audition {sel ? 'selection' : 'clip'}</button>
          {clip.original && <button className="tiny" onClick={() => st().revertClipAudio(clip.id)}>↩ Revert to original</button>}
          {busy && <span className="dim">⏳ {busy}…</span>}
        </div>
      </div>
      <div className="ce-tools">
        <div className="ce-group">
          <div className="ce-title">Frequencies in selection</div>
          <label className="knob"><span className="knob-label">Amount</span><input type="range" min={-60} max={12} step={1} value={dB} onChange={(e) => setDb(Number(e.target.value))} /><span className="knob-value">{dB > 0 ? '+' : ''}{dB} dB</span></label>
          <div className="row">
            <button disabled={!hasSel || !!busy} onClick={() => run('attenuate', (b) => processRegion(mk, b, region, Math.pow(10, dB / 20)))} title="Lower (or raise) only the selected frequencies in the selected time">Apply {dB} dB</button>
            <button disabled={!hasSel || !!busy} onClick={() => run('remove', (b) => processRegion(mk, b, region, 0))} title="Silence the selected frequencies in the selected time">Remove</button>
            <button disabled={!hasSel || !!busy} onClick={() => run('isolate', (b) => processRegion(mk, b, region, 0, true))} title="Keep only the selection; silence everything else">Isolate</button>
          </div>
        </div>
        <div className="ce-group">
          <div className="ce-title">Level & shape</div>
          <div className="row">
            <button disabled={!!busy} onClick={() => run('normalize', (b) => normalize(mk, b, -1))}>Normalize</button>
            <button disabled={!!busy} onClick={() => run('gain', (b) => gainRegion(mk, b, region.t0, region.t1, Math.pow(10, dB / 20)))} title="Apply the Amount (dB) to the selected time range (whole clip if none)">Gain {dB} dB {hasSel ? 'in range' : ''}</button>
            <button disabled={!!busy} onClick={() => run('loudness', (b) => viaFfmpeg(b, { type: 'loudnorm' }))} title="Broadcast loudness (-16 LUFS)">Loudness</button>
            <button disabled={!hasSel || !!busy} onClick={() => run('trim', (b) => slice(mk, b, region.t0, region.t1))}>Trim to selection</button>
            <button disabled={!!busy} onClick={() => run('reverse', (b) => reverseBuffer(mk, b))}>Reverse (bake)</button>
          </div>
        </div>
        <div className="ce-group">
          <div className="ce-title">Pitch & time (keeps the other)</div>
          <label className="knob"><span className="knob-label">Pitch</span><input type="range" min={-24} max={24} step={1} value={semis} onChange={(e) => setSemis(Number(e.target.value))} /><span className="knob-value">{semis > 0 ? '+' : ''}{semis} st</span></label>
          <label className="knob"><span className="knob-label">Length</span><input type="range" min={25} max={400} step={1} value={stretch} onChange={(e) => setStretch(Number(e.target.value))} /><span className="knob-value">{stretch}%</span></label>
          <div className="row">
            <button disabled={!!busy || semis === 0} onClick={() => run('pitch', (b) => viaFfmpeg(b, { type: 'pitch', semitones: semis }))}>Shift pitch</button>
            <button disabled={!!busy || stretch === 100} onClick={() => run('stretch', (b) => viaFfmpeg(b, { type: 'tempo', factor: 100 / stretch }))}>Stretch</button>
          </div>
          <label className="knob"><span className="knob-label">Denoise</span><input type="range" min={1} max={40} step={1} value={denoise} onChange={(e) => setDenoise(Number(e.target.value))} /><span className="knob-value">{denoise} dB</span></label>
          <div className="row"><button disabled={!!busy} onClick={() => run('denoise', (b) => viaFfmpeg(b, { type: 'denoise', strength: denoise }))} title="Reduce steady background noise">Reduce noise</button></div>
        </div>
        <div className="ce-group">
          <div className="ce-title">Playback (non-destructive)</div>
          <label className="knob"><span className="knob-label">Speed / pitch</span><input type="range" min={0.25} max={4} step={0.01} value={clip.rate} onPointerDown={() => st().commit()} onChange={(e) => st().updateClip(clip.id, { rate: Number(e.target.value) } as Partial<SampleClip>, { commit: false })} /><span className="knob-value">{clip.rate.toFixed(2)}× ({(12 * Math.log2(clip.rate)).toFixed(1)} st)</span></label>
          <label className="knob"><span className="knob-label">Gain</span><input type="range" min={0} max={2} step={0.01} value={clip.gain} onPointerDown={() => st().commit()} onChange={(e) => st().updateClip(clip.id, { gain: Number(e.target.value) }, { commit: false })} /><span className="knob-value">{Math.round(clip.gain * 100)}%</span></label>
          <label className="knob"><span className="knob-label">Fade in</span><input type="range" min={0} max={clip.duration} step={0.01} value={clip.fadeIn} onPointerDown={() => st().commit()} onChange={(e) => st().updateClip(clip.id, { fadeIn: Number(e.target.value) }, { commit: false })} /><span className="knob-value">{clip.fadeIn.toFixed(2)} s</span></label>
          <label className="knob"><span className="knob-label">Fade out</span><input type="range" min={0} max={clip.duration} step={0.01} value={clip.fadeOut} onPointerDown={() => st().commit()} onChange={(e) => st().updateClip(clip.id, { fadeOut: Number(e.target.value) }, { commit: false })} /><span className="knob-value">{clip.fadeOut.toFixed(2)} s</span></label>
          <div className="row">
            <select value={clip.fadeCurve} onChange={(e) => st().updateClip(clip.id, { fadeCurve: e.target.value as FadeCurve })}><option value="linear">Linear fades</option><option value="exponential">Exponential fades</option><option value="sCurve">S-curve fades</option></select>
            <button className={clip.reverse ? 'on' : ''} onClick={() => st().updateClip(clip.id, { reverse: !clip.reverse } as Partial<SampleClip>)}>Reverse</button>
            <button onClick={() => { const a = asset; if (a) st().addSamplerTrack(a.id, clip.name); }} title="New instrument track that plays this sound at different pitches from the keyboard">🎹 Use as instrument</button>
          </div>
        </div>
      </div>
    </div>
  );
}

