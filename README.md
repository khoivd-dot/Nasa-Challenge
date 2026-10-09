# Skyblink: watch the SPHEREx sky change

A public blink comparator for NASA's **SPHEREx** all-sky infrared survey, built for the NASA Space Apps Challenge **"Planet X and SPHEREx"**.

In 1930 Clyde Tombaugh found Pluto by flipping between two photos of the same stars taken days apart. Skyblink does the same for every SPHEREx image:

- Pick any spot on the sky, or a planet.
- Skyblink finds every time SPHEREx looked there and streams those real images from NASA's archive.
- It lines them up so you can blink, swipe, difference, and trace anything that moves.

**Everything is real data.** Pixels are read live from the NASA/IPAC IRSA SPHEREx archive on AWS (`nasa-irsa-spherex`, Quick Releases 2 and 3). The browser fetches only the header and the rows it needs, about 1–3 MB per frame instead of 70 MB.

## Features

- **Sky map time machine.** All 92,069 SPHEREx pointings from April 2025 to August 2026 on a WebGL globe or full-sky map.
  - Play time to watch SPHEREx sweep the sky every six months.
  - Hover to see how often a spot was imaged.
  - Click to open it.
- **Blink Lab.**
  - **Blink**, **Compare** (Flip / Swipe / Difference), **Trails** (color = time, so still stars stay white and movers leave rainbows) and **Grid**.
  - Pan and zoom, a cursor readout of RA/Dec and surface brightness, and the exact wavelength of every frame.
  - **Find movers**: an automatic straight-line motion search. It picks out Pluto in the autumn 2025 frames.
  - **Known asteroids**: an IMCCE SkyBoT lookup.
  - **Measure**: Shift-click an object in two frames to get its speed and a plain-language classification.
  - Planets, Pluto and Jupiter's moons are marked from Astronomy Engine ephemerides.
- **Stories**: Pluto (the original Planet X), Neptune, Uranus, Barnard's Star, the Luhman 16 brown dwarfs, the north ecliptic pole deep field, and Orion.
- Keyboard shortcuts:
  - <kbd>Space</kbd> plays or pauses.
  - <kbd>←</kbd> and <kbd>→</kbd> step through frames.
  - <kbd>B</kbd>, <kbd>C</kbd>, <kbd>T</kbd> and <kbd>G</kbd> switch modes.
  - <kbd>M</kbd> finds movers.
  - <kbd>/</kbd> searches.
- Shareable URLs: `#/lab?story=pluto`, `#/lab?ra=83.82&dec=-5.39`, `#/lab?body=Neptune`.

## Run locally

```bash
cd web
npm install
npm run dev      # http://localhost:5173
npm test         # FITS/WCS/Rice engine vs. astropy reference values from real SPHEREx data
npm run build    # static site in web/dist
```

Rebuild the data (optional; the committed index already covers April 2025 to August 2026):

```bash
python3 pipeline/build_index.py          # incremental: adds new SPHEREx weeks
python3 pipeline/build_index.py --full   # full rebuild, about 15 minutes, reads ~92k FITS headers
cd web && npm run assets                 # Hipparcos stars, constellations, Milky Way outline
```

## Deploy

`.github/workflows/deploy.yml` tests, builds and publishes `web/dist` to GitHub Pages:

- on every push to `main`;
- weekly, when it also adds newly released SPHEREx weeks to the index;
- on demand.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## How it works

See [docs/PLAN.md](docs/PLAN.md) for the plan, data strategy and architecture. See [docs/PROMPT.md](docs/PROMPT.md) for the compact working prompt.

## Credits

- SPHEREx data: NASA/JPL-Caltech/IPAC, via IRSA.
- Ephemerides: Astronomy Engine.
- Star catalog: Hipparcos, via d3-celestial.
- Known asteroids: IMCCE SkyBoT.
