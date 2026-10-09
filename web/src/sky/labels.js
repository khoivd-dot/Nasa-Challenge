// 2D canvas overlay: constellation names, grid labels, ecliptic / galactic
// plane captions, deep-field markers and the live "SPHEREx" scan reticle.

import { radecToVec, eclipticToEquatorial, galacticToEquatorial } from '../data/sky-math.js';

const FONT = '"Inter", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

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
      ctx.fillStyle = `rgba(178, 192, 240, ${0.62 * p.vis})`;
      ctx.fillText(text, p.x, p.y);
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  if (o.ecliptic) curveLabel(ctx, cam, o, ECL, 'Ecliptic', 'rgba(255, 196, 120, 0.85)', inView);
  if (o.galactic) curveLabel(ctx, cam, o, GAL, 'Galactic plane', 'rgba(205, 160, 255, 0.85)', inView);

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
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 * a})`;
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
      ctx.fillStyle = `rgba(232, 236, 255, ${a})`;
      ctx.textAlign = side > 0 ? 'left' : 'right';
      shadowText(ctx, label, p.x + side * (r * 0.71 + 18), ly);
    }
  }

  if (o.reticle) {
    const p = cam.project(o.reticle.v);
    if (p.vis > 0.3 && inView(p, -20)) {
      const t = o.reticle.phase;
      const a = p.vis;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * a})`;
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
      ctx.strokeStyle = `rgba(92, 225, 255, ${(1 - t) * 0.8 * a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8 + t * 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `600 10px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(232, 236, 255, ${0.9 * a})`;
      if (free(p.x + 16, p.y - 7, p.x + 72, p.y + 7)) shadowText(ctx, 'SPHEREx', p.x + 18, p.y);
    }
  }
}

function shadowText(ctx, text, x, y) {
  const fill = ctx.fillStyle;
  ctx.fillStyle = 'rgba(2, 4, 12, 0.75)';
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
    ctx.fillStyle = `rgba(150, 170, 230, ${0.75 * p.vis})`;
    shadowText(ctx, fmtRa(ra, sRa), p.x + 3, p.y - 2);
  }
  ctx.textBaseline = 'top';
  for (let dec = -90 + sDec; dec < 90; dec += sDec) {
    if (Math.abs(dec - decLab) < 1e-6) continue;
    const p = cam.projectRaDec(raLab, dec);
    if (p.vis < 0.5 || !inView(p, 12)) continue;
    ctx.fillStyle = `rgba(150, 170, 230, ${0.75 * p.vis})`;
    shadowText(ctx, `${dec > 0 ? '+' : dec < 0 ? '−' : ''}${Math.abs(dec)}°`, p.x + 3, p.y + 2);
  }
}

function fmtRa(ra, step) {
  const totalMin = Math.round((ra / 15) * 60);
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return step >= 15 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}m`;
}

function curveLabel(ctx, cam, o, pts, text, color, inView) {
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
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return;
  const p = proj[best];
  const q = proj[(best + 1) % proj.length];
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
