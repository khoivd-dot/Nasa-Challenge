// App chrome: top bar, view switching, the stories panel over the sky map,
// and the About page.

import { STORIES } from '../lab/stories.js';
import { searchTargets } from '../data/targets.js';
import { parseCoords, formatRa, formatDec } from '../data/sky-math.js';

export function createShell(app) {
  app.innerHTML = `
    <header class="topbar glass">
      <a class="brand" href="#/sky" aria-label="Skyblink home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i></span>
        <span class="brand-name">Skyblink</span>
        <span class="brand-tag">SPHEREx sky time machine</span>
      </a>
      <nav class="nav" aria-label="Main">
        <a href="#/sky" data-nav="sky">Sky map</a>
        <a href="#/lab?story=pluto" data-nav="lab">Blink Lab</a>
        <a href="#/about" data-nav="about">About</a>
      </nav>
      <div class="top-search">
        <input class="text-input" type="search" placeholder="Search Pluto, Orion, or RA Dec" aria-label="Search the sky" autocomplete="off" />
        <div class="top-suggest glass" hidden></div>
      </div>
    </header>
    <main class="views">
      <section class="view" data-view="sky" hidden></section>
      <section class="view" data-view="lab" hidden></section>
      <section class="view view-about" data-view="about" hidden>${ABOUT}</section>
    </main>`;

  const views = Object.fromEntries([...app.querySelectorAll('[data-view]')].map((v) => [v.dataset.view, v]));
  const shell = {
    views,
    onNavigate: null,
    setView(name) {
      for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
      app.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
      if (name !== 'lab') document.title = 'Skyblink · watch the SPHEREx sky change';
    },
    mountStories(root, onOpen) {
      const panel = document.createElement('aside');
      panel.className = 'stories glass';
      panel.innerHTML = `
        <div class="stories-head">
          <div class="label">Real data · Apr 2025 → Aug 2026</div>
          <h1>Watch the infrared sky <em>change</em>.</h1>
          <p>NASA’s SPHEREx maps the whole sky every six months. Skyblink lines up its images so anyone can blink between dates, like the astronomer who found Pluto did, and spot what moves.</p>
          <p class="stories-hint">Click anywhere on the sky to open every SPHEREx image of that spot, or start with a story:</p>
        </div>
        <div class="stories-list">
          ${STORIES.map(
            (s) => `<button class="story" data-story="${s.id}" style="--accent:${s.accent}">
              <span class="story-kicker">${s.kicker}</span>
              <span class="story-title">${s.title}</span>
            </button>`,
          ).join('')}
        </div>
        <button class="stories-toggle btn" aria-expanded="true">Hide</button>`;
      root.appendChild(panel);
      const toggle = panel.querySelector('.stories-toggle');
      const setCollapsed = (collapsed) => {
        panel.classList.toggle('collapsed', collapsed);
        toggle.textContent = collapsed ? 'Stories' : 'Hide';
        toggle.setAttribute('aria-expanded', String(!collapsed));
      };
      // On phones the panel would cover the time machine, so it starts folded.
      if (matchMedia('(max-width: 760px)').matches) setCollapsed(true);
      panel.addEventListener('click', (e) => {
        const b = e.target.closest('[data-story]');
        if (b) onOpen(STORIES.find((s) => s.id === b.dataset.story));
        if (e.target.closest('.stories-toggle')) setCollapsed(!panel.classList.contains('collapsed'));
      });
    },
  };

  // Global search: named targets, solar-system bodies, or coordinates.
  const input = app.querySelector('.top-search input');
  const sug = app.querySelector('.top-suggest');
  let items = [];
  input.addEventListener('input', () => {
    const q = input.value;
    const c = parseCoords(q);
    items = [];
    if (c) items.push({ type: 'coords', name: `${formatRa(c[0])} ${formatDec(c[1])}`, kind: 'Open these coordinates', ra: c[0], dec: c[1] });
    items.push(...searchTargets(q));
    sug.hidden = !items.length;
    sug.innerHTML = items.map((h, i) => `<button data-i="${i}"><b>${h.name}</b><span class="muted"> · ${h.kind || ''}</span></button>`).join('');
  });
  const pick = (h) => {
    sug.hidden = true;
    input.value = '';
    input.blur();
    if (h.type === 'coords') shell.onNavigate({ view: 'lab', ra: h.ra, dec: h.dec });
    else if (h.type === 'body') shell.onNavigate({ view: 'lab', body: h.name });
    else shell.onNavigate({ view: 'lab', target: h.id });
  };
  sug.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) pick(items[+b.dataset.i]);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && items[0]) pick(items[0]);
    if (e.key === 'Escape') sug.hidden = true;
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.top-search')) sug.hidden = true;
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.matches('input, textarea')) {
      e.preventDefault();
      input.focus();
    }
  });
  return shell;
}

const ABOUT = `
<article class="about">
  <div class="label">About Skyblink</div>
  <h1>A blink comparator for the whole infrared sky</h1>
  <p class="lede">In 1930 Clyde Tombaugh found Pluto, the original “Planet X”, by flipping back and forth between two photographs of the same stars taken days apart. Anything that jumped was a candidate. Skyblink brings that method to NASA’s SPHEREx mission, which has photographed the entire sky in 102 infrared colors every six months since May 2025.</p>

  <h2>How to use it</h2>
  <ol>
    <li><b>Pick a spot.</b> Click anywhere on the sky map, search a name or coordinates (press <span class="kbd">/</span>), or open a story.</li>
    <li><b>Skyblink finds every SPHEREx visit</b> to that spot in its index of 92,069 pointings, then streams just the pixels it needs from NASA’s archive and aligns them north-up.</li>
    <li><b>Look for change.</b> <i>Blink</i> flips through dates. <i>Compare</i> puts two dates side by side (Flip, Swipe, or Difference, where anything that changed lights up orange or blue). <i>Trails</i> paints each date in its own color: still stars stay white, movers leave a rainbow. <i>Grid</i> shows every frame at once.</li>
    <li><b>Hunt.</b> “Find movers” searches the frames for objects moving in a straight line. “Known asteroids” asks the IMCCE SkyBoT service what was there. Shift-click an object in two frames to measure its speed.</li>
  </ol>

  <h2>Where the data comes from</h2>
  <ul>
    <li><b>Images:</b> SPHEREx Level 2 calibrated spectral images (Quick Release 2 and 3, pipeline versions 6.4 to 7.0) from NASA/IPAC Infrared Science Archive (IRSA), read live from the public AWS bucket <span class="mono">nasa-irsa-spherex</span>. Nothing is resampled or retouched beyond aligning frames and masking pixels the SPHEREx pipeline flags as bad.</li>
    <li><b>Pointing index:</b> built by <span class="mono">pipeline/build_index.py</span> from the FITS header of one detector-1 file per pointing (sky position, roll and mid-exposure time). Detector 2 and 3 offsets and the sub-exposure step are measured from real headers.</li>
    <li><b>Wavelengths:</b> each frame’s wavelength comes from the file’s own WCS-WAVE table. SPHEREx uses linear variable filters, so a star’s wavelength depends on where it lands on the detector; brightness changes between frames are often color, not variability.</li>
    <li><b>Planets, Pluto and Jupiter’s moons:</b> Astronomy Engine (VSOP87 and JPL-fitted models). <b>Star positions and proper motions:</b> SIMBAD and Gaia catalog values. <b>Background stars and constellations:</b> the Hipparcos catalog via d3-celestial.</li>
    <li><b>Known asteroids:</b> SkyBoT, IMCCE / Paris Observatory, queried live.</li>
  </ul>

  <h2>Good to know</h2>
  <ul>
    <li>Each frame is 2 minutes of exposure. SPHEREx pixels are 6.15″, so a star needs to move about 6″ to shift one pixel: Barnard’s Star does that in about seven months.</li>
    <li>Asteroids move several pixels per hour. Their best chance is a survey pass where SPHEREx revisited the field hours apart.</li>
    <li>Very bright objects (planets, bright stars) saturate and bloom. That is the detector, not the sky.</li>
  </ul>

  <h2>Credits</h2>
  <p>SPHEREx is a NASA mission led by Caltech, managed by JPL; data courtesy NASA/JPL-Caltech/IPAC. Built for the NASA Space Apps Challenge “Planet X and SPHEREx”. Open source: see the repository for the full plan, the data pipeline, and tests.</p>
</article>`;
