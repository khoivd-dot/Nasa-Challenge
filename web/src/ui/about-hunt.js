// "Be Tombaugh": a blink-comparator game on real data. Each round shows the
// real naked-eye stars around a planet on two dates, with the planet where
// Astronomy Engine puts it on each date. Flip between the plates and tap the
// one dot that jumps.

import { tanProject } from '../data/sky-math.js';
import { esc } from './esc.js';
import { SURVEY, NIGHT, PLATE, SODIUM, HALPHA, alpha } from './palette.js';

const MOON = 0.52; // the full Moon's width in degrees, for scale
const LEVELS = [
  {
    body: 'Mars',
    start: Date.UTC(2026, 0, 1),
    days: 8,
    span: 5,
    fact: 'Mars is our next-door neighbor, so it moves fast.',
  },
  {
    body: 'Jupiter',
    start: Date.UTC(2025, 6, 1),
    days: 30,
    span: 7,
    fact: 'Jupiter takes 12 years to go once around the Sun, so it needs weeks to show.',
  },
  {
    body: 'Uranus',
    start: Date.UTC(2026, 2, 1),
    days: 90,
    span: 8,
    fact: 'This one really is star-faint. William Herschel spotted it in 1781 and first took it for a comet.',
    story: 'uranus',
  },
];
// Planets are drawn no brighter than a middling star, so only motion gives
// them away. Their real brightness is shown once found.
const DISGUISE_MAG = 3.6;

const fmtDate = (t) => new Date(t).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function mountHunt(root, { stars, reduceMotion }) {
  root.innerHTML = `
    <div class="hunt-top">
      <div class="hunt-levels" aria-label="Rounds">${LEVELS.map((l, i) => `<span data-i="${i}"><i></i>Round ${i + 1}</span>`).join('')}</div>
      <div class="hunt-clock mono" aria-hidden="true">0.0 s</div>
    </div>
    <div class="hunt-stage">
      <canvas class="hunt-canvas" role="img" aria-label="Star map"></canvas>
      <div class="hunt-plate mono" aria-live="off"></div>
      <div class="hunt-lamps" aria-hidden="true"><span>A</span><span>B</span></div>
      <button class="btn primary hunt-go" type="button">Start blinking</button>
      <div class="hunt-burst" aria-hidden="true"></div>
    </div>
    <div class="hunt-bar">
      <button class="btn hunt-blink" type="button" aria-pressed="false">Blink</button>
      <div class="seg hunt-ab" role="group" aria-label="Plate">
        <button type="button" data-p="0" aria-pressed="true">Plate A</button>
        <button type="button" data-p="1" aria-pressed="false">Plate B</button>
      </div>
      <button class="btn hunt-old" type="button" aria-pressed="false" title="Show the plates as black-on-white glass negatives, the way Tombaugh saw them">1930 look</button>
      <span class="hunt-sp"></span>
      <button class="btn hunt-show" type="button">Show me</button>
      <button class="btn primary hunt-next" type="button" hidden>Next planet</button>
    </div>
    <p class="hunt-msg" aria-live="polite"></p>`;

  const $ = (s) => root.querySelector(s);
  const canvas = $('.hunt-canvas');
  const ctx = canvas.getContext('2d');
  const el = {
    stage: $('.hunt-stage'),
    plate: $('.hunt-plate'),
    lamps: [...root.querySelectorAll('.hunt-lamps span')],
    go: $('.hunt-go'),
    blink: $('.hunt-blink'),
    ab: [...root.querySelectorAll('.hunt-ab button')],
    old: $('.hunt-old'),
    show: $('.hunt-show'),
    next: $('.hunt-next'),
    msg: $('.hunt-msg'),
    clock: $('.hunt-clock'),
    levels: [...root.querySelectorAll('.hunt-levels span')],
    burst: $('.hunt-burst'),
  };

  let A = null; // astronomy-engine, loaded on first use
  let level = 0;
  let round = null; // { field stars, planet positions, scale, ... }
  let plate = 0;
  let blinking = false;
  let blinkTimer = 0;
  let found = false;
  let misses = [];
  let missCount = 0;
  let hint = null;
  let t0 = 0;
  let clockRaf = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;

  async function build(i) {
    A ??= await import('astronomy-engine');
    const L = LEVELS[i];
    const obs = new A.Observer(0, 0, 0);
    const at = (t) => {
      const d = new Date(t);
      const e = A.Equator(L.body, d, obs, false, true);
      return { ra: e.ra * 15, dec: e.dec, mag: A.Illumination(L.body, d).mag };
    };
    const t1 = L.start + L.days * 864e5;
    const p = [at(L.start), at(t1)];
    let dra = p[1].ra - p[0].ra;
    if (dra > 180) dra -= 360;
    if (dra < -180) dra += 360;
    const c = { ra: (p[0].ra + dra / 2 + 360) % 360, dec: (p[0].dec + p[1].dec) / 2 };
    const pp = p.map((q) => tanProject(c.ra, c.dec, q.ra, q.dec));
    const move = Math.hypot(pp[1][0] - pp[0][0], pp[1][1] - pp[0][1]);
    const field = Math.max(16, Math.min(48, move * L.span));
    const half = field / 2;
    const list = [];
    for (const [ra, dec, mag, bv] of stars) {
      const q = tanProject(c.ra, c.dec, ra, dec);
      if (q && Math.abs(q[0]) < half * 1.4 && Math.abs(q[1]) < half * 1.4) list.push({ x: q[0], y: q[1], mag, bv });
    }
    // Center the view a little off the planet's path, at random, so its spot
    // cannot be guessed from the layout.
    const jx = (Math.random() - 0.5) * move * 0.8;
    const jy = (Math.random() - 0.5) * move * 0.8;
    return {
      L,
      dates: [L.start, t1],
      constellation: A.Constellation(c.ra, c.dec).name,
      stars: list,
      planet: pp.map((q, k) => ({ x: q[0], y: q[1], mag: p[k].mag })),
      off: [jx, jy],
      move,
      field,
    };
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    draw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // Sky degrees (relative to the field center) to canvas pixels: north up,
  // east to the left, with the view centered at the random offset.
  function toPx(x, y) {
    const s = Math.max(w, h) / round.field;
    return [w / 2 - (x - round.off[0]) * s, h / 2 - (y - round.off[1]) * s];
  }
  const radius = (mag) => Math.max(0.8, Math.min(4.2, 3.6 - 0.45 * mag));

  function dot(x, y, mag, color) {
    const r = radius(mag);
    ctx.globalAlpha = Math.max(0.35, Math.min(1, 1.2 - 0.12 * mag));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    if (r > 2) {
      ctx.globalAlpha *= 0.18;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.6, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function ring(x, y, r, color, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function draw() {
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = NIGHT[0];
    ctx.fillRect(0, 0, w, h);
    if (!round) return;
    // A faint 5-degree grid, like the reseau lines on a survey plate.
    ctx.strokeStyle = alpha(PLATE[0], 0.06);
    ctx.lineWidth = 1;
    for (let g = -60; g <= 60; g += 5) {
      const [gx, gy] = toPx(g, g);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }
    for (const st of round.stars) {
      const [x, y] = toPx(st.x, st.y);
      if (x > -10 && y > -10 && x < w + 10 && y < h + 10) dot(x, y, st.mag, PLATE[0]);
    }
    const P = round.planet;
    const [ax, ay] = toPx(P[0].x, P[0].y);
    const [bx, by] = toPx(P[1].x, P[1].y);
    if (found) {
      // Both positions at once, joined by the path, in the survey colors.
      dot(ax, ay, Math.max(P[0].mag, DISGUISE_MAG), SURVEY[1]);
      dot(bx, by, Math.max(P[1].mag, DISGUISE_MAG), SURVEY[2]);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      ring(ax, ay, 13, SURVEY[1]);
      ring(bx, by, 13, SURVEY[2]);
    } else {
      const q = P[plate];
      const [x, y] = plate ? [bx, by] : [ax, ay];
      dot(x, y, Math.max(q.mag, DISGUISE_MAG), PLATE[0]);
      if (hint) ring(hint.x, hint.y, hint.r, alpha(SODIUM.base, 0.75), [6, 6]);
    }
    for (const m of misses) {
      ctx.globalAlpha = m.a;
      ctx.strokeStyle = HALPHA.base;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(m.x - 7, m.y - 7);
      ctx.lineTo(m.x + 7, m.y + 7);
      ctx.moveTo(m.x + 7, m.y - 7);
      ctx.lineTo(m.x - 7, m.y + 7);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function setPlate(p) {
    plate = p;
    el.lamps.forEach((l, i) => l.classList.toggle('on', i === p));
    el.ab.forEach((b, i) => b.setAttribute('aria-pressed', String(i === p)));
    if (round) el.plate.textContent = `Plate ${p ? 'B' : 'A'} · ${fmtDate(round.dates[p])} · ${round.constellation}`;
    draw();
  }

  function setBlinking(on) {
    blinking = on && !found;
    el.blink.setAttribute('aria-pressed', String(blinking));
    el.blink.textContent = blinking ? 'Pause' : 'Blink';
    clearInterval(blinkTimer);
    if (blinking) blinkTimer = setInterval(() => setPlate(1 - plate), 480);
  }

  function tick() {
    clockRaf = 0;
    if (!t0 || found) return;
    el.clock.textContent = `${((performance.now() - t0) / 1000).toFixed(1)} s`;
    clockRaf = requestAnimationFrame(tick);
  }

  function begin() {
    el.go.hidden = true;
    if (!t0) {
      t0 = performance.now();
      tick();
    }
    setBlinking(true);
    el.msg.textContent = 'Every star stays put. One dot jumps between the plates. Tap it.';
  }

  async function load(i) {
    level = i;
    found = false;
    misses = [];
    missCount = 0;
    hint = null;
    t0 = 0;
    el.clock.textContent = '0.0 s';
    el.next.hidden = true;
    el.show.hidden = false;
    el.levels.forEach((s, k) => {
      s.classList.toggle('on', k === i);
      s.classList.toggle('done', k < i);
    });
    el.msg.textContent = 'Loading the star field…';
    setBlinking(false);
    round = await build(i);
    const days = round.L.days;
    el.msg.textContent = `Somewhere in ${round.constellation} hides ${i ? 'another planet' : 'a planet'}. Plate B was taken ${days} days after plate A.`;
    el.go.hidden = false;
    setPlate(0);
  }

  function reveal(byUser) {
    found = true;
    setBlinking(false);
    cancelAnimationFrame(clockRaf);
    el.go.hidden = true;
    el.show.hidden = true;
    const secs = t0 ? (performance.now() - t0) / 1000 : 0;
    const { L, move } = round;
    const moons = Math.round(move / MOON);
    const realMag = round.planet[0].mag.toFixed(1);
    const last = level === LEVELS.length - 1;
    const lead = byUser ? `Found ${L.body} in ${secs.toFixed(1)} s!` : `There it is: ${L.body}.`;
    el.msg.innerHTML = `<b>${esc(lead)}</b> It moved ${move.toFixed(1)}° in ${L.days} days, the width of ${moons} full Moons. ${esc(L.fact)} <span class="muted">Real brightness: magnitude ${realMag}; we drew it fainter so only its motion gives it away.</span>`;
    el.levels[level].classList.add('done');
    el.next.hidden = false;
    el.next.textContent = last ? 'Final round' : 'Next planet';
    if (byUser && !reduceMotion) burst();
    draw();
  }

  function finale() {
    el.levels.forEach((s) => s.classList.add('done'));
    root.classList.add('hunt-won');
    el.msg.innerHTML = `<b>You have a discoverer’s eye.</b> Pluto is far too faint for these star maps, over 2,000 times fainter than the faintest star here. SPHEREx sees it anyway.`;
    el.next.hidden = true;
    el.show.hidden = true;
    const box = document.createElement('div');
    box.className = 'hunt-final';
    box.innerHTML = `
      <div class="label">Final round</div>
      <h3>Find Pluto in real SPHEREx images</h3>
      <p>Same trick, real telescope: the Blink Lab flips between SPHEREx photographs of Pluto taken in autumn 2025.</p>
      <div class="hunt-final-row">
        <a class="btn primary" href="#/lab?story=pluto">Hunt for Pluto</a>
        <a class="btn" href="#/lab?story=uranus">See Uranus in SPHEREx</a>
        <button class="btn hunt-again" type="button">Play again</button>
      </div>`;
    el.stage.appendChild(box);
    box.querySelector('.hunt-again').addEventListener('click', () => {
      box.remove();
      root.classList.remove('hunt-won');
      load(0);
    });
  }

  function burst() {
    el.burst.innerHTML = '';
    const P = round.planet;
    const [x, y] = toPx(P[plate].x, P[plate].y);
    el.burst.style.left = `${x}px`;
    el.burst.style.top = `${y}px`;
    const colors = [SURVEY[1], SURVEY[2], SURVEY[3], PLATE[0], SODIUM.base];
    for (let i = 0; i < 26; i++) {
      const s = document.createElement('i');
      const a = (i / 26) * 2 * Math.PI + Math.random() * 0.3;
      const d = 50 + Math.random() * 70;
      s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
      s.style.background = colors[i % colors.length];
      el.burst.appendChild(s);
    }
    el.burst.classList.remove('go');
    void el.burst.offsetWidth;
    el.burst.classList.add('go');
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!round || found) return;
    if (!el.go.hidden) begin();
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const tol = Math.max(18, 0.035 * Math.max(w, h));
    const hit = round.planet.some((p) => {
      const [px, py] = toPx(p.x, p.y);
      return Math.hypot(px - x, py - y) < tol;
    });
    if (hit) return reveal(true);
    missCount++;
    const m = { x, y, a: 1 };
    misses.push(m);
    const fade = () => {
      m.a -= 0.04;
      if (m.a <= 0) misses = misses.filter((q) => q !== m);
      else requestAnimationFrame(fade);
      draw();
    };
    requestAnimationFrame(fade);
    el.stage.classList.remove('miss');
    void el.stage.offsetWidth;
    el.stage.classList.add('miss');
    if (missCount === 3 && !hint) {
      // Circle the area that holds the planet's path.
      const P = round.planet;
      const [ax, ay] = toPx(P[0].x, P[0].y);
      const [bx, by] = toPx(P[1].x, P[1].y);
      const rr = Math.hypot(bx - ax, by - ay) / 2 + 46;
      const a = Math.random() * 2 * Math.PI;
      hint = { x: (ax + bx) / 2 + Math.cos(a) * 18, y: (ay + by) / 2 + Math.sin(a) * 18, r: rr };
      el.msg.textContent = 'Hint: it is inside the orange circle. Watch for the dot that jumps.';
      draw();
    } else el.msg.textContent = missCount > 3 ? 'Still a star. Keep watching inside the circle.' : 'That one stayed put. Watch for the dot that jumps.';
  });
  el.go.addEventListener('click', begin);
  el.blink.addEventListener('click', () => {
    if (!el.go.hidden) return begin();
    setBlinking(!blinking);
  });
  el.ab.forEach((b, i) =>
    b.addEventListener('click', () => {
      if (!el.go.hidden) begin();
      setBlinking(false);
      setPlate(i);
    }),
  );
  el.old.addEventListener('click', () => {
    const on = !root.classList.contains('hunt-old-look');
    root.classList.toggle('hunt-old-look', on);
    el.old.setAttribute('aria-pressed', String(on));
  });
  el.show.addEventListener('click', () => round && reveal(false));
  el.next.addEventListener('click', () => (level === LEVELS.length - 1 ? finale() : load(level + 1)));

  let started = false;
  return {
    /** Build the first round the first time the game scrolls into view. */
    start() {
      if (started) return;
      started = true;
      load(0).catch((e) => {
        console.error(e);
        el.msg.textContent = 'Could not compute the planet positions. Reload the page to try again.';
      });
    },
    pause() {
      setBlinking(false);
    },
    destroy() {
      setBlinking(false);
      ro.disconnect();
    },
  };
}
