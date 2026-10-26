import type { AudioEffect, EqBand } from '@/shared/audioTypes';

// Builds Web Audio sub-graphs for the Audio Studio effects. Works with both the
// real-time AudioContext and an OfflineAudioContext (export), so what you hear is
// what you render.

export interface FxNode {
  input: AudioNode;
  output: AudioNode;
  /** Apply parameter changes without rebuilding (same effect type). */
  update: (fx: AudioEffect) => void;
  dispose: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function passthrough(ctx: BaseAudioContext): FxNode {
  const g = ctx.createGain();
  return { input: g, output: g, update: () => {}, dispose: () => g.disconnect() };
}

/** wet/dry mixer: input -> dry -> out ; input -> (wetChain) -> wet -> out */
function wetDry(ctx: BaseAudioContext, mix: number) {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const out = ctx.createGain();
  input.connect(dry); dry.connect(out); wet.connect(out);
  dry.gain.value = 1 - mix; wet.gain.value = mix;
  return { input, dry, wet, out, setMix(m: number) { dry.gain.value = 1 - m; wet.gain.value = m; } };
}

// ---------------------------------------------------------------------------

function buildEq(ctx: BaseAudioContext, fx: Extract<AudioEffect, { type: 'eq' }>): FxNode {
  const input = ctx.createGain();
  const output = ctx.createGain();
  let filters: BiquadFilterNode[] = [];
  const apply = (bands: EqBand[]) => {
    const enabled = bands.filter((b) => b.enabled);
    if (filters.length !== enabled.length) {
      input.disconnect(); filters.forEach((f) => f.disconnect());
      filters = enabled.map(() => ctx.createBiquadFilter());
      let prev: AudioNode = input;
      for (const f of filters) { prev.connect(f); prev = f; }
      prev.connect(output);
    }
    enabled.forEach((b, i) => {
      const f = filters[i];
      f.type = b.type;
      f.frequency.value = clamp(b.frequency, 20, 20000);
      f.gain.value = b.gain;
      f.Q.value = clamp(b.q, 0.05, 30);
    });
  };
  apply(fx.bands);
  return { input, output, update: (f) => f.type === 'eq' && apply(f.bands), dispose: () => { input.disconnect(); filters.forEach((f) => f.disconnect()); output.disconnect(); } };
}

function buildFilter(ctx: BaseAudioContext, fx: Extract<AudioEffect, { type: 'filter' }>): FxNode {
  const f = ctx.createBiquadFilter();
  const apply = (x: typeof fx) => { f.type = x.mode; f.frequency.value = clamp(x.frequency, 20, 20000); f.Q.value = clamp(x.q, 0.05, 30); };
  apply(fx);
  return { input: f, output: f, update: (x) => x.type === 'filter' && apply(x), dispose: () => f.disconnect() };
}

const irCache = new Map<string, AudioBuffer>();
function impulse(ctx: BaseAudioContext, decay: number, tone: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${decay.toFixed(2)}:${tone.toFixed(2)}`;
  const hit = irCache.get(key);
  if (hit) return hit;
  const len = Math.max(1, Math.floor(ctx.sampleRate * clamp(decay, 0.1, 12)));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  // tone: 0 = dark (fast high-frequency damping), 1 = bright
  const damp = 0.15 + 0.8 * clamp(tone, 0, 1);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const n = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2);
      lp += (n - lp) * damp; // one-pole lowpass applied progressively
      d[i] = lp * (1 - t * 0.3) + n * 0.15 * tone;
    }
  }
  if (irCache.size > 12) irCache.delete(irCache.keys().next().value!);
  irCache.set(key, buf);
  return buf;
}

function buildReverb(ctx: BaseAudioContext, fx: Extract<AudioEffect, { type: 'reverb' }>): FxNode {
  const m = wetDry(ctx, fx.mix);
  const pre = ctx.createDelay(1);
  const conv = ctx.createConvolver();
  m.input.connect(pre); pre.connect(conv); conv.connect(m.wet);
  const apply = (x: typeof fx) => { pre.delayTime.value = clamp(x.preDelay, 0, 0.5); conv.buffer = impulse(ctx, x.decay, x.tone); m.setMix(clamp(x.mix, 0, 1)); };
  apply(fx);
  return { input: m.input, output: m.out, update: (x) => x.type === 'reverb' && apply(x), dispose: () => { m.input.disconnect(); pre.disconnect(); conv.disconnect(); m.out.disconnect(); } };
}

function buildDelay(ctx: BaseAudioContext, fx: Extract<AudioEffect, { type: 'delay' }>, bpm: number): FxNode {
  const m = wetDry(ctx, fx.mix);
  const dL = ctx.createDelay(5), dR = ctx.createDelay(5);
  const fb = ctx.createGain();
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass';
  const panL = ctx.createStereoPanner(), panR = ctx.createStereoPanner();
  const merge = ctx.createGain();
  // input -> dL -> panL -> wet ; dL -> dR (ping-pong) -> panR -> wet ; dR -> tone -> fb -> dL
  m.input.connect(dL);
  dL.connect(panL); panL.connect(merge);
  dL.connect(dR); dR.connect(panR); panR.connect(merge);
  dR.connect(tone); tone.connect(fb); fb.connect(dL);
  merge.connect(m.wet);
  const apply = (x: typeof fx) => {
    const t = x.sync ? (60 / bpm) * x.division : x.time;
    dL.delayTime.value = clamp(t, 0.01, 5);
    dR.delayTime.value = clamp(t, 0.01, 5);
    fb.gain.value = clamp(x.feedback, 0, 0.95);
    tone.frequency.value = 400 + Math.pow(clamp(x.tone, 0, 1), 1.5) * 15000;
    panL.pan.value = x.pingPong ? -0.8 : 0;
    panR.pan.value = x.pingPong ? 0.8 : 0;
    m.setMix(clamp(x.mix, 0, 1));
  };
  apply(fx);
  return { input: m.input, output: m.out, update: (x) => x.type === 'delay' && apply(x), dispose: () => [m.input, dL, dR, fb, tone, panL, panR, merge, m.out].forEach((n) => n.disconnect()) };
}

function buildCompressor(ctx: BaseAudioContext, fx: Extract<AudioEffect, { type: 'compressor' }>): FxNode {
  const c = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  c.connect(makeup);
  const apply = (x: typeof fx) => {
    c.threshold.value = clamp(x.threshold, -60, 0); c.ratio.value = clamp(x.ratio, 1, 20); c.attack.value = clamp(x.attack, 0, 1);
    c.release.value = clamp(x.release, 0.01, 1); c.knee.value = clamp(x.knee, 0, 40); makeup.gain.value = Math.pow(10, clamp(x.makeup, 0, 24) / 20);
  };
  apply(fx);
  return { input: c, output: makeup, update: (x) => x.type === 'compressor' && apply(x), dispose: () => { c.disconnect(); makeup.disconnect(); } };
}

function distortionCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 2048, curve = new Float32Array(n);
  const k = 1 + drive * 60;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function buildDistortion(ctx: BaseAudioContext, fx: Extract<AudioEffect, { type: 'distortion' }>): FxNode {
  const m = wetDry(ctx, fx.mix);
  const pre = ctx.createGain();
  const shaper = ctx.createWaveShaper(); shaper.oversample = '4x';
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass';
  const post = ctx.createGain();
  m.input.connect(pre); pre.connect(shaper); shaper.connect(tone); tone.connect(post); post.connect(m.wet);
  const apply = (x: typeof fx) => {
    shaper.curve = distortionCurve(clamp(x.drive, 0, 1));
    pre.gain.value = 1 + x.drive * 3;
    post.gain.value = 1 / (1 + x.drive * 2);
    tone.frequency.value = 800 + Math.pow(clamp(x.tone, 0, 1), 1.5) * 14000;
    m.setMix(clamp(x.mix, 0, 1));
  };
  apply(fx);
  return { input: m.input, output: m.out, update: (x) => x.type === 'distortion' && apply(x), dispose: () => [m.input, pre, shaper, tone, post, m.out].forEach((n) => n.disconnect()) };
}

function buildChorus(ctx: BaseAudioContext, fx: Extract<AudioEffect, { type: 'chorus' }>): FxNode {
  const m = wetDry(ctx, fx.mix);
  const d1 = ctx.createDelay(0.1), d2 = ctx.createDelay(0.1);
  const lfo = ctx.createOscillator(); lfo.type = 'sine';
  const depth1 = ctx.createGain(), depth2 = ctx.createGain();
  const p1 = ctx.createStereoPanner(), p2 = ctx.createStereoPanner();
  p1.pan.value = -0.6; p2.pan.value = 0.6;
  m.input.connect(d1); m.input.connect(d2);
  d1.connect(p1); d2.connect(p2); p1.connect(m.wet); p2.connect(m.wet);
  lfo.connect(depth1); lfo.connect(depth2); depth1.connect(d1.delayTime); depth2.connect(d2.delayTime);
  depth2.gain.value = -1; // inverted modulation on the second voice
  lfo.start();
  const apply = (x: typeof fx) => {
    d1.delayTime.value = 0.02; d2.delayTime.value = 0.027;
    lfo.frequency.value = clamp(x.rate, 0.05, 10);
    depth1.gain.value = clamp(x.depth, 0, 0.02);
    depth2.gain.value = -clamp(x.depth, 0, 0.02);
    m.setMix(clamp(x.mix, 0, 1));
  };
  apply(fx);
  return { input: m.input, output: m.out, update: (x) => x.type === 'chorus' && apply(x), dispose: () => { try { lfo.stop(); } catch { /* */ } [m.input, d1, d2, lfo, depth1, depth2, p1, p2, m.out].forEach((n) => n.disconnect()); } };
}

function crushCurve(bits: number): Float32Array<ArrayBuffer> {
  const n = 4096, curve = new Float32Array(n);
  const steps = Math.pow(2, clamp(bits, 2, 16));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}

function buildBitcrusher(ctx: BaseAudioContext, fx: Extract<AudioEffect, { type: 'bitcrusher' }>): FxNode {
  const m = wetDry(ctx, fx.mix);
  const shaper = ctx.createWaveShaper();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  m.input.connect(shaper); shaper.connect(lp); lp.connect(m.wet);
  const apply = (x: typeof fx) => {
    shaper.curve = crushCurve(x.bits);
    // "downsample" is emulated with a steep lowpass at the implied Nyquist frequency
    lp.frequency.value = clamp(ctx.sampleRate / 2 / Math.max(1, x.downsample), 200, 20000);
    m.setMix(clamp(x.mix, 0, 1));
  };
  apply(fx);
  return { input: m.input, output: m.out, update: (x) => x.type === 'bitcrusher' && apply(x), dispose: () => [m.input, shaper, lp, m.out].forEach((n) => n.disconnect()) };
}

export function buildEffect(ctx: BaseAudioContext, fx: AudioEffect, bpm: number): FxNode {
  if (!fx.enabled) return passthrough(ctx);
  switch (fx.type) {
    case 'eq': return buildEq(ctx, fx);
    case 'filter': return buildFilter(ctx, fx);
    case 'reverb': return buildReverb(ctx, fx);
    case 'delay': return buildDelay(ctx, fx, bpm);
    case 'compressor': return buildCompressor(ctx, fx);
    case 'distortion': return buildDistortion(ctx, fx);
    case 'chorus': return buildChorus(ctx, fx);
    case 'bitcrusher': return buildBitcrusher(ctx, fx);
    default: return passthrough(ctx);
  }
}

/** Frequency response (dB) of an EQ at the given frequencies — for the EQ curve display. */
export function eqResponse(ctx: BaseAudioContext, bands: EqBand[], freqs: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const total = new Float32Array(freqs.length);
  const mag = new Float32Array(freqs.length);
  const phase = new Float32Array(freqs.length);
  const f = ctx.createBiquadFilter();
  for (const b of bands) {
    if (!b.enabled) continue;
    f.type = b.type; f.frequency.value = clamp(b.frequency, 20, 20000); f.gain.value = b.gain; f.Q.value = clamp(b.q, 0.05, 30);
    f.getFrequencyResponse(freqs, mag, phase);
    for (let i = 0; i < freqs.length; i++) total[i] += 20 * Math.log10(Math.max(1e-6, mag[i]));
  }
  return total;
}
