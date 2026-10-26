import { useState } from 'react';
import { useProject } from '@/store/useProject';
import { useStudio } from '@/store/useStudio';
import { INSTRUMENT_CATEGORIES, instrumentsInCategory, categoryIcon } from '@/engine/audio/presets';
import { getEngine } from '@/engine/audio/engine';
import { importViaDialog, formatTime } from '@/engine/project/importMedia';
import { addAssetToStudio } from '@/engine/audio/bridge';
import type { InstrumentSettings } from '@/shared/audioTypes';

/** Left panel of the studio: factory instruments by family + the project's audio media (incl. recordings). */
export default function SoundBrowser() {
  // select the stable array and filter in render (a fresh filtered array would re-render forever)
  const allAssets = useProject((s) => s.project.assets);
  const assets = allAssets.filter((a) => a.hasAudio);
  const selectedTrackId = useStudio((s) => s.selectedTrackId);
  const selectedTrack = useStudio((s) => s.session.tracks.find((t) => t.id === s.selectedTrackId));
  const [tab, setTab] = useState<'instruments' | 'media'>('instruments');
  const [open, setOpen] = useState<Record<string, boolean>>({ Drums: true, Keys: true });
  const [filter, setFilter] = useState('');
  const st = useStudio.getState;

  const audition = (inst: InstrumentSettings) => {
    void getEngine().previewInstrument(inst, inst.kind === 'drums' ? [36, 42, 38, 42] : [60, 64, 67], inst.kind === 'drums' ? 160 : 220);
  };
  const useInstrument = (inst: InstrumentSettings) => {
    if (selectedTrack?.kind === 'instrument') st().setInstrument(selectedTrack.id, inst);
    else st().addTrack('instrument', inst);
  };
  const q = filter.trim().toLowerCase();

  return (
    <div className="sound-browser">
      <div className="tabs">
        <button className={tab === 'instruments' ? 'on' : ''} onClick={() => setTab('instruments')}>Instruments</button>
        <button className={tab === 'media' ? 'on' : ''} onClick={() => setTab('media')}>Audio files</button>
      </div>
      {tab === 'instruments' && (
        <div className="browser-list">
          <input className="search" placeholder="Search instruments…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ margin: '6px 8px', width: 'calc(100% - 16px)' }} />
          <div className="dim small" style={{ padding: '0 10px 6px' }}>
            {selectedTrack?.kind === 'instrument' ? <>Click a sound to load it on <b>{selectedTrack.name}</b>; ▶ auditions it. Keys A W S E D… play it.</> : <>Click a sound to add an instrument track; ▶ auditions it.</>}
          </div>
          {INSTRUMENT_CATEGORIES.filter((c) => c !== 'Sampler').map((cat) => {
            const items = instrumentsInCategory(cat).filter((i) => !q || i.name.toLowerCase().includes(q) || cat.toLowerCase().includes(q));
            if (!items.length) return null;
            const isOpen = q ? true : open[cat] ?? false;
            return (
              <div key={cat}>
                <div className="browser-group clickable" onClick={() => setOpen({ ...open, [cat]: !isOpen })}>{isOpen ? '▾' : '▸'} {categoryIcon(cat)} {cat} <span className="dim">({items.length})</span></div>
                {isOpen && items.map((p) => (
                  <div key={p.name} className={`browser-item ${selectedTrack?.instrument?.name === p.name ? 'active' : ''}`} onClick={() => useInstrument(p)}
                    draggable onDragStart={(e) => e.dataTransfer.setData('application/x-instrument', p.name)}>
                    <span className="icon">{categoryIcon(p.category)}</span><span className="name">{p.name}</span>
                    <button className="small" onClick={(e) => { e.stopPropagation(); audition(p); }} title="Audition">▶</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {tab === 'media' && (
        <div className="browser-list">
          <div className="row" style={{ padding: '6px 10px' }}>
            <button className="primary small" onClick={importViaDialog}>+ Import audio…</button>
            <span className="dim small">Drag onto a track, or double-click to add. Recordings appear here too.</span>
          </div>
          {assets.length === 0 && <div className="dim small" style={{ padding: 10 }}>No audio files yet. Import music, recordings or videos with sound, or press ● to record.</div>}
          {assets.map((a) => (
            <div key={a.id} className="browser-item" draggable
              onDragStart={(e) => { e.dataTransfer.setData('application/x-asset-id', a.id); e.dataTransfer.effectAllowed = 'copy'; }}
              onDoubleClick={() => addAssetToStudio(a.id, st().currentTime, selectedTrack?.kind === 'audio' ? selectedTrackId ?? undefined : undefined)}
              title={a.path}>
              <span className="icon">{a.kind === 'video' ? '🎬' : /take/i.test(a.name) ? '🎙' : '🎵'}</span>
              <span className="name">{a.name}</span>
              <span className="dim small">{formatTime(a.duration)}</span>
              <button className="small" onClick={(e) => { e.stopPropagation(); void getEngine().loadAsset(a).then(() => getEngine().previewAsset(a.id, 0, 3)); }} title="Preview 3 s">▶</button>
              <button className="small" onClick={(e) => { e.stopPropagation(); st().addSamplerTrack(a.id, a.name); }} title="New instrument track that plays this sound at different pitches">🎹</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
