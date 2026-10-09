// Small spherical-astronomy helpers shared by the sky map and the Blink Lab.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function radecToVec(ra, dec) {
  const a = ra * DEG;
  const d = dec * DEG;
  const c = Math.cos(d);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)];
}

export function vecToRadec(x, y, z) {
  const r = Math.hypot(x, y, z);
  let ra = Math.atan2(y, x) * RAD;
  if (ra < 0) ra += 360;
  return [ra, Math.asin(z / r) * RAD];
}

export function angularDistance(ra1, dec1, ra2, dec2) {
  const a = radecToVec(ra1, dec1);
  const b = radecToVec(ra2, dec2);
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
  return Math.atan2(cross, dot) * RAD;
}

/** Gnomonic projection about (ra0, dec0); returns [xi, eta] in degrees, or null behind. */
export function tanProject(ra0, dec0, ra, dec) {
  const d0 = dec0 * DEG;
  const d = dec * DEG;
  const dr = (ra - ra0) * DEG;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(dr);
  if (cosc <= 1e-6) return null;
  const xi = (Math.cos(d) * Math.sin(dr)) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(dr)) / cosc;
  return [xi * RAD, eta * RAD];
}

/** Inverse gnomonic projection; xi, eta in degrees. */
export function tanDeproject(ra0, dec0, xi, eta) {
  const x = xi * DEG;
  const y = eta * DEG;
  const d0 = dec0 * DEG;
  const rho = Math.hypot(x, y);
  if (rho === 0) return [ra0, dec0];
  const c = Math.atan(rho);
  const sc = Math.sin(c);
  const cc = Math.cos(c);
  const dec = Math.asin(cc * Math.sin(d0) + (y * sc * Math.cos(d0)) / rho);
  const ra = ra0 * DEG + Math.atan2(x * sc, rho * Math.cos(d0) * cc - y * Math.sin(d0) * sc);
  let r = ra * RAD;
  r = ((r % 360) + 360) % 360;
  return [r, dec * RAD];
}

// J2000 equatorial <-> galactic / ecliptic, for overlays and readouts.
const GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
];

export function equatorialToGalactic(ra, dec) {
  const v = radecToVec(ra, dec);
  const g = GAL.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  return vecToRadec(...g);
}

export function galacticToEquatorial(l, b) {
  const g = radecToVec(l, b);
  const v = [0, 1, 2].map((j) => GAL[0][j] * g[0] + GAL[1][j] * g[1] + GAL[2][j] * g[2]);
  return vecToRadec(...v);
}

const EPS = 23.4392911 * DEG;

export function eclipticToEquatorial(lon, lat) {
  const [x, y, z] = radecToVec(lon, lat);
  return vecToRadec(x, y * Math.cos(EPS) - z * Math.sin(EPS), y * Math.sin(EPS) + z * Math.cos(EPS));
}

export function equatorialToEcliptic(ra, dec) {
  const [x, y, z] = radecToVec(ra, dec);
  return vecToRadec(x, y * Math.cos(EPS) + z * Math.sin(EPS), -y * Math.sin(EPS) + z * Math.cos(EPS));
}

export function formatRa(ra) {
  // Round once, in tenths of a second of time, so 59.96s carries to the minute.
  const t = Math.round(((((ra % 360) + 360) % 360) / 15) * 36000) % 864000;
  const hh = Math.floor(t / 36000);
  const mm = Math.floor((t % 36000) / 600);
  const ss = (t % 600) / 10;
  return `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m ${ss.toFixed(1).padStart(4, '0')}s`;
}

export function formatDec(dec) {
  const t = Math.round(Math.abs(dec) * 3600);
  const s = dec < 0 && t > 0 ? '−' : '+';
  const dd = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  return `${s}${String(dd).padStart(2, '0')}° ${String(mm).padStart(2, '0')}′ ${String(ss).padStart(2, '0')}″`;
}

/** Parse "ra dec" in degrees or sexagesimal ("05 35 17.3 -05 23 28"). */
export function parseCoords(text) {
  // Accept the typographic minus and dashes this app prints, and unit marks.
  const t = text
    .replace(/[−–—]/g, '-')
    .replace(/[hmsd°′″'":,]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  if (!t) return null;
  const parts = t.split(' ');
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums.length === 2) {
    if (Math.abs(nums[1]) > 90) return null;
    return [((nums[0] % 360) + 360) % 360, nums[1]];
  }
  if (nums.length === 6) {
    const [h, m, s, d, dm, ds] = nums;
    if (h < 0 || h >= 24 || m < 0 || m >= 60 || s < 0 || s >= 60 || dm < 0 || dm >= 60 || ds < 0 || ds >= 60) return null;
    const ra = (h + m / 60 + s / 3600) * 15;
    const dec = Math.abs(d) + dm / 60 + ds / 3600;
    if (dec > 90) return null;
    return [ra, parts[3].startsWith('-') ? -dec : dec];
  }
  return null;
}
