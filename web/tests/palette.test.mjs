// The palette: base.css and ui/palette.js agree, text and controls stay
// legible, and the survey colors stay apart from each other and from the
// amber signal for people with color-vision deficiencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NIGHT,
  RULE,
  PLATE,
  SODIUM,
  HALPHA,
  SURVEY,
  COVERAGE,
  SPECTRUM,
  ABOUT,
  contrast,
  oklab,
  hexRgb,
  rgbHex,
  spectrumHex,
  coverageHex,
  starHex,
} from '../src/ui/palette.js';

const css = readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8');
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\b`, 'i'));
  return m && m[1].toLowerCase();
};

test('base.css carries the same palette as palette.js', () => {
  const expect = {
    ...Object.fromEntries(NIGHT.map((c, i) => [`night-${i}`, c])),
    ...Object.fromEntries(RULE.map((c, i) => [`rule-${i + 1}`, c])),
    ...Object.fromEntries(PLATE.map((c, i) => [`plate-${i + 1}`, c])),
    ...Object.fromEntries(SURVEY.map((c, i) => [`survey-${i}`, c])),
    sodium: SODIUM.base,
    'sodium-hi': SODIUM.hi,
    'sodium-line': SODIUM.line,
    'sodium-tint': SODIUM.tint,
    'sodium-ink': SODIUM.ink,
    halpha: HALPHA.base,
    'halpha-tint': HALPHA.tint,
    'about-crawl': ABOUT.crawl,
    'about-streak': ABOUT.streak,
  };
  for (const [name, hex] of Object.entries(expect)) assert.equal(token(name), hex, `--${name}`);
  assert.ok(css.includes(`--ramp-coverage: linear-gradient(90deg, ${COVERAGE.join(', ')})`), 'coverage ramp');
  for (const [, hex] of SPECTRUM) assert.ok(css.includes(hex), `spectrum anchor ${hex}`);
});

test('text, controls and the signal pass WCAG contrast', () => {
  const [, page, panel] = NIGHT;
  for (const bg of [page, panel]) {
    for (const t of PLATE) assert.ok(contrast(t, bg) >= 4.5, `${t} on ${bg}`);
    assert.ok(contrast(HALPHA.base, bg) >= 4.5, `danger on ${bg}`);
    assert.ok(contrast(RULE[2], bg) >= 3, `control border on ${bg}`);
    assert.ok(contrast(SODIUM.base, bg) >= 3, `amber on ${bg}`);
    for (const s of SURVEY.slice(1)) assert.ok(contrast(s, bg) >= 3, `survey ${s} on ${bg}`);
  }
  assert.ok(contrast(SODIUM.ink, SODIUM.base) >= 7, 'text on amber keys');
  assert.ok(contrast(PLATE[0], SODIUM.tint) >= 7, 'text on selected rows');
  assert.ok(contrast(PLATE[0], HALPHA.tint) >= 7, 'text on danger tint');
});

// Machado, Oliveira & Fernandes (2009), full severity, applied in linear RGB.
const CVD = {
  normal: null,
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function simulate(hex, m) {
  if (!m) return hex;
  const c = hexRgb(hex).map(lin);
  return rgbHex(m.map((r) => gam(Math.max(0, Math.min(1, r[0] * c[0] + r[1] * c[1] + r[2] * c[2])))));
}
const dist = (a, b) => {
  const p = oklab(a);
  const q = oklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
// Smallest OKLab distance among the colors, and from each to amber, under every vision type.
function separation(colors) {
  let apart = Infinity;
  let fromAmber = Infinity;
  for (const m of Object.values(CVD)) {
    const c = colors.map((h) => simulate(h, m));
    const amber = simulate(SODIUM.base, m);
    for (let i = 0; i < c.length; i++) {
      fromAmber = Math.min(fromAmber, dist(c[i], amber));
      for (let j = i + 1; j < c.length; j++) apart = Math.min(apart, dist(c[i], c[j]));
    }
  }
  return { apart, fromAmber };
}

test('survey colors stay distinct, and clear of amber, for color-blind viewers', () => {
  const s = separation(SURVEY.slice(1));
  assert.ok(s.apart > 0.06, `surveys ${s.apart.toFixed(3)} apart`);
  assert.ok(s.fromAmber > 0.09, `surveys ${s.fromAmber.toFixed(3)} from amber`);
  // The old survey 3 was amber's twin: the check must catch that.
  assert.ok(separation(['#4cc9ff', '#c77dff', '#ffb347']).fromAmber < 0.02);
});

test('ramps run in order and star colors go from blue to orange', () => {
  const L = (h) => oklab(h)[0];
  for (let i = 1; i < COVERAGE.length; i++) assert.ok(L(COVERAGE[i]) > L(COVERAGE[i - 1]), 'coverage gets lighter');
  assert.equal(coverageHex(0), COVERAGE[0]);
  assert.equal(coverageHex(1), COVERAGE.at(-1));
  assert.equal(spectrumHex(0.75), SPECTRUM[0][1]);
  assert.equal(spectrumHex(5), SPECTRUM.at(-1)[1]);
  assert.match(spectrumHex(1.3), /^#[0-9a-f]{6}$/);
  const hot = hexRgb(starHex(-0.3));
  const cool = hexRgb(starHex(1.6));
  assert.ok(hot[2] > hot[0] && cool[0] > cool[2], 'blue-white hot stars, orange cool ones');
  assert.equal(starHex(0.65).length, 7);
});
