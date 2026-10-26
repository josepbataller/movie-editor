import { useProject, newProject } from '@/store/useProject';
import { type Project, DEFAULT_TEXT } from '@/shared/types';
import { refreshAssets } from './importMedia';
import { useStudio } from '@/store/useStudio';

const FORMAT_VERSION = 2;
const AUTOSAVE_INTERVAL_MS = 15000;

export async function saveProjectAction(saveAs: boolean): Promise<boolean> {
  const st = useProject.getState();
  let path = st.projectPath;
  if (saveAs || !path) {
    path = await window.api.saveProjectDialog(st.project.name);
    if (!path) return false;
  }
  const payload = { version: FORMAT_VERSION, project: { ...st.project, audio: useStudio.getState().session } };
  await window.api.writeFile(path, JSON.stringify(payload, null, 2));
  useProject.setState({ projectPath: path, dirty: false });
  useStudio.getState().markSaved();
  await clearAutosave();
  return true;
}

/** Native Save / Don't save / Cancel prompt. Resolves true when it is OK to proceed. */
async function confirmDiscard(what: string): Promise<boolean> {
  const st = useProject.getState();
  if (!st.dirty && !useStudio.getState().dirty) return true;
  const choice = await window.api.confirmDiscard(what);
  if (choice === 'cancel') return false;
  if (choice === 'save') return saveProjectAction(false);
  await clearAutosave();
  return true;
}

export async function openProjectAction() {
  if (!(await confirmDiscard('opening another project'))) return;
  const path = await window.api.openProjectDialog();
  if (!path) return;
  await loadProjectFromPath(path);
}

/** Older project files may lack fields added later; fill them in. */
function migrate(project: Project): Project {
  const base = newProject();
  const p: Project = { ...base, ...project };
  p.clips = p.clips.map((c) => (c.type === 'text' ? { ...c, text: { ...DEFAULT_TEXT, ...c.text } } : c));
  return p;
}

export async function loadProjectFromPath(path: string) {
  try {
    const raw = JSON.parse(await window.api.readFile(path));
    const project: Project = raw.project ?? raw;
    if (!project.tracks || !project.clips) throw new Error('Not a Movie Editor project file.');
    useProject.getState().setProject(migrate(project), path);
    useStudio.getState().setSession(project.audio);
    void refreshAssets(); // thumbnails/waveforms regenerate in the background
    await warnMissingMedia(project);
  } catch (err: any) {
    alert(`Could not open project: ${err.message ?? err}`);
  }
}

async function warnMissingMedia(project: Project) {
  const missing: string[] = [];
  for (const a of project.assets) if (!(await window.api.fileExists(a.path))) missing.push(a.path);
  if (missing.length) alert(`Some media files could not be found:\n\n${missing.join('\n')}`);
}

export async function newProjectAction() {
  if (!(await confirmDiscard('starting a new project'))) return;
  useProject.getState().resetProject();
  useStudio.getState().reset();
}

// ---------------------------------------------------------------------------
// Crash-recovery autosave + window-close handshake
// ---------------------------------------------------------------------------

async function clearAutosave() {
  autosaveGeneration++;
  try {
    const p = await window.api.autosavePath();
    await window.api.deleteFile(p);
  } catch { /* ignore */ }
}

let autosaveGeneration = 0; // bumped by clearAutosave so an in-flight autosave can't resurrect a stale copy
async function writeAutosave() {
  const st = useProject.getState();
  const studio = useStudio.getState();
  if (!st.dirty && !studio.dirty) return;
  const gen = autosaveGeneration;
  try {
    const p = await window.api.autosavePath();
    if (gen !== autosaveGeneration || (!useProject.getState().dirty && !useStudio.getState().dirty)) return;
    const payload = { version: FORMAT_VERSION, project: { ...st.project, audio: studio.session }, projectPath: st.projectPath, savedAt: Date.now() };
    await window.api.writeFile(p, JSON.stringify(payload));
    if (gen !== autosaveGeneration) await clearAutosave();
  } catch { /* ignore */ }
}

/** Offer to restore an autosave left by a previous session that did not close cleanly. */
export async function offerRecovery(): Promise<boolean> {
  try {
    const p = await window.api.autosavePath();
    if (!(await window.api.fileExists(p))) return false;
    const raw = JSON.parse(await window.api.readFile(p));
    if (!raw?.project?.clips?.length) { await clearAutosave(); return false; }
    const when = raw.savedAt ? new Date(raw.savedAt).toLocaleString() : 'earlier';
    const name = raw.project.name || 'Untitled';
    const choice = await window.api.ask(
      'Recover unsaved work?',
      `Movie Editor was closed without saving the project "${name}" (autosaved ${when}). Do you want to recover it?`,
      ['Recover', 'Discard'],
      0,
    );
    if (choice === 0) {
      useProject.getState().setProject(migrate(raw.project), raw.projectPath ?? null);
      useStudio.getState().setSession(raw.project.audio);
      useProject.setState({ dirty: true });
      void refreshAssets();
      void warnMissingMedia(raw.project);
      return true;
    }
    await clearAutosave();
  } catch { /* ignore */ }
  return false;
}

/** Call once from the app root. Returns a cleanup function. */
export function installProjectLifecycle(): () => void {
  // keep the main process informed so it can prompt on window close
  const sync = () => window.api.setDirty(useProject.getState().dirty || useStudio.getState().dirty);
  const unsub1 = useProject.subscribe((s, prev) => { if (s.dirty !== prev.dirty) sync(); });
  const unsub2 = useStudio.subscribe((s, prev) => { if (s.dirty !== prev.dirty) sync(); });
  const unsub = () => { unsub1(); unsub2(); };
  sync();

  const timer = window.setInterval(writeAutosave, AUTOSAVE_INTERVAL_MS);

  const offSave = window.api.onSaveAndClose(async () => {
    const ok = await saveProjectAction(false);
    if (ok) window.api.closeNow();
    // if the user cancelled the save dialog, stay open
  });

  return () => { unsub(); window.clearInterval(timer); offSave(); };
}
