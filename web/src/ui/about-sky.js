// Background sky for the About page: the real naked-eye stars (Hipparcos via
// d3-celestial, magnitude 6 and brighter) seen through a slowly drifting
// camera. warp() narrows the field of view so fast that the stars streak
// outward: a jump to hyperspace drawn with real stars.

import { DEG, radecToVec } from '../data/sky-math.js';
import { starHex, ABOUT, alpha } from './palette.js';

const FOV = 80; // diagonal field of view at rest, degrees
const DRIFT = 0.35; // degrees of right ascension per second


export function createAboutSky(canvas, { reduceMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  let stars = []; // { v: [x,y,z], r, a, c }
  let w = 0;
  let h = 0;
  let dpr = 1;
  let ra0 = 84; // Orion to start
  let dec0 = -2;
  let scroll = 0;
  let fov = FOV;
  let running = false;
  let raf = 0;
  let last = 0;
  let warp = null; // { t0, dur, phase, resolve, from }

  const glow = document.createElement('canvas');
  glow.width = glow.height = 64;
  {
    const g = glow.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.45, alpha(ABOUT.streak, 0.18));
    grad.addColorStop(1, alpha(ABOUT.streak, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    draw(0);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // Camera basis: forward, east and north at the view center.
  function basis(ra, dec) {
    const f = radecToVec(ra, dec);
    const e = [-Math.sin(ra * DEG), Math.cos(ra * DEG), 0];
    const n = [f[1] * e[2] - f[2] * e[1], f[2] * e[0] - f[0] * e[2], f[0] * e[1] - f[1] * e[0]];
    return { f, e, n };
  }

  // Focal length in CSS pixels for a diagonal field of view.
  const focal = (deg) => Math.hypot(w, h) / 2 / Math.tan((Math.min(deg, 170) * DEG) / 2);

  function draw(streak) {
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const dec = Math.max(-80, Math.min(80, dec0 + scroll * 55));
    const { f, e, n } = basis(ra0, dec);
    const fl = focal(fov);
    // During a warp, each star is also drawn where it was a moment ago, so it streaks.
    const fl0 = streak ? focal(streak) : 0;
    const cx = w / 2;
    const cy = h / 2;
    const lim = Math.hypot(w, h);
    ctx.lineCap = 'round';
    for (const s of stars) {
      const v = s.v;
      const z = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
      if (z < 0.05) continue;
      const px = -(v[0] * e[0] + v[1] * e[1] + v[2] * e[2]) / z;
      const py = -(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) / z;
      const x = cx + px * fl;
      const y = cy + py * fl;
      if (streak) {
        const x0 = cx + px * fl0;
        const y0 = cy + py * fl0;
        if (Math.abs(x0 - cx) > lim || Math.abs(y0 - cy) > lim) continue;
        ctx.globalAlpha = s.a;
        ctx.strokeStyle = s.c;
        ctx.lineWidth = Math.max(0.6, s.r * 0.9);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x, y);
        ctx.stroke();
        continue;
      }
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      ctx.globalAlpha = s.a;
      if (s.r > 1.6) {
        const g = s.r * 5;
        ctx.drawImage(glow, x - g, y - g, 2 * g, 2 * g);
      } else {
        ctx.fillStyle = s.c;
        ctx.fillRect(x - s.r / 2, y - s.r / 2, s.r, s.r);
      }
    }
    ctx.globalAlpha = 1;
  }

  const ease = (t) => t * t * t;

  function frame(now) {
    raf = 0;
    if (!running) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    let streak = 0;
    if (warp) {
      const t = Math.min(1, (now - warp.t0) / warp.dur);
      if (warp.phase === 'in') {
        // Zoom from the resting field to a sliver: stars rush outward.
        const k = ease(t);
        fov = FOV * Math.exp(Math.log(1 / 70) * k);
        streak = FOV * Math.exp(Math.log(1 / 70) * ease(Math.max(0, t - 0.22)));
        if (t >= 1) {
          warp.resolve();
          ra0 = (ra0 + 70) % 360;
          warp = { ...warp, t0: now, dur: 600, phase: 'out' };
        }
      } else {
        // Drop out of hyperspace somewhere new: the field opens back up.
        const k = 1 - (1 - t) ** 3;
        fov = 6 + (FOV - 6) * k;
        streak = t < 0.6 ? 6 + (FOV - 6) * Math.max(0, k - 0.25) : 0;
        if (t >= 1) {
          fov = FOV;
          warp.done();
          warp = null;
        }
      }
    } else if (!reduceMotion) ra0 = (ra0 + DRIFT * dt) % 360;
    draw(streak);
    raf = requestAnimationFrame(frame);
  }

  return {
    setStars(list) {
      // [ra, dec, mag, bv] rows; anything else is skipped.
      stars = [];
      for (const row of Array.isArray(list) ? list : []) {
        const [ra, dec, mag, bv] = row;
        if (![ra, dec, mag].every(Number.isFinite)) continue;
        stars.push({
          v: radecToVec(ra, dec),
          r: Math.max(0.7, Math.min(2.8, 2.6 - 0.34 * mag)),
          a: Math.max(0.28, Math.min(1, 1.15 - 0.13 * mag)),
          c: starHex(bv),
        });
      }
      draw(0);
    },
    setScroll(f) {
      scroll = f;
      if (!running) draw(0);
    },
    start() {
      if (running) return;
      running = true;
      last = 0;
      resize();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    /** Jump to hyperspace. Resolves at the flash, when the page can move underneath. */
    warp() {
      if (reduceMotion || !running) return Promise.resolve();
      if (warp) return warp.promise;
      let resolve;
      const promise = new Promise((r) => (resolve = r));
      warp = { t0: performance.now(), dur: 700, phase: 'in', resolve, promise, done: () => {} };
      return promise;
    },
    destroy() {
      this.stop();
      ro.disconnect();
    },
  };
}
