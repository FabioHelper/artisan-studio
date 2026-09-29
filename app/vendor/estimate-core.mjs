// Estimation core (T-013): plate ellipse -> scale -> item area -> volume -> grams -> macros -> range -> predictions.
// Pure and dependency-free (the nutrition lookup is passed in), so Node tests it (web/estimate/selftest.mjs) and
// the browser runs the same file (web/sync-data.mjs copies it to web/app/vendor/estimate-core.mjs).
// Spec: docs/specs/SPEC-T-013-estimation-mvp.md. Every invented number lives in priors.json, labelled as an assumption.

export const PREDICTIONS_SCHEMA_ID = 'macrofy.predictions/1';
export const CALIBRATION_SCHEMA_ID = 'macrofy.calibration/1';
export const PIPELINE = { name: 'macrofy-estimator', version: '0.1.0-uncalibrated' };
/** Standard normal quantile of the 90th percentile: the 80% central interval is +-Z80 sigma. */
export const Z80 = 1.2816;
export const NAME_PROMPT = (pt) => `uma foto de ${pt}`;

/** The plate-wide oil question (pt-BR) and its multiplier on each item's default_oil_g_per_100g. */
export const OIL_LEVELS = [
  { id: 'none', label: 'Sem óleo', factor: 0 },
  { id: 'little', label: 'Pouco', factor: 0.5 },
  { id: 'normal', label: 'Normal', factor: 1 },
  { id: 'lots', label: 'Muito', factor: 2 },
];

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- masks
// A mask is { width, height, data } where data[y * width + x] is nonzero inside the region (Uint8Array or array).

export function maskCount(mask) {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) n++;
  return n;
}

/** Bounding box { x0, y0, x1, y1 } (inclusive) of the mask, or null when empty. */
export function maskBBox(mask) {
  const { width, height, data } = mask;
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!data[y * width + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Pixel counts of several item masks where a pixel claimed by an earlier mask is not counted again (first tap wins),
 * so two taps that overlap never count the same food twice.
 */
export function exclusiveCounts(masks) {
  const taken = masks.length ? new Uint8Array(masks[0].data.length) : null;
  return masks.map((m) => {
    let n = 0;
    for (let i = 0; i < m.data.length; i++) if (m.data[i] && !taken[i]) { taken[i] = 1; n++; }
    return n;
  });
}

// ---------------------------------------------------------------- scale from the plate ellipse
/**
 * Ellipse fit from a binary mask by second moments. A filled ellipse with semi-axes a >= b has covariance
 * eigenvalues a^2/4 and b^2/4, so a = 2 sqrt(lambda1), b = 2 sqrt(lambda2). Returns
 * { cx, cy, a, b, angle_rad (major axis, from +x, image coordinates), pixels }.
 */
export function fitEllipse(mask) {
  const { width, height, data } = mask;
  let n = 0; let sx = 0; let sy = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[y * width + x]) { n++; sx += x; sy += y; }
  if (n < 3) throw new Error('máscara do prato vazia ou pequena demais');
  const cx = sx / n; const cy = sy / n;
  let sxx = 0; let syy = 0; let sxy = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[y * width + x]) { const dx = x - cx; const dy = y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= n; syy /= n; sxy /= n;
  const mid = (sxx + syy) / 2; const rad = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  const l1 = mid + rad; const l2 = Math.max(mid - rad, 0);
  return { cx, cy, a: 2 * Math.sqrt(l1), b: 2 * Math.sqrt(l2), angle_rad: 0.5 * Math.atan2(2 * sxy, sxx - syy), pixels: n };
}

/** mm_per_px = diameter / (2a); cos_tilt = b / a (the plate is a circle seen at a tilt, so b/a = cos of the tilt from the vertical). */
export function scaleFromAxes(a, b, diameter_mm) {
  if (!(a > 0) || !(b > 0) || !(diameter_mm > 0)) throw new Error('eixos e diâmetro devem ser positivos');
  return { mm_per_px: diameter_mm / (2 * a), cos_tilt: Math.min(b / a, 1), a, b };
}
export function scaleFromPlateMask(mask, diameter_mm) {
  const e = fitEllipse(mask);
  return { ...scaleFromAxes(e.a, e.b, diameter_mm), ellipse: e };
}

// ---------------------------------------------------------------- area, volume, density, mass
/**
 * Area on the plate plane. Assumption (documented, not measured): the food lies on the plate plane and the camera is far
 * enough for the plate to be a planar ellipse, so an image area is stretched by 1/cos_tilt along the tilted axis only.
 */
export const areaMm2 = (pixels, scale) => pixels * scale.mm_per_px ** 2 / scale.cos_tilt;
/** 1 mL = 1000 mm3. */
export const volumeMl = (area_mm2, thickness_mm) => area_mm2 * thickness_mm / 1000;

export function groupOf(classId, priors) {
  const g = priors.class_groups[classId];
  if (!g || !priors.groups[g]) throw new Error(`classe sem grupo de espessura em priors.json: ${classId}`);
  return g;
}

/**
 * F-004: FNDDS "pieces" densities are chopped-pieces packing densities and understate solid items, so a solid group
 * with a pieces density uses the solid_density_g_per_ml prior. "served" densities and loose foods keep the vocab value.
 */
export function densityFor(cls, priors) {
  const group = priors.groups[groupOf(cls.id, priors)];
  const kind = cls.density_source?.kind;
  if (kind === 'pieces' && group.solid) return { density: priors.solid_density_g_per_ml.value, basis: 'solid_prior' };
  return { density: cls.density_g_per_ml, basis: kind === 'served' ? 'served' : 'pieces' };
}

/** Factor by group, then a "default" entry, then 1. A calibration file is validated by loadCalibration. */
export const calibrationFactor = (calibration, group) => calibration?.factors?.[group] ?? calibration?.factors?.default ?? 1;

export function loadCalibration(json) {
  if (json == null) return { factors: {} };
  if (json.schema !== CALIBRATION_SCHEMA_ID) throw new Error(`calibration.json: schema deve ser ${CALIBRATION_SCHEMA_ID}`);
  for (const [k, v] of Object.entries(json.factors ?? {})) if (!isNum(v) || v <= 0) throw new Error(`calibration.json: fator inválido para ${k}`);
  return { factors: { ...json.factors } };
}

// ---------------------------------------------------------------- range
/** sigma of the multiplicative lognormal: sqrt(ln(1+cv^2) + ln(1+s^2)); cv = thickness prior, s = scale uncertainty. */
export const rangeSigma = (cv, s) => Math.sqrt(Math.log(1 + cv * cv) + Math.log(1 + s * s));
/** 80% interval of a lognormal-ish error around the point estimate: grams * exp(-+ 1.2816 sigma). Replaced by conformal intervals in T-008. */
export const range80 = (grams, sigma) => ({ lo80: grams * Math.exp(-Z80 * sigma), hi80: grams * Math.exp(Z80 * sigma) });

// ---------------------------------------------------------------- oil and nutrients
export const oilLevel = (id) => OIL_LEVELS.find((o) => o.id === id) ?? null;
/** Grams of cooking oil for an item: factor x default_oil_g_per_100g x grams / 100. */
export const oilGrams = (cls, grams, factor) => factor * (cls.default_oil_g_per_100g ?? 0) * grams / 100;

/**
 * One item. `cls` is the vocab class, `pixels` its mask area in image pixels (after exclusiveCounts), `scale` from
 * scaleFromPlateMask, `oil` an OIL_LEVELS id, `lookup` a createLookup result (nutrition/lookup-core.mjs).
 */
export function estimateItem({ cls, pixels, scale, oil = 'normal', priors, calibration = null, lookup }) {
  const level = oilLevel(oil); if (!level) throw new Error(`nível de óleo desconhecido: ${oil}`);
  const group = groupOf(cls.id, priors); const prior = priors.groups[group];
  const { density, basis } = densityFor(cls, priors);
  const area = areaMm2(pixels, scale);
  const volume = volumeMl(area, prior.thickness_mm);
  const factor = calibrationFactor(calibration, group);
  const grams = volume * density * factor;
  const sigma = rangeSigma(prior.cv, priors.scale_uncertainty.value);
  const { lo80, hi80 } = range80(grams, sigma);
  const oil_g = oilGrams(cls, grams, level.factor);
  const n = lookup.nutrientsFor({ label: cls.id, grams, oil_g });
  return {
    class_id: cls.id, label: cls.pt, group, pixels, area_mm2: r1(area), thickness_mm: prior.thickness_mm, volume_ml: r1(volume),
    density_g_per_ml: density, density_basis: basis, calibration_factor: factor, sigma: Math.round(sigma * 1e4) / 1e4,
    grams: r1(grams), lo80: r1(lo80), hi80: r1(hi80), oil: level.id, oil_g: r2(oil_g), ...n, calibrated: false,
  };
}

/** Plate totals. The range is the sum of the item bounds: the items share one scale estimate, so their errors are not independent. */
export function totals(items) {
  const t = { grams: 0, lo80: 0, hi80: 0, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const it of items) for (const k of Object.keys(t)) t[k] += it[k];
  for (const k of Object.keys(t)) t[k] = r1(t[k]);
  return t;
}

// ---------------------------------------------------------------- naming (SigLIP zero-shot over the vocab pt names)
export const namePrompts = (classes) => classes.map((c) => NAME_PROMPT(c.pt));
/** scores: [{ label: prompt, score }] for the prompts of namePrompts(classes). Returns the k best classes with their scores. */
export function topNames(scores, classes, k = 3) {
  const byPrompt = new Map(classes.map((c) => [NAME_PROMPT(c.pt), c]));
  return [...scores].sort((a, b) => b.score - a.score).map((s) => ({ cls: byPrompt.get(s.label), score: s.score })).filter((s) => s.cls).slice(0, k);
}

// ---------------------------------------------------------------- export
/**
 * Saved estimates -> macrofy.predictions/1. An estimate is { id, created_at, meal_id (weighed meal or null), items }.
 * Estimates linked to the same meal collapse to the newest (the schema allows one prediction per meal). Unlinked
 * estimates use "est-<id>": eval counts those as predictions for an unknown meal, which is harmless.
 * Labels are the vocab pt names, exactly the strings the capture app writes.
 */
export function toPredictions(estimates, pipeline = PIPELINE) {
  const byMeal = new Map();
  for (const e of estimates) {
    const id = e.meal_id || `est-${e.id}`;
    const old = byMeal.get(id);
    if (!old || String(e.created_at) >= String(old.created_at)) byMeal.set(id, e);
  }
  return {
    schema: PREDICTIONS_SCHEMA_ID,
    pipeline: { name: pipeline.name, version: pipeline.version },
    meals: [...byMeal].map(([meal_id, e]) => ({
      meal_id,
      items: e.items.map((it) => ({ label: it.label, grams: it.grams, kcal: it.kcal, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g, lo80: it.lo80, hi80: it.hi80 })),
    })),
  };
}
