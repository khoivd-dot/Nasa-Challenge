# Working prompt (compact)

Use this to resume or extend the project with an AI agent.

> You are building **Skyblink**, a public web tool for the NASA Space Apps challenge "Planet X and SPHEREx". It shows real SPHEREx sky images and makes changes over time obvious to anyone.
>
> **Rules**
> - Real data only. Never synthesize imagery.
> - Images come from the `nasa-irsa-spherex` S3 bucket: CORS `*`, Range allowed.
> - Discover files with the pointing index (`web/public/data/pointings.*`, built by `pipeline/build_index.py` from FITS headers). IRSA TAP/SIA have no CORS, so the browser cannot query them.
>
> **File facts**
> - Level 2 MEF HDUs: PRIMARY, IMAGE (MJy/sr, 2040² float32 big-endian), FLAGS (int32 in QR2, RICE_1 per-row tiles in QR3), VARIANCE, ZODI, PSF/EPSF, and WCS-WAVE (last HDU; grid size varies per detector).
> - WCS is RA/DEC TAN-SIP with AP/BP inverse terms. Pixel scale is 6.15″.
> - Detectors: D1 0.75–1.1, D2 1.1–1.65, D3 1.6–2.4, D4 2.4–3.8, D5 3.8–4.4, D6 4.4–5.0 µm.
> - D4–D6 see the same sky as D1–D3.
> - D2 and D3 centers sit at (3282.7, 1055.2) and (5569.1, 1156.7) in D1 pixels.
> - Sub-exposures 1–4 step (+2.5, +115.2) px, about 2.15 min apart.
> - Mask flag bits 6, 9, 10 and 11 always. Mask bits 0, 1, 2, 17, 25, 26 and 27 only when bit 21 (known source) is not set; otherwise bright stars get holes.
> - About 7% of D2/D3 sub-exposure files are missing. Fall back to another sub-exposure.
>
> **Cadence**
> - Each spot is visited about 18 times per 6-month pass over 2–3 weeks, often 1.6–5 h apart.
> - The ecliptic poles are visited thousands of times.
> - SPHEREx looks about 90° from the Sun, so outer planets are near their stationary points. Use "fix stars" plus a 20′ field to show their motion within a pass.
>
> **UX bar**: smooth, beautiful, highly interactive.
> - Dark glass UI.
> - Keyboard shortcuts.
> - Progressive loading with a live MB counter.
> - Every claim in the UI must match the data (counts come from the index).
>
> **Workflow**
> - Plan, then build in parallel with narrowly scoped agents that get exact interfaces.
> - Verify every engine change against astropy (`npm test`) and every UI change with a Playwright screenshot.
> - Keep diffs small. Commit on the feature branch and open a PR.
