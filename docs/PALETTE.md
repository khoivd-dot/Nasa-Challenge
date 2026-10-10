# Skyblink palette: an observatory at night

Every color on the site comes from one palette, kept in two places that a test holds together: CSS custom properties in `web/src/styles/base.css` and constants in `web/src/ui/palette.js` (for canvas and WebGL). `web/tests/palette.test.mjs` checks the two agree, that text and controls pass WCAG contrast, and that the survey colors stay apart from each other and from the amber signal under protan, deutan and tritan simulation.

The research behind it, with sources and computed numbers, is in the project files (`skyblink/COLOR-RESEARCH.md`). Contrast below is WCAG 2.x against the page, `#08090b`.

## The story

An observatory at night is dark, lit by a few deliberate lights. Flagstaff, where Pluto was found, protects its sky with low-pressure sodium street lamps, and observers read charts by dim red light to keep their night vision. Glass plates were read as paper prints. So: a warm near-black for surfaces, paper for text, sodium amber as the one light that says "act here", and hydrogen-alpha red for alarms. Science colors (the survey passes, coverage, the spectrum, star colors) are a separate set that never borrows the amber.

Film interfaces are mostly blue, and cyan-to-violet is the stock "AI website" look. Leading with amber and paper is what sets Skyblink apart.

## Families

| Family | Token | Hex | Contrast | Used for |
|---|---|---|---|---|
| Night 0 | `--night-0` | `#040506` | | Image wells, display windows, the Lab stage |
| Night 1 | `--night-1` | `#08090b` | | The page |
| Night 2 | `--night-2` | `#121418` | | Panels (95% opaque) |
| Night 3 | `--night-3` | `#191c21` | | Popovers, pressed chips |
| Night 4 | `--night-4` | `#212429` | | Hover |
| Rule 1 | `--rule-1` | `#2a2e34` | 1.46 | Decorative hairlines |
| Rule 2 | `--rule-2` | `#3e4349` | 2.00 | Dividers, display-window edges |
| Rule 3 | `--rule-3` | `#6f757d` | 4.28 | Control borders (3.97 on panels), link underlines |
| Plate 1 | `--plate-1` | `#ebe6d9` | 15.99 | Body text, headings, links |
| Plate 2 | `--plate-2` | `#bbb7ab` | 9.94 | Secondary text |
| Plate 3 | `--plate-3` | `#9b988d` | 6.90 | Metadata and captions |
| Sodium | `--sodium` | `#ffb23e` | 11.09 | The primary action, current page, selection, focus, corner brackets, the date displays |
| Sodium hi | `--sodium-hi` | `#ffc670` | 12.87 | Hover on amber keys, labels of the target |
| Sodium line | `--sodium-line` | `#966626` | 4.01 | Quiet amber lines |
| Sodium tint | `--sodium-tint` | `#34220b` | | Selected rows ("Start here", the chosen pass) |
| Sodium ink | `--sodium-ink` | `#160f02` | | Text on amber keys |
| H-alpha | `--halpha` | `#f36358` | 6.39 | Danger and alerts, always with words; tracks of found movers |
| H-alpha tint | `--halpha-tint` | `#3f1916` | | Background of an error |

## Data colors

Data colors encode what SPHEREx measured. They never appear on buttons, and amber never appears in data.

| Name | Token | Hex | Contrast | Meaning |
|---|---|---|---|---|
| Commissioning | `--survey-0` | `#7d8189` | 5.1 | Test images before the survey began (Apr 2025) |
| Sky | `--survey-1` | `#83d7ff` | 12.45 | Survey 1 (May to Oct 2025) |
| Orchid | `--survey-2` | `#d470b5` | 6.44 | Survey 2 |
| Fern | `--survey-3` | `#49af7e` | 7.32 | Survey 3 |

The three survey colors follow the structure of the Okabe-Ito color-blind-safe set (light blue, reddish purple, bluish green), found again by searching OKLCH space with the amber and violet hues excluded. The old survey 3 (`#ffb347`) was indistinguishable from the amber signal; the test now fails if that happens again.

- **Coverage ramp** (`--ramp-coverage`, `COVERAGE`): visits per spot on a log scale, cool ink to warm paper: `#273444 #40525a #5f7070 #818e89 #a5ada5 #cbcec2 #f4eee0`. On the globe it is darkened toward the low end so the stars read first and only the deep fields, visited thousands of times, glow paper-white. Standard heat maps (afmhot, inferno) end in amber, so they were ruled out.
- **Spectrum ramp** (`--ramp-spectrum`, `spectrumHex()`): stand-ins for invisible infrared, short wavelengths blue and long ones red as in JWST and SPHEREx false color, blended in OKLCH along log wavelength: 0.75 µm `#a8d2ff`, 1.1 `#6cd2e9`, 1.6 `#5ccbb0`, 2.4 `#7fb673`, 3.5 `#8f914e`, 5.0 `#ae593a`.
- **Stars** (`starHex()`): blackbody colors with a D65 white, from O5 `#9eb8ff` through the Sun (G2) `#fff1ea` to M5 `#ffbb71`, reached from each star's B−V index through its temperature (Ballesteros 2012).
- **Sky lines**: the RA/Dec grid and constellations in paper at low opacity, the ecliptic in Sun path `#d9cf96`, the galactic plane in comet ice `#bed1f9`.
- **Marks on images** (`MARKS`): the object you follow in sodium, moons in paper, known asteroids and comets in comet ice, movers the search found in H-alpha, the spectrum probe and measurements in sodium.
- **Image colormaps** in the Lab (gray, infrared, ice) and the Trails time rainbow stay as they were: they encode pixel values and time, not the interface.

## About page only

- Crawl gold `#f2d76c` (`--about-crawl`): the opening crawl, our own color, clear of the amber.
- Comet ice `#bed1f9` (`--about-streak`): the hyperspace streaks and the outlined wordmark.

## Rules

1. One signal: amber means "this is the action, the selection, or where you are". A second accent would dilute it.
2. Survey hues only for data, amber only for the interface.
3. Selection is shown with brackets, rings and tints, not with fills, because red dwarfs and the Sun path come close to amber.
4. Text is paper, never pure white, and never below 4.5:1 on the page or a panel. Danger always comes with words or an icon.
5. Success is plain text with a check mark; links are paper with an underline that turns amber on hover. The old neon green and link blue are retired.
