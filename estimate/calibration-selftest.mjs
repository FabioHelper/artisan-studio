// Check `calibration-selftest`: node web/estimate/calibration-selftest.mjs (run from macrofy/, Node built-ins only).
// Learned correction and conformal ranges from scale checks, compared with numbers computed by hand (the arithmetic is next to each
// fixture), the zero-check fallback, and the checks -> manifest + predictions -> evaluate round trip. The last section proves the
// assertions bite: wrong formulas and broken inputs must be reported as failures.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cal from './calibration.mjs';
import * as core from './core.mjs';
import { plateSetup, priorsForPlate } from './autoseg.mjs';
import { createLookup } from '../../nutrition/lookup-core.mjs';
import { truthNutrients, VOCAB } from '../../nutrition/lookup.mjs';
import { validateManifest } from '../../bench/schema.mjs';
import { validatePredictions, evaluate } from '../../eval/metrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const priors = JSON.parse(fs.readFileSync(join(HERE, 'priors.json'), 'utf8'));
const lookup = createLookup(VOCAB);
const cls = (id) => VOCAB.classes.find((c) => c.id === id);

let failures = 0;
const ok = (name) => console.log(`PASS ${name}`);
const bad = (name, detail = '') => { failures++; console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`); };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
const closeTo = (name, actual, expected, tol) => check(name, near(actual, expected, tol), `got ${actual}, expected ${expected} +- ${tol}`);
const sha = (s) => createHash('sha256').update(s).digest('hex');

// One-item (or few-item) checks straight in the stored shape. raw = model grams before any factor, shown = what the screen said.
let seq = 0;
const item = (group, raw, shown, truth, extra = {}) => ({ class_id: extra.class_id ?? group, label: extra.label ?? group, group, state: 'cooked', raw_g: raw, grams: shown, lo80: extra.lo ?? shown / 2, hi80: extra.hi ?? shown * 2, kcal: extra.kcal ?? 0, protein_g: 0, carbs_g: 0, fat_g: 0, oil_g: 0, truth_g: truth });
const mk = (items, extra = {}) => {
  const n = ++seq;
  return { schema: cal.CHECK_SCHEMA_ID, id: `chk-${n}`, estimate_id: `e${n}`, created_at: `2026-09-${String(10 + (n % 15)).padStart(2, '0')}T12:00:00-03:00`, photo_sha256: sha(`photo${n}`),
    plate: { typical: true, diameter_mm: 260 }, truth_kind: 'items', truth_total_g: null, other_app_kcal: null, items, ...extra };
};
const params = { k: 4, groupMin: 3, conformalMin: 9 }; // fixture priors: the shipped ones are in priors.json

// ---------------------------------------------------------------- (a) the shrunk global factor
// Four weighed items, truth 200 g against a raw 100 g each: geometric mean of truth/raw = 2. With k = 4 pseudo-checks the weight is
// n / (n + k) = 4 / 8 = 1/2, so the factor is 2^(1/2) = 1.41421 (not 2).
const four = [1, 2, 3, 4].map(() => mk([item('rice', 100, 100, 200)]));
const s4 = cal.learn(four, params);
closeTo('global: four checks of x2 with k = 4 shrink to 2^(4/8) = 1.41421', s4.global.factor, Math.SQRT2, 1e-9);
check('global: label says "Calibrado com 4 conferências"', s4.label === 'Calibrado com 4 conferências' && s4.n_checks === 4);
// Truth/raw of 4 and 1: geometric mean sqrt(4 x 1) = 2, n = 2, weight 2 / 6 = 1/3, factor 2^(1/3) = 1.25992.
closeTo('global: ratios 4 and 1 (geometric mean 2), weight 1/3: 2^(1/3) = 1.25992', cal.learn([mk([item('a', 100, 100, 400)]), mk([item('a', 100, 100, 100)])], params).global.factor, 1.25992105, 1e-8);
// Three checks of truth/raw 0.5: weight 3 / 7, factor 0.5^(3/7) = exp(-0.297064) = 0.74300 (below 1: the app overestimates).
closeTo('global: three checks of x0.5 give 0.5^(3/7) = 0.74300', cal.learn([1, 2, 3].map(() => mk([item('a', 100, 100, 50)])), params).global.factor, 0.743, 1e-4);
// One check of x2: weight 1 / 5, factor 2^(1/5) = 1.14870: even the first weighing moves the number, gently.
closeTo('global: one check of x2, k = 4: 2^(1/5) = 1.14870', cal.learn([mk([item('a', 100, 100, 200)])], params).global.factor, 1.1486984, 1e-6);
// The learning target is raw grams: raw 100, shown 120 (a factor was already applied), truth 200 -> ln(200 / 100), not ln(200 / 120).
closeTo('global: learns from raw grams, so a shown correction never compounds: 2^(1/5)', cal.learn([mk([item('a', 100, 120, 200)])], params).global.factor, 1.1486984, 1e-6);
// A plate total with no item weights: truth 300 g against the raw sum 100 + 50 = 150 -> ratio 2, one observation, no group.
const totalOnly = mk([item('rice', 100, 100, null), item('beans', 50, 50, null)], { truth_kind: 'total', truth_total_g: 300 });
const st = cal.learn([totalOnly], params);
closeTo('global: a plate total counts as one observation: 2^(1/5)', st.global.factor, 1.1486984, 1e-6);
check('global: a plate total feeds no group factor', Object.keys(st.groups).length === 0 && st.n_item_checks === 0 && st.n_checks === 1);

// ---------------------------------------------------------------- (b) per-group factors
// k = 4, N = 3. Rice x4 checks at truth/raw 2, salad x3 at 0.5, egg x1 at 1: eight observations, sum ln = 4 ln2 - 3 ln2 = ln2.
//   global: weight 8 / 12 = 2/3, mean ln = ln2 / 8, so ln F = ln2 / 12 and F = 2^(1/12) = 1.05946.
//   rice (n 4 >= 3): w = 4 / 8 = 1/2, ln F_g = ln2/12 + (1/2)(ln2 - ln2/12) = ln2 x 13/24, F = 2^(13/24) = exp(0.375455) = 1.455653.
//   salad (n 3 >= 3): w = 3 / 7, ln F_g = ln2/12 + (3/7)(-ln2 - ln2/12) = ln2 x (7 - 39)/84 = -8/21 ln2, F = 2^(-8/21) = exp(-0.264056) = 0.767930.
//   egg (n 1 < 3): no own factor, it uses the global 1.05946.
const grouped = [...[1, 2, 3, 4].map(() => mk([item('rice_pasta', 100, 100, 200)])), ...[1, 2, 3].map(() => mk([item('salad_raw', 100, 100, 50)])), mk([item('egg', 100, 100, 100)])];
const sg = cal.learn(grouped, params);
closeTo('group: global factor 2^(1/12) = 1.05946', sg.global.factor, 1.0594631, 1e-6);
closeTo('group: rice (4 checks) pooled toward the global: 2^(13/24) = 1.455653', sg.groups.rice_pasta.factor, 1.455653, 1e-5);
closeTo('group: salad (3 checks) pooled: 2^(-8/21) = 0.767930', sg.groups.salad_raw.factor, 0.76793, 1e-5);
check('group: egg (1 check < N = 3) gets no factor of its own', !('egg' in sg.groups) && sg.groups.rice_pasta.n === 4 && sg.groups.salad_raw.n === 3);
const cf = cal.toCalibration(sg); const lc = core.loadCalibration(cf);
check('group: toCalibration is what core reads: rice its own factor, egg the default (global)', near(core.calibrationFactor(lc, 'rice_pasta'), 1.455653, 1e-5) && near(core.calibrationFactor(lc, 'egg'), 1.0594631, 1e-6));
const riceCls = cls('arroz-branco-cozido');
const scale = core.scaleFromAxes(200, 160, 260);
const plain = core.estimateItem({ cls: riceCls, pixels: 20000, scale, priors, lookup });
const learned = core.estimateItem({ cls: riceCls, pixels: 20000, scale, priors, lookup, calibration: lc });
closeTo('group: the estimator applies the learned factor to the displayed grams (141.07 x 1.455653 = 205.35)', learned.grams, 141.07275 * 1.455653, 0.06);
closeTo('group: raw_grams is untouched by the factor', learned.raw_grams, plain.grams, 0.06);
check('group: calibrated flag follows the factor', plain.calibrated === false && learned.calibrated === true);

// ---------------------------------------------------------------- (c) conformal 80% ranges
// Nine checks, each shown 100 g. Truth 105, 95, 110, 90, 125, 130, 70, 150, 60 give |ln(truth / shown)| =
//   0.04879, 0.05129, 0.09531, 0.10536, 0.22314, 0.26236, 0.35667, 0.40547, 0.51083.
// Rank = ceil((9 + 1) x 0.8) = 8, the 8th smallest = 0.40547 = ln 1.5, so the range of a shown 100 g is 100 / 1.5 = 66.7 to 100 x 1.5 = 150.0.
const truths = [105, 95, 110, 90, 125, 130, 70, 150, 60];
const nine = truths.map((t) => mk([item('rice_pasta', 100, 100, t)]));
const sn = cal.learn(nine, params);
check('conformal: with M = 9 checks the item and meal ranges exist', sn.ranges.item !== null && sn.ranges.meal !== null && sn.ranges.item.n === 9);
closeTo('conformal: q = the 8th smallest residual = ln 1.5 = 0.405465', sn.ranges.item.q, Math.log(1.5), 1e-9);
const shown = [{ ...plain, grams: 100, lo80: 60, hi80: 150 }];
const applied = cal.applyRanges(shown, { grams: 100, lo80: 60, hi80: 150 }, sn);
closeTo('conformal: shown 100 g -> lo80 66.7', applied.items[0].lo80, 66.7, 0.05); closeTo('conformal: shown 100 g -> hi80 150.0', applied.items[0].hi80, 150, 0.05);
closeTo('conformal: the meal range is the same for one-item meals', applied.totals.lo80, 66.7, 0.05);
check('conformal: range_basis says conformal', applied.items[0].range_basis === 'conformal' && applied.totals.range_basis === 'conformal');
closeTo('conformal quantile on raw scores: rank ceil(10 x 0.8) = 8', cal.conformalQuantile([0.05, 0.3, 0.1, 0.2, 0.15, 0.4, 0.25, 0.35, 0.02]), 0.35, 1e-12);
check('conformal quantile: fewer than 4 scores have no finite 80% rank', cal.conformalQuantile([0.1, 0.2, 0.3]) === null && cal.conformalQuantile([]) === null);
check('conformal quantile: 4 scores -> rank ceil(5 x 0.8) = 4, the largest', cal.conformalQuantile([0.4, 0.1, 0.3, 0.2]) === 0.4);
check('conformal quantile: rank at n = 14 is 12, not 13 (float noise on 15 x 0.8)', cal.conformalQuantile(Array.from({ length: 14 }, (_, i) => i + 1)) === 12);
const eight = cal.learn(nine.slice(0, 8), params);
check('conformal: with 8 checks (< M = 9) the model-based ranges stay', eight.ranges.item === null && eight.ranges.meal === null);
const keep = cal.applyRanges(shown, { grams: 100, lo80: 60, hi80: 150 }, eight);
check('conformal: before M checks lo80/hi80 pass through unchanged (model)', keep.items[0].lo80 === 60 && keep.items[0].hi80 === 150 && keep.items[0].range_basis === 'model' && keep.totals.range_basis === 'model');
// Residuals use the SHOWN grams: a check shown 200 g (raw 100) with truth 200 has residual 0 even though the raw ratio is 2.
const sShown = cal.learn([mk([item('a', 100, 200, 200)])], { ...params, conformalMin: 1 });
check('conformal: residuals are out of sample (shown, not raw): shown 200 truth 200 -> residual 0', sShown.ranges.item === null /* one score has no 80% rank */ && cal.observations(mk([item('a', 100, 200, 200)])).items[0].s === 0);
const realM = cal.paramsFrom(priors);
check('conformal: the shipped priors give k, N, M (assumptions in priors.json)', realM.k === 5 && realM.groupMin === 5 && realM.conformalMin === 10, JSON.stringify(realM));

// ---------------------------------------------------------------- zero checks: the typical-plate prior and its wider ranges
const s0 = cal.learn([], realM);
check('zero checks: label "Não calibrado", every factor 1, no conformal ranges', s0.label === 'Não calibrado' && s0.global.factor === 1 && s0.n_checks === 0 && s0.ranges.item === null && s0.ranges.meal === null && Object.keys(s0.groups).length === 0);
check('zero checks: toCalibration is empty and core.calibrationFactor gives 1', Object.keys(cal.toCalibration(s0).factors).length === 0 && core.calibrationFactor(core.loadCalibration(cal.toCalibration(s0)), 'rice_pasta') === 1);
const typical = plateSetup(priors, null); const known = plateSetup(priors, { id: 'p', name: 'p', diameter_mm: 260 });
check('zero checks: with no plate the typical-plate prior applies (26 cm, wider scale uncertainty 0.12 vs 0.05)', typical.typical === true && typical.diameter_mm === priors.typical_plate.diameter_mm && typical.scale_uncertainty === 0.12 && known.scale_uncertainty === 0.05);
const wide = core.estimateItem({ cls: riceCls, pixels: 20000, scale, priors: priorsForPlate(priors, typical), lookup, calibration: core.loadCalibration(cal.toCalibration(s0)) });
const narrow = core.estimateItem({ cls: riceCls, pixels: 20000, scale, priors: priorsForPlate(priors, known), lookup });
check('zero checks: the displayed grams are the raw grams', wide.grams === wide.raw_grams && wide.grams === narrow.grams);
check('zero checks: the typical plate gives a wider range than a measured one', wide.hi80 - wide.lo80 > narrow.hi80 - narrow.lo80 && wide.sigma_scale > narrow.sigma_scale);
// sigma_scale 2 ln(1.12) = 0.226640 vs 2 ln(1.05) = 0.097580; rice sigma sqrt(0.0861777 + 0.051366) = 0.37088 vs 0.309354.
closeTo('zero checks: typical-plate rice sigma = sqrt(ln 1.09 + (2 ln 1.12)^2) = 0.37088', wide.sigma, 0.37088, 1e-4);
const p0 = cal.applyRanges([wide], core.totals([wide]), s0);
check('zero checks: applyRanges leaves the model-based (wider) range alone', p0.items[0].lo80 === wide.lo80 && p0.items[0].hi80 === wide.hi80 && p0.items[0].range_basis === 'model');
const bad0 = cal.learn([{ id: 'x', truth_kind: 'items', items: [item('a', 0, 0, 100)] }, { id: 'y' }, null], realM);
check('zero checks: unusable checks (no raw grams, malformed) are ignored, still "Não calibrado"', bad0.label === 'Não calibrado' && bad0.n_checks === 0);

// ---------------------------------------------------------------- building a check from what the owner typed
const steakItem = (shown, truth) => ({ class_id: 'bife-grelhado', label: 'bife grelhado', group: 'cutlet_meat', raw_grams: shown, grams: shown, lo80: shown * 0.7, hi80: shown * 1.4, kcal: r(1.94 * shown), protein_g: 0, carbs_g: 0, fat_g: 0, oil_g: 0, truth });
function r(x) { return Math.round(x * 100) / 100; }
const saladItem = (shown) => ({ class_id: 'salada-mista-crua', label: cls('salada-mista-crua').pt, group: 'salad_raw', raw_grams: shown, grams: shown, lo80: shown * 0.6, hi80: shown * 1.7, kcal: r(0.186 * shown), protein_g: 0, carbs_g: 0, fat_g: 0, oil_g: 0 });
const est = (id, items) => ({ id, items, totals: { grams: items.reduce((a, i) => a + i.grams, 0), lo80: 1, hi80: 999, kcal: r(items.reduce((a, i) => a + i.kcal, 0)) }, plate_typical: true, diameter_mm: 260, oil: 'normal', pipeline: core.PIPELINE });
const stateOf = (id) => cls(id).state;
const make = (id, day, items, typed, extra = {}) => cal.buildCheck({ estimate: est(id, items), created_at: `2026-09-${day}T12:00:00-03:00`, photo_sha256: sha(`bench${id}`), stateOf, ...typed, ...extra });
// c1 day 08: steak shown 90 truth 100, salad shown 50 truth 40, other app said 250 kcal.
// c2 day 09: steak shown 120 truth 100.   c3 day 10: steak shown 100 truth 100, salad shown 30 truth 40, other app 180.
// c4 day 11 (plate total only): steak 100 + salad 50 shown, the scale said 120 g in total.
const b1 = make('e1', '08', [steakItem(90), saladItem(50)], { truth_items: ['100', '40'], other_app_kcal: '250' });
const b2 = make('e2', '09', [steakItem(120)], { truth_items: ['100'] });
const b3 = make('e3', '10', [steakItem(100), saladItem(30)], { truth_items: ['100,0', '40'], other_app_kcal: 180 });
const b4 = make('e4', '11', [steakItem(100), saladItem(50)], { truth_items: ['', ''], truth_total: '120' });
check('buildCheck: builds all four (comma decimals ok), ids link to the estimate', [b1, b2, b3, b4].every((b) => b.check) && b1.check.id === 'chk-e1' && b1.check.estimate_id === 'e1');
check('buildCheck: stores predicted items, grams, ranges, truth grams and the other-app kcal', b1.check.items[0].grams === 90 && near(b1.check.items[0].lo80, 63, 1e-9) && near(b1.check.items[0].hi80, 126, 1e-9) && b1.check.items[0].truth_g === 100 && b1.check.items[1].truth_g === 40 && b1.check.other_app_kcal === 250 && b1.check.truth_kind === 'items');
check('buildCheck: a total-only check has truth_total_g and no item truth; state comes from the vocab', b4.check.truth_kind === 'total' && b4.check.truth_total_g === 120 && b4.check.items.every((i) => i.truth_g === null) && b1.check.items[0].state === 'cooked' && b1.check.items[1].state === 'raw');
check('buildCheck: item weights win over a typed total', make('e5', '12', [steakItem(100)], { truth_items: ['100'], truth_total: '500' }).check.truth_kind === 'items');
const errs = (typed) => make('e9', '12', [steakItem(100)], typed).errors ?? [];
check('buildCheck: nothing typed is an error in pt-BR', errs({ truth_items: [''] }).length === 1 && /pelo menos um item/.test(errs({ truth_items: [''] })[0]));
check('buildCheck: zero, negative, text and too-large grams are errors', errs({ truth_items: ['0'] }).length === 1 && errs({ truth_items: ['-5'] }).length === 1 && errs({ truth_items: ['abc'] }).length === 1 && errs({ truth_items: ['3001'] }).length === 1);
check('buildCheck: a bad other-app kcal is an error, a blank one is fine', errs({ truth_items: ['100'], other_app_kcal: '-1' }).length === 1 && make('e9', '12', [steakItem(100)], { truth_items: ['100'], other_app_kcal: '' }).check.other_app_kcal === null);
const checks = [b1, b2, b3, b4].map((b) => b.check);
check('other-app kcal is comparison only: it never changes what is learned', JSON.stringify(cal.learn(checks, params)) === JSON.stringify(cal.learn(checks.map((c) => ({ ...c, other_app_kcal: 99999 })), params)));

// ---------------------------------------------------------------- checks -> manifest + predictions -> evaluate
const bench = cal.checksToBench(checks, { scale: { model: 'Fixture Scale', resolution_g: 1 } });
check('bench: the manifest passes every benchmark rule', validateManifest(bench.manifest).length === 0, JSON.stringify(validateManifest(bench.manifest).slice(0, 2)));
check('bench: the predictions pass the engine validator', validatePredictions(bench.predictions).length === 0);
check('bench: one meal per check, all "test" (predicted before weighed), item checks listed', bench.manifest.meals.length === 4 && bench.manifest.meals.every((m) => m.split === 'test') && bench.item_level_ids.join() === 'chk-e1,chk-e2,chk-e3');
check('bench: a total-only check splits the truth in proportion to the shown grams (100/150 and 50/150 of 120 g = 80 g and 40 g)', (() => { const m = bench.manifest.meals.find((x) => x.id === 'chk-e4'); return m.items[0].grams === 80 && m.items[1].grams === 40; })());
check('bench: predictions carry the SHOWN grams, ranges and macros', (() => { const p = bench.predictions.meals[0].items[0]; return p.grams === 90 && near(p.lo80, 63, 1e-9) && near(p.hi80, 126, 1e-9) && p.kcal === 174.6; })());
const acc = cal.accuracy(checks, { evaluate, truthNutrients, scale: { model: 'Fixture Scale', resolution_g: 1 } });
// Item APE (|shown - truth| / truth): steak 90/100 0.10, salad 50/40 0.25 | steak 120/100 0.20 | steak 100/100 0, salad 30/40 0.25. Mean of five = 0.8 / 5 = 0.16.
// Signed: -0.10, +0.25, +0.20, 0, -0.25 -> mean +0.02.
// Meal kcal (truth steak 1.94 kcal/g, salad 0.186 kcal/g): c1 shown 174.6 + 9.3 = 183.9 vs 194 + 7.44 = 201.44, APE 17.54 / 201.44 = 0.087073;
//   c2 232.8 vs 194: 0.2;  c3 194 + 5.58 = 199.58 vs 201.44: 1.86 / 201.44 = 0.009234;  c4 truth (80 g steak, 40 g salad) 155.2 + 7.44 = 162.64,
//   shown 203.3 = 162.64 / 0.8, APE 0.25.  Four meals: (0.087073 + 0.2 + 0.009234 + 0.25) / 4 = 0.136577.
closeTo('accuracy: item mass MAPE = 0.16 over the 5 weighed items (the total-only check is not an item check)', acc.item_mass.mape, 0.16, 1e-9);
closeTo('accuracy: item mass bias = +0.02', acc.item_mass.bias, 0.02, 1e-9);
check('accuracy: 5 items on 3 days, each with a bootstrap 95% CI around the estimate', acc.item_mass.n === 5 && acc.item_mass.days === 3 && acc.item_mass.ci95.mape.lo <= 0.16 && acc.item_mass.ci95.mape.hi >= 0.16 && acc.item_mass.ci95.bias.lo <= 0.02 && acc.item_mass.ci95.bias.hi >= 0.02);
closeTo('accuracy: meal kcal MAPE over all four checks = 0.136577', acc.meal_kcal.mape, 0.136577, 1e-5);
check('accuracy: meal kcal has n = 4, a 95% CI and the check count is 4 on 4 days', acc.meal_kcal.n === 4 && acc.meal_kcal.ci95.mape.lo <= acc.meal_kcal.mape && acc.meal_kcal.ci95.mape.hi >= acc.meal_kcal.mape && acc.n_checks === 4 && acc.days === 4);
check('accuracy: fewer than 5 checks says it needs more (4 here), 5 or more does not', acc.needs_more === true && cal.MIN_CHECKS_FOR_ACCURACY === 5 && cal.accuracy([...checks, make('e6', '13', [steakItem(100)], { truth_items: ['100'] }).check], { evaluate, truthNutrients }).needs_more === false);
// Other app: c1 truth 201.44: ours 183.9 (APE 0.087073), theirs 250 (48.56 / 201.44 = 0.241065); c3 ours 199.58 (0.009234), theirs 180 (21.44 / 201.44 = 0.106434).
// Means: ours (0.087073 + 0.009234) / 2 = 0.048154, theirs (0.241065 + 0.106434) / 2 = 0.173750.
const oa = acc.other_app;
check('other app: two rows with our kcal, their kcal and the scale truth', oa.n === 2 && near(oa.rows[0].ours, 183.9, 0.005) && oa.rows[0].theirs === 250 && near(oa.rows[0].truth, 201.44, 0.005) && oa.rows[1].theirs === 180);
closeTo('other app: our MAPE 0.048154', oa.ours_mape, 0.048154, 1e-5); closeTo('other app: their MAPE 0.173750', oa.theirs_mape, 0.17375, 1e-5);
const exported = JSON.parse(JSON.stringify(cal.exportChecks(checks, { scale: { model: 'Fixture Scale', resolution_g: 1 }, exported_at: '2026-09-29T10:00:00-03:00' })));
check('export: schema, all checks and the bench survive JSON', exported.schema === 'macrofy.checks/1' && exported.checks.length === 4 && exported.bench.manifest.meals.length === 4 && exported.bench.item_level_ids.length === 3);
const rescored = evaluate(exported.bench.manifest, exported.bench.predictions, { truthNutrients });
closeTo('export: the repo scores the exported file with the engine to the same kcal MAPE', rescored.meal_kcal.mape, 0.136577, 1e-5);
const twice = cal.checksToBench([...checks, { ...b1.check, id: 'chk-again', created_at: '2026-09-08T18:00:00-03:00' }]);
check('bench: the same photo checked twice counts once (newest wins), so the manifest stays valid', twice.manifest.meals.length === 4 && twice.manifest.meals.some((m) => m.id === 'chk-again') && !twice.manifest.meals.some((m) => m.id === 'chk-e1') && validateManifest(twice.manifest).length === 0);
check('bench: a check with no usable photo hash is skipped and reported, not scored', cal.checksToBench([{ ...b1.check, photo_sha256: null }]).skipped.join() === 'chk-e1' && cal.accuracy([{ ...b1.check, photo_sha256: null }], { evaluate, truthNutrients }) === null);

// ---------------------------------------------------------------- priors labelled as assumptions
const pc = priors.calibration;
check('priors: shrinkage_k, group_min_checks and conformal_min_checks are assumptions with a rationale and a source to calibrate from',
  ['shrinkage_k', 'group_min_checks', 'conformal_min_checks'].every((k) => pc[k].assumption === true && typeof pc[k].rationale === 'string' && pc[k].rationale.length > 10 && typeof pc[k].calibrate_from === 'string' && Number.isFinite(pc[k].value) && pc[k].value > 0));
check('priors: M is large enough for a finite 80% rank (M >= 4)', pc.conformal_min_checks.value >= 4);

// ---------------------------------------------------------------- negative checks: the assertions must bite
const bites = (name, fn) => check(`negative: ${name}`, fn() === true);
bites('no shrinkage (k = 0) misses the 2^(1/2) global fixture', () => !near(cal.learn(four, { ...params, k: 0 }).global.factor, Math.SQRT2, 1e-9) && near(cal.learn(four, { ...params, k: 0 }).global.factor, 2, 1e-9));
bites('learning from shown instead of raw grams misses the raw-target fixture', () => {
  const wrong = Math.exp((1 / 5) * Math.log(200 / 120));
  return !near(wrong, 1.1486984, 1e-6) && near(cal.learn([mk([item('a', 100, 120, 200)])], params).global.factor, 1.1486984, 1e-6);
});
bites('an unpooled group factor (shrunk toward 1 instead of the global) misses the rice fixture', () => {
  const unpooled = Math.exp(cal.shrinkWeight(4, 4) * Math.LN2); // 2^(1/2) = 1.41421
  return !near(unpooled, 1.455653, 1e-5);
});
bites('the conformal rank off by one (7th of 9) misses q = ln 1.5', () => {
  const sorted = [0.04879, 0.05129, 0.09531, 0.10536, 0.22314, 0.26236, 0.35667, 0.40547, 0.51083];
  return !near(sorted[6], Math.log(1.5), 1e-4) && near(sorted[7], Math.log(1.5), 1e-4);
});
bites('a quantile of the model residuals with M = 10 (only nine checks) must not produce ranges', () => cal.learn(nine, { ...params, conformalMin: 10 }).ranges.item === null);
bites('a group below N must not get a factor (N = 4 leaves salad with 3 checks out)', () => !('salad_raw' in cal.learn(grouped, { ...params, groupMin: 4 }).groups));
bites('a perturbed expectation is reported as a mismatch', () => !near(cal.learn(four, params).global.factor, 1.5, 1e-3) && !near(acc.item_mass.mape, 0.17, 1e-6));
bites('using the other-app kcal as truth would change what is learned; it does not', () => {
  const asTruth = checks.map((c) => (c.other_app_kcal ? { ...c, truth_kind: 'total', truth_total_g: c.other_app_kcal } : c));
  return JSON.stringify(cal.learn(asTruth, params)) !== JSON.stringify(cal.learn(checks, params));
});
bites('the same photo twice without the dedupe makes the manifest invalid and the engine refuse it', () => {
  const dup = JSON.parse(JSON.stringify(bench)); dup.manifest.meals[1].photos[0].sha256 = dup.manifest.meals[0].photos[0].sha256;
  try { evaluate(dup.manifest, dup.predictions, { truthNutrients }); return false; } catch { return validateManifest(dup.manifest).length > 0; }
});
bites('a broken export (bad schema id, negative grams) is rejected by the engine', () => {
  const badP = JSON.parse(JSON.stringify(bench.predictions)); badP.meals[0].items[0].grams = -1;
  let threw = false; try { evaluate(bench.manifest, badP, { truthNutrients }); } catch { threw = true; }
  return threw && validatePredictions({ ...bench.predictions, schema: 'macrofy.predictions/2' }).length > 0;
});
bites('a manifest whose meal has no items (a check with nothing weighed) fails validation', () => {
  const empty = JSON.parse(JSON.stringify(bench.manifest)); empty.meals[0].items = [];
  return validateManifest(empty).length > 0;
});
bites('a wrong conformal coverage (90%) gives a different quantile than the 80% fixture', () => cal.conformalQuantile(truths.map((t) => Math.abs(Math.log(t / 100))), 0.9) === null || !near(cal.conformalQuantile(truths.map((t) => Math.abs(Math.log(t / 100))), 0.9), Math.log(1.5), 1e-9));

console.log(failures ? `calibration-selftest: ${failures} FAILED` : 'calibration-selftest: all checks passed');
process.exit(failures ? 1 : 0);
