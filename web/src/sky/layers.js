// CPU-side geometry for the reference layers. All positions are J2000 unit
// vectors; curves are subdivided finely enough to bend correctly in both the
// globe and the Hammer-Aitoff map.

import { DEG, RAD, radecToVec, eclipticToEquatorial, galacticToEquatorial } from '../data/sky-math.js';
import { starHex, hexRgb } from '../ui/palette.js';

/** Floats per line segment instance: a (xyz), b (xyz), arc length at a (deg). */
export const LINE_STRIDE = 7;

class SegmentWriter {
  constructor() {
    this.parts = [];
    this.cur = new Float32Array(4096 * LINE_STRIDE);
    this.n = 0;
  }
  push(a, b, s) {
    if (this.n === this.cur.length / LINE_STRIDE) {
      this.parts.push(this.cur);
      this.cur = new Float32Array(this.cur.length * 2);
      this.n = 0;
    }
    const o = this.n * LINE_STRIDE;
    const c = this.cur;
    c[o] = a[0];
    c[o + 1] = a[1];
    c[o + 2] = a[2];
    c[o + 3] = b[0];
    c[o + 4] = b[1];
    c[o + 5] = b[2];
    c[o + 6] = s;
    this.n++;
  }
  /** Polyline through unit vectors, subdividing edges longer than maxDeg. */
  polyline(points, maxDeg = 1) {
    let s = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * RAD;
      const k = Math.max(1, Math.ceil(ang / maxDeg));
      let prev = a;
      for (let j = 1; j <= k; j++) {
        const next = j === k ? b : slerp(a, b, j / k, ang * DEG);
        this.push(prev, next, s);
        s += ang / k;
        prev = next;
      }
    }
  }
  finish() {
    const total = this.parts.reduce((n, p) => n + p.length, 0) + this.n * LINE_STRIDE;
    const out = new Float32Array(total);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    out.set(this.cur.subarray(0, this.n * LINE_STRIDE), o);
    return out;
  }
}

function slerp(a, b, t, om) {
  const s = Math.sin(om);
  if (s < 1e-9) return a;
  const wa = Math.sin((1 - t) * om) / s;
  const wb = Math.sin(t * om) / s;
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
}

/** RA/Dec graticule. stepRa/stepDec in degrees; meridians stop at |dec| <= decLimit. */
export function buildGrid(stepRa, stepDec, decLimit) {
  const w = new SegmentWriter();
  const seg = Math.min(1, stepDec / 2);
  for (let ra = 0; ra < 360; ra += stepRa) {
    const pts = [];
    for (let d = -decLimit; d <= decLimit + 1e-9; d += seg) pts.push(radecToVec(ra, d));
    w.polyline(pts, 2);
  }
  const raSeg = Math.min(1, stepRa / 2);
  for (let dec = -90 + stepDec; dec < 90 - 1e-9; dec += stepDec) {
    const pts = [];
    for (let a = 0; a <= 360 + 1e-9; a += raSeg) pts.push(radecToVec(a, dec));
    w.polyline(pts, 2);
  }
  return w.finish();
}

export function buildGreatCircle(toEquatorial) {
  const w = new SegmentWriter();
  const pts = [];
  for (let l = 0; l <= 360; l += 0.5) pts.push(radecToVec(...toEquatorial(l, 0)));
  w.polyline(pts, 1);
  return w.finish();
}

export const buildEcliptic = () => buildGreatCircle(eclipticToEquatorial);
export const buildGalactic = () => buildGreatCircle(galacticToEquatorial);

export function buildConstellationLines(lines) {
  const w = new SegmentWriter();
  for (const line of lines) w.polyline(line.map(([ra, dec]) => radecToVec(ra, dec)), 1);
  return w.finish();
}

/** Stars: per vertex x, y, z, mag, r, g, b. */
export const STAR_STRIDE = 7;
export function buildStars(stars) {
  const out = new Float32Array(stars.length * STAR_STRIDE);
  stars.forEach(([ra, dec, mag, bv], i) => {
    const v = radecToVec(ra, dec);
    const c = bvToRgb(bv);
    out.set([v[0], v[1], v[2], mag, c[0], c[1], c[2]], i * STAR_STRIDE);
  });
  return out;
}

/** Star color from B-V: blackbody temperature, from the palette's star table. */
export function bvToRgb(bv) {
  return hexRgb(starHex(bv ?? 0.6)).map((v) => v / 255);
}

/**
 * Sky body mesh: cells of `step` degrees as spherical quads, in the same
 * instance layout as footprints (4 corners + unused time) so one shader serves both.
 */
export function buildSkyMesh(step = 2) {
  const nRa = Math.round(360 / step);
  const nDec = Math.round(180 / step);
  const verts = [];
  for (let j = 0; j <= nDec; j++) {
    const dec = Math.max(-89.9999, Math.min(89.9999, -90 + j * step));
    const row = [];
    for (let i = 0; i <= nRa; i++) row.push(radecToVec((i % nRa) * step, dec));
    verts.push(row);
  }
  const out = new Float32Array(nRa * nDec * 13);
  let o = 0;
  for (let j = 0; j < nDec; j++) {
    for (let i = 0; i < nRa; i++) {
      const c = [verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]];
      for (const v of c) {
        out[o++] = v[0];
        out[o++] = v[1];
        out[o++] = v[2];
      }
      out[o++] = 0;
    }
  }
  return { data: out, count: nRa * nDec };
}

/**
 * Rasterize Milky Way outline levels into an equirectangular texture
 * (u = RA / 360, v = (dec + 90) / 180). Even-odd fill along meridians, with
 * the north celestial pole (outside the Milky Way) as reference.
 */
export function rasterMilkyWay(levels, W = 1024, H = 512) {
  const acc = new Float32Array(W * H);
  const cols = Array.from({ length: W }, () => []);
  levels.forEach((level) => {
    for (const c of cols) c.length = 0;
    for (const ring of level.rings) {
      for (let k = 0; k + 1 < ring.length; k++) {
        const [a0, d0] = ring[k];
        const [a1, d1] = ring[k + 1];
        let da = a1 - a0;
        if (da > 180) da -= 360;
        if (da < -180) da += 360;
        if (da === 0) continue;
        const lo = Math.min(a0, a0 + da);
        const hi = Math.max(a0, a0 + da);
        const c0 = Math.ceil((lo / 360) * W - 0.5);
        const c1 = Math.floor((hi / 360) * W - 0.5);
        for (let c = c0; c <= c1; c++) {
          const x = ((c + 0.5) / W) * 360;
          const f = (x - a0) / da;
          if (f < 0 || f >= 1) continue;
          cols[((c % W) + W) % W].push(d0 + f * (d1 - d0));
        }
      }
    }
    for (let c = 0; c < W; c++) {
      const xs = cols[c].sort((a, b) => b - a); // north to south
      let inside = false;
      let k = 0;
      for (let r = H - 1; r >= 0; r--) {
        const dec = ((r + 0.5) / H) * 180 - 90;
        while (k < xs.length && xs[k] > dec) {
          inside = !inside;
          k++;
        }
        if (inside) acc[r * W + c] += 1;
      }
    }
  });
  const n = levels.length || 1;
  for (let i = 0; i < acc.length; i++) acc[i] /= n;
  blur(acc, W, H, 2);
  blur(acc, W, H, 2);
  blur(acc, W, H, 1);
  const out = new Uint8Array(W * H);
  for (let i = 0; i < acc.length; i++) out[i] = Math.round(Math.min(1, acc[i]) * 255);
  return { data: out, width: W, height: H };
}

function blur(a, W, H, r) {
  const tmp = new Float32Array(a.length);
  const k = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    let s = 0;
    for (let i = -r; i <= r; i++) s += a[o + ((i + W) % W)];
    for (let x = 0; x < W; x++) {
      tmp[o + x] = s / k;
      s += a[o + ((x + r + 1) % W)] - a[o + ((x - r + W) % W)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[Math.max(0, Math.min(H - 1, i)) * W + x];
    for (let y = 0; y < H; y++) {
      a[y * W + x] = s / k;
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
}
