// Audio Studio data model (DAW-style). Lives inside the project file as `project.audio`.
// Keep dependency-free: used by the renderer and (for export) by the main process.

export type FadeCurve = 'linear' | 'exponential' | 'sCurve';

export interface AudioSession {
  bpm: number;
  beatsPerBar: number;
  masterGain: number;             // 0..2
  masterEffects: AudioEffect[];
  tracks: StudioTrack[];
  clips: StudioClip[];
  loop: { enabled: boolean; start: number; end: number }; // seconds
  metronome: boolean;
}

export type StudioTrackKind = 'audio' | 'instrument';

export interface StudioTrack {
  id: string;
  kind: StudioTrackKind;
  name: string;
  color: string;
  gain: number;        // 0..2 (1 = unity)
  pan: number;         // -1..1
  muted: boolean;
  solo: boolean;
  effects: AudioEffect[];
  /** Instrument tracks: which sound they play. */
  instrument?: InstrumentSettings;
  height: number;      // px in the UI
}

interface StudioClipBase {
  id: string;
  trackId: string;
  name: string;
  start: number;       // timeline seconds
  duration: number;    // seconds
  gain: number;        // clip gain 0..2
  fadeIn: number;      // seconds
  fadeOut: number;
  fadeCurve: FadeCurve;
}

export interface SampleClip extends StudioClipBase {
  type: 'sample';
  assetId: string;
  inPoint: number;     // source offset (s)
  rate: number;        // playback rate (pitch+speed), 1 = normal
  reverse: boolean;
  /** Clip-level effects (before the track chain). */
  effects?: AudioEffect[];
  /** Asset this clip was rendered from (render-in-place keeps the original available). */
  sourceAssetId?: string;
  /** The clip's region before the first render-in-place, so "Revert to original" is exact. */
  original?: { assetId: string; inPoint: number; rate: number; reverse: boolean; duration: number };
}

export interface NoteEvent {
  id: string;
  pitch: number;       // MIDI note 0..127 (drums: see DRUM_NOTES)
  start: number;       // beats from clip start
  length: number;      // beats
  velocity: number;    // 0..1
}

export interface PatternClip extends StudioClipBase {
  type: 'pattern';
  notes: NoteEvent[];
  lengthBeats: number;
}

export type StudioClip = SampleClip | PatternClip;

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export interface EqBand {
  id: string;
  type: 'lowshelf' | 'highshelf' | 'peaking' | 'lowpass' | 'highpass' | 'notch';
  frequency: number;   // Hz
  gain: number;        // dB (shelf / peaking)
  q: number;
  enabled: boolean;
}

export type AudioEffect =
  | { id: string; type: 'eq'; enabled: boolean; bands: EqBand[] }
  | { id: string; type: 'filter'; enabled: boolean; mode: 'lowpass' | 'highpass' | 'bandpass'; frequency: number; q: number }
  | { id: string; type: 'reverb'; enabled: boolean; decay: number; preDelay: number; mix: number; tone: number }
  | { id: string; type: 'delay'; enabled: boolean; time: number; sync: boolean; division: number; feedback: number; mix: number; pingPong: boolean; tone: number }
  | { id: string; type: 'compressor'; enabled: boolean; threshold: number; ratio: number; attack: number; release: number; knee: number; makeup: number }
  | { id: string; type: 'distortion'; enabled: boolean; drive: number; tone: number; mix: number }
  | { id: string; type: 'chorus'; enabled: boolean; rate: number; depth: number; mix: number }
  | { id: string; type: 'gate'; enabled: boolean; threshold: number; release: number }
  | { id: string; type: 'bitcrusher'; enabled: boolean; bits: number; downsample: number; mix: number };

export type AudioEffectType = AudioEffect['type'];

// ---------------------------------------------------------------------------
// Instruments (all synthesized procedurally – no sample library needed)
// ---------------------------------------------------------------------------

export type OscWave = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise' | 'custom';

export type InstrumentCategory = 'Keys' | 'Strings' | 'Woodwinds' | 'Brass' | 'Guitars & Bass' | 'Mallets & Percussion' | 'Voices' | 'Synth Bass' | 'Synth Lead' | 'Synth Pad' | 'Synth FX' | 'Drums' | 'Sampler';

export interface SynthPatch {
  kind: 'synth';
  name: string;
  category?: InstrumentCategory;
  /** 'subtractive' = oscillators -> filter -> amp; 'pluck' = Karplus-Strong string (noise burst into a tuned feedback delay). */
  mode?: 'subtractive' | 'pluck';
  osc1: { wave: OscWave; octave: number; detune: number; level: number; harmonics?: number[] };
  osc2: { wave: OscWave; octave: number; detune: number; level: number; harmonics?: number[] };
  /** Delayed vibrato (pitch LFO that fades in), typical of bowed/blown instruments. */
  vibrato?: { rate: number; depth: number; delay: number };
  /** Breath / bow noise level mixed before the filter. */
  breath?: number;
  /** Stereo width: detunes a second voice panned to the other side (cents). */
  stereo?: number;
  /** Pluck mode: string damping 0..1 (higher = brighter/longer). */
  pluckDamping?: number;
  sub: number;                 // sub-oscillator level (one octave down sine)
  noise: number;               // noise level
  unison: number;              // extra detuned voices per osc (0..4)
  unisonSpread: number;        // cents
  filter: { type: 'lowpass' | 'highpass' | 'bandpass'; cutoff: number; resonance: number; envAmount: number; keyTrack: number };
  ampEnv: { attack: number; decay: number; sustain: number; release: number };
  filterEnv: { attack: number; decay: number; sustain: number; release: number };
  glide: number;               // portamento seconds
  lfo: { rate: number; depth: number; target: 'pitch' | 'cutoff' | 'amp' | 'none' };
  fm: { ratio: number; amount: number };  // simple 2-op FM on osc1
  gain: number;
}

export interface DrumKitPatch {
  kind: 'drums';
  name: string;
  category?: InstrumentCategory;
  style: '808' | 'electro' | 'acoustic' | 'lofi';
  tune: number;      // semitones
  decay: number;     // multiplier
  punch: number;     // transient amount
  gain: number;
}

/** Plays a recorded/imported sound at different pitches (root note = original pitch). */
export interface SamplerPatch {
  kind: 'sampler';
  name: string;
  category?: InstrumentCategory;
  assetId: string;
  rootNote: number;
  loop: boolean;
  attack: number;
  release: number;
  gain: number;
}

export type InstrumentSettings = SynthPatch | DrumKitPatch | SamplerPatch;

/** Drum pads mapped to MIDI notes (General MIDI style). */
export const DRUM_NOTES: { note: number; name: string; short: string }[] = [
  { note: 36, name: 'Kick', short: 'KICK' },
  { note: 38, name: 'Snare', short: 'SNR' },
  { note: 39, name: 'Clap', short: 'CLAP' },
  { note: 42, name: 'Closed hi-hat', short: 'HH' },
  { note: 46, name: 'Open hi-hat', short: 'OHH' },
  { note: 41, name: 'Low tom', short: 'LTOM' },
  { note: 47, name: 'Mid tom', short: 'MTOM' },
  { note: 50, name: 'High tom', short: 'HTOM' },
  { note: 49, name: 'Crash', short: 'CRSH' },
  { note: 51, name: 'Ride', short: 'RIDE' },
  { note: 37, name: 'Rim', short: 'RIM' },
  { note: 56, name: 'Cowbell', short: 'BELL' },
  { note: 54, name: 'Tambourine', short: 'TAMB' },
  { note: 75, name: 'Clave', short: 'CLV' },
  { note: 70, name: 'Shaker', short: 'SHKR' },
  { note: 76, name: 'Wood block', short: 'WOOD' },
];

export const TRACK_COLORS = ['#4f8cff', '#3b8f6a', '#c48a2b', '#b85fa8', '#d9534f', '#2bb3c4', '#8a5fb8', '#7cb342', '#ff7f50', '#9aa1b1'];

export function defaultSession(): AudioSession {
  return {
    bpm: 120,
    beatsPerBar: 4,
    masterGain: 1,
    masterEffects: [],
    tracks: [],
    clips: [],
    loop: { enabled: false, start: 0, end: 8 },
    metronome: false,
  };
}

export const uidA = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function defaultEffect(type: AudioEffectType): AudioEffect {
  const id = uidA();
  switch (type) {
    case 'eq': return {
      id, type, enabled: true, bands: [
        { id: uidA(), type: 'highpass', frequency: 40, gain: 0, q: 0.7, enabled: true },
        { id: uidA(), type: 'lowshelf', frequency: 120, gain: 0, q: 0.7, enabled: true },
        { id: uidA(), type: 'peaking', frequency: 400, gain: 0, q: 1, enabled: true },
        { id: uidA(), type: 'peaking', frequency: 1500, gain: 0, q: 1, enabled: true },
        { id: uidA(), type: 'peaking', frequency: 4000, gain: 0, q: 1, enabled: true },
        { id: uidA(), type: 'highshelf', frequency: 9000, gain: 0, q: 0.7, enabled: true },
      ],
    };
    case 'filter': return { id, type, enabled: true, mode: 'lowpass', frequency: 2000, q: 1 };
    case 'reverb': return { id, type, enabled: true, decay: 2.2, preDelay: 0.02, mix: 0.3, tone: 0.6 };
    case 'delay': return { id, type, enabled: true, time: 0.375, sync: true, division: 0.75, feedback: 0.35, mix: 0.3, pingPong: true, tone: 0.5 };
    case 'compressor': return { id, type, enabled: true, threshold: -18, ratio: 3, attack: 0.01, release: 0.2, knee: 6, makeup: 2 };
    case 'distortion': return { id, type, enabled: true, drive: 0.4, tone: 0.5, mix: 0.6 };
    case 'chorus': return { id, type, enabled: true, rate: 0.8, depth: 0.004, mix: 0.4 };
    case 'gate': return { id, type, enabled: true, threshold: -40, release: 0.1 };
    case 'bitcrusher': return { id, type, enabled: true, bits: 8, downsample: 4, mix: 0.7 };
  }
}

export const EFFECT_LABELS: Record<AudioEffectType, string> = {
  eq: 'Equalizer', filter: 'Filter', reverb: 'Reverb', delay: 'Echo / Delay', compressor: 'Compressor',
  distortion: 'Distortion', chorus: 'Chorus', gate: 'Noise gate', bitcrusher: 'Bitcrusher',
};

/** Convert beats to seconds at a tempo. */
export const beatsToSeconds = (beats: number, bpm: number) => (beats * 60) / bpm;
export const secondsToBeats = (sec: number, bpm: number) => (sec * bpm) / 60;
export const midiToFreq = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
