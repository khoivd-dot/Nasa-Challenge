import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles/base.css';
import './styles/shell.css';

import { loadPointings } from './data/pointings.js';
import { createShell } from './ui/shell.js';

const app = document.getElementById('app');
const shell = createShell(app);
const pointingsReady = loadPointings();
pointingsReady.then(
  (P) => shell.setIndex(P),
  (err) => {
    console.error(err);
    const note = document.createElement('div');
    note.className = 'load-error glass';
    note.setAttribute('role', 'alert');
    note.textContent = 'Could not load the index of SPHEREx pointings. Check your connection and reload the page.';
    document.body.append(note);
  },
);

let sky = null;
let lab = null;
let current = 'sky';

async function showSky() {
  current = 'sky';
  shell.setView('sky');
  if (!sky) {
    const { mountSkyView } = await import('./sky/sky-view.js');
    const pointings = await pointingsReady.catch(() => null);
    if (!pointings) return;
    sky = mountSkyView(shell.views.sky, {
      pointings,
      onPick: (ra, dec) => go({ view: 'lab', ra, dec }),
    });
    shell.mountStories(shell.views.sky, (story) => go({ view: 'lab', story: story.id }));
  }
  // The user may have moved on while the sky map was loading.
  if (current === 'sky') sky.resume?.();
  else sky.pause?.();
}

async function showLab(params) {
  current = 'lab';
  shell.setView('lab');
  sky?.pause?.();
  if (!lab) {
    const { mountLab } = await import('./lab/lab.js');
    lab = mountLab(shell.views.lab, { pointingsReady, onBack: () => go({ view: 'sky' }) });
  }
  lab.open(params).catch((err) => console.error('Could not open the Lab:', err));
}

function showAbout() {
  current = 'about';
  shell.setView('about');
  sky?.pause?.();
}

// Routes live in the hash so links are shareable: #/lab?ra=..&dec=.. or #/lab?story=pluto
function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const q = Object.fromEntries(new URLSearchParams(query));
  return { view: path || 'sky', ...q };
}

export function go(params) {
  const { view, ...rest } = params;
  const q = new URLSearchParams(
    Object.entries(rest)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(5) : v]),
  ).toString();
  location.hash = `#/${view}${q ? `?${q}` : ''}`;
}

function route() {
  const p = parseHash();
  if (p.view === 'lab') {
    const params = { ...p };
    if (p.ra !== undefined) params.ra = parseFloat(p.ra);
    if (p.dec !== undefined) params.dec = parseFloat(p.dec);
    showLab(params);
  } else if (p.view === 'about') showAbout();
  else showSky();
}

shell.onNavigate = go;
window.addEventListener('hashchange', route);
route();
