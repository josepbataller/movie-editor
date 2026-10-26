// Microphone recording for the Audio Studio. Captures PCM through the engine's
// AudioContext (so it stays in sync with playback), returns an AudioBuffer, and
// offers input-device listing and a live input level for the UI.

export interface RecordingResult { buffer: AudioBuffer; startedAtCtx: number }

export class Recorder {
  private ctx: AudioContext;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private proc: ScriptProcessorNode | null = null;
  private monitor: GainNode | null = null;
  private chunks: Float32Array[][] = [];
  private channels = 1;
  private startedAtCtx = 0;
  private _level = 0;
  recording = false;

  constructor(ctx: AudioContext) { this.ctx = ctx; }

  static async devices(): Promise<MediaDeviceInfo[]> {
    try {
      // a permission prompt is needed before labels are visible
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch { /* denied: labels stay empty */ }
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  }

  /** Open the input (keeps the mic live for metering); call stopInput() to release it. */
  async openInput(deviceId?: string, monitorTo?: AudioNode) {
    this.stopInput();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    const settings = this.stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { channelCount?: number };
    this.channels = Math.min(2, Math.max(1, settings?.channelCount ?? 1));
    // ScriptProcessor is deprecated but works everywhere (incl. Electron) without a worklet file.
    this.proc = this.ctx.createScriptProcessor(4096, this.channels, this.channels);
    this.proc.onaudioprocess = (e) => {
      let peak = 0;
      const frame: Float32Array[] = [];
      for (let c = 0; c < this.channels; c++) {
        const d = e.inputBuffer.getChannelData(c);
        if (this.recording) frame.push(new Float32Array(d));
        for (let i = 0; i < d.length; i += 8) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
      }
      this._level = peak;
      if (this.recording) this.chunks.push(frame);
    };
    this.source.connect(this.proc);
    // the processor must reach the destination to run (its output is silence)
    const sink = this.ctx.createGain(); sink.gain.value = 0;
    this.proc.connect(sink); sink.connect(this.ctx.destination);
    // monitoring takes the live input straight to the output
    this.monitor = this.ctx.createGain();
    this.monitor.gain.value = 0;
    this.source.connect(this.monitor);
    this.monitor.connect(monitorTo ?? this.ctx.destination);
  }

  setMonitor(on: boolean) { if (this.monitor) this.monitor.gain.value = on ? 1 : 0; }

  get level() { return this._level; }
  get inputOpen() { return !!this.stream; }

  start() {
    if (!this.proc) throw new Error('Input not open');
    this.chunks = [];
    this.recording = true;
    this.startedAtCtx = this.ctx.currentTime;
  }

  stop(): RecordingResult | null {
    if (!this.recording) return null;
    this.recording = false;
    const frames = this.chunks;
    this.chunks = [];
    const length = frames.reduce((n, f) => n + (f[0]?.length ?? 0), 0);
    if (length === 0) return null;
    const buffer = this.ctx.createBuffer(this.channels, length, this.ctx.sampleRate);
    for (let c = 0; c < this.channels; c++) {
      const d = buffer.getChannelData(c);
      let o = 0;
      for (const f of frames) { d.set(f[c] ?? f[0], o); o += (f[c] ?? f[0]).length; }
    }
    return { buffer, startedAtCtx: this.startedAtCtx };
  }

  stopInput() {
    this.recording = false;
    this.proc?.disconnect(); this.source?.disconnect(); this.monitor?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.proc = null; this.source = null; this.stream = null; this.monitor = null;
    this._level = 0;
  }
}
