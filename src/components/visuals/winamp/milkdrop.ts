// MilkDrop tile, powered by Butterchurn (the WebGL2 MilkDrop engine that
// grew out of Ryan Geiss's original MilkDrop). Loaded lazily from a pinned CDN
// only when this tile is opened, so it adds ZERO to the site's build/bundle.
//
// Presets are cycled on a timer (and nudged on strong beats) with a blend, the
// way MilkDrop auto-pilots through its preset library.

import type { AudioEngine } from './audio';

// Pinned so a CDN change can't silently swap the engine underneath us.
const BUTTERCHURN_URL = 'https://esm.sh/butterchurn@2.6.7';
const PRESETS_URL = 'https://esm.sh/butterchurn-presets@2.4.7';

export class MilkdropViz {
  private canvas: HTMLCanvasElement;
  private audio: AudioEngine;
  private visualizer: any = null;
  private presetKeys: string[] = [];
  private presets: Record<string, any> = {};
  private idx = 0;
  private sinceSwitch = 0;
  private switchEvery = 16;         // seconds between auto preset changes
  private connectedTo: AudioNode | null = null;
  private idleOut: AudioNode | null = null;
  private idleNodes: Array<{ stop?: () => void; disconnect: () => void }> = [];
  ready = false;
  failed = false;

  constructor(canvas: HTMLCanvasElement, audio: AudioEngine) {
    this.canvas = canvas;
    this.audio = audio;
  }

  async init(): Promise<void> {
    if (this.ready || this.failed) return;
    try {
      const [bc, bp] = await Promise.all([
        import(/* @vite-ignore */ BUTTERCHURN_URL),
        import(/* @vite-ignore */ PRESETS_URL),
      ]);
      const butterchurn = bc.default || bc;
      const butterchurnPresets = bp.default || bp;

      const ctx = this.audio.getContext();   // shared context so the mic can reach us
      const size = this.backingSize();
      this.visualizer = butterchurn.createVisualizer(ctx, this.canvas, {
        width: size.w,
        height: size.h,
        pixelRatio: 1,
        textureRatio: 1,
      });

      this.presets = butterchurnPresets.getPresets();
      this.presetKeys = Object.keys(this.presets);
      // Open on a reliably lush, full-screen preset (some in the pack are sparse
      // without loud audio); fall back to the middle of the pack.
      const preferred = ['sherwin', 'mother-of-pearl', 'reaction diffusion', 'martian', 'cascading decay'];
      const found = this.presetKeys.findIndex((k) => preferred.some((p) => k.toLowerCase().includes(p)));
      this.idx = found >= 0 ? found : Math.floor(this.presetKeys.length * 0.5) % this.presetKeys.length;
      this.loadCurrent(0);

      this.connectAudio();
      this.ready = true;
    } catch (err) {
      this.failed = true;
      throw err;
    }
  }

  private loadCurrent(blend: number) {
    const key = this.presetKeys[this.idx];
    const preset = this.presets[key];
    if (preset && this.visualizer) this.visualizer.loadPreset(preset, blend);
  }

  next(blend = 2.0) {
    if (!this.presetKeys.length) return;
    this.idx = (this.idx + 1) % this.presetKeys.length;
    this.loadCurrent(blend);
    this.sinceSwitch = 0;
  }

  random(blend = 2.0) {
    if (!this.presetKeys.length) return;
    this.idx = Math.floor(Math.random() * this.presetKeys.length);
    this.loadCurrent(blend);
    this.sinceSwitch = 0;
  }

  /**
   * Feed the visualizer the mic when it's on, otherwise a synthetic "idle"
   * signal so presets stay alive and full even before the mic is enabled —
   * the same courtesy Geiss and Classic get from the AudioEngine's idle wave.
   * (Butterchurn only ever connects the node to its analyser, never to the
   * speakers, so the idle synth is completely silent to the visitor.)
   */
  connectAudio() {
    if (!this.visualizer) return;
    const mic = this.audio.source as AudioNode | null;
    if (mic) {
      if (this.connectedTo !== mic) {
        try { this.idleOut?.disconnect(); } catch (_) {}   // stop the synth feeding the analyser
        try { this.visualizer.connectAudio(mic); this.connectedTo = mic; } catch (_) {}
      }
      return;
    }
    // no mic: drive it with the idle synth
    if (!this.idleOut) this.idleOut = this.buildIdleSource(this.audio.getContext());
    if (this.connectedTo !== this.idleOut) {
      try { this.visualizer.connectAudio(this.idleOut); this.connectedTo = this.idleOut; } catch (_) {}
    }
  }

  /**
   * A gently pulsing, silent audio graph: a kicking bass, a drifting mid tone,
   * and a little high-frequency noise — enough energy across the spectrum to
   * keep MilkDrop presets moving and filling the screen with no mic.
   */
  private buildIdleSource(ctx: AudioContext): AudioNode {
    const out = ctx.createGain(); out.gain.value = 0.9;
    const started: Array<{ start: () => void }> = [];

    // bass with a ~124 BPM kick envelope
    const bass = ctx.createOscillator(); bass.type = 'sine'; bass.frequency.value = 58;
    const bassGain = ctx.createGain(); bassGain.gain.value = 0.0;
    const kick = ctx.createOscillator(); kick.type = 'sine'; kick.frequency.value = 2.05;
    const kickShape = ctx.createGain(); kickShape.gain.value = 0.5;
    const kickBias = ctx.createConstantSource(); kickBias.offset.value = 0.5;
    kick.connect(kickShape); kickShape.connect(bassGain.gain); kickBias.connect(bassGain.gain);
    bass.connect(bassGain); bassGain.connect(out);

    // drifting mid tone
    const mid = ctx.createOscillator(); mid.type = 'triangle'; mid.frequency.value = 320;
    const midGain = ctx.createGain(); midGain.gain.value = 0.28;
    mid.connect(midGain); midGain.connect(out);
    const drift = ctx.createOscillator(); drift.type = 'sine'; drift.frequency.value = 0.07;
    const driftG = ctx.createGain(); driftG.gain.value = 150;
    drift.connect(driftG); driftG.connect(mid.frequency);

    // high-frequency shimmer so the treble band isn't dead
    const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
    const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.10;
    noise.connect(noiseGain); noiseGain.connect(out);

    started.push(bass, kick, kickBias, mid, drift, noise);
    started.forEach((n) => { try { n.start(); } catch (_) {} });
    this.idleNodes = [bass, kick, kickBias, mid, drift, noise, bassGain, kickShape, midGain, driftG, noiseGain, out];
    return out;
  }

  /**
   * Backing-store size for the MilkDrop canvas. Butterchurn is GPU-heavy, so we
   * render at a lower pixel ratio on phones (and cap the longest side) to keep
   * it smooth, while still going crisp on desktops.
   */
  private backingSize(): { w: number; h: number } {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const smallSide = Math.min(window.innerWidth, window.innerHeight);
    const cap = smallSide <= 620 ? 1 : 2;         // treat phones (any orientation) gently
    const pr = Math.min(cap, dpr);
    const MAX = 1920;                              // don't build absurd canvases on 4K/5K
    let w = Math.max(1, Math.floor((r.width || 300) * pr));
    let h = Math.max(1, Math.floor((r.height || 150) * pr));
    if (w > MAX) { h = Math.floor(h * (MAX / w)); w = MAX; }
    return { w, h };
  }

  resize() {
    if (!this.visualizer) return;
    const { w, h } = this.backingSize();
    this.visualizer.setRendererSize(w, h);
  }

  frame(dt: number, _audio: AudioEngine) {
    if (!this.ready || !this.visualizer) return;
    this.connectAudio();
    this.sinceSwitch += dt;
    if (this.sinceSwitch > this.switchEvery) this.next(2.7);
    this.visualizer.render();
  }

  dispose() {
    // The AudioContext is owned by the shared AudioEngine, so we don't close it.
    for (const n of this.idleNodes) { try { n.stop?.(); } catch (_) {} try { n.disconnect(); } catch (_) {} }
    this.idleNodes = [];
    this.idleOut = null;
    this.connectedTo = null;
    this.visualizer = null;
    this.ready = false;
  }
}
