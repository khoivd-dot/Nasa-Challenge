// WebGL2 renderer for the sky map.
//
// Footprints are accumulated into a cube map (one RGBA16F channel per survey
// pass, +1 per footprint) only when the time changes, adding or subtracting
// just the instances that crossed the playhead. Drawing a frame then costs a
// single sky-mesh pass that samples the cube, no matter how deep the deep
// fields get. The last ~2 days ("scan head") are drawn directly on top.

import { createProgram, setUniforms, createBuffer, bindAttribs } from './gl.js';
import { SHADERS } from './shaders.js';
import { FP_STRIDE } from './footprints.js';
import { LINE_STRIDE, STAR_STRIDE } from './layers.js';

const QUAD_ATTRS = ['aC0', 'aC1', 'aC2', 'aC3', 'aT'];
const QUAD_LAYOUT = [
  { loc: 0, size: 3, offset: 0 },
  { loc: 1, size: 3, offset: 12 },
  { loc: 2, size: 3, offset: 24 },
  { loc: 3, size: 3, offset: 36 },
  { loc: 4, size: 1, offset: 48 },
];
const QUAD_BYTES = FP_STRIDE * 4;
const LINE_LAYOUT = [
  { loc: 0, size: 3, offset: 0 },
  { loc: 1, size: 3, offset: 12 },
  { loc: 2, size: 1, offset: 24 },
];
const STAR_LAYOUT = [
  { loc: 0, size: 3, offset: 0 },
  { loc: 1, size: 1, offset: 12 },
  { loc: 2, size: 3, offset: 16 },
];

// Cube face bases: rows S, T, M (see the GL cube map face selection table).
const FACES = [
  [[0, 0, -1], [0, -1, 0], [1, 0, 0]],
  [[0, 0, 1], [0, -1, 0], [-1, 0, 0]],
  [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[1, 0, 0], [0, 0, -1], [0, -1, 0]],
  [[1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, -1, 0], [0, 0, -1]],
].map((f) => new Float32Array(f.flat()));

export class SkyRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.canvas = canvas;
    this.lost = false;
    // CPU copies of the uploaded layers, replayed when a lost context comes back.
    this.src = { lines: {} };
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => this.restore());

    this.lines = {};
    this.fp = null;
    this.fpBuilt = 0;
    this.cubeN = 0;
    this.init();
  }

  init() {
    const gl = this.gl;
    this.p = {
      sky: createProgram(gl, SHADERS.quadVs, SHADERS.skyFs, QUAD_ATTRS),
      scan: createProgram(gl, SHADERS.quadVs, SHADERS.scanFs, QUAD_ATTRS),
      cube: createProgram(gl, SHADERS.cubeVs, SHADERS.cubeFs, QUAD_ATTRS),
      outline: createProgram(gl, SHADERS.outlineVs, SHADERS.outlineFs, QUAD_ATTRS),
      line: createProgram(gl, SHADERS.lineVs, SHADERS.lineFs, ['aA', 'aB', 'aS']),
      star: createProgram(gl, SHADERS.starVs, SHADERS.starFs, ['aDir', 'aMag', 'aCol']),
      bg: createProgram(gl, SHADERS.bgVs, SHADERS.bgFs),
    };
    this.emptyVao = gl.createVertexArray();
    this.initCube();
    this.initMilkyWay();
  }

  /** Recreate every GL object after a context loss (GPU reset, mobile tab switch). */
  restore() {
    const { mesh, stars, mw, lines } = this.src;
    this.lines = {};
    this.meshVao = this.starVao = null;
    this.init();
    if (mesh) this.setSkyMesh(mesh);
    if (stars) this.setStars(stars);
    if (mw) this.setMilkyWay(mw);
    for (const name in lines) this.setLine(name, lines[name]);
    if (this.fp) {
      const built = this.fpBuilt;
      this.setFootprints(this.fp);
      if (built) this.uploadFootprints(0, built);
    }
    this.lost = false;
  }

  initCube() {
    const gl = this.gl;
    // Either extension makes RGBA16F renderable; tryFormat() checks completeness.
    const floatOk = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    const maxCube = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE);
    const small = Math.min(screen.width, screen.height) < 700;
    this.cubeSize = Math.min(maxCube, small ? 512 : 1024);
    const tryFormat = (internal, type) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
      for (let f = 0; f < 6; f++) {
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, internal, this.cubeSize, this.cubeSize, 0, gl.RGBA, type, null);
      }
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbs = [];
      for (let f = 0; f < 6; f++) {
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          fbs.forEach((b) => gl.deleteFramebuffer(b));
          gl.deleteFramebuffer(fb);
          gl.deleteTexture(tex);
          return null;
        }
        fbs.push(fb);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fbs };
    };
    let cube = floatOk ? tryFormat(gl.RGBA16F, gl.HALF_FLOAT) : null;
    if (cube) {
      this.cubeInc = 1;
      this.countScale = 1;
    } else {
      cube = tryFormat(gl.RGBA8, gl.UNSIGNED_BYTE);
      this.cubeInc = 1 / 255;
      this.countScale = 255;
    }
    this.cube = cube;
    this.clearCube();
  }

  clearCube() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    for (const fb of this.cube.fbs) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cubeN = 0;
  }

  initMilkyWay() {
    const gl = this.gl;
    this.mwTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.mwTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.mwReady = false;
  }

  setMilkyWay(mw) {
    const { data, width, height } = mw;
    const gl = this.gl;
    this.src.mw = mw;
    gl.bindTexture(gl.TEXTURE_2D, this.mwTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    this.mwReady = true;
  }

  setSkyMesh(mesh) {
    const { data, count } = mesh;
    const gl = this.gl;
    this.src.mesh = mesh;
    this.meshBuf = createBuffer(gl, data);
    this.meshCount = count;
    this.meshVao = gl.createVertexArray();
    gl.bindVertexArray(this.meshVao);
    bindAttribs(gl, this.meshBuf, QUAD_LAYOUT, QUAD_BYTES, 1);
    gl.bindVertexArray(null);
  }

  /** Allocate the footprint instance buffer; fill it with uploadFootprints(). */
  setFootprints(fp) {
    const gl = this.gl;
    this.fp = fp;
    this.fpBuf = createBuffer(gl, fp.data.byteLength);
    this.fpVao = gl.createVertexArray();
    this.fpBuilt = 0;
    this.clearCube();
  }

  uploadFootprints(start, end) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fpBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, start * QUAD_BYTES, this.fp.data, start * FP_STRIDE, (end - start) * FP_STRIDE);
    this.fpBuilt = Math.max(this.fpBuilt, end);
  }

  bindFootprintRange(start) {
    const gl = this.gl;
    gl.bindVertexArray(this.fpVao);
    bindAttribs(gl, this.fpBuf, QUAD_LAYOUT, QUAD_BYTES, 1, start * QUAD_BYTES);
  }

  setLine(name, data) {
    const gl = this.gl;
    const old = this.lines[name];
    if (old) {
      gl.deleteBuffer(old.buf);
      gl.deleteVertexArray(old.vao);
    }
    this.src.lines[name] = data;
    const buf = createBuffer(gl, data);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    bindAttribs(gl, buf, LINE_LAYOUT, LINE_STRIDE * 4, 1);
    gl.bindVertexArray(null);
    this.lines[name] = { buf, vao, count: data.length / LINE_STRIDE };
  }

  setStars(data) {
    const gl = this.gl;
    this.src.stars = data;
    this.starBuf = createBuffer(gl, data);
    this.starVao = gl.createVertexArray();
    gl.bindVertexArray(this.starVao);
    bindAttribs(gl, this.starBuf, STAR_LAYOUT, STAR_STRIDE * 4, 0);
    gl.bindVertexArray(null);
    this.starCount = data.length / STAR_STRIDE;
  }

  resize(W, H, dpr) {
    const w = Math.max(1, Math.round(W * dpr));
    const h = Math.max(1, Math.round(H * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    this.W = W;
    this.H = H;
  }

  /**
   * Move the cube's playhead toward instance count `target` (instances
   * [0, target) included), touching at most `cap` instances. Returns true if
   * anything changed.
   */
  updateCube(target, cap, consts) {
    if (!this.fp) return false;
    target = Math.min(target, this.fpBuilt);
    if (target === this.cubeN) return false;
    const gl = this.gl;
    let start, end, subtract;
    if (target > this.cubeN) {
      start = this.cubeN;
      end = Math.min(target, this.cubeN + cap);
      subtract = false;
    } else if (target < this.cubeN - target || this.cubeInc !== 1) {
      // Cheaper to rebuild from scratch. 8-bit counts saturate at 255, so
      // subtracting from them would undercount deep fields: always rebuild.
      this.clearCube();
      if (target === 0) return true;
      start = 0;
      end = Math.min(target, cap);
      subtract = false;
    } else {
      end = this.cubeN;
      start = Math.max(target, this.cubeN - cap);
      subtract = true;
    }
    const p = this.p.cube;
    gl.useProgram(p.prog);
    setUniforms(gl, p, { uInc: this.cubeInc, uS0: consts.s0, uPeriod: consts.period });
    this.bindFootprintRange(start);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.blendEquation(subtract ? gl.FUNC_REVERSE_SUBTRACT : gl.FUNC_ADD);
    gl.viewport(0, 0, this.cubeSize, this.cubeSize);
    for (let f = 0; f < 6; f++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.cube.fbs[f]);
      gl.uniformMatrix3fv(p.u.uFace, false, FACES[f]);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, end - start);
    }
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    this.cubeN = subtract ? start : end;
    return true;
  }

  /**
   * Draw a frame. s: {cam, time, scanWindow, scanStart, scanEnd, layers,
   * passCols (12 floats), s0, period, outlineAlpha, gridLevel}
   */
  render(s) {
    const gl = this.gl;
    const { cam } = s;
    const dpr = this.dpr;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const proj = {
      uRight: cam.right,
      uUp: cam.up,
      uFwd: cam.fwd,
      uR: cam.R,
      uMorph: cam.morph,
      uLon0: cam.lon0cs,
      uMapS: cam.S,
      uMapPan: [cam.panX, cam.panY],
      uCenter: [cam.cx, cam.cy],
      uViewport: [this.W, this.H],
      uDpr: dpr,
      uS0: s.s0,
      uPeriod: s.period,
      uPassCol: s.passCols,
    };
    const L = s.layers;
    const seam = cam.morph > 0 ? [1, -1] : [1];
    const seamAlpha = (w) => (w > 0 ? 1 : smooth(0.55, 1, cam.morph));

    // Background.
    gl.disable(gl.BLEND);
    gl.useProgram(this.p.bg.prog);
    setUniforms(gl, this.p.bg, proj);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Sky body with Milky Way and accumulated footprints.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (this.meshVao) {
      const p = this.p.sky;
      gl.useProgram(p.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cube.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.mwTex);
      setUniforms(gl, p, {
        ...proj,
        uCube: { i: 0 },
        uMilky: { i: 1 },
        uFoot: L.footprints ? 1 : 0,
        uMW: L.milkyway && this.mwReady ? 1 : 0,
        uCountScale: this.countScale,
        uSatLog: Math.log2(1 + s.saturation),
        uEdge: s.edge ?? 1,
        uTime: 0,
        uWindow: 0,
      });
      gl.bindVertexArray(this.meshVao);
      for (const w of seam) {
        setUniforms(gl, p, { uWrap: w, uAlphaMul: seamAlpha(w) });
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.meshCount);
      }
    }

    // Reference lines.
    const lp = this.p.line;
    gl.useProgram(lp.prog);
    setUniforms(gl, lp, proj);
    for (const item of s.lines) {
      const l = this.lines[item.name];
      if (!l) continue;
      setUniforms(gl, lp, { uColor: item.color, uWidth: item.width, uDash: item.dash || 0 });
      gl.bindVertexArray(l.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, l.count);
    }

    gl.blendFunc(gl.ONE, gl.ONE);
    // Footprint outlines when zoomed in.
    if (L.footprints && this.fp && s.outlineAlpha > 0.002 && this.cubeN > 0) {
      const p = this.p.outline;
      gl.useProgram(p.prog);
      setUniforms(gl, p, { ...proj, uTime: s.time, uAlpha: s.outlineAlpha });
      this.bindFootprintRange(0);
      gl.drawArraysInstanced(gl.LINES, 0, 8, Math.min(this.cubeN, this.fpBuilt));
    }
    // Scan head: footprints observed in the last few days.
    if (L.footprints && this.fp && s.scanEnd > s.scanStart) {
      const p = this.p.scan;
      gl.useProgram(p.prog);
      setUniforms(gl, p, { ...proj, uTime: s.time, uWindow: s.scanWindow, uGain: s.scanGain });
      this.bindFootprintRange(s.scanStart);
      for (const w of seam) {
        setUniforms(gl, p, { uWrap: w, uAlphaMul: seamAlpha(w) });
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.scanEnd - s.scanStart);
      }
    }
    // Stars.
    if (L.stars && this.starVao) {
      const p = this.p.star;
      gl.useProgram(p.prog);
      setUniforms(gl, p, { ...proj, uScale: s.starScale, uBright: s.starBright });
      gl.bindVertexArray(this.starVao);
      gl.drawArrays(gl.POINTS, 0, this.starCount);
    }
    gl.bindVertexArray(null);
  }
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
