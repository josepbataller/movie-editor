import { useEffect, useRef, useState } from 'react';
import { useStudio, sessionDuration } from '@/store/useStudio';
import { useProject } from '@/store/useProject';
import { getEngine } from '@/engine/audio/engine';
import { formatTime } from '@/engine/project/importMedia';
import { sendMixToVideo } from '@/engine/audio/bridge';
import { INSTRUMENT_CATEGORIES, instrumentsInCategory, categoryIcon } from '@/engine/audio/presets';
import { toggleRecording } from '@/engine/audio/recording';
import { Recorder } from '@/engine/audio/recorder';

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
  const recording = useStudio((s) => s.recording);
  const armed = useStudio((s) => s.armedTrackId);
  const countIn = useStudio((s) => s.countIn);
  const monitor = useStudio((s) => s.monitorInput);
  const inputDeviceId = useStudio((s) => s.inputDeviceId);
  const octave = useStudio((s) => s.keyboardOctave);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [recMenu, setRecMenu] = useState(false);
  useEffect(() => {
    if (!recMenu) return;
    Recorder.devices().then(setDevices).catch(() => setDevices([]));
  }, [recMenu]);

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
        <button className={`rec ${recording ? 'on' : ''}`} onClick={() => void toggleRecording()} title={armed ? 'Record on the armed track (R)' : 'Arm an audio track (● on its header) and record (R)'}>●</button>
        <div className="add-track" onMouseLeave={() => setRecMenu(false)}>
          <button className="small" onClick={() => setRecMenu(!recMenu)} title="Recording options">▾</button>
          {recMenu && (
            <div className="menu" style={{ minWidth: 300 }}>
              <div className="menu-title">Input device</div>
              <select value={inputDeviceId ?? ''} onChange={(e) => st().setInputDevice(e.target.value || null)}>
                <option value="">Default microphone</option>
                {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}
              </select>
              <label className="check" style={{ padding: '6px 8px' }}><input type="checkbox" checked={countIn} onChange={(e) => st().setCountIn(e.target.checked)} /> One-bar count-in</label>
              <label className="check" style={{ padding: '6px 8px' }}><input type="checkbox" checked={monitor} onChange={(e) => { st().setMonitorInput(e.target.checked); getEngine().recorder.setMonitor(e.target.checked); }} /> Monitor input (hear the mic)</label>
              <div className="dim small" style={{ padding: '4px 8px' }}>Takes are saved as WAV next to the project (or in the temp folder until it is saved) and appear under <b>Audio files</b>.</div>
            </div>
          )}
        </div>
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
        <option value={0.0625}>1/64</option>
        <option value={1 / 3}>1/8 triplet</option>
        <option value={1 / 6}>1/16 triplet</option>
      </select>
      <span className="dim small" title="Computer keyboard octave (Z / X to change). Keys A W S E D F T G Y H U J K play the selected instrument.">⌨ C{octave}</span>
      <span className="sep" />
      <div className="add-track" onMouseLeave={() => setAddMenu(false)}>
        <button className="primary" onClick={() => setAddMenu(!addMenu)}>+ Track ▾</button>
        {addMenu && (
          <div className="menu">
            <button onClick={() => { st().addTrack('audio'); setAddMenu(false); }}>🎚 Audio track (recordings, music files)</button>
            {INSTRUMENT_CATEGORIES.filter((c) => c !== 'Sampler').map((cat) => (
              <details key={cat} open={cat === 'Drums'}>
                <summary className="menu-title">{categoryIcon(cat)} {cat}</summary>
                {instrumentsInCategory(cat).map((p) => <button key={p.name} onClick={() => { st().addTrack('instrument', p); setAddMenu(false); }}>{p.name}</button>)}
              </details>
            ))}
          </div>
        )}
      </div>
      <span className="sep" />
      <button disabled={!canUndo} onClick={() => st().undo()} title="Undo (Ctrl+Z)">↶</button>
      <button disabled={!canRedo} onClick={() => st().redo()} title="Redo (Ctrl+Y)">↷</button>
      <span style={{ marginLeft: 'auto' }} />
      <ViewControls />
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

function ViewControls() {
  const compact = useStudio((s) => s.compactView);
  const scale = useStudio((s) => s.trackScale);
  const st = useStudio.getState;
  return (
    <span className="view-controls" title="Arrangement view">
      <button className={`small ${compact ? 'on' : ''}`} onClick={() => st().setCompactView(!compact)} title="Overview: colour blocks, many tracks on screen (Logic-style)">▤ Blocks</button>
      <input type="range" min={0.35} max={3} step={0.05} value={scale} onChange={(e) => st().setTrackScale(Number(e.target.value))} style={{ width: 70 }} title="Track height" />
    </span>
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
      // while a synth pattern is open, plain letter keys belong to the piano roll's keyboard
      if (!ctrl && /^[a-z;]$/i.test(e.key) && st.editorClipId) {
        const clip = st.session.clips.find((c) => c.id === st.editorClipId);
        const track = clip && st.session.tracks.find((t) => t.id === clip.trackId);
        if (track?.instrument?.kind === 'synth') return;
      }
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); return; }
      if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); if (st.selectedClipIds.length) st.duplicateClips(st.selectedClipIds); return; }
      if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); st.select(st.session.clips.map((c) => c.id)); return; }
      if (ctrl) return;
      if (e.key === 'F1') { e.preventDefault(); st.setHelpOpen(!st.helpOpen); return; }
      switch (e.key) {
        case ' ': e.preventDefault(); st.togglePlay(); break;
        case 'Escape': st.setPlaying(false); st.select([]); st.openEditor(null); break;
        case 'Home': st.setCurrentTime(0); break;
        case 'End': st.setCurrentTime(sessionDuration(st.session)); break;
        case 's': case 'S': st.splitSelectedAtPlayhead(); break;
        case 'Delete': case 'Backspace': if (st.selectedClipIds.length) st.removeClips(st.selectedClipIds); break;
        case 'l': case 'L': st.setLoop({ enabled: !st.session.loop.enabled }); break;
        case 'k': case 'K': st.toggleMetronome(); break;
        case 'r': case 'R': void toggleRecording(); break;
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
