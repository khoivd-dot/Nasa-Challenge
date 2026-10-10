# Skyblink: design

One concept runs through the whole site: the blink comparator Clyde Tombaugh used to find Pluto in 1930. The look is an observatory plate room crossed with a mission console, with real data as the ornament. A space-opera homage (an opening crawl and a jump to hyperspace) lives only on the About page, in our own words and art: no film logos, names, music or fonts.

The research behind these rules, with sources, is in the project files (`skyblink/DESIGN-RESEARCH.md`).

## Rules

- **Plates, not glass.** Panels are opaque (95%), with one 1px hairline, 2-3px corners and a faint film grain. Instrument panels get two amber corner brackets (`.panel`). No backdrop blur.
- **Keys, not pills.** Buttons are rectangular with a 2px radius and press in by 1px. The primary action is solid amber with dark text. No gradients on controls.
- **One signal color.** Sodium amber `#ffb23e` marks the primary action, the current page, selection and focus. The survey colors (Sky, Orchid, Fern) appear only where they encode data, and amber never does. The full palette, with the research behind it, is in [PALETTE.md](PALETTE.md).
- **Three voices.** Archivo for display (wide, `font-stretch: 110-125%`, weight 700-800) and controls; Atkinson Hyperlegible Next for reading; Overpass Mono only for real numbers and designations (dates, counts, µm, file names).
- **Plain captions.** Labels are sentence case in the UI voice. No tracked all-caps eyebrows, no "A · B" meta strings, no trailing arrows, no emoji or sparkle icons.
- **Consoles, not cards.** The sky map and the Blink Lab dock their panels to the edges (stories on the left, view controls along the top, the time machine along the bottom) around a framed viewport: amber corner brackets, centre marks and tick scales (`.reg-frame`). The globe wears a graduated bezel with N, E, S, W and a pointer to where SPHEREx is looking. The one number that matters on each screen, the date, sits in a lit display window (`.dsky`) over its own unlit segments. On first load the panels unroll and one scan line crosses the frame.
- **Asymmetry.** Section headers are left-anchored with a large outlined number; alternate sections lean right. Stories are a numbered ledger, not a stack of cards.
- **Paper on ink.** Text is off-white `#ebe6d9` on ink `#08090b`; the dimmest text color still passes 4.5:1. Control borders pass 3:1.
- **Motion that means something.** The blink (the wordmark and "change" jump between two positions), scans, the crawl and the hyperspace jump. Everything that moves on its own has a pause or stops under `prefers-reduced-motion`.

## Tokens

All in `web/src/styles/base.css`. The palette families (`--night-0..4`, `--rule-1..3`, `--plate-1..3`, `--sodium*`, `--halpha*`, `--survey-0..3`, the ramps and the About colors) are listed in [PALETTE.md](PALETTE.md); `web/src/ui/palette.js` mirrors them for canvas code. Components use role tokens that point at the families: `--bg`, `--well`, `--panel`, `--raised`, `--hover`, `--panel-border`, `--line-2`, `--line-3`, `--text`, `--text-2`, `--text-3`, `--accent`, `--accent-hi`, `--on-accent`, `--danger`, `--display`. Type: `--font-display`, `--font-ui`, `--font-body`, `--font-mono`; texture: `--grain`.
