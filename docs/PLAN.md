# Skyblink: plan

NASA Space Apps Challenge, **Planet X and SPHEREx**: build a public web tool that shows SPHEREx sky images and makes it easy for anyone to see how the sky changes over time.

## Idea

In 1930 Clyde Tombaugh found Pluto, the original "Planet X", with a **blink comparator**: flip quickly between two photographs of the same stars taken days apart, and anything that moved jumps. Skyblink is a blink comparator for the whole SPHEREx sky, in the browser, on real data:

1. **Sky map (time machine).** A WebGL globe and full-sky map of all 92,069 SPHEREx pointings (April 2025 to August 2026). Scrub or play time to watch SPHEREx paint the sky in great circles, survey after survey. Hover shows how many times any spot was imaged. Click anywhere to open it in the Lab.
2. **Blink Lab.** For any spot (or a moving body), find every SPHEREx visit, stream only the needed pixels from NASA's archive, align them north-up, and compare:
   - **Blink**: flip through dates.
   - **Compare**: Flip, Swipe, or Difference between two dates.
   - **Trails**: each date gets a color; still stars stay white, movers leave a rainbow.
   - **Grid**: every frame side by side.
   - **Find movers**: automatic straight-line motion search.
   - **Known asteroids**: IMCCE SkyBoT lookup.
   - **Measure**: Shift-click an object in two frames to get its speed.
3. **Stories.** Guided starts that are verified to show real change: Pluto crawling across fixed stars, Neptune, Uranus, Barnard's Star's proper motion, the Luhman 16 brown dwarfs, the north ecliptic pole deep field, and Orion in infrared.
4. **From Earth.** The same map as the night sky seen from where you stand: pick a city (guessed from the browser's time zone, no permission needed) or use the device location, then drag through the night on a slider shaded by the Sun's altitude. Shows the horizon, compass points, twilight or daylight, the Sun, the Moon with its phase, the planets and Pluto, and SPHEREx coverage up to that date. Tap a planet to follow it in the Lab. Link: `#/earth`.

## Data strategy (verified in this session)

| Need | Source | Notes |
|---|---|---|
| Pixels | `nasa-irsa-spherex` AWS S3 bucket (NASA/IPAC IRSA), QR2 + QR3 Level 2 images | Sends `Access-Control-Allow-Origin: *` and allows `Range`, so browsers read headers and only the rows they need (~1–3 MB per frame instead of ~70 MB). |
| Which files cover a spot | Our own pointing index, `web/public/data/pointings.{json,bin}` (2.3 MB) | IRSA TAP/SIA have no CORS. `pipeline/build_index.py` reads one ~20 KB header per pointing straight from S3. |
| Detector layout | Measured from real headers | D2 and D3 sit at fixed offsets in D1 pixels; sub-exposures step +115 px. |
| Wavelength per frame | Each file's WCS-WAVE table | The table grid differs per detector (9×9 up to 13×20). |
| Planets, Pluto, Jupiter's moons | Astronomy Engine | Checked against the frames: Pluto, Neptune and Uranus land within about 1 px of the prediction. |
| Background stars | Hipparcos via d3-celestial | |
| Known asteroids | IMCCE SkyBoT (CORS-enabled), queried live | |

Formats we handle in the browser:
- FITS headers.
- Big-endian float32 and int32 data.
- TAN-SIP WCS, both directions.
- Rice-compressed QR3 FLAGS rows.
- WCS-WAVE tables.

Unit tests compare these against astropy on real SPHEREx data.

## Architecture

```
pipeline/build_index.py      S3 headers -> pointing index (stdlib only; incremental)
pipeline/build_sky_assets.mjs Hipparcos stars, constellations, Milky Way -> compact JSON
web/ (Vite, vanilla JS)
  src/fits/      range reader, FITS header, TAN-SIP WCS, Rice, SPHEREx file
  src/data/      pointing index, sky math, survey calendar, named targets
  src/lab/       cutouts + reprojection, render pipelines, mover finder, ephemerides, stories, Lab UI
  src/sky/       WebGL sky map, time machine, From Earth view (ground.js: horizon frame, Sun/Moon/planets, local time)
  tests/         engine tests against astropy fixtures
.github/workflows/deploy.yml  build + test + deploy to GitHub Pages; weekly index refresh
```

## Workflow (agent team, kept lean)

- **Lead (this thread).** Did the data research and the FITS engine. Built the index, Lab, stories and shell. Integrated, verified and shipped.
- **Research agent.** Covered IRSA services, CORS, file formats and the moving-object literature. It returned one compact report.
- **Sky-map agent.** Built the WebGL globe and time machine in parallel against a fixed API (`mountSkyView`).

Token savers:
- Headers are read instead of whole files.
- Real data is checked with small numeric probes and contact sheets, not by eye on full images.
- Agents get exact interfaces so their work integrates without rework.

## Milestones

1. Data access proven: CORS and Range on S3, header layout, QR2 versus QR3 differences.
2. Full pointing index built (92,069 pointings).
3. Browser FITS engine verified against astropy.
4. Lab working on live data. Stories verified to show motion.
5. Sky map integrated.
6. Pages deploy and PR.

## Next steps

- When IRSA's Data Release 1 lands, add it as another release prefix in `build_index.py`.
- Pre-render thumbnails for stories so first paint is instant.
- Optional HiPS background (CDS SPHEREx color HiPS) behind the coverage map.
- Crowd "flag a mover" reports exported as MPC-style text.
