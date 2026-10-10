// The About page: an opening crawl over the real night sky, a jump to
// hyperspace, then the story told through things to play with: a blink
// comparator game, SPHEREx painting the sky pointing by pointing, and its
// 102 colors. Mounted the first time someone opens About.

import '../styles/about.css';
import { createAboutSky } from './about-sky.js';
import { mountHunt } from './about-hunt.js';
import { mountPaint } from './about-paint.js';
import { spectrumHex } from './palette.js';

// SPHEREx's six bands, each split into 17 colors (micrometers).
const BANDS = [
  [0.75, 1.09],
  [1.1, 1.62],
  [1.63, 2.41],
  [2.42, 3.82],
  [3.83, 4.41],
  [4.42, 5.0],
];
const FEATURES = [
  { um: 0.85, title: 'Just past red', text: 'The shortest SPHEREx colors, just beyond what eyes can see. Measuring hundreds of millions of galaxies in every color, from here to 5 µm, maps how the universe began.' },
  { um: 1.65, title: 'Starlight peak', text: 'Ordinary cool stars shine brightest near here, so this is where whole galaxies glow.' },
  { um: 1.87, title: 'Hydrogen glow', text: 'Paschen alpha: hydrogen gas lit up by newborn stars.' },
  { um: 2.3, title: 'Methane ice on Pluto', text: 'Frozen methane swallows this color, so Pluto dims here.', href: '#/lab?story=pluto-ice', cta: 'Measure it' },
  { um: 3.05, title: 'Water ice', text: 'Water frozen onto dust in cold clouds where planets will form. Mapping it is one of SPHEREx’s main jobs.' },
  { um: 3.3, title: 'Carbon soot', text: 'PAHs: sooty carbon molecules glowing near young stars.' },
  { um: 4.27, title: 'Dry ice', text: 'Carbon dioxide ice on dust grains between the stars.' },
  { um: 4.67, title: 'Carbon monoxide ice', text: 'It freezes only in the coldest, darkest clouds.' },
];
const CHANNELS = BANDS.flatMap(([lo, hi], b) => Array.from({ length: 17 }, (_, k) => ({ band: b + 1, um: lo * (hi / lo) ** ((k + 0.5) / 17) })));
const spanLog = Math.log(5 / 0.75);
const pos = (um) => Math.log(um / 0.75) / spanLog;
// False color: shortest infrared drawn violet, longest red.

const HOW = [
  { n: '01', title: 'Pick a spot', text: 'Click anywhere on the sky map, search a name or coordinates (press <span class="kbd">/</span>), or open a story.', href: '#/sky', cta: 'Open the sky map' },
  { n: '02', title: 'Skyblink finds every visit', text: 'It looks up that spot in the index of <span data-index-count>every SPHEREx pointing</span>, streams just the pixels it needs from NASA’s archive, and lines them up north-up.' },
  { n: '03', title: 'Look for change', text: '<i>Blink</i> flips through dates. <i>Compare</i> puts two side by side. <i>Trails</i> paints each date its own color, so movers leave a rainbow. <i>Grid</i> shows every frame.', href: '#/lab?story=pluto', cta: 'Catch Pluto moving' },
  { n: '04', title: 'Look up from home', text: 'Switch the sky map to <i>From Earth</i> to see the sky over your city at any hour, with the Moon, the planets and where SPHEREx has looked.', href: '#/earth', cta: 'See tonight’s sky' },
  { n: '05', title: 'Hunt', text: '“Find movers” searches the frames for anything moving in a straight line. “Known asteroids” asks the IMCCE SkyBoT service what was there. Shift-click an object in two frames to clock its speed.' },
];

const HTML = `
  <canvas class="ab-sky" aria-hidden="true"></canvas>
  <div class="ab-flash" aria-hidden="true"></div>
  <div class="ab-progress" aria-hidden="true"><i></i></div>
  <div class="ab-scroll">
    <section class="ab-stage play" aria-label="Opening story">
      <p class="ab-intro" aria-hidden="true">Not so long ago, on a cold hilltop in Flagstaff, Arizona…</p>
      <div class="ab-logo" aria-hidden="true"><span>Sky</span><span>blink</span></div>
      <div class="ab-crawl">
        <div class="ab-crawl-text">
          <p class="ab-chapter">Chapter 1930</p>
          <h1 class="ab-crawl-title">The hunt for Planet X</h1>
          <p>Something seems to tug on the outer planets. Astronomers suspect an unseen world beyond Neptune, and Percival Lowell names it PLANET X.</p>
          <p>At Lowell Observatory, a young farm boy from Kansas named CLYDE TOMBAUGH photographs the same stars nights apart, then flips between the two glass plates in a BLINK COMPARATOR, hour after hour.</p>
          <p>On 18 February 1930, in a sea of stars that hold perfectly still, one faint dot jumps. PLUTO is found.</p>
          <p>Ninety-five years later, NASA’s SPHEREx telescope photographs the entire sky in 102 infrared colors, and does it again every six months.</p>
          <p>Now the blink comparator belongs to everyone. Flip between SPHEREx’s dates, watch what moves, and join the hunt.</p>
        </div>
      </div>
      <div class="ab-end">
        <h2>Your turn to blink.</h2>
        <p class="ab-lede">Everything below runs on real NASA data. No telescope needed.</p>
        <div class="ab-end-row">
          <button class="btn primary ab-jump" type="button">Jump in</button>
          <button class="btn ab-replay" type="button">Replay the opening</button>
        </div>
      </div>
      <div class="ab-ctl">
        <button class="btn ab-pause" type="button" aria-pressed="false">Pause</button>
        <button class="btn ab-skip" type="button">Skip intro</button>
      </div>
    </section>

    <section class="ab-sec ab-hunt-sec" id="ab-hunt">
      <header class="ab-head rv">
        <span class="ab-num">01</span>
        <div>
          <h2>Be Tombaugh for a minute</h2>
          <p>Two maps of the same patch of sky, days apart. The stars are the real ones, and the planet sits exactly where it was on each date. Blink between them and tap the dot that jumps.</p>
        </div>
      </header>
      <div class="hunt panel rv"></div>
    </section>

    <section class="ab-sec ab-paint-sec">
      <header class="ab-head rv">
        <span class="ab-num">02</span>
        <div>
          <h2>Watch SPHEREx paint the sky</h2>
          <p>Every dot is one real SPHEREx pointing, replayed in the order it was taken. SPHEREx circles Earth over the poles about 14 and a half times a day, photographing a ring of sky each time. As Earth travels around the Sun the ring turns, and the whole sky fills in every six months.</p>
        </div>
      </header>
      <div class="paint panel rv"><p class="muted">Loading the SPHEREx pointing index…</p></div>
      <div class="ab-facts rv">
        <div><b data-count="102">102</b><span>infrared colors</span></div>
        <div><b data-count="6">6</b><span>months per full sky</span></div>
        <div><b>14½</b><span>orbits a day</span></div>
        <div><b class="ab-npoint">–</b><span>pointings so far</span></div>
      </div>
    </section>

    <section class="ab-sec ab-spec-sec">
      <header class="ab-head rv">
        <span class="ab-num">03</span>
        <div>
          <h2>102 colors no eye can see</h2>
          <p>SPHEREx splits infrared light between 0.75 and 5 micrometers into 102 colors, each one a separate picture of the sky. Drag across them to see what each color gives away.</p>
        </div>
      </header>
      <div class="spec panel rv">
        <div class="spec-marks">${FEATURES.map((f) => `<span style="left:${(pos(f.um) * 100).toFixed(2)}%">${f.um}</span>`).join('')}</div>
        <div class="spec-bars">${CHANNELS.map((c, i) => `<i style="--i:${i};--c:${spectrumHex(c.um)}"></i>`).join('')}</div>
        <input class="spec-range" type="range" min="0" max="101" value="63" aria-label="Pick one of SPHEREx’s 102 colors" />
        <div class="spec-axis mono">${[0.75, 1, 2, 3, 4, 5].map((u) => `<span style="left:${(pos(u) * 100).toFixed(2)}%">${u}${u === 5 ? ' µm' : ''}</span>`).join('')}</div>
        <div class="spec-read" aria-live="polite"></div>
        <p class="spec-note muted">Colors here are stand-ins: all of this light is infrared, invisible to our eyes.</p>
      </div>
    </section>

    <section class="ab-sec ab-how-sec">
      <header class="ab-head rv">
        <span class="ab-num">04</span>
        <div>
          <h2>How to use Skyblink</h2>
        </div>
      </header>
      <ol class="how">
        ${HOW.map(
          (h) => `<li class="how-card panel rv">
            <span class="how-n">${h.n}</span>
            <h3>${h.title}</h3>
            <p>${h.text}</p>
            ${h.href ? `<a class="how-go" href="${h.href}">${h.cta}</a>` : ''}
          </li>`,
        ).join('')}
      </ol>
    </section>

    <section class="ab-sec ab-data-sec">
      <header class="ab-head rv">
        <span class="ab-num">05</span>
        <div>
          <h2>Where every pixel comes from</h2>
        </div>
      </header>
      <dl class="data rv">
        <div><dt>Images</dt><dd>SPHEREx Level 2 calibrated spectral images (Quick Release 2 and 3, pipeline versions 6.4 to 7.0) from NASA/IPAC Infrared Science Archive (IRSA), read live from the public AWS bucket <span class="mono">nasa-irsa-spherex</span>. Nothing is resampled or retouched beyond aligning frames and masking pixels the SPHEREx pipeline flags as bad.</dd></div>
        <div><dt>Pointing index</dt><dd>Built by <span class="mono">pipeline/build_index.py</span> from the FITS header of one detector-1 file per pointing (sky position, roll and mid-exposure time). Detector 2 and 3 offsets and the sub-exposure step are measured from real headers.</dd></div>
        <div><dt>Wavelengths</dt><dd>Each frame’s wavelength comes from the file’s own WCS-WAVE table. SPHEREx uses linear variable filters, so a star’s wavelength depends on where it lands on the detector; brightness changes between frames are often color, not variability.</dd></div>
        <div><dt>Planets and stars</dt><dd>Planets, Pluto and Jupiter’s moons: Astronomy Engine (VSOP87 and JPL-fitted models). Star positions and proper motions: SIMBAD and Gaia. Background stars and constellations: the Hipparcos catalog via d3-celestial.</dd></div>
        <div><dt>Known asteroids</dt><dd>SkyBoT, IMCCE / Paris Observatory, queried live.</dd></div>
      </dl>
      <div class="ab-notes rv">
        <p><b>Each frame is 2 minutes of exposure.</b> SPHEREx pixels are 6.15″, so a star needs to move about 6″ to shift one pixel: Barnard’s Star does that in about seven months.</p>
        <p><b>Asteroids move several pixels per hour.</b> Their best chance is a survey pass where SPHEREx revisited the field hours apart.</p>
        <p><b>Very bright objects saturate and bloom.</b> That is the detector, not the sky.</p>
      </div>
    </section>

    <footer class="ab-credits rv">
      <p>SPHEREx is a NASA mission led by Caltech and managed by JPL. Data courtesy NASA/JPL-Caltech/IPAC.</p>
      <p>Built for the NASA Space Apps Challenge “Planet X and SPHEREx”. Open source: the repository has the plan, the data pipeline and the tests.</p>
      <div class="ab-end-row">
        <a class="btn primary" href="#/sky">Open the sky map</a>
        <button class="btn ab-replay" type="button">Replay the opening</button>
      </div>
    </footer>
  </div>`;

export function mountAbout(root, { pointingsReady }) {
  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  root.classList.add('about-page');
  root.innerHTML = HTML;
  const $ = (s) => root.querySelector(s);
  const scroller = $('.ab-scroll');
  const stage = $('.ab-stage');
  const crawl = $('.ab-crawl-text');
  const pauseBtn = $('.ab-pause');
  const sky = createAboutSky($('.ab-sky'), { reduceMotion });
  let visible = false;
  let userPaused = false;

  const assets = (name) =>
    fetch(`${import.meta.env.BASE_URL}data/${name}`).then((r) => {
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      return r.json();
    });
  const starsReady = assets('stars.json').then((s) => (Array.isArray(s) ? s.filter((r) => Array.isArray(r) && r.length >= 3) : []));
  starsReady.then((s) => sky.setStars(s)).catch((e) => console.warn('[about] stars', e));

  // Opening crawl. CSS runs the timeline; these switch between playing,
  // paused and finished.
  function setPaused(p) {
    stage.classList.toggle('paused', p);
    pauseBtn.setAttribute('aria-pressed', String(p));
    pauseBtn.textContent = p ? 'Play' : 'Pause';
  }
  function finish() {
    stage.classList.remove('play');
    stage.classList.add('done');
    setPaused(false);
  }
  function replay() {
    scroller.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    if (reduceMotion) return;
    stage.classList.remove('play', 'done');
    void stage.offsetWidth;
    stage.classList.add('play');
    userPaused = false;
    setPaused(false);
  }
  crawl.addEventListener('animationend', finish);
  if (reduceMotion) finish();
  pauseBtn.addEventListener('click', () => {
    userPaused = !stage.classList.contains('paused');
    setPaused(userPaused);
  });
  $('.ab-skip').addEventListener('click', finish);
  root.querySelectorAll('.ab-replay').forEach((b) => b.addEventListener('click', replay));

  // Jump to hyperspace, then land on the game.
  $('.ab-jump').addEventListener('click', async () => {
    const target = $('#ab-hunt');
    if (reduceMotion) return target.scrollIntoView();
    root.classList.add('warping');
    await sky.warp();
    const flash = $('.ab-flash');
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
    scroller.scrollTop = target.offsetTop - 12;
    root.classList.remove('warping');
  });

  // Links out of About leave through hyperspace.
  root.addEventListener('click', async (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a || reduceMotion || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    root.classList.add('warping');
    await sky.warp();
    root.classList.remove('warping');
    location.hash = a.getAttribute('href');
  });

  // Scroll: progress line, a slow tilt of the star field, reveal-on-scroll.
  const bar = $('.ab-progress i');
  scroller.addEventListener(
    'scroll',
    () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      const f = max > 0 ? scroller.scrollTop / max : 0;
      bar.style.transform = `scaleX(${f})`;
      sky.setScroll(f);
    },
    { passive: true },
  );
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        reveal.unobserve(e.target);
      }
    },
    { root: scroller, threshold: 0.12 },
  );
  root.querySelectorAll('.rv').forEach((n) => (reduceMotion ? n.classList.add('in') : reveal.observe(n)));

  // Widgets start when they first come into view.
  let hunt = null;
  let paint = null;
  const lazy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        lazy.unobserve(e.target);
        if (e.target.classList.contains('hunt')) {
          starsReady.then((stars) => {
            hunt = mountHunt(e.target, { stars, reduceMotion });
            hunt.start();
          });
        } else if (e.target.classList.contains('paint')) {
          Promise.all([pointingsReady, starsReady])
            .then(([P, stars]) => {
              paint = mountPaint(e.target, { P, stars, reduceMotion });
              if (visible) paint.start();
            })
            .catch(() => (e.target.innerHTML = '<p class="muted">Could not load the SPHEREx pointing index.</p>'));
        }
      }
    },
    { root: scroller, rootMargin: '200px 0px' },
  );
  lazy.observe($('.hunt'));
  lazy.observe($('.paint'));

  pointingsReady
    .then((P) => {
      const n = P.count.toLocaleString('en-US');
      $('.ab-npoint').textContent = n;
      root.querySelectorAll('[data-index-count]').forEach((e) => (e.textContent = `${n} pointings`));
    })
    .catch(() => {});

  // 102 colors.
  const range = $('.spec-range');
  const bars = [...root.querySelectorAll('.spec-bars i')];
  const read = $('.spec-read');
  function pick(i) {
    const c = CHANNELS[i];
    bars.forEach((b, k) => b.classList.toggle('on', k === i));
    let best = null;
    for (const f of FEATURES) if (!best || Math.abs(f.um - c.um) < Math.abs(best.um - c.um)) best = f;
    const near = Math.abs(best.um - c.um) < 0.22;
    read.style.setProperty('--c', spectrumHex(c.um));
    read.innerHTML = `
      <div class="spec-um"><b class="mono">${c.um.toFixed(2)} µm</b><span>Band ${c.band} · color ${i + 1} of 102</span></div>
      <div class="spec-what">${
        near
          ? `<h3>${best.title}</h3><p>${best.text}${best.href ? ` <a href="${best.href}">${best.cta}</a>` : ''}</p>`
          : '<h3>In between</h3><p>No famous feature here, but this color is still a full picture of the sky. Keep dragging.</p>'
      }</div>`;
  }
  range.addEventListener('input', () => pick(+range.value));
  pick(+range.value);

  // Cards lean toward the pointer.
  if (window.matchMedia?.('(pointer: fine)').matches && !reduceMotion) {
    root.querySelectorAll('.how-card').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${(x * 8).toFixed(2)}deg`);
        card.style.setProperty('--mx', `${((x + 0.5) * 100).toFixed(1)}%`);
        card.style.setProperty('--my', `${((y + 0.5) * 100).toFixed(1)}%`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  return {
    show() {
      visible = true;
      sky.start();
      if (!userPaused) setPaused(false);
      paint?.resume();
    },
    hide() {
      visible = false;
      sky.stop();
      if (stage.classList.contains('play')) setPaused(true);
      paint?.pause();
      hunt?.pause();
    },
  };
}
