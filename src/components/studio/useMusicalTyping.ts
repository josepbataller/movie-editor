import { useEffect } from 'react';
import { useStudio } from '@/store/useStudio';
import { useProject } from '@/store/useProject';
import { getEngine } from '@/engine/audio/engine';
import { DRUM_NOTES, PatternClip, secondsToBeats } from '@/shared/audioTypes';

// "Musical typing": the computer keyboard plays the selected instrument track —
// two rows like a piano (A W S E D F T G Y H U J K O L P ; ' for white/black keys),
// Z / X shift the octave, 1-9 set velocity. With Step input on, each key also writes a
// note into the open pattern at the step cursor and advances it; while playing with the
// track armed, notes are recorded live into the pattern under the playhead.

export const TYPING_KEYS = 'awsedftgyhujkolp;\'';   // semitone index = position (A = C of the base octave)
const DRUM_KEYS = 'asdfghjkqwertyui';                 // drum pads left to right

export function useMusicalTyping() {
  useEffect(() => {
    const down = new Map<string, number>();     // key -> pitch
    // step input: notes being held, extended while the key stays down (at tempo, quantised to the grid)
    const stepHeld = new Map<number, { noteId: string; clipId: string; start: number; t0: number; maxLen: number }>();
    let stepTimer: number | null = null;
    const tickStep = () => {
      const st = useStudio.getState();
      const grid = st.gridDivision;
      for (const h of stepHeld.values()) {
        const heldBeats = secondsToBeats((performance.now() - h.t0) / 1000, st.session.bpm);
        const len = Math.max(st.stepLength, Math.ceil(heldBeats / grid) * grid);
        const clip = st.session.clips.find((c) => c.id === h.clipId) as PatternClip | undefined;
        if (!clip) continue;
        const capped = Math.min(len, clip.lengthBeats - h.start);
        if (capped > h.maxLen + 1e-6) { h.maxLen = capped; st.updateNote(h.clipId, h.noteId, { length: capped }, { commit: false }); }
      }
      if (stepHeld.size === 0 && stepTimer != null) { window.clearInterval(stepTimer); stepTimer = null; }
    };
    const liveStarts = new Map<number, { beat: number; clipId: string; velocity: number }>();
    let velocity = 0.85;
    const engine = getEngine();

    const target = () => {
      const st = useStudio.getState();
      if (useProject.getState().workspace !== 'audio') return null;
      // the open pattern's track wins; otherwise the selected instrument track
      const editing = st.editorClipId ? st.session.clips.find((c) => c.id === st.editorClipId) : null;
      const trackId = editing?.trackId ?? st.selectedTrackId;
      const track = st.session.tracks.find((t) => t.id === trackId);
      if (!track || track.kind !== 'instrument' || !track.instrument) return null;
      return { track, editing: editing && editing.type === 'pattern' ? editing : null };
    };

    const pitchFor = (key: string, drums: boolean): number | null => {
      const st = useStudio.getState();
      if (drums) { const i = DRUM_KEYS.indexOf(key); return i >= 0 && i < DRUM_NOTES.length ? DRUM_NOTES[i].note : null; }
      const i = TYPING_KEYS.indexOf(key);
      return i >= 0 ? 12 * (st.keyboardOctave + 1) + i : null;
    };

    /** Pattern clip on the track under the playhead (created when recording live into an empty spot). */
    const patternAtPlayhead = (trackId: string, create: boolean): PatternClip | null => {
      const st = useStudio.getState();
      const t = st.currentTime;
      const hit = st.session.clips.find((c) => c.type === 'pattern' && c.trackId === trackId && c.start <= t && t < c.start + c.duration) as PatternClip | undefined;
      if (hit || !create) return hit ?? null;
      const bar = (60 / st.session.bpm) * st.session.beatsPerBar;
      const start = Math.floor(t / bar) * bar;
      const id = st.addPatternClip(trackId, start, st.session.beatsPerBar * 4);
      return (useStudio.getState().session.clips.find((c) => c.id === id) as PatternClip | undefined) ?? null;
    };

    const onDown = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const st = useStudio.getState();
      const key = e.key.toLowerCase();
      if (key === 'z') { st.setKeyboardOctave(st.keyboardOctave - 1); return; }
      if (key === 'x') { st.setKeyboardOctave(st.keyboardOctave + 1); return; }
      if (key === '[') { st.setStepLength(st.stepLength / 2); return; }
      if (key === ']') { st.setStepLength(st.stepLength * 2); return; }
      if (/^[1-9]$/.test(key)) { velocity = Number(key) / 9; return; }
      const tg = target();
      if (!tg) return;
      const drums = tg.track.instrument!.kind === 'drums';
      const pitch = pitchFor(key, drums);
      if (pitch == null) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // keep studio shortcuts (S, L, K, M…) from firing, also on auto-repeat
      if (e.repeat || down.has(key)) return;
      down.set(key, pitch);
      void engine.noteOn(tg.track.id, pitch, velocity);

      // ---- writing notes ----
      const grid = st.gridDivision;
      if (st.playing && st.armedTrackId === tg.track.id) {
        // live recording: note starts now, length set on key-up
        const clip = patternAtPlayhead(tg.track.id, true);
        if (clip) {
          const beat = secondsToBeats(useStudio.getState().currentTime - clip.start, st.session.bpm);
          const q = st.snapToGrid ? Math.round(beat / grid) * grid : beat;
          liveStarts.set(pitch, { beat: Math.max(0, q), clipId: clip.id, velocity });
        }
      } else if (st.stepInput && tg.editing) {
        const clip = tg.editing;
        if (st.stepCursor + 1e-6 < clip.lengthBeats) {
          const len = Math.min(st.stepLength, clip.lengthBeats - st.stepCursor);
          const noteId = st.addNote(clip.id, { pitch, start: st.stepCursor, length: len, velocity });
          // holding the key extends the note at tempo; keys pressed together form a chord on the same step
          stepHeld.set(pitch, { noteId, clipId: clip.id, start: st.stepCursor, t0: performance.now(), maxLen: len });
          if (stepTimer == null) stepTimer = window.setInterval(tickStep, 30);
        }
      }
    };

    const onUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const pitch = down.get(key);
      if (pitch == null) return;
      down.delete(key);
      const st = useStudio.getState();
      const tg = target();
      if (tg) engine.noteOff(tg.track.id, pitch);
      const live = liveStarts.get(pitch);
      if (live) {
        liveStarts.delete(pitch);
        const clip = st.session.clips.find((c) => c.id === live.clipId) as PatternClip | undefined;
        if (clip) {
          const endBeat = secondsToBeats(st.currentTime - clip.start, st.session.bpm);
          const grid = st.gridDivision;
          const rawLen = Math.max(grid, endBeat - live.beat);
          const length = st.snapToGrid ? Math.max(grid, Math.round(rawLen / grid) * grid) : rawLen;
          st.addNote(clip.id, { pitch, start: live.beat, length: Math.min(length, clip.lengthBeats - live.beat), velocity: live.velocity });
        }
      } else if (st.stepInput && tg?.editing) {
        stepHeld.delete(pitch);
        if (down.size === 0) {
          // all keys released: advance the cursor by the longest note of the chord just written
          const written = st.session.clips.find((c) => c.id === tg.editing!.id) as PatternClip | undefined;
          const atCursor = written?.notes.filter((n) => Math.abs(n.start - st.stepCursor) < 1e-6) ?? [];
          const adv = atCursor.length ? Math.max(...atCursor.map((n) => n.length)) : st.stepLength;
          st.setStepCursor(Math.min(tg.editing.lengthBeats, st.stepCursor + adv));
        }
      }
    };
    const releaseAll = () => { const tg = target(); for (const [, p] of down) if (tg) engine.noteOff(tg.track.id, p); down.clear(); liveStarts.clear(); stepHeld.clear(); };

    // capture phase so we run before the studio shortcut handler
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', releaseAll);
    return () => { window.removeEventListener('keydown', onDown, true); window.removeEventListener('keyup', onUp, true); window.removeEventListener('blur', releaseAll); releaseAll(); };
  }, []);
}

