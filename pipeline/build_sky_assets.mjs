#!/usr/bin/env node
// Build compact sky reference layers for the Skyblink sky map from the real
// catalogs bundled with d3-celestial (Hipparcos stars to mag 6, IAU
// constellation stick figures and names, Milky Way outline polygons).
//
//   cd web && npm run assets
//
// Outputs (web/public/data/):
//   stars.json           [[ra, dec, mag, bv], ...]       bv is null when unknown
//   constellations.json  {lines: [[[ra, dec], ...], ...], labels: [[name, ra, dec, rank], ...]}
//   milkyway.json        {levels: [{id, rings: [[[ra, dec], ...], ...]}, ...]}
//                        levels ol1 (faint outer outline) .. ol5 (brightest core),
//                        each ring simplified (Douglas-Peucker on the sphere).
//
// d3-celestial stores longitudes in -180..180; everything here is converted to
// right ascension in 0..360 degrees (J2000).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..', 'web');
const SRC = join(WEB, 'node_modules', 'd3-celestial', 'data');
const OUT = join(WEB, 'public', 'data');

if (!existsSync(SRC)) {
  console.error(`d3-celestial data not found at ${SRC}. Run "npm install" in web/ first.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const read = (name) => JSON.parse(readFileSync(join(SRC, name), 'utf8'));
const r3 = (x) => Math.round(x * 1000) / 1000;
const r2 = (x) => Math.round(x * 100) / 100;
const toRa = (lon) => {
  let ra = lon < 0 ? lon + 360 : lon;
  if (ra >= 360) ra -= 360;
  return ra;
};

function write(name, data) {
  const text = JSON.stringify(data);
  writeFileSync(join(OUT, name), text);
  console.log(`  ${name.padEnd(20)} ${(text.length / 1024).toFixed(1).padStart(7)} KB`);
  return text.length;
}

console.log('Building sky assets from d3-celestial catalogs');

// ---------------------------------------------------------------- stars ----
{
  const src = read('stars.6.json');
  const stars = src.features
    .map((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const mag = Number(f.properties.mag);
      const bvRaw = f.properties.bv;
      const bv = bvRaw === '' || bvRaw === null || bvRaw === undefined ? null : r3(Number(bvRaw));
      return [r3(toRa(lon)), r3(lat), r2(mag), Number.isFinite(bv) ? bv : null];
    })
    .filter((s) => Number.isFinite(s[2]))
    // Faint first so bright stars draw on top.
    .sort((a, b) => b[2] - a[2]);
  write('stars.json', stars);
}

// ------------------------------------------------------- constellations ----
{
  const linesSrc = read('constellations.lines.json');
  const namesSrc = read('constellations.json');
  const lines = [];
  for (const f of linesSrc.features) {
    const g = f.geometry;
    const parts = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
    for (const part of parts) {
      lines.push(part.map(([lon, lat]) => [r3(toRa(lon)), r3(lat)]));
    }
  }
  const labels = namesSrc.features.map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    return [f.properties.name, r3(toRa(lon)), r3(lat), Number(f.properties.rank) || 3];
  });
  write('constellations.json', { lines, labels });
}

// ------------------------------------------------------------ milky way ----
// Douglas-Peucker on unit vectors: distance of a point to the great circle
// through the segment end points, in degrees.
const DEG = Math.PI / 180;
const vec = ([lon, lat]) => {
  const a = lon * DEG;
  const d = lat * DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function simplify(points, tolDeg) {
  if (points.length <= 4) return points;
  const v = points.map(vec);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const sinTol = Math.sin(tolDeg * DEG);
  while (stack.length) {
    const [i0, i1] = stack.pop();
    if (i1 - i0 < 2) continue;
    const n = cross(v[i0], v[i1]);
    const nl = Math.hypot(...n);
    let best = -1;
    let bestD = 0;
    for (let i = i0 + 1; i < i1; i++) {
      // Distance to the great circle (or to the end point if degenerate).
      const d = nl > 1e-9 ? Math.abs(dot(v[i], n)) / nl : Math.hypot(v[i][0] - v[i0][0], v[i][1] - v[i0][1], v[i][2] - v[i0][2]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > sinTol) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Even-odd test with a meridian ray to the north celestial pole (which lies
// outside the Milky Way), used only to sanity-check the output.
function insideRings(rings, ra, dec) {
  let n = 0;
  for (const ring of rings) {
    for (let k = 0; k < ring.length - 1; k++) {
      const [a0, d0] = ring[k];
      let [a1, d1] = ring[k + 1];
      let da = a1 - a0;
      if (da > 180) da -= 360;
      if (da < -180) da += 360;
      if (da === 0) continue;
      for (const off of [-360, 0, 360]) {
        const x = ra + off;
        const f = (x - a0) / da;
        if (f >= 0 && f < 1) {
          const d = d0 + f * (d1 - d0);
          if (d > dec) n++;
        }
      }
    }
  }
  return n % 2 === 1;
}

{
  const src = read('milkyway.json');
  const levels = [];
  let pointsIn = 0;
  let pointsOut = 0;
  for (const f of src.features) {
    const g = f.geometry;
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    const rings = [];
    for (const poly of polys) {
      for (const ring of poly) {
        pointsIn += ring.length;
        const simple = simplify(ring, 0.12);
        if (simple.length < 4) continue;
        const out = simple.map(([lon, lat]) => [r2(toRa(lon)), r2(lat)]);
        // Keep rings explicitly closed.
        const [fa, fd] = out[0];
        const [la, ld] = out[out.length - 1];
        if (fa !== la || fd !== ld) out.push([fa, fd]);
        pointsOut += out.length;
        rings.push(out);
      }
    }
    levels.push({ id: f.id, rings });
  }
  const bytes = write('milkyway.json', {
    source: 'd3-celestial milkyway.json (outline levels ol1 faint .. ol5 bright), J2000',
    levels,
  });
  console.log(`  milky way points ${pointsIn} -> ${pointsOut}`);
  // Sanity: galactic center inside the faint outline, north galactic pole outside.
  const gc = levels.map((l) => insideRings(l.rings, 266.405, -28.936));
  const ngp = levels.map((l) => insideRings(l.rings, 192.859, 27.128));
  console.log(`  galactic center inside levels: ${gc.map(Number).join('')}; galactic pole: ${ngp.map(Number).join('')}`);
  if (!gc[0] || ngp.some(Boolean)) throw new Error('Milky Way polygon orientation check failed');
  if (bytes > 160 * 1024) throw new Error('milkyway.json is larger than expected; raise the tolerance');
}

console.log('Done.');
