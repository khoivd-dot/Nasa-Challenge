// 2D canvas overlay: constellation names, grid labels, ecliptic / galactic
// plane captions, deep-field markers and the live "SPHEREx" scan reticle. In
// the ground view also the compass points, the Sun, the Moon and the planets.

import { radecToVec, eclipticToEquatorial, galacticToEquatorial } from '../data/sky-math.js';
import { SODIUM, PLATE, NIGHT, ICE, SUNPATH, alpha } from '../ui/palette.js';

const FONT = '"Archivo Variable", system-ui, sans-serif';
const DEG = Math.PI / 180;
const PAL = {
  accent: SODIUM.base,
  text2: PLATE[1],
  tickMajor: alpha(PLATE[0], 0.42),
  tickMinor: alpha(PLATE[0], 0.2),
};
const paper = (a) => alpha(PLATE[0], a);
const MONO = '"Overpass Mono", ui-monospace, monospace';

// Sample points along the two reference great circles, once.
const ECL = [];
const GAL = [];
for (let l = 0; l < 360; l += 2) {
  ECL.push(radecToVec(...eclipticToEquatorial(l, 0)));
  GAL.push(radecToVec(...galacticToEquatorial(l, 0)));
}

export function drawOverlay(ctx, cam, o) {
  const { dpr, W, H } = o;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const avoid = o.avoid || [];
  const inView = (p, m = 0) =>
    p.x > o.x0 + m && p.x < W - m && p.y > m && p.y < H - m && !avoid.some((r) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1);
  // Is a text box free of HUD panels and inside the view?
  const free = (x0, y0, x1, y1) =>
    x0 > o.x0 && x1 < W && y0 > 0 && y1 < H && !avoid.some((r) => x1 > r.x0 && x0 < r.x1 && y1 > r.y0 && y0 < r.y1);

  if (o.bezel) drawBezel(ctx, cam, o);
  if (o.grid) drawGridLabels(ctx, cam, o, inView);

  if (o.constellations && o.constLabels) {
    const fov = cam.fov();
    const maxRank = fov > 120 ? 1 : fov > 60 ? 2 : 3;
    ctx.font = `500 10.5px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.6px';
    for (const [name, ra, dec, rank] of o.constLabels) {
      if (rank > maxRank) continue;
      const p = cam.projectRaDec(ra, dec);
      if (p.vis < 0.3 || !inView(p, 10)) continue;
      const text = name.toUpperCase();
      const w = ctx.measureText(text).width / 2;
      if (!free(p.x - w, p.y - 7, p.x + w, p.y + 7)) continue;
      ctx.fillStyle = paper(0.55 * p.vis);
      ctx.fillText(text, p.x, p.y);
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  const taken = [];
  if (o.galactic) curveLabel(ctx, cam, GAL, 'Galactic plane', alpha(ICE, 0.85), inView, taken);
  if (o.ecliptic) curveLabel(ctx, cam, ECL, 'Ecliptic', alpha(SUNPATH, 0.9), inView, taken);

  if (o.footprints) {
    ctx.font = `500 11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const [label, ra, dec] of [
      ['North Ecliptic Pole deep field', 270, 66.5607],
      ['South Ecliptic Pole deep field', 90, -66.5607],
    ]) {
      const p = cam.projectRaDec(ra, dec);
      if (p.vis < 0.5 || !inView(p, 20)) continue;
      const a = p.vis * 0.9;
      const r = Math.max(10, Math.min(60, (cam.R * 5 * Math.PI) / 180 * (1 - cam.morph) + cam.S * 0.09 * cam.morph));
      ctx.strokeStyle = paper(0.35 * a);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const tw = ctx.measureText(label).width;
      const ly = p.y - r * 0.71 - 14;
      let side = 0;
      for (const sgn of [1, -1]) {
        const ax = p.x + sgn * (r * 0.71 + 18);
        if (free(sgn > 0 ? ax : ax - tw, ly - 8, sgn > 0 ? ax + tw : ax, ly + 8)) {
          side = sgn;
          break;
        }
      }
      if (!side) continue;
      ctx.beginPath();
      ctx.moveTo(p.x + side * r * 0.71, p.y - r * 0.71);
      ctx.lineTo(p.x + side * (r * 0.71 + 14), ly);
      ctx.stroke();
      ctx.fillStyle = paper(a);
      ctx.textAlign = side > 0 ? 'left' : 'right';
      shadowText(ctx, label, p.x + side * (r * 0.71 + 18), ly);
    }
  }

  if (o.reticle) {
    const p = cam.project(o.reticle.v);
    if (p.vis > 0.3 && inView(p, -20)) {
      const t = o.reticle.phase;
      const a = p.vis;
      ctx.strokeStyle = paper(0.9 * a);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const ang = (k * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(ang) * 9, p.y + Math.sin(ang) * 9);
        ctx.lineTo(p.x + Math.cos(ang) * 14, p.y + Math.sin(ang) * 14);
        ctx.stroke();
      }
      ctx.strokeStyle = alpha(SODIUM.base, (1 - t) * 0.8 * a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8 + t * 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `600 10px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = paper(0.9 * a);
      if (free(p.x + 16, p.y - 7, p.x + 72, p.y + 7)) shadowText(ctx, 'SPHEREx', p.x + 18, p.y);
    }
  }

  if (o.ground) drawGround(ctx, cam, o, o.ground, free);
}

// A graduated bezel around the globe, like the setting circle of a telescope:
// ticks every 5 degrees of position angle (north up, east left, as the sky is
// seen from inside), cardinal letters, and an amber pointer to where SPHEREx
// is looking right now. Fades out as the globe unrolls into the map.
function drawBezel(ctx, cam, o) {
  const a = 1 - Math.min(1, cam.morph * 3);
  if (a <= 0.01) return;
  const R = cam.R;
  const { cx, cy } = cam;
  // Skip when zoomed so far in that the ring is off screen anyway.
  if (R > Math.hypot(o.W, o.H) * 1.5) return;
  const r0 = R + 6;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.lineWidth = 1;
  ctx.strokeStyle = PAL.tickMinor;
  ctx.beginPath();
  ctx.arc(cx, cy, r0, 0, Math.PI * 2);
  ctx.stroke();
  // Position angle from north through east: north is up, east is to the left.
  const at = (pa, r) => [cx - Math.sin(pa * DEG) * r, cy - Math.cos(pa * DEG) * r];
  ctx.beginPath();
  for (let pa = 0; pa < 360; pa += 5) {
    if (pa % 90 === 0) continue;
    const len = pa % 30 === 0 ? 8 : 4;
    const [x0, y0] = at(pa, r0);
    const [x1, y1] = at(pa, r0 + len);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.strokeStyle = PAL.tickMajor;
  ctx.stroke();
  ctx.font = `700 10px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [pa, t] of [
    [0, 'N'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
  ]) {
    const [x, y] = at(pa, r0 + 5);
    ctx.fillStyle = pa === 0 ? PAL.accent : PAL.text2;
    ctx.fillText(t, x, y + 0.5);
  }
  // SPHEREx's current pointing, projected onto the bezel.
  if (o.reticle) {
    const p = cam.project(o.reticle.v);
    const ang = Math.atan2(p.y - cy, p.x - cx);
    const r = r0 + 3;
    ctx.translate(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(9, -5);
    ctx.lineTo(9, 5);
    ctx.closePath();
    ctx.fillStyle = PAL.accent;
    ctx.fill();
  }
  ctx.restore();
}

// Compass points along the horizon, then the Sun, Moon and planets above it.
function drawGround(ctx, cam, o, g, free) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let k = 0; k < 8; k++) {
    const p = cam.project(cam.fromAltAz(k * 45, 0), false);
    if (p.vis < 0.3 || p.x < o.x0 + 8 || p.x > o.W - 8 || p.y < 8 || p.y > o.H - 8) continue;
    const main = k % 2 === 0;
    const text = g.compass(k * 45);
    ctx.font = main ? `600 15px ${FONT}` : `500 11px ${FONT}`;
    const w = ctx.measureText(text).width / 2 + 2;
    const y = p.y + 9;
    if (!free(p.x - w, y - 2, p.x + w, y + 18)) continue;
    ctx.strokeStyle = paper(0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + 1);
    ctx.lineTo(p.x, p.y + 6);
    ctx.stroke();
    ctx.fillStyle = k === 0 ? SODIUM.base : paper(main ? 0.9 : 0.6);
    ctx.fillText(text, p.x, y);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const sun = g.bodies[0];
  // Markers faint to bright so bright bodies stay on top; labels bright first so they win space.
  const order = g.bodies.slice(1).sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0));
  const labels = [];
  for (const b of [...order, sun]) {
    const p = cam.project(b.v);
    if (p.vis < 0.2 || p.x < o.x0 || p.x > o.W || p.y < 0 || p.y > o.H) continue;
    const a = p.vis;
    let r;
    if (b.kind === 'sun') {
      r = 9;
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
      glow.addColorStop(0, `rgba(255, 246, 220, ${a})`);
      glow.addColorStop(0.33, `rgba(255, 230, 170, ${0.9 * a})`);
      glow.addColorStop(1, 'rgba(255, 200, 120, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.kind === 'moon') {
      // Half a degree across, but never smaller than a readable disc.
      r = Math.max(7, (cam.R * 0.26 * Math.PI) / 360);
      drawMoon(ctx, cam, p, r, b, sun, a);
    } else if (b.kind === 'dwarf') {
      r = 4;
      ctx.strokeStyle = `rgba(216, 195, 165, ${0.85 * a})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      r = Math.max(1.8, Math.min(4.6, 3.2 - 0.45 * (b.mag ?? 2)));
      ctx.fillStyle = b.color;
      ctx.globalAlpha = a;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    labels.push({ b, p, r, a });
  }
  const placed = [];
  const clear = (x0, y0, x1, y1) => free(x0, y0, x1, y1) && placed.every((q) => x1 < q[0] || x0 > q[2] || y1 < q[1] || y0 > q[3]);
  for (const { b, p, r, a } of labels.reverse()) {
    const label = b.kind === 'moon' && b.lit !== null ? `Moon · ${Math.round(b.lit * 100)}% lit` : b.name;
    ctx.font = `${b.kind === 'dwarf' ? 500 : 600} 12px ${FONT}`;
    const tw = ctx.measureText(label).width;
    // Right of the marker, else left, else just below it.
    const spots = [
      [p.x + r + 6, p.y],
      [p.x - r - 6 - tw, p.y],
      [p.x - tw / 2, p.y + r + 12],
    ];
    const spot = spots.find(([x, y]) => clear(x - 2, y - 8, x + tw + 2, y + 8));
    if (!spot) continue;
    placed.push([spot[0] - 2, spot[1] - 8, spot[0] + tw + 2, spot[1] + 8]);
    ctx.fillStyle = b.kind === 'dwarf' ? `rgba(216, 195, 165, ${0.85 * a})` : `rgba(240, 243, 255, ${0.95 * a})`;
    shadowText(ctx, label, spot[0], spot[1]);
  }
}

// The Moon's lit side faces the Sun: half disc plus a terminator ellipse.
function drawMoon(ctx, cam, p, r, moon, sun, a) {
  const m = moon.v;
  const s = sun.v;
  const d = s[0] * m[0] + s[1] * m[1] + s[2] * m[2];
  const t = [s[0] - d * m[0], s[1] - d * m[1], s[2] - d * m[2]];
  const n = Math.hypot(...t) || 1;
  const q = cam.project([m[0] + (0.01 * t[0]) / n, m[1] + (0.01 * t[1]) / n, m[2] + (0.01 * t[2]) / n], false);
  const ang = Math.atan2(q.y - p.y, q.x - p.x);
  const k = moon.lit ?? 0.5;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(46, 52, 70, 0.95)';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#eef0f6';
  ctx.shadowColor = 'rgba(238, 240, 246, 0.6)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.ellipse(0, 0, r * Math.abs(1 - 2 * k), r, 0, Math.PI / 2, -Math.PI / 2, k < 0.5);
  ctx.fill();
  ctx.restore();
}

function shadowText(ctx, text, x, y) {
  const fill = ctx.fillStyle;
  ctx.fillStyle = alpha(NIGHT[0], 0.75);
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function viewCenter(cam) {
  if (cam.morph < 0.5) return [cam.ra, cam.dec];
  const v = cam.unprojectMap(cam.cx, cam.cy);
  if (!v) return [cam.lon0, 0];
  const ra = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  return [(ra + 360) % 360, (Math.asin(v[2]) * 180) / Math.PI];
}

function drawGridLabels(ctx, cam, o, inView) {
  const { ra: sRa, dec: sDec } = o.gridStep;
  const [cra, cdec] = viewCenter(cam);
  let decLab = Math.round(cdec / sDec) * sDec;
  decLab = Math.max(-90 + sDec, Math.min(90 - sDec, decLab));
  if (cam.morph > 0.5 && cam.mapZoom < 1.5) decLab = 0;
  const raLab = cam.morph > 0.5 && cam.mapZoom < 1.5 ? cam.lon0 : Math.round(cra / sRa) * sRa;
  ctx.font = `400 10px ${MONO}`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  for (let ra = 0; ra < 360; ra += sRa) {
    const p = cam.projectRaDec(ra, decLab);
    if (p.vis < 0.5 || !inView(p, 12)) continue;
    ctx.fillStyle = alpha(PLATE[1], 0.75 * p.vis);
    shadowText(ctx, fmtRa(ra, sRa), p.x + 3, p.y - 2);
  }
  ctx.textBaseline = 'top';
  for (let dec = -90 + sDec; dec < 90; dec += sDec) {
    if (Math.abs(dec - decLab) < 1e-6) continue;
    const p = cam.projectRaDec(raLab, dec);
    if (p.vis < 0.5 || !inView(p, 12)) continue;
    ctx.fillStyle = alpha(PLATE[1], 0.75 * p.vis);
    shadowText(ctx, `${dec > 0 ? '+' : dec < 0 ? '−' : ''}${Math.abs(dec)}°`, p.x + 3, p.y + 2);
  }
}

function fmtRa(ra, step) {
  const totalMin = Math.round((ra / 15) * 60);
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return step >= 15 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}m`;
}

function curveLabel(ctx, cam, pts, text, color, inView, taken) {
  // Place the caption at the visible sample closest to the view center.
  let best = -1;
  let bestD = Infinity;
  const proj = pts.map((v) => cam.project(v));
  const cx = cam.cx;
  const cy = cam.cy - (cam.morph < 0.5 ? cam.R * 0.25 : 0);
  for (let i = 0; i < proj.length; i++) {
    const p = proj[i];
    const q = proj[(i + 1) % proj.length];
    if (p.vis < 0.8 || q.vis < 0.8 || !inView(p, 60) || Math.hypot(q.x - p.x, q.y - p.y) > 200) continue;
    if (taken.some((t) => Math.hypot(p.x - t.x, p.y - t.y) < 140)) continue;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return;
  const p = proj[best];
  const q = proj[(best + 1) % proj.length];
  taken.push(p);
  let ang = Math.atan2(q.y - p.y, q.x - p.x);
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang < -Math.PI / 2) ang += Math.PI;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  ctx.font = `italic 500 11px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = color;
  shadowText(ctx, text, 4, -3);
  ctx.restore();
}
