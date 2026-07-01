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
  private ownCtx: AudioContext | null = null;
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

      const ctx = this.getAudioContext();
      const size = this.backingSize();
      this.visualizer = butterchurn.createVisualizer(ctx, this.canvas, {
        width: size.w,
        height: size.h,
        pixelRatio: 1,
        textureRatio: 1,
      });

      this.presets = butterchurnPresets.getPresets();
      this.presetKeys = Object.keys(this.presets);
      // start somewhere pleasant rather than always the first preset
      this.idx = Math.floor(this.presetKeys.length * 0.5) % this.presetKeys.length;
      this.loadCurrent(0);

      this.connectAudio();
      this.ready = true;
    } catch (err) {
      this.failed = true;
      throw err;
    }
  }

  private getAudioContext(): AudioContext {
    if (this.audio.ctx) return this.audio.ctx;
    if (!this.ownCtx) {
      this.ownCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.ownCtx;
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

  /** (Re)connect the mic source if the engine has audio and we haven't wired it. */
  connectAudio() {
    if (!this.visualizer) return;
    const node = this.audio.source as AudioNode | null;
    if (node && node !== this.connectedTo) {
      try {
        this.visualizer.connectAudio(node);
        this.connectedTo = node;
      } catch (_) { /* ignore */ }
    }
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
    this.connectedTo = null;
    if (this.ownCtx) { try { this.ownCtx.close(); } catch (_) {} this.ownCtx = null; }
    this.visualizer = null;
    this.ready = false;
  }
}
