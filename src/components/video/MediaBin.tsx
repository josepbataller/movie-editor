import { useState } from 'react';
import { useProject } from '@/store/useProject';
import { importViaDialog, importFiles, formatTime } from '@/engine/project/importMedia';
import type { MediaAsset } from '@/shared/types';

export default function MediaBin() {
  const assets = useProject((s) => s.project.assets);
  const [dragOver, setDragOver] = useState(false);
  const [filter, setFilter] = useState('');

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files).map((f) => window.api.getPathForFile(f)).filter(Boolean);
    if (paths.length) {
      const { errors } = await importFiles(paths);
      if (errors.length) alert(`Some files could not be imported:\n\n${errors.join('\n')}`);
    }
  };

  const shown = assets.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div
      className={`media-bin ${dragOver ? 'drop' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="panel-title">
        <span>Media</span>
        <button className="primary small" onClick={importViaDialog} title="Import video, audio or images (Ctrl+I)">+ Import</button>
      </div>
      {assets.length > 4 && <input className="search" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      <div className="media-list">
        {assets.length === 0 && (
          <div className="empty">
            <p>No media yet.</p>
            <p className="dim small">Click <b>Import</b> or drop video, audio and image files here.</p>
          </div>
        )}
        {shown.map((a) => <AssetItem key={a.id} asset={a} />)}
      </div>
      <div className="panel-footer dim small">Drag an item onto the timeline, or double-click to append it.</div>
    </div>
  );
}

function AssetItem({ asset }: { asset: MediaAsset }) {
  const st = useProject.getState;
  const used = useProject((s) => s.project.clips.some((c) => 'assetId' in c && c.assetId === asset.id));
  const icon = asset.kind === 'video' ? '🎬' : asset.kind === 'audio' ? '🎵' : '🖼';
  return (
    <div
      className="asset"
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('application/x-asset-id', asset.id); e.dataTransfer.effectAllowed = 'copy'; }}
      onDoubleClick={() => st().addClipFromAsset(asset.id)}
      title={`${asset.path}\n${asset.width ? `${asset.width}×${asset.height}` : ''}${asset.fps ? ` @ ${asset.fps.toFixed(2)} fps` : ''}\nDouble-click to add to the timeline`}
    >
      <div className="asset-thumb">
        {asset.thumbnail ? <img src={window.api.fileUrl(asset.thumbnail)} alt="" draggable={false} />
          : asset.waveform ? <img src={window.api.fileUrl(asset.waveform)} alt="" draggable={false} className="wave" />
          : <span className="asset-icon">{icon}</span>}
        {asset.kind !== 'image' && <span className="asset-dur">{formatTime(asset.duration)}</span>}
      </div>
      <div className="asset-meta">
        <div className="asset-name">{asset.name}</div>
        <div className="dim small">
          {icon} {asset.kind}{asset.width ? ` · ${asset.width}×${asset.height}` : ''}{asset.kind === 'video' && !asset.hasAudio ? ' · no audio' : ''}
        </div>
      </div>
      <div className="asset-actions">
        <button onClick={() => st().addClipFromAsset(asset.id)} title="Add to timeline">＋</button>
        <button onClick={() => { if (!used || confirm('This media is used on the timeline. Remove it and its clips?')) st().removeAsset(asset.id); }} title="Remove from project">✕</button>
      </div>
    </div>
  );
}
