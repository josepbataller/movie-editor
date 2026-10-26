import type { SynthPatch, DrumKitPatch, InstrumentSettings, InstrumentCategory } from '@/shared/audioTypes';

// Factory sounds. Everything is synthesized at runtime (no sample library):
// classic subtractive/FM synthesis, additive "custom" waveforms built from
// harmonic series (organs, strings, winds, brass), and Karplus-Strong plucked
// strings (guitars, harp, piano-like tones).

const env = (attack: number, decay: number, sustain: number, release: number) => ({ attack, decay, sustain, release });

/** Harmonic recipes: amplitude of partials 1..n. */
const H = {
  saw: (n: number) => Array.from({ length: n }, (_, i) => 1 / (i + 1)),
  bowed: [1, 0.7, 0.55, 0.4, 0.35, 0.25, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06],          // violin-ish (bright, all partials)
  cello: [1, 0.8, 0.45, 0.5, 0.3, 0.25, 0.15, 0.12, 0.08, 0.05],
  flute: [1, 0.25, 0.1, 0.05, 0.02],
  clarinet: [1, 0.04, 0.5, 0.03, 0.3, 0.02, 0.15, 0.01, 0.08],                            // odd harmonics
  oboe: [0.6, 1, 0.8, 0.6, 0.5, 0.35, 0.25, 0.2, 0.1, 0.08],                              // nasal, strong 2nd/3rd
  bassoon: [0.5, 1, 0.7, 0.4, 0.3, 0.2, 0.1, 0.05],
  trumpet: [1, 0.9, 0.85, 0.75, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1, 0.08],
  horn: [1, 0.6, 0.35, 0.2, 0.1, 0.06, 0.03],
  trombone: [1, 0.8, 0.6, 0.45, 0.3, 0.2, 0.12, 0.08],
  tuba: [1, 0.5, 0.25, 0.1, 0.05],
  sax: [1, 0.6, 0.8, 0.5, 0.45, 0.3, 0.25, 0.15, 0.1],
  organ: [1, 0.8, 0.6, 0.5, 0.3, 0.25, 0.15, 0.1],
  churchOrgan: [1, 0.5, 0.9, 0.3, 0.6, 0.2, 0.4, 0.1, 0.2],
  accordion: [1, 0.9, 0.7, 0.8, 0.5, 0.4, 0.3, 0.2, 0.1, 0.08],
  choir: [1, 0.5, 0.3, 0.6, 0.2, 0.1, 0.05],
  ooh: [1, 0.3, 0.1, 0.05],
  piano: [1, 0.6, 0.3, 0.25, 0.15, 0.1, 0.05, 0.04, 0.02],
  marimba: [1, 0, 0, 0.3, 0, 0, 0, 0, 0.1],
  vibes: [1, 0, 0, 0.15, 0, 0, 0, 0, 0, 0.05],
  bell: [1, 0.6, 0.4, 0.5, 0.3, 0.2, 0.3, 0.1],
};

const base: Omit<SynthPatch, 'name'> = {
  kind: 'synth',
  mode: 'subtractive',
  osc1: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.8 },
  osc2: { wave: 'square', octave: 0, detune: 7, level: 0 },
  sub: 0, noise: 0, unison: 0, unisonSpread: 12,
  filter: { type: 'lowpass', cutoff: 4000, resonance: 1, envAmount: 0, keyTrack: 0.3 },
  ampEnv: env(0.01, 0.2, 0.8, 0.3),
  filterEnv: env(0.01, 0.3, 0.2, 0.3),
  glide: 0,
  lfo: { rate: 5, depth: 0, target: 'none' },
  fm: { ratio: 2, amount: 0 },
  gain: 0.5,
};

const P = (name: string, category: InstrumentCategory, p: Partial<SynthPatch>): SynthPatch => ({ ...base, ...p, name, category });
const custom = (h: number[], extra: Partial<SynthPatch['osc1']> = {}) => ({ wave: 'custom' as const, octave: 0, detune: 0, level: 0.8, harmonics: h, ...extra });

export const SYNTH_PRESETS: SynthPatch[] = [
  // ---------------- Keys ----------------
  P('Grand Piano', 'Keys', { mode: 'pluck', pluckDamping: 0.55, osc1: custom(H.piano, { level: 1 }), filter: { type: 'lowpass', cutoff: 6000, resonance: 0.5, envAmount: 2500, keyTrack: 0.6 }, filterEnv: env(0.001, 0.6, 0.1, 0.4), ampEnv: env(0.002, 1.8, 0.0, 0.5), stereo: 4, gain: 0.7 }),
  P('Bright Piano', 'Keys', { mode: 'pluck', pluckDamping: 0.75, osc1: custom(H.piano, { level: 1 }), filter: { type: 'lowpass', cutoff: 9000, resonance: 0.5, envAmount: 3000, keyTrack: 0.6 }, filterEnv: env(0.001, 0.5, 0.1, 0.4), ampEnv: env(0.002, 1.5, 0.0, 0.4), stereo: 5, gain: 0.7 }),
  P('Upright Piano', 'Keys', { mode: 'pluck', pluckDamping: 0.45, osc1: custom(H.piano, { level: 1 }), filter: { type: 'lowpass', cutoff: 3500, resonance: 0.6, envAmount: 1500, keyTrack: 0.5 }, filterEnv: env(0.001, 0.5, 0.1, 0.3), ampEnv: env(0.002, 1.4, 0.0, 0.4), gain: 0.7 }),
  P('E-Piano (FM)', 'Keys', { osc1: { wave: 'sine', octave: 0, detune: 0, level: 1 }, fm: { ratio: 14, amount: 180 }, filter: { ...base.filter, cutoff: 5000 }, ampEnv: env(0.003, 0.9, 0.3, 0.5), stereo: 6, gain: 0.6 }),
  P('Wurli', 'Keys', { osc1: { wave: 'sine', octave: 0, detune: 0, level: 1 }, osc2: { wave: 'triangle', octave: 1, detune: 0, level: 0.25 }, fm: { ratio: 1, amount: 120 }, filter: { type: 'lowpass', cutoff: 2500, resonance: 1, envAmount: 2000, keyTrack: 0.4 }, filterEnv: env(0.001, 0.4, 0.2, 0.3), ampEnv: env(0.003, 0.8, 0.4, 0.3), lfo: { rate: 5.5, depth: 0.25, target: 'amp' }, gain: 0.6 }),
  P('Clavinet', 'Keys', { mode: 'pluck', pluckDamping: 0.85, osc1: custom(H.saw(12), { level: 1 }), filter: { type: 'bandpass', cutoff: 1500, resonance: 2, envAmount: 2000, keyTrack: 0.5 }, filterEnv: env(0.001, 0.15, 0.3, 0.1), ampEnv: env(0.001, 0.6, 0.0, 0.1), gain: 0.6 }),
  P('Harpsichord', 'Keys', { mode: 'pluck', pluckDamping: 0.9, osc1: custom(H.saw(16), { level: 1 }), osc2: custom(H.saw(8), { octave: 1, level: 0.5 }), filter: { type: 'highpass', cutoff: 300, resonance: 0.7, envAmount: 0, keyTrack: 0 }, ampEnv: env(0.001, 0.9, 0.0, 0.15), gain: 0.5 }),
  P('Church Organ', 'Keys', { osc1: custom(H.churchOrgan, { level: 0.8 }), osc2: custom(H.organ, { octave: -1, level: 0.5 }), sub: 0.3, filter: { ...base.filter, cutoff: 7000 }, ampEnv: env(0.08, 0.05, 1, 0.3), stereo: 3, gain: 0.45 }),
  P('Rock Organ', 'Keys', { osc1: custom(H.organ, { level: 0.9 }), osc2: { wave: 'sine', octave: 1, detune: 0, level: 0.4 }, sub: 0.5, filter: { ...base.filter, cutoff: 6000 }, ampEnv: env(0.005, 0.05, 1, 0.08), lfo: { rate: 6.5, depth: 0.2, target: 'amp' }, stereo: 8, gain: 0.5 }),
  P('Accordion', 'Keys', { osc1: custom(H.accordion, { level: 0.8 }), osc2: custom(H.accordion, { detune: 9, level: 0.6 }), breath: 0.05, filter: { ...base.filter, cutoff: 5000 }, ampEnv: env(0.06, 0.1, 1, 0.15), vibrato: { rate: 5, depth: 4, delay: 0.3 }, gain: 0.45 }),
  P('Celesta', 'Keys', { osc1: { wave: 'sine', octave: 1, detune: 0, level: 1 }, fm: { ratio: 4, amount: 60 }, ampEnv: env(0.001, 1.2, 0.0, 0.8), stereo: 3, gain: 0.6 }),
  P('Music Box', 'Keys', { osc1: { wave: 'sine', octave: 2, detune: 0, level: 1 }, fm: { ratio: 3, amount: 120 }, ampEnv: env(0.001, 0.9, 0.0, 0.6), gain: 0.55 }),
  // ---------------- Strings ----------------
  P('Violin', 'Strings', { osc1: custom(H.bowed, { level: 0.9 }), osc2: custom(H.bowed, { detune: 6, level: 0.4 }), breath: 0.06, filter: { type: 'lowpass', cutoff: 5500, resonance: 1.2, envAmount: 1500, keyTrack: 0.5 }, filterEnv: env(0.25, 0.3, 0.6, 0.3), ampEnv: env(0.18, 0.2, 0.9, 0.35), vibrato: { rate: 5.5, depth: 14, delay: 0.35 }, stereo: 4, gain: 0.5 }),
  P('Viola', 'Strings', { osc1: custom(H.cello, { level: 0.9 }), osc2: custom(H.bowed, { detune: -6, level: 0.35 }), breath: 0.05, filter: { type: 'lowpass', cutoff: 3800, resonance: 1.2, envAmount: 1200, keyTrack: 0.5 }, filterEnv: env(0.25, 0.3, 0.6, 0.3), ampEnv: env(0.2, 0.2, 0.9, 0.4), vibrato: { rate: 5, depth: 12, delay: 0.4 }, stereo: 4, gain: 0.5 }),
  P('Cello', 'Strings', { osc1: custom(H.cello, { level: 1 }), osc2: custom(H.bowed, { detune: 5, level: 0.3 }), breath: 0.05, filter: { type: 'lowpass', cutoff: 2800, resonance: 1.5, envAmount: 900, keyTrack: 0.5 }, filterEnv: env(0.3, 0.3, 0.6, 0.3), ampEnv: env(0.22, 0.2, 0.9, 0.45), vibrato: { rate: 4.8, depth: 12, delay: 0.45 }, stereo: 3, gain: 0.55 }),
  P('Double Bass', 'Strings', { osc1: custom(H.cello, { octave: -1, level: 1 }), sub: 0.3, breath: 0.03, filter: { type: 'lowpass', cutoff: 1400, resonance: 1.2, envAmount: 500, keyTrack: 0.4 }, filterEnv: env(0.3, 0.3, 0.6, 0.3), ampEnv: env(0.25, 0.2, 0.9, 0.5), vibrato: { rate: 4.5, depth: 8, delay: 0.5 }, gain: 0.6 }),
  P('String Ensemble', 'Strings', { osc1: custom(H.bowed, { detune: -7, level: 0.7 }), osc2: custom(H.cello, { detune: 7, level: 0.7 }), unison: 3, unisonSpread: 9, breath: 0.03, filter: { type: 'lowpass', cutoff: 4500, resonance: 0.8, envAmount: 1000, keyTrack: 0.4 }, filterEnv: env(0.6, 0.4, 0.7, 0.6), ampEnv: env(0.5, 0.3, 0.9, 0.9), vibrato: { rate: 5, depth: 8, delay: 0.5 }, stereo: 10, gain: 0.35 }),
  P('Pizzicato', 'Strings', { mode: 'pluck', pluckDamping: 0.35, osc1: custom(H.cello, { level: 1 }), filter: { type: 'lowpass', cutoff: 2500, resonance: 1, envAmount: 2000, keyTrack: 0.5 }, filterEnv: env(0.001, 0.2, 0.0, 0.2), ampEnv: env(0.001, 0.5, 0.0, 0.2), gain: 0.7 }),
  P('Harp', 'Strings', { mode: 'pluck', pluckDamping: 0.7, osc1: custom(H.piano, { level: 1 }), filter: { type: 'lowpass', cutoff: 5000, resonance: 0.5, envAmount: 1500, keyTrack: 0.6 }, filterEnv: env(0.001, 0.4, 0.1, 0.3), ampEnv: env(0.001, 2.2, 0.0, 0.8), stereo: 6, gain: 0.65 }),
  // ---------------- Woodwinds ----------------
  P('Flute', 'Woodwinds', { osc1: custom(H.flute, { level: 1 }), breath: 0.12, filter: { type: 'lowpass', cutoff: 4000, resonance: 0.7, envAmount: 800, keyTrack: 0.6 }, filterEnv: env(0.08, 0.2, 0.7, 0.2), ampEnv: env(0.07, 0.1, 0.9, 0.2), vibrato: { rate: 5.2, depth: 10, delay: 0.3 }, gain: 0.6 }),
  P('Piccolo', 'Woodwinds', { osc1: custom(H.flute, { octave: 1, level: 1 }), breath: 0.15, filter: { type: 'lowpass', cutoff: 8000, resonance: 0.7, envAmount: 800, keyTrack: 0.6 }, ampEnv: env(0.05, 0.1, 0.9, 0.15), vibrato: { rate: 6, depth: 10, delay: 0.25 }, gain: 0.5 }),
  P('Clarinet', 'Woodwinds', { osc1: custom(H.clarinet, { level: 1 }), breath: 0.04, filter: { type: 'lowpass', cutoff: 3200, resonance: 1, envAmount: 600, keyTrack: 0.5 }, filterEnv: env(0.08, 0.2, 0.7, 0.2), ampEnv: env(0.06, 0.1, 0.9, 0.2), vibrato: { rate: 5, depth: 5, delay: 0.5 }, gain: 0.6 }),
  P('Oboe', 'Woodwinds', { osc1: custom(H.oboe, { level: 1 }), breath: 0.04, filter: { type: 'bandpass', cutoff: 1800, resonance: 1.4, envAmount: 600, keyTrack: 0.5 }, filterEnv: env(0.06, 0.2, 0.7, 0.2), ampEnv: env(0.05, 0.1, 0.9, 0.2), vibrato: { rate: 5.5, depth: 9, delay: 0.3 }, gain: 0.55 }),
  P('Bassoon', 'Woodwinds', { osc1: custom(H.bassoon, { octave: -1, level: 1 }), breath: 0.05, filter: { type: 'lowpass', cutoff: 1800, resonance: 1.3, envAmount: 500, keyTrack: 0.5 }, filterEnv: env(0.08, 0.2, 0.7, 0.2), ampEnv: env(0.07, 0.1, 0.9, 0.25), vibrato: { rate: 5, depth: 7, delay: 0.4 }, gain: 0.6 }),
  P('Recorder', 'Woodwinds', { osc1: custom(H.flute, { level: 1 }), osc2: { wave: 'sine', octave: 1, detune: 0, level: 0.15 }, breath: 0.2, filter: { type: 'lowpass', cutoff: 5000, resonance: 0.7, envAmount: 0, keyTrack: 0.5 }, ampEnv: env(0.04, 0.1, 0.9, 0.15), gain: 0.55 }),
  P('Pan Flute', 'Woodwinds', { osc1: custom(H.flute, { level: 1 }), breath: 0.35, filter: { type: 'bandpass', cutoff: 2000, resonance: 2, envAmount: 1500, keyTrack: 0.8 }, filterEnv: env(0.02, 0.3, 0.5, 0.2), ampEnv: env(0.05, 0.3, 0.8, 0.25), vibrato: { rate: 5, depth: 8, delay: 0.3 }, gain: 0.6 }),
  // ---------------- Brass ----------------
  P('Trumpet', 'Brass', { osc1: custom(H.trumpet, { level: 1 }), breath: 0.03, filter: { type: 'lowpass', cutoff: 2500, resonance: 1.5, envAmount: 4000, keyTrack: 0.5 }, filterEnv: env(0.06, 0.25, 0.75, 0.2), ampEnv: env(0.04, 0.15, 0.9, 0.2), vibrato: { rate: 5.5, depth: 7, delay: 0.5 }, gain: 0.5 }),
  P('Trombone', 'Brass', { osc1: custom(H.trombone, { octave: -1, level: 1 }), breath: 0.03, filter: { type: 'lowpass', cutoff: 1800, resonance: 1.3, envAmount: 2500, keyTrack: 0.5 }, filterEnv: env(0.08, 0.25, 0.75, 0.25), ampEnv: env(0.06, 0.15, 0.9, 0.25), vibrato: { rate: 5, depth: 6, delay: 0.5 }, glide: 0.03, gain: 0.55 }),
  P('French Horn', 'Brass', { osc1: custom(H.horn, { level: 1 }), osc2: custom(H.horn, { detune: 4, level: 0.4 }), breath: 0.02, filter: { type: 'lowpass', cutoff: 1500, resonance: 1, envAmount: 1200, keyTrack: 0.4 }, filterEnv: env(0.12, 0.3, 0.7, 0.3), ampEnv: env(0.1, 0.2, 0.9, 0.35), vibrato: { rate: 4.5, depth: 4, delay: 0.6 }, stereo: 4, gain: 0.55 }),
  P('Tuba', 'Brass', { osc1: custom(H.tuba, { octave: -2, level: 1 }), sub: 0.2, breath: 0.03, filter: { type: 'lowpass', cutoff: 900, resonance: 1, envAmount: 800, keyTrack: 0.4 }, filterEnv: env(0.1, 0.3, 0.7, 0.3), ampEnv: env(0.08, 0.2, 0.9, 0.3), gain: 0.65 }),
  P('Brass Section', 'Brass', { osc1: custom(H.trumpet, { detune: -6, level: 0.7 }), osc2: custom(H.trombone, { octave: -1, detune: 6, level: 0.7 }), unison: 2, unisonSpread: 8, breath: 0.03, filter: { type: 'lowpass', cutoff: 2200, resonance: 1.2, envAmount: 3000, keyTrack: 0.5 }, filterEnv: env(0.08, 0.3, 0.7, 0.3), ampEnv: env(0.06, 0.2, 0.9, 0.3), stereo: 8, gain: 0.4 }),
  P('Alto Sax', 'Brass', { osc1: custom(H.sax, { level: 1 }), breath: 0.08, filter: { type: 'lowpass', cutoff: 2600, resonance: 1.6, envAmount: 2000, keyTrack: 0.5 }, filterEnv: env(0.05, 0.3, 0.7, 0.2), ampEnv: env(0.05, 0.15, 0.9, 0.2), vibrato: { rate: 5.5, depth: 10, delay: 0.4 }, glide: 0.02, gain: 0.5 }),
  P('Tenor Sax', 'Brass', { osc1: custom(H.sax, { octave: -1, level: 1 }), breath: 0.08, filter: { type: 'lowpass', cutoff: 2000, resonance: 1.6, envAmount: 1800, keyTrack: 0.5 }, filterEnv: env(0.06, 0.3, 0.7, 0.25), ampEnv: env(0.06, 0.15, 0.9, 0.25), vibrato: { rate: 5, depth: 10, delay: 0.4 }, glide: 0.02, gain: 0.55 }),
  // ---------------- Guitars & Bass ----------------
  P('Acoustic Guitar', 'Guitars & Bass', { mode: 'pluck', pluckDamping: 0.6, osc1: custom(H.saw(10), { level: 1 }), filter: { type: 'lowpass', cutoff: 4500, resonance: 0.8, envAmount: 2000, keyTrack: 0.5 }, filterEnv: env(0.001, 0.3, 0.1, 0.3), ampEnv: env(0.001, 1.6, 0.0, 0.3), stereo: 3, gain: 0.65 }),
  P('Nylon Guitar', 'Guitars & Bass', { mode: 'pluck', pluckDamping: 0.4, osc1: custom(H.piano, { level: 1 }), filter: { type: 'lowpass', cutoff: 2800, resonance: 0.8, envAmount: 1200, keyTrack: 0.5 }, filterEnv: env(0.001, 0.3, 0.1, 0.3), ampEnv: env(0.001, 1.4, 0.0, 0.3), gain: 0.65 }),
  P('Electric Clean', 'Guitars & Bass', { mode: 'pluck', pluckDamping: 0.65, osc1: custom(H.saw(6), { level: 1 }), filter: { type: 'lowpass', cutoff: 3200, resonance: 1.5, envAmount: 1500, keyTrack: 0.4 }, filterEnv: env(0.001, 0.25, 0.1, 0.3), ampEnv: env(0.001, 1.8, 0.0, 0.3), lfo: { rate: 4, depth: 0.08, target: 'amp' }, gain: 0.6 }),
  P('Electric Distorted', 'Guitars & Bass', { osc1: { wave: 'sawtooth', octave: 0, detune: -4, level: 0.8 }, osc2: { wave: 'square', octave: 0, detune: 4, level: 0.6 }, unison: 1, unisonSpread: 10, filter: { type: 'lowpass', cutoff: 3000, resonance: 2, envAmount: 2500, keyTrack: 0.3 }, filterEnv: env(0.002, 0.3, 0.4, 0.2), ampEnv: env(0.002, 0.4, 0.8, 0.15), gain: 0.4 }),
  P('Bass Guitar', 'Guitars & Bass', { mode: 'pluck', pluckDamping: 0.5, osc1: custom(H.saw(6), { octave: -1, level: 1 }), sub: 0.3, filter: { type: 'lowpass', cutoff: 1200, resonance: 1.2, envAmount: 1500, keyTrack: 0.4 }, filterEnv: env(0.001, 0.25, 0.2, 0.2), ampEnv: env(0.001, 1.6, 0.0, 0.2), gain: 0.75 }),
  P('Slap Bass', 'Guitars & Bass', { mode: 'pluck', pluckDamping: 0.85, osc1: custom(H.saw(10), { octave: -1, level: 1 }), filter: { type: 'lowpass', cutoff: 2500, resonance: 3, envAmount: 4000, keyTrack: 0.4 }, filterEnv: env(0.001, 0.12, 0.1, 0.1), ampEnv: env(0.001, 0.9, 0.0, 0.15), gain: 0.7 }),
  P('Upright Bass', 'Guitars & Bass', { mode: 'pluck', pluckDamping: 0.3, osc1: custom(H.cello, { octave: -1, level: 1 }), sub: 0.4, filter: { type: 'lowpass', cutoff: 800, resonance: 1, envAmount: 600, keyTrack: 0.3 }, filterEnv: env(0.001, 0.3, 0.2, 0.3), ampEnv: env(0.002, 1.2, 0.0, 0.3), gain: 0.8 }),
  // ---------------- Mallets & Percussion ----------------
  P('Marimba', 'Mallets & Percussion', { osc1: custom(H.marimba, { level: 1 }), noise: 0.03, filter: { ...base.filter, cutoff: 6000 }, ampEnv: env(0.001, 0.7, 0.0, 0.4), gain: 0.7 }),
  P('Vibraphone', 'Mallets & Percussion', { osc1: custom(H.vibes, { level: 1 }), filter: { ...base.filter, cutoff: 8000 }, ampEnv: env(0.001, 2.5, 0.0, 1.0), lfo: { rate: 4.5, depth: 0.35, target: 'amp' }, stereo: 4, gain: 0.6 }),
  P('Xylophone', 'Mallets & Percussion', { osc1: custom(H.marimba, { octave: 1, level: 1 }), noise: 0.05, filter: { ...base.filter, cutoff: 9000 }, ampEnv: env(0.001, 0.35, 0.0, 0.2), gain: 0.6 }),
  P('Glockenspiel', 'Mallets & Percussion', { osc1: { wave: 'sine', octave: 2, detune: 0, level: 1 }, fm: { ratio: 2.76, amount: 80 }, ampEnv: env(0.001, 1.5, 0.0, 0.8), gain: 0.5 }),
  P('Tubular Bells', 'Mallets & Percussion', { osc1: custom(H.bell, { level: 1 }), fm: { ratio: 1.41, amount: 200 }, ampEnv: env(0.001, 3.5, 0.0, 2.0), stereo: 5, gain: 0.5 }),
  P('Steel Drum', 'Mallets & Percussion', { osc1: { wave: 'sine', octave: 0, detune: 0, level: 1 }, osc2: { wave: 'sine', octave: 1, detune: 12, level: 0.5 }, fm: { ratio: 2, amount: 220 }, filter: { ...base.filter, cutoff: 6000 }, ampEnv: env(0.001, 0.9, 0.0, 0.5), gain: 0.6 }),
  P('Kalimba', 'Mallets & Percussion', { mode: 'pluck', pluckDamping: 0.5, osc1: { wave: 'sine', octave: 1, detune: 0, level: 1 }, filter: { ...base.filter, cutoff: 5000 }, ampEnv: env(0.001, 1.0, 0.0, 0.4), gain: 0.7 }),
  P('Timpani', 'Mallets & Percussion', { osc1: { wave: 'sine', octave: -1, detune: 0, level: 1 }, noise: 0.15, filter: { type: 'lowpass', cutoff: 900, resonance: 2, envAmount: 1500, keyTrack: 0.3 }, filterEnv: env(0.001, 0.15, 0.0, 0.2), ampEnv: env(0.001, 1.6, 0.0, 0.6), gain: 0.9 }),
  // ---------------- Voices ----------------
  P('Choir Aah', 'Voices', { osc1: custom(H.choir, { detune: -5, level: 0.8 }), osc2: custom(H.choir, { detune: 5, level: 0.8 }), unison: 2, unisonSpread: 7, breath: 0.04, filter: { type: 'bandpass', cutoff: 1100, resonance: 0.8, envAmount: 400, keyTrack: 0.3 }, filterEnv: env(0.5, 0.3, 0.8, 0.5), ampEnv: env(0.45, 0.3, 0.9, 0.8), vibrato: { rate: 5, depth: 8, delay: 0.6 }, stereo: 10, gain: 0.45 }),
  P('Choir Ooh', 'Voices', { osc1: custom(H.ooh, { detune: -5, level: 0.9 }), osc2: custom(H.ooh, { detune: 5, level: 0.9 }), unison: 2, unisonSpread: 7, filter: { type: 'lowpass', cutoff: 1200, resonance: 1, envAmount: 300, keyTrack: 0.3 }, ampEnv: env(0.4, 0.3, 0.9, 0.8), vibrato: { rate: 4.5, depth: 7, delay: 0.6 }, stereo: 10, gain: 0.5 }),
  P('Vox Pad', 'Voices', { osc1: custom(H.choir, { level: 0.8 }), osc2: { wave: 'triangle', octave: 0, detune: 8, level: 0.5 }, unison: 3, unisonSpread: 12, filter: { type: 'bandpass', cutoff: 900, resonance: 1.2, envAmount: 900, keyTrack: 0.3 }, filterEnv: env(1.5, 0.5, 0.7, 1.5), ampEnv: env(1.2, 0.5, 0.9, 2.0), lfo: { rate: 0.25, depth: 300, target: 'cutoff' }, stereo: 14, gain: 0.4 }),
  // ---------------- Synth Bass ----------------
  P('Sub Bass', 'Synth Bass', { osc1: { wave: 'sine', octave: -1, detune: 0, level: 1 }, sub: 0.4, filter: { ...base.filter, cutoff: 600 }, ampEnv: env(0.005, 0.1, 0.9, 0.15), gain: 0.8 }),
  P('Saw Bass', 'Synth Bass', { osc1: { wave: 'sawtooth', octave: -1, detune: 0, level: 0.9 }, osc2: { wave: 'square', octave: -1, detune: 5, level: 0.4 }, filter: { type: 'lowpass', cutoff: 500, resonance: 4, envAmount: 2500, keyTrack: 0.4 }, filterEnv: env(0.005, 0.25, 0.1, 0.2), ampEnv: env(0.005, 0.2, 0.7, 0.15), gain: 0.55 }),
  P('Acid 303', 'Synth Bass', { osc1: { wave: 'sawtooth', octave: -1, detune: 0, level: 1 }, filter: { type: 'lowpass', cutoff: 300, resonance: 12, envAmount: 3500, keyTrack: 0.2 }, filterEnv: env(0.002, 0.18, 0.0, 0.1), ampEnv: env(0.002, 0.15, 0.6, 0.08), glide: 0.06, gain: 0.5 }),
  P('Reese Bass', 'Synth Bass', { osc1: { wave: 'sawtooth', octave: -1, detune: -12, level: 0.8 }, osc2: { wave: 'sawtooth', octave: -1, detune: 12, level: 0.8 }, unison: 2, unisonSpread: 18, filter: { type: 'lowpass', cutoff: 900, resonance: 2, envAmount: 0, keyTrack: 0.3 }, ampEnv: env(0.01, 0.3, 0.9, 0.3), gain: 0.4 }),
  P('FM Bass', 'Synth Bass', { osc1: { wave: 'sine', octave: -1, detune: 0, level: 1 }, fm: { ratio: 1, amount: 400 }, filter: { ...base.filter, cutoff: 3000 }, ampEnv: env(0.003, 0.25, 0.4, 0.15), gain: 0.7 }),
  // ---------------- Synth Lead ----------------
  P('Super Saw Lead', 'Synth Lead', { unison: 3, unisonSpread: 20, osc2: { wave: 'sawtooth', octave: 0, detune: -9, level: 0.7 }, filter: { ...base.filter, cutoff: 6000, resonance: 0.8 }, ampEnv: env(0.02, 0.2, 0.8, 0.4), stereo: 12, gain: 0.35 }),
  P('Square Lead', 'Synth Lead', { osc1: { wave: 'square', octave: 0, detune: 0, level: 0.9 }, filter: { type: 'lowpass', cutoff: 2500, resonance: 3, envAmount: 1500, keyTrack: 0.5 }, filterEnv: env(0.005, 0.3, 0.3, 0.3), ampEnv: env(0.01, 0.1, 0.8, 0.2), glide: 0.04, lfo: { rate: 5.5, depth: 6, target: 'pitch' }, gain: 0.45 }),
  P('Sine Whistle', 'Synth Lead', { osc1: { wave: 'sine', octave: 1, detune: 0, level: 1 }, ampEnv: env(0.05, 0.1, 0.9, 0.3), lfo: { rate: 6, depth: 10, target: 'pitch' }, gain: 0.6 }),
  P('Pluck', 'Synth Lead', { osc1: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.9 }, filter: { type: 'lowpass', cutoff: 400, resonance: 2, envAmount: 5000, keyTrack: 0.5 }, filterEnv: env(0.001, 0.25, 0.0, 0.2), ampEnv: env(0.001, 0.4, 0.0, 0.3), gain: 0.5 }),
  P('Chip Tune', 'Synth Lead', { osc1: { wave: 'square', octave: 0, detune: 0, level: 0.8 }, filter: { ...base.filter, cutoff: 8000 }, ampEnv: env(0.001, 0.08, 0.6, 0.05), gain: 0.4 }),
  P('Bell', 'Synth Lead', { osc1: { wave: 'sine', octave: 1, detune: 0, level: 1 }, fm: { ratio: 3.5, amount: 300 }, ampEnv: env(0.002, 1.5, 0.0, 1.2), gain: 0.5 }),
  // ---------------- Synth Pad ----------------
  P('Warm Pad', 'Synth Pad', { osc1: { wave: 'sawtooth', octave: 0, detune: -6, level: 0.7 }, osc2: { wave: 'triangle', octave: 0, detune: 6, level: 0.7 }, unison: 2, unisonSpread: 14, filter: { type: 'lowpass', cutoff: 1200, resonance: 0.7, envAmount: 800, keyTrack: 0.3 }, filterEnv: env(1.2, 1.0, 0.6, 1.5), ampEnv: env(0.8, 0.5, 0.9, 1.6), lfo: { rate: 0.3, depth: 200, target: 'cutoff' }, stereo: 10, gain: 0.35 }),
  P('Dark Strings', 'Synth Pad', { osc1: { wave: 'sawtooth', octave: -1, detune: -4, level: 0.8 }, osc2: { wave: 'sawtooth', octave: 0, detune: 4, level: 0.6 }, unison: 3, unisonSpread: 10, filter: { type: 'lowpass', cutoff: 900, resonance: 1, envAmount: 0, keyTrack: 0.4 }, ampEnv: env(0.6, 0.3, 0.9, 1.2), stereo: 10, gain: 0.35 }),
  P('Glass Pad', 'Synth Pad', { osc1: { wave: 'triangle', octave: 1, detune: 3, level: 0.8 }, osc2: { wave: 'sine', octave: 0, detune: -3, level: 0.6 }, fm: { ratio: 2, amount: 60 }, ampEnv: env(1.0, 0.5, 0.8, 2.0), lfo: { rate: 0.5, depth: 0.3, target: 'amp' }, stereo: 8, gain: 0.4 }),
  // ---------------- Synth FX ----------------
  P('Noise Riser', 'Synth FX', { osc1: { wave: 'noise', octave: 0, detune: 0, level: 0 }, noise: 1, filter: { type: 'bandpass', cutoff: 800, resonance: 3, envAmount: 6000, keyTrack: 0 }, filterEnv: env(2.5, 0.1, 1, 0.5), ampEnv: env(2.0, 0.1, 1, 0.4), gain: 0.5 }),
  P('Laser Zap', 'Synth FX', { osc1: { wave: 'square', octave: 1, detune: 0, level: 1 }, filter: { type: 'lowpass', cutoff: 8000, resonance: 1, envAmount: 0, keyTrack: 0 }, ampEnv: env(0.001, 0.25, 0.0, 0.1), lfo: { rate: 40, depth: 1200, target: 'pitch' }, gain: 0.4 }),
];

export const DRUM_KITS: DrumKitPatch[] = [
  { kind: 'drums', name: '808 Kit', category: 'Drums', style: '808', tune: 0, decay: 1, punch: 0.6, gain: 0.8 },
  { kind: 'drums', name: 'Electro Kit', category: 'Drums', style: 'electro', tune: 0, decay: 0.8, punch: 0.9, gain: 0.8 },
  { kind: 'drums', name: 'Acoustic-ish Kit', category: 'Drums', style: 'acoustic', tune: 0, decay: 1, punch: 0.5, gain: 0.8 },
  { kind: 'drums', name: 'Lo-fi Kit', category: 'Drums', style: 'lofi', tune: -2, decay: 0.7, punch: 0.4, gain: 0.7 },
];

export const INSTRUMENT_CATEGORIES: InstrumentCategory[] = ['Drums', 'Keys', 'Strings', 'Woodwinds', 'Brass', 'Guitars & Bass', 'Mallets & Percussion', 'Voices', 'Synth Bass', 'Synth Lead', 'Synth Pad', 'Synth FX', 'Sampler'];

export const ALL_INSTRUMENTS: InstrumentSettings[] = [...DRUM_KITS, ...SYNTH_PRESETS];

export function instrumentByName(name: string): InstrumentSettings | undefined {
  return ALL_INSTRUMENTS.find((i) => i.name === name);
}

export function instrumentsInCategory(cat: InstrumentCategory): InstrumentSettings[] {
  return ALL_INSTRUMENTS.filter((i) => i.category === cat);
}

export function categoryIcon(cat: InstrumentCategory | undefined): string {
  switch (cat) {
    case 'Drums': return '🥁'; case 'Keys': return '🎹'; case 'Strings': return '🎻'; case 'Woodwinds': return '🪈'; case 'Brass': return '🎺';
    case 'Guitars & Bass': return '🎸'; case 'Mallets & Percussion': return '🪘'; case 'Voices': return '🎤'; case 'Sampler': return '🎙';
    case 'Synth Bass': return '🔊'; case 'Synth Lead': return '🎛'; case 'Synth Pad': return '🌫'; case 'Synth FX': return '✨'; default: return '🎵';
  }
}
