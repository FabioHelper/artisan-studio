// Selftest of the evaluation engine (check eval-selftest). Every metric is compared with a value computed by hand;
// the arithmetic is in the comments next to the fixture. Also proves: the bootstrap is seeded and resamples whole
// capture days, split filtering works, and the assertions themselves bite (each expected value is perturbed and
// must then be reported as a mismatch). Exit 0 when every check passes, 1 otherwise.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCHEMA_ID, testSetHash, testMeals } from '../bench/schema.mjs';
import { evaluate, bootstrapCI, matchItems, percentile, sd, mean, median, sum, absMean, dayOf, PREDICTIONS_SCHEMA_ID } from './metrics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOL = 1e-9;
let failures = 0;
const ok = (name) => console.log(`PASS ${name}`);
const bad = (name, detail = '') => { failures++; console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`); };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));
const close = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= TOL;
const throws = (name, fn, re) => {
  try { fn(); bad(name, 'did not throw'); } catch (e) { if (re.test(e.message)) ok(name); else bad(name, `wrong error: ${e.message}`); }
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- fixture
const sha = (s) => createHash('sha256').update(s).digest('hex');
const meal = (id, captured_at, split, items) => ({
  id, captured_at, split, plate_id: 'p1',
  photos: [{ sha256: sha(`photo:${id}`), phash: sha(`phash:${id}`).slice(0, 16), angle_deg: 90, lighting: 'daylight' }],
  items: items.map(([label, grams], i) => ({ id: `i${i + 1}`, label, grams, state: 'cooked', method: 'boiled' })),
});
const manifestOf = (meals) => ({ schema: SCHEMA_ID, scale: { model: 'Fixture Scale', resolution_g: 1 }, plates: [{ id: 'p1', diameter_mm: 260, kind: 'plate' }], meals });
const predsOf = (meals) => ({ schema: PREDICTIONS_SCHEMA_ID, pipeline: { name: 'fixture', version: '0' }, meals });

// Days as written in captured_at: t3 is 22:30 at -03:00 (01:30Z the next day). Cut by UTC date it would share a day with
// t4; by the written date it does not, so there are 4 test days, not 3.
const manifest = manifestOf([
  meal('c1', '2026-09-01T12:30:00-03:00', 'calibration', [['arroz', 100]]),
  meal('t1', '2026-09-08T12:10:00-03:00', 'test', [['arroz', 200], ['feijao', 100], ['sal', 5]]),
  meal('t2', '2026-09-09T12:40:00-03:00', 'test', [['ovo', 50], ['ovo', 100], ['farofa', 30]]),
  meal('t3', '2026-09-10T22:30:00-03:00', 'test', [['frango', 150]]),
  meal('t4', '2026-09-11T09:00:00-03:00', 'test', [['banana', 100]]),
]);

// Ground-truth nutrients per gram: [kcal, protein, carbs, fat]
const DENSITY = { arroz: [1.5, 0.03, 0.3, 0], feijao: [1, 0.06, 0.15, 0], sal: [0, 0, 0, 0], ovo: [2, 0.12, 0.01, 0.1], farofa: [4, 0.02, 0.6, 0.15], frango: [2, 0.25, 0, 0.1], banana: [1, 0.01, 0.2, 0] };
const truthNutrients = (it) => { const d = DENSITY[it.label]; return { kcal: d[0] * it.grams, protein_g: d[1] * it.grams, carbs_g: d[2] * it.grams, fat_g: d[3] * it.grams }; };
const P = (label, grams, lo80, hi80, kcal, protein_g, carbs_g, fat_g) => ({ label, grams, lo80, hi80, kcal, protein_g, carbs_g, fat_g });
const predictions = predsOf([
  { meal_id: 't1', items: [P('arroz', 220, 190, 240, 330, 7, 70, 0), P('feijao', 70, 60, 90, 60, 4, 10, 0), P('sal', 8, 6, 10, 0, 0, 0, 0)] },
  // pred order (90, 55) is the reverse of truth order (50, 100): a naive in-order pairing would match 50<->90
  { meal_id: 't2', items: [P('ovo', 90, 80, 100, 180, 11, 2, 9), P('ovo', 55, 45, 65, 110, 6, 1, 5)] },
  { meal_id: 't3', items: [P('frango', 150, 150, 150, 330, 35, 0, 14), P('batata', 60, 40, 80, 60, 1, 12, 0)] },
  // t4 has no entry at all: all omitted
  { meal_id: 'c1', items: [P('arroz', 1000, 900, 1100, 1500, 30, 300, 0)] }, // wild on purpose: must not leak into the test split
  { meal_id: 'ghost', items: [] }, // not in the manifest
]);

const test = evaluate(manifest, predictions, { truthNutrients });

// ---------------------------------------------------------------- hand-computed expectations
// Matching (test split, 8 true items, 7 predicted):
//   t1: arroz 200<->220, feijao 100<->70, sal 5<->8.   t2: ovo candidates (50,90)=40 (50,55)=5 (100,90)=10 (100,55)=45;
//   greedy takes 5 then 10, so 50<->55 and 100<->90; farofa 30 is an omission (pred 0 g).
//   t3: frango 150<->150; batata 60 is an intrusion.   t4: banana 100 is an omission.
//   => exact 6, omission 2 (farofa, banana), intrusion 1 (60 g), pred_items 6+1 = 7.
// Item mass (sal 5 g < 10 g is excluded from APE, n = 7 scored):
//   APE:    arroz 20/200=.1, feijao 30/100=.3, ovo50 5/50=.1, ovo100 10/100=.1, farofa 30/30=1, frango 0, banana 100/100=1
//   sum APE = .1+.3+.1+.1+1+0+1 = 2.6  -> MAPE 2.6/7;  sorted 0,.1,.1,.1,.3,1,1 -> median .1 (4th of 7)
//   signed: +.1 -.3 +.1 -.1 -1 +0 -1 = -2.2 -> bias -2.2/7
//   within 10%: {0,.1,.1,.1} = 4/7; within 20%: 4/7; within 30%: adds .3 -> 5/7
//   MAE g over all 8 truth items: |err| 20+30+3+5+10+30+0+100 = 198 -> 198/8 = 24.75
//   (pooled PMAE would be sum|err| of the 7 scored / sum true = 195/730 = .2671, not .3714: the fixture tells them apart)
// Meal kcal (truth = sum of items): t1 300+100+0=400, t2 50*2+100*2+30*4=420, t3 150*2=300, t4 100*1=100
//   pred: t1 330+60+0=390 (diff -10), t2 180+110=290 (-130), t3 330+60=390 (+90), t4 none=0 (-100)
//   APE: 10/400=.025, 130/420=13/42, 90/300=.3, 100/100=1
//   MAPE = (.025+13/42+.3+1)/4;  median = (.3+13/42)/2 (the two middle of .025,.3,13/42,1)
//   bias = (-.025-13/42+.3-1)/4;  within 10%: {.025} = 1/4; 20%: 1/4; 30%: {.025,.3} = 2/4
//   MAE = (10+130+90+100)/4 = 82.5
// Bland-Altman on diffs -10,-130,90,-100: mean = -150/4 = -37.5; deviations 27.5,-92.5,127.5,-62.5;
//   squares 756.25+8556.25+16256.25+3906.25 = 29475; sample variance 29475/3 = 9825; SD = sqrt(9825);
//   limits = -37.5 -/+ 1.96*sqrt(9825)
// Macros per meal (true vs pred): protein t1 12 vs 11, t2 18.6 vs 17, t3 37.5 vs 36, t4 1 vs 0 -> (1+1.6+1.5+1)/4 = 1.275
//   carbs t1 75 vs 80, t2 19.5 vs 3, t3 0 vs 12, t4 20 vs 0 -> (5+16.5+12+20)/4 = 13.375
//   fat   t1 0 vs 0, t2 19.5 vs 14, t3 15 vs 14, t4 0 vs 0 -> (0+5.5+1+0)/4 = 1.625
// 80% intervals (matched items only): arroz 200 in [190,240] yes; feijao 100 in [60,90] no; sal 5 in [6,10] no;
//   ovo 100 in [80,100] yes (bound is inclusive); ovo 50 in [45,65] yes; frango 150 in [150,150] yes -> 4/6
//   widths 50+30+4+20+20+0 = 124 -> 124/6
const SD_BA = Math.sqrt(9825);
const EXPECT = [
  ['counts.meals', 4], ['counts.days', 4], ['counts.meals_without_prediction', 1], ['counts.predictions_outside_split', 1], ['counts.predictions_unknown_meal', 1],
  ['recognition.truth_items', 8], ['recognition.pred_items', 7], ['recognition.exact', 6], ['recognition.omission', 2], ['recognition.intrusion', 1], ['recognition.intrusion_g', 60],
  ['item_mass.n', 7], ['item_mass.n_truth_items', 8], ['item_mass.n_small_excluded', 1], ['item_mass.days', 4],
  ['item_mass.mape', 2.6 / 7], ['item_mass.median_ape', 0.1], ['item_mass.bias', -2.2 / 7], ['item_mass.abs_bias', 2.2 / 7],
  ['item_mass.within_10', 4 / 7], ['item_mass.within_20', 4 / 7], ['item_mass.within_30', 5 / 7], ['item_mass.mae_g', 24.75],
  ['meal_kcal.n', 4], ['meal_kcal.mape', (0.025 + 13 / 42 + 0.3 + 1) / 4], ['meal_kcal.median_ape', (0.3 + 13 / 42) / 2],
  ['meal_kcal.bias', (-0.025 - 13 / 42 + 0.3 - 1) / 4], ['meal_kcal.abs_bias', Math.abs((-0.025 - 13 / 42 + 0.3 - 1) / 4)],
  ['meal_kcal.within_10', 1 / 4], ['meal_kcal.within_20', 1 / 4], ['meal_kcal.within_30', 2 / 4], ['meal_kcal.mae_kcal', 82.5],
  ['bland_altman.n', 4], ['bland_altman.mean_diff', -37.5], ['bland_altman.sd', SD_BA], ['bland_altman.lower', -37.5 - 1.96 * SD_BA], ['bland_altman.upper', -37.5 + 1.96 * SD_BA],
  ['macros.protein_g.mae_g', 1.275], ['macros.carbs_g.mae_g', 13.375], ['macros.fat_g.mae_g', 1.625],
  ['interval80.n', 6], ['interval80.coverage', 4 / 6], ['interval80.mean_width_g', 124 / 6],
  ['per_meal.0.kcal_true', 400], ['per_meal.0.kcal_pred', 390], ['per_meal.1.kcal_ape', 13 / 42], ['per_meal.3.kcal_pred', 0], ['per_meal.3.kcal_ape', 1],
  ['gates.interval80_coverage', 4 / 6],
];
const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setAt = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const mismatches = (report) => EXPECT.filter(([p, e]) => !close(get(report, p), e)).map(([p]) => p);

const wrong = mismatches(test);
if (wrong.length) for (const p of wrong) bad(`metric ${p}`, `got ${get(test, p)}, hand-computed ${EXPECT.find(e => e[0] === p)[1]}`);
else ok(`all ${EXPECT.length} hand-computed metrics match (tolerance ${TOL})`);
check('gate inputs equal the CI upper bounds of the blocks they name',
  test.gates.meal_kcal_mape_upper95 === test.meal_kcal.ci95.mape.hi && test.gates.item_mass_mape_upper95 === test.item_mass.ci95.mape.hi
  && test.gates.meal_kcal_abs_bias_upper95 === test.meal_kcal.ci95.abs_bias.hi && test.gates.item_mass_abs_bias_upper95 === test.item_mass.ci95.abs_bias.hi);
const finiteEverywhere = (x) => (typeof x === 'number' ? Number.isFinite(x) : x && typeof x === 'object' ? Object.values(x).every(finiteEverywhere) : true);
check('report holds no NaN or Infinity (JSON-safe)', finiteEverywhere(test));
check('per-sample MAPE is not pooled error', Math.abs(test.item_mass.mape - 195 / 730) > 0.05);
check('pipeline name and version are carried into the report', test.pipeline.name === 'fixture' && test.pipeline.version === '0' && test.split === 'test');

// ---------------------------------------------------------------- the assertions bite
check('comparator rejects a deliberately wrong expected value', !close(test.item_mass.mape, 0.4) && !close(test.item_mass.mape, 195 / 730) && !close(1, 1 + 2e-9) && close(1, 1 + 5e-10));
let unbitten = 0;
for (const [p, e] of wrong.length ? [] : EXPECT) { // (skipped when a metric is already wrong: the mismatches above say so)
  const r = clone(test); setAt(r, p, e + 1e-6);
  const m = mismatches(r);
  if (m.length !== 1 || m[0] !== p) { unbitten++; bad(`assertion bites on ${p}`, `perturbing it by 1e-6 gave mismatches [${m}]`); }
}
if (!unbitten && !wrong.length) ok(`all ${EXPECT.length} assertions detect a 1e-6 perturbation of their own metric (and only that one)`);

// ---------------------------------------------------------------- matching
check('repeated label pairs greedily by closest grams', sameJson(matchItems([{ label: 'ovo', grams: 50 }, { label: 'ovo', grams: 100 }], [{ label: 'ovo', grams: 90 }, { label: 'ovo', grams: 55 }]), { pairs: [[0, 1], [1, 0]], omissions: [], intrusions: [] }));
check('equal distances break ties by lower prediction index', sameJson(matchItems([{ label: 'a', grams: 100 }], [{ label: 'a', grams: 90 }, { label: 'a', grams: 110 }]), { pairs: [[0, 0]], omissions: [], intrusions: [1] }));
check('different labels never match', sameJson(matchItems([{ label: 'a', grams: 1 }], [{ label: 'b', grams: 1 }]), { pairs: [], omissions: [0], intrusions: [0] }));

// ---------------------------------------------------------------- bootstrap
const days12 = Array.from({ length: 12 }, (_, i) => `d${String(i).padStart(2, '0')}`);
const v12 = days12.map((_, i) => (i * i) % 7 + i / 10);
const b1 = bootstrapCI(v12, days12, { seed: 7 });
check('bootstrap is deterministic under a seed', sameJson(b1, bootstrapCI(v12, days12, { seed: 7 })) && sameJson(evaluate(manifest, predictions, { truthNutrients }), test));
check('a different seed gives a different interval', bootstrapCI(v12, days12, { seed: 8 }).lo !== b1.lo || bootstrapCI(v12, days12, { seed: 8 }).hi !== b1.hi);
check('row order does not change the interval', sameJson(bootstrapCI([...v12].reverse(), [...days12].reverse(), { seed: 7 }), b1));
check('point estimate is the statistic of the original data and lies inside the interval', close(b1.estimate, mean(v12)) && b1.lo <= b1.estimate && b1.estimate <= b1.hi && b1.clusters === 12 && b1.resamples === 2000);
check('constant data gives a zero-width interval', (() => { const r = bootstrapCI([3, 3, 3, 3], ['a', 'a', 'b', 'c']); return r.lo === 3 && r.hi === 3 && r.estimate === 3; })());
check('empty input gives an empty result', (() => { const r = bootstrapCI([], []); return r.n === 0 && r.clusters === 0 && r.estimate === null && r.lo === null && r.hi === null; })());

// Resampling is by whole days: day A has one value (1), day B three values (100 each). Two days are drawn per resample,
// so the sum can only be AA = 2, AB = 1+300 = 301, BB = 600. Drawing single meals would give 4 values such as 103 or 201.
const seen = new Set();
bootstrapCI([1, 100, 100, 100], ['A', 'B', 'B', 'B'], { stat: (v) => { const s = sum(v); seen.add(s); return s; } });
check('each resample is a whole-day combination', sameJson([...seen].sort((a, b) => a - b), [2, 301, 600]), `saw ${[...seen].sort((a, b) => a - b)}`);

// Extreme days: 10 meals at 0 on day A, 10 meals at 10 on day B. Two days drawn: means 0 (AA, 1/4), 5 (1/2), 10 (BB, 1/4),
// so by day the 2.5th and 97.5th percentiles are exactly 0 and 10. Per-meal resampling averages 20 independent draws and
// stays near 5 (Binomial(20, .5)/2: 2.5th percentile 3, 97.5th 7).
const extreme = [...Array(10).fill(0), ...Array(10).fill(10)];
const byDay = bootstrapCI(extreme, [...Array(10).fill('A'), ...Array(10).fill('B')], { seed: 1 });
const byMeal = bootstrapCI(extreme, extreme.map((_, i) => `m${i}`), { seed: 1 });
check('by-day interval on two extreme days is exactly [0, 10] around 5', byDay.lo === 0 && byDay.hi === 10 && byDay.estimate === 5, JSON.stringify(byDay));
check('day resampling widens the CI versus per-meal resampling', byDay.hi - byDay.lo > 2 * (byMeal.hi - byMeal.lo) && byMeal.lo > 0 && byMeal.hi < 10, `by day ${byDay.hi - byDay.lo}, by meal ${byMeal.hi - byMeal.lo}`);

// evaluate() clusters by the capture day: its meal-kcal CI equals a direct bootstrap keyed by the written dates
const kcalApes = [0.025, 13 / 42, 0.3, 1]; const writtenDays = testMeals(manifest).map(dayOf);
const direct = bootstrapCI(kcalApes, writtenDays, { stat: mean });
check('evaluate() bootstraps meal kcal by the capture day as written', sameJson(writtenDays, ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'])
  && close(test.meal_kcal.ci95.mape.lo, direct.lo) && close(test.meal_kcal.ci95.mape.hi, direct.hi));
check('CI brackets the estimate and stays inside the value range', test.meal_kcal.ci95.mape.lo > 0.025 && test.meal_kcal.ci95.mape.lo <= test.meal_kcal.mape && test.meal_kcal.mape <= test.meal_kcal.ci95.mape.hi && test.meal_kcal.ci95.mape.hi < 1);
check('|bias| upper bound is bootstrapped from |bias| itself', (() => { const r = bootstrapCI([-0.025, -13 / 42, 0.3, -1], writtenDays, { stat: absMean }); return close(test.meal_kcal.ci95.abs_bias.hi, r.hi) && close(test.meal_kcal.ci95.abs_bias.lo, r.lo); })());

// helpers with a known closed form
check('percentile interpolates linearly', close(percentile(Array.from({ length: 101 }, (_, i) => i), 0.025), 2.5) && close(percentile([1, 2, 3, 4], 0.5), 2.5) && close(percentile([5], 0.975), 5));
check('sample SD, mean and median of a textbook set', close(sd([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7)) && close(mean([2, 4, 4, 4, 5, 5, 7, 9]), 5) && close(median([3, 1, 2]), 2) && close(median([4, 1, 3, 2]), 2.5));
throws('bootstrap rejects mismatched cluster keys', () => bootstrapCI([1, 2], ['a']), /clusterKeys/);
throws('bootstrap rejects zero resamples', () => bootstrapCI([1], ['a'], { resamples: 0 }), /resamples/);
throws('bootstrap rejects a non-function statistic', () => bootstrapCI([1], ['a'], { stat: 'mean' }), /stat/);

// ---------------------------------------------------------------- split filtering
const cal = evaluate(manifest, predictions, { split: 'calibration', truthNutrients });
// calibration: only c1, arroz 100 true vs 1000 pred -> APE 9; kcal true 150 vs pred 1500 -> APE 9. t1-t3 predictions fall outside the split (3); ghost unknown (1).
check('split calibration scores only calibration meals', cal.counts.meals === 1 && cal.counts.days === 1 && close(cal.item_mass.mape, 9) && close(cal.meal_kcal.mape, 9) && cal.recognition.exact === 1 && cal.recognition.truth_items === 1 && cal.counts.predictions_outside_split === 3 && cal.counts.predictions_unknown_meal === 1, JSON.stringify(cal.counts));
check('one meal gives no SD and no Bland-Altman limits', cal.bland_altman.n === 1 && cal.bland_altman.sd === null && cal.bland_altman.lower === null && close(cal.bland_altman.mean_diff, 1350));
check('default split is test', sameJson(evaluate(manifest, predictions, { truthNutrients }), evaluate(manifest, predictions, { split: 'test', truthNutrients })));
throws('unknown split is refused', () => evaluate(manifest, predictions, { split: 'validation' }), /split/);
throws('a split with no meals is refused', () => evaluate(manifestOf([manifest.meals[1]]), predictions, { split: 'calibration' }), /no meals/);

// ---------------------------------------------------------------- edge cases
// 9.99 g is small (scored in grams only), 10 g is scored; labels compare after trim, case and space folding.
//   pairs: sal 9.99<->20 (|err| 10.01), 'Feijao   Preto' 10<->15 (|err| 5, APE .5)  => MAE (10.01+5)/2 = 7.505, MAPE .5, n 1
const edge = evaluate(manifestOf([meal('e1', '2026-09-20T12:00:00-03:00', 'test', [['sal', 9.99], ['Feijao   Preto', 10]])]),
  predsOf([{ meal_id: 'e1', items: [{ label: 'sal', grams: 20 }, { label: ' feijao preto ', grams: 15 }] }]));
check('under 10 g is grams-only, 10 g is scored, labels are normalised', edge.item_mass.n === 1 && edge.item_mass.n_small_excluded === 1 && close(edge.item_mass.mape, 0.5) && close(edge.item_mass.mae_g, 7.505) && edge.recognition.exact === 2
  && edge.item_mass.ci95.mape.lo === 0.5 && edge.item_mass.ci95.mape.hi === 0.5);
check('kcal and macro metrics are null (not zero) without truth nutrients', edge.meal_kcal.n === 0 && edge.meal_kcal.mape === null && edge.gates.meal_kcal_mape_upper95 === null && edge.macros.protein_g.mae_g === null && edge.meal_kcal.excluded.no_truth === 1);
check('no intervals given: coverage is null', edge.interval80.n === 0 && edge.interval80.coverage === null && edge.gates.interval80_coverage === null);

const missingProtein = clone(predictions); delete missingProtein.meals[0].items[0].protein_g;
const mp = evaluate(manifest, missingProtein, { truthNutrients });
// t1 loses protein -> 3 meals: (1.6+1.5+1)/3; kcal still scores all 4
check('a meal missing a predicted nutrient is excluded from that nutrient only', mp.macros.protein_g.n === 3 && close(mp.macros.protein_g.mae_g, 4.1 / 3) && mp.macros.protein_g.excluded.incomplete_prediction === 1 && mp.meal_kcal.n === 4 && close(mp.macros.carbs_g.mae_g, 13.375));

const none = evaluate(manifest, predsOf([]), { truthNutrients });
// everything omitted: every item APE 1 (7 scored), every meal kcal APE 1; nothing to cover
check('an empty predictions file scores every item as an omission', none.recognition.omission === 8 && none.recognition.exact === 0 && close(none.item_mass.mape, 1) && close(none.item_mass.bias, -1) && close(none.meal_kcal.mape, 1) && none.counts.meals_without_prediction === 4 && none.interval80.coverage === null);

// ---------------------------------------------------------------- frozen test set
const lock = { sha256: testSetHash(manifest), meals: testMeals(manifest).length, locked_at: '2026-01-01T00:00:00.000Z' };
check('a matching lock is accepted', evaluate(manifest, predictions, { lock, truthNutrients }).counts.meals === 4);
const edited = clone(manifest); edited.meals[1].items[0].grams += 10;
throws('a test set edited after the lock is refused', () => evaluate(edited, predictions, { lock }), /frozen-test-set/);

// ---------------------------------------------------------------- invalid input is refused
const brokenPred = (fn) => { const p = clone(predictions); fn(p); return p; };
throws('wrong predictions schema', () => evaluate(manifest, brokenPred(p => { p.schema = 'x'; })), /predictions are invalid.*schema/);
throws('missing pipeline version', () => evaluate(manifest, brokenPred(p => { delete p.pipeline.version; })), /pipeline/);
throws('negative grams', () => evaluate(manifest, brokenPred(p => { p.meals[0].items[0].grams = -1; })), /grams/);
throws('lo80 above hi80', () => evaluate(manifest, brokenPred(p => { p.meals[0].items[0].lo80 = 300; })), /lo80/);
throws('lo80 without hi80', () => evaluate(manifest, brokenPred(p => { delete p.meals[0].items[0].hi80; })), /both lo80 and hi80/);
throws('duplicate predicted meal id', () => evaluate(manifest, brokenPred(p => { p.meals[1].meal_id = 't1'; })), /more than once/);
throws('non-numeric kcal', () => evaluate(manifest, brokenPred(p => { p.meals[0].items[0].kcal = '330'; })), /kcal/);
throws('invalid manifest (duplicate meal id)', () => { const m = clone(manifest); m.meals[2].id = 't1'; evaluate(m, predictions); }, /manifest is invalid.*unique-ids/);

// ---------------------------------------------------------------- CLI end to end
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-selftest-'));
try {
  const w = (name, data) => { const p = path.join(tmp, name); fs.writeFileSync(p, JSON.stringify(data)); return p; };
  const mPath = w('manifest.json', manifest); const pPath = w('predictions.json', predictions); const lPath = w('lock.json', lock);
  const out = path.join(tmp, 'sub', 'report.json');
  const run = (...args) => spawnSync(process.execPath, [path.join(HERE, 'run.mjs'), ...args], { encoding: 'utf8' });
  const r = run('--manifest', mPath, '--predictions', pPath, '--out', out, '--lock', lPath);
  const lines = r.stdout.trim().split('\n');
  check('CLI prints a compact summary and writes the full report', r.status === 0 && lines.length <= 15 && /Item mass/.test(r.stdout) && fs.existsSync(out) && sameJson(JSON.parse(fs.readFileSync(out, 'utf8')), JSON.parse(JSON.stringify(evaluate(manifest, predictions, { lock })))), `${r.status} ${r.stderr}`);
  check('CLI summary shows the item-mass MAPE', /Item mass:\s+MAPE 37\.1%/.test(r.stdout), lines[2]);
  const rc = run('--manifest', mPath, '--predictions', pPath, '--split', 'calibration');
  check('CLI honours --split', rc.status === 0 && /split calibration: 1 meals/.test(rc.stdout) && /MAPE 900\.0%/.test(rc.stdout), rc.stderr);
  const badP = w('bad.json', { schema: 'nope' });
  const rb = run('--manifest', mPath, '--predictions', badP);
  check('CLI exits 1 with a message on invalid predictions', rb.status === 1 && /FAIL predictions are invalid/.test(rb.stderr));
  check('CLI exits 1 on a missing file', run('--manifest', path.join(tmp, 'none.json'), '--predictions', pPath).status === 1);
  const tampered = w('tampered.json', edited);
  check('CLI exits 1 when the test set differs from the lock', run('--manifest', tampered, '--predictions', pPath, '--lock', lPath).status === 1);
  check('CLI exits 2 on missing arguments', run('--manifest', mPath).status === 2);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(failures ? `\n${failures} selftest failure(s)` : '\nselftest OK - every metric matches its hand-computed value; bootstrap is seeded and by day; the assertions bite');
process.exit(failures ? 1 : 0);
