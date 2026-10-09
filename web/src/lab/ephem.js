// Where solar-system bodies were when SPHEREx looked. Planet and Pluto positions
// come from Astronomy Engine (VSOP87 / NASA JPL-fitted models, arcsecond-level);
// stars with large proper motion are propagated from their catalog epoch.

import * as Astronomy from 'astronomy-engine';
import { mjdToDate } from '../data/pointings.js';
import { angularDistance } from '../data/sky-math.js';

export const PLANETS = ['Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

/** Geocentric astrometric J2000 RA/Dec (deg) of a body at an MJD (UTC). */
export function bodyRaDec(body, mjd) {
  const v = Astronomy.GeoVector(body, mjdToDate(mjd), true);
  const eq = Astronomy.EquatorFromVector(v);
  return [eq.ra * 15, eq.dec, eq.dist];
}

/** Fast position lookup for a body: tabulate, then interpolate linearly. */
export function bodyTrack(body, mjdStart, mjdEnd, step = 0.25) {
  const n = Math.ceil((mjdEnd - mjdStart) / step) + 2;
  const tab = new Float64Array(2 * n);
  for (let k = 0; k < n; k++) {
    const [ra, dec] = bodyRaDec(body, mjdStart + k * step);
    tab[2 * k] = ra;
    tab[2 * k + 1] = dec;
  }
  return (mjd) => {
    const u = (mjd - mjdStart) / step;
    const k = Math.floor(u);
    if (k < 0 || k >= n - 1) return bodyRaDec(body, mjd).slice(0, 2);
    const f = u - k;
    let ra0 = tab[2 * k];
    let ra1 = tab[2 * k + 2];
    if (ra1 - ra0 > 180) ra1 -= 360;
    if (ra0 - ra1 > 180) ra1 += 360;
    const ra = (((ra0 + f * (ra1 - ra0)) % 360) + 360) % 360;
    return [ra, tab[2 * k + 1] + f * (tab[2 * k + 3] - tab[2 * k + 1])];
  };
}

/** Proper-motion track for a star: pm in mas/yr (pmRA includes cos(dec)). */
export function starTrack({ ra, dec, pmRa = 0, pmDec = 0, epoch = 2000.0 }) {
  return (mjd) => {
    const years = (mjd - 51544.5) / 365.25 + 2000 - epoch;
    const d = dec + (pmDec * years) / 3.6e6;
    const r = ra + (pmRa * years) / 3.6e6 / Math.cos((dec * Math.PI) / 180);
    return [((r % 360) + 360) % 360, d];
  };
}

/** Planets inside a field of `radius` degrees around (ra, dec) at time mjd. */
export function planetsInField(ra, dec, mjd, radius) {
  const out = [];
  for (const body of PLANETS) {
    const [r, d] = bodyRaDec(body, mjd);
    if (angularDistance(ra, dec, r, d) < radius) out.push({ name: body, ra: r, dec: d });
  }
  return out;
}

/** Geocentric J2000 positions of Jupiter's four Galilean moons. */
export function jupiterMoons(mjd) {
  const date = mjdToDate(mjd);
  const jup = Astronomy.GeoVector('Jupiter', date, true);
  const moons = Astronomy.JupiterMoons(date);
  return [
    ['Io', moons.io],
    ['Europa', moons.europa],
    ['Ganymede', moons.ganymede],
    ['Callisto', moons.callisto],
  ].map(([name, s]) => {
    const v = new Astronomy.Vector(jup.x + s.x, jup.y + s.y, jup.z + s.z, jup.t);
    const eq = Astronomy.EquatorFromVector(v);
    return { name, ra: eq.ra * 15, dec: eq.dec };
  });
}

/** Apparent motion of a body in arcsec/hour around mjd. */
export function bodyRate(body, mjd) {
  const [r0, d0] = bodyRaDec(body, mjd - 0.5);
  const [r1, d1] = bodyRaDec(body, mjd + 0.5);
  return (angularDistance(r0, d0, r1, d1) * 3600) / 24;
}
