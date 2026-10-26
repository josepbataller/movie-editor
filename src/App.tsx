import { useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar';
import MediaBin from './components/MediaBin';
import Preview from './components/Preview';
import Inspector from './components/Inspector';
import Timeline from './components/Timeline';
import ExportDialog from './components/ExportDialog';
import { useProject, projectDuration } from './store/useProject';
import { importViaDialog } from './engine/importMedia';
import { newProjectAction, openProjectAction, saveProjectAction, loadProjectFromPath, installProjectLifecycle, offerRecovery } from './engine/projectFile';
import TitleStudio from './components/TitleStudio';

export default function App() {
  const exportOpen = useProject((s) => s.exportOpen);
  const titleStudioClipId = useProject((s) => s.titleStudioClipId);
  const [timelineH, setTimelineH] = useState(300);
  const dragRef = useRef<{ y: number; h: number } | null>(null);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      const st = useProject.getState();
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveProjectAction(e.shiftKey); return; }
      if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); openProjectAction(); return; }
      if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); newProjectAction(); return; }
      if (ctrl && e.key.toLowerCase() === 'i') { e.preventDefault(); importViaDialog(); return; }
      if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); st.setExportOpen(true); return; }
      if (typing) {
        if (e.key === 'Escape') (target as HTMLElement).blur();
        return;
      }
      if (st.exportOpen || st.titleStudioClipId) return;

      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); return; }
      if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); if (st.selectedClipIds.length) st.duplicateClips(st.selectedClipIds); return; }
      if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); st.select(st.project.clips.map((c) => c.id)); return; }

      const fps = st.project.fps;
      switch (e.key) {
        case ' ': e.preventDefault(); st.togglePlay(); break;
        case 's': case 'S': st.splitSelectedAtPlayhead(); break;
        case 't': case 'T': st.addTextClip({ text: { content: 'My Title' } }); break;
        case 'Delete': case 'Backspace': if (st.selectedClipIds.length) st.removeClips(st.selectedClipIds); break;
        case 'Escape': st.select([]); break;
        case 'Home': st.setCurrentTime(0); break;
        case 'End': st.setCurrentTime(projectDuration(st.project)); break;
        case 'ArrowLeft': e.preventDefault(); st.setPlaying(false); st.setCurrentTime(st.currentTime - (e.shiftKey ? 1 : 1 / fps)); break;
        case 'ArrowRight': e.preventDefault(); st.setPlaying(false); st.setCurrentTime(st.currentTime + (e.shiftKey ? 1 : 1 / fps)); break;
        case 'm': case 'M': {
          for (const id of st.selectedClipIds) {
            const c = st.project.clips.find((c) => c.id === id);
            if (c && (c.type === 'video' || c.type === 'audio')) st.updateAudio(id, { muted: !c.audio.muted });
          }
          break;
        }
        case '+': case '=': st.setPixelsPerSecond(st.pixelsPerSecond * 1.25); break;
        case '-': st.setPixelsPerSecond(st.pixelsPerSecond / 1.25); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Startup: open a project passed on the command line (double-clicked .mvproj / --open=),
  // otherwise offer to recover an autosave. Then install autosave + close handshake.
  useEffect(() => {
    const cleanup = installProjectLifecycle();
    (async () => {
      if (window.api.startupProject) {
        await loadProjectFromPath(window.api.startupProject);
        if (window.api.startupSeek) useProject.getState().setCurrentTime(window.api.startupSeek);
        if (window.api.startupExport) useProject.getState().setExportOpen(true);
        if (window.api.startupSelect) useProject.getState().select([window.api.startupSelect]);
        if (window.api.startupStudio && window.api.startupSelect) useProject.getState().setTitleStudio(window.api.startupSelect);
      } else {
        await offerRecovery();
      }
    })();
    return cleanup;
  }, []);

  // Resizable timeline
  const onSplitDown = (e: React.MouseEvent) => {
    dragRef.current = { y: e.clientY, h: timelineH };
    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setTimelineH(Math.min(window.innerHeight - 300, Math.max(160, dragRef.current.h - (ev.clientY - dragRef.current.y))));
    };
    const up = () => { dragRef.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <aside className="left"><MediaBin /></aside>
        <main className="center"><Preview /></main>
        <aside className="right"><Inspector /></aside>
      </div>
      <div className="splitter" onMouseDown={onSplitDown} />
      <div className="bottom" style={{ height: timelineH }}><Timeline /></div>
      {exportOpen && <ExportDialog />}
      {titleStudioClipId && <TitleStudio clipId={titleStudioClipId} />}
    </div>
  );
}
