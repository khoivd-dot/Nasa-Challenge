// Automatic moving-object finder. Works on frames already aligned to a common
// north-up grid: subtract the median (static) sky, find point-like excesses in
// each frame, then link detections that line up at a constant velocity across
// at least three frames. This is the same idea as Clyde Tombaugh's blink
// comparator, done by arithmetic.

import { residual, medianStack } from './render.js';

const MAX_PER_FRAME = 25;

export function detect(z, median, masked, N, { threshold = 6 } = {}) {
  const out = [];
  const res = residual(z, median, N);
  for (let y = 2; y < N - 2; y++) {
    for (let x = 2; x < N - 2; x++) {
      const k = y * N + x;
      const d = res[k];
      if (!(d > threshold)) continue;
      // Excess on top of a static source is mostly the star looking different at
      // another wavelength, not motion: require empty sky in the median image.
      if (median[k] > 3 || median[k - 1] > 3 || median[k + 1] > 3 || median[k - N] > 3 || median[k + N] > 3) continue;
      let peak = true;
      let bad = false;
      for (let dy = -1; dy <= 1 && peak; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = k + dy * N + dx;
          if (masked && masked[j]) bad = true;
          if (res[j] > d) {
            peak = false;
            break;
          }
        }
      }
      if (!peak || bad || (masked && masked[k])) continue;
      // Intensity-weighted centroid in a 3x3 box.
      let sx = 0;
      let sy = 0;
      let sw = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const w = Math.max(0, res[k + dy * N + dx]);
          sx += w * dx;
          sy += w * dy;
          sw += w;
        }
      }
      out.push({ x: x + sx / sw, y: y + sy / sw, snr: d });
    }
  }
  out.sort((a, b) => b.snr - a.snr);
  return out.slice(0, MAX_PER_FRAME);
}

/**
 * @param frames [{z, mjd, masked}] aligned frames, any order
 * @param median static-sky median of the same frames
 * @returns tracks [{points: [{f, x, y, mjd, snr}], rate (px/h), vx, vy}]
 */
export function findMovers(frames, median, N, { threshold = 6, window = 240, minMove = 1.6, maxRate = 80, apart = 36 } = {}) {
  const order = frames.map((f, i) => ({ f, i })).sort((a, b) => a.f.mjd - b.f.mjd);
  const dets = order.map(({ f, i }) => {
    // Static-sky reference for this frame: the median of frames taken well
    // before or after it, so a slow mover never contaminates its own reference.
    const others = frames.filter((g) => Math.abs(g.mjd - f.mjd) * 24 > apart);
    const ref = others.length >= 3 ? medianStack(others.map((g) => g.z)) : median;
    return { i, t: f.mjd * 24, list: detect(f.z, ref, f.masked, N, { threshold }).map((d) => ({ ...d, used: false })) };
  });
  const candidates = [];
  for (let a = 0; a < dets.length; a++) {
    for (let b = a + 1; b < dets.length; b++) {
      const dt = dets[b].t - dets[a].t;
      if (dt <= 0.2) continue; // sub-exposures of one pointing are minutes apart
      if (dt > window) break;
      for (const p of dets[a].list) {
        for (const q of dets[b].list) {
          const vx = (q.x - p.x) / dt;
          const vy = (q.y - p.y) / dt;
          const move = Math.hypot(q.x - p.x, q.y - p.y);
          if (move < minMove || move / dt > maxRate) continue;
          const pts = [];
          for (let c = 0; c < dets.length; c++) {
            const ddt = dets[c].t - dets[a].t;
            if (ddt < -window || ddt > window + dt) continue;
            const px = p.x + vx * ddt;
            const py = p.y + vy * ddt;
            if (px < 0 || py < 0 || px >= N || py >= N) continue;
            const tol = 1.4 + 0.02 * Math.abs(ddt) * Math.hypot(vx, vy);
            let best = null;
            let bestD = tol;
            for (const r of dets[c].list) {
              const dd = Math.hypot(r.x - px, r.y - py);
              if (dd < bestD) {
                bestD = dd;
                best = r;
              }
            }
            if (best) pts.push({ c, det: best });
          }
          // A few aligned blips can happen by chance, so demand a tight line:
          // four or more detections, or three strong ones within a day.
          const fit = fitResidual(pts, dets);
          const hours = dets[pts.at(-1).c].t - dets[pts[0].c].t;
          const ok = (pts.length >= 4 && fit < 1.0) || (pts.length === 3 && hours <= 24 && fit < 0.5 && pts.every((x) => x.det.snr >= 10));
          if (ok) {
            const span = Math.hypot(pts.at(-1).det.x - pts[0].det.x, pts.at(-1).det.y - pts[0].det.y);
            if (span >= minMove * 1.5) candidates.push({ pts, vx, vy, score: pts.reduce((s, x) => s + Math.min(x.det.snr, 50), 0) });
          }
        }
      }
    }
  }
  candidates.sort((x, y) => y.pts.length - x.pts.length || y.score - x.score);
  const tracks = [];
  for (const cand of candidates) {
    if (cand.pts.some((p) => p.det.used)) continue;
    cand.pts.forEach((p) => (p.det.used = true));
    const points = cand.pts.map(({ c, det }) => ({ f: dets[c].i, x: det.x, y: det.y, mjd: dets[c].t / 24, snr: det.snr }));
    // Least-squares velocity over all linked points.
    const t0 = points[0].mjd * 24;
    let st = 0;
    let stt = 0;
    let sx = 0;
    let sy = 0;
    let stx = 0;
    let sty = 0;
    for (const p of points) {
      const t = p.mjd * 24 - t0;
      st += t;
      stt += t * t;
      sx += p.x;
      sy += p.y;
      stx += t * p.x;
      sty += t * p.y;
    }
    const n = points.length;
    const den = n * stt - st * st || 1;
    const vx = (n * stx - st * sx) / den;
    const vy = (n * sty - st * sy) / den;
    tracks.push({ points, vx, vy, rate: Math.hypot(vx, vy) });
    if (tracks.length >= 12) break;
  }
  return tracks;
}

/** RMS distance (px) of linked points from their best-fit constant-velocity line. */
function fitResidual(pts, dets) {
  const P = pts.map(({ c, det }) => ({ t: dets[c].t, x: det.x, y: det.y }));
  const n = P.length;
  const mt = P.reduce((s, p) => s + p.t, 0) / n;
  const mx = P.reduce((s, p) => s + p.x, 0) / n;
  const my = P.reduce((s, p) => s + p.y, 0) / n;
  let stt = 0;
  let stx = 0;
  let sty = 0;
  for (const p of P) {
    stt += (p.t - mt) ** 2;
    stx += (p.t - mt) * (p.x - mx);
    sty += (p.t - mt) * (p.y - my);
  }
  const vx = stx / (stt || 1);
  const vy = sty / (stt || 1);
  let r = 0;
  for (const p of P) r += (p.x - mx - vx * (p.t - mt)) ** 2 + (p.y - my - vy * (p.t - mt)) ** 2;
  return Math.sqrt(r / n);
}

/** Plain-language guess of what a mover is, from its rate in arcsec/hour. */
export function classifyRate(arcsecPerHour) {
  if (arcsecPerHour < 0.01) return 'Barely moving: a nearby star drifting over months';
  if (arcsecPerHour < 5) return 'Slow mover: a distant object (outer solar system) or a faraway asteroid';
  if (arcsecPerHour < 70) return 'Typical main-belt asteroid speed';
  return 'Fast mover: possibly a near-Earth asteroid';
}
