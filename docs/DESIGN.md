# Skyblink: design

One concept runs through the whole site: the blink comparator Clyde Tombaugh used to find Pluto in 1930. The look is an observatory plate room crossed with a mission console, with real data as the ornament. A space-opera homage (an opening crawl and a jump to hyperspace) lives only on the About page, in our own words and art: no film logos, names, music or fonts.

The research behind these rules, with sources, is in the project files (`skyblink/DESIGN-RESEARCH.md`).

## Rules

- **Plates, not glass.** Panels are opaque (95%), with one 1px hairline, 2-3px corners and a faint film grain. Instrument panels get two amber corner brackets (`.panel`). No backdrop blur.
- **Keys, not pills.** Buttons are rectangular with a 2px radius and press in by 1px. The primary action is solid amber with dark text. No gradients on controls.
- **One signal color.** Amber `#ffb23e` marks the primary action, the current page, selection and focus. Blue, violet and orange appear only where they encode data (survey passes 1-3).
- **Three voices.** Archivo for display (wide, `font-stretch: 110-125%`, weight 700-800) and controls; Atkinson Hyperlegible Next for reading; Overpass Mono only for real numbers and designations (dates, counts, µm, file names).
- **Plain captions.** Labels are sentence case in the UI voice. No tracked all-caps eyebrows, no "A · B" meta strings, no trailing arrows, no emoji or sparkle icons.
- **Asymmetry.** Section headers are left-anchored with a large outlined number; alternate sections lean right. Stories are a numbered ledger, not a stack of cards.
- **Paper on ink.** Text is off-white `#ebe6d9` on ink `#08090b`; the dimmest text color still passes 4.5:1. Control borders pass 3:1.
- **Motion that means something.** The blink (the wordmark and "change" jump between two positions), scans, the crawl and the hyperspace jump. Everything that moves on its own has a pause or stops under `prefers-reduced-motion`.

## Tokens

All in `web/src/styles/base.css`: `--bg`, `--panel`, `--panel-border`, `--panel-border-strong`, `--text`, `--text-2`, `--text-3`, `--accent` (amber), `--danger`, `--ok`, `--survey-1..3`, `--grain`, `--font-display`, `--font-ui`, `--font-body`, `--font-mono`. The About page adds `--crawl` (crawl yellow) and `--cool` in `about.css`.
