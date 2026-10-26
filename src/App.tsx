import { useEffect, useRef, useState } from 'react';
import TopBar from './components/video/TopBar';
import MediaBin from './components/video/MediaBin';
import Preview from './components/video/Preview';
import Inspector from './components/video/Inspector';
import Timeline from './components/video/Timeline';
import ExportDialog from './components/video/ExportDialog';
import { useProject, projectDuration } from './store/useProject';
import { importViaDialog } from './engine/project/importMedia';
import { newProjectAction, openProjectAction, saveProjectAction, loadProjectFromPath, installProjectLifecycle, offerRecovery } from './engine/project/projectFile';
import TitleStudio from './components/video/TitleStudio';
import StudioApp from './components/studio/StudioApp';
import { renderMixToWav } from './engine/audio/bridge';
import { getEngine } from './engine/audio/engine';
import { useStudio } from './store/useStudio';

export default function App() {
  const exportOpen = useProject((s) => s.exportOpen);
  const titleStudioClipId = useProject((s) => s.titleStudioClipId);
  const workspace = useProject((s) => s.workspace);
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
      if (st.workspace === 'audio') return; // the Audio Studio has its own shortcuts

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
        if (window.api.startupWorkspace === 'audio') useProject.getState().setWorkspace('audio');
        if (window.api.startupStudioFx) useStudio.getState().openFx(window.api.startupStudioFx);
        if (window.api.startupStudioEditor) useStudio.getState().openEditor(window.api.startupStudioEditor);
        if (window.api.startupStudioClip) useStudio.getState().openClipEditor(window.api.startupStudioClip);
        if (window.api.startupStudioPlay) {
          setTimeout(() => useStudio.getState().setPlaying(true), 800);
          setTimeout(() => { const s = useStudio.getState(); const eng = getEngine(); console.warn(`[studio-play] position ${s.currentTime.toFixed(2)}s playing=${s.playing} engine=${eng.playing} ctx=${eng.ctx.state} ctxTime=${eng.ctx.currentTime.toFixed(2)} enginePos=${eng.position().toFixed(2)}`); s.setPlaying(false); window.api.closeNow(); }, 800 + window.api.startupStudioPlay * 1000);
        }
        if (window.api.startupAudioExport) {
          try { await renderMixToWav(window.api.startupAudioExport); console.warn('[export-audio] done ' + window.api.startupAudioExport); }
          catch (e: any) { console.error('[export-audio] ' + (e?.message ?? e)); }
          window.api.closeNow();
        }
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

  if (workspace === 'audio') {
    return (
      <div className="app">
        <TopBar />
        <StudioApp />
        {exportOpen && <ExportDialog />}
      </div>
    );
  }

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
