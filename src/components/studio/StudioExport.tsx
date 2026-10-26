import { useState } from 'react';
import { useStudio, sessionDuration } from '@/store/useStudio';
import { useProject } from '@/store/useProject';
import { renderMixToWav } from '@/engine/audio/bridge';
import { formatTime } from '@/engine/project/importMedia';

type Format = 'wav' | 'mp3' | 'flac' | 'm4a' | 'ogg';

/** Render the studio mix offline and save it as WAV / MP3 / FLAC / M4A / OGG. */
export default function StudioExport({ onClose }: { onClose: () => void }) {
  const session = useStudio((s) => s.session);
  const projectName = useProject((s) => s.project.name);
  const [format, setFormat] = useState<Format>('wav');
  const [bitrate, setBitrate] = useState('320k');
  const [phase, setPhase] = useState<'settings' | 'rendering' | 'done' | 'error'>('settings');
  const [outPath, setOutPath] = useState('');
  const [error, setError] = useState('');

  const start = async () => {
    const path = await window.api.audioExportDialog(projectName || 'mix', format);
    if (!path) return;
    setOutPath(path);
    setPhase('rendering');
    useStudio.getState().setPlaying(false);
    try {
      if (format === 'wav') {
        await renderMixToWav(path);
      } else {
        const wav = await renderMixToWav();
        const res = await window.api.encodeAudio(wav, path, format, bitrate);
        if (!res.ok) throw new Error(res.error ?? 'Encoding failed');
      }
      setPhase('done');
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setPhase('error');
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== 'rendering') onClose(); }}>
      <div className="modal">
        <div className="modal-title">Export audio mix</div>
        {phase === 'settings' && (
          <>
            <div className="field"><label>Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                <option value="wav">WAV (lossless, 48 kHz 16-bit)</option>
                <option value="flac">FLAC (lossless, compressed)</option>
                <option value="mp3">MP3</option>
                <option value="m4a">M4A / AAC</option>
                <option value="ogg">OGG Vorbis</option>
              </select>
            </div>
            {(format === 'mp3' || format === 'm4a') && (
              <div className="field"><label>Bitrate</label>
                <select value={bitrate} onChange={(e) => setBitrate(e.target.value)}>
                  <option value="128k">128 kbps</option><option value="192k">192 kbps</option><option value="256k">256 kbps</option><option value="320k">320 kbps</option>
                </select>
              </div>
            )}
            <div className="dim small">Length: {formatTime(sessionDuration(session))} (+2 s tail for reverbs) · {session.tracks.length} tracks · {session.bpm} BPM. Muted tracks are skipped; solo is honoured.</div>
            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
              <button className="primary" onClick={start}>Choose file & export…</button>
            </div>
          </>
        )}
        {phase === 'rendering' && (<><div className="progress"><div className="bar indeterminate" /></div><p>Rendering the mix offline…</p><div className="dim small path">{outPath}</div></>)}
        {phase === 'done' && (
          <>
            <p>✅ Export finished.</p>
            <div className="dim small path">{outPath}</div>
            <div className="modal-actions"><button onClick={() => window.api.showInFolder(outPath)}>Show in folder</button><button className="primary" onClick={onClose}>Close</button></div>
          </>
        )}
        {phase === 'error' && (<><p>❌ Export failed.</p><pre className="error">{error}</pre><div className="modal-actions"><button onClick={() => setPhase('settings')}>Back</button><button className="primary" onClick={onClose}>Close</button></div></>)}
      </div>
    </div>
  );
}
