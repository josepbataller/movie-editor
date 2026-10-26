import { SynthPatch, DrumKitPatch, midiToFreq } from '@/shared/audioTypes';

// Procedural instruments for the Audio Studio: a subtractive/FM synth and a
// synthesized drum kit. Everything is built from oscillators, noise and
// envelopes, so the same code runs in real time and in offline rendering.

export interface Voice {
  /** Start the release stage at `when` (ctx time). Nodes free themselves afterwards. */
  release: (when: number) => void;
  /** Immediately silence and dispose. */
  kill: () => void;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
}

function noiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  return s;
}

/** ADSR on an AudioParam. Returns a function that schedules the release and returns its end time. */
function adsr(param: AudioParam, when: number, peak: number, a: number, d: number, s: number, r: number, floor = 0.0001) {
  const A = Math.max(0.001, a), D = Math.max(0.001, d), R = Math.max(0.005, r);
  param.cancelScheduledValues(when);
  param.setValueAtTime(Math.max(floor, param.value * 0 + floor), when);
  param.linearRampToValueAtTime(Math.max(floor, peak), when + A);
  param.setTargetAtTime(Math.max(floor, peak * s), when + A, D / 3);
  return (relWhen: number) => {
    const t = Math.max(relWhen, when + 0.002);
    param.cancelScheduledValues(t);
    // continue from wherever the envelope is, then decay to silence
    param.setTargetAtTime(floor, t, R / 3);
    return t + R * 1.5;
  };
}

// ---------------------------------------------------------------------------
// Synth
// ---------------------------------------------------------------------------

export function playSynth(
  ctx: BaseAudioContext, dest: AudioNode, patch: SynthPatch, pitch: number, velocity: number, when: number,
  duration: number | null, glideFromFreq: number | null,
): Voice {
  const freq = midiToFreq(pitch);
  const vel = 0.3 + 0.7 * Math.min(1, Math.max(0, velocity));
  const nodes: AudioNode[] = [];
  const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];

  const mixer = ctx.createGain(); nodes.push(mixer);
  const filter = ctx.createBiquadFilter(); nodes.push(filter);
  filter.type = patch.filter.type;
  filter.Q.value = Math.min(30, Math.max(0.05, patch.filter.resonance));
  const amp = ctx.createGain(); nodes.push(amp);
  amp.gain.value = 0.0001;
  mixer.connect(filter); filter.connect(amp); amp.connect(dest);

  // LFO
  let lfoPitch: GainNode | null = null;
  let lfo: OscillatorNode | null = null;
  if (patch.lfo.target !== 'none' && patch.lfo.depth > 0) {
    lfo = ctx.createOscillator(); lfo.frequency.value = patch.lfo.rate; sources.push(lfo);
    const lg = ctx.createGain(); nodes.push(lg); lfo.connect(lg);
    if (patch.lfo.target === 'pitch') { lg.gain.value = patch.lfo.depth; lfoPitch = lg; }
    else if (patch.lfo.target === 'cutoff') { lg.gain.value = patch.lfo.depth; lg.connect(filter.frequency); }
    else if (patch.lfo.target === 'amp') { lg.gain.value = patch.lfo.depth * 0.5; lg.connect(mixer.gain); }
  }

  const f1 = freq * Math.pow(2, patch.osc1.octave);
  const f2 = freq * Math.pow(2, patch.osc2.octave);
  const osc1Gain = ctx.createGain(); osc1Gain.gain.value = patch.osc1.level; nodes.push(osc1Gain); osc1Gain.connect(mixer);
  const osc1 = makeOscInto(ctx, patch.osc1.wave, f1, patch.osc1.detune, osc1Gain, sources, nodes, glideFromFreq, patch.glide, freq, when, lfoPitch);
  // unison voices for osc1
  for (let u = 1; u <= patch.unison; u++) {
    const spread = patch.unisonSpread * u * (u % 2 ? 1 : -1);
    const g = ctx.createGain(); g.gain.value = patch.osc1.level * 0.6 / patch.unison; nodes.push(g); g.connect(mixer);
    makeOscInto(ctx, patch.osc1.wave, f1, patch.osc1.detune + spread, g, sources, nodes, null, 0, freq, when, lfoPitch);
  }
  if (patch.osc2.level > 0) {
    const g = ctx.createGain(); g.gain.value = patch.osc2.level; nodes.push(g); g.connect(mixer);
    makeOscInto(ctx, patch.osc2.wave, f2, patch.osc2.detune, g, sources, nodes, glideFromFreq, patch.glide, freq, when, lfoPitch);
  }
  if (patch.sub > 0) {
    const g = ctx.createGain(); g.gain.value = patch.sub; nodes.push(g); g.connect(mixer);
    makeOscInto(ctx, 'sine', freq / 2, 0, g, sources, nodes, null, 0, freq, when, null);
  }
  if (patch.noise > 0) {
    const g = ctx.createGain(); g.gain.value = patch.noise * 0.5; nodes.push(g); g.connect(mixer);
    const n = noiseSource(ctx); n.connect(g); sources.push(n);
  }
  // FM on osc1
  if (osc1 && patch.fm.amount > 0) {
    const mod = ctx.createOscillator(); mod.frequency.value = f1 * patch.fm.ratio; sources.push(mod);
    const mg = ctx.createGain(); mg.gain.value = patch.fm.amount; nodes.push(mg);
    mod.connect(mg); mg.connect(osc1.frequency);
    // FM index decays with the amp envelope for a natural attack
    mg.gain.setValueAtTime(patch.fm.amount * 1.5, when);
    mg.gain.setTargetAtTime(patch.fm.amount * 0.6, when, Math.max(0.05, patch.ampEnv.decay));
  }

  // Filter envelope
  const baseCut = Math.min(20000, Math.max(20, patch.filter.cutoff * Math.pow(freq / 261.6, patch.filter.keyTrack)));
  const fe = patch.filterEnv;
  filter.frequency.cancelScheduledValues(when);
  filter.frequency.setValueAtTime(baseCut, when);
  if (patch.filter.envAmount !== 0) {
    const peak = Math.min(20000, Math.max(20, baseCut + patch.filter.envAmount));
    const sus = Math.min(20000, Math.max(20, baseCut + patch.filter.envAmount * fe.sustain));
    filter.frequency.linearRampToValueAtTime(peak, when + Math.max(0.001, fe.attack));
    filter.frequency.setTargetAtTime(sus, when + Math.max(0.001, fe.attack), Math.max(0.001, fe.decay) / 3);
  }

  const releaseAmp = adsr(amp.gain, when, patch.gain * vel, patch.ampEnv.attack, patch.ampEnv.decay, patch.ampEnv.sustain, patch.ampEnv.release);
  for (const s of sources) s.start(when);

  let ended = false;
  const stopAt = (t: number) => {
    if (ended) return; ended = true;
    for (const s of sources) { try { s.stop(t); } catch { /* already stopped */ } }
    const cleanup = () => { for (const n of nodes) n.disconnect(); for (const s of sources) s.disconnect(); };
    if (sources[0]) sources[0].onended = cleanup; else cleanup();
  };
  const release = (relWhen: number) => {
    const end = releaseAmp(relWhen);
    if (patch.filter.envAmount !== 0) filter.frequency.setTargetAtTime(baseCut, relWhen, Math.max(0.005, fe.release) / 3);
    stopAt(end + 0.05);
  };
  if (duration != null) release(when + Math.max(0.01, duration));
  return { release, kill: () => { amp.gain.cancelScheduledValues(ctx.currentTime); amp.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.01); stopAt(ctx.currentTime + 0.08); } };
}

function makeOscInto(
  ctx: BaseAudioContext, wave: SynthPatch['osc1']['wave'], f: number, detune: number, into: GainNode,
  sources: (OscillatorNode | AudioBufferSourceNode)[], _nodes: AudioNode[], glideFrom: number | null, glide: number,
  noteFreq: number, when: number, lfoPitch: GainNode | null,
): OscillatorNode | undefined {
  if (wave === 'noise') { const n = noiseSource(ctx); n.connect(into); sources.push(n); return undefined; }
  const o = ctx.createOscillator();
  o.type = wave;
  if (glideFrom && glide > 0) {
    o.frequency.setValueAtTime(Math.max(1, glideFrom * (f / noteFreq)), when);
    o.frequency.exponentialRampToValueAtTime(f, when + glide);
  } else {
    o.frequency.value = f;
  }
  o.detune.value = detune;
  if (lfoPitch) lfoPitch.connect(o.detune);
  o.connect(into);
  sources.push(o);
  return o;
}

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------

export function playDrum(ctx: BaseAudioContext, dest: AudioNode, kit: DrumKitPatch, note: number, velocity: number, when: number): Voice | null {
  const vel = 0.4 + 0.6 * Math.min(1, Math.max(0, velocity));
  const tune = Math.pow(2, kit.tune / 12);
  const dec = Math.max(0.2, kit.decay);
  const out = ctx.createGain(); out.gain.value = kit.gain * vel; out.connect(dest);
  const stops: (() => void)[] = [];
  let endTime = when + 0.5;
  const style = kit.style;

  const tone = (f0: number, f1: number, pitchDecay: number, ampDecay: number, wave: OscillatorType = 'sine', level = 1) => {
    const o = ctx.createOscillator(); o.type = wave;
    o.frequency.setValueAtTime(f0 * tune, when);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * tune), when + pitchDecay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + ampDecay);
    o.connect(g); g.connect(out);
    o.start(when); o.stop(when + ampDecay + 0.05);
    endTime = Math.max(endTime, when + ampDecay + 0.05);
    stops.push(() => { try { o.stop(); } catch { /* */ } });
  };
  const noise = (filterType: BiquadFilterType, freq: number, q: number, ampDecay: number, level = 1, attack = 0.001) => {
    const n = noiseSource(ctx);
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(level, when + attack);
    g.gain.exponentialRampToValueAtTime(0.001, when + attack + ampDecay);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(when); n.stop(when + attack + ampDecay + 0.05);
    endTime = Math.max(endTime, when + attack + ampDecay + 0.05);
    stops.push(() => { try { n.stop(); } catch { /* */ } });
  };
  const click = (level: number) => noise('highpass', 3000, 0.7, 0.02, level * kit.punch);

  switch (note) {
    case 36: // kick
      if (style === '808') { tone(160, 45, 0.08, 0.9 * dec); click(0.4); }
      else if (style === 'electro') { tone(220, 50, 0.04, 0.35 * dec); click(0.8); }
      else if (style === 'acoustic') { tone(130, 55, 0.05, 0.4 * dec); noise('lowpass', 900, 0.7, 0.08, 0.5); click(0.6); }
      else { tone(120, 48, 0.07, 0.5 * dec, 'triangle'); }
      break;
    case 38: // snare
      if (style === '808') { tone(190, 160, 0.03, 0.18 * dec, 'triangle', 0.6); noise('bandpass', 2500, 0.8, 0.25 * dec, 0.9); }
      else if (style === 'electro') { tone(240, 180, 0.02, 0.12 * dec, 'square', 0.4); noise('highpass', 1800, 0.7, 0.2 * dec, 1); }
      else if (style === 'acoustic') { tone(200, 170, 0.02, 0.15 * dec, 'triangle', 0.5); noise('bandpass', 3200, 0.6, 0.3 * dec, 1); noise('lowpass', 1200, 0.7, 0.1, 0.4); }
      else { tone(170, 150, 0.03, 0.15 * dec, 'triangle', 0.5); noise('bandpass', 1500, 0.8, 0.22 * dec, 0.7); }
      break;
    case 39: // clap
      for (let i = 0; i < 3; i++) {
        const n = noiseSource(ctx); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.2;
        const g = ctx.createGain(); const t0 = when + i * 0.012;
        g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.8, t0 + 0.002); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.03);
        n.connect(f); f.connect(g); g.connect(out); n.start(t0); n.stop(t0 + 0.05); stops.push(() => { try { n.stop(); } catch { /* */ } });
      }
      noise('bandpass', 1200, 0.9, 0.25 * dec, 0.9, 0.03);
      break;
    case 42: noise('highpass', style === 'acoustic' ? 7000 : 8000, 1, 0.06 * dec, 0.7); break; // closed hat
    case 46: noise('highpass', 7000, 0.8, 0.35 * dec, 0.6); break;                               // open hat
    case 41: tone(110, 70, 0.1, 0.4 * dec); noise('lowpass', 1500, 0.7, 0.05, 0.3); break;      // low tom
    case 47: tone(160, 100, 0.1, 0.35 * dec); noise('lowpass', 2000, 0.7, 0.05, 0.3); break;    // mid tom
    case 50: tone(230, 150, 0.08, 0.3 * dec); noise('lowpass', 2500, 0.7, 0.05, 0.3); break;    // high tom
    case 49: noise('highpass', 5000, 0.5, 1.6 * dec, 0.7); noise('bandpass', 9000, 1, 0.8 * dec, 0.4); break; // crash
    case 51: noise('bandpass', 8500, 2, 0.9 * dec, 0.5); tone(1800, 1750, 0.01, 0.3 * dec, 'square', 0.1); break; // ride
    case 37: tone(900, 800, 0.005, 0.04, 'square', 0.5); noise('bandpass', 4000, 2, 0.03, 0.6); break; // rim
    case 56: tone(587, 587, 0.01, 0.3 * dec, 'square', 0.4); tone(845, 845, 0.01, 0.3 * dec, 'square', 0.4); break; // cowbell
    case 54: noise('highpass', 9000, 1, 0.15 * dec, 0.6); noise('bandpass', 6000, 3, 0.1, 0.4); break; // tambourine
    case 75: tone(2500, 2400, 0.005, 0.06, 'sine', 0.8); break;  // clave
    case 70: noise('highpass', 6000, 0.7, 0.08 * dec, 0.5, 0.01); break; // shaker
    case 76: tone(1200, 1100, 0.005, 0.07, 'triangle', 0.8); break; // wood block
    default: return null;
  }
  if (style === 'lofi') {
    // darker, crunchier
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500;
    out.disconnect(); out.connect(lp); lp.connect(dest);
  }
  const kill = () => { for (const s of stops) s(); out.disconnect(); };
  setTimeout(() => out.disconnect(), Math.max(0, (endTime - ctx.currentTime) * 1000 + 100));
  return { release: () => {}, kill };
}

export const DRUM_PITCHES = new Set([36, 38, 39, 42, 46, 41, 47, 50, 49, 51, 37, 56, 54, 75, 70, 76]);
