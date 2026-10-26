import { create } from 'zustand';
import {
  AudioSession, StudioTrack, StudioClip, SampleClip, PatternClip, NoteEvent, AudioEffect, AudioEffectType,
  InstrumentSettings, StudioTrackKind, defaultSession, defaultEffect, uidA, TRACK_COLORS, beatsToSeconds, secondsToBeats,
} from '@/shared/audioTypes';
import { DRUM_KITS, SYNTH_PRESETS } from '@/engine/audio/presets';

// Audio Studio store: the DAW session (persisted in the project file as `project.audio`),
// its undo history, and transient UI state. Mirrors the conventions of useProject:
// every mutation goes through mutate(); pass { commit: false } during gestures.

export const MIN_CLIP = 0.05;

interface StudioState {
  session: AudioSession;
  dirty: boolean;
  past: AudioSession[];
  future: AudioSession[];

  // transient
  currentTime: number;
  playing: boolean;
  selectedClipIds: string[];
  selectedTrackId: string | null;
  pixelsPerSecond: number;
  snapToGrid: boolean;
  gridDivision: number;      // beats per grid step (1 = quarter, 0.25 = sixteenth)
  editorClipId: string | null;   // pattern clip open in the piano roll / step sequencer
  fxPanelTrackId: string | null | 'master';
  recordArmed: boolean;
  previewNote: { trackId: string; pitch: number } | null;

  setSession: (s: AudioSession | undefined) => void;
  reset: () => void;
  markSaved: () => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;

  // session settings
  setBpm: (bpm: number) => void;
  setMasterGain: (g: number, opts?: { commit?: boolean }) => void;
  setLoop: (patch: Partial<AudioSession['loop']>) => void;
  toggleMetronome: () => void;

  // tracks
  addTrack: (kind: StudioTrackKind, instrument?: InstrumentSettings) => string;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, patch: Partial<StudioTrack>, opts?: { commit?: boolean }) => void;
  moveTrack: (id: string, dir: -1 | 1) => void;
  setInstrument: (trackId: string, instrument: InstrumentSettings) => void;
  updateInstrument: (trackId: string, patch: Partial<InstrumentSettings>, opts?: { commit?: boolean }) => void;

  // clips
  addSampleClip: (trackId: string, assetId: string, name: string, start: number, duration: number) => string;
  addPatternClip: (trackId: string, start: number, lengthBeats?: number) => string;
  updateClip: (id: string, patch: Partial<StudioClip>, opts?: { commit?: boolean }) => void;
  moveClip: (id: string, start: number, trackId: string, opts?: { commit?: boolean }) => void;
  trimClip: (id: string, edge: 'start' | 'end', delta: number, srcDuration: number | null, opts?: { commit?: boolean }) => void;
  splitClipAt: (id: string, time: number) => void;
  splitSelectedAtPlayhead: () => void;
  duplicateClips: (ids: string[]) => void;
  removeClips: (ids: string[]) => void;

  // notes (pattern clips)
  addNote: (clipId: string, note: Omit<NoteEvent, 'id'>) => string;
  updateNote: (clipId: string, noteId: string, patch: Partial<NoteEvent>, opts?: { commit?: boolean }) => void;
  removeNotes: (clipId: string, noteIds: string[]) => void;
  setNotes: (clipId: string, notes: NoteEvent[]) => void;

  // effects
  addEffect: (target: string | 'master', type: AudioEffectType) => void;
  updateEffect: (target: string | 'master', effectId: string, patch: Partial<AudioEffect>, opts?: { commit?: boolean }) => void;
  removeEffect: (target: string | 'master', effectId: string) => void;
  moveEffect: (target: string | 'master', effectId: string, dir: -1 | 1) => void;

  // ui
  setCurrentTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  select: (ids: string[], additive?: boolean) => void;
  selectTrack: (id: string | null) => void;
  setPixelsPerSecond: (pps: number) => void;
  toggleSnap: () => void;
  setGridDivision: (d: number) => void;
  openEditor: (clipId: string | null) => void;
  openFx: (target: string | null | 'master') => void;
  setPreviewNote: (n: { trackId: string; pitch: number } | null) => void;
}

/** Drop UI references to clips/tracks that no longer exist in `next`. */
function pruneUi(s: { selectedClipIds: string[]; editorClipId: string | null; fxPanelTrackId: string | null | 'master' }, next: AudioSession) {
  return {
    selectedClipIds: s.selectedClipIds.filter((id) => next.clips.some((c) => c.id === id)),
    editorClipId: s.editorClipId && next.clips.some((c) => c.id === s.editorClipId) ? s.editorClipId : null,
    fxPanelTrackId: s.fxPanelTrackId === 'master' || (s.fxPanelTrackId && next.tracks.some((t) => t.id === s.fxPanelTrackId)) ? s.fxPanelTrackId : null,
  };
}

export function sessionDuration(s: AudioSession): number {
  return s.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}

export const useStudio = create<StudioState>((set, get) => {
  const mutate = (fn: (s: AudioSession) => Partial<AudioSession>, commit = true) => {
    const st = get();
    const patch = fn(st.session);
    if (Object.keys(patch).length === 0) return;
    set({
      session: { ...st.session, ...patch },
      dirty: true,
      ...(commit ? { past: [...st.past.slice(-99), st.session], future: [] } : {}),
    });
  };
  const findFreeStart = (s: AudioSession, trackId: string, duration: number, preferred: number) => {
    const others = s.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
    let start = Math.max(0, preferred);
    for (let guard = 0; guard < 500; guard++) {
      const hit = others.find((o) => o.start < start + duration && o.start + o.duration > start);
      if (!hit) break;
      start = hit.start + hit.duration;
    }
    return start;
  };
  const effectsOf = (s: AudioSession, target: string | 'master') =>
    target === 'master' ? s.masterEffects : s.tracks.find((t) => t.id === target)?.effects ?? [];
  const withEffects = (s: AudioSession, target: string | 'master', effects: AudioEffect[]): Partial<AudioSession> =>
    target === 'master'
      ? { masterEffects: effects }
      : { tracks: s.tracks.map((t) => (t.id === target ? { ...t, effects } : t)) };

  return {
    session: defaultSession(),
    dirty: false,
    past: [],
    future: [],
    currentTime: 0,
    playing: false,
    selectedClipIds: [],
    selectedTrackId: null,
    pixelsPerSecond: 80,
    snapToGrid: true,
    gridDivision: 0.25,
    editorClipId: null,
    fxPanelTrackId: null,
    recordArmed: false,
    previewNote: null,

    setSession: (s) => set({ session: s ? { ...defaultSession(), ...s } : defaultSession(), dirty: false, past: [], future: [], selectedClipIds: [], editorClipId: null, fxPanelTrackId: null, currentTime: 0, playing: false }),
    reset: () => get().setSession(undefined),
    markSaved: () => set({ dirty: false }),
    commit: () => set((s) => ({ past: [...s.past.slice(-99), s.session], future: [] })),
    undo: () => set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return {};
      return { past: s.past.slice(0, -1), future: [s.session, ...s.future], session: prev, dirty: true, ...pruneUi(s, prev) };
    }),
    redo: () => set((s) => {
      const next = s.future[0];
      if (!next) return {};
      return { past: [...s.past, s.session], future: s.future.slice(1), session: next, dirty: true, ...pruneUi(s, next) };
    }),

    // Pattern clips live in beats: keep their timeline position/length musical when the tempo changes.
    setBpm: (bpm) => mutate((s) => {
      const nb = Math.min(300, Math.max(20, bpm));
      const k = s.bpm / nb;
      return { bpm: nb, clips: s.clips.map((c) => (c.type === 'pattern' ? { ...c, start: c.start * k, duration: beatsToSeconds(c.lengthBeats, nb) } : c)) };
    }),
    setMasterGain: (g, opts) => mutate(() => ({ masterGain: Math.min(2, Math.max(0, g)) }), opts?.commit ?? true),
    setLoop: (patch) => mutate((s) => ({ loop: { ...s.loop, ...patch } }), false),
    toggleMetronome: () => mutate((s) => ({ metronome: !s.metronome }), false),

    addTrack: (kind, instrument) => {
      const id = uidA();
      mutate((s) => {
        const n = s.tracks.length;
        const inst = kind === 'instrument' ? (instrument ?? SYNTH_PRESETS[0]) : undefined;
        const name = kind === 'instrument' ? inst!.name : `Audio ${s.tracks.filter((t) => t.kind === 'audio').length + 1}`;
        const t: StudioTrack = { id, kind, name, color: TRACK_COLORS[n % TRACK_COLORS.length], gain: 1, pan: 0, muted: false, solo: false, effects: [], instrument: inst, height: kind === 'audio' ? 84 : 72 };
        return { tracks: [...s.tracks, t] };
      });
      set({ selectedTrackId: id });
      return id;
    },
    removeTrack: (id) => {
      mutate((s) => ({ tracks: s.tracks.filter((t) => t.id !== id), clips: s.clips.filter((c) => c.trackId !== id) }));
      set((s) => ({ ...pruneUi(s, s.session), selectedTrackId: s.selectedTrackId === id ? null : s.selectedTrackId }));
    },
    updateTrack: (id, patch, opts) => mutate((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), opts?.commit ?? true),
    moveTrack: (id, dir) => mutate((s) => {
      const i = s.tracks.findIndex((t) => t.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.tracks.length) return {};
      const tracks = [...s.tracks];
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
      return { tracks };
    }),
    setInstrument: (trackId, instrument) => mutate((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, instrument: JSON.parse(JSON.stringify(instrument)), name: t.name === t.instrument?.name ? instrument.name : t.name } : t)),
    })),
    updateInstrument: (trackId, patch, opts) => mutate((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId && t.instrument ? { ...t, instrument: { ...t.instrument, ...patch } as InstrumentSettings } : t)),
    }), opts?.commit ?? true),

    addSampleClip: (trackId, assetId, name, start, duration) => {
      const id = uidA();
      mutate((s) => {
        const st = findFreeStart(s, trackId, duration, start);
        const clip: SampleClip = { id, type: 'sample', trackId, assetId, name, start: st, duration, inPoint: 0, gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: 'linear', rate: 1, reverse: false };
        return { clips: [...s.clips, clip] };
      });
      set({ selectedClipIds: [id] });
      return id;
    },
    addPatternClip: (trackId, start, lengthBeats = 16) => {
      const id = uidA();
      mutate((s) => {
        const duration = beatsToSeconds(lengthBeats, s.bpm);
        const st = findFreeStart(s, trackId, duration, start);
        const track = s.tracks.find((t) => t.id === trackId);
        const clip: PatternClip = { id, type: 'pattern', trackId, name: track?.instrument?.name ?? 'Pattern', start: st, duration, lengthBeats, notes: [], gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: 'linear' };
        return { clips: [...s.clips, clip] };
      });
      set({ selectedClipIds: [id] });
      return id;
    },
    updateClip: (id, patch, opts) => mutate((s) => ({ clips: s.clips.map((c) => (c.id === id ? ({ ...c, ...patch } as StudioClip) : c)) }), opts?.commit ?? true),
    moveClip: (id, start, trackId, opts) => mutate((s) => {
      const c = s.clips.find((c) => c.id === id);
      const t = s.tracks.find((t) => t.id === trackId);
      if (!c || !t) return {};
      // sample clips only on audio tracks, patterns only on instrument tracks
      if ((c.type === 'sample' && t.kind !== 'audio') || (c.type === 'pattern' && t.kind !== 'instrument')) trackId = c.trackId;
      return { clips: s.clips.map((x) => (x.id === id ? { ...x, start: Math.max(0, start), trackId } : x)) };
    }, opts?.commit ?? true),
    trimClip: (id, edge, delta, srcDuration, opts) => mutate((s) => {
      const c = s.clips.find((c) => c.id === id);
      if (!c) return {};
      let { start, duration } = c;
      let inPoint = c.type === 'sample' ? c.inPoint : 0;
      const rate = c.type === 'sample' ? c.rate : 1;
      if (edge === 'start') {
        let d = Math.min(delta, duration - MIN_CLIP);
        d = Math.max(d, -start);
        if (c.type === 'sample' && srcDuration != null) d = Math.max(d, -inPoint / rate);
        start += d; duration -= d; inPoint += d * rate;
      } else {
        let d = Math.max(delta, MIN_CLIP - duration);
        if (c.type === 'sample' && srcDuration != null) d = Math.min(d, (srcDuration - inPoint) / rate - duration);
        duration += d;
      }
      return {
        clips: s.clips.map((x) => {
          if (x.id !== id) return x;
          if (x.type === 'sample') return { ...x, start, duration, inPoint };
          // pattern: content is trimmed, not shifted — notes move by the removed beats
          const db = secondsToBeats(start - x.start, s.bpm);
          const lengthBeats = secondsToBeats(duration, s.bpm);
          const notes = x.notes
            .map((n) => ({ ...n, start: n.start - db }))
            .filter((n) => n.start + n.length > 1e-6 && n.start < lengthBeats - 1e-6)
            .map((n) => (n.start < 0 ? { ...n, length: n.length + n.start, start: 0 } : n));
          return { ...x, start, duration, lengthBeats, notes };
        }),
      };
    }, opts?.commit ?? true),
    splitClipAt: (id, time) => mutate((s) => {
      const c = s.clips.find((c) => c.id === id);
      if (!c) return {};
      const local = time - c.start;
      if (local <= MIN_CLIP || local >= c.duration - MIN_CLIP) return {};
      let left: StudioClip, right: StudioClip;
      if (c.type === 'sample') {
        left = { ...c, duration: local, fadeOut: 0 };
        right = { ...c, id: uidA(), start: time, duration: c.duration - local, inPoint: c.inPoint + local * c.rate, fadeIn: 0 };
      } else {
        const beatsLocal = (local * s.bpm) / 60;
        left = { ...c, duration: local, lengthBeats: beatsLocal, notes: c.notes.filter((n) => n.start < beatsLocal), fadeOut: 0 };
        right = { ...c, id: uidA(), start: time, duration: c.duration - local, lengthBeats: c.lengthBeats - beatsLocal,
          notes: c.notes.filter((n) => n.start >= beatsLocal).map((n) => ({ ...n, id: uidA(), start: n.start - beatsLocal })), fadeIn: 0 };
      }
      return { clips: s.clips.flatMap((x) => (x.id === id ? [left, right] : [x])) };
    }),
    splitSelectedAtPlayhead: () => {
      const { selectedClipIds, currentTime, session } = get();
      const targets = (selectedClipIds.length ? session.clips.filter((c) => selectedClipIds.includes(c.id)) : session.clips)
        .filter((c) => currentTime - c.start > MIN_CLIP && c.start + c.duration - currentTime > MIN_CLIP);
      if (!targets.length) return;
      get().commit();
      const before = get().past;
      for (const c of targets) get().splitClipAt(c.id, currentTime);
      set({ past: before }); // single undo step
    },
    duplicateClips: (ids) => {
      const newIds: string[] = [];
      mutate((s) => {
        let working = s;
        const copies: StudioClip[] = [];
        for (const c of s.clips.filter((c) => ids.includes(c.id))) {
          const copy = { ...c, id: uidA(), start: findFreeStart(working, c.trackId, c.duration, c.start + c.duration) } as StudioClip;
          if (copy.type === 'pattern') copy.notes = copy.notes.map((n) => ({ ...n, id: uidA() }));
          copies.push(copy); newIds.push(copy.id);
          working = { ...working, clips: [...working.clips, copy] };
        }
        return { clips: [...s.clips, ...copies] };
      });
      set({ selectedClipIds: newIds });
    },
    removeClips: (ids) => {
      mutate((s) => ({ clips: s.clips.filter((c) => !ids.includes(c.id)) }));
      set((s) => ({ selectedClipIds: s.selectedClipIds.filter((i) => !ids.includes(i)), editorClipId: ids.includes(s.editorClipId ?? '') ? null : s.editorClipId }));
    },

    addNote: (clipId, note) => {
      const id = uidA();
      mutate((s) => ({ clips: s.clips.map((c) => (c.id === clipId && c.type === 'pattern' ? { ...c, notes: [...c.notes, { ...note, id }] } : c)) }));
      return id;
    },
    updateNote: (clipId, noteId, patch, opts) => mutate((s) => ({
      clips: s.clips.map((c) => (c.id === clipId && c.type === 'pattern' ? { ...c, notes: c.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)) } : c)),
    }), opts?.commit ?? true),
    removeNotes: (clipId, noteIds) => mutate((s) => ({
      clips: s.clips.map((c) => (c.id === clipId && c.type === 'pattern' ? { ...c, notes: c.notes.filter((n) => !noteIds.includes(n.id)) } : c)),
    })),
    setNotes: (clipId, notes) => mutate((s) => ({ clips: s.clips.map((c) => (c.id === clipId && c.type === 'pattern' ? { ...c, notes } : c)) })),

    addEffect: (target, type) => mutate((s) => withEffects(s, target, [...effectsOf(s, target), defaultEffect(type)])),
    updateEffect: (target, effectId, patch, opts) => mutate((s) =>
      withEffects(s, target, effectsOf(s, target).map((e) => (e.id === effectId ? ({ ...e, ...patch } as AudioEffect) : e))), opts?.commit ?? true),
    removeEffect: (target, effectId) => mutate((s) => withEffects(s, target, effectsOf(s, target).filter((e) => e.id !== effectId))),
    moveEffect: (target, effectId, dir) => mutate((s) => {
      const list = [...effectsOf(s, target)];
      const i = list.findIndex((e) => e.id === effectId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return {};
      [list[i], list[j]] = [list[j], list[i]];
      return withEffects(s, target, list);
    }),

    setCurrentTime: (t) => set({ currentTime: Math.max(0, t) }),
    setPlaying: (playing) => set({ playing }),
    togglePlay: () => set((s) => {
      const end = sessionDuration(s.session);
      if (!s.playing && !s.session.loop.enabled && end > 0 && s.currentTime >= end - 0.01) return { playing: true, currentTime: 0 };
      return { playing: !s.playing };
    }),
    select: (ids, additive) => set((s) => ({
      selectedClipIds: additive
        ? [...s.selectedClipIds.filter((i) => !ids.includes(i)), ...ids.filter((i) => !s.selectedClipIds.includes(i))]
        : ids,
      selectedTrackId: ids.length ? (s.session.clips.find((c) => c.id === ids[0])?.trackId ?? s.selectedTrackId) : s.selectedTrackId,
    })),
    selectTrack: (selectedTrackId) => set({ selectedTrackId }),
    setPixelsPerSecond: (pps) => set({ pixelsPerSecond: Math.min(800, Math.max(8, pps)) }),
    toggleSnap: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
    setGridDivision: (gridDivision) => set({ gridDivision }),
    openEditor: (editorClipId) => set({ editorClipId }),
    openFx: (fxPanelTrackId) => set({ fxPanelTrackId }),
    setPreviewNote: (previewNote) => set({ previewNote }),
  };
});

export { DRUM_KITS, SYNTH_PRESETS };
