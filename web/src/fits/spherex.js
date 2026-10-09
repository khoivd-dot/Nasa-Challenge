// Read pieces of a SPHEREx Level 2 spectral image (multi-extension FITS) straight
// from NASA's public S3 bucket with HTTP range requests.
//
// HDUs: PRIMARY, IMAGE (MJy/sr, 2040x2040 float32), FLAGS (int32 bitmask; plain in
// QR2, Rice tile-compressed per row in QR3), VARIANCE, ZODI, PSF/EPSF, WCS-WAVE
// (9x9 lookup table of central wavelength and bandwidth in microns).

import { fetchRange, fetchTail, parseHeader, dataSize, padded, beFloat32, beInt32 } from './fits.js';
import { riceDecompress } from './rice.js';
import { SipWcs } from './wcs.js';

export const W = 2040;

// Flag bits used to reject pixels before blinking. Dead, hot and cold pixels
// are always dropped. Cosmic-ray hits, onboard errors, persistence and other
// artifacts are dropped too, except on pixels the pipeline maps to a known
// source (bit 21): bright stars carry those flags around their cores, and
// masking them would punch holes in the stars.
const HARD_FLAGS = (1 << 6) | (1 << 9) | (1 << 10) | (1 << 11);
const SOFT_FLAGS = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 17) | (1 << 25) | (1 << 26) | (1 << 27);
const SOURCE_FLAG = 1 << 21;

export function isBadPixel(flag) {
  return (flag & HARD_FLAGS) !== 0 || ((flag & SOFT_FLAGS) !== 0 && (flag & SOURCE_FLAG) === 0);
}

export class SpherexFile {
  constructor(url, { signal } = {}) {
    this.url = url;
    this.signal = signal;
  }

  async open() {
    // Primary (2880 B) + IMAGE header (8-10 blocks). Grow until END is found.
    let n = 34560;
    let bytes = await fetchRange(this.url, 0, n - 1, { signal: this.signal });
    let primary = parseHeader(bytes, 0);
    let image = primary && parseHeader(bytes, primary.end);
    while (!image && n < 200000) {
      n *= 2;
      bytes = await fetchRange(this.url, 0, n - 1, { signal: this.signal });
      primary = parseHeader(bytes, 0);
      image = primary && parseHeader(bytes, primary.end);
    }
    if (!image) throw new Error('could not parse FITS header');
    this.header = image.cards;
    this.imageStart = image.end;
    this.flagsHeaderStart = image.end + padded(dataSize(image.cards));
    this.wcs = new SipWcs(image.cards);
    this.mjd = image.cards['MJD-AVG'];
    this.dateObs = image.cards['DATE-AVG'] || image.cards['DATE-OBS'];
    this.detector = image.cards.DETECTOR;
    this.obsId = image.cards.OBSID;
    this.psfFwhm = image.cards.PSF_FWHM;
    return this;
  }

  /** IMAGE rows y0..y1 (1-based, inclusive) as Float32Array of (y1-y0+1)*W. */
  async readRows(y0, y1) {
    const a = this.imageStart + (y0 - 1) * W * 4;
    const b = this.imageStart + y1 * W * 4 - 1;
    return beFloat32(await fetchRange(this.url, a, b, { signal: this.signal }));
  }

  async flagsHeader() {
    if (!this._flags) {
      const bytes = await fetchRange(this.url, this.flagsHeaderStart, this.flagsHeaderStart + 23039, { signal: this.signal });
      const h = parseHeader(bytes, 0);
      if (!h) throw new Error('FLAGS header too long');
      this._flags = { cards: h.cards, dataStart: this.flagsHeaderStart + h.end };
    }
    return this._flags;
  }

  /** FLAGS rows y0..y1 (1-based, inclusive) as Int32Array. */
  async readFlagRows(y0, y1) {
    const { cards, dataStart } = await this.flagsHeader();
    const rows = y1 - y0 + 1;
    if (!cards.ZIMAGE) {
      const a = dataStart + (y0 - 1) * W * 4;
      return beInt32(await fetchRange(this.url, a, a + rows * W * 4 - 1, { signal: this.signal }));
    }
    if (cards.ZCMPTYPE !== 'RICE_1' || cards.ZTILE2 !== 1) throw new Error(`unsupported compression ${cards.ZCMPTYPE}`);
    // Binary table of variable-length descriptors (count, heap offset), one per row.
    const rowLen = cards.NAXIS1;
    const desc = await fetchRange(this.url, dataStart + (y0 - 1) * rowLen, dataStart + y1 * rowLen - 1, { signal: this.signal });
    const dv = new DataView(desc.buffer, desc.byteOffset, desc.byteLength);
    const heapStart = dataStart + (cards.THEAP ?? cards.NAXIS1 * cards.NAXIS2);
    const spans = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (let r = 0; r < rows; r++) {
      const count = dv.getInt32(r * rowLen, false);
      const off = dv.getInt32(r * rowLen + 4, false);
      spans.push([off, count]);
      lo = Math.min(lo, off);
      hi = Math.max(hi, off + count);
    }
    const heap = await fetchRange(this.url, heapStart + lo, heapStart + hi - 1, { signal: this.signal });
    const blocksize = cards.ZVAL1 ?? 32;
    const out = new Int32Array(rows * W);
    spans.forEach(([off, count], r) => {
      out.set(riceDecompress(heap.subarray(off - lo, off - lo + count), W, blocksize), r * W);
    });
    return out;
  }

  /** Central wavelength and bandwidth (microns) at pixel (x, y), from WCS-WAVE. */
  async wavelength(x, y) {
    if (!this._wave) {
      // The lookup table is the last HDU; its grid size differs per detector
      // (9x9 up to 13x20), but header and data each fit in one 2880-byte block.
      const tail = await fetchTail(this.url, 5760, { signal: this.signal });
      const h = parseHeader(tail, 0);
      if (!h || h.cards.EXTNAME !== 'WCS-WAVE') throw new Error('WCS-WAVE not found');
      const count = (form) => parseInt(form, 10) || 1;
      const nx = count(h.cards.TFORM1);
      const ny = count(h.cards.TFORM2);
      const dv = new DataView(tail.buffer, tail.byteOffset + h.end, h.cards.NAXIS1);
      const gx = [];
      const gy = [];
      for (let i = 0; i < nx; i++) gx.push(dv.getInt32(4 * i, false));
      for (let i = 0; i < ny; i++) gy.push(dv.getInt32(4 * (nx + i), false));
      const vals = new Float32Array(2 * nx * ny);
      for (let i = 0; i < vals.length; i++) vals[i] = dv.getFloat32(4 * (nx + ny + i), false);
      this._wave = { gx, gy, vals, nx };
    }
    return lookupWave(this._wave, x, y);
  }
}

/** Central wavelength and bandwidth at (x, y) from a loaded WCS-WAVE table. */
export function lookupWave(table, x, y) {
  const { gx, gy, vals, nx } = table;
  const locate = (g, v) => {
    let i = 0;
    while (i < g.length - 2 && v > g[i + 1]) i++;
    return [i, Math.min(1, Math.max(0, (v - g[i]) / (g[i + 1] - g[i])))];
  };
  const [ix, fx] = locate(gx, x);
  const [iy, fy] = locate(gy, y);
  // VALUES has FITS dims (2, nx, ny): pair index fastest, then X, then Y.
  const at = (i, j, m) => vals[m + 2 * (i + nx * j)];
  const lerp = (m) =>
    (1 - fy) * ((1 - fx) * at(ix, iy, m) + fx * at(ix + 1, iy, m)) + fy * ((1 - fx) * at(ix, iy + 1, m) + fx * at(ix + 1, iy + 1, m));
  return { lambda: lerp(0), bandwidth: lerp(1) };
}
