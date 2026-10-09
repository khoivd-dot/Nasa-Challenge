// Turn raw index hits into a sensible set of frames to blink: one sub-exposure
// per pointing, grouped into survey passes, trimmed to a download budget.

import { SURVEY_START_MJD, SURVEY_PERIOD } from '../data/survey.js';

// Approximate wavelength range (microns) along each detector's y axis,
// measured from the WCS-WAVE tables: [at y = 1, at y = 2040].
export const DET_LAMBDA = {
  1: [1.126, 0.735],
  2: [1.65, 1.086],
  3: [2.419, 1.616],
  4: [3.818, 2.398],
  5: [4.418, 3.792],
  6: [4.999, 4.395],
};

export function estimateLambda(det, y) {
  const [a, b] = DET_LAMBDA[det];
  return a * (b / a) ** ((Math.min(2040, Math.max(1, y)) - 1) / 2039);
}

export function surveyNumber(mjd) {
  return mjd < SURVEY_START_MJD ? 0 : Math.floor((mjd - SURVEY_START_MJD) / SURVEY_PERIOD) + 1;
}

/**
 * @param hits  output of Pointings.findVisits
 * @param band  'sw' (detectors 1-3, 0.75-2.4 um) or 'lw' (4-6, 2.4-5.0 um)
 * @returns visits sorted by time: {i, det, sub, x, y, mjd, ra, dec, lambda}
 */
export function onePerPointing(hits, band = 'sw') {
  const best = new Map();
  for (const h of hits) {
    const cur = best.get(h.i);
    // Prefer the sub-exposure that puts the target nearest the detector middle.
    const score = Math.abs(h.y - 1020) + Math.abs(h.x - 1020) * 0.3;
    if (!cur || score < cur.score) best.set(h.i, { ...h, score });
  }
  return [...best.values()]
    .map((h) => {
      const det = band === 'lw' ? h.det + 3 : h.det;
      return { ...h, det, lambda: estimateLambda(det, h.y) };
    })
    .sort((a, b) => a.mjd - b.mjd);
}

/**
 * Split visits into passes wherever SPHEREx was away for more than `gap` days,
 * or a new six-month survey began (spots near the ecliptic poles are seen
 * every day, so gaps alone never split them).
 */
export function groupPasses(visits, gap = 12) {
  const passes = [];
  for (const v of visits) {
    const last = passes.at(-1);
    const s = surveyNumber(v.mjd);
    if (!last || v.mjd - last.visits.at(-1).mjd > gap || s !== last.survey) passes.push({ survey: s, visits: [v] });
    else last.visits.push(v);
  }
  return passes.map((p, k) => ({
    id: k,
    visits: p.visits,
    start: p.visits[0].mjd,
    end: p.visits.at(-1).mjd,
    survey: p.survey,
  }));
}

/**
 * Pick at most `budget` visits, keeping every pass represented and keeping
 * tight clusters (visits hours apart), which is where moving objects show up.
 */
export function pickFrames(passes, budget = 24) {
  const all = passes.flatMap((p) => p.visits);
  if (all.length <= budget) return all;
  const share = Math.max(2, Math.floor(budget / passes.length));
  const out = [];
  for (const p of passes) {
    const v = p.visits;
    if (v.length <= share) {
      out.push(...v);
      continue;
    }
    // Densest window of `share` consecutive visits, then fill evenly.
    let bestK = 0;
    let bestSpan = Infinity;
    const run = Math.min(share, Math.max(3, Math.ceil(share / 2)));
    for (let k = 0; k + run <= v.length; k++) {
      const span = v[k + run - 1].mjd - v[k].mjd;
      if (span < bestSpan) {
        bestSpan = span;
        bestK = k;
      }
    }
    const chosen = new Set(v.slice(bestK, bestK + run));
    const rest = share - run;
    for (let j = 0; j < rest; j++) chosen.add(v[Math.round((j * (v.length - 1)) / Math.max(1, rest - 1))]);
    out.push(...[...chosen]);
  }
  return out.sort((a, b) => a.mjd - b.mjd).slice(0, budget * 2);
}
