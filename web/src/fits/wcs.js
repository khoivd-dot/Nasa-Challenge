// TAN-SIP world coordinate system (FITS WCS Paper II + SIP convention).
// Pixel coordinates are FITS 1-based; array index = pixel - 1.

import { tanProject, tanDeproject } from '../data/sky-math.js';

function sipTerms(cards, prefix) {
  const order = cards[`${prefix}_ORDER`];
  if (!order) return null;
  const terms = [];
  for (let p = 0; p <= order; p++) {
    for (let q = 0; q + p <= order; q++) {
      const v = cards[`${prefix}_${p}_${q}`];
      if (v) terms.push([p, q, v]);
    }
  }
  return terms;
}

function poly(terms, u, v) {
  let s = 0;
  for (const [p, q, c] of terms) s += c * u ** p * v ** q;
  return s;
}

export class SipWcs {
  constructor(cards) {
    this.crval = [cards.CRVAL1, cards.CRVAL2];
    this.crpix = [cards.CRPIX1, cards.CRPIX2];
    const c1 = cards.CDELT1 ?? 1;
    const c2 = cards.CDELT2 ?? 1;
    if (cards.CD1_1 !== undefined) {
      this.cd = [cards.CD1_1, cards.CD1_2 ?? 0, cards.CD2_1 ?? 0, cards.CD2_2];
    } else {
      this.cd = [(cards.PC1_1 ?? 1) * c1, (cards.PC1_2 ?? 0) * c1, (cards.PC2_1 ?? 0) * c2, (cards.PC2_2 ?? 1) * c2];
    }
    const [a, b, c, d] = this.cd;
    const det = a * d - b * c;
    this.cdi = [d / det, -b / det, -c / det, a / det];
    this.a = sipTerms(cards, 'A');
    this.b = sipTerms(cards, 'B');
    this.ap = sipTerms(cards, 'AP');
    this.bp = sipTerms(cards, 'BP');
    // Pixel scale in arcsec (geometric mean of the CD matrix).
    this.scale = Math.sqrt(Math.abs(det)) * 3600;
  }

  pixToSky(x, y) {
    let u = x - this.crpix[0];
    let v = y - this.crpix[1];
    if (this.a) {
      const du = poly(this.a, u, v);
      const dv = poly(this.b, u, v);
      u += du;
      v += dv;
    }
    const [a, b, c, d] = this.cd;
    return tanDeproject(this.crval[0], this.crval[1], a * u + b * v, c * u + d * v);
  }

  skyToPix(ra, dec) {
    const pr = tanProject(this.crval[0], this.crval[1], ra, dec);
    if (!pr) return null;
    const [ai, bi, ci, di] = this.cdi;
    let u = ai * pr[0] + bi * pr[1];
    let v = ci * pr[0] + di * pr[1];
    if (this.ap) {
      const du = poly(this.ap, u, v);
      const dv = poly(this.bp, u, v);
      u += du;
      v += dv;
    }
    return [u + this.crpix[0], v + this.crpix[1]];
  }
}
