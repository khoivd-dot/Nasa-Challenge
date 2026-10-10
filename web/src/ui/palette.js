// The Skyblink palette: "an observatory at night". Canvas and WebGL code take
// colors from here; base.css carries the same values as custom properties
// (tests/palette.test.mjs checks the two agree and that text stays legible).
// The research behind every value is in docs/PALETTE.md.

/** Night: surfaces, darkest first (image well, page, panel, popover, hover). */
export const NIGHT = ['#040506', '#08090b', '#121418', '#191c21', '#212429'];
/** Rules: decorative hairline, divider, control border (3:1 on panels). */
export const RULE = ['#2a2e34', '#3e4349', '#6f757d'];
/** Plate: text, like a paper print of a glass plate (body, secondary, metadata). */
export const PLATE = ['#ebe6d9', '#bbb7ab', '#9b988d'];
/** Sodium: the one signal color, after Flagstaff's low-pressure sodium lights. */
export const SODIUM = { base: '#ffb23e', hi: '#ffc670', line: '#966626', tint: '#34220b', ink: '#160f02' };
/** Hydrogen-alpha: danger and alerts, always with a word or an icon. */
export const HALPHA = { base: '#f36358', tint: '#3f1916' };

/** Survey passes in time order: commissioning, then surveys 1-3. Data only. */
export const SURVEY = ['#7d8189', '#83d7ff', '#d470b5', '#49af7e'];
export const SURVEY_NAMES = ['Commissioning', 'Sky', 'Orchid', 'Fern'];

/** Coverage: visits per spot on a log scale, cool ink to warm paper. */
export const COVERAGE = ['#273444', '#40525a', '#5f7070', '#818e89', '#a5ada5', '#cbcec2', '#f4eee0'];

/** Infrared spectrum stand-ins: short wavelengths blue, long ones red. */
export const SPECTRUM = [
  [0.75, '#a8d2ff'],
  [1.1, '#6cd2e9'],
  [1.6, '#5ccbb0'],
  [2.4, '#7fb673'],
  [3.5, '#8f914e'],
  [5.0, '#ae593a'],
];

/** Star colors from blackbody temperature (D65 white), O5 to M5. */
export const STARS = [
  [42000, '#9eb8ff', 'O5'],
  [30000, '#a2bbff', 'B0'],
  [15200, '#b3c7ff', 'B5'],
  [9600, '#d0dbff', 'A0'],
  [8200, '#e0e6ff', 'A5'],
  [7200, '#f0f0ff', 'F0'],
  [6500, '#fff9fe', 'F5'],
  [5800, '#fff1ea', 'G2'],
  [5300, '#ffead9', 'K0'],
  [4400, '#ffddb9', 'K5'],
  [3850, '#ffd19e', 'M0'],
  [3170, '#ffbb71', 'M5'],
];

/** Comet ice: known asteroids and comets on images, and hyperspace streaks. */
export const ICE = '#bed1f9';
/** Sun path: the ecliptic line, a pale gold kept clear of the sodium signal. */
export const SUNPATH = '#d9cf96';
/** About page only: the title crawl. */
export const ABOUT = { crawl: '#f2d76c', streak: ICE };

/** Marks drawn over images and the sky, by what they point at. */
export const MARKS = {
  target: SODIUM.base, // what you are following
  targetLabel: SODIUM.hi,
  moon: PLATE[1],
  known: ICE, // asteroids and comets from SkyBoT
  mover: HALPHA.base, // something the search found moving
  probe: SODIUM.hi, // spectrum aperture
  measure: SODIUM.base,
  grid: PLATE[0],
  halo: NIGHT[0],
};

// ------------------------------------------------------------- helpers --

/** '#rrggbb' -> [r, g, b] in 0..255. */
export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
/** CSS rgba() string for a palette hex and an alpha. */
export const alpha = (hex, a) => `rgba(${hexRgb(hex).join(', ')}, ${a})`;

const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** sRGB hex -> OKLab [L, a, b] (Ottosson 2020). */
export function oklab(hex) {
  const [r, g, b] = hexRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
/** OKLab -> sRGB hex, clipped to the gamut. */
export function oklabHex([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return rgbHex([
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

/** Blend two hexes in OKLCH (shorter way round the hue circle). */
export function mixOklch(h1, h2, t) {
  const [L1, a1, b1] = oklab(h1);
  const [L2, a2, b2] = oklab(h2);
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const H1 = Math.atan2(b1, a1);
  let dH = Math.atan2(b2, a2) - H1;
  if (dH > Math.PI) dH -= 2 * Math.PI;
  if (dH < -Math.PI) dH += 2 * Math.PI;
  const C = C1 + (C2 - C1) * t;
  const H = H1 + dH * t;
  return oklabHex([L1 + (L2 - L1) * t, C * Math.cos(H), C * Math.sin(H)]);
}

/** Stand-in color for an infrared wavelength in micrometers. */
export function spectrumHex(um) {
  const x = Math.log(Math.max(SPECTRUM[0][0], Math.min(SPECTRUM.at(-1)[0], um)));
  for (let i = 1; i < SPECTRUM.length; i++) {
    const [u0, c0] = SPECTRUM[i - 1];
    const [u1, c1] = SPECTRUM[i];
    if (x <= Math.log(u1)) return mixOklch(c0, c1, (x - Math.log(u0)) / (Math.log(u1) - Math.log(u0)));
  }
  return SPECTRUM.at(-1)[1];
}

/** Coverage color at f in 0..1 (log visits, already normalized). */
export function coverageHex(f) {
  const x = Math.max(0, Math.min(1, f)) * (COVERAGE.length - 1);
  const i = Math.min(COVERAGE.length - 2, Math.floor(x));
  return mixOklch(COVERAGE[i], COVERAGE[i + 1], x - i);
}

/** Star color for a B-V index: temperature (Ballesteros 2012), then the STARS table. */
export function starHex(bv) {
  const x = Math.max(-0.4, Math.min(2.0, Number.isFinite(bv) ? bv : 0.6));
  const T = 4600 * (1 / (0.92 * x + 1.7) + 1 / (0.92 * x + 0.62));
  if (T >= STARS[0][0]) return STARS[0][1];
  for (let i = 1; i < STARS.length; i++) {
    const [T0, c0] = STARS[i - 1];
    const [T1, c1] = STARS[i];
    if (T >= T1) return mixOklch(c0, c1, Math.log(T0 / T) / Math.log(T0 / T1));
  }
  return STARS.at(-1)[1];
}

/** WCAG 2.x contrast ratio between two hexes. */
export function contrast(h1, h2) {
  const Y = (h) => {
    const [r, g, b] = hexRgb(h).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [Y(h1), Y(h2)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
}
