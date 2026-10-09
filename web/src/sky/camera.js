// View state and CPU projection, mirroring the GLSL in shaders.js.
//
// Globe: orthographic view of the celestial sphere from inside, north up,
// east (increasing RA) to the left. Map: Hammer-Aitoff centered on lon0,
// mirrored the same way. `morph` blends screen positions between the two.

import { DEG, RAD, radecToVec, vecToRadec } from '../data/sky-math.js';

const SQRT2 = Math.SQRT2;

export class Camera {
  constructor() {
    this.ra = 270; // globe center, degrees
    this.dec = 28;
    this.zoom = 1; // globe radius / fitted radius
    this.lon0 = 270; // map central RA, degrees
    this.mapZoom = 1;
    this.panX = 0; // map pan, CSS px (y up)
    this.panY = 0;
    this.morph = 0; // eased 0 globe .. 1 map
    this.W = 1;
    this.H = 1;
    this.cx = 0.5;
    this.cy = 0.5;
    this.fitMin = 1;
    this.focusW = 1;
    this.focusH = 1;
    this.update();
  }

  /** Viewport in CSS px and the free "focus" rectangle the sky is centered in. */
  setViewport(W, H, focus) {
    this.W = W;
    this.H = H;
    this.focusW = Math.max(120, focus.x1 - focus.x0);
    this.focusH = Math.max(120, focus.y1 - focus.y0);
    this.cx = (focus.x0 + focus.x1) / 2;
    this.cy = (focus.y0 + focus.y1) / 2;
    this.fitMin = Math.min(this.focusW, this.focusH);
    this.update();
  }

  get Rfit() {
    return 0.46 * this.fitMin;
  }
  get R() {
    return this.zoom * this.Rfit;
  }
  get Sfit() {
    return Math.min(this.focusW / (4 * SQRT2), this.focusH / (2 * SQRT2)) * 0.96;
  }
  get S() {
    return this.mapZoom * this.Sfit;
  }
  get maxZoom() {
    // ~4 degree field across the short side of the free area.
    return this.fitMin / (4 * DEG) / this.Rfit;
  }
  get maxMapZoom() {
    return (360 / 4) * (this.fitMin / (4 * SQRT2 * this.Sfit));
  }

  update() {
    this.dec = Math.max(-89.9, Math.min(89.9, this.dec));
    this.ra = ((this.ra % 360) + 360) % 360;
    this.lon0 = ((this.lon0 % 360) + 360) % 360;
    const a = this.ra * DEG;
    const d = this.dec * DEG;
    const ca = Math.cos(a), sa = Math.sin(a), cd = Math.cos(d), sd = Math.sin(d);
    this.fwd = [cd * ca, cd * sa, sd];
    this.up = [-sd * ca, -sd * sa, cd];
    this.right = [sa, -ca, 0]; // west = -east
    this.lon0cs = [Math.cos(this.lon0 * DEG), Math.sin(this.lon0 * DEG)];
    this.clampPan();
  }

  clampPan() {
    const S = this.S;
    const mx = 2 * SQRT2 * S;
    const my = SQRT2 * S;
    this.panX = Math.max(-mx, Math.min(mx, this.panX));
    this.panY = Math.max(-my, Math.min(my, this.panY));
  }

  /** Field of view across the short side of the free area, degrees. */
  fov() {
    const globe = this.R >= this.fitMin / 2 ? 2 * Math.asin(this.fitMin / 2 / this.R) * RAD : 180;
    const map = (this.fitMin / (SQRT2 * this.S)) * RAD;
    return globe * (1 - this.morph) + Math.min(360, map) * this.morph;
  }

  lonRel(v) {
    const [c, s] = this.lon0cs;
    return Math.atan2(v[1] * c - v[0] * s, v[0] * c + v[1] * s);
  }

  /** Unit vector -> {x, y} CSS px (top-left origin) and visibility 0..1. */
  project(v) {
    const R = this.R;
    let gx = v[0] * this.right[0] + v[1] * this.right[1] + v[2] * this.right[2];
    let gy = v[0] * this.up[0] + v[1] * this.up[1] + v[2] * this.up[2];
    const z = v[0] * this.fwd[0] + v[1] * this.fwd[1] + v[2] * this.fwd[2];
    if (z < 0) {
      const l = Math.hypot(gx, gy) || 1;
      gx /= l;
      gy /= l;
    }
    let x = gx * R;
    let y = gy * R;
    let vis = smoothstep(-0.005, 0.035, z);
    const m = this.morph;
    if (m > 0) {
      const [hx, hy] = hammer(this.lonRel(v), v[2]);
      x += (this.panX + this.S * hx - x) * m;
      y += (this.panY + this.S * hy - y) * m;
      vis += (1 - vis) * m;
    }
    return { x: this.cx + x, y: this.cy - y, vis, z };
  }

  projectRaDec(ra, dec) {
    return this.project(radecToVec(ra, dec));
  }

  /** CSS px -> unit vector on the sky, or null (outside the sky or mid-morph). */
  unproject(px, py) {
    if (this.morph < 0.001) return this.unprojectGlobe(px, py);
    if (this.morph > 0.999) return this.unprojectMap(px, py);
    return null;
  }

  unprojectGlobe(px, py, R = this.R) {
    const x = (px - this.cx) / R;
    const y = (this.cy - py) / R;
    const r2 = x * x + y * y;
    if (r2 > 1) return null;
    const z = Math.sqrt(1 - r2);
    const { right: r, up: u, fwd: f } = this;
    return [x * r[0] + y * u[0] + z * f[0], x * r[1] + y * u[1] + z * f[1], x * r[2] + y * u[2] + z * f[2]];
  }

  unprojectMap(px, py) {
    const S = this.S;
    const X = -(px - this.cx - this.panX) / S; // un-mirror
    const Y = (this.cy - py - this.panY) / S;
    if ((X * X) / 8 + (Y * Y) / 2 > 1) return null;
    const z = Math.sqrt(Math.max(0, 1 - (X * X) / 16 - (Y * Y) / 4));
    const lam = 2 * Math.atan2(z * X, 2 * (2 * z * z - 1));
    const phi = Math.asin(Math.max(-1, Math.min(1, z * Y)));
    return radecToVec(this.lon0 + lam * RAD, phi * RAD);
  }

  /** Rotate the globe so sky direction v lands under screen point (px, py). */
  anchorGlobe(v, px, py) {
    for (let iter = 0; iter < 3; iter++) {
      const q = this.unprojectGlobe(px, py);
      if (!q) return;
      const c = rotateTowards(this.fwd, q, v);
      const [ra, dec] = vecToRadec(...c);
      this.ra = ra;
      this.dec = dec;
      this.update();
    }
  }

  /** Pan the map so sky direction v lands under screen point (px, py). */
  anchorMap(v, px, py) {
    const [hx, hy] = hammer(this.lonRel(v), v[2]);
    this.panX = px - this.cx - this.S * hx;
    this.panY = this.cy - py - this.S * hy;
    this.clampPan();
  }
}

export function hammer(lam, z) {
  const cp = Math.sqrt(Math.max(0, 1 - z * z));
  const h = Math.sqrt(Math.max(1e-6, 1 + cp * Math.cos(lam / 2)));
  return [(-2 * SQRT2 * cp * Math.sin(lam / 2)) / h, (SQRT2 * z) / h];
}

export function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Apply to c the rotation that takes unit vector from -> to. */
export function rotateTowards(c, from, to) {
  const ax = from[1] * to[2] - from[2] * to[1];
  const ay = from[2] * to[0] - from[0] * to[2];
  const az = from[0] * to[1] - from[1] * to[0];
  const s = Math.hypot(ax, ay, az);
  const cos = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (s < 1e-12) return c.slice();
  const kx = ax / s, ky = ay / s, kz = az / s;
  // Rodrigues
  const kc = kx * c[0] + ky * c[1] + kz * c[2];
  const cx = ky * c[2] - kz * c[1];
  const cy = kz * c[0] - kx * c[2];
  const cz = kx * c[1] - ky * c[0];
  return [
    c[0] * cos + cx * s + kx * kc * (1 - cos),
    c[1] * cos + cy * s + ky * kc * (1 - cos),
    c[2] * cos + cz * s + kz * kc * (1 - cos),
  ];
}

/** Spherical linear interpolation between unit vectors. */
export function slerp(a, b, t) {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const om = Math.acos(dot);
  if (om < 1e-6) return a.slice();
  const s = Math.sin(om);
  const wa = Math.sin((1 - t) * om) / s;
  const wb = Math.sin(t * om) / s;
  const v = [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}
