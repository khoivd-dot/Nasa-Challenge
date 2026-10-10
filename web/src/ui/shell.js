// App chrome: top bar, view switching, the stories panel over the sky map,
// and the About page.

import { STORIES } from '../lab/stories.js';
import { searchTargets } from '../data/targets.js';
import { parseCoords, formatRa, formatDec } from '../data/sky-math.js';
import { mjdToDate } from '../data/pointings.js';
import { esc } from './esc.js';

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
      <section class="view view-about" data-view="about" hidden></section>
    </main>`;

  const views = Object.fromEntries([...app.querySelectorAll('[data-view]')].map((v) => [v.dataset.view, v]));
  // Count and date range come from the loaded index, which the weekly deploy refreshes.
  let indexRange = 'Apr 2025 onward';
  const shell = {
    views,
    setIndex(P) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < P.count; i++) {
        const m = P.mjd(i);
        if (m < lo) lo = m;
        if (m > hi) hi = m;
      }
      const month = (mjd) => mjdToDate(mjd).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      indexRange = `${month(lo)} → ${month(hi)}`;
      app.querySelectorAll('[data-index-range]').forEach((e) => (e.textContent = indexRange));
      app.querySelectorAll('[data-index-count]').forEach((e) => (e.textContent = `${P.count.toLocaleString('en-US')} pointings`));
    },
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
          <div class="label">Real data · <span data-index-range>${indexRange}</span></div>
          <h1>Watch the infrared sky <em>change</em>.</h1>
          <p>NASA’s SPHEREx maps the whole sky every six months. Skyblink lines up its images so anyone can blink between dates, like the astronomer who found Pluto did, and spot what moves.</p>
          <p class="stories-hint">Click anywhere on the sky to open every SPHEREx image of that spot, or start with a story:</p>
        </div>
        <div class="stories-list">
          ${STORIES.map(
            (s, i) => `<button class="story${i === 0 ? ' first' : ''}" data-story="${s.id}" style="--accent:${s.accent}">
              ${i === 0 ? '<span class="story-start">Start here</span>' : ''}
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
      // Phones start with the panel open too: it is the only thing that says
      // what this is. "Hide" folds it to a small "Stories" button.
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
    sug.innerHTML = items.map((h, i) => `<button data-i="${i}"><b>${esc(h.name)}</b><span class="muted"> · ${esc(h.kind)}</span></button>`).join('');
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
