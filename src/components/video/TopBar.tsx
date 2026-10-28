import { useProject } from '@/store/useProject';
import { importViaDialog } from '@/engine/project/importMedia';
import { newProjectAction, openProjectAction, saveProjectAction } from '@/engine/project/projectFile';
import { useStudio } from '@/store/useStudio';
import { useAssistant } from '@/store/useAssistant';

export default function TopBar() {
  const name = useProject((s) => s.project.name);
  const dirty = useProject((s) => s.dirty);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const workspace = useProject((s) => s.workspace);
  const st = useProject.getState;

  return (
    <div className="topbar">
      <div className="brand">🎞 Movie Editor</div>
      <div className="ws-switch" title="Switch between the video editor and the Audio Studio">
        <button className={workspace === 'video' ? 'on' : ''} onClick={() => st().setWorkspace('video')}>🎬 Video</button>
        <button className={workspace === 'audio' ? 'on' : ''} onClick={() => st().setWorkspace('audio')}>🎛 Audio Studio</button>
      </div>
      <span className="sep" />
      <div className="group">
        <button onClick={newProjectAction} title="New project (Ctrl+N)">New</button>
        <button onClick={openProjectAction} title="Open project (Ctrl+O)">Open…</button>
        <button onClick={() => saveProjectAction(false)} title="Save project (Ctrl+S)">Save</button>
        <button onClick={() => saveProjectAction(true)} title="Save project as…">Save as…</button>
      </div>
      <span className="sep" />
      <div className="group">
        <button onClick={importViaDialog} title="Import media (Ctrl+I)">📂 Import media</button>
        <button onClick={() => st().addTextClip({ text: { content: 'My Title' } })} title="Add a title at the playhead (T)">T Add text</button>
        <button onClick={() => st().addTextClip({ text: { content: 'Directed by\nYou\n\nStarring\nEveryone', animation: 'scroll-up', fontSize: 54, bold: false, lineHeight: 1.6 }, duration: 10 })} title="Add scrolling credits at the playhead">🎬 Add credits</button>
      </div>
      <span className="sep" />
      <div className="group">
        <button disabled={!canUndo} onClick={() => st().undo()} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button disabled={!canRedo} onClick={() => st().redo()} title="Redo (Ctrl+Y)">↷ Redo</button>
      </div>
      <div className="project-name">{name}{dirty ? ' •' : ''}</div>
      <button onClick={() => useAssistant.getState().setOpen(true)} title="AI assistant: edit by typing or dictating what you want (Ctrl+/)">🤖 Assistant</button>
      <button onClick={() => useStudio.getState().setHelpOpen(true)} title="Help & manual (F1)">? Help</button>
      <button className="primary" onClick={() => st().setExportOpen(true)} title="Export video (Ctrl+E)">⬇ Export video</button>
    </div>
  );
}
