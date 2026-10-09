// Pixel pipelines for the Blink Lab: normalization, stretches, colormaps,
// difference images, median stacks and the time-colored "trails" composite.

// Each frame is first expressed in noise units, z = (data - background) / sigma,
// so frames taken at different wavelengths share one display scale.
export function normalize(frame) {
  if (frame.z) return frame.z;
  const { data, bg, sigma } = frame;
  const z = new Float32Array(data.length);
  for (let k = 0; k < data.length; k++) z[k] = (data[k] - bg) / sigma;
  frame.z = z;
  return z;
}

export function stretch(z, { soft = 3, max = 120, black = -1.5 } = {}) {
  if (z !== z) return -1;
  const v = Math.asinh((z - black) / soft) / Math.asinh((max - black) / soft);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lut(stops) {
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let c = 0; c < 3; c++) out[3 * i + c] = c0[c] + f * (c1[c] - c0[c]);
  }
  return out;
}

export const COLORMAPS = {
  gray: lut([
    [0, [4, 5, 11]],
    [1, [255, 255, 255]],
  ]),
  infrared: lut([
    [0, [3, 2, 10]],
    [0.25, [58, 12, 95]],
    [0.5, [176, 46, 84]],
    [0.75, [247, 140, 40]],
    [1, [255, 252, 220]],
  ]),
  ice: lut([
    [0, [2, 4, 12]],
    [0.35, [18, 52, 110]],
    [0.7, [80, 190, 240]],
    [1, [240, 252, 255]],
  ]),
};

const NAN_RGB = [10, 12, 22];

/** Paint a normalized frame into an ImageData with a colormap. */
export function paintFrame(img, z, opts, cmap = COLORMAPS.gray) {
  const px = img.data;
  for (let k = 0; k < z.length; k++) {
    const v = stretch(z[k], opts);
    const o = 4 * k;
    if (v < 0) {
      px[o] = NAN_RGB[0];
      px[o + 1] = NAN_RGB[1];
      px[o + 2] = NAN_RGB[2];
    } else {
      const i = 3 * Math.round(v * 255);
      px[o] = cmap[i];
      px[o + 1] = cmap[i + 1];
      px[o + 2] = cmap[i + 2];
    }
    px[o + 3] = 255;
  }
}

/** Flux scale that best matches frame b to frame a (median ratio on bright pixels). */
export function fluxScale(za, zb) {
  const r = [];
  for (let k = 0; k < za.length; k++) {
    if (za[k] > 12 && zb[k] > 0 && za[k] < 2000) r.push(zb[k] / za[k]);
  }
  if (r.length < 5) return 1;
  r.sort((x, y) => x - y);
  return Math.min(4, Math.max(0.25, r[r.length >> 1]));
}

/** B minus flux-matched A, painted with a diverging blue-black-orange map. */
export function paintDifference(img, za, zb, { max = 40 } = {}) {
  const k = fluxScale(za, zb);
  const px = img.data;
  for (let i = 0; i < za.length; i++) {
    const d = zb[i] - k * za[i];
    const o = 4 * i;
    px[o + 3] = 255;
    if (d !== d) {
      px[o] = NAN_RGB[0];
      px[o + 1] = NAN_RGB[1];
      px[o + 2] = NAN_RGB[2];
      continue;
    }
    const v = Math.asinh(Math.abs(d) / 3) / Math.asinh(max / 3);
    const t = Math.min(1, v);
    if (d > 0) {
      px[o] = 12 + 243 * t;
      px[o + 1] = 10 + 170 * t * t;
      px[o + 2] = 18 + 50 * t * t;
    } else {
      px[o] = 12 + 60 * t * t;
      px[o + 1] = 10 + 190 * t * t;
      px[o + 2] = 18 + 237 * t;
    }
  }
}

/** Per-pixel median of normalized frames (NaN-aware): the static sky. */
export function medianStack(zs) {
  const n = zs[0].length;
  const out = new Float32Array(n);
  const buf = new Float32Array(zs.length);
  for (let k = 0; k < n; k++) {
    let m = 0;
    for (const z of zs) if (z[k] === z[k]) buf[m++] = z[k];
    if (!m) {
      out[k] = NaN;
      continue;
    }
    const s = buf.subarray(0, m).sort();
    out[k] = m & 1 ? s[m >> 1] : 0.5 * (s[m / 2 - 1] + s[m / 2]);
  }
  return out;
}

/** Time-ordered hue for frame index i of n (violet -> cyan -> green -> amber -> red). */
export function timeColor(i, n) {
  const t = n <= 1 ? 0 : i / (n - 1);
  const h = 270 - 270 * t;
  return hsl(h, 0.95, 0.6);
}

export function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}

/**
 * Point-like change of one frame against the static sky: z - median with the
 * large-scale part removed (block medians, bilinearly interpolated), so a
 * frame with a brighter background or nebula at another wavelength does not
 * light up as a whole.
 */
export function residual(z, median, N, block = 12) {
  const r = new Float32Array(N * N);
  for (let k = 0; k < r.length; k++) r[k] = z[k] - median[k];
  const nb = Math.ceil(N / block);
  const grid = new Float32Array(nb * nb);
  const buf = [];
  for (let by = 0; by < nb; by++) {
    for (let bx = 0; bx < nb; bx++) {
      buf.length = 0;
      for (let y = by * block; y < Math.min(N, (by + 1) * block); y++)
        for (let x = bx * block; x < Math.min(N, (bx + 1) * block); x++) {
          const v = r[y * N + x];
          if (v === v) buf.push(v);
        }
      buf.sort((a, b) => a - b);
      grid[by * nb + bx] = buf.length ? buf[buf.length >> 1] : 0;
    }
  }
  for (let y = 0; y < N; y++) {
    const gy = Math.min(nb - 1, Math.max(0, (y + 0.5) / block - 0.5));
    const y0 = Math.floor(gy);
    const y1 = Math.min(nb - 1, y0 + 1);
    const fy = gy - y0;
    for (let x = 0; x < N; x++) {
      const gx = Math.min(nb - 1, Math.max(0, (x + 0.5) / block - 0.5));
      const x0 = Math.floor(gx);
      const x1 = Math.min(nb - 1, x0 + 1);
      const fx = gx - x0;
      const b =
        (1 - fy) * ((1 - fx) * grid[y0 * nb + x0] + fx * grid[y0 * nb + x1]) + fy * ((1 - fx) * grid[y1 * nb + x0] + fx * grid[y1 * nb + x1]);
      r[y * N + x] -= b;
    }
  }
  return r;
}

/**
 * Static sky in grey, plus everything that is brighter than the median in a
 * given frame painted in that frame's time color: movers become rainbow trails.
 */
export function paintTrails(img, zs, median, opts, { threshold = 4, colors, N } = {}) {
  const px = img.data;
  const n = median.length;
  const side = N || Math.round(Math.sqrt(n));
  const res = zs.map((z) => residual(z, median, side));
  for (let k = 0; k < n; k++) {
    const base = stretch(median[k], opts);
    let r = base < 0 ? NAN_RGB[0] : 200 * base;
    let g = base < 0 ? NAN_RGB[1] : 205 * base;
    let b = base < 0 ? NAN_RGB[2] : 220 * base;
    for (let f = 0; f < zs.length; f++) {
      const d = res[f][k];
      // Ignore excess on top of bright static stars: that is mostly color, not motion.
      if (d > threshold && d > 0.35 * Math.abs(median[k])) {
        const w = Math.min(1, Math.asinh(d / 4) / Math.asinh(30));
        const c = colors[f];
        r += c[0] * w;
        g += c[1] * w;
        b += c[2] * w;
      }
    }
    const o = 4 * k;
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = 255;
  }
}
