import { useRef, useState } from 'react';
import { useStudio } from '@/store/useStudio';
import StudioTopBar, { useStudioShortcuts } from './StudioTopBar';
import SoundBrowser from './SoundBrowser';
import StudioTimeline from './StudioTimeline';
import FxPanel from './FxPanel';
import PatternEditor from './PatternEditor';
import StudioExport from './StudioExport';
import { useEngineSync } from './useEngineSync';

/**
 * Audio Studio workspace (DAW): transport bar, sound browser, multitrack arrangement and a
 * bottom panel that shows either the pattern editor (notes) or the effects chain.
 */
export default function StudioApp() {
  useEngineSync();
  useStudioShortcuts();
  const editorClipId = useStudio((s) => (s.editorClipId && s.session.clips.some((c) => c.id === s.editorClipId) ? s.editorClipId : null));
  const fxTarget = useStudio((s) => (s.fxPanelTrackId === 'master' || (s.fxPanelTrackId && s.session.tracks.some((t) => t.id === s.fxPanelTrackId)) ? s.fxPanelTrackId : null));
  const [exportOpen, setExportOpen] = useState(false);
  const [bottomH, setBottomH] = useState(380);
  const dragRef = useRef<{ y: number; h: number } | null>(null);

  const onSplitDown = (e: React.MouseEvent) => {
    dragRef.current = { y: e.clientY, h: bottomH };
    const move = (ev: MouseEvent) => { if (dragRef.current) setBottomH(Math.min(window.innerHeight - 260, Math.max(160, dragRef.current.h - (ev.clientY - dragRef.current.y)))); };
    const up = () => { dragRef.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const bottom = editorClipId ? <PatternEditor clipId={editorClipId} /> : fxTarget ? <FxPanel target={fxTarget} /> : null;

  return (
    <div className="studio-app">
      <StudioTopBar onExport={() => setExportOpen(true)} />
      <div className="studio-main">
        <aside className="studio-side"><SoundBrowser /></aside>
        <div className="studio-center">
          <StudioTimeline />
          {bottom && (
            <>
              <div className="splitter" onMouseDown={onSplitDown} />
              <div className="studio-bottom" style={{ height: bottomH }}>{bottom}</div>
            </>
          )}
        </div>
      </div>
      {exportOpen && <StudioExport onClose={() => setExportOpen(false)} />}
    </div>
  );
}
