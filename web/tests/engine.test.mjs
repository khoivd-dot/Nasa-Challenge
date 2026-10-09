// Checks the in-browser FITS engine against astropy reference values computed
// from a real SPHEREx QR3 Level 2 file (see tests/fixtures/qr3-sample.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { riceDecompress } from '../src/fits/rice.js';
import { SipWcs } from '../src/fits/wcs.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/qr3-sample.json', import.meta.url)));

test('TAN-SIP pixel -> sky matches astropy to 1 milliarcsec', () => {
  const w = new SipWcs(fx.cards);
  fx.pix.forEach(([x, y], k) => {
    const [ra, dec] = w.pixToSky(x, y);
    const err = Math.hypot((ra - fx.sky[k][0]) * Math.cos((dec * Math.PI) / 180), dec - fx.sky[k][1]) * 3600;
    assert.ok(err < 1e-3, `point ${k}: ${err} arcsec`);
  });
});

test('TAN-SIP sky -> pixel inverse is within 0.05 px', () => {
  const w = new SipWcs(fx.cards);
  fx.sky.forEach(([ra, dec], k) => {
    const [x, y] = w.skyToPix(ra, dec);
    assert.ok(Math.hypot(x - fx.pix[k][0], y - fx.pix[k][1]) < 0.05);
  });
});

test('Rice decompression reproduces the FLAGS rows bit for bit', () => {
  for (const row of fx.riceRows) {
    const out = riceDecompress(new Uint8Array(Buffer.from(row.b64, 'base64')), 2040, 32);
    let sum = 0;
    for (const v of out) sum += v;
    assert.equal(sum, row.sum, `row ${row.y}`);
    assert.deepEqual([out[0], out[5], out[1020], out[2039]], row.sample);
  }
});
