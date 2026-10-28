import { useProject } from '@/store/useProject';
import { useStudio } from '@/store/useStudio';
import { getEngine } from '@/engine/audio/engine';
import { applyClipOp, describeOp, ClipOp } from '@/engine/audio/clipOps';
import { addAssetToStudio, sendMixToVideo, openClipInStudio } from '@/engine/audio/bridge';
import { instrumentByName, ALL_INSTRUMENTS } from '@/engine/audio/presets';
import { ANIMATION_PRESETS, newSegment } from '@/engine/video/animation';
import { AudioEffect, AudioEffectType, EqBand, NoteEvent, defaultEffect, uidA, noteName, DRUM_NOTES, beatsToSeconds, secondsToBeats } from '@/shared/audioTypes';
import { AnimatableProperty, DEFAULT_TEXT, TextProps, fittedSize } from '@/shared/types';

// Tools the assistant can call. Each tool has a JSON schema (for the model) and an
// executor that works through the same store actions the UI uses, so everything it
// does is visible, undoable and saved with the project.

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; run: (args: any) => Promise<string> | string }

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const num = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'number', description, ...extra });
const bool = (description: string) => ({ type: 'boolean', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const arr = (items: unknown, description: string) => ({ type: 'array', items, description });

const r2 = (n: number) => Math.round(n * 100) / 100;
const ok = (msg: string) => `OK: ${msg}`;

// ---------------------------------------------------------------------------
// helpers over the stores
// ---------------------------------------------------------------------------

function studio() { return useStudio.getState(); }
function video() { return useProject.getState(); }

function findTrack(ref: string) {
  const s = studio().session;
  const t = s.tracks.find((t) => t.id === ref) ?? s.tracks.find((t) => t.name.toLowerCase() === ref.toLowerCase()) ?? s.tracks.find((t) => t.name.toLowerCase().includes(ref.toLowerCase()));
  if (!t) throw new Error(`No studio track matches "${ref}". Call get_state to see ids.`);
  return t;
}
function findStudioClip(ref: string) {
  const s = studio().session;
  const c = s.clips.find((c) => c.id === ref) ?? s.clips.find((c) => c.name.toLowerCase() === ref.toLowerCase()) ?? s.clips.find((c) => c.name.toLowerCase().includes(ref.toLowerCase()));
  if (!c) throw new Error(`No studio clip matches "${ref}". Call get_state to see ids.`);
  return c;
}
function findVideoClip(ref: string) {
  const p = video().project;
  const c = p.clips.find((c) => c.id === ref) ?? p.clips.find((c) => c.name.toLowerCase() === ref.toLowerCase()) ?? p.clips.find((c) => c.name.toLowerCase().includes(ref.toLowerCase()));
  if (!c) throw new Error(`No video clip matches "${ref}". Call get_state to see ids.`);
  return c;
}
function findAsset(ref: string) {
  const p = video().project;
  const a = p.assets.find((a) => a.id === ref) ?? p.assets.find((a) => a.name.toLowerCase() === ref.toLowerCase()) ?? p.assets.find((a) => a.name.toLowerCase().includes(ref.toLowerCase()));
  if (!a) throw new Error(`No media file matches "${ref}". Call get_state to see the media library.`);
  return a;
}
function effectTarget(ref: string): string | 'master' {
  if (ref === 'master') return 'master';
  const s = studio().session;
  if (s.tracks.some((t) => t.id === ref) || s.clips.some((c) => c.id === ref)) return ref;
  const t = s.tracks.find((t) => t.name.toLowerCase().includes(ref.toLowerCase()));
  if (t) return t.id;
  const c = s.clips.find((c) => c.name.toLowerCase().includes(ref.toLowerCase()));
  if (c) return c.id;
  throw new Error(`No track/clip matches "${ref}"`);
}
function effectsOf(target: string | 'master'): AudioEffect[] {
  const s = studio().session;
  if (target === 'master') return s.masterEffects;
  const t = s.tracks.find((t) => t.id === target);
  if (t) return t.effects;
  const c = s.clips.find((c) => c.id === target);
  return c && c.type === 'sample' ? c.effects ?? [] : [];
}
/** "C4", "F#3", "Bb2" or a MIDI number -> MIDI pitch. */
function parsePitch(p: string | number): number {
  if (typeof p === 'number') return Math.round(p);
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(p.trim());
  if (!m) { const d = DRUM_NOTES.find((d) => d.name.toLowerCase() === p.toLowerCase() || d.short.toLowerCase() === p.toLowerCase()); if (d) return d.note; throw new Error(`Bad note "${p}" (use e.g. C4, F#3, or a MIDI number)`); }
  const base: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  return 12 * (Number(m[3]) + 1) + base[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

// ---------------------------------------------------------------------------
// state summary
// ---------------------------------------------------------------------------

export function stateSummary(): string {
  const p = video().project;
  const s = studio().session;
  const v = video();
  const lines: string[] = [];
  lines.push(`workspace: ${v.workspace} | project "${p.name}" ${p.width}x${p.height}@${p.fps}fps | video playhead ${r2(v.currentTime)}s`);
  lines.push(`media (${p.assets.length}): ` + p.assets.map((a) => `[${a.id}] ${a.name} (${a.kind}${a.duration ? ` ${r2(a.duration)}s` : ''})`).join('; '));
  lines.push(`VIDEO tracks: ` + p.tracks.map((t) => `[${t.id}] ${t.name} (${t.kind}${t.muted ? ' muted' : ''}${t.hidden ? ' hidden' : ''})`).join('; '));
  lines.push(`VIDEO clips (${p.clips.length}):`);
  for (const c of p.clips) {
    const extra = c.type === 'text' ? ` text="${c.text.content.slice(0, 40).replace(/\n/g, ' / ')}" anim=${c.text.animation}` : c.type !== 'audio' ? ` fit=${c.transform.fit} scale=${r2(c.transform.scale)} pos=(${c.transform.x},${c.transform.y}) rot=${c.transform.rotation}` : '';
    lines.push(`  [${c.id}] ${c.type} "${c.name}" track=${c.trackId} ${r2(c.start)}s→${r2(c.start + c.duration)}s${'assetId' in c ? ` asset=${c.assetId}` : ''}${extra}${c.animations?.length ? ` animations=${c.animations.length}` : ''}`);
  }
  lines.push(`AUDIO STUDIO: ${s.bpm} bpm, ${s.beatsPerBar}/4, loop ${s.loop.enabled ? `${r2(s.loop.start)}–${r2(s.loop.end)}s` : 'off'}, playhead ${r2(studio().currentTime)}s, master fx: ${s.masterEffects.map((e) => `[${e.id}] ${e.type}`).join(', ') || 'none'}`);
  lines.push(`STUDIO tracks (${s.tracks.length}):`);
  for (const t of s.tracks) {
    lines.push(`  [${t.id}] ${t.name} (${t.kind}${t.instrument ? `: ${t.instrument.name}` : ''}) gain=${r2(t.gain)} pan=${r2(t.pan)}${t.muted ? ' muted' : ''}${t.solo ? ' solo' : ''} fx=[${t.effects.map((e) => `${e.id}:${e.type}${e.enabled ? '' : '(off)'}`).join(', ')}]`);
  }
  lines.push(`STUDIO clips (${s.clips.length}):`);
  for (const c of s.clips) {
    const d = c.type === 'sample' ? ` asset=${c.assetId} inPoint=${r2(c.inPoint)} rate=${c.rate}${c.reverse ? ' reversed' : ''} fades=${c.fadeIn}/${c.fadeOut} fx=[${(c.effects ?? []).map((e) => `${e.id}:${e.type}`).join(', ')}]` : ` ${c.lengthBeats} beats, ${c.notes.length} notes`;
    lines.push(`  [${c.id}] ${c.type} "${c.name}" track=${c.trackId} ${r2(c.start)}s→${r2(c.start + c.duration)}s gain=${c.gain}${d}`);
  }
  lines.push(`instruments available: ${ALL_INSTRUMENTS.map((i) => i.name).join(', ')}`);
  lines.push(`effect types: eq, filter, compressor, reverb, delay, chorus, distortion, bitcrusher. Animation presets: ${ANIMATION_PRESETS.map((p) => p.id).join(', ')}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// tool definitions
// ---------------------------------------------------------------------------

const EQ_BAND = obj({
  type: str('Band type', { enum: ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'notch'] }),
  frequency: num('Hz'), gain: num('dB (peaking / shelf only)'), q: num('Width/resonance, 0.1–30 (default 1)'),
}, ['type', 'frequency']);

const NOTE = obj({
  pitch: { description: 'Note name like "C4", "F#3" (drums: "Kick", "Snare", "Closed hi-hat"…) or MIDI number', anyOf: [{ type: 'string' }, { type: 'number' }] },
  start: num('Start in beats from the pattern start (0 = first beat)'),
  length: num('Length in beats (default 1)'),
  velocity: num('0..1 (default 0.85)'),
}, ['pitch', 'start']);

export const TOOLS: ToolDef[] = [
  {
    name: 'get_state', description: 'Current project state: media library, video tracks/clips, audio-studio tracks/clips/effects with their ids, playheads, tempo. Call this first whenever you need ids or do not know what exists.',
    parameters: obj({}), run: () => stateSummary(),
  },
  {
    name: 'set_workspace', description: 'Switch the visible workspace: "video" editor or "audio" studio.',
    parameters: obj({ workspace: str('video | audio', { enum: ['video', 'audio'] }) }, ['workspace']),
    run: ({ workspace }) => { video().setWorkspace(workspace); return ok(`workspace ${workspace}`); },
  },
  {
    name: 'undo', description: 'Undo the last change in the given workspace.',
    parameters: obj({ workspace: str('video | audio', { enum: ['video', 'audio'] }) }, ['workspace']),
    run: ({ workspace }) => { (workspace === 'audio' ? studio() : video()).undo(); return ok('undone'); },
  },

  // ---------------- Audio Studio ----------------
  {
    name: 'studio_add_track', description: 'Add a studio track. kind "audio" (for files/recordings) or "instrument" with an instrument name from get_state (e.g. "Grand Piano", "808 Kit", "Violin").',
    parameters: obj({ kind: str('audio | instrument', { enum: ['audio', 'instrument'] }), instrument: str('Instrument preset name (instrument tracks)'), name: str('Track name') }, ['kind']),
    run: ({ kind, instrument, name }) => {
      const inst = instrument ? instrumentByName(instrument) : undefined;
      if (kind === 'instrument' && instrument && !inst) throw new Error(`Unknown instrument "${instrument}"`);
      const id = studio().addTrack(kind, inst);
      if (name) studio().updateTrack(id, { name }, { commit: false });
      return ok(`track [${id}] "${name ?? inst?.name ?? kind}" added`);
    },
  },
  {
    name: 'studio_set_track', description: 'Change track mixer settings: gain (0–2, 1 = unity), pan (-1..1), muted, solo, name, color, or swap its instrument.',
    parameters: obj({ track: str('Track id or name'), gain: num('0–2'), pan: num('-1..1'), muted: bool('mute'), solo: bool('solo'), name: str('new name'), color: str('hex colour'), instrument: str('instrument preset name') }, ['track']),
    run: ({ track, instrument, ...patch }) => {
      const t = findTrack(track);
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length) studio().updateTrack(t.id, clean);
      if (instrument) { const inst = instrumentByName(instrument); if (!inst) throw new Error(`Unknown instrument "${instrument}"`); studio().setInstrument(t.id, inst); }
      return ok(`track "${t.name}" updated ${JSON.stringify({ ...clean, instrument })}`);
    },
  },
  {
    name: 'studio_remove_track', description: 'Remove a studio track and its clips.',
    parameters: obj({ track: str('Track id or name') }, ['track']),
    run: ({ track }) => { const t = findTrack(track); studio().removeTrack(t.id); return ok(`removed "${t.name}"`); },
  },
  {
    name: 'studio_add_effect', description: 'Add an effect to a track, a sample clip, or "master". Optional params override defaults (e.g. filter: {mode:"lowpass", frequency:5000, q:1}; reverb: {decay, mix}; delay: {division, feedback, mix}; compressor: {threshold, ratio}).',
    parameters: obj({ target: str('track id/name, clip id/name, or "master"'), type: str('Effect type', { enum: ['eq', 'filter', 'compressor', 'reverb', 'delay', 'chorus', 'distortion', 'bitcrusher'] }), params: { type: 'object', description: 'parameter overrides', additionalProperties: true } }, ['target', 'type']),
    run: ({ target, type, params }) => {
      const tg = effectTarget(target);
      const fx = { ...defaultEffect(type as AudioEffectType), ...(params ?? {}) } as AudioEffect;
      const before = effectsOf(tg).length;
      studio().addEffect(tg, type as AudioEffectType);
      const added = effectsOf(tg)[before];
      if (params && added) studio().updateEffect(tg, added.id, params as Partial<AudioEffect>, { commit: false });
      return ok(`${type} [${added?.id}] added to ${tg}${params ? ' with ' + JSON.stringify(params) : ''}${fx ? '' : ''}`);
    },
  },
  {
    name: 'studio_update_effect', description: 'Change parameters of an existing effect (or enable/disable it).',
    parameters: obj({ target: str('track/clip/master'), effectId: str('Effect id from get_state'), params: { type: 'object', description: 'fields to change, e.g. {frequency: 3000} or {enabled:false}', additionalProperties: true } }, ['target', 'effectId', 'params']),
    run: ({ target, effectId, params }) => { const tg = effectTarget(target); studio().updateEffect(tg, effectId, params); return ok(`effect ${effectId} updated ${JSON.stringify(params)}`); },
  },
  {
    name: 'studio_remove_effect', description: 'Remove an effect.',
    parameters: obj({ target: str('track/clip/master'), effectId: str('Effect id') }, ['target', 'effectId']),
    run: ({ target, effectId }) => { studio().removeEffect(effectTarget(target), effectId); return ok(`effect ${effectId} removed`); },
  },
  {
    name: 'studio_eq', description: 'Shape frequencies on a track/clip/master with the parametric EQ: adds an EQ if there is none, then adds the given bands. Use highpass to cut lows, lowpass to cut highs (e.g. "remove everything above 5 kHz" → lowpass 5000), notch to kill one frequency, peaking to boost/cut a range.',
    parameters: obj({ target: str('track/clip/master'), bands: arr(EQ_BAND, 'Bands to add'), replace: bool('Replace existing bands instead of adding (default false)') }, ['target', 'bands']),
    run: ({ target, bands, replace }) => {
      const tg = effectTarget(target);
      let eq = effectsOf(tg).find((e): e is Extract<AudioEffect, { type: 'eq' }> => e.type === 'eq');
      if (!eq) { studio().addEffect(tg, 'eq'); eq = effectsOf(tg).find((e): e is Extract<AudioEffect, { type: 'eq' }> => e.type === 'eq'); studio().updateEffect(tg, eq!.id, { bands: [] } as Partial<AudioEffect>, { commit: false }); }
      const newBands: EqBand[] = bands.map((b: any) => ({ id: uidA(), type: b.type, frequency: b.frequency, gain: b.gain ?? 0, q: b.q ?? (b.type === 'notch' ? 8 : 1), enabled: true }));
      studio().updateEffect(tg, eq!.id, { bands: replace ? newBands : [...eq!.bands, ...newBands] } as Partial<AudioEffect>);
      return ok(`EQ on ${tg}: ${newBands.map((b) => `${b.type} ${b.frequency}Hz${b.gain ? ` ${b.gain}dB` : ''}`).join(', ')}`);
    },
  },
  {
    name: 'studio_set_tempo', description: 'Set the tempo in BPM (pattern clips follow).',
    parameters: obj({ bpm: num('20–300') }, ['bpm']), run: ({ bpm }) => { studio().setBpm(bpm); return ok(`${bpm} bpm`); },
  },
  {
    name: 'studio_set_loop', description: 'Set / enable / disable the loop region (seconds).',
    parameters: obj({ start: num('s'), end: num('s'), enabled: bool('on/off') }),
    run: (a) => { studio().setLoop(Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined))); return ok(`loop ${JSON.stringify(a)}`); },
  },
  {
    name: 'studio_add_pattern', description: 'Create a pattern (notes) clip on an instrument track. Notes are given in beats relative to the pattern start. Use note names (C4, G#3) or drum pad names (Kick, Snare, Closed hi-hat, Open hi-hat, Clap, Low tom…).',
    parameters: obj({ track: str('Instrument track id or name'), start: num('Timeline start in seconds (default: playhead)'), lengthBeats: num('Pattern length in beats (default 16)'), notes: arr(NOTE, 'Notes'), name: str('Clip name') }, ['track', 'notes']),
    run: ({ track, start, lengthBeats, notes, name }) => {
      const t = findTrack(track);
      if (t.kind !== 'instrument') throw new Error(`"${t.name}" is not an instrument track`);
      const len = lengthBeats ?? Math.max(16, Math.ceil(Math.max(0, ...notes.map((n: any) => (n.start ?? 0) + (n.length ?? 1)))));
      const id = studio().addPatternClip(t.id, start ?? studio().currentTime, len);
      const evs: NoteEvent[] = notes.map((n: any) => ({ id: uidA(), pitch: parsePitch(n.pitch), start: n.start ?? 0, length: n.length ?? 1, velocity: n.velocity ?? 0.85 }));
      studio().setNotes(id, evs);
      if (name) studio().updateClip(id, { name }, { commit: false });
      return ok(`pattern [${id}] with ${evs.length} notes on "${t.name}" (${len} beats)`);
    },
  },
  {
    name: 'studio_set_notes', description: 'Replace (or add to) the notes of an existing pattern clip.',
    parameters: obj({ clip: str('Pattern clip id or name'), notes: arr(NOTE, 'Notes'), mode: str('replace | add', { enum: ['replace', 'add'] }) }, ['clip', 'notes']),
    run: ({ clip, notes, mode }) => {
      const c = findStudioClip(clip);
      if (c.type !== 'pattern') throw new Error('Not a pattern clip');
      const evs: NoteEvent[] = notes.map((n: any) => ({ id: uidA(), pitch: parsePitch(n.pitch), start: n.start ?? 0, length: n.length ?? 1, velocity: n.velocity ?? 0.85 }));
      studio().setNotes(c.id, mode === 'add' ? [...c.notes, ...evs] : evs);
      return ok(`${evs.length} notes ${mode === 'add' ? 'added' : 'set'} on "${c.name}"`);
    },
  },
  {
    name: 'studio_add_audio_clip', description: 'Place a media file (audio, or the sound of a video) as a clip on an audio track. Creates a track if none is given.',
    parameters: obj({ asset: str('Media id or file name'), track: str('Audio track id/name (optional)'), start: num('Timeline seconds (default playhead)') }, ['asset']),
    run: ({ asset, track, start }) => {
      const a = findAsset(asset);
      const tid = track ? findTrack(track).id : undefined;
      const id = addAssetToStudio(a.id, start ?? studio().currentTime, tid);
      if (!id) throw new Error('That media has no audio');
      return ok(`clip [${id}] "${a.name}" placed at ${r2(start ?? studio().currentTime)}s`);
    },
  },
  {
    name: 'studio_update_clip', description: 'Edit a studio clip: start (s), duration (s), gain (0–2), fadeIn/fadeOut (s), fadeCurve (linear|exponential|sCurve), rate (speed/pitch, 1 = normal), reverse, name, inPoint (source offset s).',
    parameters: obj({ clip: str('Clip id or name'), start: num('s'), duration: num('s'), gain: num('0–2'), fadeIn: num('s'), fadeOut: num('s'), fadeCurve: str('curve', { enum: ['linear', 'exponential', 'sCurve'] }), rate: num('0.25–4'), reverse: bool('reverse'), name: str('name'), inPoint: num('s'), track: str('move to track id/name') }, ['clip']),
    run: ({ clip, track, start, duration, ...patch }) => {
      const c = findStudioClip(clip);
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length) studio().updateClip(c.id, clean as any);
      if (duration !== undefined) {
        // same path as the UI: clamps to the source length and keeps pattern beats in sync
        const asset = c.type === 'sample' ? video().project.assets.find((a) => a.id === c.assetId) : undefined;
        studio().trimClip(c.id, 'end', duration - c.duration, asset ? asset.duration : null);
      }
      if (start !== undefined || track) studio().moveClip(c.id, start ?? c.start, track ? findTrack(track).id : c.trackId);
      return ok(`clip "${c.name}" updated ${JSON.stringify({ ...clean, start, duration, track })}`);
    },
  },
  {
    name: 'studio_split_clip', description: 'Split a studio clip at a timeline time (seconds).',
    parameters: obj({ clip: str('Clip id or name'), time: num('Timeline seconds (default playhead)') }, ['clip']),
    run: ({ clip, time }) => { const c = findStudioClip(clip); studio().splitClipAt(c.id, time ?? studio().currentTime); return ok(`split "${c.name}" at ${r2(time ?? studio().currentTime)}s`); },
  },
  {
    name: 'studio_remove_clips', description: 'Delete studio clips.',
    parameters: obj({ clips: arr({ type: 'string' }, 'Clip ids or names') }, ['clips']),
    run: ({ clips }) => { const ids = clips.map((c: string) => findStudioClip(c).id); studio().removeClips(ids); return ok(`${ids.length} clip(s) removed`); },
  },
  {
    name: 'studio_duplicate_clips', description: 'Duplicate studio clips right after themselves.',
    parameters: obj({ clips: arr({ type: 'string' }, 'Clip ids or names') }, ['clips']),
    run: ({ clips }) => { studio().duplicateClips(clips.map((c: string) => findStudioClip(c).id)); return ok('duplicated'); },
  },
  {
    name: 'studio_process_clip', description: 'Process the audio of a sample clip (render in place, revertable). Ops: spectral (attenuate/remove/isolate frequencies f0–f1 Hz between t0–t1 seconds *within the clip*), normalize, gain (dB, optional t0/t1), trim (t0,t1), reverse, pitch (semitones, keeps duration), tempo (factor <1 = longer), denoise (strength dB), loudnorm.',
    parameters: obj({
      clip: str('Sample clip id or name'),
      op: obj({
        type: str('op', { enum: ['spectral', 'normalize', 'gain', 'trim', 'reverse', 'pitch', 'tempo', 'denoise', 'loudnorm'] }),
        t0: num('start s within the clip'), t1: num('end s within the clip'), f0: num('low Hz'), f1: num('high Hz'),
        gainDb: num('dB for spectral attenuate (e.g. -18)'), mode: str('spectral mode', { enum: ['attenuate', 'remove', 'isolate'] }),
        db: num('dB for gain'), semitones: num('pitch'), factor: num('tempo factor'), strength: num('denoise dB'), peakDb: num('normalize target dBFS'),
      }, ['type']),
    }, ['clip', 'op']),
    run: async ({ clip, op }) => {
      const c = findStudioClip(clip);
      if (c.type !== 'sample') throw new Error('Only audio (sample) clips can be processed');
      const o = op as ClipOp;
      if (o.type === 'spectral') { o.t0 = o.t0 ?? 0; o.t1 = o.t1 ?? c.duration; o.f0 = o.f0 ?? 20; o.f1 = o.f1 ?? 20000; }
      await applyClipOp(c.id, o);
      return ok(`"${c.name}": ${describeOp(o)}`);
    },
  },
  {
    name: 'studio_transport', description: 'Play, stop or move the studio playhead.',
    parameters: obj({ action: str('play | stop | seek', { enum: ['play', 'stop', 'seek'] }), time: num('seconds (seek, or where to start playing)') }, ['action']),
    run: ({ action, time }) => { const s = studio(); if (time !== undefined) s.setCurrentTime(time); if (action === 'play') s.setPlaying(true); if (action === 'stop') s.setPlaying(false); return ok(`${action}${time !== undefined ? ` @${time}s` : ''}`); },
  },
  {
    name: 'studio_preview_instrument', description: 'Audition an instrument preset (plays a short phrase) without changing the project.',
    parameters: obj({ instrument: str('preset name') }, ['instrument']),
    run: async ({ instrument }) => { const inst = instrumentByName(instrument); if (!inst) throw new Error('Unknown instrument'); await getEngine().previewInstrument(inst, inst.kind === 'drums' ? [36, 42, 38, 42] : [60, 64, 67]); return ok(`auditioned ${inst.name}`); },
  },
  {
    name: 'studio_send_to_video', description: 'Render the studio mix and place it as an audio clip on the video timeline (switches to the video workspace).',
    parameters: obj({ at: num('Video timeline seconds (default: video playhead)') }),
    run: async ({ at }) => { const okk = await sendMixToVideo(at); if (!okk) throw new Error('Render failed'); return ok('mix sent to the video timeline'); },
  },

  // ---------------- Video editor ----------------
  {
    name: 'video_add_clip', description: 'Place a media file on the video timeline (video/image → video track, audio → audio track).',
    parameters: obj({ asset: str('Media id or file name'), start: num('Timeline seconds (default: end of timeline)'), track: str('Track id (optional)') }, ['asset']),
    run: ({ asset, start, track }) => { const a = findAsset(asset); const id = video().addClipFromAsset(a.id, { start, trackId: track }); if (!id) throw new Error('Could not add clip'); return ok(`clip [${id}] "${a.name}" added`); },
  },
  {
    name: 'video_add_text', description: 'Add a title / credits text clip. Optional style fields (fontFamily, fontSize, color, bold, align, animation [fade|slide-left|slide-right|slide-up|slide-down|zoom-in|zoom-out|pop|blur-in|typewriter|letters|rise|wave|wipe|spin-in|flip-in|glitch|scroll-up|crawl], exitAnimation, backdrop [none|starfield|nebula|gradient|film|matrix|bokeh|scanlines|solid], glow 0–1, layout [block|two-column]).',
    parameters: obj({ content: str('Text (use \\n for lines)'), start: num('Timeline seconds (default playhead)'), duration: num('s (default 5; crawl ~30–45)'), style: { type: 'object', description: 'TextProps overrides', additionalProperties: true } }, ['content']),
    run: ({ content, start, duration, style }) => {
      const id = video().addTextClip({ start, duration: duration ?? 5, text: { ...(style ?? {}), content } as Partial<TextProps> });
      return ok(`text clip [${id}] added${style?.animation ? ` (${style.animation})` : ''}`);
    },
  },
  {
    name: 'video_update_text', description: 'Change the text or style of a text clip (same style fields as video_add_text).',
    parameters: obj({ clip: str('Clip id or name'), style: { type: 'object', description: 'TextProps fields incl. content', additionalProperties: true } }, ['clip', 'style']),
    run: ({ clip, style }) => { const c = findVideoClip(clip); if (c.type !== 'text') throw new Error('Not a text clip'); video().updateText(c.id, style); return ok(`text "${c.name}" updated ${JSON.stringify(style)}`); },
  },
  {
    name: 'video_update_clip', description: 'Edit a video-timeline clip: start, duration, name, speed, fadeIn/fadeOut (visual), transform {x,y,scale,rotation,opacity,flipH,flipV,fit}, effects {brightness,contrast,saturation,hue,blur,grayscale,sepia,invert}, audio {volume,muted,fadeIn,fadeOut}.',
    parameters: obj({ clip: str('Clip id or name'), start: num('s'), duration: num('s'), name: str('name'), speed: num('0.25–4'), fadeIn: num('s'), fadeOut: num('s'),
      transform: { type: 'object', additionalProperties: true }, effects: { type: 'object', additionalProperties: true }, audio: { type: 'object', additionalProperties: true } }, ['clip']),
    run: ({ clip, transform, effects, audio, start, duration, ...patch }) => {
      const c = findVideoClip(clip); const v = video();
      const clean = Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined));
      if (Object.keys(clean).length) v.updateClip(c.id, clean as any);
      if (start !== undefined) v.moveClip(c.id, start, c.trackId);
      if (duration !== undefined) v.trimClip(c.id, 'end', duration - c.duration);
      if (transform) v.updateTransform(c.id, transform);
      if (effects) v.updateEffects(c.id, effects);
      if (audio) v.updateAudio(c.id, audio);
      return ok(`clip "${c.name}" updated`);
    },
  },
  {
    name: 'video_layout', description: 'Place a visual clip in a screen layout: full, pip-tl, pip-tr, pip-bl, pip-br, left, right, top, bottom, q-tl, q-tr, q-bl, q-br.',
    parameters: obj({ clip: str('Clip id or name'), layout: str('layout', { enum: ['full', 'pip-tl', 'pip-tr', 'pip-bl', 'pip-br', 'left', 'right', 'top', 'bottom', 'q-tl', 'q-tr', 'q-bl', 'q-br'] }) }, ['clip', 'layout']),
    run: ({ clip, layout }) => {
      const c = findVideoClip(clip); if (c.type === 'audio') throw new Error('Audio clips have no layout');
      const p = video().project; const W = p.width, H = p.height, m = Math.round(W * 0.02);
      const asset = 'assetId' in c ? p.assets.find((a) => a.id === c.assetId) : undefined;
      const fitted = fittedSize(asset?.width || W, asset?.height || H, W, H, c.transform.fit);
      const rects: Record<string, [number, number, number, number]> = { full: [0, 0, 1, 1], 'pip-tl': [0, 0, 0.33, 0.33], 'pip-tr': [0.67, 0, 0.33, 0.33], 'pip-bl': [0, 0.67, 0.33, 0.33], 'pip-br': [0.67, 0.67, 0.33, 0.33], left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1], top: [0, 0, 1, 0.5], bottom: [0, 0.5, 1, 0.5], 'q-tl': [0, 0, 0.5, 0.5], 'q-tr': [0.5, 0, 0.5, 0.5], 'q-bl': [0, 0.5, 0.5, 0.5], 'q-br': [0.5, 0.5, 0.5, 0.5] };
      const [fx, fy, fw, fh] = rects[layout];
      const tw = W * fw - (fw < 1 ? m * 2 : 0), th = H * fh - (fh < 1 ? m * 2 : 0);
      const scale = Math.min(tw / fitted.w, th / fitted.h);
      video().updateTransform(c.id, { scale: Math.round(scale * 1000) / 1000, x: Math.round(W * (fx + fw / 2) - W / 2), y: Math.round(H * (fy + fh / 2) - H / 2), rotation: 0 });
      return ok(`"${c.name}" → ${layout}`);
    },
  },
  {
    name: 'video_add_animation', description: 'Animate a video clip over time: either a preset id (from get_state) starting at a local time, or a custom segment {property, start, end, rampIn, rampOut, value} (property: opacity|scale|rotation|x|y|blur|brightness|contrast|saturation|hue|volume; times in seconds within the clip; value is added to the base: scale 0.5 = +50 %, rotation 90 = +90°, blur px…).',
    parameters: obj({ clip: str('Clip id or name'), preset: str('preset id, e.g. spin360, zoomin, shake'), at: num('local start time for presets (default 0)'),
      segment: obj({ property: str('property'), start: num('s'), end: num('s'), rampIn: num('s'), rampOut: num('s'), value: num('amount'), easing: str('linear|ease|bounce|elastic') }) }, ['clip']),
    run: ({ clip, preset, at, segment }) => {
      const c = findVideoClip(clip);
      if (preset) { const p = ANIMATION_PRESETS.find((x) => x.id === preset); if (!p) throw new Error(`Unknown preset "${preset}"`); video().addAnimations(c.id, p.build(c.duration, at ?? 0)); return ok(`${p.label} on "${c.name}"`); }
      if (segment) {
        const seg = { ...newSegment(segment.property as AnimatableProperty, c.duration, segment.start ?? 0), ...segment, id: uidA() };
        video().addAnimation(c.id, seg as any); return ok(`animation ${segment.property} ${seg.start}–${seg.end}s on "${c.name}"`);
      }
      throw new Error('Give a preset or a segment');
    },
  },
  {
    name: 'video_split_clip', description: 'Split a video-timeline clip at a time (seconds).',
    parameters: obj({ clip: str('Clip id or name'), time: num('s (default playhead)') }, ['clip']),
    run: ({ clip, time }) => { const c = findVideoClip(clip); video().splitClipAt(c.id, time ?? video().currentTime); return ok(`split "${c.name}"`); },
  },
  {
    name: 'video_remove_clips', description: 'Delete video-timeline clips.',
    parameters: obj({ clips: arr({ type: 'string' }, 'ids or names') }, ['clips']),
    run: ({ clips }) => { video().removeClips(clips.map((x: string) => findVideoClip(x).id)); return ok('removed'); },
  },
  {
    name: 'video_transport', description: 'Play, stop or move the video playhead.',
    parameters: obj({ action: str('play | stop | seek', { enum: ['play', 'stop', 'seek'] }), time: num('s') }, ['action']),
    run: ({ action, time }) => { const v = video(); if (time !== undefined) v.setCurrentTime(time); if (action === 'play') v.setPlaying(true); if (action === 'stop') v.setPlaying(false); return ok(action); },
  },
  {
    name: 'video_open_in_studio', description: 'Take the sound of a video-timeline clip into the Audio Studio as a new track (for EQ, cleanup, effects).',
    parameters: obj({ clip: str('Clip id or name') }, ['clip']),
    run: ({ clip }) => { const c = findVideoClip(clip); openClipInStudio(c); return ok(`"${c.name}" opened in the studio`); },
  },
];

export const TOOL_SPECS = TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));

export async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  return tool.run(args ?? {});
}

export const _helpers = { noteName, beatsToSeconds, secondsToBeats, DEFAULT_TEXT };
