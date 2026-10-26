// Spectral tools for the clip editor: STFT analysis for the spectrogram display and
// time–frequency region processing (attenuate / remove / isolate), plus simple
// sample-domain utilities (normalize, region gain, slicing). Pure TypeScript, no deps.

// ---------------------------------------------------------------------------
// Radix-2 FFT (in place, split real/imag)
// ---------------------------------------------------------------------------

export function fft(re: Float32Array, im: Float32Array, inverse = false) {
  const n = re.length;
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = i + j + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

// ---------------------------------------------------------------------------
// Spectrogram (magnitudes in dB) for display
// ---------------------------------------------------------------------------

export interface Spectrogram {
  frames: number;       // time columns
  bins: number;         // frequency rows (fftSize/2)
  data: Float32Array;   // frames * bins, dB (-100..0)
  sampleRate: number;
  hop: number;          // samples between columns
  fftSize: number;
}

/** Mono spectrogram of [from, to) seconds; `columns` caps the number of time frames. */
export function spectrogram(buffer: AudioBuffer, from: number, to: number, columns = 600, fftSize = 1024): Spectrogram {
  const sr = buffer.sampleRate;
  const s0 = Math.max(0, Math.floor(from * sr)), s1 = Math.min(buffer.length, Math.ceil(to * sr));
  const total = Math.max(fftSize, s1 - s0);
  const hop = Math.max(64, Math.floor(total / columns));
  const frames = Math.max(1, Math.floor((total - fftSize) / hop) + 1);
  const bins = fftSize / 2;
  const data = new Float32Array(frames * bins);
  const win = hann(fftSize);
  const re = new Float32Array(fftSize), im = new Float32Array(fftSize);
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  for (let f = 0; f < frames; f++) {
    const start = s0 + f * hop;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      let v = 0;
      if (idx < s1) for (const ch of chans) v += ch[idx];
      re[i] = (v / chans.length) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const mag = Math.sqrt(re[b] * re[b] + im[b] * im[b]) / (fftSize / 4);
      data[f * bins + b] = Math.max(-100, 20 * Math.log10(mag + 1e-7));
    }
  }
  return { frames, bins, data, sampleRate: sr, hop, fftSize };
}

// ---------------------------------------------------------------------------
// Region processing via STFT / overlap-add (fftSize 2048, hop 512, Hann)
// ---------------------------------------------------------------------------

export interface SpectralRegion {
  t0: number; t1: number;   // seconds (within the buffer)
  f0: number; f1: number;   // Hz
}

/**
 * Multiply the magnitude of bins inside the region by `gain` (0 = remove). With `outside`
 * the complement is processed instead (isolate the region). Returns a new buffer.
 */
export function processRegion(ctxFactory: (ch: number, len: number, sr: number) => AudioBuffer, src: AudioBuffer, region: SpectralRegion, gain: number, outside = false): AudioBuffer {
  const N = 2048, HOP = 512;
  const sr = src.sampleRate;
  const out = ctxFactory(src.numberOfChannels, src.length, sr);
  const win = hann(N);
  // normalisation for Hann with 75% overlap-add
  const norm = new Float32Array(src.length + N);
  for (let start = -N + HOP; start < src.length; start += HOP) {
    for (let i = 0; i < N; i++) { const idx = start + i; if (idx >= 0 && idx < norm.length) norm[idx] += win[i] * win[i]; }
  }
  const re = new Float32Array(N), im = new Float32Array(N);
  const b0 = Math.max(0, Math.floor((region.f0 / sr) * N)), b1 = Math.min(N / 2, Math.ceil((region.f1 / sr) * N));
  const s0 = Math.floor(region.t0 * sr), s1 = Math.ceil(region.t1 * sr);
  const feather = 2; // bins of soft edge

  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const x = src.getChannelData(ch);
    const y = out.getChannelData(ch);
    for (let start = -N + HOP; start < src.length; start += HOP) {
      const frameEnd = start + N;
      const inTime = frameEnd > s0 && start < s1;
      if (!inTime && !outside) {
        // untouched frame: copy through the same analysis/synthesis to keep gain uniform
      }
      for (let i = 0; i < N; i++) { const idx = start + i; re[i] = idx >= 0 && idx < x.length ? x[idx] * win[i] : 0; im[i] = 0; }
      fft(re, im);
      // time weight: 1 inside [s0,s1] (soft edges over one hop), 0 outside
      const centre = start + N / 2;
      let tw = 0;
      if (centre >= s0 && centre <= s1) tw = 1;
      else if (centre > s0 - HOP && centre < s0) tw = (centre - (s0 - HOP)) / HOP;
      else if (centre > s1 && centre < s1 + HOP) tw = 1 - (centre - s1) / HOP;
      for (let b = 0; b <= N / 2; b++) {
        let fw = 0; // frequency weight 0..1 inside the band
        if (b >= b0 && b <= b1) fw = 1;
        else if (b >= b0 - feather && b < b0) fw = (b - (b0 - feather)) / feather;
        else if (b > b1 && b <= b1 + feather) fw = 1 - (b - b1) / feather;
        let w = tw * fw;                       // 1 = fully inside the region
        if (outside) w = 1 - w;                // isolate: process the complement
        const g = 1 + (gain - 1) * w;
        if (g !== 1) {
          re[b] *= g; im[b] *= g;
          if (b > 0 && b < N / 2) { re[N - b] *= g; im[N - b] *= g; }
        }
      }
      fft(re, im, true);
      for (let i = 0; i < N; i++) { const idx = start + i; if (idx >= 0 && idx < y.length) y[idx] += re[i] * win[i]; }
    }
    for (let i = 0; i < y.length; i++) if (norm[i] > 1e-6) y[i] /= norm[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sample-domain helpers
// ---------------------------------------------------------------------------

export function cloneBuffer(ctxFactory: (ch: number, len: number, sr: number) => AudioBuffer, src: AudioBuffer): AudioBuffer {
  const out = ctxFactory(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) out.getChannelData(c).set(src.getChannelData(c));
  return out;
}

/** Peak-normalize to `peakDb` (default -1 dBFS). */
export function normalize(ctxFactory: (ch: number, len: number, sr: number) => AudioBuffer, src: AudioBuffer, peakDb = -1): AudioBuffer {
  let peak = 0;
  for (let c = 0; c < src.numberOfChannels; c++) { const d = src.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } }
  const out = cloneBuffer(ctxFactory, src);
  if (peak < 1e-6) return out;
  const g = Math.pow(10, peakDb / 20) / peak;
  for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
  return out;
}

/** Apply a gain (linear) to [t0, t1) seconds with 5 ms edges. */
export function gainRegion(ctxFactory: (ch: number, len: number, sr: number) => AudioBuffer, src: AudioBuffer, t0: number, t1: number, gain: number): AudioBuffer {
  const out = cloneBuffer(ctxFactory, src);
  const sr = src.sampleRate, s0 = Math.max(0, Math.floor(t0 * sr)), s1 = Math.min(src.length, Math.ceil(t1 * sr)), edge = Math.floor(sr * 0.005);
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = s0; i < s1; i++) {
      let w = 1;
      if (i - s0 < edge) w = (i - s0) / edge; else if (s1 - i < edge) w = (s1 - i) / edge;
      d[i] *= 1 + (gain - 1) * w;
    }
  }
  return out;
}

/** Extract [t0, t1) seconds into a new buffer. */
export function slice(ctxFactory: (ch: number, len: number, sr: number) => AudioBuffer, src: AudioBuffer, t0: number, t1: number): AudioBuffer {
  const sr = src.sampleRate, s0 = Math.max(0, Math.floor(t0 * sr)), s1 = Math.min(src.length, Math.ceil(t1 * sr));
  const out = ctxFactory(src.numberOfChannels, Math.max(1, s1 - s0), sr);
  for (let c = 0; c < src.numberOfChannels; c++) out.getChannelData(c).set(src.getChannelData(c).subarray(s0, s1));
  return out;
}

export function reverseBuffer(ctxFactory: (ch: number, len: number, sr: number) => AudioBuffer, src: AudioBuffer): AudioBuffer {
  const out = cloneBuffer(ctxFactory, src);
  for (let c = 0; c < out.numberOfChannels; c++) out.getChannelData(c).reverse();
  return out;
}
