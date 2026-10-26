import { useEffect, useRef, useState } from 'react';
import { useStudio, sessionDuration } from '@/store/useStudio';
import { useProject } from '@/store/useProject';
import { getEngine } from '@/engine/audio/engine';
import { formatTime } from '@/engine/project/importMedia';
import { sendMixToVideo } from '@/engine/audio/bridge';
import { DRUM_KITS, SYNTH_PRESETS } from '@/engine/audio/presets';

export default function StudioTopBar({ onExport }: { onExport: () => void }) {
  const st = useStudio.getState;
  const playing = useStudio((s) => s.playing);
  const currentTime = useStudio((s) => s.currentTime);
  const bpm = useStudio((s) => s.session.bpm);
  const beatsPerBar = useStudio((s) => s.session.beatsPerBar);
  const loop = useStudio((s) => s.session.loop);
  const metronome = useStudio((s) => s.session.metronome);
  const snap = useStudio((s) => s.snapToGrid);
  const grid = useStudio((s) => s.gridDivision);
  const masterGain = useStudio((s) => s.session.masterGain);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const duration = useStudio((s) => sessionDuration(s.session));
  const [sending, setSending] = useState(false);
  const [addMenu, setAddMenu] = useState(false);

  const beat = 60 / bpm;
  const bar = Math.floor(currentTime / (beat * beatsPerBar)) + 1;
  const beatInBar = Math.floor((currentTime % (beat * beatsPerBar)) / beat) + 1;

  const send = async () => {
    setSending(true);
    try { await sendMixToVideo(); } catch (e: any) { alert(`Could not send the mix: ${e?.message ?? e}`); } finally { setSending(false); }
  };

  return (
    <div className="studio-bar">
      <div className="transport-group">
        <button onClick={() => { st().setPlaying(false); st().setCurrentTime(0); }} title="Go to start (Home)">⏮</button>
        <button className="play" onClick={() => st().togglePlay()} title="Play / Pause (Space)">{playing ? '❚❚' : '▶'}</button>
        <button onClick={() => { st().setPlaying(false); st().setCurrentTime(st().currentTime); }} title="Stop (Esc)">■</button>
        <button className={loop.enabled ? 'on' : ''} onClick={() => st().setLoop({ enabled: !loop.enabled })} title="Loop the selected region (L)">🔁</button>
        <button className={metronome ? 'on' : ''} onClick={() => st().toggleMetronome()} title="Metronome (K)">🎵</button>
      </div>
      <div className="lcd" title="Bar . beat · time">
        <span className="big">{bar}.{beatInBar}</span>
        <span className="dim">{formatTime(currentTime, true, 30)} / {formatTime(duration)}</span>
      </div>
      <label className="bpm" title="Tempo (beats per minute)">
        BPM
        <input type="number" min={20} max={300} value={bpm} onFocus={() => st().commit()} onChange={(e) => { if (e.target.value) st().setBpm(Number(e.target.value)); }} />
      </label>
      <label className="check small"><input type="checkbox" checked={snap} onChange={() => st().toggleSnap()} /> Snap</label>
      <select value={grid} onChange={(e) => st().setGridDivision(Number(e.target.value))} title="Grid">
        <option value={4}>Bar</option>
        <option value={1}>1/4</option>
        <option value={0.5}>1/8</option>
        <option value={0.25}>1/16</option>
        <option value={0.125}>1/32</option>
        <option value={1 / 3}>1/8 triplet</option>
      </select>
      <span className="sep" />
      <div className="add-track" onMouseLeave={() => setAddMenu(false)}>
        <button className="primary" onClick={() => setAddMenu(!addMenu)}>+ Track ▾</button>
        {addMenu && (
          <div className="menu">
            <button onClick={() => { st().addTrack('audio'); setAddMenu(false); }}>🎚 Audio track (recordings, music files)</button>
            <div className="menu-title">Drums</div>
            {DRUM_KITS.map((k) => <button key={k.name} onClick={() => { st().addTrack('instrument', k); setAddMenu(false); }}>🥁 {k.name}</button>)}
            <div className="menu-title">Synths</div>
            {SYNTH_PRESETS.map((p) => <button key={p.name} onClick={() => { st().addTrack('instrument', p); setAddMenu(false); }}>🎹 {p.name}</button>)}
          </div>
        )}
      </div>
      <span className="sep" />
      <button disabled={!canUndo} onClick={() => st().undo()} title="Undo (Ctrl+Z)">↶</button>
      <button disabled={!canRedo} onClick={() => st().redo()} title="Redo (Ctrl+Y)">↷</button>
      <span style={{ marginLeft: 'auto' }} />
      <MasterMeter />
      <label className="small dim" title="Master volume">Master
        <input type="range" min={0} max={1.5} step={0.01} value={masterGain} onPointerDown={() => st().commit()} onChange={(e) => st().setMasterGain(Number(e.target.value), { commit: false })} style={{ width: 90 }} />
      </label>
      <button onClick={() => st().openFx('master')} title="Master effects">FX</button>
      <button onClick={send} disabled={sending || duration <= 0} title="Render the mix and place it on the video timeline">{sending ? 'Rendering…' : '🎬 Send to video'}</button>
      <button className="primary" onClick={onExport} disabled={duration <= 0} title="Export the mix as WAV / MP3 / FLAC">⬇ Export audio</button>
    </div>
  );
}

function MasterMeter() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const engine = getEngine();
    let raf = 0;
    let hold = 0;
    const tick = () => {
      const c = ref.current;
      if (c) {
        const ctx = c.getContext('2d')!;
        const lvl = engine.level('master');
        hold = Math.max(lvl, hold * 0.96);
        const db = 20 * Math.log10(Math.max(1e-4, lvl));
        const p = Math.min(1, Math.max(0, (db + 48) / 48));
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#1b1d24'; ctx.fillRect(0, 0, c.width, c.height);
        const grad = ctx.createLinearGradient(0, 0, c.width, 0);
        grad.addColorStop(0, '#3b8f6a'); grad.addColorStop(0.75, '#d8c23a'); grad.addColorStop(1, '#d9534f');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, c.width * p, c.height);
        const hp = Math.min(1, Math.max(0, (20 * Math.log10(Math.max(1e-4, hold)) + 48) / 48));
        ctx.fillStyle = hold >= 0.99 ? '#ff5252' : '#e6e8ee'; ctx.fillRect(c.width * hp - 1, 0, 2, c.height);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={120} height={10} className="meter" title="Master level" />;
}

export function useStudioShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useProject.getState().workspace !== 'audio') return;
      const target = e.target as HTMLElement;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (typing) return;
      const st = useStudio.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); return; }
      if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); if (st.selectedClipIds.length) st.duplicateClips(st.selectedClipIds); return; }
      if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); st.select(st.session.clips.map((c) => c.id)); return; }
      if (ctrl) return;
      switch (e.key) {
        case ' ': e.preventDefault(); st.togglePlay(); break;
        case 'Escape': st.setPlaying(false); st.select([]); st.openEditor(null); break;
        case 'Home': st.setCurrentTime(0); break;
        case 'End': st.setCurrentTime(sessionDuration(st.session)); break;
        case 's': case 'S': st.splitSelectedAtPlayhead(); break;
        case 'Delete': case 'Backspace': if (st.selectedClipIds.length) st.removeClips(st.selectedClipIds); break;
        case 'l': case 'L': st.setLoop({ enabled: !st.session.loop.enabled }); break;
        case 'k': case 'K': st.toggleMetronome(); break;
        case 'm': case 'M': if (st.selectedTrackId) { const t = st.session.tracks.find((t) => t.id === st.selectedTrackId); if (t) st.updateTrack(t.id, { muted: !t.muted }, { commit: false }); } break;
        case '+': case '=': st.setPixelsPerSecond(st.pixelsPerSecond * 1.25); break;
        case '-': st.setPixelsPerSecond(st.pixelsPerSecond / 1.25); break;
        case 'ArrowLeft': st.setCurrentTime(st.currentTime - (e.shiftKey ? 4 : 1) * (60 / st.session.bpm)); break;
        case 'ArrowRight': st.setCurrentTime(st.currentTime + (e.shiftKey ? 4 : 1) * (60 / st.session.bpm)); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
