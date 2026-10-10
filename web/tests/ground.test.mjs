// The "From Earth" view: horizon frame against Astronomy Engine's own
// horizontal coordinates, and local-time helpers across a DST change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Astronomy from 'astronomy-engine';
import { CITIES, horizonFrame, skyBodies, altAz, fromLocal, localParts, tonight, nightStart } from '../src/sky/ground.js';

test('horizon frame puts planets where Astronomy Engine does', () => {
  const place = CITIES.find((c) => c.name === 'Hanoi');
  const t = Date.UTC(2026, 9, 10, 15, 0);
  const frame = horizonFrame(t, place);
  const obs = new Astronomy.Observer(place.lat, place.lon, 0);
  for (const b of skyBodies(t, place)) {
    const eq = Astronomy.Equator(b.name, new Date(t), obs, true, true);
    const ref = Astronomy.Horizon(new Date(t), obs, eq.ra, eq.dec, null);
    const got = altAz(b.v, frame);
    assert.ok(Math.abs(got.alt - ref.altitude) < 0.02, `${b.name} altitude ${got.alt} vs ${ref.altitude}`);
    if (Math.abs(ref.altitude) < 85) {
      const dAz = ((got.az - ref.azimuth + 540) % 360) - 180;
      assert.ok(Math.abs(dAz) < 0.05, `${b.name} azimuth ${got.az} vs ${ref.azimuth}`);
    }
  }
});

test('local wall-clock helpers survive a DST change', () => {
  // New York leaves daylight time on 2026-11-01: 22:00 that night is 03:00 UTC.
  assert.equal(fromLocal(2026, 10, 1, 22, 0, 'America/New_York'), Date.UTC(2026, 10, 2, 3, 0));
  assert.equal(fromLocal(2026, 9, 31, 22, 0, 'America/New_York'), Date.UTC(2026, 10, 1, 2, 0));
  const p = localParts(Date.UTC(2026, 9, 10, 23, 30), 'Asia/Ho_Chi_Minh');
  assert.deepEqual([p.d, p.h, p.min], [11, 6, 30]);
  // Morning there: "tonight" is 22:00 the same local day, inside a noon-to-noon slider.
  const tn = tonight(Date.UTC(2026, 9, 10, 23, 30), 'Asia/Ho_Chi_Minh');
  assert.equal(tn, Date.UTC(2026, 9, 11, 15, 0));
  assert.equal(nightStart(tn, 'Asia/Ho_Chi_Minh'), Date.UTC(2026, 9, 11, 5, 0));
});
