// Sky-coverage bookkeeping on an (almost) equal-area grid: rings 0.5° tall,
// each split into round(720 cos dec) cells, ~165k cells over the sphere.
// For every cell we record the first time any footprint covered its center;
// coverage(T) is then a binary search over the sorted first-visit times.

import { FP_STRIDE } from './footprints.js';

const RING_DEG = 0.5;

export function makeGrid() {
  const DEG = Math.PI / 180;
  const nRings = Math.round(180 / RING_DEG);
  const ringStart = new Uint32Array(nRings + 1);
  const ringCount = new Uint32Array(nRings);
  const ringArea = new Float64Array(nRings);
  let total = 0;
  for (let j = 0; j < nRings; j++) {
    const d0 = -90 + j * RING_DEG;
    const dc = (d0 + RING_DEG / 2) * DEG;
    const n = Math.max(3, Math.round((360 / RING_DEG) * Math.cos(dc)));
    ringStart[j] = total;
    ringCount[j] = n;
    // Area of one cell in this ring (steradians).
    ringArea[j] = ((Math.sin((d0 + RING_DEG) * DEG) - Math.sin(d0 * DEG)) * 2 * Math.PI) / n;
    total += n;
  }
  ringStart[nRings] = total;
  const centers = new Float32Array(total * 3);
  for (let j = 0; j < nRings; j++) {
    const dc = (-90 + (j + 0.5) * RING_DEG) * DEG;
    const cd = Math.cos(dc);
    const sd = Math.sin(dc);
    const n = ringCount[j];
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n) * 2 * Math.PI;
      const o = 3 * (ringStart[j] + k);
      centers[o] = cd * Math.cos(a);
      centers[o + 1] = cd * Math.sin(a);
      centers[o + 2] = sd;
    }
  }
  return { nRings, ringStart, ringCount, ringArea, centers, total };
}

/**
 * data: footprint instances (FP_STRIDE floats each, sorted by time).
 * Returns { times: Float32Array (sorted first-visit times of covered cells),
 *           cumArea: Float64Array (cumArea[k] = covered fraction once times[k-1] passed) }.
 */
export function computeCoverage(data, count) {
  const RAD = 180 / Math.PI;
  const g = makeGrid();
  const first = new Float32Array(g.total).fill(Infinity);
  const nrm = new Float64Array(12);
  for (let q = 0; q < count; q++) {
    const o = q * FP_STRIDE;
    const t = data[o + 12];
    // Edge-plane normals and orientation.
    for (let j = 0; j < 4; j++) {
      const a = o + 3 * j;
      const b = o + 3 * ((j + 1) & 3);
      nrm[3 * j] = data[a + 1] * data[b + 2] - data[a + 2] * data[b + 1];
      nrm[3 * j + 1] = data[a + 2] * data[b] - data[a] * data[b + 2];
      nrm[3 * j + 2] = data[a] * data[b + 1] - data[a + 1] * data[b];
    }
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < 4; j++) {
      cx += data[o + 3 * j];
      cy += data[o + 3 * j + 1];
      cz += data[o + 3 * j + 2];
    }
    const s = cx * nrm[0] + cy * nrm[1] + cz * nrm[2] >= 0 ? 1 : -1;
    // Bounding box in (ra, dec), padded for great-circle bulge.
    let dmin = 90, dmax = -90;
    let ra0 = 0, rmin = 0, rmax = 0;
    for (let j = 0; j < 4; j++) {
      const x = data[o + 3 * j], y = data[o + 3 * j + 1], z = data[o + 3 * j + 2];
      const dec = Math.asin(Math.max(-1, Math.min(1, z))) * RAD;
      let ra = Math.atan2(y, x) * RAD;
      if (j === 0) ra0 = ra;
      let dr = ra - ra0;
      if (dr > 180) dr -= 360;
      if (dr < -180) dr += 360;
      if (dr < rmin) rmin = dr;
      if (dr > rmax) rmax = dr;
      if (dec < dmin) dmin = dec;
      if (dec > dmax) dmax = dec;
    }
    // Does the quad contain a celestial pole?
    const inside = (x, y, z) =>
      s * (x * nrm[0] + y * nrm[1] + z * nrm[2]) >= 0 &&
      s * (x * nrm[3] + y * nrm[4] + z * nrm[5]) >= 0 &&
      s * (x * nrm[6] + y * nrm[7] + z * nrm[8]) >= 0 &&
      s * (x * nrm[9] + y * nrm[10] + z * nrm[11]) >= 0;
    let fullRa = false;
    if (inside(0, 0, 1)) {
      dmax = 90;
      fullRa = true;
    }
    if (inside(0, 0, -1)) {
      dmin = -90;
      fullRa = true;
    }
    dmin -= 0.2;
    dmax += 0.2;
    const j0 = Math.max(0, Math.floor((dmin + 90) / RING_DEG));
    const j1 = Math.min(g.nRings - 1, Math.floor((dmax + 90) / RING_DEG));
    for (let j = j0; j <= j1; j++) {
      const n = g.ringCount[j];
      const base = g.ringStart[j];
      let k0, k1;
      const decC = -90 + (j + 0.5) * RING_DEG;
      const cosd = Math.cos((Math.min(89.5, Math.abs(decC) + RING_DEG) * Math.PI) / 180);
      const pad = 0.3 / Math.max(cosd, 1e-3);
      if (fullRa || rmax - rmin + 2 * pad >= 360) {
        k0 = 0;
        k1 = n - 1;
      } else {
        let a0 = ra0 + rmin - pad;
        a0 = ((a0 % 360) + 360) % 360;
        k0 = Math.floor((a0 / 360) * n);
        k1 = k0 + Math.ceil(((rmax - rmin + 2 * pad) / 360) * n) + 1;
      }
      for (let kk = k0; kk <= k1; kk++) {
        const cell = base + (kk % n);
        if (first[cell] <= t) continue;
        const c = 3 * cell;
        if (inside(g.centers[c], g.centers[c + 1], g.centers[c + 2])) first[cell] = t;
      }
    }
  }
  // Sort covered cells by first-visit time, accumulate their area.
  const idx = [];
  for (let c = 0; c < g.total; c++) if (first[c] !== Infinity) idx.push(c);
  idx.sort((a, b) => first[a] - first[b]);
  const ringOf = new Uint16Array(g.total);
  for (let j = 0; j < g.nRings; j++) ringOf.fill(j, g.ringStart[j], g.ringStart[j + 1]);
  const times = new Float32Array(idx.length);
  const cumArea = new Float64Array(idx.length + 1);
  const sphere = 4 * Math.PI;
  for (let k = 0; k < idx.length; k++) {
    times[k] = first[idx[k]];
    cumArea[k + 1] = cumArea[k] + g.ringArea[ringOf[idx[k]]] / sphere;
  }
  return { times, cumArea };
}
