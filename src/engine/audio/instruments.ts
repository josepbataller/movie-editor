import { SynthPatch, DrumKitPatch, SamplerPatch, OscWave, midiToFreq } from '@/shared/audioTypes';

// Procedural instruments for the Audio Studio:
//  - a subtractive / FM / additive synth (custom waveforms from harmonic series),
//    with delayed vibrato, breath noise and stereo detune for acoustic-style sounds
//  - Karplus-Strong plucked strings (guitars, harp, piano-like tones)
//  - a synthesized drum kit, and a sampler that re-pitches a recorded sound.
// Everything is plain Web Audio nodes, so the same code runs live and offline.

export interface Voice {
  /** Start the release stage at `when` (ctx time). Nodes free themselves afterwards. */
  release: (when: number) => void;
  /** Immediately silence and dispose. */
  kill: () => void;
  /** Set once the voice has finished and freed its nodes (lets the engine prune its list). */
  ended?: boolean;
}

/** Freeze an AudioParam at its current automated value (so a release can start mid-attack). */
function holdAt(param: AudioParam, t: number) {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(t);
  else param.cancelScheduledValues(t);
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

// Custom waveforms (additive synthesis) are cached per context + harmonic recipe.
const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
function periodicWave(ctx: BaseAudioContext, harmonics: number[]): PeriodicWave {
  let m = waveCache.get(ctx);
  if (!m) { m = new Map(); waveCache.set(ctx, m); }
  const key = harmonics.map((h) => h.toFixed(3)).join(',');
  let w = m.get(key);
  if (!w) {
    const n = harmonics.length + 1;
    const real = new Float32Array(n), imag = new Float32Array(n);
    harmonics.forEach((a, i) => { imag[i + 1] = a; });
    w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    m.set(key, w);
  }
  return w;
}

/** ADSR on an AudioParam. Returns a function that schedules the release and returns its end time. */
function adsr(param: AudioParam, when: number, peak: number, a: number, d: number, s: number, r: number, floor = 0.0001) {
  const A = Math.max(0.001, a), D = Math.max(0.001, d), R = Math.max(0.005, r);
  param.cancelScheduledValues(when);
  param.setValueAtTime(floor, when);
  param.linearRampToValueAtTime(Math.max(floor, peak), when + A);
  param.setTargetAtTime(Math.max(floor, peak * s), when + A, D / 3);
  return (relWhen: number) => {
    const t = Math.max(relWhen, when + 0.002);
    holdAt(param, t);
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
  if (patch.mode === 'pluck') return playPluck(ctx, dest, patch, pitch, velocity, when, duration);

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

  // LFO (cutoff / amp / pitch) and delayed vibrato (pitch)
  let lfoPitch: GainNode | null = null;
  if (patch.lfo.target !== 'none' && patch.lfo.depth > 0) {
    const lfo = ctx.createOscillator(); lfo.frequency.value = patch.lfo.rate; sources.push(lfo);
    const lg = ctx.createGain(); nodes.push(lg); lfo.connect(lg);
    if (patch.lfo.target === 'pitch') { lg.gain.value = patch.lfo.depth; lfoPitch = lg; }
    else if (patch.lfo.target === 'cutoff') { lg.gain.value = patch.lfo.depth; lg.connect(filter.frequency); }
    else if (patch.lfo.target === 'amp') { lg.gain.value = patch.lfo.depth * 0.5; lg.connect(mixer.gain); }
  }
  const pitchMods: GainNode[] = [];
  if (lfoPitch) pitchMods.push(lfoPitch);
  if (patch.vibrato && patch.vibrato.depth > 0) {
    const vib = ctx.createOscillator(); vib.frequency.value = patch.vibrato.rate; sources.push(vib);
    const vg = ctx.createGain(); nodes.push(vg);
    vg.gain.setValueAtTime(0, when);
    vg.gain.linearRampToValueAtTime(patch.vibrato.depth, when + Math.max(0.05, patch.vibrato.delay) + 0.3);
    vib.connect(vg);
    pitchMods.push(vg);
  }

  const addOsc = (wave: OscWave, harmonics: number[] | undefined, f: number, detune: number, level: number, glide: boolean) => {
    if (level <= 0) return undefined;
    const g = ctx.createGain(); g.gain.value = level; nodes.push(g); g.connect(mixer);
    if (wave === 'noise') { const n = noiseSource(ctx); n.connect(g); sources.push(n); return undefined; }
    const o = ctx.createOscillator();
    if (wave === 'custom' && harmonics?.length) o.setPeriodicWave(periodicWave(ctx, harmonics)); else o.type = wave === 'custom' ? 'sawtooth' : wave;
    if (glide && glideFromFreq && patch.glide > 0) {
      o.frequency.setValueAtTime(Math.max(1, glideFromFreq * (f / freq)), when);
      o.frequency.exponentialRampToValueAtTime(f, when + patch.glide);
    } else {
      o.frequency.value = f;
    }
    o.detune.value = detune;
    for (const m of pitchMods) m.connect(o.detune);
    o.connect(g); sources.push(o);
    return o;
  };

  const f1 = freq * Math.pow(2, patch.osc1.octave);
  const f2 = freq * Math.pow(2, patch.osc2.octave);
  const osc1 = addOsc(patch.osc1.wave, patch.osc1.harmonics, f1, patch.osc1.detune, patch.osc1.level, true);
  for (let u = 1; u <= patch.unison; u++) {
    const spread = patch.unisonSpread * u * (u % 2 ? 1 : -1);
    addOsc(patch.osc1.wave, patch.osc1.harmonics, f1, patch.osc1.detune + spread, (patch.osc1.level * 0.6) / patch.unison, false);
  }
  // stereo width: a slightly detuned copy panned to each side
  if (patch.stereo && patch.stereo > 0) {
    const pL = ctx.createStereoPanner(), pR = ctx.createStereoPanner(); pL.pan.value = -0.7; pR.pan.value = 0.7; nodes.push(pL, pR);
    for (const [pan, sign] of [[pL, -1], [pR, 1]] as const) {
      const g = ctx.createGain(); g.gain.value = patch.osc1.level * 0.45; nodes.push(g); g.connect(pan); pan.connect(mixer);
      const o = ctx.createOscillator();
      if (patch.osc1.wave === 'custom' && patch.osc1.harmonics?.length) o.setPeriodicWave(periodicWave(ctx, patch.osc1.harmonics)); else o.type = patch.osc1.wave === 'noise' || patch.osc1.wave === 'custom' ? 'sawtooth' : patch.osc1.wave;
      o.frequency.value = f1; o.detune.value = patch.osc1.detune + sign * patch.stereo;
      for (const m of pitchMods) m.connect(o.detune);
      o.connect(g); sources.push(o);
    }
  }
  addOsc(patch.osc2.wave, patch.osc2.harmonics, f2, patch.osc2.detune, patch.osc2.level, true);
  if (patch.sub > 0) addOsc('sine', undefined, freq / 2, 0, patch.sub, false);
  if (patch.noise > 0) addOsc('noise', undefined, 0, 0, patch.noise * 0.5, false);
  if (patch.breath && patch.breath > 0) {
    // breath / bow noise: band-passed noise following the note, fading in with the attack
    const n = noiseSource(ctx); sources.push(n);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(12000, freq * 4); bp.Q.value = 0.8; nodes.push(bp);
    const g = ctx.createGain(); g.gain.value = patch.breath * 0.6; nodes.push(g);
    n.connect(bp); bp.connect(g); g.connect(mixer);
  }
  // FM on osc1
  if (osc1 && patch.fm.amount > 0) {
    const mod = ctx.createOscillator(); mod.frequency.value = f1 * patch.fm.ratio; sources.push(mod);
    const mg = ctx.createGain(); nodes.push(mg);
    mod.connect(mg); mg.connect(osc1.frequency);
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
  const voice: Voice = { release: () => {}, kill: () => {} };
  const stopAt = (t: number) => {
    if (ended) return; ended = true;
    for (const s of sources) { try { s.stop(t); } catch { /* already stopped */ } }
    const cleanup = () => { for (const n of nodes) n.disconnect(); for (const s of sources) s.disconnect(); voice.ended = true; };
    if (sources[0]) sources[0].onended = cleanup; else cleanup();
  };
  voice.release = (relWhen: number) => {
    const end = releaseAmp(relWhen);
    if (patch.filter.envAmount !== 0) { holdAt(filter.frequency, relWhen); filter.frequency.setTargetAtTime(baseCut, relWhen, Math.max(0.005, fe.release) / 3); }
    stopAt(end + 0.05);
  };
  voice.kill = () => { holdAt(amp.gain, ctx.currentTime); amp.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.01); stopAt(ctx.currentTime + 0.08); };
  if (duration != null) voice.release(when + Math.max(0.01, duration));
  return voice;
}

// ---------------------------------------------------------------------------
// Karplus-Strong plucked string: a short excitation burst feeds a tuned delay
// loop with lowpass damping; the filter/envelope of the patch shape the result.
// ---------------------------------------------------------------------------

// A DelayNode inside a feedback cycle cannot be shorter than one render quantum (128 samples,
// ≈375 Hz), so the string is synthesised sample by sample in JS into a buffer, which is then
// played and shaped by the patch filter/envelope like any other voice. Buffers are cached per
// (context, pitch, damping, waveform).
const pluckCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
function pluckBuffer(ctx: BaseAudioContext, freq: number, damping: number, harmonics: number[] | undefined, seconds: number): AudioBuffer {
  let m = pluckCache.get(ctx);
  if (!m) { m = new Map(); pluckCache.set(ctx, m); }
  const key = `${freq.toFixed(2)}|${damping.toFixed(2)}|${(harmonics ?? []).map((h) => h.toFixed(2)).join(',')}|${seconds}`;
  const hit = m.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const out = ctx.createBuffer(1, len, sr);
  const data = out.getChannelData(0);
  const L = Math.max(2, Math.round(sr / freq));
  // excitation: noise mixed with one period of the harmonic recipe (brighter/darker attack)
  const line = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    let h = 0;
    if (harmonics?.length) { for (let k = 0; k < harmonics.length; k++) h += harmonics[k] * Math.sin((2 * Math.PI * (k + 1) * i) / L); h *= 0.6; }
    line[i] = (Math.random() * 2 - 1) * 0.7 + h;
  }
  // loop: two-point average lowpass (damping blends between averaged and raw) with slight loss
  const d = Math.min(1, Math.max(0, damping));
  const blend = 0.25 + 0.7 * d;         // 1 = bright (no averaging), low = dark
  const loss = 0.996 + 0.0035 * d - Math.min(0.01, freq / 60000);
  let pos = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[pos];
    const next = line[(pos + 1) % L];
    data[i] = cur;
    line[pos] = (cur * blend + ((cur + next) * 0.5) * (1 - blend)) * loss;
    pos = (pos + 1) % L;
  }
  if (m.size > 400) m.delete(m.keys().next().value!);
  m.set(key, out);
  return out;
}

function playPluck(ctx: BaseAudioContext, dest: AudioNode, patch: SynthPatch, pitch: number, velocity: number, when: number, duration: number | null): Voice {
  const freq = Math.min(8000, Math.max(20, midiToFreq(pitch) * Math.pow(2, patch.osc1.octave)));
  const vel = 0.3 + 0.7 * Math.min(1, Math.max(0, velocity));
  const natural = patch.ampEnv.decay * 2.5 + patch.ampEnv.release;
  const seconds = Math.min(8, Math.max(0.5, natural + 0.3));
  const src = ctx.createBufferSource();
  src.buffer = pluckBuffer(ctx, freq, patch.pluckDamping ?? 0.5, patch.osc1.harmonics, seconds);

  const filter = ctx.createBiquadFilter();
  filter.type = patch.filter.type; filter.Q.value = Math.min(30, Math.max(0.05, patch.filter.resonance));
  const baseCut = Math.min(20000, Math.max(20, patch.filter.cutoff * Math.pow(freq / 261.6, patch.filter.keyTrack)));
  filter.frequency.setValueAtTime(Math.min(20000, Math.max(20, baseCut + patch.filter.envAmount)), when);
  filter.frequency.setTargetAtTime(baseCut, when, Math.max(0.01, patch.filterEnv.decay) / 3);
  const amp = ctx.createGain();
  amp.gain.value = 0.0001;
  src.connect(filter); filter.connect(amp); amp.connect(dest);

  const releaseAmp = adsr(amp.gain, when, patch.gain * vel, patch.ampEnv.attack, patch.ampEnv.decay, patch.ampEnv.sustain, patch.ampEnv.release);
  src.start(when);
  let ended = false;
  const voice: Voice = { release: () => {}, kill: () => {} };
  const stopAt = (t: number) => {
    if (ended) return; ended = true;
    try { src.stop(t); } catch { /* */ }
    src.onended = () => { src.disconnect(); filter.disconnect(); amp.disconnect(); voice.ended = true; };
  };
  voice.release = (relWhen: number) => { const end = releaseAmp(relWhen); stopAt(end + 0.05); };
  voice.kill = () => { holdAt(amp.gain, ctx.currentTime); amp.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.01); stopAt(ctx.currentTime + 0.08); };
  // plucked notes ring for their natural decay even when held longer
  if (duration != null) voice.release(when + Math.max(0.01, Math.min(duration, natural)));
  else stopAt(when + seconds + 0.1);
  return voice;
}

// ---------------------------------------------------------------------------
// Sampler: plays a decoded buffer re-pitched relative to its root note
// ---------------------------------------------------------------------------

export function playSampler(ctx: BaseAudioContext, dest: AudioNode, patch: SamplerPatch, buffer: AudioBuffer, pitch: number, velocity: number, when: number, duration: number | null): Voice {
  const vel = 0.3 + 0.7 * Math.min(1, Math.max(0, velocity));
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = Math.pow(2, (pitch - patch.rootNote) / 12);
  src.loop = patch.loop;
  const amp = ctx.createGain();
  amp.gain.value = 0.0001;
  src.connect(amp); amp.connect(dest);
  const releaseAmp = adsr(amp.gain, when, patch.gain * vel, patch.attack, 0.01, 1, patch.release);
  src.start(when);
  let ended = false;
  const voice: Voice = { release: () => {}, kill: () => {} };
  const stopAt = (t: number) => { if (ended) return; ended = true; try { src.stop(t); } catch { /* */ } src.onended = () => { src.disconnect(); amp.disconnect(); voice.ended = true; }; };
  voice.release = (relWhen: number) => { const end = releaseAmp(relWhen); stopAt(end + 0.05); };
  voice.kill = () => { holdAt(amp.gain, ctx.currentTime); amp.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.01); stopAt(ctx.currentTime + 0.08); };
  if (duration != null) voice.release(when + Math.max(0.01, duration));
  else if (!patch.loop) stopAt(when + buffer.duration / src.playbackRate.value + patch.release + 0.1);
  return voice;
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
  let lp: BiquadFilterNode | null = null;
  if (style === 'lofi') {
    lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500;
    out.disconnect(); out.connect(lp); lp.connect(dest);
  }
  // free everything once the hit has decayed (the lo-fi filter too, or it stays in the graph forever)
  const free = () => { out.disconnect(); lp?.disconnect(); voice.ended = true; };
  const voice: Voice = { release: () => {}, kill: () => { for (const s of stops) s(); free(); } };
  setTimeout(free, Math.max(0, (endTime - ctx.currentTime) * 1000 + 100));
  return voice;
}

export const DRUM_PITCHES = new Set([36, 38, 39, 42, 46, 41, 47, 50, 49, 51, 37, 56, 54, 75, 70, 76]);
