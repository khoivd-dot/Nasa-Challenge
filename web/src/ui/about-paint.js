// "Watch SPHEREx paint the sky": every real pointing in the index, replayed in
// the order it was taken on an ecliptic Mollweide map. SPHEREx scans great
// circles through the ecliptic poles and turns about a degree a day with
// Earth's orbit, so the coverage sweeps across the map once per six months.

import { SURVEY_START_MJD, SURVEY_PERIOD } from '../data/survey.js';
import { equatorialToEcliptic } from '../data/sky-math.js';

const DURATION = 16000; // ms for the whole record
const PASS_COLORS = ['rgba(150,160,190,0.3)', 'rgba(76,201,255,0.26)', 'rgba(199,125,255,0.26)', 'rgba(255,179,71,0.3)'];
const passOf = (mjd) => (mjd < SURVEY_START_MJD ? 0 : Math.min(3, 1 + Math.floor((mjd - SURVEY_START_MJD) / SURVEY_PERIOD)));
const fmt = (mjd) => new Date((mjd - 40587) * 864e5).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Mollweide: longitude/latitude in degrees to unit coordinates x in [-2, 2], y in [-1, 1].
function mollweide(lon, lat) {
  const phi = (lat * Math.PI) / 180;
  let t = phi;
  for (let i = 0; i < 8; i++) {
    const f = 2 * t + Math.sin(2 * t) - Math.PI * Math.sin(phi);
    const d = 2 + 2 * Math.cos(2 * t);
    if (Math.abs(d) < 1e-9) break;
    t -= f / d;
  }
  let l = ((lon + 180) % 360 + 360) % 360 - 180; // -180..180
  return [(-2 * l * Math.cos(t)) / 180, Math.sin(t)]; // longitude grows to the left, as on the sky
}

export function mountPaint(root, { P, stars, reduceMotion }) {
  root.innerHTML = `
    <div class="paint-map">
      <canvas class="paint-base" aria-hidden="true"></canvas>
      <canvas class="paint-head" role="img" aria-label="Map of the whole sky filling in with SPHEREx pointings"></canvas>
      <span class="paint-tag paint-tag-n mono">N ecliptic pole</span>
      <span class="paint-tag paint-tag-e mono">Ecliptic: the Sun’s path</span>
    </div>
    <div class="paint-hud">
      <div><span class="label">Date</span><b class="paint-date mono">–</b></div>
      <div><span class="label">Pointings</span><b class="paint-count mono">0</b></div>
      <div class="paint-legend">
        <span style="--c:#4cc9ff">Survey 1</span><span style="--c:#c77dff">Survey 2</span><span style="--c:#ffb347">Survey 3</span>
      </div>
      <button class="btn paint-replay" type="button">Replay</button>
    </div>`;
  const base = root.querySelector('.paint-base');
  const head = root.querySelector('.paint-head');
  const bctx = base.getContext('2d');
  const hctx = head.getContext('2d');
  const elDate = root.querySelector('.paint-date');
  const elCount = root.querySelector('.paint-count');

  // Chronological order and unit-map positions, computed once.
  const n = P.count;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => P.t[a] - P.t[b]);
  const xy = new Float32Array(2 * n);
  const pass = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const [lon, lat] = equatorialToEcliptic(P.ra[i], P.dec[i]);
    const [x, y] = mollweide(lon, lat);
    xy[2 * k] = x;
    xy[2 * k + 1] = y;
    pass[k] = passOf(P.mjd(i));
  }
  const mjd0 = P.mjd(order[0]);
  const mjd1 = P.mjd(order[n - 1]);
  const mjdAt = (k) => P.mjd(order[Math.min(n - 1, k)]);

  let w = 0;
  let h = 0;
  let dpr = 1;
  let drawn = 0; // pointings painted so far
  let t0 = 0;
  let raf = 0;
  let playing = false;

  const toPx = (x, y) => [w / 2 + (x * w) / 4.1, h / 2 - (y * h) / 2.05];

  function backdrop() {
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, w, h);
    // Sky outline and a 30-degree graticule.
    bctx.save();
    bctx.beginPath();
    bctx.ellipse(w / 2, h / 2, w / 2.05, h / 2.05, 0, 0, 2 * Math.PI);
    bctx.fillStyle = 'rgba(8,11,23,0.85)';
    bctx.fill();
    bctx.clip();
    bctx.strokeStyle = 'rgba(140,160,255,0.08)';
    bctx.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += 30) {
      bctx.beginPath();
      for (let lon = -180; lon <= 180; lon += 5) {
        const [x, y] = toPx(...mollweide(lon, lat));
        lon === -180 ? bctx.moveTo(x, y) : bctx.lineTo(x, y);
      }
      bctx.stroke();
    }
    for (let lon = -180; lon <= 180; lon += 30) {
      bctx.beginPath();
      for (let lat = -90; lat <= 90; lat += 5) {
        const [x, y] = toPx(...mollweide(lon + (lon === 180 ? -1e-6 : 0), lat));
        lat === -90 ? bctx.moveTo(x, y) : bctx.lineTo(x, y);
      }
      bctx.stroke();
    }
    // The ecliptic itself.
    bctx.strokeStyle = 'rgba(255,214,90,0.35)';
    bctx.setLineDash([3, 5]);
    bctx.beginPath();
    bctx.moveTo(w / 2 - w / 2.05, h / 2);
    bctx.lineTo(w / 2 + w / 2.05, h / 2);
    bctx.stroke();
    bctx.setLineDash([]);
    // Real naked-eye stars for reference.
    bctx.fillStyle = '#dfe6ff';
    for (const [ra, dec, mag] of stars) {
      if (!(mag < 4.6)) continue;
      const [lon, lat] = equatorialToEcliptic(ra, dec);
      const [x, y] = toPx(...mollweide(lon, lat));
      bctx.globalAlpha = Math.max(0.15, 0.7 - mag * 0.12);
      const r = mag < 2 ? 1.6 : 1;
      bctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
    bctx.globalAlpha = 1;
    bctx.restore();
    bctx.strokeStyle = 'rgba(140,160,255,0.25)';
    bctx.beginPath();
    bctx.ellipse(w / 2, h / 2, w / 2.05, h / 2.05, 0, 0, 2 * Math.PI);
    bctx.stroke();
  }

  function paint(upto) {
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.globalCompositeOperation = 'lighter';
    // Small maps pack the same pointings into fewer pixels: dim them to match.
    bctx.globalAlpha = Math.min(1, w / 900);
    const s = Math.max(1.2, w / 760);
    for (let k = drawn; k < upto; k++) {
      const [x, y] = toPx(xy[2 * k], xy[2 * k + 1]);
      bctx.fillStyle = PASS_COLORS[pass[k]];
      bctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    bctx.globalCompositeOperation = 'source-over';
    bctx.globalAlpha = 1;
    drawn = upto;
    // The newest pointings glow white: SPHEREx's current scan.
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hctx.clearRect(0, 0, w, h);
    if (upto < n) {
      const from = Math.max(0, upto - 260);
      for (let k = from; k < upto; k++) {
        const a = (k - from) / 260;
        const [x, y] = toPx(xy[2 * k], xy[2 * k + 1]);
        hctx.globalAlpha = a * 0.9;
        hctx.fillStyle = '#ffffff';
        hctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      hctx.globalAlpha = 1;
    }
    const m = upto ? mjdAt(upto - 1) : mjd0;
    elDate.textContent = fmt(m);
    elCount.textContent = upto.toLocaleString('en-US');
  }

  function frame(now) {
    raf = 0;
    if (!playing) return;
    const f = Math.min(1, (now - t0) / DURATION);
    // Advance by time, not by row, so quiet weeks pass as quickly as busy ones.
    const target = mjd0 + f * (mjd1 - mjd0);
    let k = drawn;
    while (k < n && mjdAt(k) <= target) k++;
    paint(f >= 1 ? n : k);
    if (f < 1) raf = requestAnimationFrame(frame);
    else playing = false;
  }

  function play() {
    drawn = 0;
    backdrop();
    if (reduceMotion) return paint(n);
    playing = true;
    t0 = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = base.clientWidth;
    h = base.clientHeight;
    for (const c of [base, head]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const upto = drawn;
    drawn = 0;
    backdrop();
    paint(upto);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(base);

  root.querySelector('.paint-replay').addEventListener('click', play);

  let started = false;
  return {
    start() {
      if (started) return;
      started = true;
      play();
    },
    pause() {
      if (playing) {
        playing = false;
        cancelAnimationFrame(raf);
        raf = 0;
        this.resumeAt = performance.now();
      }
    },
    resume() {
      if (this.resumeAt && drawn < n) {
        t0 += performance.now() - this.resumeAt;
        this.resumeAt = 0;
        playing = true;
        raf = requestAnimationFrame(frame);
      }
    },
    destroy() {
      this.pause();
      ro.disconnect();
    },
  };
}
