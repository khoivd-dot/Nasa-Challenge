// Rice decompression for FITS tile-compressed images (ZCMPTYPE = 'RICE_1'),
// a port of fits_rdecomp() from CFITSIO for 32-bit pixels.
// SPHEREx QR3 files store their FLAGS plane this way, one tile per image row.

const NONZERO = new Uint8Array(256);
for (let i = 1; i < 256; i++) NONZERO[i] = 32 - Math.clz32(i);

export function riceDecompress(c, nx, nblock = 32) {
  const FSBITS = 5;
  const FSMAX = 25;
  const BBITS = 32;
  const out = new Int32Array(nx);
  let p = 4;
  let lastpix = (c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3];
  let b = c[p++];
  let nbits = 8;
  for (let i = 0; i < nx; ) {
    nbits -= FSBITS;
    while (nbits < 0) {
      b = (b << 8) | c[p++];
      nbits += 8;
    }
    const fs = (b >>> nbits) - 1;
    b &= (1 << nbits) - 1;
    const imax = Math.min(i + nblock, nx);
    if (fs < 0) {
      // Low-entropy block: every difference is zero.
      for (; i < imax; i++) out[i] = lastpix;
    } else if (fs === FSMAX) {
      // High-entropy block: raw BBITS-bit differences.
      for (; i < imax; i++) {
        let k = BBITS - nbits;
        let diff = k >= 32 ? 0 : (b << k) >>> 0;
        for (k -= 8; k >= 0; k -= 8) {
          b = c[p++];
          diff = (diff | (b << k)) >>> 0;
        }
        if (nbits > 0) {
          b = c[p++];
          diff = (diff | (b >>> -k)) >>> 0;
          b &= (1 << nbits) - 1;
        } else {
          b = 0;
        }
        const d = diff & 1 ? ~(diff >>> 1) : diff >>> 1;
        lastpix = (d + lastpix) | 0;
        out[i] = lastpix;
      }
    } else {
      for (; i < imax; i++) {
        while (b === 0) {
          nbits += 8;
          b = c[p++];
        }
        const nzero = nbits - NONZERO[b];
        nbits -= nzero + 1;
        b ^= 1 << nbits;
        nbits -= fs;
        while (nbits < 0) {
          b = (b << 8) | c[p++];
          nbits += 8;
        }
        const diff = ((nzero << fs) | (b >>> nbits)) >>> 0;
        b &= (1 << nbits) - 1;
        const d = diff & 1 ? ~(diff >>> 1) : diff >>> 1;
        lastpix = (d + lastpix) | 0;
        out[i] = lastpix;
      }
    }
  }
  return out;
}
