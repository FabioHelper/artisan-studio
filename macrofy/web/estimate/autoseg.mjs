// Automatic plate and food detection (T-014, ADR 0005): pure mask post-processing plus the detection pipeline over an injected model.
// Masks are { width, height, data: Uint8Array } (nonzero = inside) with an optional `score` (SAM's predicted IoU).
// No DOM and no model here, so Node tests it (web/estimate/autoseg-selftest.mjs); the browser runs a copy (web/sync-data.mjs
// copies it to web/app/vendor/autoseg.mjs, rewriting the core import to the vendored name).
// Spec: docs/specs/SPEC-T-014-auto-mode.md. Every threshold is an assumption in priors.json (section "autoseg").
import { fitEllipse, NAME_PROMPT, namePrompts, topNames } from './core.mjs';

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
 * The plate: among masks that cover enough of the photo (not nearly all of it), cover the central box of the photo and are
 * ellipse-shaped (residual <= maxResidual), the largest. Returns { mask, index, residual, area_frac, ellipse } or null (no plate found).
 * opts: minAreaFrac, maxAreaFrac, centerFrac (side of the central box), centerCoverMin (share of that box inside the mask), maxResidual.
 */
export function selectPlate(masks, { minAreaFrac, maxAreaFrac = 1, centerFrac, centerCoverMin, maxResidual }) {
  let best = null;
  masks.forEach((mask, index) => {
    const { n } = stats(mask); const frac = n / (mask.width * mask.height);
    if (frac < minAreaFrac || frac > maxAreaFrac) return;
    const bx0 = Math.floor(mask.width * (1 - centerFrac) / 2); const bx1 = Math.ceil(mask.width * (1 + centerFrac) / 2) - 1;
    const by0 = Math.floor(mask.height * (1 - centerFrac) / 2); const by1 = Math.ceil(mask.height * (1 + centerFrac) / 2) - 1;
    let inBox = 0; let total = 0;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { total++; if (mask.data[y * mask.width + x]) inBox++; }
    if (total === 0 || inBox / total < centerCoverMin) return;
    const residual = ellipseResidual(mask);
    if (residual > maxResidual) return;
    if (!best || n > best.n) best = { mask, index, residual, area_frac: frac, n };
  });
  return best ? { mask: best.mask, index: best.index, residual: best.residual, area_frac: best.area_frac, ellipse: fitEllipse(best.mask) } : null;
}

// ---------------------------------------------------------------- foods
/**
 * Food candidates: predicted IoU >= minPredIoU, mask area between minFrac and maxFrac of the plate area (the part on the plate),
 * at least minInsideFrac of the mask on the plate (so a table or hand mask is out), and never the plate mask itself.
 * `plate` is a selectPlate result or a mask. Returns copies with plate_frac and inside_frac attached.
 */
export function filterFoods(masks, plate, { minFrac, maxFrac, minPredIoU, minInsideFrac = 0 }) {
  const pm = plate.mask ?? plate; const ps = stats(pm);
  if (ps.n === 0) return [];
  const out = [];
  for (const m of masks) {
    if (m === pm || m.data === pm.data) continue;
    if ((m.score ?? 0) < minPredIoU) continue;
    const sm = stats(m); if (sm.n === 0) continue;
    const inter = intersection(m, sm, pm, ps);
    const plateFrac = inter / ps.n; const inside = inter / sm.n;
    if (plateFrac < minFrac || plateFrac > maxFrac || inside < minInsideFrac) continue;
    out.push({ ...m, plate_frac: plateFrac, inside_frac: inside });
  }
  return out;
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
/**
 * The plate to scale by: a registered plate ({ id, name, diameter_mm }) or, when it is unknown (null), the "prato típico" prior with its
 * wider scale uncertainty. Returns { diameter_mm, typical, scale_uncertainty, name, id }.
 */
export function plateSetup(priors, plate) {
  if (plate) return { id: plate.id, name: plate.name, diameter_mm: plate.diameter_mm, typical: false, scale_uncertainty: priors.scale_uncertainty.value };
  return { id: null, name: 'Prato típico', diameter_mm: priors.typical_plate.diameter_mm, typical: true, scale_uncertainty: priors.typical_plate_scale_uncertainty.value };
}
/** priors with the scale uncertainty replaced by the plate's, so estimateItem widens every range for an unknown plate. */
export const priorsForPlate = (priors, setup) => ({ ...priors, scale_uncertainty: { ...priors.scale_uncertainty, value: setup.scale_uncertainty } });

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
 *   models.segmentPoints(points, { batch, budgetMs, perPoint, onProgress }) -> { masks (with score), decodes, ms, timed_out }
 *   models.classify(blob, prompts)                                          -> [{ label, score }]
 * `crop(mask)` returns the image blob SigLIP names (the app cuts it from the photo). Returns
 *   { status: 'ok' | 'no_plate' | 'empty_plate', plate, items, rejected, timings }
 * items: { mask, label (class id), cls, top (top-3), score, parts? }. The plate is null on 'no_plate'; the caller falls back to manual mode.
 */
export async function detectAuto({ models, params, classes, width, height, crop, onStage = () => {}, now = () => Date.now() }) {
  const t0 = now(); const p = params;
  const timings = { prompts: 0, decodes: 0, decode_ms: 0, classify_ms: 0, total_ms: 0, timed_out: false, plate_grid_n: p.plate_grid_n, food_grid_n: p.food_grid_n };
  const finish = (r) => { timings.total_ms = Math.round(now() - t0); return { ...r, timings }; };
  const grid = async (points, stage) => {
    const left = Math.max(0, p.time_budget_ms - (now() - t0));
    const r = await models.segmentPoints(points, { batch: p.decode_batch, budgetMs: left, perPoint: p.masks_per_point, onProgress: (e) => onStage({ stage, ...e }) });
    timings.prompts += r.done ?? points.length; timings.decodes += r.decodes ?? points.length; timings.decode_ms += r.ms ?? 0; timings.timed_out ||= !!r.timed_out;
    return r.masks;
  };

  onStage({ stage: 'plate', done: 0, total: p.plate_grid_n ** 2 });
  const plateCandidates = dedupe(await grid(gridPoints(width, height, p.plate_grid_n), 'plate'), p.dedupe_iou);
  const plate = selectPlate(plateCandidates, { minAreaFrac: p.plate_min_area_frac, maxAreaFrac: p.plate_max_area_frac, centerFrac: p.plate_center_frac, centerCoverMin: p.plate_center_cover_min, maxResidual: p.plate_max_residual });
  if (!plate) return finish({ status: 'no_plate', plate: null, items: [], rejected: [] });

  const e = plate.ellipse; const inner = { ...e, a: e.a * 0.95, b: e.b * 0.95 };
  const foodPoints = gridPoints(width, height, p.food_grid_n, { insideEllipse: inner });
  onStage({ stage: 'foods', done: 0, total: foodPoints.length });
  const raw = await grid(foodPoints, 'foods');
  const filtered = filterFoods(dedupe(raw, p.dedupe_iou), plate, { minFrac: p.food_min_frac, maxFrac: p.food_max_frac, minPredIoU: p.food_min_pred_iou, minInsideFrac: p.food_min_inside_frac });
  const plateArea = stats(plate.mask).n;
  const resolved = resolveOverlaps(filtered).filter((m) => m.pixels / plateArea >= p.food_min_frac);
  const kept = resolved.sort((a, b) => b.pixels - a.pixels).slice(0, p.max_food_items);

  onStage({ stage: 'naming', done: 0, total: kept.length });
  const nfPrompts = nonFoodPrompts(p.non_food_labels); const prompts = [...namePrompts(classes), ...nfPrompts];
  const tc = now(); const items = []; const scores = [];
  for (const mask of kept) {
    const blob = await crop(mask);
    const s = await models.classify(blob, prompts);
    items.push({ mask, score: mask.score ?? 0, blob, index: items.length }); scores.push(s);
    onStage({ stage: 'naming', done: items.length, total: kept.length });
  }
  const { foods, rejected } = rejectNonFood(items, scores, nfPrompts);
  const named = foods.map((it) => {
    const top = topNames(scores[it.index], classes, 3);
    return { ...it, top, cls: top[0]?.cls ?? null, label: top[0]?.cls?.id ?? null };
  }).filter((it) => it.cls);
  timings.classify_ms = Math.round(now() - tc);
  const merged = mergeSameLabel(named, p.merge_adjacency_px);
  const out = { plate, items: merged, rejected };
  return finish({ status: merged.length ? 'ok' : 'empty_plate', ...out });
}
