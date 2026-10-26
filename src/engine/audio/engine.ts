import {
  AudioSession, StudioTrack, StudioClip, SampleClip, PatternClip, InstrumentSettings, beatsToSeconds, midiToFreq,
} from '@/shared/audioTypes';
import type { MediaAsset } from '@/shared/types';
import { buildEffect, FxNode } from './effects';
import { playSynth, playDrum, Voice } from './instruments';

// Audio Studio engine: Web Audio graph (tracks -> effects -> gain/pan -> master -> fx -> out),
// sample playback with fades, note scheduling for instrument tracks, metronome, loop,
// metering, and an offline renderer that reuses the exact same graph builders.

const LOOKAHEAD = 0.12;      // seconds scheduled ahead of time
const TICK_MS = 25;

interface TrackChain {
  input: GainNode;
  fx: FxNode[];
  fxIds: string[];      // effect ids + types + enabled, to detect structural changes
  gain: GainNode;
  pan: StereoPannerNode;
  analyser: AnalyserNode;
  track: StudioTrack;
}

interface ScheduledSample { source: AudioBufferSourceNode; gain: GainNode; clipId: string }

export class StudioEngine {
  readonly ctx: AudioContext;
  private buffers = new Map<string, AudioBuffer>();         // assetId -> decoded
  private failed = new Set<string>();                        // assets that could not be decoded (don't retry per mutation)
  private reversed = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private chains = new Map<string, TrackChain>();
  private masterIn: GainNode;
  private masterFx: FxNode[] = [];
  private masterFxIds: string[] = [];
  private masterGain: GainNode;
  readonly masterAnalyser: AnalyserNode;
  private session: AudioSession | null = null;
  private assets: MediaAsset[] = [];

  // transport
  private _playing = false;
  private startCtxTime = 0;
  private startPos = 0;
  /** Gapless loop: the clock jumps back by loopLen when ctx time reaches atCtx. */
  private pendingWrap: { atCtx: number; loopLen: number } | null = null;
  private scheduledUntil = 0;     // timeline seconds already scheduled (notes/metronome)
  private samples: ScheduledSample[] = [];
  private voices: Voice[] = [];
  private timer: number | null = null;
  private lastFreq = new Map<string, number>();  // per-track last note frequency (glide)
  private liveVoices = new Map<string, Voice>(); // preview notes by key
  onLoop: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.masterIn = this.ctx.createGain();
    this.masterGain = this.ctx.createGain();
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 2048;
    this.masterAnalyser.smoothingTimeConstant = 0.8;
    this.masterIn.connect(this.masterGain);
    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);
  }

  get playing() { return this._playing; }

  /** Current timeline position in seconds. */
  position(): number {
    if (!this._playing) return this.startPos;
    if (this.pendingWrap && this.ctx.currentTime >= this.pendingWrap.atCtx) {
      this.startPos -= this.pendingWrap.loopLen;
      this.pendingWrap = null;
      this.onLoop?.();
    }
    return this.startPos + (this.ctx.currentTime - this.startCtxTime);
  }

  // ---------------------------------------------------------------------------
  // Buffers
  // ---------------------------------------------------------------------------

  async loadAsset(asset: MediaAsset): Promise<AudioBuffer | null> {
    if (this.buffers.has(asset.id)) return this.buffers.get(asset.id)!;
    if (this.failed.has(asset.id)) return null;
    if (this.loading.has(asset.id)) return this.loading.get(asset.id)!;
    const p = (async () => {
      try {
        let data: ArrayBuffer;
        try {
          data = await (await fetch(window.api.fileUrl(asset.path))).arrayBuffer();
          const buf = await this.ctx.decodeAudioData(data.slice(0));
          this.buffers.set(asset.id, buf);
          return buf;
        } catch {
          // container not decodable by Chromium (e.g. some mkv/wmv): let FFmpeg extract a WAV
          const wav = await window.api.extractWav(asset.path);
          if (!wav) { this.failed.add(asset.id); return null; }
          data = await (await fetch(window.api.fileUrl(wav))).arrayBuffer();
          const buf = await this.ctx.decodeAudioData(data);
          this.buffers.set(asset.id, buf);
          return buf;
        }
      } catch {
        this.failed.add(asset.id);
        return null;
      } finally {
        this.loading.delete(asset.id);
      }
    })();
    this.loading.set(asset.id, p);
    return p;
  }

  getBuffer(assetId: string): AudioBuffer | undefined { return this.buffers.get(assetId); }

  private reversedBuffer(assetId: string): AudioBuffer | undefined {
    const b = this.buffers.get(assetId);
    if (!b) return undefined;
    let r = this.reversed.get(assetId);
    if (!r) {
      r = this.ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
      for (let ch = 0; ch < b.numberOfChannels; ch++) {
        const src = b.getChannelData(ch), dst = r.getChannelData(ch);
        for (let i = 0, n = b.length; i < n; i++) dst[i] = src[n - 1 - i];
      }
      this.reversed.set(assetId, r);
    }
    return r;
  }

  async preload(session: AudioSession, assets: MediaAsset[]) {
    const ids = new Set(session.clips.filter((c): c is SampleClip => c.type === 'sample').map((c) => c.assetId));
    await Promise.all([...ids].map((id) => { const a = assets.find((x) => x.id === id); return a ? this.loadAsset(a) : null; }));
  }

  // ---------------------------------------------------------------------------
  // Graph
  // ---------------------------------------------------------------------------

  /** Apply a session: rebuild chains structurally when needed, otherwise just update params. */
  apply(session: AudioSession, assets: MediaAsset[]) {
    this.session = session;
    this.assets = assets;
    const ctx = this.ctx;
    const anySolo = session.tracks.some((t) => t.solo);

    // remove chains of deleted tracks
    for (const [id, ch] of this.chains) {
      if (!session.tracks.some((t) => t.id === id)) { this.disposeChain(ch); this.chains.delete(id); }
    }
    for (const track of session.tracks) {
      let ch = this.chains.get(track.id);
      const fxIds = track.effects.map((e) => `${e.id}:${e.type}:${e.enabled}`);
      if (!ch) {
        ch = this.buildChain(ctx, track, session.bpm);
        this.chains.set(track.id, ch);
      } else if (fxIds.join('|') !== ch.fxIds.join('|')) {
        this.rebuildFx(ch, track, session.bpm);
      } else {
        track.effects.forEach((e, i) => ch!.fx[i].update(e, session.bpm));
      }
      ch.track = track;
      const audible = !track.muted && (!anySolo || track.solo);
      ch.gain.gain.setTargetAtTime(audible ? track.gain : 0, ctx.currentTime, 0.01);
      ch.pan.pan.setTargetAtTime(track.pan, ctx.currentTime, 0.01);
    }
    // master
    const mIds = session.masterEffects.map((e) => `${e.id}:${e.type}:${e.enabled}`);
    if (mIds.join('|') !== this.masterFxIds.join('|')) {
      this.masterIn.disconnect(); this.masterFx.forEach((f) => f.dispose());
      this.masterFx = session.masterEffects.map((e) => buildEffect(ctx, e, session.bpm));
      this.masterFxIds = mIds;
      let prev: AudioNode = this.masterIn;
      for (const f of this.masterFx) { prev.connect(f.input); prev = f.output; }
      prev.connect(this.masterGain);
    } else {
      session.masterEffects.forEach((e, i) => this.masterFx[i].update(e, session.bpm));
    }
    this.masterGain.gain.setTargetAtTime(session.masterGain, ctx.currentTime, 0.01);
  }

  private buildChain(ctx: BaseAudioContext, track: StudioTrack, bpm: number): TrackChain {
    const input = ctx.createGain();
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.6;
    const ch: TrackChain = { input, fx: [], fxIds: [], gain, pan, analyser, track };
    this.rebuildFx(ch, track, bpm, ctx);
    gain.connect(pan); pan.connect(analyser);
    analyser.connect(ctx === this.ctx ? this.masterIn : (this.offlineMasterIn ?? ctx.destination));
    return ch;
  }

  private offlineMasterIn: GainNode | null = null;

  private rebuildFx(ch: TrackChain, track: StudioTrack, bpm: number, ctx: BaseAudioContext = this.ctx) {
    ch.input.disconnect(); ch.fx.forEach((f) => f.dispose());
    ch.fx = track.effects.map((e) => buildEffect(ctx, e, bpm));
    ch.fxIds = track.effects.map((e) => `${e.id}:${e.type}:${e.enabled}`);
    let prev: AudioNode = ch.input;
    for (const f of ch.fx) { prev.connect(f.input); prev = f.output; }
    prev.connect(ch.gain);
  }

  private disposeChain(ch: TrackChain) {
    ch.input.disconnect(); ch.fx.forEach((f) => f.dispose()); ch.gain.disconnect(); ch.pan.disconnect(); ch.analyser.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  async play(from: number) {
    if (!this.session) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    await this.preload(this.session, this.assets); // otherwise not-yet-decoded clips would be skipped
    this.stopSources();
    this._playing = true;
    this.pendingWrap = null;
    this.startPos = from;
    this.startCtxTime = this.ctx.currentTime + 0.05;
    this.scheduledUntil = from;
    const loop = this.session.loop;
    const loopActive = loop.enabled && loop.end > loop.start + 0.05 && from < loop.end;
    this.scheduleSamples(from, this.ctx, this.chains, undefined, loopActive ? loop.end : Infinity);
    this.tick();
    if (this.timer == null) this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(keepPosition = true) {
    const pos = this.position();
    this._playing = false;
    this.pendingWrap = null;
    if (this.timer != null) { window.clearInterval(this.timer); this.timer = null; }
    this.stopSources();
    for (const v of this.liveVoices.values()) v.release(this.ctx.currentTime);
    this.liveVoices.clear();
    this.startPos = keepPosition ? pos : this.startPos;
  }

  seek(t: number) {
    const wasPlaying = this._playing;
    if (wasPlaying) this.stop();
    this.startPos = Math.max(0, t);
    if (wasPlaying) void this.play(this.startPos);
  }

  private stopSources() {
    const now = this.ctx.currentTime;
    for (const s of this.samples) {
      try { s.gain.gain.cancelScheduledValues(now); s.gain.gain.setTargetAtTime(0, now, 0.005); s.source.stop(now + 0.03); } catch { /* */ }
    }
    this.samples = [];
    for (const v of this.voices) v.kill();
    this.voices = [];
  }

  /** Called every TICK_MS: schedules notes / metronome ahead of time; wraps the loop gaplessly. */
  private tick() {
    if (!this._playing || !this.session) return;
    const s = this.session;
    const pos = this.position();
    // prune finished voices so long sessions don't accumulate them
    if (this.voices.length > 64) this.voices = this.voices.filter((v) => !v.ended);
    const toCtx = (t: number) => this.startCtxTime + (t - this.startPos);
    const loop = s.loop;
    const loopActive = loop.enabled && loop.end > loop.start + 0.05 && this.scheduledUntil <= loop.end;
    let until = pos + LOOKAHEAD;

    if (loopActive && until >= loop.end && !this.pendingWrap) {
      // Schedule up to the loop end, then pre-schedule the start of the next pass so there is no gap.
      this.scheduleNotes(this.ctx, this.scheduledUntil, loop.end, toCtx);
      if (s.metronome) this.scheduleMetronome(this.scheduledUntil, loop.end);
      const loopLen = loop.end - loop.start;
      const wrapCtx = toCtx(loop.end);
      const after = (t: number) => wrapCtx + (t - loop.start);     // timeline t (>= loop.start) in the next pass
      const nextUntil = loop.start + (until - loop.end);
      this.scheduleSamples(loop.start, this.ctx, this.chains, after, loop.end);
      this.scheduleNotes(this.ctx, loop.start, nextUntil, after);
      if (s.metronome) this.scheduleMetronome(loop.start, nextUntil, after);
      this.pendingWrap = { atCtx: wrapCtx, loopLen };
      this.scheduledUntil = nextUntil;
      return;
    }
    if (this.pendingWrap) {
      // between pre-scheduling and the actual wrap: keep scheduling the next pass
      const after = (t: number) => this.pendingWrap!.atCtx + (t - loop.start);
      const nextUntil = Math.min(loop.start + (until - loop.end), loop.end);
      if (nextUntil > this.scheduledUntil) {
        this.scheduleNotes(this.ctx, this.scheduledUntil, nextUntil, after);
        if (s.metronome) this.scheduleMetronome(this.scheduledUntil, nextUntil, after);
        this.scheduledUntil = nextUntil;
      }
      return;
    }
    if (loop.enabled && loop.end > loop.start + 0.05) until = Math.min(until, loop.end);
    if (until <= this.scheduledUntil) return;
    this.scheduleNotes(this.ctx, this.scheduledUntil, until, toCtx);
    if (s.metronome) this.scheduleMetronome(this.scheduledUntil, until);
    this.scheduledUntil = until;
  }

  private metroOut: GainNode | null = null;
  private scheduleMetronome(fromT: number, toT: number, toCtx?: (t: number) => number) {
    const s = this.session!;
    const beat = 60 / s.bpm;
    const map = toCtx ?? ((t: number) => this.startCtxTime + (t - this.startPos));
    if (!this.metroOut) { this.metroOut = this.ctx.createGain(); this.metroOut.gain.value = 0.5; this.metroOut.connect(this.masterGain); }
    let b = Math.ceil(fromT / beat - 1e-6);
    for (; b * beat < toT; b++) {
      const t = map(b * beat);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = b % s.beatsPerBar === 0 ? 1600 : 1000;
      g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(g); g.connect(this.metroOut);
      o.start(t); o.stop(t + 0.06);
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduling (shared by live playback and offline rendering)
  // ---------------------------------------------------------------------------

  /** Schedule every sample clip that is playing at or after `from`. */
  private scheduleSamples(from: number, ctx: BaseAudioContext = this.ctx, chains: Map<string, TrackChain> = this.chains, toCtx?: (t: number) => number, limit = Infinity) {
    const s = this.session!;
    const map = toCtx ?? ((t: number) => this.startCtxTime + (t - this.startPos));
    for (const clip of s.clips) {
      if (clip.type !== 'sample') continue;
      const end = clip.start + clip.duration;
      if (end <= from || clip.start >= limit) continue;
      const chain = chains.get(clip.trackId);
      const buffer = clip.reverse ? this.reversedBuffer(clip.assetId) : this.buffers.get(clip.assetId);
      if (!chain || !buffer) continue;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = clip.rate;
      const gain = ctx.createGain();
      source.connect(gain); gain.connect(chain.input);

      const startT = Math.max(from, clip.start);        // timeline time where playback begins
      const local = startT - clip.start;                // seconds into the clip
      let offset = clip.inPoint + local * clip.rate;
      if (clip.reverse) offset = Math.max(0, buffer.duration - (clip.inPoint + clip.duration * clip.rate) + local * clip.rate);
      const when = map(startT);
      const playDur = Math.min(end, limit) - startT;
      this.scheduleClipGain(gain.gain, clip, local, when, playDur);
      try {
        // start()'s duration argument is in buffer seconds (ignores playbackRate): stop() instead
        source.start(when, Math.max(0, Math.min(offset, buffer.duration - 0.001)));
        source.stop(when + playDur + 0.002);
      } catch { continue; }
      if (ctx === this.ctx) this.samples.push({ source, gain, clipId: clip.id });
    }
  }

  /** Clip gain with fade in/out, starting `local` seconds into the clip at ctx time `when`. */
  private scheduleClipGain(param: AudioParam, clip: StudioClip, local: number, when: number, playDur: number) {
    const g = clip.gain;
    const value = (t: number) => { // gain at local time t
      let f = 1;
      if (clip.fadeIn > 0 && t < clip.fadeIn) f = Math.min(f, shape(t / clip.fadeIn, clip.fadeCurve));
      if (clip.fadeOut > 0 && t > clip.duration - clip.fadeOut) f = Math.min(f, shape((clip.duration - t) / clip.fadeOut, clip.fadeCurve));
      return Math.max(0, f) * g;
    };
    const hasFade = clip.fadeIn > 0 || clip.fadeOut > 0;
    param.cancelScheduledValues(when);
    if (!hasFade) { param.setValueAtTime(g, when); return; }
    // sample the envelope over the played range (64+ points) – handles any curve and mid-fade starts
    const n = Math.max(16, Math.min(512, Math.ceil(playDur * 40)));
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = value(local + (playDur * i) / (n - 1));
    param.setValueAtTime(curve[0], when);
    try { param.setValueCurveAtTime(curve, when + 0.0001, Math.max(0.001, playDur - 0.0002)); } catch { param.setValueAtTime(g, when); }
  }

  /** Schedule notes of all pattern clips whose absolute time is in [fromT, toT). */
  private scheduleNotes(ctx: BaseAudioContext, fromT: number, toT: number, toCtx: (t: number) => number, chains: Map<string, TrackChain> = this.chains, collect?: Voice[]) {
    const s = this.session!;
    for (const clip of s.clips) {
      if (clip.type !== 'pattern') continue;
      const chain = chains.get(clip.trackId);
      const inst = chain?.track.instrument;
      if (!chain || !inst) continue;
      const clipEnd = clip.start + clip.duration;
      const ordered = [...clip.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch); // glide follows time order
      for (const n of ordered) {
        const t = clip.start + beatsToSeconds(n.start, s.bpm);
        if (t < fromT || t >= toT || t >= clipEnd) continue;
        const dur = Math.min(beatsToSeconds(n.length, s.bpm), clipEnd - t);
        const v = this.trigger(ctx, chain.input, inst, n.pitch, n.velocity, toCtx(t), dur, clip.trackId);
        if (v) (collect ?? this.voices).push(v);
      }
    }
  }

  private trigger(ctx: BaseAudioContext, dest: AudioNode, inst: InstrumentSettings, pitch: number, velocity: number, when: number, duration: number | null, trackId: string): Voice | null {
    if (inst.kind === 'drums') return playDrum(ctx, dest, inst, pitch, velocity, when);
    const prev = this.lastFreq.get(trackId) ?? null;
    this.lastFreq.set(trackId, midiToFreq(pitch));
    return playSynth(ctx, dest, inst, pitch, velocity, when, duration, inst.glide > 0 ? prev : null);
  }

  // ---------------------------------------------------------------------------
  // Live preview (virtual keyboard / drum pads)
  // ---------------------------------------------------------------------------

  async noteOn(trackId: string, pitch: number, velocity = 0.9) {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const chain = this.chains.get(trackId);
    const inst = chain?.track.instrument;
    if (!chain || !inst) return;
    const key = `${trackId}:${pitch}`;
    this.liveVoices.get(key)?.release(this.ctx.currentTime);
    const v = this.trigger(this.ctx, chain.input, inst, pitch, velocity, this.ctx.currentTime + 0.005, inst.kind === 'drums' ? null : null, trackId);
    if (v) this.liveVoices.set(key, v);
  }

  noteOff(trackId: string, pitch: number) {
    const key = `${trackId}:${pitch}`;
    const v = this.liveVoices.get(key);
    if (v) { v.release(this.ctx.currentTime); this.liveVoices.delete(key); }
  }

  /** Audition an instrument without touching the session: plays straight into the master bus. */
  async previewInstrument(inst: InstrumentSettings, pitches: number[], gapMs = 160) {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const out = this.ctx.createGain(); out.gain.value = 0.8; out.connect(this.masterIn);
    const t0 = this.ctx.currentTime + 0.02;
    const voices: Voice[] = [];
    pitches.forEach((p, i) => {
      const when = t0 + (i * gapMs) / 1000;
      const v = inst.kind === 'drums' ? playDrum(this.ctx, out, inst, p, 0.9, when) : playSynth(this.ctx, out, inst, p, 0.9, when, 0.45, null);
      if (v) voices.push(v);
    });
    setTimeout(() => { voices.forEach((v) => v.kill()); out.disconnect(); }, pitches.length * gapMs + 3000);
  }

  /** Audition a sample clip region (e.g. after trimming). */
  async previewAsset(assetId: string, offset = 0, duration = 3) {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const b = this.buffers.get(assetId);
    if (!b) return;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.masterGain);
    s.start(0, Math.min(offset, b.duration - 0.01), duration);
  }

  // ---------------------------------------------------------------------------
  // Metering
  // ---------------------------------------------------------------------------

  /** Analyser of a track (post-fader) or of the master bus — for spectrum displays. */
  getAnalyser(id: string | 'master'): AnalyserNode | null {
    return id === 'master' ? this.masterAnalyser : this.chains.get(id)?.analyser ?? null;
  }

  private levelBuf = new Float32Array(1024);
  /** Peak level 0..1 of a track (or 'master'). */
  level(id: string | 'master'): number {
    const an = id === 'master' ? this.masterAnalyser : this.chains.get(id)?.analyser;
    if (!an) return 0;
    const buf = this.levelBuf.length === an.fftSize ? this.levelBuf : new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }
    return peak;
  }

  // ---------------------------------------------------------------------------
  // Offline rendering (export): same builders on an OfflineAudioContext
  // ---------------------------------------------------------------------------

  async render(session: AudioSession, assets: MediaAsset[], sampleRate = 48000, tail = 2): Promise<AudioBuffer> {
    await this.preload(session, assets);
    const duration = session.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0) + tail;
    const octx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
    const masterIn = octx.createGain();
    const masterGain = octx.createGain(); masterGain.gain.value = session.masterGain;
    const mfx = session.masterEffects.map((e) => buildEffect(octx, e, session.bpm));
    let prev: AudioNode = masterIn;
    for (const f of mfx) { prev.connect(f.input); prev = f.output; }
    prev.connect(masterGain); masterGain.connect(octx.destination);

    const anySolo = session.tracks.some((t) => t.solo);
    const chains = new Map<string, TrackChain>();
    this.offlineMasterIn = masterIn;
    const savedSession = this.session;
    this.session = session;
    try {
      for (const track of session.tracks) {
        const ch = this.buildChain(octx, track, session.bpm);
        const audible = !track.muted && (!anySolo || track.solo);
        ch.gain.gain.value = audible ? track.gain : 0;
        ch.pan.pan.value = track.pan;
        chains.set(track.id, ch);
      }
      this.lastFreq.clear();
      this.scheduleSamples(0, octx, chains, (t) => t, duration);
      this.scheduleNotes(octx, 0, duration, (t) => t, chains, []);
      return await octx.startRendering();
    } finally {
      this.offlineMasterIn = null;
      this.session = savedSession;
      this.lastFreq.clear();
    }
  }

  dispose() {
    this.stop();
    for (const ch of this.chains.values()) this.disposeChain(ch);
    this.chains.clear();
    void this.ctx.close();
  }
}

function shape(p: number, curve: StudioClip['fadeCurve']): number {
  p = Math.min(1, Math.max(0, p));
  switch (curve) {
    case 'exponential': return p * p;
    case 'sCurve': return p * p * (3 - 2 * p);
    default: return p;
  }
}

// ---------------------------------------------------------------------------
// WAV encoding (16-bit PCM) for export / hand-over to the video editor
// ---------------------------------------------------------------------------

export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numCh = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
  const bytes = 44 + len * numCh * 2;
  const ab = new ArrayBuffer(bytes);
  const v = new DataView(ab);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * 2, true); v.setUint16(32, numCh * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len * numCh * 2, true);
  const chans = Array.from({ length: numCh }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return ab;
}

/** Peaks for waveform drawing: `buckets` min/max pairs over [from, to) seconds. */
export function peaks(buffer: AudioBuffer, from: number, to: number, buckets: number): Float32Array {
  const out = new Float32Array(buckets * 2);
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const s0 = Math.max(0, Math.floor(from * buffer.sampleRate));
  const s1 = Math.min(buffer.length, Math.ceil(to * buffer.sampleRate));
  const per = Math.max(1, (s1 - s0) / buckets);
  for (let b = 0; b < buckets; b++) {
    let mn = 1, mx = -1;
    const a = Math.floor(s0 + b * per), e = Math.min(s1, Math.floor(s0 + (b + 1) * per));
    const step = Math.max(1, Math.floor((e - a) / 64));
    for (let i = a; i < e; i += step) {
      const v = (ch0[i] + ch1[i]) * 0.5;
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
    if (e <= a) { mn = 0; mx = 0; }
    out[b * 2] = mn; out[b * 2 + 1] = mx;
  }
  return out;
}

let singleton: StudioEngine | null = null;
export function getEngine(): StudioEngine {
  if (!singleton) singleton = new StudioEngine();
  return singleton;
}
