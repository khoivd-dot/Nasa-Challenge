// Turn one SPHEREx Level 2 file into an aligned, north-up cutout around a sky
// position: range-read the header and only the detector rows we need, then
// resample through the file's TAN-SIP WCS onto a common grid so frames taken
// months apart (at different roll angles) line up pixel for pixel.

import { SpherexFile, W, isBadPixel } from '../fits/spherex.js';
import { tanDeproject } from '../data/sky-math.js';

const files = new Map(); // url -> Promise<SpherexFile> (headers are tiny; keep them)

function openFile(url) {
  if (!files.has(url)) {
    const p = new SpherexFile(url).open();
    p.catch(() => files.delete(url));
    files.set(url, p);
  }
  return files.get(url);
}

// Limit concurrent S3 work; browsers allow ~6 connections per host anyway.
const queue = [];
let active = 0;
const MAX_ACTIVE = 4;
function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}
function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active++;
    job
      .task()
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        pump();
      });
  }
}
export function clearQueue() {
  for (const job of queue.splice(0)) job.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
}

/**
 * @param {object} o
 * @param {string} o.url     Level 2 FITS URL
 * @param {number} o.ra      cutout center (deg)
 * @param {number} o.dec
 * @param {number} o.size    output pixels per side
 * @param {number} o.scale   output arcsec per pixel
 */
export function makeCutout(o) {
  return schedule(() => cutoutNow(o));
}

async function cutoutNow({ url, ra, dec, size = 96, scale = 6.15 }) {
  const f = await openFile(url);
  const N = size;
  const s = scale / 3600;
  const half = (N - 1) / 2;
  const xs = new Float32Array(N * N);
  const ys = new Float32Array(N * N);
  let ymin = Infinity;
  let ymax = -Infinity;
  let xmin = Infinity;
  let xmax = -Infinity;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      // East is left, north is up.
      const [r, d] = tanDeproject(ra, dec, -(i - half) * s, (half - j) * s);
      const p = f.wcs.skyToPix(r, d);
      const k = j * N + i;
      if (!p) {
        xs[k] = ys[k] = NaN;
        continue;
      }
      xs[k] = p[0];
      ys[k] = p[1];
      if (p[1] < ymin) ymin = p[1];
      if (p[1] > ymax) ymax = p[1];
      if (p[0] < xmin) xmin = p[0];
      if (p[0] > xmax) xmax = p[0];
    }
  }
  if (xmax < 1 || xmin > W || ymax < 1 || ymin > W) return null;
  const y0 = Math.max(1, Math.floor(ymin) - 1);
  const y1 = Math.min(W, Math.ceil(ymax) + 1);
  const [img, flags, wave] = await Promise.all([
    f.readRows(y0, y1),
    f.readFlagRows(y0, y1).catch(() => null),
    (async () => {
      const c = f.wcs.skyToPix(ra, dec);
      return c ? { ...(await f.wavelength(c[0], c[1]).catch(() => ({}))), x: c[0], y: c[1] } : {};
    })(),
  ]);

  const data = new Float32Array(N * N);
  const masked = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const x = xs[k] - 1; // 0-based array coords
    const y = ys[k] - y0; // relative to the first fetched row
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!(ix >= 0 && iy >= 0 && ix < W - 1 && iy < y1 - y0)) {
      data[k] = NaN;
      continue;
    }
    const fx = x - ix;
    const fy = y - iy;
    let sum = 0;
    let wsum = 0;
    let bad = 0;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const idx = (iy + dy) * W + ix + dx;
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        const v = img[idx];
        if (flags && isBadPixel(flags[idx])) {
          bad += w;
          continue;
        }
        if (v === v) {
          sum += w * v;
          wsum += w;
        }
      }
    }
    if (bad > 0.5) masked[k] = 1;
    data[k] = wsum > 0.05 ? sum / wsum : NaN;
  }
  const stats = robustStats(data);
  return {
    url,
    data,
    masked,
    N,
    scale,
    ra,
    dec,
    mjd: f.mjd,
    date: f.dateObs,
    detector: f.detector,
    obsId: f.obsId,
    lambda: wave.lambda,
    bandwidth: wave.bandwidth,
    px: wave.x,
    py: wave.y,
    psfFwhm: f.psfFwhm,
    bytes: (y1 - y0 + 1) * W * 4 * (flags ? 2 : 1),
    ...stats,
  };
}

/** Median background and MAD-based noise of finite pixels. */
export function robustStats(data) {
  const vals = [];
  const step = Math.max(1, Math.floor(data.length / 6000));
  for (let k = 0; k < data.length; k += step) if (data[k] === data[k]) vals.push(data[k]);
  if (!vals.length) return { bg: 0, sigma: 1, valid: 0 };
  vals.sort((a, b) => a - b);
  const bg = vals[vals.length >> 1];
  const dev = vals.map((v) => Math.abs(v - bg)).sort((a, b) => a - b);
  const sigma = Math.max(1e-6, 1.4826 * dev[dev.length >> 1]);
  return { bg, sigma, valid: vals.length / Math.ceil(data.length / step) };
}
