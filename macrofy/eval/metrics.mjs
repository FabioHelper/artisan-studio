// Evaluation engine: ground truth (a macrofy.bench/1 manifest) + predictions (macrofy.predictions/1) -> one
// JSON report with per-sample accuracy metrics and day-clustered bootstrap confidence intervals.
// Pure, deterministic (seeded PRNG), Node built-ins only. Spec: docs/specs/SPEC-T-004-evaluation-engine.md
import { validateManifest, parseCapture } from '../bench/schema.mjs';

export const PREDICTIONS_SCHEMA_ID = 'macrofy.predictions/1';
export const REPORT_SCHEMA_ID = 'macrofy.eval-report/1';
export const SMALL_ITEM_G = 10; // true mass below this is scored in absolute grams only (APE explodes on tiny items)
export const WITHIN = [0.1, 0.2, 0.3];
export const DEFAULT_RESAMPLES = 2000;
export const DEFAULT_SEED = 20260928;
export const NUTRIENTS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'];
const EPS = 1e-12; // "within" is inclusive; absorbs the last-bit noise of a ratio that is exactly on the bound

// ---------------------------------------------------------------- numeric helpers
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isAmount = (v) => isNum(v) && v >= 0;
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = (x) => (isNum(x) ? x : null); // JSON-safe number

export const sum = (v) => v.reduce((a, b) => a + b, 0);
export const mean = (v) => (v.length ? sum(v) / v.length : NaN);
export const median = (v) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b); const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
export const absMean = (v) => Math.abs(mean(v));
/** Sample standard deviation (n-1); NaN below two values. */
export const sd = (v) => {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(sum(v.map(x => (x - m) ** 2)) / (v.length - 1));
};
/** Percentile q in [0,1] of an ascending array, linear interpolation between order statistics. */
export function percentile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = q * (sorted.length - 1); const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
/** mulberry32: a small seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- cluster bootstrap
/**
 * Cluster (day) bootstrap. values[i] belongs to cluster clusterKeys[i] (the capture day). Each resample draws as
 * many clusters as there are, with replacement, keeps all of a drawn cluster's values, and recomputes stat.
 * Returns { n, clusters, resamples, seed, estimate, lo, hi } with lo/hi the 2.5th/97.5th percentiles.
 */
export function bootstrapCI(values, clusterKeys, { stat = mean, resamples = DEFAULT_RESAMPLES, seed = DEFAULT_SEED } = {}) {
  if (!Array.isArray(values) || !values.every(isNum)) throw new Error('bootstrapCI: values must be an array of finite numbers');
  if (!Array.isArray(clusterKeys) || clusterKeys.length !== values.length) throw new Error('bootstrapCI: clusterKeys must be an array with one key per value');
  if (typeof stat !== 'function') throw new Error('bootstrapCI: stat must be a function of an array of numbers');
  if (!Number.isInteger(resamples) || resamples < 1) throw new Error('bootstrapCI: resamples must be a positive integer');
  if (!Number.isInteger(seed)) throw new Error('bootstrapCI: seed must be an integer');
  const groups = new Map();
  values.forEach((v, i) => { const k = String(clusterKeys[i]); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); });
  const clusters = [...groups.keys()].sort().map(k => groups.get(k)); // sorted: row order cannot change the result
  const D = clusters.length;
  if (!D) return { n: 0, clusters: 0, resamples, seed, estimate: null, lo: null, hi: null };
  const rng = mulberry32(seed);
  const stats = new Array(resamples);
  for (let r = 0; r < resamples; r++) {
    const draw = [];
    for (let d = 0; d < D; d++) for (const v of clusters[Math.floor(rng() * D)]) draw.push(v);
    const s = stat(draw);
    if (!isNum(s)) throw new Error('bootstrapCI: stat returned a non-finite value');
    stats[r] = s;
  }
  stats.sort((a, b) => a - b);
  return { n: values.length, clusters: D, resamples, seed, estimate: stat(values), lo: percentile(stats, 0.025), hi: percentile(stats, 0.975) };
}

// ---------------------------------------------------------------- input validation
/** Problems (strings) with a predictions file; empty means valid. */
export function validatePredictions(p) {
  const out = [];
  if (!isObj(p)) return ['predictions must be an object'];
  if (p.schema !== PREDICTIONS_SCHEMA_ID) out.push(`schema must be "${PREDICTIONS_SCHEMA_ID}"`);
  if (!isObj(p.pipeline) || !isStr(p.pipeline.name) || !isStr(p.pipeline.version)) out.push('pipeline must be {name, version} with non-empty strings');
  if (!Array.isArray(p.meals)) { out.push('meals must be an array'); return out; }
  const seen = new Set();
  p.meals.forEach((m, i) => {
    const at = `meals[${i}]`;
    if (!isObj(m)) { out.push(`${at} must be an object`); return; }
    if (!isStr(m.meal_id)) out.push(`${at}.meal_id must be a non-empty string`);
    else if (seen.has(m.meal_id)) out.push(`${at}.meal_id ${JSON.stringify(m.meal_id)} appears more than once`);
    else seen.add(m.meal_id);
    if (!Array.isArray(m.items)) { out.push(`${at}.items must be an array`); return; }
    m.items.forEach((it, j) => {
      const w = `${at}.items[${j}]`;
      if (!isObj(it)) { out.push(`${w} must be an object`); return; }
      if (!isStr(it.label)) out.push(`${w}.label must be a non-empty string`);
      if (!isAmount(it.grams)) out.push(`${w}.grams must be a finite number >= 0`);
      for (const f of NUTRIENTS) if (it[f] !== undefined && !isAmount(it[f])) out.push(`${w}.${f} must be a finite number >= 0 when present`);
      const [lo, hi] = [it.lo80, it.hi80];
      if ((lo === undefined) !== (hi === undefined)) out.push(`${w} needs both lo80 and hi80 or neither`);
      else if (lo !== undefined && !(isAmount(lo) && isAmount(hi) && lo <= hi)) out.push(`${w}.lo80 and hi80 must be finite numbers >= 0 with lo80 <= hi80`);
    });
  });
  return out;
}

/** The calendar date of captured_at exactly as written (the cluster key for the bootstrap). */
export const dayOf = (meal) => parseCapture(meal.captured_at)?.date ?? null;

// ---------------------------------------------------------------- matching
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
/**
 * Match truth items to predicted items per label; a repeated label pairs greedily by smallest gram difference
 * (ties: lower truth index, then lower prediction index). Returns { pairs: [[ti, pi]], omissions: [ti], intrusions: [pi] }.
 */
export function matchItems(truthItems, predItems) {
  const cand = [];
  truthItems.forEach((t, ti) => predItems.forEach((p, pi) => {
    if (norm(t.label) === norm(p.label)) cand.push({ ti, pi, d: Math.abs(t.grams - p.grams) });
  }));
  cand.sort((a, b) => a.d - b.d || a.ti - b.ti || a.pi - b.pi);
  const tUsed = new Set(); const pUsed = new Set(); const pairs = [];
  for (const c of cand) if (!tUsed.has(c.ti) && !pUsed.has(c.pi)) { tUsed.add(c.ti); pUsed.add(c.pi); pairs.push([c.ti, c.pi]); }
  return {
    pairs: pairs.sort((a, b) => a[0] - b[0]),
    omissions: truthItems.map((_, i) => i).filter(i => !tUsed.has(i)),
    intrusions: predItems.map((_, i) => i).filter(i => !pUsed.has(i)),
  };
}

// ---------------------------------------------------------------- per-meal scoring
function scoreMeal(meal, predMeal, truthNutrients) {
  const truth = meal.items; const preds = predMeal ? predMeal.items : [];
  const { pairs, omissions, intrusions } = matchItems(truth, preds);
  const predOf = new Map(pairs);
  const day = dayOf(meal);
  const items = truth.map((t, ti) => {
    const p = predOf.has(ti) ? preds[predOf.get(ti)] : null;
    const pred_g = p ? p.grams : 0; // an omission is a prediction of 0 g
    const small = t.grams < SMALL_ITEM_G;
    const err = pred_g - t.grams;
    const it = { item_id: t.id, label: t.label, day, true_g: t.grams, pred_g, status: p ? 'exact' : 'omission', small, abs_err_g: Math.abs(err), ape: small ? null : Math.abs(err) / t.grams, signed: small ? null : err / t.grams };
    if (p && p.lo80 !== undefined) { it.lo80 = p.lo80; it.hi80 = p.hi80; it.covered = p.lo80 <= t.grams && t.grams <= p.hi80; }
    return it;
  });
  const tn = truth.map(t => (truthNutrients ? truthNutrients(t, meal) : null));
  const totals = {};
  for (const f of NUTRIENTS) {
    if (!tn.every(x => isAmount(x?.[f]))) totals[f] = { skip: 'no_truth' };
    else if (!preds.every(p => isAmount(p[f]))) totals[f] = { skip: 'incomplete_prediction' };
    else totals[f] = { true: sum(tn.map(x => x[f])), pred: sum(preds.map(p => p[f])) };
  }
  return { meal_id: meal.id, day, has_prediction: !!predMeal, items, intrusions: intrusions.map(i => ({ label: preds[i].label, grams: preds[i].grams })), omissions: omissions.length, totals };
}

// ---------------------------------------------------------------- aggregation
function apeBlock(recs, boot) {
  const n = recs.length;
  const out = { n, days: new Set(recs.map(r => r.day)).size };
  const shares = Object.fromEntries(WITHIN.map(w => [`within_${Math.round(w * 100)}`, null]));
  if (!n) return { ...out, mape: null, median_ape: null, bias: null, abs_bias: null, ...shares, ci95: null };
  const apes = recs.map(r => r.ape); const sg = recs.map(r => r.signed); const days = recs.map(r => r.day);
  const ci = (v, stat) => { const r = bootstrapCI(v, days, { stat, ...boot }); return { lo: fin(r.lo), hi: fin(r.hi) }; };
  for (const w of WITHIN) shares[`within_${Math.round(w * 100)}`] = apes.filter(a => a <= w + EPS).length / n;
  return {
    ...out, mape: mean(apes), median_ape: median(apes), bias: mean(sg), abs_bias: Math.abs(mean(sg)), ...shares,
    ci95: { mape: ci(apes, mean), median_ape: ci(apes, median), bias: ci(sg, mean), abs_bias: ci(sg, absMean) },
  };
}

/**
 * Evaluate predictions against a manifest.
 * opts: { split: 'test'|'calibration', truthNutrients: (item, meal) -> {kcal, protein_g, carbs_g, fat_g}|null,
 *         lock: bench lock (verifies the frozen test set), resamples, seed }
 * Throws on an invalid manifest, invalid predictions, an unknown split or a split with no meals.
 */
export function evaluate(manifest, predictions, { split = 'test', truthNutrients = null, lock = null, resamples = DEFAULT_RESAMPLES, seed = DEFAULT_SEED } = {}) {
  if (split !== 'test' && split !== 'calibration') throw new Error(`split must be "test" or "calibration" (got ${JSON.stringify(split)})`);
  const mp = validateManifest(manifest, { lock });
  if (mp.length) throw new Error(`manifest is invalid (${mp.length} problem(s)); first: ${mp.slice(0, 3).map(p => `${p.rule}: ${p.msg}`).join(' | ')}`);
  const pp = validatePredictions(predictions);
  if (pp.length) throw new Error(`predictions are invalid (${pp.length} problem(s)); first: ${pp.slice(0, 3).join(' | ')}`);
  const meals = manifest.meals.filter(m => m.split === split);
  if (!meals.length) throw new Error(`the manifest has no meals in split "${split}"`);
  const boot = { resamples, seed };

  const inSplit = new Set(meals.map(m => m.id)); const inManifest = new Set(manifest.meals.map(m => m.id));
  const predBy = new Map(predictions.meals.map(m => [m.meal_id, m]));
  const scored = meals.map(m => scoreMeal(m, predBy.get(m.id) ?? null, truthNutrients));
  const items = scored.flatMap(m => m.items);
  const intrusions = scored.flatMap(m => m.intrusions);

  // recognition and item mass (truth-anchored: omissions count as 0 g; small items only in absolute grams)
  const exact = items.filter(i => i.status === 'exact').length;
  const recognition = {
    truth_items: items.length, pred_items: exact + intrusions.length, exact, omission: items.length - exact,
    intrusion: intrusions.length, intrusion_g: sum(intrusions.map(i => i.grams)),
  };
  const bigItems = items.filter(i => !i.small);
  const item_mass = { ...apeBlock(bigItems, boot), n_truth_items: items.length, n_small_excluded: items.length - bigItems.length, mae_g: mean(items.map(i => i.abs_err_g)) };

  // meal kcal and macros (per meal: sum of items)
  const excluded = (f) => ({ no_truth: scored.filter(m => m.totals[f].skip === 'no_truth').length, incomplete_prediction: scored.filter(m => m.totals[f].skip === 'incomplete_prediction').length });
  const usable = (f) => scored.filter(m => m.totals[f].skip === undefined);
  const kcalMeals = usable('kcal').filter(m => m.totals.kcal.true > 0);
  const kcalRecs = kcalMeals.map(m => { const { true: t, pred: p } = m.totals.kcal; return { day: m.day, ape: Math.abs(p - t) / t, signed: (p - t) / t, diff: p - t }; });
  const diffs = kcalRecs.map(r => r.diff);
  const m0 = mean(diffs); const s0 = sd(diffs);
  const meal_kcal = { ...apeBlock(kcalRecs, boot), mae_kcal: fin(mean(diffs.map(Math.abs))), excluded: { ...excluded('kcal'), zero_truth: usable('kcal').length - kcalMeals.length } };
  const bland_altman = { n: diffs.length, mean_diff: fin(m0), sd: fin(s0), lower: fin(m0 - 1.96 * s0), upper: fin(m0 + 1.96 * s0) };
  const macros = {};
  for (const f of NUTRIENTS.slice(1)) {
    const u = usable(f);
    macros[f] = { n: u.length, mae_g: u.length ? mean(u.map(m => Math.abs(m.totals[f].pred - m.totals[f].true))) : null, excluded: excluded(f) };
  }

  // 80% interval coverage on matched items that carry lo80/hi80
  const withInterval = items.filter(i => i.covered !== undefined);
  const cov = withInterval.map(i => (i.covered ? 1 : 0)); const covDays = withInterval.map(i => i.day);
  const covCi = withInterval.length ? bootstrapCI(cov, covDays, { stat: mean, ...boot }) : null;
  const interval80 = {
    n: withInterval.length, coverage: withInterval.length ? mean(cov) : null,
    mean_width_g: withInterval.length ? mean(withInterval.map(i => i.hi80 - i.lo80)) : null,
    ci95: covCi ? { lo: fin(covCi.lo), hi: fin(covCi.hi) } : null,
  };

  return {
    schema: REPORT_SCHEMA_ID, pipeline: predictions.pipeline, split, seed, resamples,
    counts: {
      meals: meals.length, days: new Set(scored.map(m => m.day)).size,
      meals_without_prediction: scored.filter(m => !m.has_prediction).length,
      predictions_outside_split: predictions.meals.filter(m => inManifest.has(m.meal_id) && !inSplit.has(m.meal_id)).length,
      predictions_unknown_meal: predictions.meals.filter(m => !inManifest.has(m.meal_id)).length,
    },
    recognition, item_mass, meal_kcal, macros, bland_altman, interval80,
    gates: {
      meal_kcal_mape_upper95: meal_kcal.ci95?.mape.hi ?? null,
      item_mass_mape_upper95: item_mass.ci95?.mape.hi ?? null,
      meal_kcal_abs_bias_upper95: meal_kcal.ci95?.abs_bias.hi ?? null,
      item_mass_abs_bias_upper95: item_mass.ci95?.abs_bias.hi ?? null,
      interval80_coverage: interval80.coverage,
    },
    per_meal: scored.map(m => {
      const k = m.totals.kcal;
      return {
        meal_id: m.meal_id, day: m.day, omissions: m.omissions, intrusions: m.intrusions,
        kcal_true: k.true ?? null, kcal_pred: k.pred ?? null, kcal_ape: k.true > 0 ? Math.abs(k.pred - k.true) / k.true : null,
        items: m.items.map(({ day, ...i }) => i),
      };
    }),
  };
}
