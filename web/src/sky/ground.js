// Standing on Earth: the horizon frame of a place at a moment, where the Sun,
// Moon and planets stand, local time, and when it gets dark. Positions come
// from Astronomy Engine (topocentric, J2000, the frame of the SPHEREx index).

import * as Astronomy from 'astronomy-engine';

// [name, latitude, longitude, IANA zone, other zone names that pick this city]
const CITY_ROWS = [
  ['Anchorage', 61.22, -149.9, 'America/Anchorage'],
  ['Athens', 37.98, 23.73, 'Europe/Athens'],
  ['Atacama Desert (Paranal)', -24.63, -70.4, 'America/Santiago'],
  ['Auckland', -36.85, 174.76, 'Pacific/Auckland'],
  ['Bangkok', 13.76, 100.5, 'Asia/Bangkok', ['Asia/Vientiane', 'Asia/Phnom_Penh']],
  ['Beijing', 39.9, 116.41, 'Asia/Shanghai', ['Asia/Chongqing', 'Asia/Harbin', 'Asia/Urumqi', 'PRC']],
  ['Berlin', 52.52, 13.4, 'Europe/Berlin', ['Europe/Vienna', 'Europe/Zurich', 'Europe/Prague', 'Europe/Warsaw', 'Europe/Copenhagen', 'Europe/Amsterdam', 'Europe/Brussels']],
  ['Bogotá', 4.71, -74.07, 'America/Bogota'],
  ['Buenos Aires', -34.6, -58.38, 'America/Argentina/Buenos_Aires', ['America/Buenos_Aires']],
  ['Cairo', 30.04, 31.24, 'Africa/Cairo'],
  ['Chicago', 41.88, -87.63, 'America/Chicago'],
  ['Delhi', 28.61, 77.21, 'Asia/Kolkata', ['Asia/Calcutta']],
  ['Denver', 39.74, -104.99, 'America/Denver', ['America/Boise']],
  ['Dhaka', 23.81, 90.41, 'Asia/Dhaka'],
  ['Dubai', 25.2, 55.27, 'Asia/Dubai', ['Asia/Muscat']],
  ['Hanoi', 21.03, 105.85, 'Asia/Ho_Chi_Minh'],
  ['Ho Chi Minh City', 10.82, 106.63, 'Asia/Ho_Chi_Minh', ['Asia/Saigon']],
  ['Hong Kong', 22.32, 114.17, 'Asia/Hong_Kong', ['Asia/Macau']],
  ['Honolulu', 21.31, -157.86, 'Pacific/Honolulu'],
  ['Istanbul', 41.01, 28.98, 'Europe/Istanbul'],
  ['Jakarta', -6.21, 106.85, 'Asia/Jakarta'],
  ['Johannesburg', -26.2, 28.05, 'Africa/Johannesburg'],
  ['Karachi', 24.86, 67.01, 'Asia/Karachi'],
  ['Lagos', 6.52, 3.38, 'Africa/Lagos'],
  ['Lima', -12.05, -77.04, 'America/Lima'],
  ['Lisbon', 38.72, -9.14, 'Europe/Lisbon'],
  ['London', 51.51, -0.13, 'Europe/London', ['Europe/Dublin', 'GB']],
  ['Los Angeles', 34.05, -118.24, 'America/Los_Angeles'],
  ['Madrid', 40.42, -3.7, 'Europe/Madrid'],
  ['Manila', 14.6, 120.98, 'Asia/Manila'],
  ['Mauna Kea', 19.82, -155.47, 'Pacific/Honolulu'],
  ['Mexico City', 19.43, -99.13, 'America/Mexico_City'],
  ['Moscow', 55.76, 37.62, 'Europe/Moscow'],
  ['Nairobi', -1.29, 36.82, 'Africa/Nairobi'],
  ['New York', 40.71, -74.01, 'America/New_York', ['America/Detroit', 'US/Eastern']],
  ['Paris', 48.86, 2.35, 'Europe/Paris'],
  ['Perth', -31.95, 115.86, 'Australia/Perth'],
  ['Phoenix', 33.45, -112.07, 'America/Phoenix'],
  ['Reykjavík', 64.15, -21.94, 'Atlantic/Reykjavik'],
  ['Rome', 41.9, 12.5, 'Europe/Rome'],
  ['Santiago', -33.45, -70.67, 'America/Santiago'],
  ['São Paulo', -23.55, -46.63, 'America/Sao_Paulo'],
  ['Seoul', 37.57, 126.98, 'Asia/Seoul'],
  ['Singapore', 1.35, 103.82, 'Asia/Singapore', ['Asia/Kuala_Lumpur']],
  ['Stockholm', 59.33, 18.07, 'Europe/Stockholm', ['Europe/Oslo', 'Europe/Helsinki']],
  ['Sydney', -33.87, 151.21, 'Australia/Sydney', ['Australia/Melbourne', 'Australia/Canberra']],
  ['Taipei', 25.03, 121.57, 'Asia/Taipei'],
  ['Tehran', 35.69, 51.39, 'Asia/Tehran'],
  ['Tokyo', 35.68, 139.69, 'Asia/Tokyo'],
  ['Toronto', 43.65, -79.38, 'America/Toronto'],
  ['Vancouver', 49.28, -123.12, 'America/Vancouver'],
];

export const CITIES = CITY_ROWS.map(([name, lat, lon, tz, also = []]) => ({ name, lat, lon, tz, zones: [tz, ...also] }));

export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** A city in the visitor's own time zone (no permission needed), else one with the same UTC offset. */
export function guessPlace(now = new Date()) {
  const zone = browserZone();
  // The zone's own city first (Asia/Ho_Chi_Minh -> Ho Chi Minh City, not Hanoi).
  const hits = CITIES.filter((c) => c.zones.includes(zone));
  const key = zone.split('/').pop().toLowerCase();
  const hit = hits.find((c) => c.name.toLowerCase().replace(/ /g, '_').startsWith(key)) || hits[0];
  if (hit) return hit;
  const off = zoneOffset(now, zone);
  const same = CITIES.filter((c) => zoneOffset(now, c.tz) === off);
  return same[0] || CITIES.find((c) => c.name === 'London');
}

/** Minutes east of UTC for a zone at an instant. */
export function zoneOffset(date, tz) {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUtc - (date.getTime() - date.getMilliseconds())) / 60000);
  } catch {
    return 0;
  }
}

/** Local wall-clock parts of an instant in a zone. */
export function localParts(t, tz) {
  const d = new Date(t + zoneOffset(new Date(t), tz) * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}

/** The instant a local wall-clock time happens in a zone (DST-safe to the minute). */
export function fromLocal(y, m, d, h, min, tz) {
  const naive = Date.UTC(y, m, d, h, min);
  let t = naive - zoneOffset(new Date(naive), tz) * 60000;
  t = naive - zoneOffset(new Date(t), tz) * 60000;
  return t;
}

/** Local noon on or before t: the start of the noon-to-noon "night" slider. */
export function nightStart(t, tz) {
  const p = localParts(t, tz);
  const noon = fromLocal(p.y, p.m, p.d, 12, 0, tz);
  return noon <= t ? noon : fromLocal(p.y, p.m, p.d - 1, 12, 0, tz);
}

/** Next local 22:00 (or now, if it is already late evening or night there). */
export function tonight(t, tz) {
  const p = localParts(t, tz);
  if (p.h >= 22 || p.h < 4) return t;
  return fromLocal(p.y, p.m, p.d, 22, 0, tz);
}

export function formatLocal(t, tz) {
  const date = new Date(t);
  try {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
    return { day, time };
  } catch {
    return { day: date.toUTCString().slice(0, 16), time: date.toISOString().slice(11, 16) + ' UTC' };
  }
}

const observer = (place) => new Astronomy.Observer(place.lat, place.lon, 0);

/**
 * North, east and zenith of a place at an instant, as unit vectors in the
 * J2000 equatorial frame (precession and nutation included, no refraction).
 */
export function horizonFrame(t, place) {
  const r = Astronomy.Rotation_EQJ_HOR(new Date(t), observer(place)).rot;
  // HOR axes are x = north, y = west, z = zenith; rot is stored transposed.
  return {
    north: [r[0][0], r[1][0], r[2][0]],
    east: [-r[0][1], -r[1][1], -r[2][1]],
    zenith: [r[0][2], r[1][2], r[2][2]],
  };
}

const BODIES = [
  { name: 'Sun', kind: 'sun', color: '#fff4d6' },
  { name: 'Moon', kind: 'moon', color: '#e9ecf5' },
  { name: 'Mercury', kind: 'planet', color: '#d9c7b0' },
  { name: 'Venus', kind: 'planet', color: '#fff3d1' },
  { name: 'Mars', kind: 'planet', color: '#ff9b6b' },
  { name: 'Jupiter', kind: 'planet', color: '#ffe2b8' },
  { name: 'Saturn', kind: 'planet', color: '#f3d99a' },
  { name: 'Uranus', kind: 'planet', color: '#a8e6ef' },
  { name: 'Neptune', kind: 'planet', color: '#8fb4ff' },
  { name: 'Pluto', kind: 'dwarf', color: '#d8c3a5' },
];

/** Sun, Moon and planets seen from a place: J2000 unit vectors, magnitudes, Moon phase. */
export function skyBodies(t, place) {
  const date = new Date(t);
  const obs = observer(place);
  return BODIES.map((b) => {
    const eq = Astronomy.Equator(b.name, date, obs, false, true);
    const ra = eq.ra * 15 * (Math.PI / 180);
    const dec = eq.dec * (Math.PI / 180);
    const v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    let mag = null;
    let lit = null;
    if (b.kind !== 'sun') {
      try {
        const ill = Astronomy.Illumination(b.name, date);
        mag = ill.mag;
        lit = ill.phase_fraction;
      } catch {
        /* no magnitude model for this body */
      }
    }
    return { ...b, ra: eq.ra * 15, dec: eq.dec, v, mag, lit };
  });
}

/** Sun altitude in degrees, from its J2000 vector and the zenith. */
export function altitudeOf(v, frame) {
  const s = v[0] * frame.zenith[0] + v[1] * frame.zenith[1] + v[2] * frame.zenith[2];
  return (Math.asin(Math.max(-1, Math.min(1, s))) * 180) / Math.PI;
}

/** Azimuth (degrees from north through east) and altitude of a J2000 unit vector. */
export function altAz(v, frame) {
  const n = v[0] * frame.north[0] + v[1] * frame.north[1] + v[2] * frame.north[2];
  const e = v[0] * frame.east[0] + v[1] * frame.east[1] + v[2] * frame.east[2];
  const az = ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360;
  return { az, alt: altitudeOf(v, frame) };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassPoint = (az) => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8];

/** Sun altitude across a time span, for the day/night shading of the time slider. */
export function sunAltitudes(t0, t1, place, n = 49) {
  const obs = observer(place);
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = t0 + ((t1 - t0) * k) / (n - 1);
    const date = new Date(t);
    const eq = Astronomy.Equator('Sun', date, obs, true, true);
    out.push(Astronomy.Horizon(date, obs, eq.ra, eq.dec, null).altitude);
  }
  return out;
}
