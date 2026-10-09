// Minimal FITS reader over HTTP range requests.
// SPHEREx Level 2 files are ~70 MB; we only ever fetch headers and the rows we need.

const BLOCK = 2880;

export async function fetchRange(url, start, end, { signal, tries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
      if (res.status === 404) throw Object.assign(new Error('not found'), { code: 404 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      // A server that ignores Range returns the whole file; slice defensively.
      return res.status === 200 && buf.length > end - start + 1 ? buf.subarray(start, end + 1) : buf;
    } catch (err) {
      if (err.name === 'AbortError' || err.code === 404 || attempt >= tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
}

/** Fetch the last n bytes of a file (suffix range; works without knowing its size). */
export async function fetchTail(url, n, { signal } = {}) {
  const res = await fetch(url, { headers: { Range: `bytes=-${n}` }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Parse header cards starting at `offset` in `bytes`.
 * Returns { cards, end } where end is the byte offset just past the padded header,
 * or null if the END card is not inside `bytes` yet.
 */
export function parseHeader(bytes, offset = 0) {
  const cards = {};
  for (let p = offset; p + 80 <= bytes.length; p += 80) {
    const card = ascii(bytes, p, 80);
    const key = card.slice(0, 8).trim();
    if (key === 'END') {
      const len = p + 80 - offset;
      return { cards, end: offset + Math.ceil(len / BLOCK) * BLOCK };
    }
    if (card.slice(8, 10) === '= ') {
      cards[key] = parseValue(card.slice(10));
    } else if (key === 'HIERARCH') {
      const m = card.slice(9).match(/^(.*?)\s*=\s*(.*)$/);
      if (m) cards[m[1].trim()] = parseValue(m[2]);
    }
  }
  return null;
}

function parseValue(raw) {
  const s = raw.trim();
  if (s.startsWith("'")) {
    const m = s.match(/^'((?:[^']|'')*)'/);
    return m ? m[1].replace(/''/g, "'").trimEnd() : s;
  }
  const v = s.split('/')[0].trim();
  if (v === 'T') return true;
  if (v === 'F') return false;
  const n = Number(v.replace(/D/i, 'E'));
  return Number.isNaN(n) ? v : n;
}

function ascii(bytes, start, len) {
  let s = '';
  for (let i = start; i < start + len; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Size in bytes of an HDU's data (unpadded), from its header cards. */
export function dataSize(cards) {
  const naxis = cards.NAXIS || 0;
  if (!naxis) return 0;
  let n = 1;
  for (let i = 1; i <= naxis; i++) n *= cards[`NAXIS${i}`];
  return (Math.abs(cards.BITPIX) / 8) * n * (cards.GCOUNT || 1) + (cards.PCOUNT || 0);
}

export const padded = (n) => Math.ceil(n / BLOCK) * BLOCK;

/** Big-endian float32 bytes -> Float32Array (copies). */
export function beFloat32(bytes) {
  const out = new Float32Array(bytes.length / 4);
  const u8 = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 4) {
    u8[i] = bytes[i + 3];
    u8[i + 1] = bytes[i + 2];
    u8[i + 2] = bytes[i + 1];
    u8[i + 3] = bytes[i];
  }
  return out;
}

/** Big-endian int32 bytes -> Int32Array (copies). */
export function beInt32(bytes) {
  const out = new Int32Array(bytes.length / 4);
  const u8 = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 4) {
    u8[i] = bytes[i + 3];
    u8[i + 1] = bytes[i + 2];
    u8[i + 2] = bytes[i + 1];
    u8[i + 3] = bytes[i];
  }
  return out;
}

export { BLOCK };
