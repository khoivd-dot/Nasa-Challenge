// Skyblink sky map: SPHEREx's real survey coverage on an interactive WebGL2
// globe / full-sky map, with a time machine that replays the survey.
//
//   const sky = mountSkyView(root, { pointings, onPick(ra, dec) {} });
//   sky.pause(); sky.resume(); sky.setTime(mjd); sky.flyTo(ra, dec);

import '../styles/sky.css';
import {
  DEG,
  RAD,
  radecToVec,
  vecToRadec,
  equatorialToGalactic,
  formatRa,
  formatDec,
} from '../data/sky-math.js';
import { mjdToDate } from '../data/pointings.js';
import { Camera, slerp, smoothstep } from './camera.js';
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
const SCAN_WINDOW = 2; // days of "scan head" glow
const CUBE_CAP = 36000; // footprint instances accumulated per frame
const BUILD_STEP = 5000; // pointings converted to geometry per frame
const SATURATION = 4000; // visits that map to full brightness

const LAYERS = [
  { id: 'footprints', label: 'SPHEREx footprints', short: 'Footprints', on: true, swatch: 'linear-gradient(135deg, var(--survey-1), var(--survey-2), var(--survey-3))' },
  { id: 'stars', label: 'Hipparcos stars', short: 'Stars', on: true, swatch: '#fff3d6' },
  { id: 'constellations', label: 'Constellations', short: 'Constellations', on: false, swatch: '#96afff' },
  { id: 'milkyway', label: 'Milky Way', short: 'Milky Way', on: false, swatch: '#b9c3e6' },
  { id: 'grid', label: 'RA/Dec grid', short: 'Grid', on: false, swatch: '#7891dc' },
  { id: 'ecliptic', label: 'Ecliptic', short: 'Ecliptic', on: false, swatch: '#ffbe6e' },
  { id: 'galactic', label: 'Galactic plane', short: 'Galactic', on: false, swatch: '#c896ff' },
];

const ICON = {
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/><ellipse cx="12" cy="12" rx="3.6" ry="8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 12h16" stroke="currentColor" stroke-width="1.4"/></svg>',
  layers: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4 3 8.5l9 4.5 9-4.5L12 4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m3 12.5 9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

export function mountSkyView(root, { pointings: P, onPick = () => {} } = {}) {
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
    return { pause() {}, resume() {}, setTime() {}, flyTo() {} };
  }

  const overlay = document.createElement('canvas');
  overlay.className = 'sky-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  view.appendChild(overlay);
  const octx = overlay.getContext('2d');

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
          <span>1 visit</span><span class="sky-legend-bar"></span><span>1000+</span>
        </div>
      </div>
    </div>
    <div class="sky-readout glass" aria-live="off">
      <div class="sky-ro-row"><span class="label">RA</span><span class="mono sky-ro-ra"></span></div>
      <div class="sky-ro-row"><span class="label">Dec</span><span class="mono sky-ro-dec"></span></div>
      <div class="sky-ro-row"><span class="label">Gal</span><span class="mono sky-ro-gal"></span></div>
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
    gal: hud.querySelector('.sky-ro-gal'),
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

  // ------------------------------------------------------------ sizing ----
  let W = 1;
  let H = 1;
  let dpr = 1;
  function layout() {
    W = view.clientWidth || root.clientWidth || window.innerWidth;
    H = view.clientHeight || root.clientHeight || window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const desktop = W >= DESKTOP_MIN;
    view.classList.toggle('narrow', !desktop);
    const timeH = tm.el.offsetHeight || 120;
    const x0 = desktop ? Math.min(LEFT_PANEL, W * 0.4) : 0;
    const focus = desktop
      ? { x0, x1: W - 64, y0: 8, y1: H - timeH - 28 }
      : { x0: 0, x1: W, y0: 56, y1: H - timeH - 16 };
    cam.setViewport(W, H, focus);
    renderer.resize(W, H, dpr);
    overlay.width = Math.round(W * dpr);
    overlay.height = Math.round(H * dpr);
    view.style.setProperty('--sky-free-left', `${x0}px`);
    needsRender = true;
  }
  // HUD panels the canvas labels must not run under.
  let avoidRects = [];
  function measureAvoid() {
    const vr = view.getBoundingClientRect();
    avoidRects = [hud.querySelector('.sky-controls'), zoomBox, tm.el]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x0: r.left - vr.left - 6, y0: r.top - vr.top - 6, x1: r.right - vr.left + 6, y1: r.bottom - vr.top + 6 }));
    needsRender = true;
  }
  const resizeObs = new ResizeObserver(() => {
    layout();
    measureAvoid();
  });
  resizeObs.observe(view);
  resizeObs.observe(hud.querySelector('.sky-controls'));
  resizeObs.observe(tm.el);
  layout();
  measureAvoid();

  // ---------------------------------------------------------- controls ----
  function stopAuto() {
    state.autoRotate = false;
  }

  function setPlaying(p) {
    state.playing = p;
    tm.setPlaying(p);
  }
  function togglePlay() {
    stopAuto();
    if (!state.playing && state.time >= tMax - 1e-3) setTimeInternal(tMin);
    setPlaying(!state.playing);
  }

  function setTimeInternal(mjd) {
    state.time = Math.max(tMin, Math.min(tMax, mjd));
    tm.setTime(state.time);
    needsRender = true;
  }

  function setMode(mode) {
    if (mode === state.mode || morphAnim) return;
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
  }

  function zoomBy(f, anchor = null) {
    if (state.mode === 'globe') zoomTarget = clamp(zoomTarget * f, 0.55, cam.maxZoom);
    else mapZoomTarget = clamp(mapZoomTarget * f, 1, cam.maxMapZoom);
    zoomAnchor = anchor;
    fly = null;
  }

  function resetView() {
    if (state.mode === 'globe') {
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
    if (state.mode === 'globe') {
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
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    stopAuto();
    fly = null;
    zoomAnchor = null;
    zoomTarget = cam.zoom;
    mapZoomTarget = cam.mapZoom;
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
        z0: state.mode === 'globe' ? cam.zoom : cam.mapZoom,
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
      if (state.mode === 'globe') {
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
    if (Math.hypot(e.offsetX - drag.x0, e.offsetY - drag.y0) > 5) drag.moved = true;
    if (!drag.moved) return;
    drag.x = e.offsetX;
    drag.y = e.offsetY;
    drag.t = now;
    const k = 0.75; // velocity smoothing
    if (state.mode === 'globe') {
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
    const [ra, dec] = vecToRadec(...v);
    const ripple = document.createElement('div');
    ripple.className = 'sky-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    view.appendChild(ripple);
    setTimeout(() => ripple.remove(), 900);
    setTimeout(() => onPick(ra, dec), reduceMotion ? 0 : 420);
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
        togglePlay();
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
        if (state.mode === 'globe') {
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
    canvas.classList.add('on-sky');
    const [ra, dec] = vecToRadec(...v);
    const [l, b] = equatorialToGalactic(ra, dec);
    ro.ra.textContent = formatRa(ra);
    ro.dec.textContent = formatDec(dec);
    ro.gal.textContent = `l ${l.toFixed(2)}°  b ${b >= 0 ? '+' : '−'}${Math.abs(b).toFixed(2)}°`;
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
      import('./coverage.js').then(({ computeCoverage }) => setTimeout(() => done(computeCoverage(fp.data, fp.count)), 50));
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
      if (fly.kind === 'globe') {
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
    if (state.mode === 'globe' && Math.abs(Math.log(zoomTarget / cam.zoom)) > 1e-4) {
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
        cam.ra += vel.ra * dt;
        cam.dec += vel.dec * dt;
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
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (renderer.lost) return;
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
      lines.push({ name: `grid${step}`, color: [0.47, 0.57, 0.86, 0.22], width: 1 });
      gridStep = step;
    }
    if (layers.galactic) lines.push({ name: 'galactic', color: [0.78, 0.6, 1.0, 0.6], width: 1.4 });
    if (layers.ecliptic) lines.push({ name: 'ecliptic', color: [1.0, 0.75, 0.45, 0.75], width: 1.4, dash: 3 });
    if (layers.constellations) lines.push({ name: 'constellations', color: [0.6, 0.7, 1.0, 0.42], width: 1.1 });
    const builtEnd = Math.min(end, renderer.fpBuilt, renderer.cubeN || end);
    const scanStart = Math.min(builtEnd, upperBound(fp.t, rel - SCAN_WINDOW));
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
      scanGain: 1,
      outlineAlpha: 0.04 * smoothstep(18, 5, fov),
      edge: smoothstep(25, 6, fov),
      starScale: clamp(Math.pow(cam.morph > 0.5 ? cam.mapZoom : cam.zoom, 0.22), 1, 2.2) * (W < DESKTOP_MIN ? 0.85 : 1),
      starBright: 1,
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
      x0: W >= DESKTOP_MIN ? Math.min(LEFT_PANEL, W * 0.4) : 0,
      avoid: avoidRects,
      grid: layers.grid,
      gridStep: { ra: gridStep, dec: gridStep },
      constellations: layers.constellations,
      constLabels,
      ecliptic: layers.ecliptic,
      galactic: layers.galactic,
      footprints: layers.footprints,
      reticle: reticleActive && reticleV ? { v: reticleV, phase: ((now || 0) / 1400) % 1 } : null,
    });
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
    destroy() {
      stop();
      window.removeEventListener('keydown', onKey);
      resizeObs.disconnect();
      tm.destroy();
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
