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
  const h = ra / 15;
  const hh = Math.floor(h);
  const m = (h - hh) * 60;
  const mm = Math.floor(m);
  const ss = (m - mm) * 60;
  return `${String(hh).padStart(2, '0')}h ${String(mm).padStart(2, '0')}m ${ss.toFixed(1).padStart(4, '0')}s`;
}

export function formatDec(dec) {
  const s = dec < 0 ? '−' : '+';
  const a = Math.abs(dec);
  const dd = Math.floor(a);
  const m = (a - dd) * 60;
  const mm = Math.floor(m);
  const ss = (m - mm) * 60;
  return `${s}${String(dd).padStart(2, '0')}° ${String(mm).padStart(2, '0')}′ ${ss.toFixed(0).padStart(2, '0')}″`;
}

/** Parse "ra dec" in degrees or sexagesimal ("05 35 17.3 -05 23 28"). */
export function parseCoords(text) {
  const t = text.trim().replace(/[hmsd°′″'":,]/g, ' ').replace(/\s+/g, ' ');
  const nums = t.split(' ').map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (nums.length === 2) return [((nums[0] % 360) + 360) % 360, nums[1]];
  if (nums.length === 6) {
    const ra = (nums[0] + nums[1] / 60 + nums[2] / 3600) * 15;
    const neg = /-|−/.test(text.split(/\s+/).slice(3).join(' ')) || Object.is(nums[3], -0) || nums[3] < 0;
    const dec = Math.abs(nums[3]) + nums[4] / 60 + nums[5] / 3600;
    return [ra, neg ? -dec : dec];
  }
  return null;
}
