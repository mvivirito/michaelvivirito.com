// Classic Winamp spectrum analyser + oscilloscope (canvas 2D).
//
// The nostalgic default vis: segmented spectrum bars (green -> yellow -> red)
// with white peak caps that fall back down, plus a green oscilloscope line up
// top. Scaled to fill the screen.

import type { AudioEngine } from './audio';

export class ClassicViz {
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private W = 0;
  private H = 0;
  private bars = 48;
  private peaks: number[] = [];
  private vals: number[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.peaks = new Array(this.bars).fill(0);
    this.vals = new Array(this.bars).fill(0);
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const W = Math.max(1, Math.floor(r.width * this.dpr));
    const H = Math.max(1, Math.floor(r.height * this.dpr));
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.canvas.width = W; this.canvas.height = H;
  }

  private barColor(frac: number): string {
    // frac = height up the bar (0 bottom .. 1 top): green -> yellow -> red
    if (frac < 0.55) return '#27d666';
    if (frac < 0.8) return '#e8e838';
    return '#e8482a';
  }

  frame(dt: number, audio: AudioEngine) {
    this.resize();
    const g = this.ctx;
    const W = this.W, H = this.H;

    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);

    // ---- oscilloscope (top third) ----
    const scopeH = H * 0.3;
    const scopeMid = scopeH * 0.5;
    g.strokeStyle = '#1a6b33';
    g.lineWidth = Math.max(1, this.dpr);
    g.beginPath();
    g.moveTo(0, scopeMid);
    g.lineTo(W, scopeMid);
    g.stroke();

    g.strokeStyle = '#39ff87';
    g.lineWidth = Math.max(1.5, 2 * this.dpr);
    g.beginPath();
    const tn = audio.time.length;
    for (let x = 0; x < W; x++) {
      const s = audio.time[Math.floor((x / W) * tn)] / 128 - 1; // -1..1
      const y = scopeMid - s * scopeMid * 0.85;
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();

    // ---- spectrum bars (bottom two thirds) ----
    const specTop = scopeH + H * 0.02;
    const specH = H - specTop;
    const fn = audio.freq.length;
    const gap = Math.max(1, Math.floor(W / this.bars * 0.12));
    const bw = W / this.bars;
    const segH = Math.max(3, specH / 26);           // segmented "blocks"

    for (let i = 0; i < this.bars; i++) {
      // log-ish frequency mapping so lows aren't cramped
      const f0 = Math.floor(Math.pow(i / this.bars, 1.7) * fn * 0.85);
      const f1 = Math.max(f0 + 1, Math.floor(Math.pow((i + 1) / this.bars, 1.7) * fn * 0.85));
      let sum = 0;
      for (let f = f0; f < f1; f++) sum += audio.freq[f];
      const v = Math.min(1, sum / (f1 - f0) / 255 * 1.6);

      // smooth rise, quick-ish fall
      this.vals[i] += (v - this.vals[i]) * (v > this.vals[i] ? 0.55 : 0.16);
      const cur = this.vals[i];

      // peak cap falls under "gravity"
      if (cur > this.peaks[i]) this.peaks[i] = cur;
      else this.peaks[i] = Math.max(cur, this.peaks[i] - dt * 0.6);

      const x = i * bw;
      const litSegs = Math.round(cur * (specH / segH));
      const totalSegs = Math.floor(specH / segH);
      for (let s = 0; s < litSegs; s++) {
        const frac = s / totalSegs;
        g.fillStyle = this.barColor(frac);
        const y = specTop + specH - (s + 1) * segH;
        g.fillRect(x + gap, y + 1, bw - gap * 2, segH - 2);
      }
      // white peak cap
      const py = specTop + specH - this.peaks[i] * specH - segH;
      g.fillStyle = '#eafff2';
      g.fillRect(x + gap, Math.max(specTop, py), bw - gap * 2, Math.max(2, segH - 3));
    }
  }

  dispose() { /* nothing to free for 2D */ }
}
