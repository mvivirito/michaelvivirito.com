// Shared audio analyser for the Winamp-style visualizers.
//
// One AudioContext + AnalyserNode feeds Geiss, the classic bars/scope, and
// (via the raw source node) Butterchurn. When the mic is off we decay the
// band levels and synthesise a slow idle waveform so the visuals still breathe.

export class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  source: MediaStreamAudioSourceNode | null = null;
  stream: MediaStream | null = null;
  on = false;

  freq: Uint8Array<ArrayBuffer>;   // frequency-domain, 0..255
  time: Uint8Array<ArrayBuffer>;   // time-domain (waveform), 0..255 (128 = silence)
  bass = 0;
  mid = 0;
  treble = 0;
  level = 0;               // overall loudness 0..1
  beat = 0;                // 0..1 envelope that spikes on transients
  private beatEnv = 0;
  private idle = 0;

  private readonly fftSize = 2048;

  constructor() {
    this.freq = new Uint8Array(this.fftSize / 2);
    this.time = new Uint8Array(this.fftSize);
  }

  /**
   * The single shared AudioContext. Everything that touches audio — the mic
   * source, our analyser, and Butterchurn's internal analyser — must live in
   * THIS context, or cross-context connections fail silently (which is exactly
   * why MilkDrop looked unreactive). Created lazily on first use.
   */
  getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Turn the mic on. Returns true on success. */
  async enable(): Promise<boolean> {
    if (this.on) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = this.getContext();
      if (ctx.state === 'suspended') await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = this.fftSize;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);
      this.ctx = ctx;
      this.stream = stream;
      this.source = source;
      this.analyser = analyser;
      this.on = true;
      return true;
    } catch (err) {
      return false;
    }
  }

  disable() {
    this.on = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    // Keep the AudioContext around so Butterchurn can reconnect quickly.
  }

  /** Sample the analyser and update band levels. Call once per frame. */
  update(dt: number) {
    if (this.on && this.analyser) {
      this.analyser.getByteFrequencyData(this.freq);
      this.analyser.getByteTimeDomainData(this.time);
      const n = this.freq.length;
      let lo = 0, mi = 0, hi = 0;
      const loEnd = Math.floor(n * 0.08);
      const miEnd = Math.floor(n * 0.4);
      for (let i = 0; i < n; i++) {
        const v = this.freq[i] / 255;
        if (i < loEnd) lo += v;
        else if (i < miEnd) mi += v;
        else hi += v;
      }
      this.bass = Math.min(1, lo / Math.max(1, loEnd));
      this.mid = Math.min(1, mi / Math.max(1, miEnd - loEnd));
      this.treble = Math.min(1, hi / Math.max(1, n - miEnd));
      this.level = Math.min(1, (this.bass * 1.3 + this.mid + this.treble * 0.6) / 2.9);
    } else {
      // Idle: gently synthesise a drifting sine so nothing looks frozen.
      this.idle += dt;
      const t = this.idle;
      const b = 0.32 + 0.28 * Math.sin(t * 1.7) + 0.12 * Math.sin(t * 0.6);
      this.bass += (Math.max(0.05, b) - this.bass) * 0.06;
      this.mid += (0.28 + 0.2 * Math.sin(t * 2.3 + 1.0) - this.mid) * 0.06;
      this.treble += (0.18 + 0.14 * Math.sin(t * 3.1 + 2.0) - this.treble) * 0.06;
      this.level = (this.bass + this.mid + this.treble) / 3;
      const n = this.time.length;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        this.time[i] = 128 + Math.round(
          46 * this.level * (Math.sin(x * 26 + t * 4) + 0.5 * Math.sin(x * 61 - t * 2.5))
        );
      }
      const fn = this.freq.length;
      for (let i = 0; i < fn; i++) {
        const band = i < loEndIdle(fn) ? this.bass : i < midEndIdle(fn) ? this.mid : this.treble;
        const roll = 1 - i / fn;
        this.freq[i] = Math.round(200 * band * roll * (0.6 + 0.4 * Math.sin(i * 0.3 + t * 5)));
      }
    }

    // Beat detection: spike when instantaneous bass jumps above the envelope.
    const flux = Math.max(0, this.bass - this.beatEnv);
    this.beatEnv += (this.bass - this.beatEnv) * (this.bass > this.beatEnv ? 0.5 : 0.06);
    this.beat = Math.min(1, this.beat * 0.9 + flux * 4);
  }
}

function loEndIdle(n: number) { return Math.floor(n * 0.08); }
function midEndIdle(n: number) { return Math.floor(n * 0.4); }
