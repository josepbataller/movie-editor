import { useProject, uid } from '@/store/useProject';
import { useStudio } from '@/store/useStudio';
import { getEngine, audioBufferToWav } from './engine';
import { importFiles } from '@/engine/project/importMedia';
import type { Clip } from '@/shared/types';

// Bridges between the Audio Studio and the video editor.

/** Render the studio mix to a WAV file and return its path (temp folder unless `outPath` is given). */
export async function renderMixToWav(outPath?: string): Promise<string> {
  const session = useStudio.getState().session;
  const assets = useProject.getState().project.assets;
  const buffer = await getEngine().render(session, assets, 48000);
  const wav = audioBufferToWav(buffer);
  const path = outPath ?? (await window.api.tempPath(`studio-mix-${Date.now()}.wav`));
  await window.api.writeBinary(path, wav);
  return path;
}

/**
 * "Send to video": render the mix, import it as a media asset and place it as an audio clip
 * on the video timeline at the video playhead (or at `at` seconds). Switches to the video workspace.
 */
export async function sendMixToVideo(at?: number): Promise<boolean> {
  const name = (useProject.getState().project.name || 'project').replace(/[^\w\- ]+/g, '_');
  const dir = await window.api.tempPath('');
  const path = `${dir}${dir.endsWith('\\') || dir.endsWith('/') ? '' : '\\'}${name}-mix-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`;
  await renderMixToWav(path);
  const { added, errors } = await importFiles([path]);
  if (errors.length || (!added && !useProject.getState().project.assets.some((a) => a.path === path))) {
    alert(`Could not import the rendered mix:\n${errors.join('\n')}`);
    return false;
  }
  const st = useProject.getState();
  const asset = st.project.assets.find((a) => a.path === path);
  if (!asset) return false;
  st.addClipFromAsset(asset.id, { start: at ?? st.currentTime });
  st.setWorkspace('video');
  return true;
}

/**
 * "Open in Audio Studio": put the sound of a video-timeline clip on a new studio audio track
 * (same position and trim), and switch to the studio.
 */
export function openClipInStudio(clip: Clip) {
  if (clip.type !== 'video' && clip.type !== 'audio') return;
  const asset = useProject.getState().project.assets.find((a) => a.id === clip.assetId);
  if (!asset?.hasAudio) return;
  const studio = useStudio.getState();
  const trackId = studio.addTrack('audio');
  studio.updateTrack(trackId, { name: asset.name.replace(/\.[^.]+$/, '') }, { commit: false });
  const id = studio.addSampleClip(trackId, asset.id, asset.name, clip.start, clip.duration);
  studio.updateClip(id, { inPoint: clip.inPoint, rate: clip.speed, gain: clip.audio.volume, fadeIn: clip.audio.fadeIn, fadeOut: clip.audio.fadeOut } as Partial<Clip> as any, { commit: false });
  studio.setCurrentTime(clip.start);
  useProject.getState().setWorkspace('audio');
}

/** Add a media-bin asset to the studio on a new (or given) audio track at `start`. */
export function addAssetToStudio(assetId: string, start: number, trackId?: string): string | null {
  const asset = useProject.getState().project.assets.find((a) => a.id === assetId);
  if (!asset?.hasAudio) return null;
  const studio = useStudio.getState();
  let tid = trackId;
  if (!tid) {
    tid = studio.addTrack('audio');
    studio.updateTrack(tid, { name: asset.name.replace(/\.[^.]+$/, '') }, { commit: false });
  }
  return studio.addSampleClip(tid, asset.id, asset.name, start, Math.max(0.1, asset.duration));
}

export const newId = uid;
