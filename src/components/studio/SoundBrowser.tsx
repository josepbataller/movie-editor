import { useState } from 'react';
import { useProject } from '@/store/useProject';
import { useStudio } from '@/store/useStudio';
import { DRUM_KITS, SYNTH_PRESETS } from '@/engine/audio/presets';
import { getEngine } from '@/engine/audio/engine';
import { importViaDialog, formatTime } from '@/engine/project/importMedia';
import { addAssetToStudio } from '@/engine/audio/bridge';
import type { InstrumentSettings } from '@/shared/audioTypes';

/** Left panel of the studio: factory instruments + the project's audio media. */
export default function SoundBrowser() {
  // select the stable array and filter in render (a fresh filtered array would re-render forever)
  const allAssets = useProject((s) => s.project.assets);
  const assets = allAssets.filter((a) => a.hasAudio);
  const selectedTrackId = useStudio((s) => s.selectedTrackId);
  const selectedTrack = useStudio((s) => s.session.tracks.find((t) => t.id === s.selectedTrackId));
  const [tab, setTab] = useState<'instruments' | 'media'>('instruments');
  const st = useStudio.getState;

  const audition = async (inst: InstrumentSettings) => {
    // quick preview on a temporary track-less voice: use a throwaway track
    const engine = getEngine();
    const tid = st().addTrack('instrument', inst);
    // let the engine pick up the new track, then play a short phrase
    setTimeout(async () => {
      if (inst.kind === 'drums') { for (const [i, n] of [36, 42, 38, 42].entries()) setTimeout(() => engine.noteOn(tid, n), i * 160); }
      else { await engine.noteOn(tid, 60); setTimeout(() => engine.noteOff(tid, 60), 500); }
      setTimeout(() => { st().removeTrack(tid); useStudio.setState((s) => ({ past: s.past.slice(0, -2) })); }, 1200);
    }, 30);
  };

  const useInstrument = (inst: InstrumentSettings) => {
    if (selectedTrack?.kind === 'instrument') st().setInstrument(selectedTrack.id, inst);
    else st().addTrack('instrument', inst);
  };

  return (
    <div className="sound-browser">
      <div className="tabs">
        <button className={tab === 'instruments' ? 'on' : ''} onClick={() => setTab('instruments')}>Instruments</button>
        <button className={tab === 'media' ? 'on' : ''} onClick={() => setTab('media')}>Audio files</button>
      </div>
      {tab === 'instruments' && (
        <div className="browser-list">
          <div className="dim small" style={{ padding: '6px 10px' }}>
            {selectedTrack?.kind === 'instrument' ? <>Click a sound to load it on <b>{selectedTrack.name}</b>; ▶ auditions it.</> : <>Click a sound to add a new instrument track; ▶ auditions it.</>}
          </div>
          <div className="browser-group">Drum kits</div>
          {DRUM_KITS.map((k) => (
            <div key={k.name} className={`browser-item ${selectedTrack?.instrument?.name === k.name ? 'active' : ''}`} onClick={() => useInstrument(k)}
              draggable onDragStart={(e) => e.dataTransfer.setData('application/x-instrument', k.name)}>
              <span className="icon">🥁</span><span className="name">{k.name}</span>
              <button className="small" onClick={(e) => { e.stopPropagation(); audition(k); }} title="Audition">▶</button>
            </div>
          ))}
          <div className="browser-group">Synths</div>
          {SYNTH_PRESETS.map((p) => (
            <div key={p.name} className={`browser-item ${selectedTrack?.instrument?.name === p.name ? 'active' : ''}`} onClick={() => useInstrument(p)}
              draggable onDragStart={(e) => e.dataTransfer.setData('application/x-instrument', p.name)}>
              <span className="icon">{p.name.toLowerCase().includes('bass') ? '🎸' : p.name.toLowerCase().includes('pad') || p.name.toLowerCase().includes('strings') ? '🌫' : '🎹'}</span>
              <span className="name">{p.name}</span>
              <button className="small" onClick={(e) => { e.stopPropagation(); audition(p); }} title="Audition">▶</button>
            </div>
          ))}
        </div>
      )}
      {tab === 'media' && (
        <div className="browser-list">
          <div className="row" style={{ padding: '6px 10px' }}>
            <button className="primary small" onClick={importViaDialog}>+ Import audio…</button>
            <span className="dim small">Drag onto a track, or double-click to add.</span>
          </div>
          {assets.length === 0 && <div className="dim small" style={{ padding: 10 }}>No audio files in the project yet. Import music, recordings or videos with sound.</div>}
          {assets.map((a) => (
            <div key={a.id} className="browser-item" draggable
              onDragStart={(e) => { e.dataTransfer.setData('application/x-asset-id', a.id); e.dataTransfer.effectAllowed = 'copy'; }}
              onDoubleClick={() => addAssetToStudio(a.id, st().currentTime, selectedTrack?.kind === 'audio' ? selectedTrackId ?? undefined : undefined)}
              title={a.path}>
              <span className="icon">{a.kind === 'video' ? '🎬' : '🎵'}</span>
              <span className="name">{a.name}</span>
              <span className="dim small">{formatTime(a.duration)}</span>
              <button className="small" onClick={(e) => { e.stopPropagation(); void getEngine().loadAsset(a).then(() => getEngine().previewAsset(a.id, 0, 3)); }} title="Preview 3 s">▶</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
