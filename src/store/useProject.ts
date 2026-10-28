import { create } from 'zustand';
import {
  Project, Clip, Track, MediaAsset, TrackKind, Transform, Effects, AudioProps, TextProps, AnimationSegment,
  DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_AUDIO, DEFAULT_TEXT, isVisual,
} from '@/shared/types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function newTrack(kind: TrackKind, index: number): Track {
  return { id: uid(), kind, name: kind === 'video' ? `Video ${index}` : `Audio ${index}`, muted: false, hidden: false, locked: false };
}

export function newProject(): Project {
  return {
    name: 'Untitled',
    width: 1920,
    height: 1080,
    fps: 30,
    backgroundColor: '#000000',
    assets: [],
    tracks: [newTrack('video', 1), newTrack('video', 2), newTrack('audio', 1)],
    clips: [],
  };
}

export type Snapshot = Pick<Project, 'tracks' | 'clips' | 'assets'>;

interface EditorState {
  project: Project;
  projectPath: string | null;
  dirty: boolean;

  // Playback / UI (not persisted)
  currentTime: number;
  playing: boolean;
  selectedClipIds: string[];
  pixelsPerSecond: number;
  snapping: boolean;
  exportOpen: boolean;
  /** Which workspace is shown: the video editor or the Audio Studio (DAW). */
  workspace: 'video' | 'audio';
  setWorkspace: (w: 'video' | 'audio') => void;

  past: Snapshot[];
  future: Snapshot[];

  // --- project lifecycle
  setProject: (p: Project, path?: string | null) => void;
  resetProject: () => void;
  setProjectPath: (p: string | null) => void;
  markSaved: () => void;
  updateProjectSettings: (patch: Partial<Pick<Project, 'name' | 'width' | 'height' | 'fps' | 'backgroundColor'>>) => void;
  /** Register a loaded font file with the project (replaces an entry with the same family). */
  addFont: (font: { family: string; path: string }) => void;

  // --- assets
  addAssets: (assets: MediaAsset[]) => void;
  updateAsset: (id: string, patch: Partial<MediaAsset>) => void;
  removeAsset: (id: string) => void;

  // --- tracks
  addTrack: (kind: TrackKind) => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  moveTrack: (id: string, dir: -1 | 1) => void;

  // --- clips
  addClipFromAsset: (assetId: string, opts?: { trackId?: string; start?: number }) => string | null;
  addTextClip: (opts?: { trackId?: string; start?: number; text?: Partial<TextProps>; duration?: number }) => string;
  updateClip: (id: string, patch: Partial<Clip>, opts?: { commit?: boolean }) => void;
  updateClips: (ids: string[], fn: (c: Clip) => Partial<Clip>, opts?: { commit?: boolean }) => void;
  updateTransform: (id: string, patch: Partial<Transform>, opts?: { commit?: boolean }) => void;
  updateEffects: (id: string, patch: Partial<Effects>, opts?: { commit?: boolean }) => void;
  updateAudio: (id: string, patch: Partial<AudioProps>, opts?: { commit?: boolean }) => void;
  updateText: (id: string, patch: Partial<TextProps>, opts?: { commit?: boolean }) => void;
  removeClips: (ids: string[]) => void;
  splitClipAt: (id: string, time: number, opts?: { commit?: boolean; newLinkId?: string }) => void;
  splitSelectedAtPlayhead: () => void;
  duplicateClips: (ids: string[]) => void;
  moveClip: (id: string, start: number, trackId: string, opts?: { commit?: boolean; withLinked?: boolean }) => void;
  unlinkClips: (ids: string[]) => void;
  linkClips: (ids: string[]) => void;
  separateAudio: (id: string) => void;
  addAnimation: (clipId: string, seg: AnimationSegment) => void;
  addAnimations: (clipId: string, segs: AnimationSegment[]) => void;
  updateAnimation: (clipId: string, segId: string, patch: Partial<AnimationSegment>, opts?: { commit?: boolean }) => void;
  removeAnimation: (clipId: string, segId: string) => void;
  clearAnimations: (clipId: string) => void;
  splitAudioOnImport: boolean;
  setSplitAudioOnImport: (v: boolean) => void;
  /** Text clip currently open in the Title Studio modal. */
  titleStudioClipId: string | null;
  setTitleStudio: (clipId: string | null) => void;
  trimClip: (id: string, edge: 'start' | 'end', delta: number, opts?: { commit?: boolean }) => void;

  // --- history
  commit: () => void;          // push current state onto undo stack (call BEFORE mutating, via helpers)
  undo: () => void;
  redo: () => void;

  // --- ui
  setCurrentTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  select: (ids: string[], additive?: boolean) => void;
  setPixelsPerSecond: (pps: number) => void;
  toggleSnapping: () => void;
  setExportOpen: (open: boolean) => void;
}

export const MIN_CLIP = 0.1;

export function projectDuration(p: Project): number {
  return p.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}

export const useProject = create<EditorState>((set, get) => {
  const snapshot = (): Snapshot => {
    const { tracks, clips, assets } = get().project;
    return { tracks, clips, assets };
  };
  /** Apply a mutation to the project, optionally recording undo history. */
  const mutate = (fn: (p: Project) => Partial<Project>, commit = true) => {
    const s = get();
    const patch = fn(s.project);
    if (Object.keys(patch).length === 0) return; // no-op: don't dirty or record history
    set({
      project: { ...s.project, ...patch },
      dirty: true,
      ...(commit ? { past: [...s.past.slice(-99), snapshot()], future: [] } : {}),
    });
  };
  const clipsOf = (p: Project, ids: string[]) => p.clips.filter((c) => ids.includes(c.id));

  const findFreeStart = (p: Project, trackId: string, duration: number, preferred: number) => {
    // Shift right until the clip doesn't overlap anything on this track.
    const others = p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
    let start = Math.max(0, preferred);
    for (let guard = 0; guard < 500; guard++) {
      const hit = others.find((o) => o.start < start + duration && o.start + o.duration > start);
      if (!hit) break;
      start = hit.start + hit.duration;
    }
    return start;
  };

  const pickTrack = (p: Project, kind: TrackKind, explicit?: string) => {
    if (explicit) {
      const t = p.tracks.find((t) => t.id === explicit);
      if (t && t.kind === kind) return t;
    }
    return p.tracks.find((t) => t.kind === kind) ?? null;
  };

  return {
    project: newProject(),
    projectPath: null,
    dirty: false,
    currentTime: 0,
    playing: false,
    selectedClipIds: [],
    pixelsPerSecond: 60,
    snapping: true,
    exportOpen: false,
    workspace: 'video',
    splitAudioOnImport: true,
    past: [],
    future: [],

    setProject: (p, path = null) => set({ project: p, projectPath: path, dirty: false, past: [], future: [], selectedClipIds: [], currentTime: 0, playing: false }),
    resetProject: () => set({ project: newProject(), projectPath: null, dirty: false, past: [], future: [], selectedClipIds: [], currentTime: 0, playing: false }),
    setProjectPath: (p) => set({ projectPath: p }),
    markSaved: () => set({ dirty: false }),
    updateProjectSettings: (patch) => mutate(() => patch, false),
    addFont: (font) => mutate((p) => ({ fonts: [...(p.fonts ?? []).filter((f) => f.family !== font.family), font] }), false),

    addAssets: (assets) => mutate((p) => ({ assets: [...p.assets, ...assets] }), false),
    // Asset metadata (thumbnails, waveforms) is derived data: don't mark the project dirty.
    updateAsset: (id, patch) => set((s) => ({ project: { ...s.project, assets: s.project.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) } })),
    removeAsset: (id) => mutate((p) => ({
      assets: p.assets.filter((a) => a.id !== id),
      clips: p.clips.filter((c) => !('assetId' in c) || c.assetId !== id),
    })),

    addTrack: (kind) => mutate((p) => {
      const n = p.tracks.filter((t) => t.kind === kind).length + 1;
      const t = newTrack(kind, n);
      // Keep video tracks first (bottom->top), audio tracks after.
      const tracks = kind === 'video'
        ? [...p.tracks.filter((t) => t.kind === 'video'), t, ...p.tracks.filter((t) => t.kind === 'audio')]
        : [...p.tracks, t];
      return { tracks };
    }),
    removeTrack: (id) => mutate((p) => ({
      tracks: p.tracks.filter((t) => t.id !== id),
      clips: p.clips.filter((c) => c.trackId !== id),
    })),
    updateTrack: (id, patch) => mutate((p) => ({ tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), false),
    moveTrack: (id, dir) => mutate((p) => {
      const i = p.tracks.findIndex((t) => t.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.tracks.length || p.tracks[j].kind !== p.tracks[i].kind) return {};
      const tracks = [...p.tracks];
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
      return { tracks };
    }),

    addClipFromAsset: (assetId, opts = {}) => {
      const p = get().project;
      const asset = p.assets.find((a) => a.id === assetId);
      if (!asset) return null;
      const kind: TrackKind = asset.kind === 'audio' ? 'audio' : 'video';
      const track = pickTrack(p, kind, opts.trackId);
      if (!track) return null;
      const duration = asset.kind === 'image' ? 5 : Math.max(MIN_CLIP, asset.duration);
      const start = findFreeStart(p, track.id, duration, opts.start ?? projectDuration(p));
      const base = { id: uid(), trackId: track.id, name: asset.name, start, duration, inPoint: 0, speed: 1 };
      let clip: Clip;
      const extra: Clip[] = [];
      if (asset.kind === 'video') {
        clip = { ...base, type: 'video', assetId, transform: { ...DEFAULT_TRANSFORM }, effects: { ...DEFAULT_EFFECTS }, audio: { ...DEFAULT_AUDIO }, fadeIn: 0, fadeOut: 0 };
        // Put the sound on its own (linked) audio clip so video and audio can be edited separately.
        const audioTrack = pickTrack(p, 'audio');
        if (asset.hasAudio && get().splitAudioOnImport && audioTrack) {
          const linkId = uid();
          clip.linkId = linkId;
          clip.audio = { ...clip.audio, muted: true };
          const aStart = findFreeStart(p, audioTrack.id, duration, start);
          extra.push({ id: uid(), trackId: audioTrack.id, type: 'audio', assetId, name: asset.name, start: aStart, duration, inPoint: 0, speed: 1, linkId, audio: { ...DEFAULT_AUDIO } });
        }
      } else if (asset.kind === 'image') {
        clip = { ...base, type: 'image', assetId, transform: { ...DEFAULT_TRANSFORM }, effects: { ...DEFAULT_EFFECTS }, fadeIn: 0, fadeOut: 0 };
      } else {
        clip = { ...base, type: 'audio', assetId, audio: { ...DEFAULT_AUDIO } };
      }
      mutate((p) => ({ clips: [...p.clips, clip, ...extra] }));
      set({ selectedClipIds: [clip.id, ...extra.map((c) => c.id)] });
      return clip.id;
    },

    addTextClip: (opts = {}) => {
      const p = get().project;
      let track = pickTrack(p, 'video', opts.trackId);
      // Prefer the top-most video track for titles.
      if (!opts.trackId) track = [...p.tracks].reverse().find((t) => t.kind === 'video') ?? track;
      if (!track) {
        get().addTrack('video');
        track = get().project.tracks.find((t) => t.kind === 'video')!;
      }
      const duration = opts.duration ?? 5;
      const start = findFreeStart(get().project, track.id, duration, opts.start ?? get().currentTime);
      const text: TextProps = { ...DEFAULT_TEXT, ...opts.text };
      const clip: Clip = {
        id: uid(), trackId: track.id, type: 'text', name: text.content.split('\n')[0].slice(0, 30) || 'Text',
        start, duration, inPoint: 0, speed: 1, text, transform: { ...DEFAULT_TRANSFORM }, fadeIn: 0.5, fadeOut: 0.5,
      };
      mutate((p) => ({ clips: [...p.clips, clip] }));
      set({ selectedClipIds: [clip.id] });
      return clip.id;
    },

    updateClip: (id, patch, opts) => mutate((p) => ({ clips: p.clips.map((c) => (c.id === id ? ({ ...c, ...patch } as Clip) : c)) }), opts?.commit ?? true),
    updateClips: (ids, fn, opts) => mutate((p) => ({ clips: p.clips.map((c) => (ids.includes(c.id) ? ({ ...c, ...fn(c) } as Clip) : c)) }), opts?.commit ?? true),
    updateTransform: (id, patch, opts) => mutate((p) => ({
      clips: p.clips.map((c) => (c.id === id && isVisual(c) ? { ...c, transform: { ...c.transform, ...patch } } : c)),
    }), opts?.commit ?? true),
    updateEffects: (id, patch, opts) => mutate((p) => ({
      clips: p.clips.map((c) => (c.id === id && (c.type === 'video' || c.type === 'image') ? { ...c, effects: { ...c.effects, ...patch } } : c)),
    }), opts?.commit ?? true),
    updateAudio: (id, patch, opts) => mutate((p) => ({
      clips: p.clips.map((c) => (c.id === id && (c.type === 'video' || c.type === 'audio') ? { ...c, audio: { ...c.audio, ...patch } } : c)),
    }), opts?.commit ?? true),
    updateText: (id, patch, opts) => mutate((p) => ({
      clips: p.clips.map((c) => {
        if (c.id !== id || c.type !== 'text') return c;
        const text = { ...c.text, ...patch };
        const name = patch.content !== undefined ? (text.content.split('\n')[0].slice(0, 30) || 'Text') : c.name;
        return { ...c, text, name };
      }),
    }), opts?.commit ?? true),

    removeClips: (ids) => {
      mutate((p) => ({ clips: p.clips.filter((c) => !ids.includes(c.id)) }));
      set((s) => ({ selectedClipIds: s.selectedClipIds.filter((i) => !ids.includes(i)) }));
    },

    splitClipAt: (id, time, opts) => mutate((p) => {
      const c = p.clips.find((c) => c.id === id);
      if (!c) return {};
      const local = time - c.start;
      if (local <= MIN_CLIP || local >= c.duration - MIN_CLIP) return {};
      const left: Clip = { ...c, duration: local };
      // the right half gets a new link id (shared by the right halves of its linked partners)
      const right: Clip = { ...c, id: uid(), start: time, duration: c.duration - local, inPoint: c.inPoint + local * c.speed, linkId: c.linkId ? opts?.newLinkId ?? uid() : undefined };
      // Animations: keep the ones overlapping each half, shifted for the right half.
      if (c.animations?.length) {
        left.animations = c.animations.filter((a) => a.start < local).map((a) => ({ ...a, end: Math.min(a.end, local) }));
        right.animations = c.animations.filter((a) => a.end > local).map((a) => ({ ...a, start: Math.max(0, a.start - local), end: a.end - local }));
      }
      // Fades: left keeps fade-in, right keeps fade-out.
      if (isVisual(left)) { (left as any).fadeOut = 0; (right as any).fadeIn = 0; }
      if ('audio' in left) { left.audio = { ...left.audio, fadeOut: 0 }; (right as any).audio = { ...(right as any).audio, fadeIn: 0 }; }
      return { clips: p.clips.flatMap((x) => (x.id === id ? [left, right] : [x])) };
    }, opts?.commit ?? true),

    splitSelectedAtPlayhead: () => {
      const { selectedClipIds, currentTime, project } = get();
      const targets = selectedClipIds.length
        ? clipsOf(project, selectedClipIds)
        : project.clips.filter((c) => c.start < currentTime && c.start + c.duration > currentTime);
      const splittable = targets.filter((c) => currentTime - c.start > MIN_CLIP && c.start + c.duration - currentTime > MIN_CLIP);
      if (!splittable.length) return;
      get().commit();
      const newLinks = new Map<string, string>();
      for (const c of splittable) {
        let newLinkId: string | undefined;
        if (c.linkId) { newLinkId = newLinks.get(c.linkId) ?? uid(); newLinks.set(c.linkId, newLinkId); }
        get().splitClipAt(c.id, currentTime, { commit: false, newLinkId });
      }
    },

    duplicateClips: (ids) => {
      const newIds: string[] = [];
      mutate((p) => {
        let working: Project = p;
        const copies: Clip[] = [];
        const newLinks = new Map<string, string>(); // copies stay linked to each other, not to the originals
        for (const c of clipsOf(p, ids)) {
          let linkId: string | undefined;
          if (c.linkId) { linkId = newLinks.get(c.linkId) ?? uid(); newLinks.set(c.linkId, linkId); }
          const copy: Clip = { ...c, id: uid(), linkId, start: findFreeStart(working, c.trackId, c.duration, c.start + c.duration) };
          newIds.push(copy.id);
          copies.push(copy);
          working = { ...working, clips: [...working.clips, copy] };
        }
        return { clips: [...p.clips, ...copies] };
      });
      set({ selectedClipIds: newIds });
    },

    moveClip: (id, start, trackId, opts) => mutate((p) => {
      const c = p.clips.find((c) => c.id === id);
      const t = p.tracks.find((t) => t.id === trackId);
      if (!c || !t) return {};
      const wantKind: TrackKind = c.type === 'audio' ? 'audio' : 'video';
      if (t.kind !== wantKind) trackId = c.trackId;
      const withLinked = opts?.withLinked ?? true;
      const group = withLinked && c.linkId ? p.clips.filter((x) => x.linkId === c.linkId) : [c];
      // keep linked clips at a constant offset: no member of the group may go before 0
      const minStart = Math.min(...group.map((x) => x.start));
      const delta = Math.max(start - c.start, -minStart);
      return {
        clips: p.clips.map((x) => {
          if (x.id === id) return { ...x, start: x.start + delta, trackId };
          if (group.length > 1 && x.linkId === c.linkId) return { ...x, start: x.start + delta };
          return x;
        }),
      };
    }, opts?.commit ?? true),

    unlinkClips: (ids) => mutate((p) => ({ clips: p.clips.map((x) => (ids.includes(x.id) ? { ...x, linkId: undefined } : x)) })),
    linkClips: (ids) => mutate((p) => {
      if (ids.length < 2) return {};
      const linkId = uid();
      return { clips: p.clips.map((x) => (ids.includes(x.id) ? { ...x, linkId } : x)) };
    }),
    separateAudio: (id) => {
      const p = get().project;
      const c = p.clips.find((c) => c.id === id);
      if (!c || c.type !== 'video') return;
      const asset = p.assets.find((a) => a.id === c.assetId);
      const audioTrack = pickTrack(p, 'audio');
      if (!asset?.hasAudio || !audioTrack) return;
      const linkId = c.linkId ?? uid();
      const aStart = findFreeStart(p, audioTrack.id, c.duration, c.start);
      const a: Clip = { id: uid(), trackId: audioTrack.id, type: 'audio', assetId: c.assetId, name: c.name, start: aStart, duration: c.duration, inPoint: c.inPoint, speed: c.speed, linkId, audio: { ...c.audio, muted: false } };
      mutate((p) => ({ clips: [...p.clips.map((x) => (x.id === id && x.type === 'video' ? { ...x, linkId, audio: { ...x.audio, muted: true } } : x)), a] }));
      set({ selectedClipIds: [id, a.id] });
    },

    addAnimation: (clipId, seg) => mutate((p) => ({ clips: p.clips.map((x) => (x.id === clipId ? { ...x, animations: [...(x.animations ?? []), seg] } : x)) })),
    addAnimations: (clipId, segs) => mutate((p) => ({ clips: p.clips.map((x) => (x.id === clipId ? { ...x, animations: [...(x.animations ?? []), ...segs] } : x)) })),
    updateAnimation: (clipId, segId, patch, opts) => mutate((p) => ({
      clips: p.clips.map((x) => (x.id === clipId ? { ...x, animations: (x.animations ?? []).map((s) => (s.id === segId ? { ...s, ...patch } : s)) } : x)),
    }), opts?.commit ?? true),
    removeAnimation: (clipId, segId) => mutate((p) => ({ clips: p.clips.map((x) => (x.id === clipId ? { ...x, animations: (x.animations ?? []).filter((s) => s.id !== segId) } : x)) })),
    clearAnimations: (clipId) => mutate((p) => ({ clips: p.clips.map((x) => (x.id === clipId ? { ...x, animations: [] } : x)) })),

    trimClip: (id, edge, delta, opts) => mutate((p) => {
      const c = p.clips.find((c) => c.id === id);
      if (!c) return {};
      const asset = 'assetId' in c ? p.assets.find((a) => a.id === c.assetId) : undefined;
      const maxSrc = asset && asset.kind !== 'image' ? asset.duration : Infinity;
      let { start, duration, inPoint } = c;
      if (edge === 'start') {
        let d = delta;
        d = Math.min(d, duration - MIN_CLIP);          // can't shrink below min
        d = Math.max(d, -start);                       // can't go before timeline 0
        if (maxSrc !== Infinity) d = Math.max(d, -inPoint / c.speed); // can't reveal before source start
        start += d; duration -= d; inPoint += d * c.speed;
      } else {
        let d = delta;
        d = Math.max(d, MIN_CLIP - duration);
        if (maxSrc !== Infinity) d = Math.min(d, (maxSrc - inPoint) / c.speed - duration);
        duration += d;
      }
      return { clips: p.clips.map((x) => (x.id === id ? { ...x, start, duration, inPoint } : x)) };
    }, opts?.commit ?? true),

    commit: () => set((s) => ({ past: [...s.past.slice(-99), snapshot()], future: [] })),
    undo: () => set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return {};
      return {
        past: s.past.slice(0, -1),
        future: [snapshot(), ...s.future],
        project: { ...s.project, ...prev },
        dirty: true,
        selectedClipIds: s.selectedClipIds.filter((id) => prev.clips.some((c) => c.id === id)),
      };
    }),
    redo: () => set((s) => {
      const next = s.future[0];
      if (!next) return {};
      return {
        past: [...s.past, snapshot()],
        future: s.future.slice(1),
        project: { ...s.project, ...next },
        dirty: true,
        selectedClipIds: s.selectedClipIds.filter((id) => next.clips.some((c) => c.id === id)),
      };
    }),

    setCurrentTime: (t) => set({ currentTime: Math.max(0, t) }),
    setPlaying: (playing) => set({ playing }),
    togglePlay: () => set((s) => {
      if (!s.playing && s.currentTime >= projectDuration(s.project) - 0.01) return { playing: true, currentTime: 0 };
      return { playing: !s.playing };
    }),
    select: (ids, additive) => set((s) => {
      // Selecting a clip also selects the clips linked to it (e.g. its separated audio).
      const links = new Set(s.project.clips.filter((c) => ids.includes(c.id) && c.linkId).map((c) => c.linkId!));
      const full = [...ids, ...s.project.clips.filter((c) => c.linkId && links.has(c.linkId) && !ids.includes(c.id)).map((c) => c.id)];
      return {
        selectedClipIds: additive
          ? [...s.selectedClipIds.filter((i) => !full.includes(i)), ...full.filter((i) => !s.selectedClipIds.includes(i))]
          : full,
      };
    }),
    setPixelsPerSecond: (pps) => set({ pixelsPerSecond: Math.min(600, Math.max(5, pps)) }),
    toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
    setExportOpen: (exportOpen) => set({ exportOpen }),
    setWorkspace: (workspace) => set({ workspace, playing: false }),
    setSplitAudioOnImport: (splitAudioOnImport) => set({ splitAudioOnImport }),
    titleStudioClipId: null,
    setTitleStudio: (titleStudioClipId) => set({ titleStudioClipId }),
  };
});
