// Coordinate parsing and formatting, the Deep drizzle and the mover finder on
// small synthetic inputs with known answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoords, formatRa, formatDec } from '../src/data/sky-math.js';
import { drizzle } from '../src/lab/deep.js';
import { detect } from '../src/lab/movers.js';

test('parseCoords reads the formats the app prints', () => {
  assert.deepEqual(parseCoords('83.82 −5.39'), [83.82, -5.39]);
  const [ra, dec] = parseCoords('05h 35m 17.3s −05° 23′ 28″');
  assert.ok(Math.abs(ra - 83.8220833) < 1e-6 && Math.abs(dec + 5.3911111) < 1e-6);
  assert.ok(parseCoords('05 35 17.3 -00 23 28')[1] < 0, 'negative zero degrees keeps its sign');
  assert.equal(parseCoords('10 95'), null);
  assert.equal(parseCoords('25 00 00 +10 00 00'), null);
  assert.equal(parseCoords('<img src=x>'), null);
});

test('formatRa and formatDec carry rounded seconds', () => {
  assert.equal(formatRa(359.99999), '00h 00m 00.0s');
  assert.equal(formatDec(10.9999999), '+11° 00′ 00″');
  assert.equal(formatDec(-5.3911111), '−05° 23′ 28″');
});

test('drizzle of identical dithered frames reproduces the scene', () => {
  const N = 16;
  const scene = (u, v) => 50 * Math.exp(-((u - 7.3) ** 2 + (v - 8.1) ** 2) / 2);
  const frames = [];
  for (let f = 0; f < 6; f++) {
    // Each visit samples the sky at its own sub-pixel offset.
    const du = (f % 3) / 3;
    const dv = Math.floor(f / 3) / 2;
    const u = [];
    const v = [];
    const val = [];
    for (let y = -1; y <= N; y++)
      for (let x = -1; x <= N; x++) {
        u.push(x + du);
        v.push(y + dv);
        val.push(scene(x + du, y + dv));
      }
    const z = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) z[y * N + x] = scene(x, y);
    frames.push({ frame: { z, bg: 0, sigma: 1, samples: { u: Float32Array.from(u), v: Float32Array.from(v), val: Float32Array.from(val), n: u.length } } });
  }
  const median = frames[0].frame.z;
  const d = drizzle(frames, median, { N, factor: 2 });
  assert.equal(d.used, 6);
  assert.equal(d.rejected, 0);
  // The brightest fine pixel sits on the source (7.3, 8.1) -> fine (15.1, 16.7).
  let best = 0;
  for (let q = 1; q < d.img.length; q++) if (d.img[q] > d.img[best]) best = q;
  const bx = best % d.NF;
  const by = Math.floor(best / d.NF);
  assert.ok(Math.abs(bx - 15.1) <= 1.5 && Math.abs(by - 16.7) <= 1.5, `peak at ${bx},${by}`);
});

test('mover detection skips blobs touching blank pixels', () => {
  const N = 24;
  const z = new Float32Array(N * N);
  const median = new Float32Array(N * N);
  z[10 * N + 10] = 40;
  z[10 * N + 11] = NaN; // a masked neighbour leaves no defined centroid
  z[15 * N + 15] = 40;
  const found = detect(z, median, null, N);
  assert.equal(found.length, 1);
  assert.ok(Number.isFinite(found[0].x) && Number.isFinite(found[0].y));
});
