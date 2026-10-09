// Deep view: drizzle every loaded visit onto one grid up to three times finer
// than a single frame. SPHEREx's 6.15″ pixels undersample its optics and each
// visit lands at a different sub-pixel offset, so dithered frames together
// carry detail no single frame has (Fruchter & Hook 2002, "Drizzle"), and
// averaging N visits cuts the noise by about √N. Samples that disagree with the
// median of all visits (cosmic rays, satellite trails, asteroids) are left out.

import { fluxScale, stretch } from './render.js';
import { robustStats } from './cutout.js';

/** Bilinear sample of an N×N grid at (x, y) in pixel-center coordinates. */
function sample(grid, N, x, y) {
  const ix = Math.min(N - 2, Math.max(0, Math.floor(x)));
  const iy = Math.min(N - 2, Math.max(0, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - ix));
  const fy = Math.min(1, Math.max(0, y - iy));
  const k = iy * N + ix;
  const a = grid[k];
  const b = grid[k + 1];
  const c = grid[k + N];
  const d = grid[k + N + 1];
  return (1 - fy) * ((1 - fx) * a + fx * b) + fy * ((1 - fx) * c + fx * d);
}

/** Largest step to a neighbour: how fast the static sky changes at each pixel. */
function gradient(median, N) {
  const g = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = y * N + x;
      const m = median[k];
      let best = 0;
      if (x > 0) best = Math.max(best, Math.abs(m - median[k - 1]));
      if (x < N - 1) best = Math.max(best, Math.abs(m - median[k + 1]));
      if (y > 0) best = Math.max(best, Math.abs(m - median[k - N]));
      if (y < N - 1) best = Math.max(best, Math.abs(m - median[k + N]));
      g[k] = best === best ? best : 0;
    }
  }
  return g;
}

/** Replace NaN with 0 so bilinear sampling of the median never spreads holes. */
function finite(grid) {
  const out = new Float32Array(grid.length);
  for (let k = 0; k < grid.length; k++) out[k] = grid[k] === grid[k] ? grid[k] : 0;
  return out;
}

/**
 * @param frames  Lab frames ({frame}) whose cutouts kept their detector samples
 * @param median  per-pixel median of the frames' normalized cutouts (N×N)
 * @returns {{img: Float32Array, NF: number, used: number, rejected: number, pixfrac: number, coverage: number}}
 *          image in noise units of the combined data, NF = N * factor per side
 */
export function drizzle(frames, median, { N, factor = 2, pixfrac, clip = 5 }) {
  const NF = N * factor;
  // Few visits cannot fill a fine grid evenly with small drops: grow them
  // until the weight map is flat to ~10% (measured on Orion: 21 visits at
  // pixfrac 0.6 left an 18% ripple that showed as fine cross-hatching).
  const count = frames.filter((f) => f.frame.samples?.n).length;
  pixfrac ??= count >= 40 ? 0.7 : count >= 12 ? 0.8 : 1;
  const sum = new Float32Array(NF * NF);
  const wsum = new Float32Array(NF * NF);
  const med = finite(median);
  const grad = gradient(med, N);
  // Half-width of each drop in fine pixels: a detector pixel is ~one output
  // pixel, shrunk by pixfrac so the result stays sharp.
  const h = (pixfrac * factor) / 2;
  let used = 0;
  let rejected = 0;
  for (const { frame } of frames) {
    const sm = frame.samples;
    if (!sm || !sm.n) continue;
    // Frames are taken at different wavelengths: scale each to the median.
    const k = fluxScale(med, frame.z);
    const inv = 1 / (frame.sigma * k);
    used++;
    for (let n = 0; n < sm.n; n++) {
      const u = sm.u[n];
      const v = sm.v[n];
      const z = (sm.val[n] - frame.bg) * inv;
      const m = sample(med, N, u, v);
      if (Math.abs(z - m) > clip + 0.5 * Math.abs(m) + 1.5 * sample(grad, N, u, v)) {
        rejected++;
        continue;
      }
      const X = (u + 0.5) * factor;
      const Y = (v + 0.5) * factor;
      const i0 = Math.max(0, Math.floor(X - h));
      const i1 = Math.min(NF - 1, Math.floor(X + h));
      const j0 = Math.max(0, Math.floor(Y - h));
      const j1 = Math.min(NF - 1, Math.floor(Y + h));
      for (let j = j0; j <= j1; j++) {
        const oy = Math.min(Y + h, j + 1) - Math.max(Y - h, j);
        if (oy <= 0) continue;
        for (let i = i0; i <= i1; i++) {
          const ox = Math.min(X + h, i + 1) - Math.max(X - h, i);
          if (ox <= 0) continue;
          const w = ox * oy;
          const q = j * NF + i;
          sum[q] += w * z;
          wsum[q] += w;
        }
      }
    }
  }
  const img = new Float32Array(NF * NF);
  const hole = new Uint8Array(NF * NF);
  let holes = 0;
  let w1 = 0;
  let w2 = 0;
  for (let q = 0; q < img.length; q++) {
    if (wsum[q] > 1e-4) img[q] = sum[q] / wsum[q];
    else (hole[q] = 1), holes++;
    w1 += wsum[q];
    w2 += wsum[q] * wsum[q];
  }
  // Relative scatter of the weight map: high values show up as a fine pattern.
  const wm = w1 / img.length;
  const coverage = Math.sqrt(Math.max(0, w2 / img.length - wm * wm)) / wm;
  if (holes) fillHoles(img, hole, NF, med, N, factor);
  // Back to noise units of the combined image, so the display stretch shows its
  // (much lower) noise floor the way it shows a single frame's.
  const { bg, sigma } = robustStats(img);
  for (let q = 0; q < img.length; q++) img[q] = (img[q] - bg) / sigma;
  return { img, NF, used, rejected, pixfrac, coverage };
}

/**
 * Pixels no visit covered (mostly saturated star cores, which every frame
 * flags) are grown inwards from their neighbours, so cores read as solid
 * stars instead of dark rings. Anything left falls back to the median.
 */
function fillHoles(img, hole, NF, med, N, factor) {
  for (let pass = 0; pass < 24; pass++) {
    const filled = [];
    for (let j = 0; j < NF; j++) {
      for (let i = 0; i < NF; i++) {
        const q = j * NF + i;
        if (!hole[q]) continue;
        let s = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const x = i + di;
            const y = j + dj;
            if (x < 0 || y < 0 || x >= NF || y >= NF) continue;
            const p = y * NF + x;
            if (!hole[p]) (s += img[p]), n++;
          }
        }
        if (n >= 2) filled.push(q, s / n);
      }
    }
    if (!filled.length) break;
    for (let t = 0; t < filled.length; t += 2) {
      img[filled[t]] = filled[t + 1];
      hole[filled[t]] = 0;
    }
  }
  for (let q = 0; q < img.length; q++) {
    if (!hole[q]) continue;
    const i = q % NF;
    const j = (q - i) / NF;
    img[q] = sample(med, N, (i + 0.5) / factor - 0.5, (j + 0.5) / factor - 0.5);
  }
}

/**
 * Lupton et al. (2004)-style color: stretch the summed brightness with the
 * display asinh curve and keep each pixel's channel ratios, so faint stars
 * keep their color instead of fading to grey.
 */
export function paintColor(img, r, g, b, opts) {
  const px = img.data;
  const black = opts.black ?? -1.5;
  const soft = opts.soft ?? 3;
  const full = Math.asinh(((opts.max ?? 120) - black) / soft);
  for (let k = 0; k < r.length; k++) {
    const R = r[k] - black;
    const G = g[k] - black;
    const B = b[k] - black;
    const I = (R + G + B) / 3;
    const o = 4 * k;
    px[o + 3] = 255;
    if (!(I > 0)) {
      px[o] = px[o + 1] = px[o + 2] = 0;
      continue;
    }
    const f = stretch(I + black, opts) / I;
    let rr = Math.max(0, R * f);
    let gg = Math.max(0, G * f);
    let bb = Math.max(0, B * f);
    const top = Math.max(rr, gg, bb);
    if (top > 1) {
      rr /= top;
      gg /= top;
      bb /= top;
    }
    // Roll the brightest cores off to white, as film and the eye do, instead
    // of leaving them as flat saturated hues darker than their own halos.
    const t = Math.min(1, Math.max(0, (Math.asinh(I / soft) / full - 0.85) / 0.5));
    px[o] = 255 * (rr + (1 - rr) * t);
    px[o + 1] = 255 * (gg + (1 - gg) * t);
    px[o + 2] = 255 * (bb + (1 - bb) * t);
  }
}
