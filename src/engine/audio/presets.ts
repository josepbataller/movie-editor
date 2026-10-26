import type { SynthPatch, DrumKitPatch, InstrumentSettings } from '@/shared/audioTypes';

// Factory sounds. Everything is synthesized at runtime, so the library costs nothing on disk.

const env = (attack: number, decay: number, sustain: number, release: number) => ({ attack, decay, sustain, release });

const base: Omit<SynthPatch, 'name'> = {
  kind: 'synth',
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

export const SYNTH_PRESETS: SynthPatch[] = [
  // ---- Bass ----
  { ...base, name: 'Sub Bass', osc1: { wave: 'sine', octave: -1, detune: 0, level: 1 }, sub: 0.4, filter: { ...base.filter, cutoff: 600 }, ampEnv: env(0.005, 0.1, 0.9, 0.15), gain: 0.8 },
  { ...base, name: 'Saw Bass', osc1: { wave: 'sawtooth', octave: -1, detune: 0, level: 0.9 }, osc2: { wave: 'square', octave: -1, detune: 5, level: 0.4 }, filter: { type: 'lowpass', cutoff: 500, resonance: 4, envAmount: 2500, keyTrack: 0.4 }, filterEnv: env(0.005, 0.25, 0.1, 0.2), ampEnv: env(0.005, 0.2, 0.7, 0.15), gain: 0.55 },
  { ...base, name: 'Acid 303', osc1: { wave: 'sawtooth', octave: -1, detune: 0, level: 1 }, filter: { type: 'lowpass', cutoff: 300, resonance: 12, envAmount: 3500, keyTrack: 0.2 }, filterEnv: env(0.002, 0.18, 0.0, 0.1), ampEnv: env(0.002, 0.15, 0.6, 0.08), glide: 0.06, gain: 0.5 },
  { ...base, name: 'Reese Bass', osc1: { wave: 'sawtooth', octave: -1, detune: -12, level: 0.8 }, osc2: { wave: 'sawtooth', octave: -1, detune: 12, level: 0.8 }, unison: 2, unisonSpread: 18, filter: { type: 'lowpass', cutoff: 900, resonance: 2, envAmount: 0, keyTrack: 0.3 }, ampEnv: env(0.01, 0.3, 0.9, 0.3), gain: 0.4 },
  { ...base, name: 'FM Bass', osc1: { wave: 'sine', octave: -1, detune: 0, level: 1 }, fm: { ratio: 1, amount: 400 }, filter: { ...base.filter, cutoff: 3000 }, ampEnv: env(0.003, 0.25, 0.4, 0.15), gain: 0.7 },
  // ---- Leads ----
  { ...base, name: 'Super Saw Lead', unison: 3, unisonSpread: 20, osc2: { wave: 'sawtooth', octave: 0, detune: -9, level: 0.7 }, filter: { ...base.filter, cutoff: 6000, resonance: 0.8 }, ampEnv: env(0.02, 0.2, 0.8, 0.4), gain: 0.35 },
  { ...base, name: 'Square Lead', osc1: { wave: 'square', octave: 0, detune: 0, level: 0.9 }, filter: { type: 'lowpass', cutoff: 2500, resonance: 3, envAmount: 1500, keyTrack: 0.5 }, filterEnv: env(0.005, 0.3, 0.3, 0.3), ampEnv: env(0.01, 0.1, 0.8, 0.2), glide: 0.04, lfo: { rate: 5.5, depth: 6, target: 'pitch' }, gain: 0.45 },
  { ...base, name: 'Sine Whistle', osc1: { wave: 'sine', octave: 1, detune: 0, level: 1 }, ampEnv: env(0.05, 0.1, 0.9, 0.3), lfo: { rate: 6, depth: 10, target: 'pitch' }, gain: 0.6 },
  // ---- Keys ----
  { ...base, name: 'E-Piano (FM)', osc1: { wave: 'sine', octave: 0, detune: 0, level: 1 }, fm: { ratio: 14, amount: 180 }, filter: { ...base.filter, cutoff: 5000 }, ampEnv: env(0.003, 0.9, 0.3, 0.5), gain: 0.6 },
  { ...base, name: 'Organ', osc1: { wave: 'sine', octave: 0, detune: 0, level: 0.8 }, osc2: { wave: 'sine', octave: 1, detune: 0, level: 0.5 }, sub: 0.5, ampEnv: env(0.005, 0.05, 1, 0.08), lfo: { rate: 6, depth: 0.15, target: 'amp' }, gain: 0.5 },
  { ...base, name: 'Bell', osc1: { wave: 'sine', octave: 1, detune: 0, level: 1 }, fm: { ratio: 3.5, amount: 300 }, ampEnv: env(0.002, 1.5, 0.0, 1.2), gain: 0.5 },
  // ---- Pads ----
  { ...base, name: 'Warm Pad', osc1: { wave: 'sawtooth', octave: 0, detune: -6, level: 0.7 }, osc2: { wave: 'triangle', octave: 0, detune: 6, level: 0.7 }, unison: 2, unisonSpread: 14, filter: { type: 'lowpass', cutoff: 1200, resonance: 0.7, envAmount: 800, keyTrack: 0.3 }, filterEnv: env(1.2, 1.0, 0.6, 1.5), ampEnv: env(0.8, 0.5, 0.9, 1.6), lfo: { rate: 0.3, depth: 200, target: 'cutoff' }, gain: 0.35 },
  { ...base, name: 'Dark Strings', osc1: { wave: 'sawtooth', octave: -1, detune: -4, level: 0.8 }, osc2: { wave: 'sawtooth', octave: 0, detune: 4, level: 0.6 }, unison: 3, unisonSpread: 10, filter: { type: 'lowpass', cutoff: 900, resonance: 1, envAmount: 0, keyTrack: 0.4 }, ampEnv: env(0.6, 0.3, 0.9, 1.2), gain: 0.35 },
  { ...base, name: 'Glass Pad', osc1: { wave: 'triangle', octave: 1, detune: 3, level: 0.8 }, osc2: { wave: 'sine', octave: 0, detune: -3, level: 0.6 }, fm: { ratio: 2, amount: 60 }, ampEnv: env(1.0, 0.5, 0.8, 2.0), lfo: { rate: 0.5, depth: 0.3, target: 'amp' }, gain: 0.4 },
  // ---- Plucks / misc ----
  { ...base, name: 'Pluck', osc1: { wave: 'sawtooth', octave: 0, detune: 0, level: 0.9 }, filter: { type: 'lowpass', cutoff: 400, resonance: 2, envAmount: 5000, keyTrack: 0.5 }, filterEnv: env(0.001, 0.25, 0.0, 0.2), ampEnv: env(0.001, 0.4, 0.0, 0.3), gain: 0.5 },
  { ...base, name: 'Chip Tune', osc1: { wave: 'square', octave: 0, detune: 0, level: 0.8 }, filter: { ...base.filter, cutoff: 8000 }, ampEnv: env(0.001, 0.08, 0.6, 0.05), gain: 0.4 },
  { ...base, name: 'Noise Riser', osc1: { wave: 'noise', octave: 0, detune: 0, level: 0 }, noise: 1, filter: { type: 'bandpass', cutoff: 800, resonance: 3, envAmount: 6000, keyTrack: 0 }, filterEnv: env(2.5, 0.1, 1, 0.5), ampEnv: env(2.0, 0.1, 1, 0.4), gain: 0.5 },
];

export const DRUM_KITS: DrumKitPatch[] = [
  { kind: 'drums', name: '808 Kit', style: '808', tune: 0, decay: 1, punch: 0.6, gain: 0.8 },
  { kind: 'drums', name: 'Electro Kit', style: 'electro', tune: 0, decay: 0.8, punch: 0.9, gain: 0.8 },
  { kind: 'drums', name: 'Acoustic-ish Kit', style: 'acoustic', tune: 0, decay: 1, punch: 0.5, gain: 0.8 },
  { kind: 'drums', name: 'Lo-fi Kit', style: 'lofi', tune: -2, decay: 0.7, punch: 0.4, gain: 0.7 },
];

export const ALL_INSTRUMENTS: InstrumentSettings[] = [...DRUM_KITS, ...SYNTH_PRESETS];

export function instrumentByName(name: string): InstrumentSettings | undefined {
  return ALL_INSTRUMENTS.find((i) => i.name === name);
}
