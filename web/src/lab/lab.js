// The Blink Lab: a modern blink comparator for SPHEREx. Finds every SPHEREx
// visit to a spot (or a moving body), streams the real pixels from NASA's
// archive, aligns them, and lets anyone flip, swipe, difference and trace
// motion through time.

import '../styles/lab.css';
import { formatRa, formatDec, tanProject, tanDeproject, parseCoords, equatorialToGalactic } from '../data/sky-math.js';
import { mjdToDate, S3 } from '../data/pointings.js';
import { esc } from '../ui/esc.js';
import { TARGETS, searchTargets } from '../data/targets.js';
import { surveyLabel, surveyColorVar } from '../data/survey.js';
import { makeCutout, clearQueue } from './cutout.js';
import { onePerPointing, groupPasses, pickFrames, surveyNumber } from './visits.js';
import { normalize, paintFrame, paintDifference, paintTrails, medianStack, residual, timeColor, COLORMAPS } from './render.js';
import { findMovers, classifyRate } from './movers.js';
import { bodyTrack, starTrack, planetsInField, jupiterMoons, PLANETS } from './ephem.js';
import { STORIES, storyById } from './stories.js';
import { queryKnownObjects } from './skybot.js';
import { drizzle, paintColor } from './deep.js';
import { lookupWave } from '../fits/spherex.js';

// One plain sentence per view, shown under the toolbar (tooltips never show on touch screens).
const MODE_HINT = {
  blink: 'Flips through the dates. Anything that jumps moved; still stars stay put.',
  compare: {
    flip: 'Flips between two dates. Shift-click a dot on the timeline to pick the second date.',
    swipe: 'Drag across the image to wipe from one date to the other.',
    diff: 'Subtracts two dates: what got brighter glows, what faded goes dark. Steady stars vanish.',
  },
  trails: 'Each date gets its own color. Still stars add up to white; anything that moved leaves a rainbow of dots.',
  grid: 'Every visit side by side, oldest first.',
  deep: 'All visits stacked into one sharper, deeper picture. Moving things blur out.',
};

const SIZES = [
  { px: 64, label: '6′' },
  { px: 112, label: '11′' },
  { px: 196, label: '20′' },
];
const SCALE = 6.15; // arcsec per output pixel (SPHEREx native)
const BUDGET = 24;
const LOAD_MAX = 240; // "Load every visit" stops here: ~1 MB and a canvas per frame
const APERTURE = [2, 4, 7]; // spectrum aperture radius, then its background ring (pixels)
const MJY_PER_PIXEL = (SCALE / 206264.806) ** 2 * 1e9; // one pixel of 1 MJy/sr, in mJy
const DEEP_MAX = 64; // visits that keep their raw detector samples for the Deep view
// SPHEREx detector pairs: which slice of the spectrum each one sees (µm).
const BANDS = {
  sw: [['D1', 0.75, 1.1], ['D2', 1.1, 1.6], ['D3', 1.6, 2.4]],
  lw: [['D4', 2.4, 3.8], ['D5', 3.8, 4.4], ['D6', 4.4, 5.0]],
};

const fmtDate = (mjd) => mjdToDate(mjd).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const fmtDay = (mjd) => mjdToDate(mjd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtMonth = (mjd) => mjdToDate(mjd).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
function fmtDelta(hours) {
  const h = Math.abs(hours);
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  if (h < 24 * 60) return `${(h / 24).toFixed(1)} days`;
  return `${(h / 24 / 30.44).toFixed(1)} months`;
}

const ICON = {
  play: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M15.5 5 8 12l7.5 7z"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8.5 5 16 12l-7.5 7z"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15 5l-7 7 7 7"/></svg>',
  reset: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/></svg>',
};

export function mountLab(root, { pointingsReady, onBack }) {
  root.innerHTML = `
  <div class="lab">
    <aside class="lab-side glass" aria-label="Target and frames">
      <div class="lab-side-scroll">
        <button class="btn lab-back" data-act="back">${ICON.back} Sky map</button>
        <div class="lab-target">
          <div class="label lab-kicker"></div>
          <h1 class="lab-title">Blink Lab</h1>
          <div class="lab-coords mono"></div>
          <p class="lab-blurb"></p>
          <p class="lab-tip"></p>
        </div>
        <div class="lab-search">
          <input class="text-input" type="search" placeholder="Jump to Pluto, M42, or 83.82 −5.39" aria-label="Find a target" autocomplete="off" />
          <div class="lab-suggest glass" hidden></div>
        </div>
        <section class="lab-block">
          <div class="label">Light</div>
          <div class="seg" data-group="band">
            <button data-val="sw" aria-pressed="true" title="Detectors 1-3">0.75–2.4 µm</button>
            <button data-val="lw" aria-pressed="false" title="Detectors 4-6">2.4–5.0 µm</button>
          </div>
        </section>
        <section class="lab-block lab-track-block" hidden>
          <div class="label">Follow</div>
          <div class="seg" data-group="track">
            <button data-val="track" aria-pressed="true" title="Center every frame on the moving object">Track object</button>
            <button data-val="fixed" aria-pressed="false" title="Hold the stars still">Fix stars</button>
          </div>
          <div class="lab-fixed-passes" hidden></div>
        </section>
        <section class="lab-block">
          <div class="label">Field of view</div>
          <div class="seg" data-group="size">${SIZES.map((s) => `<button data-val="${s.px}" aria-pressed="false">${s.label}</button>`).join('')}</div>
        </section>
        <section class="lab-block">
          <div class="label">Survey passes <span class="lab-count"></span></div>
          <div class="lab-passes"></div>
          <button class="btn lab-more" data-act="more" hidden>Load every visit</button>
        </section>
        <section class="lab-block">
          <div class="label">Display</div>
          <div class="seg" data-group="cmap">
            <button data-val="gray" aria-pressed="true">Mono</button>
            <button data-val="infrared" aria-pressed="false">Infrared</button>
            <button data-val="ice" aria-pressed="false">Ice</button>
          </div>
          <label class="lab-slider"><span>Contrast</span><input type="range" min="10" max="600" value="120" data-ctl="max" /></label>
          <label class="lab-slider"><span>Background</span><input type="range" min="-4" max="4" step="0.1" value="-1.5" data-ctl="black" /></label>
          <label class="lab-check"><input type="checkbox" data-ctl="smooth" /> Smooth pixels</label>
          <label class="lab-check"><input type="checkbox" data-ctl="coordGrid" /> RA/Dec grid</label>
        </section>
        <section class="lab-block lab-stream">
          <div class="label">Live from NASA</div>
          <p class="lab-stream-text">Pixels stream straight from the SPHEREx archive (NASA/IPAC IRSA on AWS) with HTTP range requests.</p>
          <div class="lab-meter"><div class="lab-meter-bar"></div></div>
          <div class="lab-stream-stats mono"></div>
        </section>
      </div>
    </aside>

    <section class="lab-main">
      <div class="lab-toolbar">
        <div class="seg lab-modes" data-group="mode" role="tablist">
          <button data-val="blink" aria-pressed="true" title="Flip through time (B)">Blink</button>
          <button data-val="compare" aria-pressed="false" title="Compare two dates (C)">Compare</button>
          <button data-val="trails" aria-pressed="false" title="Color = time; static stars stay white (T)">Trails</button>
          <button data-val="grid" aria-pressed="false" title="All frames side by side (G)">Grid</button>
          <button data-val="deep" aria-pressed="false" title="Stack every visit into one sharper, deeper image (S)">Deep</button>
        </div>
        <div class="seg lab-deep" data-group="deepColor" hidden>
          <button data-val="color" aria-pressed="true" title="Short, middle and long wavelengths as blue, green and red">IR color</button>
          <button data-val="mono" aria-pressed="false" title="All wavelengths together, in the Display colormap">Mono</button>
        </div>
        <div class="seg lab-detail" data-group="detail" hidden>
          <button data-val="1" aria-pressed="false" title="Native 6.15″ pixels">1×</button>
          <button data-val="2" aria-pressed="true" title="3.1″ pixels">2×</button>
          <button data-val="3" aria-pressed="false" title="2.05″ pixels">3×</button>
        </div>
        <div class="seg lab-compare" data-group="cmp" hidden>
          <button data-val="flip" aria-pressed="true">Flip</button>
          <button data-val="swipe" aria-pressed="false">Swipe</button>
          <button data-val="diff" aria-pressed="false">Difference</button>
        </div>
        <div class="lab-tool-right">
          <button class="btn" data-act="movers" title="Search for moving objects (M)">Find movers</button>
          <button class="btn" data-act="skybot" title="Ask IMCCE SkyBoT which known asteroids and comets were in this frame">Known asteroids</button>
          <button class="btn icon" data-act="reset" title="Reset zoom (0)" aria-label="Reset zoom">${ICON.reset}</button>
        </div>
      </div>
      <p class="lab-mode-hint" aria-live="polite"></p>
      <div class="lab-stage">
        <canvas class="lab-canvas" tabindex="0" aria-label="SPHEREx image viewer"></canvas>
        <div class="lab-reg reg-frame" aria-hidden="true"></div>
        <div class="lab-hud lab-hud-tl mono"></div>
        <div class="lab-hud lab-hud-tr"></div>
        <div class="lab-hud lab-hud-bl mono"></div>
        <div class="lab-empty">
          <div class="lab-spinner"></div>
          <div class="lab-empty-text">Finding SPHEREx visits…</div>
        </div>
      </div>
      <div class="lab-timeline glass">
        <div class="lab-transport">
          <button class="btn icon" data-act="prev" aria-label="Previous frame">${ICON.prev}</button>
          <button class="btn icon primary lab-play" data-act="play" aria-label="Play">${ICON.play}</button>
          <button class="btn icon" data-act="next" aria-label="Next frame">${ICON.next}</button>
          <label class="lab-speed"><span class="label">Speed</span><input type="range" min="1" max="12" value="3" data-ctl="fps" aria-label="Frames per second" /></label>
        </div>
        <div class="lab-track" role="listbox" aria-label="Frames in time order"></div>
        <div class="lab-frameinfo mono"></div>
      </div>
    </section>

    <aside class="lab-inspect glass" aria-label="Frame details">
      <section class="lab-block">
        <div class="label">This frame</div>
        <dl class="lab-dl lab-frame-dl"></dl>
      </section>
      <section class="lab-block">
        <div class="label">Cursor</div>
        <dl class="lab-dl lab-cursor-dl"><dt>Point at the image</dt><dd></dd></dl>
      </section>
      <section class="lab-block lab-spectrum-block">
        <div class="label">Spectrum</div>
        <div class="lab-spectrum"><p class="muted">Click any star or galaxy to measure its brightness in every loaded visit. Each visit sees a slightly different color, so together they trace its infrared spectrum.</p></div>
      </section>
      <section class="lab-block lab-movers-block">
        <div class="label">Moving objects</div>
        <div class="lab-movers"><p class="muted">Press <span class="kbd">M</span> or “Find movers” to search the loaded frames for anything that moves in a straight line.</p></div>
      </section>
      <section class="lab-block lab-known-block">
        <div class="label">Known objects</div>
        <div class="lab-known"><p class="muted">Planets and moons are marked automatically. “Known asteroids” asks the IMCCE SkyBoT service what was in view.</p></div>
      </section>
      <section class="lab-block">
        <div class="label">Measure</div>
        <p class="muted lab-measure">Hold <span class="kbd">Shift</span> and click an object, move to another frame, and Shift-click it again to measure its speed.</p>
      </section>
      <section class="lab-block lab-keys">
        <div class="label">Keys</div>
        <p class="muted"><span class="kbd">Space</span> play · <span class="kbd">←</span><span class="kbd">→</span> step · <span class="kbd">B</span><span class="kbd">C</span><span class="kbd">T</span><span class="kbd">G</span><span class="kbd">S</span> modes · <span class="kbd">A</span> set compare base · <span class="kbd">+</span><span class="kbd">−</span> zoom · click: spectrum</p>
      </section>
    </aside>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const el = {
    canvas: $('.lab-canvas'),
    stage: $('.lab-stage'),
    kicker: $('.lab-kicker'),
    title: $('.lab-title'),
    coords: $('.lab-coords'),
    blurb: $('.lab-blurb'),
    tip: $('.lab-tip'),
    modeHint: $('.lab-mode-hint'),
    passes: $('.lab-passes'),
    count: $('.lab-count'),
    more: $('.lab-more'),
    track: $('.lab-track'),
    frameinfo: $('.lab-frameinfo'),
    hudTL: $('.lab-hud-tl'),
    hudTR: $('.lab-hud-tr'),
    hudBL: $('.lab-hud-bl'),
    empty: $('.lab-empty'),
    emptyText: $('.lab-empty-text'),
    play: $('.lab-play'),
    frameDl: $('.lab-frame-dl'),
    cursorDl: $('.lab-cursor-dl'),
    movers: $('.lab-movers'),
    known: $('.lab-known'),
    measure: $('.lab-measure'),
    meter: $('.lab-meter-bar'),
    streamStats: $('.lab-stream-stats'),
    trackBlock: $('.lab-track-block'),
    fixedPasses: $('.lab-fixed-passes'),
    compareSeg: $('.lab-compare'),
    deepSeg: $('.lab-deep'),
    detailSeg: $('.lab-detail'),
    spectrum: $('.lab-spectrum'),
    search: $('.lab-search input'),
    suggest: $('.lab-suggest'),
  };
  const ctx = el.canvas.getContext('2d');

  const S = {
    session: 0,
    target: null,
    band: 'sw',
    trackMode: 'track',
    size: 112,
    visits: [],
    passes: [],
    passFilter: null, // pass id or null for all
    frames: [], // {visit, frame, color, canvas, overlays}
    cur: 0,
    base: 0, // compare base frame index
    mode: 'blink',
    cmp: 'flip',
    playing: false,
    fps: 3,
    display: { cmap: 'gray', max: 120, black: -1.5, soft: 3, smooth: false, coordGrid: false },
    deepColor: 'color',
    detail: 2,
    deepCache: null,
    probe: null, // {ra, dec} on the sky, or {x, y} in frame pixels when tracking a moving body
    view: { zoom: 1, x: 0, y: 0 },
    swipe: 0.5,
    movers: null,
    known: null,
    measure: [],
    bytes: 0,
    expected: 0,
    loaded: 0,
    renderVersion: 0,
    trailsCache: null,
    allLoaded: false,
    reuse: new Map(),
  };
  let P = null;

  // ---------- target resolution ----------
  function resolve(params) {
    const story = params.story && storyById(params.story);
    if (story) {
      const base = story.body ? bodyTarget(story.body) : starTarget(TARGETS.find((t) => t.id === story.target));
      return { ...base, story, size: story.size, trackMode: story.mode || 'track' };
    }
    // Links can be edited by hand: accept only known bodies and sane coordinates.
    const body = params.body && PLANETS.find((b) => b.toLowerCase() === String(params.body).toLowerCase());
    if (body) return bodyTarget(body);
    if (params.target) {
      const t = TARGETS.find((x) => x.id === params.target);
      if (t) return starTarget(t);
    }
    const ok = Number.isFinite(params.ra) && Number.isFinite(params.dec) && Math.abs(params.dec) <= 90;
    const ra = ok ? ((params.ra % 360) + 360) % 360 : 83.8221;
    const dec = ok ? params.dec : -5.3911;
    const name = typeof params.name === 'string' && params.name.trim() ? params.name.trim().slice(0, 60) : 'Sky position';
    return { name, kicker: 'Your pick', ra, dec, track: null };
  }

  function bodyTarget(body) {
    const t0 = P.mjd(0) - 2;
    const t1 = P.mjd(P.count - 1) + 2;
    const track = bodyTrack(body, t0, t1, 0.25);
    const [ra, dec] = track((t0 + t1) / 2);
    return { name: body, kicker: 'Solar system', ra, dec, track, moving: true, body };
  }

  function starTarget(t) {
    const base = { name: t.name, kicker: t.kind, alt: t.alt, ra: t.ra, dec: t.dec, track: null, id: t.id };
    if (!t.pmRa && !t.pmDec) return base;
    const track = starTrack(t);
    const mid = (P.mjd(0) + P.mjd(P.count - 1)) / 2;
    const [ra, dec] = track(mid);
    // Proper-motion stars: hold the field fixed at the mid-epoch position and mark
    // where the star should be on each date.
    return { ...base, ra, dec, starTrack: track, pm: true };
  }

  // ---------- open ----------
  async function open(params) {
    P = P || (await pointingsReady);
    const session = ++S.session;
    clearQueue();
    stop();
    S.frames = []; // a new target shares no frames with the last one
    const target = resolve(params);
    S.target = target;
    S.size = target.size || SIZES.find((s) => s.px === +params.size)?.px || 112;
    // Phones: a 20′ story cutout is ~65 MB of pixels; 11′ still shows the motion.
    if (!params.size && S.size > 112 && matchMedia('(max-width: 760px)').matches) S.size = 112;
    S.trackMode = target.trackMode || 'track';
    S.fixedPass = 'best';
    // Stories choose; everything else starts flipping through dates right away.
    S.autoplay = target.story ? !!target.story.autoplay : true;
    if (target.story?.view) S.mode = target.story.view;
    else if (params.story || params.body || params.target) S.mode = 'blink';
    if (params.band === 'lw' || params.band === 'sw') S.band = params.band;
    S.passFilter = null;
    S.view = { zoom: 1, x: 0, y: 0 };
    S.allLoaded = false;
    renderHeader();
    syncSegs();
    try {
      await search(session, BUDGET);
    } catch (err) {
      if (session !== S.session) return;
      console.error(err);
      showEmpty('Something went wrong opening this view. Try another target or reload the page.', false);
    }
  }

  async function search(session, budget) {
    const t = S.target;
    // Drop downloads queued for the previous search before starting this one,
    // but keep frames already in hand (e.g. for "Load every visit").
    clearQueue();
    S.reuse = new Map(S.frames.map((f) => [`${f.frame.url}|${f.center.join(',')}`, f]));
    S.frames = [];
    S.passFilter = null;
    S.movers = null;
    S.known = null;
    S.measure = [];
    S.cur = 0;
    S.base = 0;
    S.bytes = 0;
    S.loaded = 0;
    S.trailsCache = null;
    S.deepCache = null;
    S.probe = null;
    // Spectrum stories measure the tracked body as soon as frames arrive.
    if (t.story?.probe && t.track && S.trackMode === 'track') S.probe = { x: (S.size - 1) / 2, y: (S.size - 1) / 2 };
    renderSpectrum();
    el.movers.innerHTML = '<p class="muted">Press <span class="kbd">M</span> or “Find movers” to search the loaded frames for anything that moves in a straight line.</p>';
    el.known.innerHTML = '<p class="muted">Planets and moons are marked automatically. “Known asteroids” asks the IMCCE SkyBoT service what was in view.</p>';
    showEmpty(`Searching ${P.count.toLocaleString('en-US')} SPHEREx pointings…`, true);
    await new Promise((r) => setTimeout(r, 30));
    const useTrack = t.track && S.trackMode === 'track';
    let hits;
    if (t.track && S.trackMode === 'fixed') {
      // Hold the stars still: centre on the body's position during the pass that
      // was chosen (or the first), and search for visits to that spot then.
      const all = groupPasses(onePerPointing(P.findVisits(0, 0, { track: t.track }), S.band));
      if (S.fixedPass === 'best' || !all[S.fixedPass]) S.fixedPass = all.reduce((b, p, i) => (p.visits.length > all[b].visits.length ? i : b), 0);
      S.trackPasses = all;
      const pass = all[S.fixedPass];
      const mid = pass ? (pass.start + pass.end) / 2 : (P.mjd(0) + P.mjd(P.count - 1)) / 2;
      const [ra, dec] = t.track(mid);
      S.fixedCenter = [ra, dec];
      hits = P.findVisits(ra, dec, pass ? { tMin: pass.start - 1, tMax: pass.end + 1 } : {});
    } else {
      S.fixedCenter = null;
      S.trackPasses = null;
      hits = P.findVisits(t.ra, t.dec, useTrack ? { track: t.track } : {});
    }
    if (session !== S.session) return;
    S.visits = onePerPointing(hits, S.band);
    // Remember every sub-exposure of each pointing as a fallback when a file is missing.
    const alts = new Map();
    for (const h of hits) {
      if (!alts.has(h.i)) alts.set(h.i, []);
      alts.get(h.i).push(h);
    }
    S.alts = alts;
    S.passes = groupPasses(S.visits);
    renderHeader();
    renderPasses();
    if (!S.visits.length) {
      showEmpty('SPHEREx has not observed this spot yet in the public data (it may be too close to the Sun or the planets). Try another target.', false);
      renderTimeline();
      return;
    }
    const chosen = pickFrames(S.passes, Math.min(budget, LOAD_MAX));
    S.allLoaded = chosen.length >= Math.min(S.visits.length, LOAD_MAX);
    el.more.hidden = S.allLoaded;
    el.more.textContent = S.visits.length > LOAD_MAX ? `Load ${LOAD_MAX} of ${S.visits.length} visits` : `Load all ${S.visits.length} visits`;
    S.expected = chosen.length;
    showEmpty(`Streaming ${chosen.length} frames from NASA’s archive…`, true);
    updateStream();
    // Raw detector samples for the Deep view, spread evenly over the visits.
    const every = Math.ceil(chosen.length / DEEP_MAX);
    await Promise.all(chosen.map((v, i) => loadVisit(session, v, i % every === 0)));
    if (session !== S.session) return;
    if (!S.frames.length) showEmpty('Could not load frames from the archive. Check your connection and try again.', false);
    // A story that opens in Compare starts with the first and last dates.
    if (S.mode === 'compare' && S.cur === S.base && active().length > 1) {
      S.base = 0;
      S.cur = active().length - 1;
      renderTimeline();
      draw();
    }
    updateStream(true);
  }

  async function loadVisit(session, v, samples) {
    const center = S.fixedCenter || (v.ra !== undefined && S.target.track && S.trackMode === 'track' ? [v.ra, v.dec] : [S.target.ra, S.target.dec]);
    const old = S.reuse.get(`${P.fileUrl(v.i, v.det, v.sub)}|${center.join(',')}`);
    if (old && old.frame.N === S.size && (!samples || old.frame.samples)) {
      addFrame({ visit: old.visit, frame: old.frame, center });
      return;
    }
    const options = [v, ...(S.alts.get(v.i) || []).filter((h) => h.sub !== v.sub || h.det !== (v.det - (S.band === 'lw' ? 3 : 0)))];
    for (const h of options) {
      const det = h === v ? v.det : S.band === 'lw' ? h.det + 3 : h.det;
      try {
        const frame = await makeCutout({ url: P.fileUrl(h.i, det, h.sub), ra: center[0], dec: center[1], size: S.size, scale: SCALE, samples });
        if (session !== S.session) return;
        if (!frame || frame.valid < 0.2) {
          if (frame) S.bytes += frame.bytes;
          continue;
        }
        S.bytes += frame.bytes;
        addFrame({ visit: { ...v, sub: h.sub, det }, frame, center });
        return;
      } catch (err) {
        if (err.name === 'AbortError' || session !== S.session) return;
        // Missing file for this sub-exposure: try the next one.
      }
    }
    S.expected--;
    updateStream();
  }

  function addFrame(f) {
    normalize(f.frame);
    f.overlays = computeOverlays(f);
    S.frames.push(f);
    S.frames.sort((a, b) => a.frame.mjd - b.frame.mjd);
    S.loaded++;
    S.trailsCache = null;
    recolor();
    if (S.probe) scheduleSpectrum();
    updateStream();
    if (S.frames.length === 1) {
      hideEmpty();
      S.cur = 0;
    }
    scheduleRender();
    if (S.autoplay && S.frames.length >= 4 && S.mode !== 'trails' && S.mode !== 'deep') {
      S.autoplay = false;
      play();
    }
  }

  // Frames arrive in bursts: redraw once per animation frame, not per frame.
  let renderQueued = 0;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = requestAnimationFrame(() => {
      renderQueued = 0;
      renderTimeline();
      renderPasses();
      draw();
    });
  }

  function recolor() {
    const n = S.frames.length;
    S.frames.forEach((f, i) => (f.color = timeColor(i, n)));
  }

  // ---------- overlays: planets, moons, proper-motion markers ----------
  function computeOverlays(f) {
    const out = [];
    const { ra, dec, mjd, N } = f.frame;
    const radius = (N * SCALE) / 3600;
    for (const p of planetsInField(ra, dec, mjd, radius)) out.push({ ...p, kind: 'planet' });
    if (S.target.body === 'Jupiter') for (const m of jupiterMoons(mjd)) out.push({ ...m, kind: 'moon' });
    if (S.target.starTrack) {
      const [r, d] = S.target.starTrack(mjd);
      out.push({ name: S.target.name, ra: r, dec: d, kind: 'star' });
    }
    return out;
  }

  function skyToFrame(frame, ra, dec) {
    const pr = tanProject(frame.ra, frame.dec, ra, dec);
    if (!pr) return null;
    const s = frame.scale / 3600;
    const half = (frame.N - 1) / 2;
    return [half - pr[0] / s, half - pr[1] / s];
  }

  function frameToSky(frame, x, y) {
    const s = frame.scale / 3600;
    const half = (frame.N - 1) / 2;
    return tanDeproject(frame.ra, frame.dec, -(x - half) * s, (half - y) * s);
  }

  // ---------- frames in view ----------
  function active() {
    const pass = S.passFilter === null ? null : S.passes[S.passFilter];
    if (!pass) return S.frames;
    return S.frames.filter((f) => f.frame.mjd >= pass.start - 0.01 && f.frame.mjd <= pass.end + 0.01);
  }

  function frameCanvas(f) {
    if (f.canvas && f.canvasVersion === S.renderVersion) return f.canvas;
    const N = f.frame.N;
    const c = f.canvas || document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    paintFrame(img, f.frame.z, S.display, COLORMAPS[S.display.cmap]);
    g.putImageData(img, 0, 0);
    f.canvas = c;
    f.canvasVersion = S.renderVersion;
    return c;
  }

  function diffCanvas(a, b) {
    const N = a.frame.N;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    paintDifference(img, a.frame.z, b.frame.z, { max: S.display.max / 3 });
    g.putImageData(img, 0, 0);
    return c;
  }

  function trailsCanvas(list) {
    const key = list.map((f) => f.frame.mjd).join(',');
    let t = S.trailsCache;
    if (t?.key === key && t.version === S.renderVersion) return t.canvas;
    const N = list[0].frame.N;
    if (t?.key !== key) {
      // The median and residuals only change with the frames; sliders repaint.
      const median = medianStack(list.map((f) => f.frame.z));
      t = S.trailsCache = { key, median, res: list.map((f) => residual(f.frame.z, median, N)), canvas: document.createElement('canvas') };
    }
    const c = t.canvas;
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    paintTrails(img, list.map((f) => f.frame.z), t.median, S.display, { colors: list.map((_, i) => timeColor(i, list.length)), N, res: t.res });
    g.putImageData(img, 0, 0);
    t.version = S.renderVersion;
    return c;
  }

  // ---------- deep stack ----------
  // Drizzle every visit that kept its detector samples onto a grid up to 3x
  // finer. In IR color each detector becomes one channel: D1/D4 blue, D2/D5
  // green, D3/D6 red, so color follows wavelength across the 0.75-5 µm range.
  function deepStack(list) {
    const used = list.filter((f) => f.frame.samples?.n);
    const key = `${used.map((f) => f.frame.mjd).join(',')}|${S.deepColor}|${S.detail}`;
    const c = S.deepCache;
    if (c?.key === key) return c;
    if (used.length < 2) return null;
    // While frames stream in, restack at most a few times a second.
    const now = performance.now();
    if (c?.stack && now - c.t < 700 && S.loaded < S.expected) {
      clearTimeout(deepTimer);
      deepTimer = setTimeout(draw, 720 - (now - c.t));
      return c;
    }
    const N = used[0].frame.N;
    const factor = S.detail;
    const stackOf = (frames) => drizzle(frames, medianStack(frames.map((f) => f.frame.z)), { N, factor });
    let stack;
    const groups = [[], [], []];
    for (const f of used) groups[(f.frame.detector - 1) % 3].push(f);
    if (S.deepColor === 'color' && groups.filter((g) => g.length >= 2).length >= 2) {
      const chans = groups.map((g) => (g.length >= 2 ? stackOf(g).img : null));
      const have = chans.filter(Boolean);
      // A detector with too few visits borrows the mean of the others.
      const fill = () => {
        const a = new Float32Array(have[0].length);
        for (const h of have) for (let q = 0; q < a.length; q++) a[q] += h[q] / have.length;
        return a;
      };
      stack = { color: chans.map((ch) => ch || fill()), NF: N * factor, counts: groups.map((g) => (g.length >= 2 ? g.length : 0)) };
    } else {
      const d = stackOf(used);
      stack = { mono: d.img, NF: d.NF, counts: groups.map((g) => g.length) };
    }
    S.deepCache = { key, stack, used: used.length, t: now, canvas: null, version: -1 };
    return S.deepCache;
  }
  let deepTimer = 0;

  function deepCanvas(list) {
    const d = deepStack(list);
    if (!d) return null;
    if (d.canvas && d.version === S.renderVersion) return d.canvas;
    const { NF, color, mono } = d.stack;
    const c = d.canvas || document.createElement('canvas');
    c.width = c.height = NF;
    const g = c.getContext('2d');
    const img = g.createImageData(NF, NF);
    if (color) paintColor(img, color[2], color[1], color[0], S.display);
    else paintFrame(img, mono, S.display, COLORMAPS[S.display.cmap]);
    g.putImageData(img, 0, 0);
    d.canvas = c;
    d.version = S.renderVersion;
    return c;
  }

  // ---------- drawing ----------
  let cw = 0;
  let ch = 0;
  let dpr = 1;
  function resize() {
    const r = el.stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = Math.max(50, r.width);
    ch = Math.max(50, r.height);
    el.canvas.width = Math.round(cw * dpr);
    el.canvas.height = Math.round(ch * dpr);
    el.canvas.style.width = `${cw}px`;
    el.canvas.style.height = `${ch}px`;
    draw();
  }
  new ResizeObserver(resize).observe(el.stage);

  // Screen geometry of the image: square, fitted, then zoomed and panned.
  function geom(N) {
    const fit = Math.min(cw, ch) * 0.94;
    const k = (fit * S.view.zoom) / N;
    const ox = cw / 2 - (N / 2) * k + S.view.x;
    const oy = ch / 2 - (N / 2) * k + S.view.y;
    return { k, ox, oy };
  }

  function draw() {
    if (!cw) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const list = active();
    if (!list.length) {
      el.hudTL.textContent = '';
      el.hudBL.textContent = '';
      el.hudTR.innerHTML = '';
      return;
    }
    S.cur = Math.min(S.cur, list.length - 1);
    S.base = Math.min(S.base, list.length - 1);
    const f = list[S.cur];
    const N = f.frame.N;
    const { k, ox, oy } = geom(N);
    // The Deep grid is already finer than the data, so show it smooth.
    ctx.imageSmoothingEnabled = S.display.smooth || S.mode === 'deep';
    ctx.imageSmoothingQuality = 'high';

    if (S.mode === 'grid') return drawGrid(list);
    // Deep is one still image: nothing to play.
    if (S.mode === 'deep' && S.playing) stop();

    if (S.mode === 'deep') {
      const dc = deepCanvas(list);
      ctx.drawImage(dc || frameCanvas(f), ox, oy, N * k, N * k);
    } else if (S.mode === 'trails') {
      ctx.drawImage(trailsCanvas(list), ox, oy, N * k, N * k);
    } else if (S.mode === 'compare') {
      const a = list[S.base];
      if (S.cmp === 'diff') ctx.drawImage(diffCanvas(a, f), ox, oy, N * k, N * k);
      else if (S.cmp === 'swipe') {
        ctx.drawImage(frameCanvas(a), ox, oy, N * k, N * k);
        const sx = ox + N * k * S.swipe;
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, oy, ox + N * k - sx, N * k);
        ctx.clip();
        ctx.drawImage(frameCanvas(f), ox, oy, N * k, N * k);
        ctx.restore();
        ctx.fillStyle = '#fff';
        ctx.fillRect(sx - 1, oy, 2, N * k);
        // Handle sits low so it never covers the target in the middle.
        const hy = oy + N * k * 0.82;
        ctx.beginPath();
        ctx.arc(sx, hy, 11, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(10,14,30,.85)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '600 11px "Archivo Variable", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⟷', sx, hy + 1);
      } else {
        ctx.drawImage(frameCanvas(f), ox, oy, N * k, N * k);
      }
    } else {
      ctx.drawImage(frameCanvas(f), ox, oy, N * k, N * k);
    }

    // Frame border
    ctx.strokeStyle = 'rgba(160,180,255,.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 0.5, oy - 0.5, N * k + 1, N * k + 1);

    if (S.display.coordGrid) drawCoordGrid(f.frame, { k, ox, oy, N });
    drawOverlays(f, list, { k, ox, oy, N });
    drawCompass(ox, oy, k, N);
    renderHud(f, list);
  }

  function label(x, y, text, align = 'left', color = '#fff') {
    ctx.font = '500 12px "Archivo Variable", sans-serif';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(4,5,11,.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawOverlays(f, list, { k, ox, oy, N }) {
    const toScreen = (x, y) => [ox + (x + 0.5) * k, oy + (y + 0.5) * k];
    // Target reticle
    const tgt = S.target;
    let tp = null;
    if (tgt.track && S.trackMode === 'track') tp = [(N - 1) / 2, (N - 1) / 2];
    else if (tgt.track && S.fixedCenter) {
      const p = tgt.track(f.frame.mjd);
      tp = skyToFrame(f.frame, p[0], p[1]);
    } else if (!tgt.starTrack) tp = skyToFrame(f.frame, tgt.ra, tgt.dec);
    if (tp && S.mode !== 'trails') {
      const [x, y] = toScreen(...tp);
      const r = Math.max(10, 4 * k);
      ctx.strokeStyle = 'rgba(92,225,255,.9)';
      ctx.lineWidth = 1.5;
      for (const [a, b] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x + a * r, y + b * r);
        ctx.lineTo(x + a * r * 1.9, y + b * r * 1.9);
        ctx.stroke();
      }
    }
    // Ephemeris overlays (planets, moons, proper-motion predictions)
    // Trails: proper-motion stars and the tracked body get one ring per date, in that date's color.
    const overlaySet =
      S.mode === 'trails'
        ? list.flatMap((g, i) => g.overlays.filter((o) => o.kind === 'star' || (o.kind === 'planet' && o.name === tgt.body)).map((o) => ({ ...o, color: g.color, idx: i, last: i === list.length - 1 })))
        : f.overlays;
    for (const o of overlaySet) {
      const p = skyToFrame(f.frame, o.ra, o.dec);
      if (!p || p[0] < -2 || p[1] < -2 || p[0] > N + 1 || p[1] > N + 1) continue;
      const [x, y] = toScreen(...p);
      if (o.kind === 'star') {
        ctx.strokeStyle = o.color ? `rgb(${o.color.map(Math.round).join(',')})` : 'rgba(255,184,92,.95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(6, 1.6 * k), 0, Math.PI * 2);
        ctx.stroke();
        if (!o.color) label(x + Math.max(9, 2 * k), y - Math.max(9, 2 * k), `${o.name} (predicted)`, 'left', '#ffd9a8');
      } else if (o.color) {
        ctx.strokeStyle = `rgb(${o.color.map(Math.round).join(',')})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.stroke();
        if (o.last) label(x + 12, y - 11, o.name, 'left', '#ffd9a8');
      } else {
        // The tracked body already sits under the reticle.
        if (o.kind === 'planet' && tgt.body === o.name && S.trackMode === 'track') continue;
        ctx.strokeStyle = o.kind === 'moon' ? 'rgba(180,140,255,.95)' : 'rgba(255,184,92,.95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, o.kind === 'moon' ? 9 : 14, 0, Math.PI * 2);
        ctx.stroke();
        label(x + 14, y - 12, o.name, 'left', o.kind === 'moon' ? '#d9c8ff' : '#ffd9a8');
      }
    }
    // Known objects from SkyBoT (only for the frame they were queried for)
    if (S.known && S.known.mjd === f.frame.mjd) {
      for (const o of S.known.list) {
        const p = skyToFrame(f.frame, o.ra, o.dec);
        if (!p) continue;
        const [x, y] = toScreen(...p);
        ctx.strokeStyle = 'rgba(109,255,176,.95)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 8, y - 8, 16, 16);
        label(x + 11, y - 11, o.name, 'left', '#b5ffd6');
      }
    }
    // Mover tracks
    if (S.movers) {
      S.movers.tracks.forEach((t, ti) => {
        const pts = t.points.map((p) => toScreen(p.x, p.y));
        ctx.strokeStyle = 'rgba(255,107,139,.9)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.setLineDash([]);
        t.points.forEach((p, i) => {
          const [x, y] = pts[i];
          const here = list[S.cur] && Math.abs(p.mjd - list[S.cur].frame.mjd) < 1e-4;
          ctx.beginPath();
          ctx.arc(x, y, here ? 9 : 4, 0, Math.PI * 2);
          ctx.strokeStyle = here ? '#fff' : 'rgba(255,107,139,.9)';
          ctx.stroke();
        });
        const [lx, ly] = pts.at(-1);
        label(lx + 10, ly + 12, `#${ti + 1}`, 'left', '#ffc2cf');
      });
    }
    // Spectrum probe: the aperture and the ring that sets its background.
    const pp = S.probe && probeIn(f.frame);
    if (pp) {
      const [x, y] = toScreen(...pp);
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(5, APERTURE[0] * k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(255,224,138,.6)';
      for (const r of APERTURE.slice(1)) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(8, r * k), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // Measurement points
    for (const m of S.measure) {
      const p = skyToFrame(f.frame, m.ra, m.dec);
      if (!p) continue;
      const [x, y] = toScreen(...p);
      ctx.strokeStyle = '#ffb85c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 7, y);
      ctx.lineTo(x + 7, y);
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x, y + 7);
      ctx.stroke();
    }
  }

  function drawCompass(ox, oy, k, N) {
    // North up, east left. Scale bar: one arcminute.
    const x = ox + N * k - 18;
    const y = oy + N * k - 18;
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 26);
    ctx.moveTo(x, y);
    ctx.lineTo(x - 26, y);
    ctx.stroke();
    ctx.font = '600 10px "Archivo Variable", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', x, y - 34);
    ctx.fillText('E', x - 34, y);
    const bar = (60 / SCALE) * k;
    const bx = ox + 14;
    const by = oy + N * k - 16;
    ctx.fillRect(bx, by, bar, 2);
    label(bx + bar / 2, by - 9, '1′', 'center');
  }

  // RA/Dec lines at a round spacing that suits the zoom, labelled at the edges.
  const DEC_STEPS = [0.5, 1, 2, 5, 10, 15, 20, 30, 60].map((m) => m / 60);
  const RA_STEPS = [2, 4, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600].map((t) => t / 240);
  function drawCoordGrid(fr, { k, ox, oy, N }) {
    const span = (N * SCALE) / 3600 / Math.max(1, S.view.zoom);
    const dStep = DEC_STEPS.find((d) => span / d <= 6) || 1;
    const cosd = Math.max(0.01, Math.cos((fr.dec * Math.PI) / 180));
    let rStep = RA_STEPS.find((r) => r * cosd >= dStep * 0.8) || 15;
    let rmin = Infinity;
    let rmax = -Infinity;
    let dmin = Infinity;
    let dmax = -Infinity;
    for (let t = 0; t <= 8; t++) {
      const a = (t * (N - 1)) / 8;
      for (const [x, y] of [[a, 0], [a, N - 1], [0, a], [N - 1, a]]) {
        const sky = frameToSky(fr, x, y);
        if (!sky) continue;
        const r = fr.ra + ((((sky[0] - fr.ra + 540) % 360) + 360) % 360) - 180;
        rmin = Math.min(rmin, r);
        rmax = Math.max(rmax, r);
        dmin = Math.min(dmin, sky[1]);
        dmax = Math.max(dmax, sky[1]);
      }
    }
    for (const pole of [90, -90]) {
      const p = skyToFrame(fr, 0, pole);
      if (p && p[0] >= 0 && p[1] >= 0 && p[0] <= N - 1 && p[1] <= N - 1) {
        rmin = fr.ra - 180;
        rmax = fr.ra + 180;
        if (pole > 0) dmax = 90;
        else dmin = -90;
      }
    }
    if (!(rmax > rmin)) return;
    while ((rmax - rmin) / rStep > 24) rStep *= 2;
    const vx0 = Math.max(ox, 0);
    const vy0 = Math.max(oy, 0);
    const vx1 = Math.min(ox + N * k, cw);
    const vy1 = Math.min(oy + N * k, ch);
    if (vx1 <= vx0 || vy1 <= vy0) return;
    const scr = (ra, dec) => {
      const p = skyToFrame(fr, ra, dec);
      return p && [ox + (p[0] + 0.5) * k, oy + (p[1] + 0.5) * k];
    };
    const lines = [];
    for (let d = Math.ceil(dmin / dStep) * dStep; d <= dmax + 1e-9; d += dStep) {
      if (Math.abs(d) > 89.999) continue;
      const pts = [];
      for (let t = 0; t <= 40; t++) pts.push(scr(rmin + ((rmax - rmin) * t) / 40, d));
      lines.push({ pts: pts.filter(Boolean), text: fmtDecTick(d, dStep), edge: 'left' });
    }
    for (let r = Math.ceil(rmin / rStep) * rStep; r <= rmax + 1e-9; r += rStep) {
      const pts = [];
      for (let t = 0; t <= 40; t++) pts.push(scr(r, Math.max(-89.99, Math.min(89.99, dmin + ((dmax - dmin) * t) / 40))));
      lines.push({ pts: pts.filter(Boolean), text: fmtRaTick(r, rStep), edge: 'top' });
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    ctx.clip();
    ctx.strokeStyle = 'rgba(150,185,255,.38)';
    ctx.lineWidth = 1;
    for (const { pts } of lines) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.restore();
    // Dec labels run down the left edge, RA labels along a row above the scale
    // bar, both clear of the HUD in the corners.
    for (const { pts, text, edge } of lines) {
      if (pts.length < 2) continue;
      const left = edge === 'left';
      const want = left ? vx0 + 6 : Math.min(vy1 - 40, ch - 46);
      const [x, y] = pts.reduce((b, p) => (Math.abs(p[left ? 0 : 1] - want) < Math.abs(b[left ? 0 : 1] - want) ? p : b));
      if (left ? y < vy0 + 60 || y > vy1 - 56 : x < vx0 + 40 || x > vx1 - 76) continue;
      label(x + 4, left ? y - 8 : y, text, 'left', '#cfdcff');
    }
  }

  function fmtDecTick(d, step) {
    const t = Math.round(Math.abs(d) * 3600);
    const deg = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const sec = t % 60;
    return `${d < 0 ? '−' : '+'}${deg}°${step < 1 ? `${String(m).padStart(2, '0')}′` : ''}${step < 1 / 60 ? `${String(sec).padStart(2, '0')}″` : ''}`;
  }

  function fmtRaTick(r, step) {
    const t = Math.round(((((r % 360) + 360) % 360) * 240)) % 86400;
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const sec = t % 60;
    return `${h}h${step < 15 ? `${String(m).padStart(2, '0')}m` : ''}${step < 0.25 ? `${String(sec).padStart(2, '0')}s` : ''}`;
  }

  function drawGrid(list) {
    const n = list.length;
    const cols = Math.ceil(Math.sqrt((n * cw) / ch));
    const rows = Math.ceil(n / cols);
    const cell = Math.min(cw / cols, ch / rows);
    const pad = 4;
    const gx = (cw - cols * cell) / 2;
    const gy = (ch - rows * cell) / 2;
    list.forEach((f, i) => {
      const x = gx + (i % cols) * cell + pad;
      const y = gy + Math.floor(i / cols) * cell + pad;
      const s = cell - 2 * pad;
      ctx.drawImage(frameCanvas(f), x, y, s, s);
      ctx.strokeStyle = i === S.cur ? '#fff' : `rgba(${f.color.map(Math.round).join(',')},.7)`;
      ctx.lineWidth = i === S.cur ? 2 : 1;
      ctx.strokeRect(x, y, s, s);
      if (s > 70) label(x + 6, y + s - 10, fmtDay(f.frame.mjd), 'left');
    });
    S.gridGeom = { cols, cell, gx, gy, n };
    renderHud(list[S.cur], list);
  }

  function renderHud(f, list) {
    const prev = list[S.cur - 1];
    const dt = prev ? fmtDelta((f.frame.mjd - prev.frame.mjd) * 24) : '—';
    // Wavelength and detector live in the "This frame" panel; the HUD speaks dates.
    el.hudTL.innerHTML = `<b class="dsky" data-ghost="8888-88-88 88:88">${fmtDate(f.frame.mjd)}</b><span>${prev ? `${dt} after the last frame` : 'first visit'}</span>`;
    el.hudBL.textContent = `Frame ${S.cur + 1} / ${list.length}${S.mode === 'compare' ? ` · base ${S.base + 1}` : ''}`;
    const modeName = { blink: 'Blink', compare: { flip: 'Flip', swipe: 'Swipe', diff: 'Difference' }[S.cmp], trails: 'Trails', grid: 'Grid', deep: 'Deep' }[S.mode];
    el.modeHint.textContent = S.mode === 'compare' ? MODE_HINT.compare[S.cmp] : MODE_HINT[S.mode];
    if (S.mode === 'deep') return renderDeepHud(f, list, modeName);
    el.hudTR.innerHTML = `<span class="lab-chip">${modeName}</span>${S.mode === 'trails' ? trailLegend(list) : ''}${S.mode === 'compare' && S.cmp === 'diff' ? '<span class="lab-diff-legend"><i class="neg"></i>fainter <i class="pos"></i>brighter</span>' : ''}${S.mode === 'compare' && S.cmp === 'swipe' ? `<span class="lab-diff-legend">◀ ${fmtDay(list[S.base].frame.mjd)} │ ${fmtDay(f.frame.mjd)} ▶</span>` : ''}`;
    renderFrameInfo(f, list);
  }

  function renderDeepHud(f, list, modeName) {
    const d = S.deepCache;
    renderFrameInfo(f, list);
    if (!d || d.used < 2) {
      el.hudTL.innerHTML = '<b>Deep stack</b><br>needs at least two visits';
      el.hudBL.textContent = '';
      el.hudTR.innerHTML = `<span class="lab-chip">${modeName}</span>`;
      return;
    }
    const used = list.filter((g) => g.frame.samples?.n);
    const moving = S.target.track && S.trackMode === 'track';
    el.hudTL.innerHTML = `<b>${d.used} visits stacked</b><br>${fmtDay(used[0].frame.mjd)} – ${fmtDay(used.at(-1).frame.mjd)} · ${(SCALE / S.detail).toFixed(2)}″ pixels`;
    el.hudBL.textContent = moving ? `Stacked on ${S.target.name}’s motion` : d.used < list.length ? `${d.used} of ${list.length} loaded visits` : 'Noise drops as √visits';
    const bands = BANDS[S.band];
    const legend = d.stack.color
      ? `<div class="lab-legend lab-deep-legend">${[0, 1, 2]
          .map((i) => `<span><i style="background:${['#5aa8ff', '#6dffb0', '#ff6b6b'][i]}"></i>${bands[i][1]}–${bands[i][2]} µm <b class="mono">${d.stack.counts[i] || '—'}</b></span>`)
          .join('')}</div>`
      : '';
    el.hudTR.innerHTML = `<span class="lab-chip">${modeName}</span>${legend}`;
  }

  function trailLegend(list) {
    const stops = list.map((f, i) => `rgb(${timeColor(i, list.length).map(Math.round).join(',')})`).join(',');
    return `<div class="lab-legend"><div class="lab-legend-bar" style="background:linear-gradient(90deg,${stops})"></div><div class="lab-legend-ends mono"><span>${fmtMonth(list[0].frame.mjd)}</span><span>${fmtMonth(list.at(-1).frame.mjd)}</span></div><div class="muted">white = static · color = when it was there</div></div>`;
  }

  function renderFrameInfo(f, list) {
    const fr = f.frame;
    const url = fr.url;
    const file = url.split('/').pop();
    el.frameDl.innerHTML = `
      <dt>Observed</dt><dd class="mono">${fmtDate(fr.mjd)}</dd>
      <dt>Wavelength</dt><dd class="mono">${fr.lambda ? `${fr.lambda.toFixed(3)} µm (±${(fr.bandwidth / 2).toFixed(3)})` : '—'}</dd>
      <dt>Detector</dt><dd class="mono">D${fr.detector} · ${surveyLabel(surveyOf(fr.mjd))}</dd>
      <dt>Exposure</dt><dd class="mono">${esc(fr.obsId || '—')}</dd>
      <dt>Center</dt><dd class="mono">${formatRa(fr.ra)}<br>${formatDec(fr.dec)}</dd>
      <dt>Source file</dt><dd><a href="${esc(url.startsWith(S3) ? url : '#')}" target="_blank" rel="noopener" title="Full Level 2 FITS file (~70 MB) on the NASA IRSA S3 archive">${esc(file.replace('_spx_', ' '))}</a></dd>`;
    const prev = list[S.cur - 1];
    el.frameinfo.innerHTML = `<span>${fmtDay(fr.mjd)}</span><span class="muted">${prev ? `+${fmtDelta((fr.mjd - prev.frame.mjd) * 24)}` : 'first frame'}</span>`;
  }

  function surveyOf(mjd) {
    return surveyNumber(mjd);
  }

  // ---------- side panel ----------
  function renderHeader() {
    const t = S.target;
    if (!t) return;
    const story = t.story;
    el.kicker.textContent = story ? story.kicker : t.kicker || '';
    el.kicker.style.color = story ? story.accent : '';
    el.title.textContent = story ? story.title : t.name;
    const [l, b] = equatorialToGalactic(t.ra, t.dec);
    el.coords.innerHTML = t.track
      ? `${esc(t.name)} · moving target<br><span class="muted">${S.visits.length ? `${S.visits.length} SPHEREx pointings caught it` : ''}</span>`
      : `${formatRa(t.ra)}  ${formatDec(t.dec)}<br><span class="muted">l ${l.toFixed(2)}°  b ${b.toFixed(2)}°${S.visits.length ? ` · ${S.visits.length} pointings` : ''}</span>`;
    el.blurb.textContent = story ? story.blurb : t.alt ? `${t.alt} · ${t.kicker}` : 'Every SPHEREx frame that covers this point, aligned north-up so you can see what changed.';
    el.tip.textContent =
      story?.tip ||
      (t.body
        ? `${t.name} stays in the middle while the stars stream past. Under Follow, pick "Fix stars" to watch it move instead.${['Mars', 'Jupiter', 'Saturn'].includes(t.body) ? ' Planets this bright overexpose SPHEREx, so they show as a white blob.' : ''}`
        : 'Anything that jumps between dates moved. Still stars stay put; switch to Trails to see motion as a rainbow of dots.');
    el.tip.hidden = false;
    el.trackBlock.hidden = !t.track;
    const fp = S.trackMode === 'fixed' && S.trackPasses?.length > 1;
    el.fixedPasses.hidden = !fp;
    if (fp)
      el.fixedPasses.innerHTML =
        '<div class="muted">Hold the stars still during:</div>' +
        S.trackPasses
          .map((p, i) => `<button class="lab-pass ${i === S.fixedPass ? 'on' : ''}" data-fixed-pass="${i}"><span class="dot" style="background:${surveyColorVar(p.survey)}"></span><span>${fmtMonth(p.start)}</span><span class="mono muted">${p.visits.length}</span></button>`)
          .join('');
    document.title = `${story ? story.title : t.name} · Skyblink`;
  }

  function renderPasses() {
    const counts = S.passes.map((p) => S.frames.filter((f) => f.frame.mjd >= p.start - 0.01 && f.frame.mjd <= p.end + 0.01).length);
    el.count.textContent = S.visits.length ? `· ${S.frames.length} of ${S.visits.length} visits loaded` : '';
    el.passes.innerHTML =
      `<button class="lab-pass ${S.passFilter === null ? 'on' : ''}" data-pass="all"><span class="dot" style="background:linear-gradient(90deg,var(--survey-1),var(--survey-2),var(--survey-3))"></span><span>All dates</span><span class="mono muted">${S.frames.length}</span></button>` +
      S.passes
        .map(
          (p, i) => `<button class="lab-pass ${S.passFilter === i ? 'on' : ''}" data-pass="${i}">
          <span class="dot" style="background:${surveyColorVar(p.survey)}"></span>
          <span>${surveyLabel(p.survey)} · ${fmtMonth(p.start)}</span>
          <span class="mono muted">${counts[i]}/${p.visits.length}</span></button>`,
        )
        .join('');
  }

  function renderTimeline() {
    const list = S.frames;
    if (!list.length) {
      el.track.innerHTML = '';
      return;
    }
    // Passes are months apart: give each pass its own segment, frames placed by time within it.
    const segs = S.passes.map((p) => ({ p, frames: list.filter((f) => f.frame.mjd >= p.start - 0.01 && f.frame.mjd <= p.end + 0.01) })).filter((s) => s.frames.length);
    const act = active();
    el.track.innerHTML = segs
      .map(({ p, frames }) => {
        const span = Math.max(p.end - p.start, 0.5);
        const dots = frames
          .map((f) => {
            const i = act.indexOf(f);
            const x = ((f.frame.mjd - p.start) / span) * 100;
            const cls = ['lab-dot', i === S.cur ? 'cur' : '', S.mode === 'compare' && i === S.base ? 'base' : '', i < 0 ? 'off' : ''].join(' ');
            return `<button class="${cls}" style="left:${x}%;--c:rgb(${f.color.map(Math.round).join(',')})" data-idx="${i}" title="${fmtDate(f.frame.mjd)} · ${f.frame.lambda?.toFixed(2)} µm" aria-label="${fmtDate(f.frame.mjd)}"></button>`;
          })
          .join('');
        return `<div class="lab-seg" style="flex:${Math.max(1, frames.length)}"><div class="lab-seg-label"><span style="color:${surveyColorVar(p.survey)}">${surveyLabel(p.survey)}</span> ${fmtMonth(p.start)}</div><div class="lab-seg-rail">${dots}</div></div>`;
      })
      .join('');
  }

  function updateStream(done = false) {
    const pct = S.expected ? Math.min(100, (100 * S.loaded) / S.expected) : 0;
    el.meter.style.width = `${done ? 100 : pct}%`;
    el.streamStats.textContent = `${S.loaded} frames · ${(S.bytes / 1048576).toFixed(1)} MB of real SPHEREx pixels${done ? '' : ' …'}`;
  }

  function showEmpty(text, spinning) {
    el.empty.hidden = false;
    el.empty.classList.toggle('spin', spinning);
    el.emptyText.textContent = text;
    if (!S.frames.length) draw();
  }
  function hideEmpty() {
    el.empty.hidden = true;
  }

  function syncSegs() {
    const set = (group, val) => root.querySelectorAll(`[data-group="${group}"] button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.val === String(val))));
    set('band', S.band);
    set('size', S.size);
    set('mode', S.mode);
    set('cmp', S.cmp);
    set('cmap', S.display.cmap);
    set('track', S.trackMode);
    set('deepColor', S.deepColor);
    set('detail', S.detail);
    el.compareSeg.hidden = S.mode !== 'compare';
    el.deepSeg.hidden = el.detailSeg.hidden = S.mode !== 'deep';
  }

  // ---------- playback ----------
  let raf = 0;
  let last = 0;
  function play() {
    if (S.playing || active().length < 2 || S.mode === 'deep') return;
    S.playing = true;
    el.play.innerHTML = ICON.pause;
    el.play.setAttribute('aria-label', 'Pause');
    last = performance.now();
    const tick = (now) => {
      if (!S.playing) return;
      if (now - last >= 1000 / S.fps) {
        last = now;
        step(1, true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    S.playing = false;
    cancelAnimationFrame(raf);
    el.play.innerHTML = ICON.play;
    el.play.setAttribute('aria-label', 'Play');
  }
  function step(d, wrap = true) {
    const n = active().length;
    if (!n) return;
    if (S.mode === 'compare' && S.cmp === 'flip' && S.playing) {
      // Flip mode: alternate between the base frame and the current frame.
      S.flipShowBase = !S.flipShowBase;
      drawFlip();
      return;
    }
    S.cur = wrap ? (S.cur + d + n) % n : Math.min(n - 1, Math.max(0, S.cur + d));
    renderTimeline();
    draw();
  }
  function drawFlip() {
    const list = active();
    const keep = S.cur;
    if (S.flipShowBase) S.cur = S.base;
    draw();
    S.cur = keep;
    renderTimeline();
  }

  // ---------- movers & known objects ----------
  function runMovers() {
    const list = active();
    if (list.length < 3) {
      el.movers.innerHTML = '<p class="muted">Load at least three frames to search for motion.</p>';
      return;
    }
    const N = list[0].frame.N;
    const median = medianStack(list.map((f) => f.frame.z));
    const tracks = findMovers(
      list.map((f) => ({ z: f.frame.z, mjd: f.frame.mjd, masked: f.frame.masked })),
      median,
      N,
    );
    S.movers = { tracks };
    if (!tracks.length) {
      const span = (list.at(-1).frame.mjd - list[0].frame.mjd) * 24;
      el.movers.innerHTML = `<p class="muted">No straight-line movers found in ${list.length} frames. Asteroids move several pixels per hour, so they show up best in frames taken hours apart${span > 72 ? ': pick a single survey pass on the left' : ''}. Near the ecliptic you have the best odds.</p>`;
    } else {
      el.movers.innerHTML = tracks
        .map((t, i) => {
          const rate = t.rate * SCALE;
          const pa = ((Math.atan2(-t.vx, -t.vy) * 180) / Math.PI + 360) % 360;
          const p0 = t.points[0];
          // Each frame has its own center when tracking a moving body.
          const [ra, dec] = frameToSky(list[p0.f].frame, p0.x, p0.y);
          return `<div class="lab-mover"><b>#${i + 1}</b> <span class="mono">${rate.toFixed(1)}″/h</span> toward PA ${pa.toFixed(0)}° · ${t.points.length} detections<br><span class="muted">${classifyRate(rate)}</span><br><span class="mono muted">${formatRa(ra)} ${formatDec(dec)}</span></div>`;
        })
        .join('');
    }
    draw();
  }

  async function runSkybot() {
    const list = active();
    const f = list[S.cur];
    if (!f) return;
    el.known.innerHTML = '<p class="muted">Asking IMCCE SkyBoT…</p>';
    try {
      const radius = (f.frame.N * SCALE * Math.SQRT1_2) / 3600;
      const session = S.session;
      const objs = await queryKnownObjects(f.frame.ra, f.frame.dec, radius, f.frame.mjd);
      // A reply that arrives after the user moved on belongs to the old target.
      if (session !== S.session || !S.frames.includes(f)) return;
      S.known = { mjd: f.frame.mjd, list: objs };
      el.known.innerHTML = objs.length
        ? `<p class="muted">Known solar-system objects in view on ${fmtDay(f.frame.mjd)} (SkyBoT, IMCCE):</p>` +
          objs.map((o) => `<div class="lab-mover"><b>${esc(o.name)}</b> <span class="muted">${esc(o.cls)}${o.mag ? ` · V ${esc(o.mag)}` : ''}</span></div>`).join('')
        : `<p class="muted">SkyBoT lists no known asteroids or comets in this field on ${fmtDay(f.frame.mjd)}.</p>`;
    } catch (err) {
      el.known.innerHTML = `<p class="muted">Could not reach the SkyBoT service (${esc(err.message)}). Planets and moons are still marked.</p>`;
    }
    draw();
  }

  // ---------- interaction ----------
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    const seg = b.closest('[data-group]');
    if (seg) {
      const g = seg.dataset.group;
      const v = b.dataset.val;
      if (g === 'mode') {
        S.mode = v;
        if (v === 'compare' && S.base === S.cur) S.base = 0;
        if (v === 'compare' && S.cur === 0 && active().length > 1) S.cur = active().length - 1;
      } else if (g === 'cmp') S.cmp = v;
      else if (g === 'deepColor') S.deepColor = v;
      else if (g === 'detail') S.detail = +v;
      else if (g === 'cmap') {
        S.display.cmap = v;
        S.renderVersion++;
      } else if (g === 'band' && v !== S.band) {
        S.band = v;
        syncSegs();
        search(++S.session, BUDGET);
        return;
      } else if (g === 'size' && +v !== S.size) {
        S.size = +v;
        syncSegs();
        search(++S.session, S.allLoaded ? Infinity : BUDGET);
        return;
      } else if (g === 'track' && v !== S.trackMode) {
        S.trackMode = v;
        S.fixedPass = 'best';
        syncSegs();
        search(++S.session, BUDGET);
        return;
      }
      syncSegs();
      renderTimeline();
      draw();
      return;
    }
    const act = b.dataset.act;
    if (act === 'back') onBack();
    else if (act === 'play') S.playing ? stop() : play();
    else if (act === 'prev') (stop(), step(-1));
    else if (act === 'next') (stop(), step(1));
    else if (act === 'reset') {
      S.view = { zoom: 1, x: 0, y: 0 };
      draw();
    } else if (act === 'movers') runMovers();
    else if (act === 'skybot') runSkybot();
    else if (act === 'probe-clear') {
      S.probe = null;
      renderSpectrum();
      draw();
    }
    else if (act === 'more') {
      el.more.hidden = true;
      search(++S.session, Infinity);
    }
    if (b.dataset.fixedPass) {
      S.fixedPass = +b.dataset.fixedPass;
      search(++S.session, BUDGET);
      return;
    }
    if (b.dataset.pass) {
      S.passFilter = b.dataset.pass === 'all' ? null : +b.dataset.pass;
      S.cur = 0;
      S.base = 0;
      S.movers = null;
      if (S.probe) renderSpectrum();
      renderPasses();
      renderTimeline();
      draw();
    }
    if (b.classList.contains('lab-dot')) {
      const i = +b.dataset.idx;
      if (i < 0) return;
      stop();
      if (S.mode === 'compare' && e.shiftKey) S.base = i;
      else S.cur = i;
      renderTimeline();
      draw();
    }
  });

  // Touch: drag along the frame dots to scrub (the dots are too small to tap one by one).
  let scrubbing = false;
  const scrubTo = (x) => {
    let best = -1;
    let bestD = Infinity;
    for (const d of el.track.querySelectorAll('.lab-dot')) {
      const i = +d.dataset.idx;
      if (i < 0) continue;
      const r = d.getBoundingClientRect();
      const dx = Math.abs(r.left + r.width / 2 - x);
      if (dx < bestD) {
        bestD = dx;
        best = i;
      }
    }
    if (best >= 0 && best !== S.cur) {
      stop();
      S.cur = best;
      renderTimeline();
      draw();
    }
  };
  el.track.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    scrubbing = true;
    el.track.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  });
  el.track.addEventListener('pointermove', (e) => {
    if (scrubbing) scrubTo(e.clientX);
  });
  for (const type of ['pointerup', 'pointercancel']) el.track.addEventListener(type, () => (scrubbing = false));

  root.querySelectorAll('[data-ctl]').forEach((input) =>
    input.addEventListener('input', () => {
      const c = input.dataset.ctl;
      if (c === 'fps') S.fps = +input.value;
      else if (c === 'smooth') S.display.smooth = input.checked;
      else if (c === 'coordGrid') S.display.coordGrid = input.checked;
      else {
        S.display[c] = +input.value;
        S.renderVersion++;
      }
      draw();
    }),
  );

  // Pan, zoom, swipe, measure, hover readout on the canvas.
  let drag = null;
  el.canvas.addEventListener('pointerdown', (e) => {
    el.canvas.setPointerCapture(e.pointerId);
    const list = active();
    const N = list[0]?.frame.N || 1;
    const { k, ox } = geom(N);
    const sx = ox + N * k * S.swipe;
    const onSwipe = S.mode === 'compare' && S.cmp === 'swipe' && Math.abs(e.offsetX - sx) < 16;
    drag = { x: e.offsetX, y: e.offsetY, vx: S.view.x, vy: S.view.y, moved: false, swipe: onSwipe };
  });
  el.canvas.addEventListener('pointermove', (e) => {
    hover(e);
    if (!drag) return;
    const dx = e.offsetX - drag.x;
    const dy = e.offsetY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.swipe) {
      const N = active()[0].frame.N;
      const { k, ox } = geom(N);
      S.swipe = Math.min(1, Math.max(0, (e.offsetX - ox) / (N * k)));
    } else {
      S.view.x = drag.vx + dx;
      S.view.y = drag.vy + dy;
    }
    draw();
  });
  el.canvas.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (!d || d.moved) return;
    const list = active();
    if (S.mode === 'grid' && S.gridGeom) {
      const { cols, cell, gx, gy, n } = S.gridGeom;
      const i = Math.floor((e.offsetY - gy) / cell) * cols + Math.floor((e.offsetX - gx) / cell);
      if (i >= 0 && i < n) {
        S.cur = i;
        S.mode = 'blink';
        syncSegs();
        renderTimeline();
        draw();
      }
      return;
    }
    if (!list.length || d.swipe) return;
    if (e.shiftKey) measureAt(e);
    else probeAt(e);
  });
  el.canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      zoomAt(e.offsetX, e.offsetY, f);
    },
    { passive: false },
  );
  el.canvas.addEventListener('dblclick', () => {
    S.view = { zoom: 1, x: 0, y: 0 };
    draw();
  });

  function zoomAt(px, py, f) {
    const z = Math.min(12, Math.max(0.5, S.view.zoom * f));
    const ratio = z / S.view.zoom;
    // Keep the point under the cursor fixed.
    S.view.x = (S.view.x - (px - cw / 2)) * ratio + (px - cw / 2);
    S.view.y = (S.view.y - (py - ch / 2)) * ratio + (py - ch / 2);
    S.view.zoom = z;
    draw();
  }

  function pixelAt(e) {
    const list = active();
    const f = list[S.cur];
    if (!f) return null;
    const N = f.frame.N;
    const { k, ox, oy } = geom(N);
    const x = (e.offsetX - ox) / k - 0.5;
    const y = (e.offsetY - oy) / k - 0.5;
    if (x < -0.5 || y < -0.5 || x > N - 0.5 || y > N - 0.5) return null;
    return { f, x, y, N };
  }

  function hover(e) {
    if (S.mode === 'grid') return;
    const p = pixelAt(e);
    if (!p) {
      el.cursorDl.innerHTML = '<dt>Point at the image</dt><dd></dd>';
      return;
    }
    const [ra, dec] = frameToSky(p.f.frame, p.x, p.y);
    const idx = Math.round(p.y) * p.N + Math.round(p.x);
    const v = p.f.frame.data[idx];
    const z = p.f.frame.z[idx];
    el.cursorDl.innerHTML = `<dt>RA, Dec</dt><dd class="mono">${formatRa(ra)}<br>${formatDec(dec)}</dd><dt>Surface brightness</dt><dd class="mono">${v === v ? `${v.toFixed(3)} MJy/sr · ${z.toFixed(1)}σ` : 'masked'}</dd>`;
  }

  /**
   * Snap a click to the brightest pixel within two pixels and centroid it, so
   * a click near a star lands on the star. Faint spots (below minZ) stay put.
   */
  function snap(p, minZ = -Infinity) {
    const { N } = p;
    const z = p.f.frame.z;
    let bx = Math.round(p.x);
    let by = Math.round(p.y);
    let best = -Infinity;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = Math.round(p.x) + dx;
        const y = Math.round(p.y) + dy;
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        if (z[y * N + x] > best) {
          best = z[y * N + x];
          bx = x;
          by = y;
        }
      }
    if (!(best >= minZ)) return [p.x, p.y];
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = bx + dx;
        const y = by + dy;
        if (x < 0 || y < 0 || x >= N || y >= N) continue;
        const w = z[y * N + x];
        if (!(w > 0)) continue;
        sx += w * x;
        sy += w * y;
        sw += w;
      }
    return sw > 0 ? [sx / sw, sy / sw] : [bx, by];
  }

  function measureAt(e) {
    const p = pixelAt(e);
    if (!p) return;
    const [bx, by] = snap(p);
    const [ra, dec] = frameToSky(p.f.frame, bx, by);
    S.measure.push({ ra, dec, mjd: p.f.frame.mjd });
    if (S.measure.length > 2) S.measure = S.measure.slice(-1);
    if (S.measure.length === 2) {
      const [a, b] = S.measure;
      const pr = tanProject(a.ra, a.dec, b.ra, b.dec);
      const dist = Math.hypot(pr[0], pr[1]) * 3600;
      const hours = Math.abs(b.mjd - a.mjd) * 24;
      if (hours < 0.01) {
        el.measure.innerHTML = 'Both clicks are on the same frame. Step to a frame taken at another time and Shift-click again.';
      } else {
        const rate = dist / hours;
        el.measure.innerHTML = `<b class="mono">${dist.toFixed(1)}″</b> in ${fmtDelta(hours)} = <b class="mono">${rate < 0.01 ? `${(rate * 24 * 365.25).toFixed(1)}″/yr` : `${rate.toFixed(2)}″/h`}</b><br><span class="muted">${dist < SCALE * 0.6 ? 'Less than a pixel: probably not moving.' : classifyRate(rate)}</span>`;
      }
    } else {
      el.measure.innerHTML = `Marked at ${fmtDate(p.f.frame.mjd)}. Now step to another frame and Shift-click the same object.`;
    }
    draw();
  }

  // ---------- spectrum at a point ----------
  // SPHEREx images through linear variable filters, so each visit sees a given
  // spot at its own wavelength. Measuring the same spot in every visit traces
  // its 0.75-5 µm spectrum, the survey's whole purpose.
  function probeAt(e) {
    const p = pixelAt(e);
    if (!p) return;
    const tracking = S.target.track && S.trackMode === 'track';
    const c = (p.N - 1) / 2;
    // Near a tracked body, measure the body itself at its predicted position;
    // snapping could catch a star it happens to pass.
    const [x, y] = tracking && Math.hypot(p.x - c, p.y - c) < 3 ? [c, c] : snap(p, 5);
    if (tracking) S.probe = { x, y };
    else {
      const [ra, dec] = frameToSky(p.f.frame, x, y);
      S.probe = { ra, dec };
    }
    renderSpectrum();
    draw();
  }

  /** The probe's position in a frame's pixels. */
  function probeIn(fr) {
    const pr = S.probe;
    if (!pr) return null;
    return pr.ra === undefined ? [pr.x, pr.y] : skyToFrame(fr, pr.ra, pr.dec);
  }

  /** Aperture flux (mJy) with the median of a surrounding ring as background. */
  function aperture(fr, x, y) {
    const [r, r1, r2] = APERTURE;
    const N = fr.N;
    const ring = [];
    let sum = 0;
    let n = 0;
    const xi = Math.round(x);
    const yi = Math.round(y);
    for (let dy = -r2 - 1; dy <= r2 + 1; dy++)
      for (let dx = -r2 - 1; dx <= r2 + 1; dx++) {
        const px = xi + dx;
        const py = yi + dy;
        const d = Math.hypot(px - x, py - y);
        const off = px < 0 || py < 0 || px >= N || py >= N;
        const q = py * N + px;
        if (d <= r) {
          if (off || fr.masked[q] || fr.data[q] !== fr.data[q]) return null;
          sum += fr.data[q];
          n++;
        } else if (d >= r1 && d <= r2 && !off && fr.data[q] === fr.data[q] && !fr.masked[q]) ring.push(fr.data[q]);
      }
    if (ring.length < 8 || !n) return null;
    ring.sort((a, b) => a - b);
    const bg = ring[ring.length >> 1];
    return {
      flux: (sum - n * bg) * MJY_PER_PIXEL,
      err: fr.sigma * Math.sqrt(n + (n * n * Math.PI) / (2 * ring.length)) * MJY_PER_PIXEL,
    };
  }

  function spectrumPoints(list) {
    const out = [];
    list.forEach((f) => {
      const fr = f.frame;
      const p = probeIn(fr);
      if (!p) return;
      const ph = aperture(fr, p[0], p[1]);
      if (!ph) return;
      // Wavelength at this exact spot on the detector, not the frame center.
      let w = { lambda: fr.lambda, bandwidth: fr.bandwidth };
      if (fr.wave && fr.wcs) {
        const sky = frameToSky(fr, p[0], p[1]);
        const d = fr.wcs.skyToPix(sky[0], sky[1]);
        if (d) w = lookupWave(fr.wave, d[0], d[1]);
      }
      if (!(w.lambda > 0)) return;
      out.push({ ...ph, lambda: w.lambda, bw: w.bandwidth || 0, mjd: fr.mjd, color: f.color });
    });
    out.sort((a, b) => a.lambda - b.lambda);
    // A point far from its spectral neighbours was probably hit by a passing
    // star, a cosmic ray or a satellite: show it hollow.
    for (const p of out) {
      const near = out.filter((q) => q !== p && Math.abs(q.lambda - p.lambda) < 0.12).map((q) => q.flux);
      if (near.length < 2) continue;
      near.sort((a, b) => a - b);
      const m = near[near.length >> 1];
      p.odd = Math.abs(p.flux - m) > Math.max(5 * p.err, 0.5 * Math.abs(m));
    }
    return out;
  }

  let spectrumTimer = 0;
  function scheduleSpectrum() {
    clearTimeout(spectrumTimer);
    spectrumTimer = setTimeout(renderSpectrum, 250);
  }

  function renderSpectrum() {
    clearTimeout(spectrumTimer);
    root.firstElementChild.classList.toggle('probing', !!S.probe);
    if (!S.probe) {
      const t = S.target;
      el.spectrum.innerHTML =
        t?.track && S.trackMode === 'track'
          ? `<p class="muted">Click ${esc(t.name)} in the middle of the view to measure its reflected light in every visit, or click any star.</p>`
          : '<p class="muted">Click any star or galaxy to measure its brightness in every loaded visit. Each visit sees a slightly different color, so together they trace its infrared spectrum.</p>';
      return;
    }
    const list = active();
    const pts = spectrumPoints(list);
    const where = S.probe.ra === undefined ? `on ${esc(S.target.name)}, following its motion` : `${formatRa(S.probe.ra)} ${formatDec(S.probe.dec)}`;
    const head = `<div class="lab-spectrum-head"><span class="mono muted">${where}</span><button class="btn icon" data-act="probe-clear" aria-label="Clear spectrum" title="Clear">×</button></div>`;
    if (pts.length < 3) {
      el.spectrum.innerHTML = `${head}<p class="muted">${pts.length ? `Only ${pts.length} clean measurement${pts.length > 1 ? 's' : ''} here` : 'No clean measurement here'}: the spot is masked or too near the edge in most visits. Try a spot nearer the middle${S.allLoaded ? '' : ', or load every visit'}.</p>`;
      return;
    }
    const few = pts.length < list.length / 2 ? `<p class="muted lab-spectrum-note">Only ${pts.length} of ${list.length} visits measured cleanly here. The rest were masked, which usually means the source is too bright for the detector, so treat these points with care.</p>` : '';
    el.spectrum.innerHTML = head + spectrumSvg(pts) + few + `<p class="muted lab-spectrum-note">${pts.length} visits · ${APERTURE[0] * SCALE}″ aperture · dot color = date, as on the timeline; hollow = off the trend. Stars fade toward longer wavelengths; dips can mark ices and molecules, such as water ice near 3 µm.</p>`;
  }

  function spectrumSvg(pts) {
    const W = 280;
    const H = 168;
    const m = { l: 40, r: 8, t: 16, b: 26 };
    const lo = BANDS[S.band][0][1];
    const hi = BANDS[S.band][2][2];
    const lmin = Math.min(lo, ...pts.map((p) => p.lambda - p.bw / 2));
    const lmax = Math.max(hi, ...pts.map((p) => p.lambda + p.bw / 2));
    let fmin = Math.min(0, ...pts.map((p) => p.flux - p.err));
    let fmax = Math.max(...pts.map((p) => p.flux + p.err));
    if (!(fmax > fmin)) fmax = fmin + 1;
    const pad = (fmax - fmin) * 0.08;
    fmax += pad;
    if (fmin < 0) fmin -= pad;
    const X = (l) => m.l + ((l - lmin) / (lmax - lmin)) * (W - m.l - m.r);
    const Y = (f) => m.t + (1 - (f - fmin) / (fmax - fmin)) * (H - m.t - m.b);
    const ystep = niceStep((fmax - fmin) / 4);
    const yt = [];
    for (let v = Math.ceil(fmin / ystep) * ystep; v <= fmax; v += ystep) yt.push(v);
    const xt = S.band === 'sw' ? [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4] : [2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
    const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2));
    const rgb = (c) => `rgb(${c.map(Math.round).join(',')})`;
    return `<svg class="lab-spectrum-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spectrum: flux in millijansky against wavelength in micrometres">
      ${yt.map((v) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 5}" y="${Y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join('')}
      ${xt.filter((l) => l >= lmin && l <= lmax).map((l) => `<line class="tick" x1="${X(l)}" x2="${X(l)}" y1="${H - m.b}" y2="${H - m.b + 4}"/><text x="${X(l)}" y="${H - m.b + 14}" text-anchor="middle">${l.toFixed(1)}</text>`).join('')}
      <line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>
      ${fmin < 0 ? `<line class="zero" x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}"/>` : ''}
      <text class="unit" x="${W - m.r}" y="${H - 2}" text-anchor="end">µm</text>
      <text class="unit" x="4" y="8">mJy</text>
      ${pts
        .map(
          (p) => `<g><title>${p.lambda.toFixed(3)} µm · ${p.flux.toFixed(2)} ± ${p.err.toFixed(2)} mJy · ${fmtDay(p.mjd)}${p.odd ? ' · off the trend: maybe a passing star or cosmic ray' : ''}</title>
        <line class="err" x1="${X(p.lambda)}" x2="${X(p.lambda)}" y1="${Y(p.flux - p.err)}" y2="${Y(p.flux + p.err)}"/>
        <line class="err" x1="${X(p.lambda - p.bw / 2)}" x2="${X(p.lambda + p.bw / 2)}" y1="${Y(p.flux)}" y2="${Y(p.flux)}"/>
        <circle cx="${X(p.lambda)}" cy="${Y(p.flux)}" r="3.2" ${p.odd ? `fill="none" stroke="${rgb(p.color)}" stroke-width="1.5"` : `fill="${rgb(p.color)}"`}/></g>`,
        )
        .join('')}
    </svg>`;
  }

  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(raw));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }

  // Keyboard shortcuts while the Lab is visible.
  window.addEventListener('keydown', (e) => {
    if (root.closest('.view')?.hidden || root.offsetParent === null) return;
    // Leave browser shortcuts (copy, select all, page zoom) alone.
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]')) return;
    const k = e.key;
    const modes = { b: 'blink', c: 'compare', t: 'trails', g: 'grid', s: 'deep' };
    if (k === ' ') {
      e.preventDefault();
      S.playing ? stop() : play();
    } else if (k === 'ArrowRight') (stop(), step(1));
    else if (k === 'ArrowLeft') (stop(), step(-1));
    else if (modes[k.toLowerCase()]) {
      S.mode = modes[k.toLowerCase()];
      syncSegs();
      renderTimeline();
      draw();
    } else if (k === 'a' || k === 'A') {
      S.base = S.cur;
      renderTimeline();
      draw();
    } else if (k === 'd' || k === 'D') {
      S.mode = 'compare';
      S.cmp = 'diff';
      syncSegs();
      draw();
    } else if (k === 'm' || k === 'M') runMovers();
    else if (k === '+' || k === '=') zoomAt(cw / 2, ch / 2, 1.25);
    else if (k === '-') zoomAt(cw / 2, ch / 2, 0.8);
    else if (k === '0') {
      S.view = { zoom: 1, x: 0, y: 0 };
      draw();
    }
  });

  // Search box inside the Lab.
  el.search.addEventListener('input', () => {
    const q = el.search.value;
    const coords = parseCoords(q);
    const hits = searchTargets(q);
    const items = [];
    if (coords) items.push({ type: 'coords', name: `Go to ${formatRa(coords[0])} ${formatDec(coords[1])}`, ra: coords[0], dec: coords[1] });
    items.push(...hits);
    el.suggest.hidden = !items.length;
    el.suggest.innerHTML = items
      .map((h, i) => `<button data-sug="${i}"><b>${esc(h.name)}</b>${h.kind ? `<span class="muted"> · ${esc(h.kind)}</span>` : ''}</button>`)
      .join('');
    el.suggest.onclick = (e) => {
      const b = e.target.closest('[data-sug]');
      if (!b) return;
      const h = items[+b.dataset.sug];
      el.suggest.hidden = true;
      el.search.value = '';
      navigate(h);
    };
  });
  el.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.suggest.querySelector('button')?.click();
    if (e.key === 'Escape') el.suggest.hidden = true;
  });

  function navigate(h) {
    const go = (q) => (location.hash = `#/lab?${new URLSearchParams(q)}`);
    if (h.type === 'coords') go({ ra: h.ra.toFixed(5), dec: h.dec.toFixed(5) });
    else if (h.type === 'body') go({ body: h.name });
    else go({ target: h.id });
  }

  return { open, stories: STORIES };
}
