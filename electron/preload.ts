import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api = {
  openMediaDialog: (): Promise<string[]> => ipcRenderer.invoke('dialog:openMedia'),
  probeMedia: (filePath: string) => ipcRenderer.invoke('media:probe', filePath),
  generateThumbnail: (filePath: string, at: number) => ipcRenderer.invoke('media:thumbnail', filePath, at),
  generateWaveform: (filePath: string) => ipcRenderer.invoke('media:waveform', filePath),
  writeTempPng: (dataUrl: string, name: string): Promise<string> => ipcRenderer.invoke('media:writeTempPng', dataUrl, name),

  saveProjectDialog: (defaultName: string): Promise<string | null> => ipcRenderer.invoke('dialog:saveProject', defaultName),
  openProjectDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openProject'),
  /** Native "Save / Don't save / Cancel" prompt. */
  confirmDiscard: (what: string): Promise<'save' | 'discard' | 'cancel'> => ipcRenderer.invoke('dialog:confirmDiscard', what),
  /** Generic native question with custom buttons; resolves with the index clicked. */
  ask: (title: string, message: string, buttons: string[], defaultId = 0): Promise<number> => ipcRenderer.invoke('dialog:ask', title, message, buttons, defaultId),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write', filePath, content),
  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:read', filePath),
  fileExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', filePath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('fs:delete', filePath),
  /** Path of the crash-recovery autosave file (in the user's app-data folder). */
  autosavePath: (): Promise<string> => ipcRenderer.invoke('app:autosavePath'),

  // --- window close handshake ---
  /** Tell the main process whether there are unsaved changes (drives the close prompt). */
  setDirty: (dirty: boolean) => ipcRenderer.send('app:setDirty', dirty),
  /** Main asks the renderer to save before closing; the callback must call closeNow() when done. */
  onSaveAndClose: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('app:saveAndClose', listener);
    return () => { ipcRenderer.removeListener('app:saveAndClose', listener); };
  },
  closeNow: () => ipcRenderer.send('app:closeNow'),

  // --- export ---
  exportDialog: (defaultName: string, format: string): Promise<string | null> => ipcRenderer.invoke('dialog:export', defaultName, format),
  startExport: (project: unknown, settings: unknown) => ipcRenderer.invoke('export:start', project, settings),
  /** Frame-by-frame engine: open the encoder, then push raw RGBA frames, then finish. */
  startFrameExport: (project: unknown, settings: unknown) => ipcRenderer.invoke('export:framesStart', project, settings),
  pushFrame: (rgba: ArrayBuffer) => ipcRenderer.invoke('export:framesPush', rgba),
  finishFrameExport: () => ipcRenderer.invoke('export:framesFinish'),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  /** Sequential FFmpeg frame decoders used by the frame engine. */
  decodeOpen: (id: string, opts: { path: string; inPoint: number; srcDuration: number; speed: number; fps: number; width: number; height: number }) => ipcRenderer.invoke('decode:open', id, opts),
  decodeNext: (id: string): Promise<Uint8Array | null> => ipcRenderer.invoke('decode:next', id),
  decodeClose: (id: string) => ipcRenderer.invoke('decode:close', id),
  decodeCloseAll: () => ipcRenderer.invoke('decode:closeAll'),
  onExportProgress: (cb: (p: unknown) => void) => {
    const listener = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on('export:progress', listener);
    return () => { ipcRenderer.removeListener('export:progress', listener); };
  },
  showInFolder: (filePath: string) => ipcRenderer.invoke('shell:showInFolder', filePath),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** Project file passed on the command line (`--open=path` or a bare .mvproj path). */
  startupProject: (process.argv.find((a) => a.startsWith('--open='))?.slice(7) ?? process.argv.find((a) => /\.mvproj$/i.test(a))) || null,
  /** Debug: `--export=<out.mp4>` exports the startup project with the frame engine, then quits. */
  startupExport: process.argv.find((a) => a.startsWith('--export='))?.slice(9) ?? null,
  /** Debug: `--select=<clipId>` selects a clip; `--studio` opens the Title Studio for it. */
  startupSelect: process.argv.find((a) => a.startsWith('--select='))?.slice(9) ?? null,
  startupStudio: process.argv.includes('--studio'),
  /** Debug: `--seek=<seconds>` positions the playhead after the startup project loads. */
  startupSeek: Number(process.argv.find((a) => a.startsWith('--seek='))?.slice(7) ?? 0) || 0,
  fileUrl: (filePath: string): string => {
    // file:// URL usable by <video>/<img> in the renderer
    const p = filePath.replace(/\\/g, '/');
    return encodeURI('file:///' + p.replace(/^\/+/, '')).replace(/#/g, '%23').replace(/\?/g, '%3F');
  },
};

contextBridge.exposeInMainWorld('api', api);
export type Api = typeof api;
