// Automatic plate and food detection (T-014, ADR 0005): pure mask post-processing plus the detection pipeline over an injected model.
// Masks are { width, height, data: Uint8Array } (nonzero = inside) with an optional `score` (SAM's predicted IoU).
// No DOM and no model here, so Node tests it (web/estimate/autoseg-selftest.mjs); the browser runs a copy (web/sync-data.mjs
// copies it to web/app/vendor/autoseg.mjs, rewriting the core import to the vendored name).
// Spec: docs/specs/SPEC-T-014-auto-mode.md. Every threshold is an assumption in priors.json (section "autoseg").
import { fitEllipse, NAME_PROMPT, namePrompts, topNames } from './estimate-core.mjs';

/** Pixel count and inclusive bounding box in one pass; box is null for an empty mask. */
function stats(mask) {
  const { width, height, data } = mask;
  let n = 0; let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!data[row + x]) continue;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { n, box: x1 < 0 ? null : { x0, y0, x1, y1 } };
}
const sameSize = (a, b) => a.width === b.width && a.height === b.height;

/** Number of pixels in both masks, scanning only the overlap of the two boxes. */
function intersection(a, sa, b, sb) {
  if (!sameSize(a, b)) throw new Error('máscaras de tamanhos diferentes');
  if (!sa.box || !sb.box) return 0;
  const x0 = Math.max(sa.box.x0, sb.box.x0); const x1 = Math.min(sa.box.x1, sb.box.x1);
  const y0 = Math.max(sa.box.y0, sb.box.y0); const y1 = Math.min(sa.box.y1, sb.box.y1);
  let n = 0;
  for (let y = y0; y <= y1; y++) { const row = y * a.width; for (let x = x0; x <= x1; x++) if (a.data[row + x] && b.data[row + x]) n++; }
  return n;
}
const iouFrom = (a, sa, b, sb) => { const i = intersection(a, sa, b, sb); const u = sa.n + sb.n - i; return u > 0 ? i / u : 0; };
const withData = (mask, data) => ({ ...mask, data });

// ---------------------------------------------------------------- prompts
/**
 * An n x n grid of point prompts at cell centres, row by row: x = (i + 0.5) w / n, y = (j + 0.5) h / n.
 * With `insideEllipse` ({ cx, cy, a, b, angle_rad } from fitEllipse) only points inside the ellipse are kept.
 */
export function gridPoints(w, h, n, { insideEllipse = null } = {}) {
  if (!(n >= 1) || !(w > 0) || !(h > 0)) throw new Error('grade inválida');
  const pts = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push({ x: (i + 0.5) * w / n, y: (j + 0.5) * h / n });
  if (!insideEllipse) return pts;
  const { cx, cy, a, b, angle_rad } = insideEllipse; const c = Math.cos(angle_rad); const s = Math.sin(angle_rad);
  return pts.filter((p) => {
    const u = (p.x - cx) * c + (p.y - cy) * s; const v = -(p.x - cx) * s + (p.y - cy) * c;
    return (u / a) ** 2 + (v / b) ** 2 <= 1;
  });
}

// ---------------------------------------------------------------- overlap, dedupe, ellipse residual
/** Intersection over union of two masks of the same size (0 when both are empty). */
export const maskIoU = (a, b) => iouFrom(a, stats(a), b, stats(b));

/** Drops empty masks and near-duplicates (IoU > iouThr), keeping the higher predicted IoU (`score`); result is best score first. */
export function dedupe(masks, iouThr) {
  const order = masks.map((m, i) => ({ m, i, s: stats(m) })).filter((e) => e.s.n > 0).sort((p, q) => (q.m.score ?? 0) - (p.m.score ?? 0) || p.i - q.i);
  const kept = [];
  for (const e of order) if (kept.every((k) => iouFrom(k.m, k.s, e.m, e.s) <= iouThr)) kept.push(e);
  return kept.map((e) => e.m);
}

/**
 * Normalized mismatch between a mask and its moment-fitted ellipse: 1 - IoU(mask, ellipse). 0 is a perfect ellipse, 1 no overlap.
 * A plate seen at a tilt is an ellipse, so its residual is small; a table, a napkin or a fork is not.
 */
export function ellipseResidual(mask) {
  const { n } = stats(mask);
  if (n < 3) return 1;
  const e = fitEllipse(mask); const c = Math.cos(e.angle_rad); const s = Math.sin(e.angle_rad);
  const ex = Math.sqrt((e.a * c) ** 2 + (e.b * s) ** 2); const ey = Math.sqrt((e.a * s) ** 2 + (e.b * c) ** 2);
  const x0 = Math.max(0, Math.floor(e.cx - ex)); const x1 = Math.min(mask.width - 1, Math.ceil(e.cx + ex));
  const y0 = Math.max(0, Math.floor(e.cy - ey)); const y1 = Math.min(mask.height - 1, Math.ceil(e.cy + ey));
  let inter = 0; let ell = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const u = (x - e.cx) * c + (y - e.cy) * s; const v = -(x - e.cx) * s + (y - e.cy) * c;
    if ((u / e.a) ** 2 + (v / e.b) ** 2 > 1) continue;
    ell++; if (mask.data[y * mask.width + x]) inter++;
  }
  const union = n + ell - inter;
  return union > 0 ? 1 - inter / union : 1;
}

// ---------------------------------------------------------------- plate
/**
 * The plate: among the candidate masks that cover enough of the photo (not nearly all of it), cover the central box of the photo and are
 * ellipse-shaped (residual <= maxResidual), the one most other passing masks agree with (same box and area within supportIou: SAM returns the real plate
 * from many prompts, a table band or placemat hull from one or two), the largest on a tie. Each mask is tried as it is, with its holes filled (SAM returns the plate without its food), and, when
 * that fails, as the region a large mask encloses (SAM returns the table AS a mask, the plate is its hole: `via: 'hole'`) and as the convex hull of a
 * ring (SAM returns the plate rim as an almost closed ring around the food: `via: 'ring'`). Returns
 * { mask, source, index, residual, area_frac, filled, via, support, ellipse } or null (no plate found); support = how many passing masks agree with it.
 * opts: minAreaFrac, maxAreaFrac, centerFrac (side of the central box), centerCoverMin (share of that box inside the mask), maxResidual, supportIou (default 0.85),
 * and for the ring: ringMinArc (share of the angular sectors a ring must reach), ringMinBand (share of its pixels in the rim band), ringBandLo (inner radius of the boundary band), ringSectors.
 * `evals` (optional) are the masks already judged by plateEvals, so the diagnostics and the choice share one pass.
 */
export function selectPlate(masks, opts, evals = plateEvals(masks, opts, false)) {
  const ok = []; evals.forEach((e, index) => { if (e.verdict === 'ok') ok.push({ ...e, index, box: stats(e.mask).box }); });
  if (!ok.length) return null;
  const thr = opts.supportIou ?? 0.85;
  const agree = (p, q) => Math.min(p.n, q.n) / Math.max(p.n, q.n) >= thr && boxIoU(p.box, q.box) >= thr;
  for (const p of ok) p.support = ok.reduce((k, q) => k + (agree(p, q) ? 1 : 0), 0);
  const best = ok.reduce((p, q) => (q.support > p.support || (q.support === p.support && q.n > p.n) ? q : p));
  return { mask: best.mask, source: best.source, index: best.index, residual: best.residual, area_frac: best.area_frac, filled: best.mask !== best.source, via: best.via, support: best.support, ellipse: fitEllipse(best.mask) };
}
/** Every mask judged as a plate (bestPlateVariant); `full` computes every number for the diagnostics. */
export const plateEvals = (masks, opts, full) => masks.map((raw) => bestPlateVariant(raw, opts, full));
const boxIoU = (a, b) => {
  const iw = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1; const ih = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
  if (iw <= 0 || ih <= 0) return 0;
  const area = (r) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); const i = iw * ih; return i / (area(a) + area(b) - i);
};

/** Background pixels that reach the photo border through background (4-connected): 1 = outside. Everything else that is 0 in the mask is enclosed. */
function outsideOf(mask) {
  const { width: w, height: h, data } = mask; const outside = new Uint8Array(w * h); const stack = [];
  const push = (i) => { if (!data[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop(); const x = i % w;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w);
  }
  return outside;
}
/**
 * Fills the holes of a mask: background pixels that cannot reach the photo border through background (4-connected). SAM often returns a plate
 * WITHOUT its food (the food is a hole in the mask), and the plate is what carries the scale, so it is judged and used with its food in it.
 * Returns the same mask object when there is no hole; otherwise a copy (score and other fields kept).
 */
export function fillHoles(mask) {
  const { data } = mask; const outside = outsideOf(mask);
  let holes = 0; for (let i = 0; i < data.length; i++) if (!data[i] && !outside[i]) holes++;
  if (!holes) return mask;
  const out = new Uint8Array(data); for (let i = 0; i < out.length; i++) if (!out[i] && !outside[i]) out[i] = 1;
  return withData(mask, out);
}
/** The enclosed regions of a mask (its holes, one mask each, at least minPixels pixels; score kept): what SAM leaves inside a mask of the TABLE is the plate. */
export function enclosedRegions(mask, minPixels = 1) {
  const { width: w, height: h, data } = mask; const outside = outsideOf(mask); const seen = new Uint8Array(w * h); const out = [];
  for (let s = 0; s < data.length; s++) {
    if (data[s] || outside[s] || seen[s]) continue;
    const comp = []; const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const i = stack.pop(); comp.push(i); const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) if (j >= 0 && !data[j] && !outside[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    if (comp.length >= minPixels) { const d = new Uint8Array(w * h); for (const i of comp) d[i] = 1; out.push(withData(mask, d)); }
  }
  return out;
}
/** The convex hull of a mask's pixels as a filled mask (score kept). A ring that does not close, or a plate with a bite, becomes the whole disc. */
export function convexHull(mask) {
  const { width: w, height: h, data } = mask; const pts = [];
  for (let y = 0; y < h; y++) {
    let x0 = -1; let x1 = -1; const row = y * w;
    for (let x = 0; x < w; x++) if (data[row + x]) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 >= 0) { pts.push([x0, y]); if (x1 !== x0) pts.push([x1, y]); }
  }
  if (pts.length < 3) return mask;
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => { const s = []; for (const p of list) { while (s.length >= 2 && cross(s[s.length - 2], s[s.length - 1], p) <= 0) s.pop(); s.push(p); } s.pop(); return s; };
  const poly = [...half(pts), ...half([...pts].reverse())];
  const out = new Uint8Array(w * h); let y0 = h; let y1 = -1; for (const p of poly) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  for (let y = y0; y <= y1; y++) {
    let xl = Infinity; let xr = -Infinity;
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k]; const q = poly[(k + 1) % poly.length];
      if ((y < p[1] && y < q[1]) || (y > p[1] && y > q[1])) continue;
      if (p[1] === q[1]) { xl = Math.min(xl, p[0], q[0]); xr = Math.max(xr, p[0], q[0]); continue; }
      const x = p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]); if (x < xl) xl = x; if (x > xr) xr = x;
    }
    for (let x = Math.ceil(xl - 1e-9); x <= Math.floor(xr + 1e-9); x++) if (x >= 0 && x < w) out[y * w + x] = 1;
  }
  return withData(mask, out);
}
/**
 * How a mask sits on an ellipse's rim: `arc` = the share of `sectors` equal angular sectors (around the ellipse centre, in the ellipse's own frame) in
 * which the mask has pixels in the boundary band (radius bandLo to 1.1 of the ellipse); `band` = the share of the mask's pixels that lie in that band.
 * A plate rim is a ring: it reaches (almost) all the way around AND nearly all of it is in the band. A placemat cross can reach every sector too, but
 * most of it is inside or outside the band; a heap of food reaches almost no sector.
 */
export function ringFit(mask, ellipse, { sectors = 16, bandLo = 0.6 } = {}) {
  const { width: w, height: h, data } = mask; const { cx, cy, a, b, angle_rad: ang } = ellipse; const c = Math.cos(ang); const s = Math.sin(ang); const hit = new Uint8Array(sectors);
  let all = 0; let inBand = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!data[y * w + x]) continue;
    all++;
    const u = ((x - cx) * c + (y - cy) * s) / a; const v = (-(x - cx) * s + (y - cy) * c) / b; const rho = Math.hypot(u, v);
    if (rho >= bandLo && rho <= 1.1) { inBand++; hit[Math.min(sectors - 1, Math.floor(((Math.atan2(v, u) + Math.PI) / (2 * Math.PI)) * sectors))] = 1; }
  }
  let n = 0; for (const k of hit) n += k;
  return { arc: n / sectors, band: all ? inBand / all : 0 };
}
/** ringFit(...).arc: how much of the way around the ellipse the mask reaches (1 = a closed annulus, 0.5 a half ring). */
export const arcCoverage = (mask, ellipse, opts) => ringFit(mask, ellipse, opts).arc;
/** A mask is the plate rim when it reaches ringMinArc of the way around the ellipse and at least ringMinBand of it lies in the rim band. */
export const isRing = (mask, ellipse, { ringMinArc, ringMinBand = 0, ringBandLo, ringSectors }) => {
  const r = ringFit(mask, ellipse, { sectors: ringSectors, bandLo: ringBandLo }); return r.arc >= ringMinArc && r.band >= ringMinBand;
};

/**
 * One mask judged as a plate: after filling its holes, its area share of the photo, the share of the central box it covers, its ellipse residual.
 * verdict: 'ok' or the first rule it fails ('empty', 'too_small', 'too_large', 'off_center', 'not_ellipse'). Without `full` the checks stop at
 * the first failing rule (residual is left null); with it every number is computed (diagnostics).
 */
function evalPlate(raw, { minAreaFrac, maxAreaFrac = 1, centerFrac, centerCoverMin, maxResidual }, full) {
  const total = raw.width * raw.height; const n0 = stats(raw).n;
  const row = { source: raw, mask: raw, n: n0, area_frac: n0 / total, cover: null, residual: null, verdict: 'ok' };
  if (n0 === 0) return { ...row, verdict: 'empty' };
  if (row.area_frac < minAreaFrac / 2) return { ...row, verdict: 'too_small' }; // cheap exit: filling holes cannot make a tiny mask a plate
  const mask = fillHoles(raw); const n = mask === raw ? n0 : stats(mask).n; Object.assign(row, { mask, n, area_frac: n / total });
  const fail = (v) => { if (row.verdict === 'ok') row.verdict = v; };
  if (row.area_frac < minAreaFrac) fail('too_small'); else if (row.area_frac > maxAreaFrac) fail('too_large');
  const bx0 = Math.floor(mask.width * (1 - centerFrac) / 2); const bx1 = Math.ceil(mask.width * (1 + centerFrac) / 2) - 1;
  const by0 = Math.floor(mask.height * (1 - centerFrac) / 2); const by1 = Math.ceil(mask.height * (1 + centerFrac) / 2) - 1;
  let inBox = 0; let cells = 0;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { cells++; if (mask.data[y * mask.width + x]) inBox++; }
  row.cover = cells ? inBox / cells : 0;
  if (cells === 0 || row.cover < centerCoverMin) fail('off_center');
  if (row.verdict === 'ok' || full) { row.residual = ellipseResidual(mask); if (row.residual > maxResidual) fail('not_ellipse'); }
  return row;
}
/**
 * evalPlate of the mask as it is (`via` 'raw', or 'filled' when holes were filled) and, when that is not a plate but the mask is big enough to matter,
 * of its enclosed regions ('hole') and of the hull of a ring ('ring': the hull must pass the same rules AND the mask must reach ringMinArc of the way
 * around the hull's ellipse). The largest variant that passes wins; otherwise the plain evaluation is returned, so the diagnostics show the raw reason.
 */
function bestPlateVariant(raw, opts, full) {
  const base = evalPlate(raw, opts, full); base.via = base.mask === raw ? 'raw' : 'filled';
  if (base.verdict === 'ok' || base.verdict === 'empty' || opts.variants === false || raw.width * raw.height * opts.minAreaFrac / 2 > stats(raw).n) return base;
  const total = raw.width * raw.height; let best = null;
  const take = (e, via) => { if (e.verdict === 'ok' && (!best || e.n > best.n)) best = { ...e, source: raw, via }; };
  for (const region of enclosedRegions(raw, Math.ceil(total * opts.minAreaFrac))) take(evalPlate(region, opts, false), 'hole');
  if (opts.ringMinArc !== undefined) {
    const hull = convexHull(raw); const hv = hull === raw ? null : evalPlate(hull, opts, false);
    if (hv && hv.verdict === 'ok' && isRing(raw, fitEllipse(hull), opts)) take(hv, 'ring');
  }
  return best ?? base;
}
/**
 * Why each mask is or is not the plate, for the CI summary (T-017): [{ x, y, score, area_frac, area_raw, cover, residual, residual_raw, verdict, via }]
 * (x, y = the prompt point when the mask carries one). area_raw and residual_raw are before the holes are filled; via says how a passing mask
 * became a plate (raw, filled, hole, ring). Same options as selectPlate; `evals` = plateEvals(masks, opts, true) when already computed.
 */
export function plateDiagnostics(masks, opts, evals = plateEvals(masks, opts, true)) {
  const r = (v) => (v === null ? null : Math.round(v * 1000) / 1000);
  return masks.map((raw, i) => {
    const e = evals[i]; const total = raw.width * raw.height;
    return { x: raw.point ? Math.round(raw.point.x) : null, y: raw.point ? Math.round(raw.point.y) : null, score: r(raw.score ?? 0), area_frac: r(e.area_frac), area_raw: r(stats(raw).n / total),
      cover: r(e.cover), residual: r(e.residual), residual_raw: e.mask === raw ? r(e.residual) : (e.n && e.via === 'filled' ? r(ellipseResidual(raw)) : null), verdict: e.verdict, via: e.via };
  });
}

// ---------------------------------------------------------------- foods
/**
 * Food candidates: predicted IoU >= minPredIoU, mask area between minFrac and maxFrac of the plate area (the part on the plate),
 * at least minInsideFrac of the mask on the plate (so a table or hand mask is out), and never the plate mask itself.
 * `plate` is a selectPlate result or a mask. With plateDupIou (< 1) a mask whose IoU with the plate is above it is the plate itself and is dropped
 * (SAM returns the plate with and without its food). Returns copies with plate_frac and inside_frac attached.
 */
export function filterFoods(masks, plate, { minFrac, maxFrac, minPredIoU, minInsideFrac = 0, plateDupIou = 1, ringMinArc, ringMinBand, ringBandLo, ringSectors }, onDrop = () => {}) {
  const pm = plate.mask ?? plate; const ps = stats(pm); const src = plate.source ?? null;
  if (ps.n === 0) return [];
  const out = [];
  for (const m of masks) {
    if (m === pm || m === src || m.data === pm.data) { onDrop(m, 'plate'); continue; }
    if ((m.score ?? 0) < minPredIoU) { onDrop(m, 'low_score'); continue; }
    const sm = stats(m); if (sm.n === 0) { onDrop(m, 'empty'); continue; }
    const inter = intersection(m, sm, pm, ps);
    const plateFrac = inter / ps.n; const inside = inter / sm.n;
    if (plateDupIou < 1 && inter / (ps.n + sm.n - inter) > plateDupIou) { onDrop(m, 'plate'); continue; } // the plate again (with or without its food), not a food
    if (ringMinArc !== undefined && plate.ellipse && isRing(m, plate.ellipse, { ringMinArc, ringMinBand, ringBandLo, ringSectors })) { onDrop(m, 'rim'); continue; } // the plate rim, not a food
    if (plateFrac < minFrac) { onDrop(m, 'too_small'); continue; }
    if (plateFrac > maxFrac) { onDrop(m, 'too_large'); continue; }
    if (inside < minInsideFrac) { onDrop(m, 'off_plate'); continue; }
    out.push({ ...m, plate_frac: plateFrac, inside_frac: inside });
  }
  return out;
}
/**
 * Why each food-grid mask is or is not an item (the Diagnóstico panel and the CI summary): [{ x, y, score, frac, verdict }], frac = share of the
 * plate (or of the photo without a plate). verdict: kept (item k), duplicate, plate, rim, low_score, too_small, too_large, off_plate, background,
 * overlap (lost its pixels to a better mask), over_max (beyond max_food_items).
 */
function foodRows(raw, drops, kept, resolved, areaOf) {
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return raw.map((m) => {
    const k = kept.findIndex((q) => q._r === m._r); const inRes = resolved.some((q) => q._r === m._r);
    const verdict = k >= 0 ? `kept ${k}` : drops.get(m._r) ?? (inRes ? 'over_max' : 'overlap');
    return { x: m.point ? Math.round(m.point.x) : null, y: m.point ? Math.round(m.point.y) : null, score: r3(m.score ?? 0), frac: r3(areaOf(m)), verdict };
  });
}

/** Every pixel goes to the mask with the highest predicted IoU (ties: the earlier one); masks left empty are dropped. Inputs are not modified. */
export function resolveOverlaps(masks) {
  if (!masks.length) return [];
  const len = masks[0].data.length; const owner = new Int32Array(len).fill(-1);
  const order = masks.map((m, i) => i).sort((p, q) => (masks[q].score ?? 0) - (masks[p].score ?? 0) || p - q);
  for (const i of order) { const d = masks[i].data; for (let k = 0; k < len; k++) if (d[k] && owner[k] < 0) owner[k] = i; }
  const out = [];
  masks.forEach((m, i) => {
    const data = new Uint8Array(len); let n = 0;
    for (let k = 0; k < len; k++) if (owner[k] === i) { data[k] = 1; n++; }
    if (n > 0) out.push({ ...withData(m, data), pixels: n });
  });
  return out;
}

/** Chebyshev dilation by r pixels (a (2r+1) square), restricted to the mask box grown by r. Returns a full-size 0/1 array. */
function dilate(mask, sm, r) {
  const { width, height } = mask; const out = new Uint8Array(width * height);
  if (!sm.box) return out;
  const x0 = Math.max(0, sm.box.x0 - r); const x1 = Math.min(width - 1, sm.box.x1 + r); const y0 = Math.max(0, sm.box.y0 - r); const y1 = Math.min(height - 1, sm.box.y1 + r);
  const tmp = new Uint8Array(width * height);
  for (let y = sm.box.y0; y <= sm.box.y1; y++) for (let x = sm.box.x0; x <= sm.box.x1; x++) if (mask.data[y * width + x]) for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= x0 && xx <= x1) tmp[y * width + xx] = 1; }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (tmp[y * width + x]) for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= y0 && yy <= y1) out[yy * width + x] = 1; }
  return out;
}

/**
 * Items are { label, mask, score, ... } where label is the top-1 name. Items with the same label whose masks are within adjacencyPx
 * (Chebyshev distance, so touching counts) are merged: union mask, best score, the best member's fields, and `parts` = the original
 * items (so the UI can split them again). Order follows the first member of each group.
 */
export function mergeSameLabel(items, adjacencyPx) {
  const st = items.map((it) => stats(it.mask)); const parent = items.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < items.length; i++) {
    let grown = null;
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].label !== items[j].label || find(i) === find(j) || !st[i].box || !st[j].box) continue;
      const bi = st[i].box; const bj = st[j].box;
      if (bj.x0 > bi.x1 + adjacencyPx || bj.x1 < bi.x0 - adjacencyPx || bj.y0 > bi.y1 + adjacencyPx || bj.y1 < bi.y0 - adjacencyPx) continue;
      grown ??= dilate(items[i].mask, st[i], adjacencyPx);
      let touch = false; const { width } = items[j].mask;
      for (let y = bj.y0; y <= bj.y1 && !touch; y++) for (let x = bj.x0; x <= bj.x1; x++) if (grown[y * width + x] && items[j].mask.data[y * width + x]) { touch = true; break; }
      if (touch) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  items.forEach((it, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  return [...groups.values()].map((idx) => {
    if (idx.length === 1) return items[idx[0]];
    const members = idx.map((i) => items[i]); const best = members.reduce((p, q) => ((q.score ?? 0) > (p.score ?? 0) ? q : p));
    const data = new Uint8Array(best.mask.data.length);
    for (const it of members) for (let k = 0; k < data.length; k++) if (it.mask.data[k]) data[k] = 1;
    return { ...best, mask: withData(best.mask, data), score: best.score, parts: members };
  });
}

/** The SigLIP prompt of each non-food label, in the same form as the food prompts (core.NAME_PROMPT). */
export const nonFoodPrompts = (labels) => labels.map((l) => NAME_PROMPT(l));

/**
 * scores[i] = [{ label: prompt, score }] for items[i] over the food prompts and the non-food prompts. An item whose best-scoring
 * prompt is a non-food prompt is rejected. Returns { foods, rejected }, each item copied with best_label and best_score.
 */
export function rejectNonFood(items, scores, nonFoodLabelPrompts) {
  if (scores.length !== items.length) throw new Error('uma lista de pontuações por item');
  const bad = new Set(nonFoodLabelPrompts); const foods = []; const rejected = [];
  items.forEach((it, i) => {
    const best = scores[i].reduce((p, q) => (q.score > p.score ? q : p), { label: null, score: -Infinity });
    (bad.has(best.label) ? rejected : foods).push({ ...it, best_label: best.label, best_score: best.score });
  });
  return { foods, rejected };
}

// ---------------------------------------------------------------- plate scale prior
// ---------------------------------------------------------------- pipeline
/** A filled ellipse ({ cx, cy, a, b, angle_rad }) as a 0/1 mask of the photo size. */
export function ellipseMask(e, width, height) {
  const data = new Uint8Array(width * height); const c = Math.cos(e.angle_rad ?? 0); const s = Math.sin(e.angle_rad ?? 0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const u = (x - e.cx) * c + (y - e.cy) * s; const v = -(x - e.cx) * s + (y - e.cy) * c; if ((u / e.a) ** 2 + (v / e.b) ** 2 <= 1) data[y * width + x] = 1; }
  return { width, height, data };
}
/**
 * The stand-in for a plate that was not found (zero setup: never ask for a tap): a CIRCLE (no tilt is known) centred on the food, with the radius
 * of the food region's moment ellipse times spanFactor, i.e. the food is assumed to span a typical plate. With no food, a circle of defaultFrac x
 * the short side of the photo at its centre. Shaped like a selectPlate result plus `synthetic: true`; the scale from it is approximate, and the
 * caller must say so ("prato não detectado — escala aproximada") and use the wider no-plate scale uncertainty.
 */
export function syntheticPlate(foodMasks, width, height, { spanFactor = 1.15, defaultFrac = 0.8 } = {}) {
  let cx = width / 2; let cy = height / 2; let r = defaultFrac * Math.min(width, height) / 2;
  if (foodMasks.length) {
    const union = new Uint8Array(width * height); for (const m of foodMasks) for (let i = 0; i < union.length; i++) if (m.data[i]) union[i] = 1;
    const e = fitEllipse({ width, height, data: union }); cx = e.cx; cy = e.cy; r = Math.sqrt(e.a * e.b) * spanFactor;
  }
  const ellipse = { cx, cy, a: r, b: r, angle_rad: 0 }; const mask = ellipseMask(ellipse, width, height); const n = stats(mask).n;
  return { mask, source: null, index: -1, residual: 0, area_frac: n / (width * height), filled: false, via: 'synthetic', synthetic: true, ellipse: fitEllipse(mask) };
}
/**
 * The plate to scale by: a registered plate ({ id, name, diameter_mm }) or, when it is unknown (null), the "prato típico" prior with its
 * wider scale uncertainty; with { noPlate: true } the typical plate for a photo where no plate was found, with the wider no-plate uncertainty.
 * Returns { diameter_mm, typical, scale_uncertainty, name, id, no_plate }.
 */
export function plateSetup(priors, plate, { noPlate = false } = {}) {
  if (plate && !noPlate) return { id: plate.id, name: plate.name, diameter_mm: plate.diameter_mm, typical: false, no_plate: false, scale_uncertainty: priors.scale_uncertainty.value };
  if (noPlate) return { id: null, name: 'Prato típico (prato não detectado)', diameter_mm: priors.typical_plate.diameter_mm, typical: true, no_plate: true, scale_uncertainty: priors.no_plate_scale_uncertainty?.value ?? priors.typical_plate_scale_uncertainty.value };
  return { id: null, name: 'Prato típico', diameter_mm: priors.typical_plate.diameter_mm, typical: true, no_plate: false, scale_uncertainty: priors.typical_plate_scale_uncertainty.value };
}
/** priors with the scale uncertainty replaced by the plate's, so estimateItem widens every range for an unknown plate. */
export const priorsForPlate = (priors, setup) => ({ ...priors, scale_uncertainty: { ...priors.scale_uncertainty, value: setup.scale_uncertainty } });
export const NO_PLATE_NOTE = 'prato não detectado — escala aproximada';

/** Nearest-neighbour resize of a mask to w x h (fields such as score kept): auto-mode masks come back small and are used at the photo size. */
export function resizeMask(mask, w, h) {
  if (mask.width === w && mask.height === h) return mask;
  const out = new Uint8Array(w * h); const fx = mask.width / w; const fy = mask.height / h;
  for (let y = 0; y < h; y++) { const row = Math.min(mask.height - 1, Math.floor((y + 0.5) * fy)) * mask.width; for (let x = 0; x < w; x++) out[y * w + x] = mask.data[row + Math.min(mask.width - 1, Math.floor((x + 0.5) * fx))]; }
  return withData({ ...mask, width: w, height: h }, out);
}
/** priors.autoseg -> plain values (every entry needs a value, an assumption flag and a rationale). */
export function autosegParams(priors) {
  const out = {};
  for (const [k, e] of Object.entries(priors.autoseg ?? {})) {
    if (k === 'note') continue;
    if (!e || !('value' in e) || e.assumption !== true || typeof e.rationale !== 'string') throw new Error(`priors.autoseg.${k}: precisa de value, assumption e rationale`);
    out[k] = e.value;
  }
  return out;
}

// ---------------------------------------------------------------- pipeline
/**
 * Photo -> plate + foods, over an injected model object (the same one the app uses; tests mock it):
 *   models.segmentPoints(points, { batch, budgetMs, perPoint, lowRes?, onProgress }) -> { masks (with score), decodes, ms, timed_out }
 *   models.classify(blob, prompts)                                          -> [{ label, score }]
 * `crop(mask)` returns the image blob SigLIP names (the app cuts it from the photo). Returns
 *   { status: 'ok' | 'empty_plate', plate, plate_detected, note, items, rejected, timings }
 * items: { mask, label (class id), cls, top (top-3), score, parts? }. Zero setup: when no plate is found the result is NOT a failure and never
 * asks for a tap. The foods are looked for on a grid over the centre of the whole photo and the plate is a synthetic circle around them
 * (syntheticPlate: the food is assumed to span a typical plate); then plate_detected is false and `note` says "prato não detectado — escala aproximada".
 * status 'no_plate' remains only for a caller that passes fallback: false (it returns before any food is decoded).
 * With `split` it stops before naming and returns { status: 'segmented', width, height, plate (null without one), plate_detected, kept, timings };
 * finishAuto(seg) then does the naming (`crop` is not needed for the split half).
 */
export async function detectAuto({ models, params, classes, width, height, photoWidth = width, photoHeight = height, crop, onStage = () => {}, now = () => Date.now(), diagnostics = false, fallback = true, split = false }) {
  const t0 = now(); const p = params;
  // width x height is the MASK space the pipeline works in; with a smaller mask space than the photo (T-017: memory on the iPhone) the points go to
  // the model in photo pixels and the masks come back at width x height (models.segmentPoints lowRes)
  const low = photoWidth !== width || photoHeight !== height; const sx = photoWidth / width; const sy = photoHeight / height;
  const timings = { prompts: 0, decodes: 0, decode_ms: 0, classify_ms: 0, plate_decode_ms: 0, food_decode_ms: 0, total_ms: 0, timed_out: false, plate_grid_n: p.plate_grid_n, food_grid_n: p.food_grid_n };
  const finish = (r) => { timings.total_ms = Math.round(now() - t0); return { ...r, timings: { ...timings } }; };
  // split: stop before naming (the caller names the foods later, on the iPhone in a fresh page: finishAuto); otherwise name them now
  const named = (seg) => (split ? seg : finishAuto({ models, params, classes, crop, seg, onStage, now }));
  const grid = async (points, stage, perPoint) => {
    const left = Math.max(0, p.time_budget_ms - (now() - t0));
    const r = await models.segmentPoints(low ? points.map((q) => ({ x: q.x * sx, y: q.y * sy })) : points, { batch: p.decode_batch, budgetMs: left, perPoint, ...(low ? { lowRes: { w: width, h: height } } : {}), onProgress: (e) => onStage({ stage, ...e }) });
    if (r.masks.some((m) => m.width !== width || m.height !== height)) throw new Error(`máscaras ${r.masks[0].width}x${r.masks[0].height}, esperado ${width}x${height}`);
    timings.prompts += r.done ?? points.length; timings.decodes += r.decodes ?? points.length; timings.decode_ms += r.ms ?? 0; timings[`${stage === 'plate' ? 'plate' : 'food'}_decode_ms`] += r.ms ?? 0; timings.timed_out ||= !!r.timed_out;
    return r.masks;
  };
  onStage({ stage: 'plate', done: 0, total: p.plate_grid_n ** 2 });
  // the plate stage keeps every multimask output of a point (the whole plate is often not the best-scoring one), the food stage the best one
  const plateRaw = await grid(gridPoints(width, height, p.plate_grid_n), 'plate', p.plate_masks_per_point ?? p.masks_per_point);
  const plateOpts = { minAreaFrac: p.plate_min_area_frac, maxAreaFrac: p.plate_max_area_frac, centerFrac: p.plate_center_frac, centerCoverMin: p.plate_center_cover_min, maxResidual: p.plate_max_residual,
    ringMinArc: p.plate_ring_min_arc, ringMinBand: p.plate_ring_min_band, ringBandLo: p.plate_ring_band_lo, ringSectors: p.plate_ring_sectors, supportIou: p.plate_support_iou };
  // not deduplicated: the same plate from many prompts is the evidence that it is the plate
  const plateJudged = plateEvals(plateRaw, plateOpts, diagnostics);
  const plate = selectPlate(plateRaw, plateOpts, plateJudged);
  const debug = diagnostics ? { plate_candidates: plateDiagnostics(plateRaw, plateOpts, plateJudged) } : {};

  if (!plate) {
    if (!fallback) return finish({ status: 'no_plate', plate: null, plate_detected: false, items: [], rejected: [], ...debug });
    // no plate, and still no tap: foods from a grid over the centre of the whole photo, the plate becomes a circle around them
    const cf = p.noplate_center_frac ?? 0.8; const total = width * height;
    const pts = gridPoints(width, height, p.food_grid_n).filter((q) => Math.abs(q.x - width / 2) <= cf * width / 2 && Math.abs(q.y - height / 2) <= cf * height / 2);
    onStage({ stage: 'foods', done: 0, total: pts.length });
    const raw = (await grid(pts, 'foods', p.masks_per_point)).map((m, r) => ({ ...m, _r: r }));
    const touches = (m) => { const b = stats(m).box; return b ? (b.x0 === 0) + (b.y0 === 0) + (b.x1 === width - 1) + (b.y1 === height - 1) : 0; };
    const drops = new Map(); const deduped = dedupe(raw, p.dedupe_iou); for (const m of raw) if (!deduped.includes(m)) drops.set(m._r, 'duplicate');
    const why = (m) => {
      if ((m.score ?? 0) < p.food_min_pred_iou) return 'low_score'; const frac = stats(m).n / total;
      if (frac < (p.noplate_food_min_image_frac ?? 0.005)) return 'too_small'; if (frac > (p.noplate_food_max_image_frac ?? 0.35)) return 'too_large';
      return touches(m) >= 2 ? 'background' : null; // not the table or the background
    };
    const cand = deduped.filter((m) => { const w = why(m); if (w) drops.set(m._r, w); return !w; });
    const resolved = resolveOverlaps(cand).filter((m) => m.pixels / total >= (p.noplate_food_min_image_frac ?? 0.005));
    const kept = resolved.sort((a, b) => b.pixels - a.pixels).slice(0, p.max_food_items);
    const foodDebug = diagnostics ? { food_candidates: foodRows(raw, drops, kept, resolved, (m) => stats(m).n / total) } : {};
    return named(finish({ status: 'segmented', width, height, plate: null, plate_detected: false, kept, ...debug, ...foodDebug }));
  }

  const e = plate.ellipse; const inner = { ...e, a: e.a * p.food_grid_inset, b: e.b * p.food_grid_inset };
  const foodPoints = gridPoints(width, height, p.food_grid_n, { insideEllipse: inner });
  onStage({ stage: 'foods', done: 0, total: foodPoints.length });
  const raw = (await grid(foodPoints, 'foods', p.masks_per_point)).map((m, r) => ({ ...m, _r: r }));
  const drops = new Map(); const deduped = dedupe(raw, p.dedupe_iou); for (const m of raw) if (!deduped.includes(m)) drops.set(m._r, 'duplicate');
  const filtered = filterFoods(deduped, plate, { minFrac: p.food_min_frac, maxFrac: p.food_max_frac, minPredIoU: p.food_min_pred_iou, minInsideFrac: p.food_min_inside_frac, plateDupIou: p.dedupe_iou,
    ringMinArc: p.plate_ring_min_arc, ringMinBand: p.plate_ring_min_band, ringBandLo: p.plate_ring_band_lo, ringSectors: p.plate_ring_sectors }, (m, reason) => drops.set(m._r, reason));
  const plateArea = stats(plate.mask).n;
  const resolved = resolveOverlaps(filtered).filter((m) => m.pixels / plateArea >= p.food_min_frac);
  const kept = resolved.sort((a, b) => b.pixels - a.pixels).slice(0, p.max_food_items);
  const foodDebug = diagnostics ? { food_candidates: foodRows(raw, drops, kept, resolved, (m) => intersection(m, stats(m), plate.mask, stats(plate.mask)) / plateArea) } : {};
  return named(finish({ status: 'segmented', width, height, plate, plate_detected: true, kept, ...debug, ...foodDebug }));
}

/**
 * Second half of auto mode: names the kept masks of a detectAuto({ split: true }) result (`seg`), drops the non-food ones and builds the final
 * result (the no-plate stand-in circle is drawn around the named foods). It needs only models.classify, so on the iPhone it runs in a fresh page
 * that loads the naming model alone (T-017: SAM and the naming model in one page killed the tab; the feasibility run proved one model per page).
 * `seg` may come back from storage: only width, height, plate ({ mask, ellipse, ... } or null), plate_detected, kept (masks with score), timings and
 * plate_candidates are read. Returns the same shape as detectAuto without split.
 */
export async function finishAuto({ models, params, classes, crop, seg, onStage = () => {}, now = () => Date.now() }) {
  const p = params; const t1 = now(); const kept = seg.kept ?? [];
  onStage({ stage: 'naming', done: 0, total: kept.length });
  const nfPrompts = nonFoodPrompts(p.non_food_labels); const prompts = [...namePrompts(classes), ...nfPrompts];
  const items = []; const scores = [];
  for (const mask of kept) {
    const blob = await crop(mask);
    const sc = await models.classify(blob, prompts);
    items.push({ mask, score: mask.score ?? 0, blob, index: items.length }); scores.push(sc);
    onStage({ stage: 'naming', done: items.length, total: kept.length });
  }
  const { foods, rejected } = rejectNonFood(items, scores, nfPrompts);
  const named = foods.map((it) => {
    const top = topNames(scores[it.index], classes, 3);
    return { ...it, top, cls: top[0]?.cls ?? null, label: top[0]?.cls?.id ?? null };
  }).filter((it) => it.cls);
  const merged = mergeSameLabel(named, p.merge_adjacency_px);
  const ms = Math.round(now() - t1); const t = seg.timings ?? {};
  const timings = { ...t, classify_ms: (t.classify_ms ?? 0) + ms, total_ms: (t.total_ms ?? 0) + ms };
  const debug = { ...(seg.plate_candidates ? { plate_candidates: seg.plate_candidates } : {}), ...(seg.food_candidates ? { food_candidates: seg.food_candidates } : {}) };
  // what the naming model said about each kept mask (its top 3 and the best non-food label), for the Diagnóstico panel
  const r3 = (v) => Math.round(v * 1000) / 1000; const nf = new Set(nfPrompts);
  debug.naming_rows = items.map((it, i) => ({ item: i, pixels: stats(it.mask).n, top: topNames(scores[i], classes, 3).map((t) => [t.cls.id, r3(t.score)]),
    nonfood: (() => { const b = scores[i].filter((q) => nf.has(q.label)).reduce((a, q) => (q.score > a.score ? q : a), { label: null, score: 0 }); return [b.label, r3(b.score)]; })() }));
  const status = merged.length ? 'ok' : 'empty_plate';
  if (seg.plate_detected) return { status, plate: seg.plate, plate_detected: true, items: merged, rejected, ...debug, timings };
  const fake = syntheticPlate(merged.map((it) => it.mask), seg.width, seg.height, { spanFactor: p.noplate_span_factor, defaultFrac: p.noplate_default_plate_frac });
  return { status, plate: fake, plate_detected: false, note: NO_PLATE_NOTE, items: merged, rejected, ...debug, timings };
}
