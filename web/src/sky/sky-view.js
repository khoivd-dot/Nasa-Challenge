// Skyblink sky map: SPHEREx's real survey coverage on an interactive WebGL2
// globe / full-sky map, with a time machine that replays the survey.
//
//   const sky = mountSkyView(root, { pointings, onPick(ra, dec, extra) {}, onMode(mode) {} });
//   sky.pause(); sky.resume(); sky.setTime(mjd); sky.flyTo(ra, dec); sky.setMode('ground');
//
// Three views: 'globe', 'map' (full sky) and 'ground', the sky as seen from a
// place on Earth at a chosen time (horizon, Sun, Moon, planets and SPHEREx
// coverage). The ground code and Astronomy Engine load on first use.

import '../styles/sky.css';
import {
  DEG,
  RAD,
  radecToVec,
  vecToRadec,
  formatRa,
  formatDec,
} from '../data/sky-math.js';
import { mjdToDate } from '../data/pointings.js';
import { Camera, slerp, smoothstep, GROUND_FOV } from './camera.js';
import { SkyRenderer } from './renderer.js';
import {
  allocFootprints,
  fillFootprints,
  upperBound,
  visitsAt,
  SURVEY_START_MJD,
  SURVEY_PERIOD,
  DETECTORS,
} from './footprints.js';
import {
  buildGrid,
  buildEcliptic,
  buildGalactic,
  buildConstellationLines,
  buildStars,
  buildSkyMesh,
  rasterMilkyWay,
} from './layers.js';
import { drawOverlay } from './labels.js';
import { createTimeMachine, fmtDate } from './time-machine.js';

const DESKTOP_MIN = 760;
const LEFT_PANEL = 380;
const RAIL_FOLDED = 44; // the stories rail folded to a tab
const FRAME_GAP = 12; // between the docked panels and the viewport frame
const SCAN_WINDOW = 2; // days of "scan head" glow
const CUBE_CAP = 36000; // footprint instances accumulated per frame
const BUILD_STEP = 5000; // pointings converted to geometry per frame
const SATURATION = 4000; // visits that map to full brightness
const NIGHT_SPEED = 20 * 60; // ground view time-lapse: seconds of sky per second
const TRACKABLE = ['Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']; // bodies the Lab can follow

const LAYERS = [
  { id: 'footprints', label: 'SPHEREx footprints', short: 'Footprints', on: true, swatch: 'linear-gradient(135deg, var(--survey-1), var(--survey-2), var(--survey-3))' },
  { id: 'stars', label: 'Hipparcos stars', short: 'Stars', on: true, swatch: '#fff3d6' },
  { id: 'constellations', label: 'Constellations', short: 'Constellations', on: false, swatch: '#e6dcc6' },
  { id: 'milkyway', label: 'Milky Way', short: 'Milky Way', on: false, swatch: '#c9c2b2' },
  { id: 'grid', label: 'RA/Dec grid', short: 'Grid', on: false, swatch: '#a39d8e' },
  { id: 'ecliptic', label: 'Ecliptic', short: 'Ecliptic', on: false, swatch: '#ffbe6e' },
  { id: 'galactic', label: 'Galactic plane', short: 'Galactic', on: false, swatch: '#c896ff' },
];

const ICON = {
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/><ellipse cx="12" cy="12" rx="3.6" ry="8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 12h16" stroke="currentColor" stroke-width="1.4"/></svg>',
  layers: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4 3 8.5l9 4.5 9-4.5L12 4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m3 12.5 9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
  locate: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export function mountSkyView(root, { pointings: P, onPick = () => {}, onMode = () => {} } = {}) {
  const BASE = import.meta.env.BASE_URL;
  const view = document.createElement('div');
  view.className = 'sky-view';
  root.appendChild(view);

  const canvas = document.createElement('canvas');
  canvas.className = 'sky-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'Interactive map of SPHEREx sky coverage. Drag to rotate, scroll or pinch to zoom, click a spot to open its images. Keys: arrows rotate, plus and minus zoom, space plays the survey.',
  );
  view.appendChild(canvas);

  let renderer;
  try {
    renderer = new SkyRenderer(canvas);
  } catch (err) {
    console.warn('[sky] WebGL2 unavailable:', err);
    canvas.remove();
    const msg = document.createElement('div');
    msg.className = 'sky-fallback glass';
    msg.innerHTML = `<h2>The sky map needs WebGL2</h2>
      <p>Your browser or device does not provide WebGL2, so the interactive SPHEREx coverage map cannot be drawn.
      Try a recent Chrome, Edge, Firefox or Safari, or enable hardware acceleration.</p>`;
    view.appendChild(msg);
    return { pause() {}, resume() {}, setTime() {}, flyTo() {}, setMode() {}, destroy: () => view.remove() };
  }

  const overlay = document.createElement('canvas');
  overlay.className = 'sky-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  view.appendChild(overlay);
  const octx = overlay.getContext('2d');

  // The viewport frame between the docked panels: registration corners, tick
  // scales, and a live readout of where the view points.
  const frameEl = document.createElement('div');
  frameEl.className = 'sky-frame reg-frame';
  frameEl.setAttribute('aria-hidden', 'true');
  frameEl.innerHTML = '<span class="sky-frame-scan"></span><div class="sky-frame-data"><span class="sky-fd-a"></span><span class="sky-fd-b"></span></div>';
  view.appendChild(frameEl);
  const frameData = { a: frameEl.querySelector('.sky-fd-a'), b: frameEl.querySelector('.sky-fd-b'), last: '' };
  // Panels unroll once when the map first appears.
  root.classList.add('sky-boot');
  setTimeout(() => root.classList.remove('sky-boot'), 2600);

  // ------------------------------------------------------------ state ----
  const cam = new Camera();
  const mjd0 = P.mjd0;
  const tMin = P.count ? P.mjd(0) : SURVEY_START_MJD;
  const tMax = P.count ? P.mjd(P.count - 1) : SURVEY_START_MJD + 1;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const layers = Object.fromEntries(LAYERS.map((l) => [l.id, l.on]));
  const state = {
    time: tMax,
    playing: false,
    speed: 7,
    mode: 'globe',
    autoRotate: !reduceMotion,
    paused: false,
  };
  let zoomTarget = 1;
  let mapZoomTarget = 1;
  let gFovTarget = cam.gFov;
  let zoomAnchor = null; // {v, x, y}
  let vel = { ra: 0, dec: 0, panX: 0, panY: 0, lon: 0 };
  let morphAnim = null; // {from, to, t}
  let fly = null;
  let needsRender = true;
  let coverage = null; // {times, cumArea}
  let lastCounters = '';

  const css = getComputedStyle(document.documentElement);
  const passHex = ['#6f7896', css.getPropertyValue('--survey-1').trim() || '#4cc9ff', css.getPropertyValue('--survey-2').trim() || '#c77dff', css.getPropertyValue('--survey-3').trim() || '#ffb347'];
  const passCols = new Float32Array(passHex.flatMap(hexToRgb));
  // Commissioning reads as a dim grey.
  for (let i = 0; i < 3; i++) passCols[i] *= 0.7;

  // ------------------------------------------------------- footprints ----
  const fp = allocFootprints(P);
  renderer.setFootprints(fp);
  renderer.setSkyMesh(buildSkyMesh(2));

  // ------------------------------------------------------------ layers ----
  const assets = {};
  const loadJson = (name) =>
    (assets[name] ??= fetch(`${BASE}data/${name}`).then((r) => {
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      return r.json();
    }));
  const gridLevels = { 15: null, 5: null, 1: null };
  function ensureLayer(id) {
    if (id === 'stars' && !assets.starsBusy) {
      assets.starsBusy = true;
      loadJson('stars.json')
        .then((stars) => {
          renderer.setStars(buildStars(stars));
          needsRender = true;
        })
        .catch((e) => console.warn('[sky] stars', e));
    }
    if (id === 'constellations' && !assets.constBusy) {
      assets.constBusy = true;
      loadJson('constellations.json')
        .then((c) => {
          renderer.setLine('constellations', buildConstellationLines(c.lines));
          constLabels = c.labels;
          needsRender = true;
        })
        .catch((e) => console.warn('[sky] constellations', e));
    }
    if (id === 'milkyway' && !renderer.mwReady && !assets.mwBusy) {
      assets.mwBusy = true;
      loadJson('milkyway.json')
        .then((mw) => {
          renderer.setMilkyWay(rasterMilkyWay(mw.levels));
          needsRender = true;
        })
        .catch((e) => console.warn('[sky] milky way', e));
    }
    if (id === 'ecliptic' && !renderer.lines.ecliptic) renderer.setLine('ecliptic', buildEcliptic());
    if (id === 'galactic' && !renderer.lines.galactic) renderer.setLine('galactic', buildGalactic());
  }
  let constLabels = null;
  function gridFor(fov) {
    const step = fov > 50 ? 15 : fov > 12 ? 5 : 1;
    if (!gridLevels[step]) {
      gridLevels[step] = true;
      renderer.setLine(`grid${step}`, buildGrid(step, step, step === 15 ? 89 : step === 5 ? 85 : 80));
    }
    return step;
  }
  for (const l of LAYERS) if (layers[l.id]) ensureLayer(l.id);

  // ---------------------------------------------------------------- UI ----
  const hud = document.createElement('div');
  hud.className = 'sky-hud';
  hud.innerHTML = `
    <div class="sky-controls glass">
      <div class="sky-controls-top">
        <div class="seg sky-proj" role="group" aria-label="Projection">
          <button type="button" data-mode="globe" aria-pressed="true" aria-label="Globe view">Globe</button>
          <button type="button" data-mode="map" aria-pressed="false" aria-label="Full-sky map (Hammer-Aitoff)">Full sky</button>
          <button type="button" data-mode="ground" aria-pressed="false" aria-label="The night sky from where you stand on Earth">From Earth</button>
        </div>
        <button type="button" class="btn icon sky-layers-toggle" aria-label="Show map layers" aria-expanded="false">${ICON.layers}</button>
      </div>
      <div class="sky-layers">
        <div class="sky-chips" role="group" aria-label="Map layers">
          ${LAYERS.map(
            (l) => `<button type="button" class="sky-chip" data-layer="${l.id}" aria-pressed="${l.on}" aria-label="${l.label}">
              <span class="sky-swatch" style="background:${l.swatch}"></span>${l.short}</button>`,
          ).join('')}
        </div>
        <div class="sky-legend" aria-hidden="true">
          <span>Visits per spot: 1</span><span class="sky-legend-bar"></span><span>1000+</span>
        </div>
      </div>
    </div>
    <div class="sky-readout glass" aria-live="off">
      <div class="sky-ro-row"><span class="label">RA</span><span class="mono sky-ro-ra"></span></div>
      <div class="sky-ro-row"><span class="label">Dec</span><span class="mono sky-ro-dec"></span></div>
      <div class="sky-ro-row sky-ro-hor-row"><span class="label">Alt · Az</span><span class="mono sky-ro-hor"></span></div>
      <div class="sky-ro-visits"><span class="sky-ro-n mono"></span><span class="sky-ro-when"></span></div>
    </div>`;
  view.appendChild(hud);

  const zoomBox = document.createElement('div');
  zoomBox.className = 'sky-zoom';
  zoomBox.innerHTML = `
    <button type="button" class="btn icon" data-z="in" aria-label="Zoom in">${ICON.plus}</button>
    <button type="button" class="btn icon" data-z="out" aria-label="Zoom out">${ICON.minus}</button>
    <button type="button" class="btn icon" data-z="home" aria-label="Reset view">${ICON.home}</button>`;
  view.appendChild(zoomBox);

  const readout = hud.querySelector('.sky-readout');
  const ro = {
    ra: hud.querySelector('.sky-ro-ra'),
    dec: hud.querySelector('.sky-ro-dec'),
    hor: hud.querySelector('.sky-ro-hor'),
    n: hud.querySelector('.sky-ro-n'),
    when: hud.querySelector('.sky-ro-when'),
  };

  const tm = createTimeMachine(view, {
    tMin,
    tMax,
    times: Float64Array.from(P.t, (t) => t + mjd0),
    colors: passHex,
    speed: state.speed,
    onSeek: (mjd) => {
      stopAuto();
      setPlaying(false);
      setTimeInternal(mjd);
    },
    onTogglePlay: () => togglePlay(),
    onSpeed: (v) => {
      state.speed = v;
    },
  });

  hud.querySelectorAll('.sky-proj button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  hud.querySelectorAll('.sky-chip').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.layer;
      layers[id] = !layers[id];
      b.setAttribute('aria-pressed', String(layers[id]));
      if (layers[id]) ensureLayer(id);
      hud.querySelector('.sky-legend').classList.toggle('off', !layers.footprints);
      needsRender = true;
    }),
  );
  const layersToggle = hud.querySelector('.sky-layers-toggle');
  layersToggle.addEventListener('click', () => {
    const open = !hud.classList.contains('layers-open');
    hud.classList.toggle('layers-open', open);
    layersToggle.setAttribute('aria-expanded', String(open));
    layersToggle.setAttribute('aria-label', open ? 'Hide map layers' : 'Show map layers');
  });
  zoomBox.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    stopAuto();
    if (b.dataset.z === 'in') zoomBy(1.6);
    else if (b.dataset.z === 'out') zoomBy(1 / 1.6);
    else resetView();
  });


  // -------------------------------------------------------- from Earth ----
  // Bottom bar of the ground view: when (a noon-to-noon slider shaded by the
  // Sun's altitude) and where (a city, or the device's location).
  const gbar = document.createElement('section');
  gbar.className = 'sky-time sky-gbar glass';
  gbar.hidden = true;
  gbar.setAttribute('aria-label', 'Time and place on Earth');
  gbar.innerHTML = `
    <div class="sky-time-row sky-gbar-row">
      <button class="btn icon primary sky-gplay" type="button" aria-label="Play the night forward">${ICON.play}</button>
      <div class="sky-stat sky-gwhen">
        <span class="label">Local time</span>
        <span class="sky-gwhen-line">
          <button type="button" class="sky-gstep" data-g="prev" aria-label="Previous night">${ICON.prev}</button>
          <span class="mono sky-gtime">--:--</span>
          <span class="sky-gday"></span>
          <button type="button" class="sky-gstep" data-g="next" aria-label="Next night">${ICON.next}</button>
        </span>
      </div>
      <div class="sky-gwhere">
        <select class="sky-gplace" aria-label="Where you stand"></select>
        <button type="button" class="btn icon sky-glocate" aria-label="Use my location" title="Use my location">${ICON.locate}</button>
      </div>
      <div class="seg sky-gjump" role="group" aria-label="Jump to">
        <button type="button" data-g="tonight" aria-pressed="false">Tonight</button>
        <button type="button" data-g="now" aria-pressed="false">Now</button>
      </div>
    </div>
    <div class="sky-track sky-gtrack" tabindex="0" role="slider" aria-label="Time of night">
      <div class="sky-gshade" aria-hidden="true"></div>
      <div class="sky-head" aria-hidden="true"><span class="sky-head-dot"></span></div>
    </div>
    <div class="sky-ticks sky-gticks" aria-hidden="true"></div>
    <p class="sky-gnote" aria-live="polite"></p>`;
  view.appendChild(gbar);
  const gq = (sel) => gbar.querySelector(sel);
  const gel = {
    play: gq('.sky-gplay'),
    time: gq('.sky-gtime'),
    day: gq('.sky-gday'),
    place: gq('.sky-gplace'),
    locate: gq('.sky-glocate'),
    track: gq('.sky-gtrack'),
    shade: gq('.sky-gshade'),
    head: gq('.sky-gtrack .sky-head'),
    ticks: gq('.sky-gticks'),
    note: gq('.sky-gnote'),
  };
  let G = null; // ./ground.js, loaded on first use
  const gs = {
    place: null,
    t: Date.now(),
    live: false,
    playing: false,
    t0: 0, // slider span: local noon to the next local noon
    t1: 0,
    frame: null,
    bodies: [],
    sun: null,
    day: 0, // 0 night .. 1 daylight
    lastLive: 0,
    savedTime: null, // survey time to restore when leaving the ground view
    shownMinute: '',
  };
  const SAVED_PLACE = 'skyblink.place';

  function fillPlaces() {
    gel.place.innerHTML =
      '<option value="here" hidden>My location</option>' +
      G.CITIES.map((c, i) => `<option value="${i}">${c.name}</option>`).join('');
  }
  function showPlace() {
    const i = G.CITIES.indexOf(gs.place);
    const here = gel.place.querySelector('option[value="here"]');
    here.hidden = i >= 0;
    gel.place.value = i >= 0 ? String(i) : 'here';
  }
  function savedPlace() {
    try {
      const name = localStorage.getItem(SAVED_PLACE);
      return G.CITIES.find((c) => c.name === name) || null;
    } catch {
      return null;
    }
  }
  function setPlace(place, { keepClock = true } = {}) {
    const old = gs.place;
    const southSwitch = old && Math.sign(old.lat || 1) !== Math.sign(place.lat || 1);
    gs.place = place;
    showPlace();
    if (G.CITIES.includes(place)) {
      try {
        localStorage.setItem(SAVED_PLACE, place.name);
      } catch {
        /* storage blocked: the choice lasts for this visit only */
      }
    }
    let t = gs.t;
    if (gs.live) t = Date.now();
    else if (keepClock && old) {
      // Same wall-clock time on the same local date, now at the new place.
      const p = G.localParts(gs.t, old.tz);
      t = G.fromLocal(p.y, p.m, p.d, p.h, p.min, place.tz);
    }
    gs.t0 = 0; // re-shade the slider for the new place
    setGroundTime(t, gs.live);
    if (southSwitch) startGroundFly(place.lat >= 0 ? 180 : 0, 35, cam.gFov);
  }

  function setGroundTime(t, live = false) {
    if (!Number.isFinite(t) || !gs.place) return;
    gs.t = t;
    gs.live = live;
    gs.frame = G.horizonFrame(t, gs.place);
    gs.bodies = G.skyBodies(t, gs.place);
    gs.sun = gs.bodies[0].v;
    const sunAlt = G.altAz(gs.sun, gs.frame).alt;
    gs.day = smoothstep(-6, 6, sunAlt);
    if (state.mode === 'ground') {
      cam.hor = gs.frame;
      cam.update();
    }
    const start = G.nightStart(t, gs.place.tz);
    if (start !== gs.t0) {
      gs.t0 = start;
      const p = G.localParts(start, gs.place.tz);
      gs.t1 = G.fromLocal(p.y, p.m, p.d + 1, 12, 0, gs.place.tz);
      shadeNight();
    }
    // Footprints observed up to this date (the latest data if it is later).
    setTimeInternal(t / 86400000 + 40587);
    updateGroundBar(sunAlt);
    needsRender = true;
  }

  // Sun altitude -> sky color of the slider: night, three twilights, day.
  const SHADE = [
    [-18, [8, 11, 24]],
    [-12, [18, 26, 58]],
    [-6, [30, 46, 96]],
    [0, [52, 84, 146]],
    [10, [84, 132, 192]],
  ];
  function shadeColor(alt) {
    if (alt <= SHADE[0][0]) return SHADE[0][1];
    for (let k = 1; k < SHADE.length; k++) {
      if (alt <= SHADE[k][0]) {
        const [a0, c0] = SHADE[k - 1];
        const [a1, c1] = SHADE[k];
        const f = (alt - a0) / (a1 - a0);
        return c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
      }
    }
    return SHADE[SHADE.length - 1][1];
  }
  function shadeNight() {
    const alts = G.sunAltitudes(gs.t0, gs.t1, gs.place, 49);
    gel.shade.style.background = `linear-gradient(90deg, ${alts
      .map((a, k) => `rgb(${shadeColor(a).join(' ')}) ${((k / (alts.length - 1)) * 100).toFixed(2)}%`)
      .join(', ')})`;
    const p = G.localParts(gs.t0, gs.place.tz);
    const ticks = [];
    for (let k = 1; k < 8; k++) {
      const tk = G.fromLocal(p.y, p.m, p.d, 12 + 3 * k, 0, gs.place.tz);
      const f = (tk - gs.t0) / (gs.t1 - gs.t0);
      ticks.push(`<span class="${k === 4 ? 'year' : ''}" style="left:${(f * 100).toFixed(2)}%">${String((12 + 3 * k) % 24).padStart(2, '0')}:00</span>`);
    }
    gel.ticks.innerHTML = ticks.join('');
  }

  function updateGroundBar(sunAlt) {
    const { day, time } = G.formatLocal(gs.t, gs.place.tz);
    const key = `${day}|${time}|${gs.live}|${gs.place.name}`;
    const f = clamp((gs.t - gs.t0) / (gs.t1 - gs.t0 || 1), 0, 1);
    gel.head.style.left = `${f * 100}%`;
    gel.track.setAttribute('aria-valuenow', String(Math.round(f * 1440)));
    if (key === gs.shownMinute) return;
    gs.shownMinute = key;
    gel.time.textContent = time;
    gel.day.textContent = day;
    gel.track.setAttribute('aria-valuetext', `${day}, ${time} local time in ${gs.place.name}`);
    gbar.querySelector('[data-g="now"]').setAttribute('aria-pressed', String(gs.live));
    const tn = G.tonight(Date.now(), gs.place.tz);
    gbar.querySelector('[data-g="tonight"]').setAttribute('aria-pressed', String(!gs.live && Math.abs(gs.t - tn) < 60000));
    const where = gs.place.name === 'My location' ? 'where you are' : `in ${gs.place.name}`;
    let note = '';
    if (sunAlt > -0.8) note = `The Sun is up ${where}, so the stars are washed out. Tap Tonight or drag the time to a dark part of the bar.`;
    else if (sunAlt > -12) note = `Twilight ${where}: only the brightest stars and planets show.`;
    const mjd = gs.t / 86400000 + 40587;
    if (mjd > tMax + 1) note += `${note ? ' ' : ''}SPHEREx coverage is shown up to ${fmtDate(tMax)}, the newest data.`;
    else if (mjd < tMin) note += `${note ? ' ' : ''}SPHEREx had not started its survey yet on this date.`;
    gel.note.textContent = note;
    gel.note.hidden = !note;
  }

  function setGroundPlaying(p) {
    gs.playing = p;
    gel.play.innerHTML = p ? ICON.pause : ICON.play;
    gel.play.setAttribute('aria-label', p ? 'Pause' : 'Play the night forward');
  }

  // Time slider: drag, click, or arrow keys (10 min), Page keys (1 h).
  function trackTime(e) {
    const r = gel.track.getBoundingClientRect();
    const f = clamp((e.clientX - r.left) / (r.width || 1), 0, 1);
    setGroundTime(gs.t0 + f * (gs.t1 - gs.t0), false);
  }
  gel.track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    gel.track.setPointerCapture(e.pointerId);
    setGroundPlaying(false);
    gbar.classList.add('scrubbing');
    trackTime(e);
  });
  gel.track.addEventListener('pointermove', (e) => {
    if (gel.track.hasPointerCapture(e.pointerId)) trackTime(e);
  });
  const endScrub = () => gbar.classList.remove('scrubbing');
  gel.track.addEventListener('pointerup', endScrub);
  gel.track.addEventListener('pointercancel', endScrub);
  gel.track.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -10, ArrowRight: 10, ArrowDown: -10, ArrowUp: 10, PageDown: -60, PageUp: 60 }[e.key];
    let t = null;
    if (step) t = gs.t + step * 60000;
    else if (e.key === 'Home') t = gs.t0;
    else if (e.key === 'End') t = gs.t1;
    if (t === null) return;
    e.preventDefault();
    e.stopPropagation();
    setGroundPlaying(false);
    setGroundTime(clamp(t, gs.t0, gs.t1), false);
  });
  gel.play.addEventListener('click', () => toggleGroundPlay());
  function toggleGroundPlay() {
    if (!gs.playing && gs.t >= gs.t1 - 60000) setGroundTime(gs.t0, false);
    setGroundPlaying(!gs.playing);
  }
  gbar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    setGroundPlaying(false);
    const now = Date.now();
    const DAY = 86400000;
    if (b.dataset.g === 'now') setGroundTime(now, true);
    else if (b.dataset.g === 'tonight') setGroundTime(G.tonight(now, gs.place.tz), false);
    else if (b.dataset.g === 'prev') setGroundTime(gs.t - DAY, false);
    else if (b.dataset.g === 'next') setGroundTime(gs.t + DAY, false);
  });
  gel.place.addEventListener('change', () => {
    const c = G.CITIES[+gel.place.value];
    if (c) setPlace(c);
  });
  gel.locate.addEventListener('click', () => {
    if (!navigator.geolocation) {
      gel.note.textContent = 'This browser cannot share its location. Pick the nearest city instead.';
      gel.note.hidden = false;
      return;
    }
    gel.locate.classList.add('busy');
    // The position stays in this page: it is only used to turn the sky.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        gel.locate.classList.remove('busy');
        const round = (x) => Math.round(x * 100) / 100;
        setPlace({ name: 'My location', lat: round(pos.coords.latitude), lon: round(pos.coords.longitude), tz: G.browserZone() });
      },
      () => {
        gel.locate.classList.remove('busy');
        gs.shownMinute = '';
        gel.note.textContent = 'Your location is not available. Pick the nearest city instead.';
        gel.note.hidden = false;
      },
      { timeout: 12000, maximumAge: 600000 },
    );
  });

  function enterGround() {
    if (!gs.place) {
      fillPlaces();
      gs.place = savedPlace() || G.guessPlace();
      showPlace();
    }
    const now = Date.now();
    gs.savedTime = state.time;
    gs.t0 = 0;
    // Start at night: now if it is dark there, else tonight at 22:00.
    const sunNow = G.altAz(G.skyBodies(now, gs.place)[0].v, G.horizonFrame(now, gs.place)).alt;
    if (sunNow > -8) setGroundTime(G.tonight(now, gs.place.tz), false);
    else setGroundTime(now, true);
    cam.hor = gs.frame;
    cam.ground = true;
    cam.morph = 0;
    cam.az = gs.place.lat >= 0 ? 180 : 0; // face the equator, where the planets and the ecliptic are
    cam.alt = 30;
    cam.gFov = gFovTarget = W < DESKTOP_MIN ? 100 : 110;
    cam.update();
  }

  function startGroundFly(az1, alt1, fov1) {
    let dAz = az1 - cam.az;
    if (dAz > 180) dAz -= 360;
    if (dAz < -180) dAz += 360;
    fly = {
      kind: 'ground',
      az0: cam.az,
      dAz,
      alt0: cam.alt,
      alt1,
      f0: cam.gFov,
      f1: clamp(fov1, GROUND_FOV[0], GROUND_FOV[1]),
      t: 0,
      dur: reduceMotion ? 0.01 : 0.7 + Math.min(1, Math.abs(dAz) / 180) * 0.6,
    };
    zoomAnchor = null;
    vel = { ra: 0, dec: 0, panX: 0, panY: 0, lon: 0 };
  }

  // ------------------------------------------------------------ sizing ----
  let W = 1;
  let H = 1;
  let dpr = 1;
  let hidden = false; // display: none (another view is showing)
  function layout() {
    // Keep the last size while hidden; the ResizeObserver lays out again when shown.
    hidden = !view.clientWidth || !view.clientHeight;
    if (hidden && W > 1) return;
    W = view.clientWidth || root.clientWidth || window.innerWidth;
    H = view.clientHeight || root.clientHeight || window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const desktop = W >= DESKTOP_MIN;
    view.classList.toggle('narrow', !desktop);
    const timeH = (state.mode === 'ground' ? gbar : tm.el).offsetHeight || 120;
    // Desktop docks the view controls along the top; phones keep them floating.
    const topH = desktop
      ? hud.querySelector('.sky-controls').offsetHeight || 52
      : Math.round(hud.querySelector('.sky-controls-top').getBoundingClientRect().bottom - view.getBoundingClientRect().top) + 7 || 56;
    const x0 = freeLeft();
    // The sky is centered in the frame between the docked panels, clear of
    // the zoom keys on either side.
    const focus = desktop
      ? { x0: x0 + FRAME_GAP + 56, x1: W - FRAME_GAP - 56, y0: topH + FRAME_GAP, y1: H - timeH - FRAME_GAP }
      : { x0: 0, x1: W, y0: topH + 4, y1: H - timeH - 8 };
    cam.setViewport(W, H, focus);
    renderer.resize(W, H, dpr);
    overlay.width = Math.round(W * dpr);
    overlay.height = Math.round(H * dpr);
    view.style.setProperty('--sky-free-left', `${x0}px`);
    view.style.setProperty('--sky-top', `${topH}px`);
    view.style.setProperty('--sky-bottom', `${timeH}px`);
    needsRender = true;
  }
  // Width of the stories rail on the left (folded to a tab when hidden).
  function freeLeft() {
    if (W < DESKTOP_MIN) return 0;
    return root.querySelector('.stories.collapsed') ? RAIL_FOLDED : Math.min(LEFT_PANEL, W * 0.4);
  }
  // HUD panels the canvas labels must not run under.
  let avoidRects = [];
  function measureAvoid() {
    const vr = view.getBoundingClientRect();
    avoidRects = [hud.querySelector('.sky-controls'), zoomBox, tm.el, gbar]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x0: r.left - vr.left - 6, y0: r.top - vr.top - 6, x1: r.right - vr.left + 6, y1: r.bottom - vr.top + 6 }));
    needsRender = true;
  }
  const resizeObs = new ResizeObserver(() => {
    layout();
    if (hidden) return;
    measureAvoid();
    if (state.paused) return;
    // The loop stops while hidden (frame()); pick it up again once shown.
    start();
    // Resizing clears both canvases and this runs after the frame's draw:
    // redraw now so the resize does not paint a blank frame.
    if (!renderer.lost) draw(performance.now(), state.time - mjd0, upperBound(fp.t, state.time - mjd0));
  });
  resizeObs.observe(view);
  resizeObs.observe(hud.querySelector('.sky-controls'));
  resizeObs.observe(tm.el);
  resizeObs.observe(gbar);
  // The stories rail folds and unfolds without resizing the view.
  root.addEventListener('stories-toggle', () => {
    layout();
    measureAvoid();
  });
  resizeObs.observe(tm.el);
  resizeObs.observe(gbar);
  layout();
  measureAvoid();
  // devicePixelRatio can change without a resize (window dragged to another screen).
  let dprQuery = null;
  function watchDpr() {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery?.addEventListener('change', onDprChange);
  }
  function onDprChange() {
    layout();
    watchDpr();
  }
  watchDpr();

  // ---------------------------------------------------------- controls ----
  function stopAuto() {
    state.autoRotate = false;
  }

  function setPlaying(p) {
    state.playing = p;
    tm.setPlaying(p);
  }
  function togglePlay() {
    if (state.mode === 'ground') return toggleGroundPlay();
    stopAuto();
    if (!state.playing && state.time >= tMax - 1e-3) setTimeInternal(tMin);
    setPlaying(!state.playing);
  }

  function setTimeInternal(mjd) {
    if (!Number.isFinite(mjd)) return; // NaN would stick and break every later frame
    state.time = Math.max(tMin, Math.min(tMax, mjd));
    tm.setTime(state.time);
    needsRender = true;
  }

  let switching = false;
  const loadGround = () => (G ? Promise.resolve(G) : import('./ground.js').then((m) => (G = m)));
  // Fetch the ground view's code once the map is up, so "From Earth" opens at once.
  setTimeout(() => (window.requestIdleCallback || setTimeout)(() => loadGround().catch(() => {})), 4000);
  async function setMode(mode) {
    if (mode === state.mode || morphAnim || switching) return;
    if (mode === 'ground' || state.mode === 'ground') {
      // The ground view is a different projection: cross-fade instead of morphing.
      switching = true;
      view.classList.add('switching');
      try {
        await Promise.all([loadGround(), new Promise((r) => setTimeout(r, reduceMotion ? 0 : 180))]);
      } catch (err) {
        console.warn('[sky] ground view unavailable', err);
        view.classList.remove('switching');
        switching = false;
        return;
      }
      switchGround(mode);
      // Two frames so the new view is drawn before it fades in.
      requestAnimationFrame(() => requestAnimationFrame(() => view.classList.remove('switching')));
      switching = false;
      return;
    }
    stopAuto();
    vel = { ra: 0, dec: 0, panX: 0, panY: 0, lon: 0 };
    fly = null;
    zoomAnchor = null;
    if (mode === 'map') {
      cam.lon0 = cam.ra;
      cam.mapZoom = mapZoomTarget = 1;
      cam.panX = cam.panY = 0;
    } else {
      const v = cam.unprojectMap(cam.cx, cam.cy);
      if (v) {
        const [ra, dec] = vecToRadec(...v);
        cam.ra = ra;
        cam.dec = dec;
      }
    }
    cam.update();
    state.mode = mode;
    morphAnim = { from: cam.morph, to: mode === 'map' ? 1 : 0, t: 0, dur: reduceMotion ? 0.01 : 1.1 };
    hud.querySelectorAll('.sky-proj button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    hideReadout();
    onMode(mode);
  }

  function switchGround(mode) {
    stopAuto();
    vel = { ra: 0, dec: 0, panX: 0, panY: 0, lon: 0 };
    fly = null;
    zoomAnchor = null;
    morphAnim = null;
    if (mode === 'ground') {
      state.mode = 'ground';
      setPlaying(false);
      enterGround();
    } else {
      // Leave looking at the same part of the sky.
      const { ra, dec } = cam;
      const fov = cam.gFov;
      setGroundPlaying(false);
      cam.ground = false;
      state.mode = mode;
      if (gs.savedTime !== null) setTimeInternal(gs.savedTime);
      if (mode === 'map') {
        cam.morph = 1;
        cam.lon0 = ra;
        cam.mapZoom = mapZoomTarget = 1;
        cam.panX = cam.panY = 0;
      } else {
        cam.morph = 0;
        cam.ra = ra;
        cam.dec = dec;
        const R = cam.fitMin / 2 / Math.sin(Math.min(fov, 170) * DEG / 2);
        cam.zoom = zoomTarget = clamp(R / cam.Rfit, 0.55, cam.maxZoom);
      }
      cam.update();
    }
    tm.el.hidden = mode === 'ground';
    gbar.hidden = mode !== 'ground';
    view.classList.toggle('ground', mode === 'ground');
    hud.querySelectorAll('.sky-proj button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    hideReadout();
    layout();
    measureAvoid();
    needsRender = true;
    onMode(mode);
  }

  function zoomBy(f, anchor = null) {
    if (state.mode === 'ground') gFovTarget = clamp(gFovTarget / f, GROUND_FOV[0], GROUND_FOV[1]);
    else if (state.mode === 'globe') zoomTarget = clamp(zoomTarget * f, 0.55, cam.maxZoom);
    else mapZoomTarget = clamp(mapZoomTarget * f, 1, cam.maxMapZoom);
    zoomAnchor = anchor;
    fly = null;
  }

  function resetView() {
    if (state.mode === 'ground') {
      startGroundFly(gs.place && gs.place.lat < 0 ? 0 : 180, 30, W < DESKTOP_MIN ? 100 : 110);
      gFovTarget = fly.f1;
    } else if (state.mode === 'globe') {
      startFly(radecToVec(270, 28), 1);
    } else {
      fly = null;
      mapZoomTarget = 1;
      zoomAnchor = null;
      fly = { kind: 'map', t: 0, dur: 0.8, pan0: [cam.panX, cam.panY], pan1: [0, 0], z0: cam.mapZoom, z1: 1 };
    }
  }

  function startFly(target, zoom1) {
    const from = cam.fwd.slice();
    const ang = Math.acos(clamp(from[0] * target[0] + from[1] * target[1] + from[2] * target[2], -1, 1));
    fly = {
      kind: 'globe',
      from,
      to: target,
      z0: cam.zoom,
      z1: clamp(zoom1, 0.55, cam.maxZoom),
      dip: ang > 0.25 ? (ang / Math.PI) * Math.log(Math.max(cam.zoom, zoom1, 1.2) / 0.85) : 0,
      t: 0,
      dur: reduceMotion ? 0.01 : 0.9 + 0.8 * (ang / Math.PI),
    };
    zoomAnchor = null;
    vel = { ra: 0, dec: 0, panX: 0, panY: 0, lon: 0 };
  }

  function flyTo(ra, dec) {
    stopAuto();
    const v = radecToVec(ra, dec);
    if (state.mode === 'ground') {
      const { az, alt } = cam.altAzOf(v);
      startGroundFly(az, clamp(alt, 12, 80), Math.min(cam.gFov, 60));
      gFovTarget = fly.f1;
      if (alt < 0) {
        gs.shownMinute = '';
        gel.note.textContent = `That spot is ${Math.round(-alt)}° below the horizon at this time. Drag the time to see it rise.`;
        gel.note.hidden = false;
      }
    } else if (state.mode === 'globe') {
      // About a 20 degree field.
      const R = cam.fitMin / 2 / Math.sin(10 * DEG);
      startFly(v, Math.max(cam.zoom, R / cam.Rfit));
    } else {
      const z1 = Math.max(cam.mapZoom, 4);
      const S1 = z1 * cam.Sfit;
      const lam = cam.lonRel(v);
      const cp = Math.cos(dec * DEG);
      const h = Math.sqrt(1 + cp * Math.cos(lam / 2));
      const hx = (-2 * Math.SQRT2 * cp * Math.sin(lam / 2)) / h;
      const hy = (Math.SQRT2 * Math.sin(dec * DEG)) / h;
      mapZoomTarget = z1;
      fly = { kind: 'map', t: 0, dur: reduceMotion ? 0.01 : 1.0, pan0: [cam.panX, cam.panY], pan1: [-S1 * hx, -S1 * hy], z0: cam.mapZoom, z1 };
    }
    needsRender = true;
  }

  // ------------------------------------------------------- interaction ----
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let hover = null;
  let hoverDirty = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // right/middle click: leave the context menu alone, never pick
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    stopAuto();
    fly = null;
    zoomAnchor = null;
    zoomTarget = cam.zoom;
    mapZoomTarget = cam.mapZoom;
    gFovTarget = cam.gFov;
    vel = { ra: 0, dec: 0, panX: 0, panY: 0, lon: 0 };
    if (pointers.size === 1) {
      drag = {
        x0: e.offsetX,
        y0: e.offsetY,
        x: e.offsetX,
        y: e.offsetY,
        t0: performance.now(),
        t: performance.now(),
        moved: false,
        grab: state.mode === 'globe' && !morphAnim ? cam.unproject(e.offsetX, e.offsetY) : null,
        id: e.pointerId,
      };
      canvas.classList.add('dragging');
    } else if (pointers.size === 2) {
      drag = null;
      const [a, b] = [...pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinch = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        z0: state.mode === 'ground' ? cam.gFov : state.mode === 'globe' ? cam.zoom : cam.mapZoom,
        v: cam.unproject(mid.x, mid.y),
      };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') {
        hover = { x: e.offsetX, y: e.offsetY };
        hoverDirty = true;
      }
      return;
    }
    p.x = e.offsetX;
    p.y = e.offsetY;
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = pinch.z0 * (d / pinch.d0);
      if (state.mode === 'ground') {
        cam.gFov = gFovTarget = clamp(pinch.z0 * (pinch.d0 / d), GROUND_FOV[0], GROUND_FOV[1]);
        cam.update();
        if (pinch.v) cam.anchorGround(pinch.v, mid.x, mid.y);
      } else if (state.mode === 'globe') {
        cam.zoom = zoomTarget = clamp(z, 0.55, cam.maxZoom);
        cam.update();
        if (pinch.v) cam.anchorGlobe(pinch.v, mid.x, mid.y);
      } else {
        cam.mapZoom = mapZoomTarget = clamp(z, 1, cam.maxMapZoom);
        cam.update();
        if (pinch.v) cam.anchorMap(pinch.v, mid.x, mid.y);
      }
      needsRender = true;
      return;
    }
    if (!drag || drag.id !== e.pointerId || morphAnim) return;
    const now = performance.now();
    const dx = e.offsetX - drag.x;
    const dy = e.offsetY - drag.y;
    const dt = Math.max(1, now - drag.t) / 1000;
    // Fingers jitter more than a mouse; a tap must still count as a click.
    if (Math.hypot(e.offsetX - drag.x0, e.offsetY - drag.y0) > (e.pointerType === 'touch' ? 10 : 5)) drag.moved = true;
    if (!drag.moved) return;
    drag.x = e.offsetX;
    drag.y = e.offsetY;
    drag.t = now;
    const k = 0.75; // velocity smoothing
    if (state.mode === 'ground') {
      // Grab the sky: dragging right turns the view left. ~2/R radians per px at the center.
      const s = (2 / cam.R) * RAD;
      const az0 = cam.az;
      const alt0 = cam.alt;
      cam.az -= (dx * s) / Math.max(Math.cos(cam.alt * DEG), 0.3);
      cam.alt += dy * s;
      cam.update();
      let dAz = cam.az - az0;
      if (dAz > 180) dAz -= 360;
      if (dAz < -180) dAz += 360;
      vel.ra = vel.ra * (1 - k) + (dAz / dt) * k;
      vel.dec = vel.dec * (1 - k) + ((cam.alt - alt0) / dt) * k;
    } else if (state.mode === 'globe') {
      const ra0 = cam.ra;
      const dec0 = cam.dec;
      if (drag.grab && cam.unprojectGlobe(e.offsetX, e.offsetY)) {
        cam.anchorGlobe(drag.grab, e.offsetX, e.offsetY);
      } else {
        drag.grab = null;
        const s = RAD / cam.R;
        cam.ra += (dx * s) / Math.max(Math.cos(cam.dec * DEG), 0.15);
        cam.dec += dy * s;
        cam.update();
      }
      let dRa = cam.ra - ra0;
      if (dRa > 180) dRa -= 360;
      if (dRa < -180) dRa += 360;
      vel.ra = vel.ra * (1 - k) + (dRa / dt) * k;
      vel.dec = vel.dec * (1 - k) + ((cam.dec - dec0) / dt) * k;
    } else {
      if (cam.mapZoom < 1.05) {
        const dl = (dx / (cam.S * Math.SQRT2)) * RAD;
        cam.lon0 += dl;
        vel.lon = vel.lon * (1 - k) + (dl / dt) * k;
        cam.panY -= dy;
        vel.panY = vel.panY * (1 - k) + (-dy / dt) * k;
      } else {
        cam.panX += dx;
        cam.panY -= dy;
        vel.panX = vel.panX * (1 - k) + (dx / dt) * k;
        vel.panY = vel.panY * (1 - k) + (-dy / dt) * k;
      }
      cam.update();
    }
    hover = null;
    hideReadout();
    needsRender = true;
  });

  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) {
      pinch = null;
      drag = null;
      vel = { ra: 0, dec: 0, panX: 0, panY: 0, lon: 0 };
    }
    if (drag && drag.id === e.pointerId) {
      const quick = performance.now() - drag.t0 < 600;
      if (!drag.moved && quick && e.type === 'pointerup') pick(e.offsetX, e.offsetY);
      // Stale velocity (pointer held still before release) does not fling.
      if (performance.now() - drag.t > 80) vel = { ra: 0, dec: 0, panX: 0, panY: 0, lon: 0 };
      drag = null;
    }
    if (!pointers.size) canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  // Capture is also lost when the view is hidden mid-gesture; the pointerup then
  // never reaches the canvas and a stale touch would turn the next drag into a pinch.
  canvas.addEventListener('lostpointercapture', endPointer);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointers.size) {
      hover = null;
      hideReadout();
    }
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (morphAnim) return;
      stopAuto();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const f = Math.exp(-clamp(e.deltaY * unit, -300, 300) * 0.0022);
      const v = cam.unproject(e.offsetX, e.offsetY);
      zoomBy(f, v ? { v, x: e.offsetX, y: e.offsetY } : null);
      vel = { ra: 0, dec: 0, panX: 0, panY: 0, lon: 0 };
    },
    { passive: false },
  );

  function pick(x, y) {
    const v = cam.unproject(x, y);
    if (!v) return;
    let [ra, dec] = vecToRadec(...v);
    let extra;
    if (state.mode === 'ground') {
      // A planet under the finger opens the Lab following that body.
      let best = null;
      for (const b of gs.bodies) {
        if (!TRACKABLE.includes(b.name)) continue;
        const p = cam.project(b.v);
        const d = Math.hypot(p.x - x, p.y - y);
        if (p.vis > 0.3 && d < 18 && (!best || d < best.d)) best = { b, d };
      }
      if (best) {
        [ra, dec] = [best.b.ra, best.b.dec];
        extra = { body: best.b.name };
      } else if (cam.altOf(v) < 0) return; // the ground
    }
    const ripple = document.createElement('div');
    ripple.className = 'sky-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    view.appendChild(ripple);
    setTimeout(() => ripple.remove(), 900);
    setTimeout(() => onPick(ra, dec, extra), reduceMotion ? 0 : 420);
  }

  function onKey(e) {
    if (state.paused || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!view.isConnected || view.offsetParent === null) return;
    const t = e.target;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
    // Only react when focus is on the page body or inside the sky view.
    if (t && t !== document.body && t !== document.documentElement && !view.contains(t)) return;
    const fov = cam.fov();
    const step = clamp(fov * 0.8, 1, 140);
    switch (e.key) {
      case ' ':
      case 'Spacebar':
        if (tag === 'BUTTON') return;
        if (!e.repeat) togglePlay(); // holding space must not flicker play/pause
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        stopAuto();
        fly = null;
        const sx = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
        const sy = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
        // Inertia glides ~ v / 3.2, so each press moves about a quarter of the view.
        if (state.mode === 'ground') {
          vel.ra -= (sx * step) / Math.max(Math.cos(cam.alt * DEG), 0.3);
          vel.dec += sy * step;
        } else if (state.mode === 'globe') {
          vel.ra += (sx * step) / Math.max(Math.cos(cam.dec * DEG), 0.2);
          vel.dec += sy * step;
        } else if (cam.mapZoom < 1.05 && sx) {
          vel.lon += sx * 70;
        } else {
          vel.panX += sx * cam.focusW * 0.7;
          vel.panY += -sy * cam.focusH * 0.7;
        }
        break;
      }
      case '+':
      case '=':
        stopAuto();
        zoomBy(1.5);
        break;
      case '-':
      case '_':
        stopAuto();
        zoomBy(1 / 1.5);
        break;
      default:
        return;
    }
    e.preventDefault();
    needsRender = true;
  }
  window.addEventListener('keydown', onKey);

  // ----------------------------------------------------------- readout ----
  function hideReadout() {
    readout.classList.remove('show');
    canvas.classList.remove('on-sky');
  }
  let lastHover = 0;
  function updateReadout(now) {
    if (!hover || morphAnim) return;
    if (now - lastHover < 50) return;
    lastHover = now;
    hoverDirty = false;
    const v = cam.unproject(hover.x, hover.y);
    if (!v) {
      hideReadout();
      return;
    }
    if (state.mode === 'ground') {
      const { az, alt } = cam.altAzOf(v);
      if (alt < 0) {
        hideReadout();
        return;
      }
      ro.hor.textContent = `${alt.toFixed(1)}°  ${az.toFixed(0)}° ${G.compassPoint(az)}`;
    }
    canvas.classList.add('on-sky');
    const [ra, dec] = vecToRadec(...v);
    ro.ra.textContent = formatRa(ra);
    ro.dec.textContent = formatDec(dec);
    const end = Math.min(upperBound(fp.t, state.time - mjd0), fp.filled * DETECTORS);
    const r = visitsAt(fp, P.vec, v, end);
    if (r.visits) {
      ro.n.textContent = `${r.visits.toLocaleString('en-US')} SPHEREx visit${r.visits === 1 ? '' : 's'}`;
      ro.when.textContent =
        r.visits === 1 ? `on ${fmtDate(r.first + mjd0)}` : `${fmtDate(r.first + mjd0)} to ${fmtDate(r.last + mjd0)}`;
    } else {
      ro.n.textContent = 'Not observed yet';
      ro.when.textContent = state.time < tMax ? `as of ${fmtDate(state.time)}` : 'in this data release';
    }
    readout.classList.toggle('none', !r.visits);
    readout.classList.add('show');
  }

  // -------------------------------------------------------- coverage ----
  function startCoverage() {
    const msg = { data: fp.data.slice(), count: fp.count };
    const done = (res) => {
      coverage = res;
      lastCounters = '';
      needsRender = true;
    };
    try {
      const worker = new Worker(new URL('./coverage-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        done(e.data);
        worker.terminate();
      };
      worker.onerror = (err) => {
        console.warn('[sky] coverage worker failed, computing inline', err);
        worker.terminate();
        inline();
      };
      worker.postMessage(msg, [msg.data.buffer]);
    } catch (err) {
      inline();
    }
    function inline() {
      import('./coverage.js')
        .then(({ computeCoverage }) => setTimeout(() => done(computeCoverage(fp.data, fp.count)), 50))
        .catch((e) => console.warn('[sky] coverage unavailable', e));
    }
  }

  function updateCounters() {
    const rel = state.time - mjd0;
    const n = upperBound(P.t, rel);
    let cover = null;
    if (coverage) cover = coverage.cumArea[upperBound(coverage.times, rel)];
    const key = `${n}|${cover}`;
    if (key !== lastCounters) {
      lastCounters = key;
      tm.setCounters(n, cover);
    }
  }

  // ------------------------------------------------------------- loop ----
  let raf = 0;
  let last = performance.now();
  const consts = { s0: SURVEY_START_MJD - mjd0, period: SURVEY_PERIOD };

  function animate(dt) {
    let moved = false;
    if (morphAnim) {
      morphAnim.t = Math.min(1, morphAnim.t + dt / morphAnim.dur);
      const e = easeInOutCubic(morphAnim.t);
      cam.morph = morphAnim.from + (morphAnim.to - morphAnim.from) * e;
      if (morphAnim.t >= 1) {
        cam.morph = morphAnim.to;
        morphAnim = null;
      }
      moved = true;
    }
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / fly.dur);
      const e = easeInOutCubic(fly.t);
      if (fly.kind === 'ground') {
        cam.az = fly.az0 + fly.dAz * e;
        cam.alt = fly.alt0 + (fly.alt1 - fly.alt0) * e;
        cam.gFov = gFovTarget = Math.exp(Math.log(fly.f0) + (Math.log(fly.f1) - Math.log(fly.f0)) * e);
      } else if (fly.kind === 'globe') {
        const c = slerp(fly.from, fly.to, e);
        const [ra, dec] = vecToRadec(...c);
        cam.ra = ra;
        cam.dec = dec;
        cam.zoom = zoomTarget = Math.exp(Math.log(fly.z0) + (Math.log(fly.z1) - Math.log(fly.z0)) * e - fly.dip * Math.sin(Math.PI * fly.t));
      } else {
        cam.mapZoom = mapZoomTarget = Math.exp(Math.log(fly.z0) + (Math.log(fly.z1) - Math.log(fly.z0)) * e);
        cam.panX = fly.pan0[0] + (fly.pan1[0] - fly.pan0[0]) * e;
        cam.panY = fly.pan0[1] + (fly.pan1[1] - fly.pan0[1]) * e;
      }
      cam.update();
      if (fly.t >= 1) fly = null;
      moved = true;
    }
    // Smooth zoom toward target, keeping the anchor point under the cursor.
    const zk = 1 - Math.exp(-dt * 14);
    if (state.mode === 'ground' && Math.abs(Math.log(gFovTarget / cam.gFov)) > 1e-4) {
      cam.gFov *= Math.pow(gFovTarget / cam.gFov, zk);
      cam.update();
      if (zoomAnchor) cam.anchorGround(zoomAnchor.v, zoomAnchor.x, zoomAnchor.y);
      moved = true;
    } else if (state.mode === 'globe' && Math.abs(Math.log(zoomTarget / cam.zoom)) > 1e-4) {
      cam.zoom *= Math.pow(zoomTarget / cam.zoom, zk);
      cam.update();
      if (zoomAnchor) cam.anchorGlobe(zoomAnchor.v, zoomAnchor.x, zoomAnchor.y);
      moved = true;
    } else if (state.mode === 'map' && Math.abs(Math.log(mapZoomTarget / cam.mapZoom)) > 1e-4) {
      cam.mapZoom *= Math.pow(mapZoomTarget / cam.mapZoom, zk);
      cam.update();
      if (zoomAnchor) cam.anchorMap(zoomAnchor.v, zoomAnchor.x, zoomAnchor.y);
      moved = true;
    }
    // Inertia.
    if (!drag && !pinch) {
      const decay = Math.exp(-dt * 3.2);
      if (Math.abs(vel.ra) + Math.abs(vel.dec) > 0.01) {
        if (state.mode === 'ground') {
          cam.az += vel.ra * dt;
          cam.alt += vel.dec * dt;
        } else {
          cam.ra += vel.ra * dt;
          cam.dec += vel.dec * dt;
        }
        vel.ra *= decay;
        vel.dec *= decay;
        moved = true;
      }
      if (Math.abs(vel.panX) + Math.abs(vel.panY) + Math.abs(vel.lon) > 0.05) {
        cam.panX += vel.panX * dt;
        cam.panY += vel.panY * dt;
        cam.lon0 += vel.lon * dt;
        vel.panX *= decay;
        vel.panY *= decay;
        vel.lon *= decay;
        moved = true;
      }
      if (state.autoRotate && state.mode === 'globe' && !fly) {
        cam.ra += 2.2 * dt;
        moved = true;
      }
      if (moved) cam.update();
    }
    return moved;
  }

  function frame(now) {
    // Hidden (e.g. resume() raced a navigation away): stop; the ResizeObserver restarts us.
    if (hidden) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (renderer.lost) {
      needsRender = true; // repaint everything once the context is restored
      return;
    }
    let dirty = needsRender;
    needsRender = false;

    // Progressive geometry build (first frames).
    if (fp.filled < P.count) {
      const k0 = fp.filled;
      fillFootprints(P, fp, k0 + BUILD_STEP);
      renderer.uploadFootprints(k0 * DETECTORS, fp.filled * DETECTORS);
      if (fp.filled >= P.count) startCoverage();
      dirty = true;
    }

    if (state.mode === 'ground' && gs.place) {
      if (gs.playing) {
        const t = Math.min(gs.t1, gs.t + NIGHT_SPEED * 1000 * dt);
        if (t >= gs.t1) setGroundPlaying(false);
        setGroundTime(t, false);
      } else if (gs.live && now - gs.lastLive > 1000) {
        gs.lastLive = now;
        setGroundTime(Date.now(), true);
      }
      if (needsRender) dirty = true;
      needsRender = false;
    }
    if (state.playing) {
      state.time += state.speed * dt;
      if (state.time >= tMax) {
        state.time = tMax;
        setPlaying(false);
      }
      tm.setTime(state.time);
      dirty = true;
    }
    if (animate(dt)) dirty = true;

    const rel = state.time - mjd0;
    const target = upperBound(fp.t, rel);
    if (layers.footprints && renderer.updateCube(target, CUBE_CAP, consts)) dirty = true;

    if (state.playing || dirty) updateCounters();
    if (dirty) draw(now, rel, target);
    else if (layers.footprints && reticleActive) drawLabels(now);
    if (hover && (hoverDirty || dirty)) updateReadout(now);
  }

  let reticleActive = false;
  function draw(now, rel, end) {
    const fov = cam.fov();
    const lines = [];
    if (layers.grid) {
      const step = gridFor(fov);
      lines.push({ name: `grid${step}`, color: [0.92, 0.9, 0.85, 0.15], width: 1 });
      gridStep = step;
    }
    if (layers.galactic) lines.push({ name: 'galactic', color: [0.78, 0.6, 1.0, 0.6], width: 1.4 });
    if (layers.ecliptic) lines.push({ name: 'ecliptic', color: [1.0, 0.75, 0.45, 0.75], width: 1.4, dash: 3 });
    if (layers.constellations) lines.push({ name: 'constellations', color: [0.95, 0.9, 0.8, 0.36], width: 1.1 });
    const builtEnd = Math.min(end, renderer.fpBuilt, renderer.cubeN || end);
    // From Earth, the "just observed" glow only means something on dates inside the survey.
    const groundPast = state.mode === 'ground' && gs.t / 86400000 + 40587 > tMax + SCAN_WINDOW;
    const scanStart = groundPast ? builtEnd : Math.min(builtEnd, upperBound(fp.t, rel - SCAN_WINDOW));
    renderer.render({
      cam,
      time: rel,
      layers,
      lines,
      passCols,
      s0: consts.s0,
      period: consts.period,
      saturation: SATURATION,
      scanWindow: SCAN_WINDOW,
      scanStart,
      scanEnd: builtEnd,
      scanGain: state.mode === 'ground' ? 0.6 : 1,
      footGain: state.mode === 'ground' ? 0.75 : 1,
      outlineAlpha: 0.04 * smoothstep(18, 5, fov),
      edge: smoothstep(25, 6, fov),
      starScale:
        state.mode === 'ground'
          ? clamp(Math.pow(110 / cam.gFov, 0.3), 1, 2.2) * 1.1
          : clamp(Math.pow(cam.morph > 0.5 ? cam.mapZoom : cam.zoom, 0.22), 1, 2.2) * (W < DESKTOP_MIN ? 0.85 : 1),
      starBright: state.mode === 'ground' ? 1 - 0.85 * gs.day : 1,
      sun: state.mode === 'ground' ? gs.sun : null,
    });
    // Reticle on the newest pointing within the scan window.
    reticleActive = false;
    if (layers.footprints && builtEnd > scanStart && builtEnd > 0) {
      reticleActive = true;
      reticleV = Array.from(P.vec.subarray(3 * fp.pointing[builtEnd - 1], 3 * fp.pointing[builtEnd - 1] + 3));
    }
    drawLabels(now);
  }

  let gridStep = 15;
  let reticleV = null;
  function drawLabels(now) {
    drawOverlay(octx, cam, {
      dpr,
      W,
      H,
      x0: freeLeft(),
      avoid: avoidRects,
      grid: layers.grid,
      gridStep: { ra: gridStep, dec: gridStep },
      constellations: layers.constellations,
      constLabels,
      ecliptic: layers.ecliptic,
      galactic: layers.galactic,
      footprints: layers.footprints,
      reticle: reticleActive && reticleV ? { v: reticleV, phase: ((now || 0) / 1400) % 1 } : null,
      ground: state.mode === 'ground' ? { bodies: gs.bodies, day: gs.day, compass: G.compassPoint } : null,
      bezel: state.mode !== 'ground',
    });
    updateFrameData();
  }
  function updateFrameData() {
    const fov = Math.round(cam.fov());
    let a = '';
    if (state.mode === 'ground') a = `<i>Facing</i> az ${Math.round(cam.az)}° alt ${Math.round(cam.alt)}°`;
    else if (cam.morph < 0.5) a = `<i>Center</i> ${formatRa(cam.ra).slice(0, 7)} ${formatDec(cam.dec).slice(0, 8)}`;
    const b = cam.morph < 0.5 || state.mode === 'ground' ? `<i>Field</i> ${fov}°` : '<i>Whole sky</i> Hammer-Aitoff';
    const key = a + b;
    if (key === frameData.last) return;
    frameData.last = key;
    frameData.a.innerHTML = a;
    frameData.b.innerHTML = b;
  }

  function start() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  updateCounters();
  start();

  return {
    pause() {
      state.paused = true;
      setPlaying(false);
      stop();
    },
    resume() {
      state.paused = false;
      layout();
      needsRender = true;
      start();
    },
    setTime(mjd) {
      setPlaying(false);
      setTimeInternal(mjd);
    },
    flyTo(ra, dec) {
      flyTo(ra, dec);
    },
    setMode(mode) {
      return setMode(mode === 'earth' ? 'ground' : mode);
    },
    destroy() {
      stop();
      window.removeEventListener('keydown', onKey);
      resizeObs.disconnect();
      dprQuery?.removeEventListener('change', onDprChange);
      tm.destroy();
      // Free the GPU memory (the cube map alone is up to 48 MB) now rather than at GC.
      renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
      view.remove();
    },
  };
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
}

// Re-exported for integrators who want the survey calendar.
export { SURVEY_START_MJD, SURVEY_PERIOD, mjdToDate };
