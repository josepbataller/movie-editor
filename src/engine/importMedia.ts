import type { MediaAsset } from '@/shared/types';
import { useProject, uid } from '@/store/useProject';

/** Probe files, add them to the media bin, then generate thumbnails/waveforms in the background. */
export async function importFiles(paths: string[]): Promise<{ added: number; errors: string[] }> {
  const { addAssets, updateAsset } = useProject.getState();
  const errors: string[] = [];
  const assets: MediaAsset[] = [];

  for (const p of paths) {
    const existing = useProject.getState().project.assets.find((a) => a.path === p);
    if (existing) continue;
    try {
      const info = await window.api.probeMedia(p);
      assets.push({ ...info, id: uid() });
    } catch (err: any) {
      errors.push(`${p}: ${err?.message ?? err}`);
    }
  }
  if (assets.length) addAssets(assets);

  // Thumbnails / waveforms (don't block the import)
  void (async () => {
    for (const a of assets) {
      try {
        if (a.kind !== 'audio') {
          const at = a.kind === 'image' ? 0 : Math.min(1, a.duration / 2);
          const thumb = await window.api.generateThumbnail(a.path, at);
          if (thumb) updateAsset(a.id, { thumbnail: thumb });
        }
        if (a.hasAudio) {
          const wave = await window.api.generateWaveform(a.path);
          if (wave) updateAsset(a.id, { waveform: wave });
        }
      } catch {
        // cosmetic; ignore
      }
    }
  })();

  return { added: assets.length, errors };
}

export async function importViaDialog() {
  const paths = await window.api.openMediaDialog();
  if (!paths.length) return;
  const { errors } = await importFiles(paths);
  if (errors.length) alert(`Some files could not be imported:\n\n${errors.join('\n')}`);
}

/** After loading a project: flag missing files and regenerate temp artwork if needed. */
export async function refreshAssets() {
  const { project, updateAsset } = useProject.getState();
  for (const a of project.assets) {
    const exists = await window.api.fileExists(a.path);
    if (!exists) continue;
    if (a.kind !== 'audio' && (!a.thumbnail || !(await window.api.fileExists(a.thumbnail)))) {
      const thumb = await window.api.generateThumbnail(a.path, a.kind === 'image' ? 0 : Math.min(1, a.duration / 2));
      if (thumb) updateAsset(a.id, { thumbnail: thumb });
    }
    if (a.hasAudio && (!a.waveform || !(await window.api.fileExists(a.waveform)))) {
      const wave = await window.api.generateWaveform(a.path);
      if (wave) updateAsset(a.id, { waveform: wave });
    }
  }
}

export function formatTime(s: number, withFrames = false, fps = 30): string {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const base = `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  if (!withFrames) return base;
  const f = Math.floor((s - Math.floor(s)) * fps);
  return `${base}.${String(f).padStart(2, '0')}`;
}
