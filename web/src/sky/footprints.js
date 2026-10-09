// SPHEREx footprint geometry for the sky map.
//
// Every pointing images three detectors side by side. We draw detectors 1-3 of
// sub-exposure 1 per pointing as spherical quads whose corners are unit
// vectors, using the same TAN model as Pointings.corners() but vectorised
// (one sin/cos per pointing instead of per corner).

import { CRPIX, DET_SIZE } from '../data/pointings.js';
import { DEG } from '../data/sky-math.js';

/** SPHEREx all-sky survey passes: ~6 months each, starting 2025-05-01. */
export const SURVEY_START_MJD = 60796; // 2025-05-01T00:00Z
export const SURVEY_PERIOD = 182.6; // days

/** 0 = commissioning (before 2025-05-01), 1.. = survey pass number. */
export function surveyPass(mjd) {
  return mjd < SURVEY_START_MJD ? 0 : 1 + Math.floor((mjd - SURVEY_START_MJD) / SURVEY_PERIOD);
}

/** Floats per footprint instance: 4 corners (xyz) + time (days since mjd0). */
export const FP_STRIDE = 13;
export const DETECTORS = 3;

/**
 * Allocate one instance per (pointing, detector), sorted by time. Times and
 * pointing indices are filled immediately; corner geometry is filled by
 * fillFootprints() so it can be spread over several frames.
 * Returns { data: Float32Array(count * FP_STRIDE), t: Float32Array(count),
 *           pointing: Uint32Array(count), count, filled (pointings done) }.
 */
export function allocFootprints(P) {
  const n = P.count;
  let order = null;
  for (let i = 1; i < n; i++) {
    if (P.t[i] < P.t[i - 1]) {
      order = Array.from({ length: n }, (_, k) => k).sort((a, b) => P.t[a] - P.t[b]);
      break;
    }
  }
  const count = n * DETECTORS;
  const t = new Float32Array(count);
  const pointing = new Uint32Array(count);
  for (let k = 0; k < n; k++) {
    const i = order ? order[k] : k;
    for (let d = 0; d < DETECTORS; d++) {
      t[k * DETECTORS + d] = P.t[i];
      pointing[k * DETECTORS + d] = i;
    }
  }
  return { data: new Float32Array(count * FP_STRIDE), t, pointing, count, filled: 0 };
}

/** Fill corner geometry for sorted pointings [fp.filled, end). */
export function fillFootprints(P, fp, end) {
  const { data, pointing } = fp;
  end = Math.min(end, P.count);
  const h = DET_SIZE / 2;
  const sx = [-h, h, h, -h];
  const sy = [-h, -h, h, h];
  let w = fp.filled * DETECTORS * FP_STRIDE;
  for (let k = fp.filled; k < end; k++) {
    const i = pointing[k * DETECTORS];
    const a = P.ra[i] * DEG;
    const d = P.dec[i] * DEG;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cd = Math.cos(d);
    const sd = Math.sin(d);
    // Center, east and north unit vectors of the tangent plane.
    const c0 = cd * ca, c1 = cd * sa, c2 = sd;
    const e0 = -sa, e1 = ca;
    const n0 = -sd * ca, n1 = -sd * sa, n2 = cd;
    const p0 = P.pc[4 * i], p1 = P.pc[4 * i + 1], p2 = P.pc[4 * i + 2], p3 = P.pc[4 * i + 3];
    for (let det = 1; det <= DETECTORS; det++) {
      const [cx, cy] = P.detCenter[det];
      for (let j = 0; j < 4; j++) {
        const dx = cx + sx[j] - CRPIX;
        const dy = cy + sy[j] - CRPIX;
        const xi = (p0 * dx + p1 * dy) * DEG;
        const eta = (p2 * dx + p3 * dy) * DEG;
        const vx = c0 + xi * e0 + eta * n0;
        const vy = c1 + xi * e1 + eta * n1;
        const vz = c2 + eta * n2;
        const l = 1 / Math.hypot(vx, vy, vz);
        data[w++] = vx * l;
        data[w++] = vy * l;
        data[w++] = vz * l;
      }
      data[w++] = P.t[i];
    }
  }
  fp.filled = end;
  return fp;
}

/** Build all footprint instances at once (see allocFootprints). */
export function buildFootprints(P) {
  return fillFootprints(P, allocFootprints(P), P.count);
}

/** First index with arr[index] > x (arr sorted ascending). */
export function upperBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** First index with arr[index] >= x. */
export function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/**
 * Is unit vector (x, y, z) inside footprint instance k? Edges are great-circle
 * arcs (TAN projection keeps detector edges straight), so a convex test on the
 * four edge planes is exact.
 */
export function quadContains(data, k, x, y, z) {
  const o = k * FP_STRIDE;
  let sign = 0;
  for (let j = 0; j < 4; j++) {
    const a = o + 3 * j;
    const b = o + 3 * ((j + 1) & 3);
    const ax = data[a], ay = data[a + 1], az = data[a + 2];
    const bx = data[b], by = data[b + 1], bz = data[b + 2];
    const s = x * (ay * bz - az * by) + y * (az * bx - ax * bz) + z * (ax * by - ay * bx);
    if (sign === 0) sign = s >= 0 ? 1 : -1;
    else if (s * sign < 0) return false;
  }
  return true;
}

/**
 * Visits covering direction v among instances [0, end): returns
 * { visits, first, last } with first/last as instance times (days since mjd0).
 * A pointing's three detectors never overlap, so detector hits == visits.
 */
export function visitsAt(fp, pointingVec, v, end) {
  const { data, pointing, t } = fp;
  const cosLim = Math.cos(11 * DEG);
  const [x, y, z] = v;
  let visits = 0;
  let first = Infinity;
  let last = -Infinity;
  for (let k = 0; k < end; k += DETECTORS) {
    const i = pointing[k];
    const dot = x * pointingVec[3 * i] + y * pointingVec[3 * i + 1] + z * pointingVec[3 * i + 2];
    if (dot < cosLim) continue;
    for (let d = 0; d < DETECTORS && k + d < end; d++) {
      if (quadContains(data, k + d, x, y, z)) {
        visits++;
        if (t[k] < first) first = t[k];
        if (t[k] > last) last = t[k];
        break;
      }
    }
  }
  return { visits, first, last };
}
