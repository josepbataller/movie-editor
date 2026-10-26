import { useEffect, useRef, useState, memo } from 'react';
import { useStudio, sessionDuration } from '@/store/useStudio';
import { useProject } from '@/store/useProject';
import { StudioClip, StudioTrack, SampleClip, PatternClip, DRUM_NOTES } from '@/shared/audioTypes';
import { getEngine, peaks } from '@/engine/audio/engine';
import { instrumentByName } from '@/engine/audio/presets';
import { addAssetToStudio } from '@/engine/audio/bridge';
import { formatTime } from '@/engine/project/importMedia';

// Multitrack arrangement view of the Audio Studio: bars/beats ruler, track headers with
// mixer controls, sample clips with waveforms + fade handles, pattern clips with note previews.

const HEADER_W = 230;
const RULER_H = 30;
const SNAP_PX = 8;

export default function StudioTimeline() {
  const session = useStudio((s) => s.session);
  const pps = useStudio((s) => s.pixelsPerSecond);
  const snapOn = useStudio((s) => s.snapToGrid);
  const grid = useStudio((s) => s.gridDivision);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const st = useStudio.getState;

  const toX = (t: number) => t * pps;
  const toT = (x: number) => x / pps;
  const beat = 60 / session.bpm;
  const duration = sessionDuration(session);
  const contentW = Math.max(toX(Math.max(duration, session.loop.end) + beat * session.beatsPerBar * 4), 1400);

  // Ctrl+wheel zoom around the cursor
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const s = useStudio.getState();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - HEADER_W + el.scrollLeft;
      const tAtMouse = mouseX / s.pixelsPerSecond;
      s.setPixelsPerSecond(s.pixelsPerSecond * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
      requestAnimationFrame(() => { el.scrollLeft = tAtMouse * useStudio.getState().pixelsPerSecond - (e.clientX - rect.left - HEADER_W); });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** Snap to the musical grid and to other clips' edges (hold Alt while dragging to bypass). */
  let altHeld = false;
  const snap = (t: number, ignoreIds: string[] = []): number => {
    if (!snapOn || altHeld) return Math.max(0, t);
    const step = beat * grid;
    const candidates = [Math.round(t / step) * step, st().currentTime];
    for (const c of st().session.clips) { if (!ignoreIds.includes(c.id)) candidates.push(c.start, c.start + c.duration); }
    let best = t, bestD = SNAP_PX / pps;
    for (const c of candidates) { const d = Math.abs(c - t); if (d < bestD) { bestD = d; best = c; } }
    return Math.max(0, best);
  };

  const xToTime = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return toT(clientX - rect.left - HEADER_W + el.scrollLeft);
  };
  const trackAtY = (clientY: number): StudioTrack | null => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    let y = clientY - rect.top - RULER_H + el.scrollTop;
    for (const t of session.tracks) { if (y >= 0 && y < t.height) return t; y -= t.height; }
    return null;
  };

  // Ruler: drag = scrub; Shift+drag = set loop region
  const onRulerDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const t0 = snap(xToTime(e.clientX));
    if (e.shiftKey) {
      st().setLoop({ start: t0, end: t0 + beat, enabled: true });
      const move = (ev: MouseEvent) => { const t1 = snap(xToTime(ev.clientX)); st().setLoop({ start: Math.min(t0, t1), end: Math.max(t0, t1, Math.min(t0, t1) + beat * grid) }); };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      return;
    }
    st().setCurrentTime(Math.max(0, xToTime(e.clientX)));
    const move = (ev: MouseEvent) => st().setCurrentTime(Math.max(0, xToTime(ev.clientX)));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const onLaneDown = (e: React.MouseEvent, track: StudioTrack) => {
    if (e.button !== 0) return;
    st().select([]);
    st().selectTrack(track.id);
    onRulerDown(e);
  };
  const onLaneDouble = (e: React.MouseEvent, track: StudioTrack) => {
    if (track.kind !== 'instrument') return;
    const t = snapOn ? Math.floor(xToTime(e.clientX) / (beat * session.beatsPerBar)) * beat * session.beatsPerBar : xToTime(e.clientX);
    const id = st().addPatternClip(track.id, t, session.beatsPerBar * 4);
    st().openEditor(id);
  };

  // ---- clip drag / trim / fades ----
  const onClipDown = (e: React.MouseEvent, clip: StudioClip, mode: 'move' | 'start' | 'end' | 'fadeIn' | 'fadeOut') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = st();
    if (!s.selectedClipIds.includes(clip.id)) s.select([clip.id], e.shiftKey);
    else if (e.shiftKey) { s.select([clip.id], true); return; }
    const startX = e.clientX;
    const orig = { ...clip };
    const asset = clip.type === 'sample' ? useProject.getState().project.assets.find((a) => a.id === clip.assetId) : undefined;
    const srcDur = asset ? asset.duration : null;
    let committed = false;
    const ensure = () => { if (!committed) { useStudio.getState().commit(); committed = true; } };
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      altHeld = ev.altKey;
      if (mode === 'move' && !committed && Math.abs(dx) < 3) return;
      ensure();
      const s2 = useStudio.getState();
      if (mode === 'move') {
        let start = Math.max(0, orig.start + toT(dx));
        const s1 = snap(start, [clip.id]); const s3 = snap(start + orig.duration, [clip.id]) - orig.duration;
        if (s1 !== start) start = s1; else if (s3 !== start) start = s3;
        const tr = trackAtY(ev.clientY);
        s2.moveClip(clip.id, start, tr?.id ?? orig.trackId, { commit: false });
      } else if (mode === 'start' || mode === 'end') {
        const patch: Partial<StudioClip> = { start: orig.start, duration: orig.duration };
        if (orig.type === 'sample') (patch as Partial<SampleClip>).inPoint = orig.inPoint;
        s2.updateClip(clip.id, patch, { commit: false });
        let delta = toT(dx);
        if (mode === 'start') delta = snap(orig.start + delta, [clip.id]) - orig.start;
        else delta = snap(orig.start + orig.duration + delta, [clip.id]) - (orig.start + orig.duration);
        s2.trimClip(clip.id, mode, delta, srcDur, { commit: false });
      } else if (mode === 'fadeIn') {
        s2.updateClip(clip.id, { fadeIn: Math.min(orig.duration, Math.max(0, orig.fadeIn + toT(dx))) }, { commit: false });
      } else {
        s2.updateClip(clip.id, { fadeOut: Math.min(orig.duration, Math.max(0, orig.fadeOut - toT(dx))) }, { commit: false });
      }
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  // ---- drops from the browser ----
  const onDragOver = (e: React.DragEvent, track: StudioTrack) => {
    const types = e.dataTransfer.types;
    if ((types.includes('application/x-asset-id') && track.kind === 'audio') || (types.includes('application/x-instrument') && track.kind === 'instrument')) {
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropTarget(track.id);
    }
  };
  const onDrop = (e: React.DragEvent, track: StudioTrack) => {
    e.preventDefault(); setDropTarget(null);
    const assetId = e.dataTransfer.getData('application/x-asset-id');
    const instName = e.dataTransfer.getData('application/x-instrument');
    if (assetId && track.kind === 'audio') addAssetToStudio(assetId, snap(xToTime(e.clientX)), track.id);
    if (instName && track.kind === 'instrument') { const inst = instrumentByName(instName); if (inst) st().setInstrument(track.id, inst); }
  };
  const onEmptyDrop = (e: React.DragEvent) => {
    // dropping below the tracks creates a new track
    const assetId = e.dataTransfer.getData('application/x-asset-id');
    const instName = e.dataTransfer.getData('application/x-instrument');
    if (assetId) { e.preventDefault(); addAssetToStudio(assetId, snap(xToTime(e.clientX))); }
    if (instName) { e.preventDefault(); const inst = instrumentByName(instName); if (inst) st().addTrack('instrument', inst); }
  };

  return (
    <div className="studio-timeline" ref={scrollRef}>
      <div className="studio-inner" style={{ width: HEADER_W + contentW }}>
        <div className="ruler-row" style={{ height: RULER_H }}>
          <div className="track-header ruler-corner studio-corner" style={{ width: HEADER_W }}>
            <span className="dim small">Shift+drag ruler: loop</span>
          </div>
          <div className="ruler" style={{ width: contentW }} onMouseDown={onRulerDown}>
            <BarRuler pps={pps} width={contentW} bpm={session.bpm} beatsPerBar={session.beatsPerBar} grid={grid} />
            <LoopRegion toX={toX} snap={snap} xToTime={xToTime} />
          </div>
        </div>
        {session.tracks.map((track) => (
          <div key={track.id} className={`studio-track ${track.kind}`} style={{ height: track.height }}>
            <StudioTrackHeader track={track} width={HEADER_W} />
            <div className={`studio-lane ${dropTarget === track.id ? 'drop' : ''}`} style={{ width: contentW, backgroundSize: `${toX(beat * session.beatsPerBar)}px 100%, ${toX(beat)}px 100%` }}
              onMouseDown={(e) => onLaneDown(e, track)} onDoubleClick={(e) => onLaneDouble(e, track)}
              onDragOver={(e) => onDragOver(e, track)} onDragLeave={() => setDropTarget((d) => (d === track.id ? null : d))} onDrop={(e) => onDrop(e, track)}>
              {session.clips.filter((c) => c.trackId === track.id).map((clip) => (
                <StudioClipView key={clip.id} clip={clip} track={track} toX={toX} onDown={onClipDown} />
              ))}
            </div>
          </div>
        ))}
        <div className="studio-empty" style={{ width: HEADER_W + contentW }} onDragOver={(e) => { if (e.dataTransfer.types.some((t) => t.startsWith('application/x-'))) e.preventDefault(); }} onDrop={onEmptyDrop}>
          {session.tracks.length === 0 && (
            <div className="studio-hint">
              <h3>Your song starts here</h3>
              <p>Add a track with <b>+ Track</b> (drums, synths or an audio track), drag sounds from the browser, double-click an instrument lane to create a pattern.</p>
              <p className="dim small">Space = play · S = split · Shift+drag on the ruler = loop region · Ctrl+wheel = zoom</p>
            </div>
          )}
        </div>
        <StudioPlayhead headerW={HEADER_W} toX={toX} scrollRef={scrollRef} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const BarRuler = memo(function BarRuler({ pps, width, bpm, beatsPerBar, grid }: { pps: number; width: number; bpm: number; beatsPerBar: number; grid: number }) {
  const beat = 60 / bpm;
  const barW = beat * beatsPerBar * pps;
  const ticks: React.ReactNode[] = [];
  const bars = Math.ceil(width / barW);
  const labelEvery = barW < 36 ? Math.ceil(36 / barW) : 1;
  for (let b = 0; b <= bars; b++) {
    ticks.push(<div key={`b${b}`} className="tick major" style={{ left: b * barW }}>{b % labelEvery === 0 && <span>{b + 1}</span>}</div>);
    if (barW > 60) for (let k = 1; k < beatsPerBar; k++) ticks.push(<div key={`b${b}k${k}`} className="tick" style={{ left: b * barW + k * beat * pps }} />);
    if (grid < 1 && beat * grid * pps > 10) {
      for (let g = grid; g < beatsPerBar; g += grid) { if (Math.abs(g - Math.round(g)) < 1e-6) continue; ticks.push(<div key={`b${b}g${g}`} className="tick minor" style={{ left: b * barW + g * beat * pps }} />); }
    }
  }
  return <>{ticks}</>;
});

function LoopRegion({ toX, snap, xToTime }: { toX: (t: number) => number; snap: (t: number) => number; xToTime: (x: number) => number }) {
  const loop = useStudio((s) => s.session.loop);
  const st = useStudio.getState;
  const drag = (edge: 'start' | 'end') => (e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    const move = (ev: MouseEvent) => {
      const t = snap(xToTime(ev.clientX));
      const l = st().session.loop;
      if (edge === 'start') st().setLoop({ start: Math.min(t, l.end - 0.1) }); else st().setLoop({ end: Math.max(t, l.start + 0.1) });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  return (
    <div className={`loop-region ${loop.enabled ? 'on' : ''}`} style={{ left: toX(loop.start), width: Math.max(2, toX(loop.end - loop.start)) }}
      onDoubleClick={(e) => { e.stopPropagation(); st().setLoop({ enabled: !loop.enabled }); }} title="Loop region (double-click to toggle, drag edges)">
      <div className="loop-handle l" onMouseDown={drag('start')} />
      <div className="loop-handle r" onMouseDown={drag('end')} />
    </div>
  );
}

function StudioTrackHeader({ track, width }: { track: StudioTrack; width: number }) {
  const st = useStudio.getState;
  const selected = useStudio((s) => s.selectedTrackId === track.id);
  const fxOpen = useStudio((s) => s.fxPanelTrackId === track.id);
  const armed = useStudio((s) => s.armedTrackId === track.id);
  const recording = useStudio((s) => s.recording && s.armedTrackId === track.id);
  const meterRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const engine = getEngine();
    let raf = 0;
    const tick = () => {
      const c = meterRef.current;
      if (c) {
        const ctx = c.getContext('2d')!;
        const lvl = engine.level(track.id);
        const p = Math.min(1, Math.max(0, (20 * Math.log10(Math.max(1e-4, lvl)) + 48) / 48));
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#14151a'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = p > 0.92 ? '#d9534f' : track.color; ctx.fillRect(0, c.height * (1 - p), c.width, c.height * p);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [track.id, track.color]);

  return (
    <div className={`track-header studio-header ${selected ? 'selected' : ''}`} style={{ width, borderLeftColor: track.color }} onMouseDown={() => st().selectTrack(track.id)}>
      <div className="header-top">
        <span className="kind">{track.kind === 'audio' ? '🎚' : track.instrument?.kind === 'drums' ? '🥁' : '🎹'}</span>
        <input className="track-name" value={track.name} onFocus={() => st().commit()} onChange={(e) => st().updateTrack(track.id, { name: e.target.value }, { commit: false })} />
        <button className="small" onClick={() => { if (confirm(`Remove track "${track.name}"?`)) st().removeTrack(track.id); }} title="Remove track">✕</button>
      </div>
      <div className="header-row">
        <button className={`tiny ${track.muted ? 'on mute' : ''}`} onClick={() => st().updateTrack(track.id, { muted: !track.muted }, { commit: false })} title="Mute (M)">M</button>
        <button className={`tiny ${track.solo ? 'on solo' : ''}`} onClick={() => st().updateTrack(track.id, { solo: !track.solo }, { commit: false })} title="Solo">S</button>
        {track.kind === 'audio' && <button className={`tiny arm ${armed ? 'on' : ''} ${recording ? 'rec' : ''}`} onClick={() => st().armTrack(armed ? null : track.id)} title="Arm for recording (then press ● or R)">●</button>}
        {track.kind === 'instrument' && <button className={`tiny arm ${armed ? 'on' : ''}`} onClick={() => st().armTrack(armed ? null : track.id)} title="Arm: while playing, notes you type are recorded into the pattern">●</button>}
        <button className={`tiny ${fxOpen ? 'on' : ''} ${track.effects.length ? 'has-fx' : ''}`} onClick={() => st().openFx(fxOpen ? null : track.id)} title="Effects">FX{track.effects.length ? ` ${track.effects.length}` : ''}</button>
        <input type="range" className="gain" min={0} max={1.5} step={0.01} value={track.gain} onPointerDown={() => st().commit()} onChange={(e) => st().updateTrack(track.id, { gain: Number(e.target.value) }, { commit: false })} title={`Volume ${Math.round(track.gain * 100)}%`} />
        <input type="range" className="pan" min={-1} max={1} step={0.01} value={track.pan} onPointerDown={() => st().commit()} onDoubleClick={() => st().updateTrack(track.id, { pan: 0 })} onChange={(e) => st().updateTrack(track.id, { pan: Number(e.target.value) }, { commit: false })} title={`Pan ${track.pan === 0 ? 'C' : track.pan < 0 ? `L${Math.round(-track.pan * 100)}` : `R${Math.round(track.pan * 100)}`}`} />
        <canvas ref={meterRef} width={6} height={34} className="vmeter" />
      </div>
      {track.kind === 'instrument' && track.instrument && (
        <div className="dim small instrument-name" title="Change the sound from the Instruments browser">{track.instrument.name}</div>
      )}
    </div>
  );
}

const StudioClipView = memo(function StudioClipView({ clip, track, toX, onDown }: {
  clip: StudioClip; track: StudioTrack; toX: (t: number) => number;
  onDown: (e: React.MouseEvent, clip: StudioClip, mode: 'move' | 'start' | 'end' | 'fadeIn' | 'fadeOut') => void;
}) {
  const selected = useStudio((s) => s.selectedClipIds.includes(clip.id));
  const left = toX(clip.start);
  const width = Math.max(3, toX(clip.duration));
  const st = useStudio.getState;
  return (
    <div className={`sclip ${clip.type} ${selected ? 'selected' : ''}`} style={{ left, width, background: track.color + '55', borderColor: track.color }}
      onMouseDown={(e) => onDown(e, clip, 'move')}
      onDoubleClick={(e) => { e.stopPropagation(); if (clip.type === 'pattern') st().openEditor(clip.id); else st().openClipEditor(clip.id); }}
      title={`${clip.name}\n${formatTime(clip.start, true)} → ${formatTime(clip.start + clip.duration, true)}\nDouble-click to ${clip.type === 'pattern' ? 'edit notes' : 'open the clip editor (spectrogram, pitch, effects)'}`}>
      <div className="sclip-label"><span>{clip.name}</span>{clip.type === 'sample' && clip.rate !== 1 && <span className="badge">{clip.rate.toFixed(2)}×</span>}{clip.type === 'sample' && clip.reverse && <span className="badge">rev</span>}{clip.gain !== 1 && <span className="badge">{Math.round(clip.gain * 100)}%</span>}</div>
      {clip.type === 'sample' ? <WaveCanvas clip={clip} width={width} height={track.height - 22} color={track.color} /> : <NotesPreview clip={clip} width={width} height={track.height - 22} color={track.color} drums={track.instrument?.kind === 'drums'} />}
      {/* fades */}
      <svg className="fades" width={width} height={track.height - 4} style={{ pointerEvents: 'none' }}>
        {clip.fadeIn > 0 && <polygon points={`0,${track.height - 4} 0,0 ${toX(clip.fadeIn)},0`} fill="rgba(0,0,0,0.45)" />}
        {clip.fadeOut > 0 && <polygon points={`${width},${track.height - 4} ${width},0 ${width - toX(clip.fadeOut)},0`} fill="rgba(0,0,0,0.45)" />}
      </svg>
      <div className="fade-handle l" style={{ left: Math.max(0, toX(clip.fadeIn) - 5) }} onMouseDown={(e) => onDown(e, clip, 'fadeIn')} title="Drag: fade in" />
      <div className="fade-handle r" style={{ right: Math.max(0, toX(clip.fadeOut) - 5) }} onMouseDown={(e) => onDown(e, clip, 'fadeOut')} title="Drag: fade out" />
      <div className="trim-handle left" onMouseDown={(e) => onDown(e, clip, 'start')} />
      <div className="trim-handle right" onMouseDown={(e) => onDown(e, clip, 'end')} />
    </div>
  );
});

/** Waveform of the clip's source range, drawn from the decoded buffer (loads it if needed). */
function WaveCanvas({ clip, width, height, color }: { clip: SampleClip; width: number; height: number; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const asset = useProject((s) => s.project.assets.find((a) => a.id === clip.assetId));
  const [, bump] = useState(0);
  useEffect(() => {
    const engine = getEngine();
    if (!engine.getBuffer(clip.assetId) && asset) void engine.loadAsset(asset).then(() => bump((n) => n + 1));
  }, [clip.assetId, asset]);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    const buf = getEngine().getBuffer(clip.assetId);
    if (!buf) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '11px Segoe UI'; ctx.fillText('loading…', 6, h / 2 + 4); return; }
    const from = clip.reverse ? Math.max(0, buf.duration - clip.inPoint - clip.duration * clip.rate) : clip.inPoint;
    const to = from + clip.duration * clip.rate;
    const pk = peaks(buf, from, to, w);
    ctx.fillStyle = color;
    const mid = h / 2;
    for (let x = 0; x < w; x++) {
      const i = clip.reverse ? w - 1 - x : x;
      const mn = pk[i * 2] * clip.gain, mx = pk[i * 2 + 1] * clip.gain;
      ctx.fillRect(x, mid - Math.max(0.5, mx * mid), 1, Math.max(1, (mx - mn) * mid));
    }
  }, [clip.assetId, clip.inPoint, clip.duration, clip.rate, clip.reverse, clip.gain, width, height, color, asset]);
  return <canvas ref={ref} className="wave" />;
}

function NotesPreview({ clip, width, height, color, drums }: { clip: PatternClip; width: number; height: number; color: string; drums?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    if (!clip.notes.length) { ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '11px Segoe UI'; ctx.fillText('double-click to add notes', 6, h / 2 + 4); return; }
    const pitches = drums ? DRUM_NOTES.map((d) => d.note) : [];
    const lo = drums ? 0 : Math.min(...clip.notes.map((n) => n.pitch)) - 1;
    const hi = drums ? pitches.length : Math.max(...clip.notes.map((n) => n.pitch)) + 1;
    const rowH = h / Math.max(1, hi - lo);
    ctx.fillStyle = color;
    for (const n of clip.notes) {
      const row = drums ? pitches.indexOf(n.pitch) : n.pitch - lo;
      if (row < 0) continue;
      const x = (n.start / clip.lengthBeats) * w;
      const nw = Math.max(2, (n.length / clip.lengthBeats) * w - 1);
      ctx.globalAlpha = 0.5 + n.velocity * 0.5;
      ctx.fillRect(x, h - (row + 1) * rowH, nw, Math.max(2, rowH - 1));
    }
  }, [clip.notes, clip.lengthBeats, width, height, color, drums]);
  return <canvas ref={ref} className="wave" />;
}

function StudioPlayhead({ headerW, toX, scrollRef }: { headerW: number; toX: (t: number) => number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const t = useStudio((s) => s.currentTime);
  const playing = useStudio((s) => s.playing);
  const x = headerW + toX(t);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const viewL = el.scrollLeft + headerW, viewR = el.scrollLeft + el.clientWidth;
    if (x < viewL || x > viewR - 40) el.scrollLeft = Math.max(0, x - headerW - 100);
  }, [x, playing, headerW, scrollRef]);
  return <div className="playhead" style={{ left: x }}><div className="playhead-head" /></div>;
}
