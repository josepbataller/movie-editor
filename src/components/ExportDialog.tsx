import { useEffect, useMemo, useRef, useState } from 'react';
import { useProject, projectDuration } from '@/store/useProject';
import type { ExportProgress, ExportSettings } from '@/shared/types';
import { renderText } from '@/engine/textRender';
import { formatTime } from '@/engine/importMedia';
import { exportFrames } from '@/engine/frameExporter';
import { needsFrameEngine } from '../../electron/exportBuilder';

type Phase = 'settings' | 'preparing' | 'running' | 'done' | 'error' | 'cancelled';

export default function ExportDialog() {
  const project = useProject((s) => s.project);
  const close = () => useProject.getState().setExportOpen(false);

  const requiresFrames = useMemo(() => needsFrameEngine(project), [project]);
  const [res, setRes] = useState<'project' | '2160' | '1080' | '720' | '480'>('project');
  const [fps, setFps] = useState<number>(project.fps);
  const [quality, setQuality] = useState<ExportSettings['quality']>('high');
  const [format, setFormat] = useState<ExportSettings['format']>('mp4');
  const [engine, setEngine] = useState<'auto' | 'graph' | 'frames'>('auto');
  const [phase, setPhase] = useState<Phase>('settings');
  const [progress, setProgress] = useState<ExportProgress>({ percent: 0, timeSeconds: 0 });
  const [outPath, setOutPath] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const cancelRef = useRef(false);

  const effectiveEngine: 'graph' | 'frames' = engine === 'auto' ? (requiresFrames ? 'frames' : 'graph') : engine; // for the UI

  useEffect(() => window.api.onExportProgress((p) => {
    const prog = p as ExportProgress;
    setProgress((prev) => ({ ...prev, ...prog, percent: prog.done ? 100 : prog.error || prog.cancelled ? prev.percent : Math.max(prev.percent, prog.percent) }));
    if (prog.done) setPhase('done');
    else if (prog.error) setPhase('error');
    else if (prog.cancelled) setPhase('cancelled');
  }), []);

  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [phase]);

  const dims = (() => {
    const ar = project.width / project.height;
    const byH = (h: number) => ({ width: Math.round((h * ar) / 2) * 2, height: h });
    switch (res) {
      case '2160': return byH(2160);
      case '1080': return byH(1080);
      case '720': return byH(720);
      case '480': return byH(480);
      default: return { width: project.width, height: project.height };
    }
  })();

  // Debug hook: `--export=<path>` runs a frame-engine export automatically and quits.
  useEffect(() => {
    const auto = window.api.startupExport;
    if (!auto) return;
    setEngine('frames');
    void start(auto, 'frames');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (window.api.startupExport && (phase === 'done' || phase === 'error')) {
      if (phase === 'error') console.error('[export] ' + progress.error);
      setTimeout(() => window.api.closeNow(), 500);
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (presetPath?: string, forceEngine?: 'graph' | 'frames') => {
    const st = useProject.getState();
    st.setPlaying(false);
    const duration = projectDuration(project);
    if (duration <= 0) { alert('The timeline is empty — add some clips first.'); return; }
    const path = presetPath ?? await window.api.exportDialog(project.name || 'movie', format);
    if (!path) return;
    const effectiveEngine: 'graph' | 'frames' = forceEngine ?? (engine === 'auto' ? (requiresFrames ? 'frames' : 'graph') : engine);
    setOutPath(path);
    setPhase('preparing');
    cancelRef.current = false;

    const settings: ExportSettings = {
      outputPath: path, width: dims.width, height: dims.height, fps, quality, format,
      textImages: {}, textImageSizes: {}, engine: effectiveEngine,
    };

    if (effectiveEngine === 'graph') {
      // Render each text clip to a PNG so FFmpeg can overlay it.
      for (const c of project.clips) {
        if (c.type !== 'text') continue;
        const canvas = renderText(c.text, project.width, project.height);
        settings.textImages[c.id] = await window.api.writeTempPng(canvas.toDataURL('image/png'), `text-${c.id}`);
        settings.textImageSizes[c.id] = { w: canvas.width, h: canvas.height };
      }
    }

    setPhase('running');
    setStartedAt(Date.now());
    setProgress({ percent: 0, timeSeconds: 0 });
    const plain = JSON.parse(JSON.stringify(project));

    let result: { ok: boolean; error?: string; cancelled?: boolean };
    try {
      if (effectiveEngine === 'graph') {
        result = (await window.api.startExport(plain, settings)) as typeof result;
      } else {
        result = await exportFrames(plain, settings,
          (p) => setProgress({ percent: p.percent, timeSeconds: p.frame / fps }),
          () => cancelRef.current);
      }
    } catch (err: any) {
      result = { ok: false, error: String(err?.message ?? err) };
    }
    if (!result.ok && !result.cancelled) {
      setPhase('error');
      setProgress((p) => ({ ...p, error: p.error ?? result.error ?? 'Export failed' }));
    } else if (!result.ok && result.cancelled) {
      setPhase('cancelled');
    }
  };

  const cancel = () => {
    cancelRef.current = true;
    window.api.cancelExport();
  };

  const elapsed = (now - startedAt) / 1000;
  const eta = progress.percent > 2 ? (elapsed / progress.percent) * (100 - progress.percent) : NaN;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== 'running' && phase !== 'preparing') close(); }}>
      <div className="modal">
        <div className="modal-title">Export video</div>

        {phase === 'settings' && (
          <>
            <div className="field"><label>Resolution</label>
              <select value={res} onChange={(e) => setRes(e.target.value as any)}>
                <option value="project">Project ({project.width}×{project.height})</option>
                <option value="2160">4K (2160p)</option>
                <option value="1080">Full HD (1080p)</option>
                <option value="720">HD (720p)</option>
                <option value="480">SD (480p)</option>
              </select>
              <span className="dim small">{dims.width}×{dims.height}</span>
            </div>
            <div className="field"><label>Frame rate</label>
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </div>
            <div className="field"><label>Quality</label>
              <select value={quality} onChange={(e) => setQuality(e.target.value as any)}>
                <option value="high">High (larger file)</option>
                <option value="medium">Medium</option>
                <option value="low">Low (smaller file)</option>
              </select>
            </div>
            <div className="field"><label>Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
                <option value="mp4">MP4 (H.264 + AAC) — recommended</option>
                <option value="mkv">MKV (H.264 + AAC)</option>
                <option value="webm">WebM (VP9 + Opus) — slower</option>
              </select>
            </div>
            <div className="field"><label>Engine</label>
              <select value={engine} onChange={(e) => setEngine(e.target.value as any)}>
                <option value="auto">Automatic ({requiresFrames ? 'precise' : 'fast'})</option>
                <option value="graph" disabled={requiresFrames}>Fast (FFmpeg filter graph)</option>
                <option value="frames">Precise (frame by frame)</option>
              </select>
            </div>
            <div className="dim small" style={{ marginTop: 4 }}>
              {effectiveEngine === 'frames'
                ? 'Precise mode renders every frame exactly as the preview shows it (needed for animations and text effects). It is slower: roughly real-time or a bit more.'
                : 'Fast mode lets FFmpeg do all the work. Switch to Precise if the result ever differs from the preview.'}
            </div>
            <div className="dim small" style={{ marginTop: 8 }}>Duration: {formatTime(projectDuration(project), true, project.fps)} · {project.clips.length} clips</div>
            <div className="modal-actions">
              <button onClick={close}>Cancel</button>
              <button className="primary" onClick={() => start()}>Choose file & export…</button>
            </div>
          </>
        )}

        {(phase === 'preparing' || phase === 'running') && (
          <>
            <div className="progress"><div className="bar" style={{ width: `${progress.percent}%` }} /></div>
            <div className="row space">
              <span>{phase === 'preparing' ? 'Preparing…' : `${progress.percent.toFixed(0)}%  ·  ${formatTime(progress.timeSeconds)} rendered`}</span>
              <span className="dim small">{isFinite(eta) ? `~${formatTime(eta)} left` : ''}</span>
            </div>
            <div className="dim small path">{outPath}</div>
            <div className="modal-actions">
              <button onClick={cancel} disabled={phase !== 'running'}>Cancel export</button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="progress"><div className="bar" style={{ width: '100%' }} /></div>
            <p>✅ Export finished.</p>
            <div className="dim small path">{outPath}</div>
            <div className="modal-actions">
              <button onClick={() => window.api.showInFolder(outPath)}>Show in folder</button>
              <button className="primary" onClick={close}>Close</button>
            </div>
          </>
        )}

        {phase === 'cancelled' && (
          <>
            <p>Export cancelled.</p>
            <div className="modal-actions"><button onClick={() => setPhase('settings')}>Back</button><button className="primary" onClick={close}>Close</button></div>
          </>
        )}

        {phase === 'error' && (
          <>
            <p>❌ Export failed.</p>
            <pre className="error">{progress.error}</pre>
            <div className="modal-actions"><button onClick={() => setPhase('settings')}>Back</button><button className="primary" onClick={close}>Close</button></div>
          </>
        )}
      </div>
    </div>
  );
}
