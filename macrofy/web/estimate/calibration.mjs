// Calibration from scale checks (T-016, ADR 0006): pure, import-free maths so Node tests it (web/estimate/calibration-selftest.mjs)
// and the browser runs the same file (web/sync-data.mjs copies it to web/app/vendor/calibration.mjs). Spec: docs/specs/SPEC-T-016-zero-setup-scale-checks.md.
//
// A scale check stores what the app showed (grams, range, macros per item) next to the grams the owner weighed. From the checks:
//  (a) one global multiplicative factor on grams: the geometric mean of truth / raw grams, shrunk toward 1 with few checks;
//  (b) a factor per food group once the group has N item checks (pooled toward the global factor);
//  (c) split-conformal 80% ranges from the log-ratio residuals once there are M checks; before that the model-based ranges stay.
// The learning target is raw_g (before any factor), so a learned correction never compounds with itself. The residuals use the grams
// that were SHOWN before the truth was known, so they are out of sample and valid for conformal ranges.
// The priors k, N and M live in priors.json (calibration), each an assumption.

export const CHECK_SCHEMA_ID = 'macrofy.checks/1';
export const BENCH_SCHEMA_ID = 'macrofy.bench/1';
export const PREDICTIONS_SCHEMA_ID = 'macrofy.predictions/1';
export const COVERAGE = 0.8;
/** Under this many checks the accuracy screen says "precisa de mais conferências". */
export const MIN_CHECKS_FOR_ACCURACY = 5;
export const MAX_ITEM_G = 3000; // the benchmark's plausibility bound (bench/schema-core.mjs)

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const HEX64 = /^[0-9a-f]{64}$/;

/** priors.calibration -> { k, groupMin, conformalMin }. */
export function paramsFrom(priors) {
  const c = priors?.calibration;
  const need = (key) => { const v = c?.[key]?.value; if (!isNum(v) || v < 0) throw new Error(`priors.calibration.${key} ausente ou inválido`); return v; };
  return { k: need('shrinkage_k'), groupMin: need('group_min_checks'), conformalMin: need('conformal_min_checks') };
}

// ---------------------------------------------------------------- the pieces
/** Weight of the data against the prior: n / (n + k). Zero checks give 0, so the prior (factor 1) wins. */
export const shrinkWeight = (n, k) => (n + k > 0 ? n / (n + k) : 0);

/** Global factor: exp(w x mean ln(truth / raw)), w = n / (n + k). logRatios: one ln(truth / raw) per observation. */
export function globalFactor(logRatios, k) {
  const n = logRatios.length;
  if (!n) return { factor: 1, n: 0, mean_log: 0 };
  const m = logRatios.reduce((a, b) => a + b, 0) / n;
  return { factor: Math.exp(shrinkWeight(n, k) * m), n, mean_log: m };
}

/** Group factor: pooled toward the global one, exp(L + w (m_g - L)) with L = ln(global factor) and w = n_g / (n_g + k). */
export function groupFactor(logRatios, globalLog, k) {
  const n = logRatios.length;
  const m = logRatios.reduce((a, b) => a + b, 0) / n;
  return { factor: Math.exp(globalLog + shrinkWeight(n, k) * (m - globalLog)), n, mean_log: m };
}

/**
 * Split-conformal quantile of nonconformity scores at the given coverage: the ceil((n + 1) x coverage)-th smallest score.
 * null when that rank is beyond n (fewer than 4 scores at 80%): no finite interval is guaranteed.
 */
export function conformalQuantile(scores, coverage = COVERAGE) {
  const n = scores.length;
  const rank = Math.ceil((n + 1) * coverage - 1e-9);
  if (n === 0 || rank > n) return null;
  return [...scores].sort((a, b) => a - b)[rank - 1];
}

// ---------------------------------------------------------------- checks -> observations
const scoredItems = (c) => (c.truth_kind === 'items' ? (c.items ?? []).filter((it) => isNum(it.truth_g) && it.truth_g > 0) : (c.items ?? []));
const usable = (c) => c && Array.isArray(c.items) && (c.truth_kind === 'items' || (c.truth_kind === 'total' && isNum(c.truth_total_g) && c.truth_total_g > 0));

/**
 * Observations of one check. Item checks give one per weighed item ({group, lr = ln(truth / raw), s = |ln(truth / shown)|}).
 * A total-only check gives one meal observation with no group. Every check gives one meal residual (weighed items only for
 * item checks; the whole plate for a total).
 */
export function observations(check) {
  const out = { items: [], total: null, meal: null };
  if (!usable(check)) return out;
  if (check.truth_kind === 'items') {
    for (const it of scoredItems(check)) {
      if (it.raw_g > 0 && it.grams > 0) out.items.push({ group: it.group, lr: Math.log(it.truth_g / it.raw_g), s: Math.abs(Math.log(it.truth_g / it.grams)) });
    }
    const sc = scoredItems(check).filter((it) => it.grams > 0);
    const T = sc.reduce((a, it) => a + it.truth_g, 0); const P = sc.reduce((a, it) => a + it.grams, 0);
    if (sc.length && T > 0 && P > 0) out.meal = { s: Math.abs(Math.log(T / P)) };
  } else {
    const raw = check.items.reduce((a, it) => a + (it.raw_g || 0), 0); const shown = check.items.reduce((a, it) => a + (it.grams || 0), 0);
    if (raw > 0 && shown > 0) { out.total = { lr: Math.log(check.truth_total_g / raw) }; out.meal = { s: Math.abs(Math.log(check.truth_total_g / shown)) }; }
  }
  return out;
}

const plural = (n) => `${n} conferência${n === 1 ? '' : 's'}`;
/** The honest state shown on the result: "Não calibrado" until a check exists, then "Calibrado com N conferências". */
export const stateLabel = (state) => (state && state.n_checks > 0 ? `Calibrado com ${plural(state.n_checks)}` : 'Não calibrado');

/**
 * Everything learned from the checks. params: { k, groupMin, conformalMin } (paramsFrom). Returns
 * { n_checks, n_item_checks, n_obs, global: {factor, n}, groups: {group: {factor, n}}, ranges: {item, meal}, label }
 * where ranges.item / ranges.meal are { q, n } (a log half-width and the residual count) or null while there are fewer than M checks.
 */
export function learn(checks, params) {
  const { k, groupMin, conformalMin } = params;
  const good = (checks ?? []).filter(usable);
  const obs = good.map((c) => ({ c, o: observations(c) }));
  const withData = obs.filter(({ o }) => o.items.length || o.total);
  const itemObs = withData.flatMap(({ o }) => o.items);
  const allLr = [...itemObs.map((x) => x.lr), ...withData.filter(({ o }) => o.total).map(({ o }) => o.total.lr)];
  const g = globalFactor(allLr, k);
  const byGroup = new Map();
  for (const x of itemObs) { if (!byGroup.has(x.group)) byGroup.set(x.group, []); byGroup.get(x.group).push(x.lr); }
  const groups = {};
  for (const [name, lrs] of byGroup) if (lrs.length >= groupMin) { const { factor, n } = groupFactor(lrs, Math.log(g.factor), k); groups[name] = { factor, n }; }
  const itemChecks = withData.filter(({ o }) => o.items.length);
  const mealRes = withData.filter(({ o }) => o.meal).map(({ o }) => o.meal.s);
  const itemRes = itemChecks.flatMap(({ o }) => o.items.map((x) => x.s));
  const q = (checksN, res) => { if (checksN < conformalMin) return null; const v = conformalQuantile(res); return v === null ? null : { q: v, n: res.length }; };
  const state = {
    n_checks: withData.length, n_item_checks: itemChecks.length, n_obs: allLr.length,
    global: { factor: g.factor, n: g.n }, groups,
    ranges: { item: q(itemChecks.length, itemRes), meal: q(withData.filter(({ o }) => o.meal).length, mealRes) },
  };
  return { ...state, label: stateLabel(state) };
}

/** The learned factors in the shape core.calibrationFactor reads: a group's own factor, else "default" (the global one). Empty with no checks. */
export const toCalibration = (state) => (state && state.n_obs > 0
  ? { schema: 'macrofy.calibration/1', factors: { default: state.global.factor, ...Object.fromEntries(Object.entries(state.groups).map(([k, v]) => [k, v.factor])) } }
  : { schema: 'macrofy.calibration/1', factors: {} });

/**
 * Conformal 80% ranges over items and totals once the state has them: shown grams x exp(-+q), q from the residual quantile.
 * Returns new objects; without conformal ranges the model-based ones pass through unchanged (range_basis "model").
 */
export function applyRanges(items, totals, state) {
  const wide = (grams, q) => ({ lo80: r1(grams * Math.exp(-q)), hi80: r1(grams * Math.exp(q)) });
  const qi = state?.ranges?.item?.q; const qm = state?.ranges?.meal?.q;
  return {
    items: items.map((it) => (qi === undefined ? { ...it, range_basis: 'model' } : { ...it, ...wide(it.grams, qi), range_basis: 'conformal' })),
    totals: qm === undefined ? { ...totals, range_basis: 'model' } : { ...totals, ...wide(totals.grams, qm), range_basis: 'conformal' },
  };
}

// ---------------------------------------------------------------- building a check
/**
 * A check from a shown estimate and what the owner typed. input:
 *   estimate { id, items, totals, plate_typical, diameter_mm, oil }  (items as core.estimateItem returns them, totals as core.totals)
 *   truth_items: one grams string/number per estimate item ('' or null = not weighed), truth_total: grams of the whole plate ('' = none),
 *   other_app_kcal: optional, comparison only (never truth), photo_sha256, created_at (ISO with offset), stateOf(class_id) -> 'raw'|'cooked',
 *   state: the calibration state that was in force (its label is stored).
 * Returns { check } or { errors: [pt-BR messages] }. Item weights win over a plate total when both are typed.
 */
export function buildCheck(input) {
  const { estimate, truth_items = [], truth_total = '', other_app_kcal = '', photo_sha256, created_at, stateOf = () => 'cooked', state = null } = input;
  const errors = [];
  const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
  const items = estimate.items.map((it, i) => ({ v: num(truth_items[i]), it, i }));
  for (const { v, it } of items) if (v !== null && !(isNum(v) && v > 0 && v <= MAX_ITEM_G)) errors.push(`${it.label}: digite os gramas da balança (maior que 0 e até ${MAX_ITEM_G}).`);
  const total = num(truth_total);
  if (total !== null && !(isNum(total) && total > 0 && total <= MAX_ITEM_G * Math.max(1, estimate.items.length))) errors.push('Total do prato: digite os gramas da balança (número maior que 0).');
  const other = num(other_app_kcal);
  if (other !== null && !(isNum(other) && other >= 0 && other <= 10000)) errors.push('Calorias do outro app: digite um número de kcal (ou deixe em branco).');
  const anyItem = items.some(({ v }) => v !== null);
  if (!anyItem && total === null && !errors.length) errors.push('Digite os gramas de pelo menos um item, ou o total do prato.');
  if (errors.length) return { errors };
  const kind = anyItem ? 'items' : 'total';
  return {
    check: {
      schema: CHECK_SCHEMA_ID, id: `chk-${estimate.id}`, estimate_id: estimate.id, created_at, photo_sha256: photo_sha256 ?? null,
      pipeline: estimate.pipeline ?? null, plate: { typical: !!estimate.plate_typical, diameter_mm: estimate.diameter_mm ?? null }, oil: estimate.oil ?? null,
      calibration: state ? { label: state.label, n_checks: state.n_checks } : { label: 'Não calibrado', n_checks: 0 },
      truth_kind: kind, truth_total_g: kind === 'total' ? total : null, other_app_kcal: other,
      items: items.map(({ v, it }) => ({
        class_id: it.class_id, label: it.label, group: it.group, state: stateOf(it.class_id), raw_g: it.raw_grams ?? it.grams, grams: it.grams, lo80: it.lo80, hi80: it.hi80,
        kcal: it.kcal, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g, oil_g: it.oil_g, truth_g: kind === 'items' ? v : null,
      })),
      pred_total: { grams: estimate.totals.grams, lo80: estimate.totals.lo80, hi80: estimate.totals.hi80, kcal: estimate.totals.kcal },
    },
  };
}

// ---------------------------------------------------------------- checks -> macrofy.bench/1 + macrofy.predictions/1
/**
 * The manifest and predictions the evaluation engine scores. One meal per check (id = check id), all in the "test" split (a check is
 * predicted before it is weighed, so it is held out by construction). Predictions are the grams and ranges that were SHOWN.
 * Item checks score the weighed items only (the others are left out of the predictions so they do not count as intrusions);
 * a total-only check splits the plate truth over the items in proportion to the shown grams (assumption: the item mix was right),
 * so it counts for kcal but is not an item-mass check (item_level_ids lists the item checks). The oil of a truth item is the shown
 * oil in proportion to the grams (oil is not weighed). The same photo checked twice counts once: the newest check wins.
 * opts: { scale: {model, resolution_g}, pipeline: {name, version} }.
 */
export function checksToBench(checks, { scale = null, pipeline = { name: 'macrofy-estimator', version: '0.2.0' } } = {}) {
  const newestByPhoto = new Map(); const skipped = [];
  for (const c of (checks ?? []).filter(usable)) {
    if (!HEX64.test(c.photo_sha256 ?? '') || !c.plate?.diameter_mm) { skipped.push(c.id); continue; }
    const old = newestByPhoto.get(c.photo_sha256);
    if (!old || String(c.created_at) >= String(old.created_at)) newestByPhoto.set(c.photo_sha256, c);
  }
  const used = [...newestByPhoto.values()].sort((a, b) => (String(a.created_at) < String(b.created_at) ? -1 : 1));
  const plates = new Map(); const meals = []; const preds = []; const itemLevel = [];
  for (const c of used) {
    const plateId = `plate-${Math.round(c.plate.diameter_mm)}`;
    if (!plates.has(plateId)) plates.set(plateId, { id: plateId, diameter_mm: c.plate.diameter_mm, kind: 'plate' });
    const shownAll = c.items.reduce((a, it) => a + it.grams, 0);
    const ratio = c.truth_kind === 'total' && shownAll > 0 ? c.truth_total_g / shownAll : null;
    const scored = c.items.filter((it) => (c.truth_kind === 'items' ? isNum(it.truth_g) && it.truth_g > 0 : true));
    const truthOf = (it) => (c.truth_kind === 'items' ? it.truth_g : r2(it.grams * ratio));
    if (!scored.length || (c.truth_kind === 'total' && !(ratio > 0))) { skipped.push(c.id); continue; }
    if (c.truth_kind === 'items') itemLevel.push(c.id);
    meals.push({
      id: c.id, captured_at: c.created_at, split: 'test', plate_id: plateId,
      photos: [{ sha256: c.photo_sha256, phash: c.photo_sha256.slice(0, 16), angle_deg: 90, lighting: 'daylight' }],
      items: scored.map((it, i) => ({ id: `i${i + 1}`, label: it.label, grams: truthOf(it), state: it.state ?? 'cooked', method: 'scale-check', oil_g: it.grams > 0 ? r2((it.oil_g ?? 0) * truthOf(it) / it.grams) : 0 })),
    });
    preds.push({ meal_id: c.id, items: scored.map((it) => ({ label: it.label, grams: it.grams, kcal: it.kcal, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g, lo80: it.lo80, hi80: it.hi80 })) });
  }
  return {
    manifest: { schema: BENCH_SCHEMA_ID, scale: scale ?? { model: 'Balança de cozinha (modelo não informado)', resolution_g: 1 }, plates: [...plates.values()], meals },
    predictions: { schema: PREDICTIONS_SCHEMA_ID, pipeline: { name: pipeline.name, version: pipeline.version }, meals: preds },
    item_level_ids: itemLevel, skipped,
  };
}

/** The subset of a bench (manifest + predictions) that has these meal ids. */
export function subsetBench(bench, ids) {
  const keep = new Set(ids);
  const usedPlates = new Set(bench.manifest.meals.filter((m) => keep.has(m.id)).map((m) => m.plate_id));
  return {
    manifest: { ...bench.manifest, plates: bench.manifest.plates.filter((p) => usedPlates.has(p.id)), meals: bench.manifest.meals.filter((m) => keep.has(m.id)) },
    predictions: { ...bench.predictions, meals: bench.predictions.meals.filter((m) => keep.has(m.meal_id)) },
  };
}

/** Our kcal vs the other app's kcal vs the scale truth, for the checks that have an other-app reading. report: evaluate() over the same meals. */
export function otherAppComparison(checks, report) {
  const byId = new Map((checks ?? []).map((c) => [c.id, c]));
  const rows = (report?.per_meal ?? []).filter((m) => m.kcal_true > 0 && m.kcal_pred !== null && isNum(byId.get(m.meal_id)?.other_app_kcal))
    .map((m) => ({ id: m.meal_id, day: m.day, ours: m.kcal_pred, theirs: byId.get(m.meal_id).other_app_kcal, truth: m.kcal_true }));
  const mape = (key) => (rows.length ? rows.reduce((a, r) => a + Math.abs(r[key] - r.truth) / r.truth, 0) / rows.length : null);
  return { n: rows.length, rows, ours_mape: mape('ours'), theirs_mape: mape('theirs') };
}

/**
 * The accuracy screen's numbers. evaluate is eval/metrics.mjs (injected: Node and the browser load it differently), truthNutrients the
 * nutrition lookup's adapter. Two runs: all checks for meal kcal and the other-app comparison, item checks only for item mass.
 * Returns null when no check can be scored. Bootstrap by capture day is the engine's own.
 */
export function accuracy(checks, { evaluate, truthNutrients, scale = null, pipeline, resamples } = {}) {
  const bench = checksToBench(checks, { scale, pipeline });
  if (!bench.manifest.meals.length) return null;
  const opts = { truthNutrients, ...(resamples ? { resamples } : {}) };
  const all = evaluate(bench.manifest, bench.predictions, opts);
  let items = null;
  if (bench.item_level_ids.length) { const b = subsetBench(bench, bench.item_level_ids); items = evaluate(b.manifest, b.predictions, opts); }
  return {
    n_checks: bench.manifest.meals.length, n_item_checks: bench.item_level_ids.length, days: all.counts.days, skipped: bench.skipped,
    meal_kcal: all.meal_kcal, item_mass: items ? items.item_mass : null, interval80: items ? items.interval80 : null,
    other_app: otherAppComparison(checks, all), needs_more: bench.manifest.meals.length < MIN_CHECKS_FOR_ACCURACY, bench,
  };
}

/** The file the owner shares: the raw checks plus the bench derived from them, so the repo can score it with the engine. */
export function exportChecks(checks, { scale = null, exported_at = null, pipeline } = {}) {
  const bench = checksToBench(checks, { scale, pipeline });
  return { schema: CHECK_SCHEMA_ID, exported_at, checks: [...(checks ?? [])].sort((a, b) => (String(a.created_at) < String(b.created_at) ? -1 : 1)), bench: { manifest: bench.manifest, predictions: bench.predictions, item_level_ids: bench.item_level_ids } };
}
