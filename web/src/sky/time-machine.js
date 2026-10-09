// Time machine: timeline with survey-pass bands, a histogram of real
// pointings per day, play/pause, speed and live counters.

import { mjdToDate } from '../data/pointings.js';
import { SURVEY_START_MJD, SURVEY_PERIOD } from './footprints.js';

const SPEEDS = [
  { v: 1, label: '1 d/s', aria: '1 day per second' },
  { v: 7, label: '1 wk/s', aria: '1 week per second' },
  { v: 30, label: '1 mo/s', aria: '1 month per second' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';

export function createTimeMachine(parent, { tMin, tMax, times, colors, onSeek, onTogglePlay, onSpeed, speed }) {
  const el = document.createElement('section');
  el.className = 'sky-time glass';
  el.setAttribute('aria-label', 'Time machine');
  el.innerHTML = `
    <div class="sky-time-row">
      <button class="btn icon primary sky-play" type="button" aria-label="Play survey timeline">${ICON_PLAY}</button>
      <div class="sky-stat sky-stat-date">
        <span class="label">Date <span class="sky-utc">UTC</span></span>
        <span class="mono sky-date">-</span>
      </div>
      <div class="sky-stat">
        <span class="label">Pointings</span>
        <span class="mono sky-count">-</span>
      </div>
      <div class="sky-stat">
        <span class="label">Sky covered</span>
        <span class="mono sky-cover">-</span>
      </div>
      <div class="seg sky-speed" role="group" aria-label="Playback speed">
        ${SPEEDS.map((s) => `<button type="button" data-v="${s.v}" aria-label="${s.aria}" aria-pressed="${s.v === speed}">${s.label}</button>`).join('')}
      </div>
    </div>
    <div class="sky-track" tabindex="0" role="slider" aria-label="Survey time"
         aria-valuemin="${tMin}" aria-valuemax="${tMax}" aria-valuenow="${tMax}">
      <canvas class="sky-hist" aria-hidden="true"></canvas>
      <div class="sky-bands" aria-hidden="true"></div>
      <div class="sky-elapsed" aria-hidden="true"></div>
      <div class="sky-head" aria-hidden="true"><span class="sky-head-dot"></span></div>
    </div>
    <div class="sky-ticks" aria-hidden="true"></div>
  `;
  parent.appendChild(el);

  const $ = (s) => el.querySelector(s);
  const playBtn = $('.sky-play');
  const dateEl = $('.sky-date');
  const countEl = $('.sky-count');
  const coverEl = $('.sky-cover');
  const track = $('.sky-track');
  const head = $('.sky-head');
  const elapsed = $('.sky-elapsed');
  const hist = $('.sky-hist');
  const bandsEl = $('.sky-bands');
  const ticksEl = $('.sky-ticks');
  const span = tMax - tMin;
  const frac = (mjd) => (mjd - tMin) / span;

  // Survey-pass bands (commissioning before 2025-05-01).
  const bands = [];
  if (tMin < SURVEY_START_MJD) bands.push({ a: tMin, b: Math.min(tMax, SURVEY_START_MJD), pass: 0, name: 'Commissioning' });
  for (let k = 1; ; k++) {
    const a = SURVEY_START_MJD + (k - 1) * SURVEY_PERIOD;
    if (a >= tMax) break;
    const b = Math.min(tMax, a + SURVEY_PERIOD);
    if (b > tMin) bands.push({ a: Math.max(a, tMin), b, pass: k, name: `Survey ${k}` });
  }
  for (const b of bands) {
    const d = document.createElement('div');
    d.className = 'sky-band';
    d.style.left = `${frac(b.a) * 100}%`;
    d.style.width = `${(frac(b.b) - frac(b.a)) * 100}%`;
    d.style.setProperty('--c', colors[Math.min(3, b.pass)]);
    d.title = `${b.name}: ${fmtDate(b.a)} to ${fmtDate(b.b)}`;
    if (b.pass > 0) d.innerHTML = `<span>${b.name}</span>`;
    bandsEl.appendChild(d);
  }

  // Month ticks.
  const ticks = [];
  {
    const d0 = mjdToDate(tMin);
    let y = d0.getUTCFullYear();
    let m = d0.getUTCMonth() + 1;
    for (;;) {
      if (m > 11) {
        m = 0;
        y++;
      }
      const mjd = Date.UTC(y, m, 1) / 86400000 + 40587;
      if (mjd > tMax) break;
      ticks.push({ mjd, label: m === 0 ? String(y) : MONTHS[m], year: m === 0 });
      m++;
    }
  }
  function layoutTicks() {
    const w = track.clientWidth || 600;
    const every = w < 420 ? 3 : w < 640 ? 2 : 1;
    ticksEl.innerHTML = ticks
      .filter((t, i) => t.year || i % every === 0)
      .map((t) => `<span class="${t.year ? 'year' : ''}" style="left:${frac(t.mjd) * 100}%">${t.label}</span>`)
      .join('');
  }

  // Histogram of pointings per day (real cadence, incl. gaps).
  const nDays = Math.ceil(span) + 1;
  const perDay = new Uint16Array(nDays);
  for (let i = 0; i < times.length; i++) perDay[Math.min(nDays - 1, Math.floor(times[i] - tMin))]++;
  let maxDay = 1;
  for (const v of perDay) maxDay = Math.max(maxDay, v);
  function drawHist() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = track.clientWidth;
    const h = track.clientHeight;
    if (!w || !h) return;
    hist.width = Math.round(w * dpr);
    hist.height = Math.round(h * dpr);
    const ctx = hist.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const bw = w / nDays;
    for (let d = 0; d < nDays; d++) {
      const v = perDay[d];
      if (!v) continue;
      const mjd = tMin + d;
      const band = bands.find((b) => mjd >= b.a - 1 && mjd < b.b) || bands[bands.length - 1];
      ctx.fillStyle = colors[Math.min(3, band.pass)];
      ctx.globalAlpha = 0.55;
      const bh = Math.max(1, (v / maxDay) * (h - 6));
      ctx.fillRect(d * bw, h - bh, Math.max(1, bw - 0.4), bh);
    }
  }

  let current = tMax;
  function setTime(mjd) {
    current = mjd;
    const f = Math.max(0, Math.min(1, frac(mjd)));
    head.style.left = `${f * 100}%`;
    elapsed.style.width = `${f * 100}%`;
    dateEl.textContent = fmtDateTime(mjd);
    track.setAttribute('aria-valuenow', mjd.toFixed(2));
    track.setAttribute('aria-valuetext', fmtDate(mjd));
  }
  function setCounters(count, cover) {
    countEl.textContent = count.toLocaleString('en-US');
    coverEl.textContent = cover === null ? '…' : `${(cover * 100).toFixed(cover > 0.999 ? 1 : 1)}%`;
  }
  function setPlaying(p) {
    playBtn.innerHTML = p ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute('aria-label', p ? 'Pause survey timeline' : 'Play survey timeline');
    el.classList.toggle('playing', p);
  }

  playBtn.addEventListener('click', () => onTogglePlay());
  el.querySelectorAll('.sky-speed button').forEach((b) =>
    b.addEventListener('click', () => {
      el.querySelectorAll('.sky-speed button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      onSpeed(Number(b.dataset.v));
    }),
  );

  // Scrubbing.
  let dragging = false;
  const seekAt = (clientX) => {
    const r = track.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onSeek(tMin + f * span, true);
  };
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    el.classList.add('scrubbing');
    seekAt(e.clientX);
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => dragging && seekAt(e.clientX));
  const end = () => {
    dragging = false;
    el.classList.remove('scrubbing');
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  track.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -30, PageUp: 30 }[e.key];
    if (step !== undefined) {
      onSeek(current + step * (e.shiftKey ? 7 : 1), true);
    } else if (e.key === 'Home') onSeek(tMin, true);
    else if (e.key === 'End') onSeek(tMax, true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  const ro = new ResizeObserver(() => {
    drawHist();
    layoutTicks();
  });
  ro.observe(track);

  setTime(tMax);
  return {
    el,
    setTime,
    setCounters,
    setPlaying,
    destroy() {
      ro.disconnect();
      el.remove();
    },
  };
}

export function fmtDate(mjd) {
  return mjdToDate(mjd).toISOString().slice(0, 10);
}

function fmtDateTime(mjd) {
  const iso = mjdToDate(mjd).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
