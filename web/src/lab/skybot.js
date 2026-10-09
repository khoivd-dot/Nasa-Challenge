// Known asteroids and comets in a field at a given time, from the IMCCE SkyBoT
// cone-search service (Paris Observatory), which allows browser requests.
// Docs: https://ssp.imcce.fr/webservices/skybot/

const ENDPOINT = 'https://ssp.imcce.fr/webservices/skybot/api/conesearch.php';

export async function queryKnownObjects(ra, dec, radiusDeg, mjd, { signal } = {}) {
  const q = new URLSearchParams({
    '-ep': (mjd + 2400000.5).toFixed(6),
    '-ra': ra.toFixed(6),
    '-dec': dec.toFixed(6),
    '-rd': radiusDeg.toFixed(4),
    '-mime': 'text',
    '-output': 'object',
    '-loc': '500', // geocenter; SPHEREx's low orbit adds under 1″ of parallax for main-belt asteroids
    '-filter': '120',
    '-objFilter': '111',
    '-refsys': 'EQJ2000',
    '-from': 'Skyblink',
  });
  const res = await fetch(`${ENDPOINT}?${q}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseSkybot(await res.text());
}

/** Parse SkyBoT's pipe-separated text output into [{name, ra, dec, cls, mag}]. */
export function parseSkybot(text) {
  const lines = text.split('\n');
  const header = lines.find((l) => l.startsWith('#') && /Name/.test(l) && l.includes('|'));
  if (!header) return [];
  const cols = header
    .replace(/^#\s*/, '')
    .split('|')
    .map((c) => c.trim().toLowerCase());
  const idx = (re) => cols.findIndex((c) => re.test(c));
  const iName = idx(/^name/);
  const iRa = idx(/^ra/);
  const iDe = idx(/^de/);
  const iCls = idx(/^class/);
  const iMag = idx(/^mv/);
  const iNum = idx(/^num/);
  const raInHours = /\(h\)/.test(cols[iRa] || '');
  const out = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const f = line.split('|').map((s) => s.trim());
    if (f.length < cols.length - 1) continue;
    const ra = sexagesimal(f[iRa]) * (raInHours ? 15 : 1);
    const dec = sexagesimal(f[iDe]);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
    const num = iNum >= 0 && f[iNum] && f[iNum] !== '-' ? `(${f[iNum]}) ` : '';
    out.push({ name: `${num}${f[iName]}`, ra, dec, cls: iCls >= 0 ? f[iCls] : '', mag: iMag >= 0 ? f[iMag] : '' });
  }
  return out;
}

function sexagesimal(s) {
  if (!s) return NaN;
  const parts = s.trim().split(/[\s:]+/).map(Number);
  if (parts.length === 1) return parts[0];
  const neg = /^-/.test(s.trim());
  const [a, b = 0, c = 0] = parts.map(Math.abs);
  const v = a + b / 60 + c / 3600;
  return neg ? -v : v;
}
