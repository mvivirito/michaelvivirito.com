// Hand-rolled Geiss recreation (WebGL2).
//
// The look of Ryan Geiss's original Winamp/screensaver visualizer comes from a
// few simple ingredients layered together:
//   1. A full-screen FEEDBACK buffer that is warped a little every frame
//      (slow zoom toward the centre + rotation + a flowing sinusoidal swirl)
//      and slightly darkened, so anything drawn leaves long flowing trails.
//   2. Bright ADDITIVE blobs drawn along the audio waveform — the trails you
//      see are the history of that waveform being dragged through the field.
//   3. A cosine PALETTE that slowly cycles hue over time and audio, giving the
//      endless plasma-tunnel colours.
//
// We ping-pong two float-ish framebuffers, warp src -> dst, additively splat
// the waveform onto dst, then tonemap dst to the screen.

import type { AudioEngine } from './audio';

const QUAD_VS = `#version 300 es
in vec2 p; out vec2 v_uv;
void main(){ v_uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

// Warp + decay: read the previous frame at a swirled/zoomed coordinate.
const WARP_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_prev;
uniform float u_time, u_bass, u_mid, u_treble, u_aspect;
void main(){
  vec2 uv = v_uv;
  vec2 c = uv - 0.5;
  c.x *= u_aspect;                              // work in square space
  float r = length(c);
  float a = atan(c.y, c.x);
  // zoom toward centre (tunnel) — faster with bass
  r *= (1.0 - 0.010 - 0.020 * u_bass);
  // rotate, with a gentle time wobble and a mid-driven push
  a += 0.010 + 0.020 * sin(u_time * 0.30) + 0.060 * u_mid;
  vec2 p = vec2(cos(a), sin(a)) * r;
  // flowing sinusoidal displacement — the classic Geiss "breathing"
  p += 0.006 * vec2(
    sin(uv.y * 7.0 + u_time * 1.3),
    cos(uv.x * 7.0 + u_time * 1.1)
  ) * (0.5 + u_treble);
  p.x /= u_aspect;
  vec2 suv = p + 0.5;
  vec3 prev = texture(u_prev, suv).rgb;
  // decay + tiny colour bleed so trails cool toward the palette
  prev *= 0.965 - 0.02 * (1.0 - u_bass);
  o = vec4(prev, 1.0);
}`;

// Additive waveform splat: each vertex is a point on the waveform, expanded to
// a soft round sprite in the fragment stage.
const BLOB_VS = `#version 300 es
in float a_idx;                 // 0..1 along the waveform
uniform sampler2D u_wave;       // waveform in a 1-D texture (R = sample)
uniform float u_time, u_bass, u_mid, u_size, u_count, u_aspect;
out vec3 v_col;
// cosine palette (Inigo Quilez style)
vec3 pal(float t){
  return vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0,1.0,1.0) * t + vec3(0.0,0.33,0.67)));
}
void main(){
  float s = texture(u_wave, vec2(a_idx, 0.5)).r * 2.0 - 1.0;   // -1..1
  // Spiral the waveform outward from centre to the edges so the field fills
  // the whole screen instead of clustering in a small central ring.
  float ang = a_idx * 6.28318 * 5.0 + u_time * 0.5;
  float rad = 0.12 + 0.85 * a_idx + 0.28 * abs(s) + 0.10 * u_bass;
  vec2 pos = vec2(cos(ang), sin(ang)) * rad;
  pos += 0.22 * s * vec2(cos(u_time * 0.7), sin(u_time * 0.9));
  pos.x *= max(1.0, u_aspect * 0.72);                          // stretch to fill widescreen
  pos *= 1.0 + 0.06 * sin(u_time * 0.4);
  gl_Position = vec4(pos, 0.0, 1.0);
  gl_PointSize = u_size * (1.0 + 1.4 * abs(s) + 1.6 * u_bass);
  v_col = pal(a_idx + u_time * 0.05 + u_mid * 0.2) * (0.6 + 0.8 * abs(s) + 0.5 * u_bass);
}`;

const BLOB_FS = `#version 300 es
precision highp float;
in vec3 v_col; out vec4 o;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float g = exp(-dot(d, d) * 9.0);          // soft gaussian sprite
  o = vec4(v_col * g, g);
}`;

// Present: tonemap the feedback buffer to the screen with a little hue lift.
const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src;
uniform float u_time;
void main(){
  vec3 c = texture(u_src, v_uv).rgb;
  c = c / (c + 0.6);                          // soft tonemap
  c = pow(c, vec3(0.85));                     // lift midtones
  // subtle vignette
  vec2 d = v_uv - 0.5;
  c *= 1.0 - 0.5 * dot(d, d);
  o = vec4(c, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
  }
  return s;
}
function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'program link failed');
  }
  return p;
}

export class GeissViz {
  private gl: WebGL2RenderingContext;
  private quad: WebGLBuffer;
  private warpP: WebGLProgram;
  private blobP: WebGLProgram;
  private presentP: WebGLProgram;
  private fbo: [WebGLFramebuffer, WebGLFramebuffer];
  private tex: [WebGLTexture, WebGLTexture];
  private waveTex: WebGLTexture;
  private idxBuf: WebGLBuffer;
  private count = 512;
  private waveData: Uint8Array;
  private W = 0;
  private H = 0;
  private cur = 0;
  private t = 0;
  private q: number;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.q = Math.min(1.25, window.devicePixelRatio || 1);

    this.warpP = program(gl, QUAD_VS, WARP_FS);
    this.blobP = program(gl, BLOB_VS, BLOB_FS);
    this.presentP = program(gl, QUAD_VS, PRESENT_FS);

    // full-screen triangle-strip quad
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    // waveform sample indices for the blob pass
    const idx = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) idx[i] = i / (this.count - 1);
    this.idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    // 1-D waveform texture (R8)
    this.waveData = new Uint8Array(this.count);
    this.waveTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.count, 1, 0, gl.RED, gl.UNSIGNED_BYTE, this.waveData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.tex = [gl.createTexture()!, gl.createTexture()!];
    this.fbo = [gl.createFramebuffer()!, gl.createFramebuffer()!];
    this.resize();
  }

  resize() {
    const gl = this.gl;
    const r = this.canvas.getBoundingClientRect();
    const W = Math.max(1, Math.floor(r.width * this.q));
    const H = Math.max(1, Math.floor(r.height * this.q));
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.canvas.width = W; this.canvas.height = H;
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex[i], 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private drawQuad(prog: WebGLProgram) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  frame(dt: number, audio: AudioEngine) {
    const gl = this.gl;
    this.t += dt;
    this.resize();

    const src = this.cur;
    const dst = 1 - this.cur;
    const aspect = this.W / this.H;

    // --- 1) warp previous frame (src) into dst ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[dst]);
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.BLEND);
    gl.useProgram(this.warpP);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[src]);
    gl.uniform1i(gl.getUniformLocation(this.warpP, 'u_prev'), 0);
    gl.uniform1f(gl.getUniformLocation(this.warpP, 'u_time'), this.t);
    gl.uniform1f(gl.getUniformLocation(this.warpP, 'u_bass'), audio.bass);
    gl.uniform1f(gl.getUniformLocation(this.warpP, 'u_mid'), audio.mid);
    gl.uniform1f(gl.getUniformLocation(this.warpP, 'u_treble'), audio.treble);
    gl.uniform1f(gl.getUniformLocation(this.warpP, 'u_aspect'), aspect);
    this.drawQuad(this.warpP);

    // --- 2) additively splat the waveform onto dst ---
    // downsample the analyser waveform into our 1-D texture
    const tn = audio.time.length;
    for (let i = 0; i < this.count; i++) {
      this.waveData[i] = audio.time[Math.floor((i / this.count) * tn)];
    }
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.count, 1, gl.RED, gl.UNSIGNED_BYTE, this.waveData);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);            // additive
    gl.useProgram(this.blobP);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.idxBuf);
    const al = gl.getAttribLocation(this.blobP, 'a_idx');
    gl.enableVertexAttribArray(al);
    gl.vertexAttribPointer(al, 1, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
    gl.uniform1i(gl.getUniformLocation(this.blobP, 'u_wave'), 0);
    gl.uniform1f(gl.getUniformLocation(this.blobP, 'u_time'), this.t);
    gl.uniform1f(gl.getUniformLocation(this.blobP, 'u_bass'), audio.bass);
    gl.uniform1f(gl.getUniformLocation(this.blobP, 'u_mid'), audio.mid);
    gl.uniform1f(gl.getUniformLocation(this.blobP, 'u_size'), Math.max(5, this.H * 0.010));
    gl.uniform1f(gl.getUniformLocation(this.blobP, 'u_count'), this.count);
    gl.uniform1f(gl.getUniformLocation(this.blobP, 'u_aspect'), aspect);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.disable(gl.BLEND);

    // --- 3) present dst to the screen ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(this.presentP);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[dst]);
    gl.uniform1i(gl.getUniformLocation(this.presentP, 'u_src'), 0);
    gl.uniform1f(gl.getUniformLocation(this.presentP, 'u_time'), this.t);
    this.drawQuad(this.presentP);

    this.cur = dst;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.warpP);
    gl.deleteProgram(this.blobP);
    gl.deleteProgram(this.presentP);
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.idxBuf);
    gl.deleteTexture(this.waveTex);
    this.tex.forEach((t) => gl.deleteTexture(t));
    this.fbo.forEach((f) => gl.deleteFramebuffer(f));
  }
}
