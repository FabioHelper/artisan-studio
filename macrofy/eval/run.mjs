#!/usr/bin/env node
// Evaluate a predictions file against a bench manifest: prints a compact summary, optionally writes the full JSON report.
// Usage: node eval/run.mjs --manifest <path> --predictions <path> [--split test|calibration] [--out <path>] [--lock <path>]
// --lock verifies the frozen test set (bench/lock.mjs writes it). Kcal and macro metrics need ground-truth
// nutrients, which a pipeline-independent nutrition module supplies through the truthNutrients callback of
// evaluate() (T-005); until it is wired the CLI reports them as n/a.
// Exit codes: 0 ok, 1 invalid input, 2 usage.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { evaluate } from './metrics.mjs';

const USAGE = 'usage: node eval/run.mjs --manifest <path> --predictions <path> [--split test|calibration] [--out <path>] [--lock <path>]';
let opts;
try {
  opts = parseArgs({ options: { manifest: { type: 'string' }, predictions: { type: 'string' }, split: { type: 'string', default: 'test' }, out: { type: 'string' }, lock: { type: 'string' } }, strict: true }).values;
} catch (e) { console.error(`${e.message}\n${USAGE}`); process.exit(2); }
if (!opts.manifest || !opts.predictions) { console.error(USAGE); process.exit(2); }

const die = (msg) => { console.error(`FAIL ${msg}`); process.exit(1); };
const readJson = (p, what) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return die(`cannot read ${what} ${p}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`); }
};

let r;
try {
  r = evaluate(readJson(opts.manifest, 'manifest'), readJson(opts.predictions, 'predictions'), { split: opts.split, lock: opts.lock ? readJson(opts.lock, 'lock') : null });
} catch (e) { die(e.message); }

const pct = (x, d = 1) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(d)}%`);
const num = (x, d = 1) => (x === null || x === undefined ? 'n/a' : x.toFixed(d));
const ci = (c) => (c ? ` [95% CI ${pct(c.lo)} to ${pct(c.hi)}]` : '');
const ape = (label, b, mae, unit) =>
  `${label} MAPE ${pct(b.mape)}${ci(b.ci95?.mape)}, median ${pct(b.median_ape)}, bias ${pct(b.bias)}${ci(b.ci95?.bias)}, within 10/20/30%: ${pct(b.within_10, 0)}/${pct(b.within_20, 0)}/${pct(b.within_30, 0)}, MAE ${num(mae)} ${unit}, n=${b.n}`;
const { counts: c, recognition: rec, item_mass: im, meal_kcal: mk, bland_altman: ba, macros: mc, interval80: iv, gates: g } = r;

const lines = [
  `Evaluation ${r.pipeline.name} ${r.pipeline.version} | split ${r.split}: ${c.meals} meals on ${c.days} days | seed ${r.seed}, ${r.resamples} day-resamples`,
  `Recognition: ${rec.exact} exact, ${rec.omission} omissions, ${rec.intrusion} intrusions (${rec.truth_items} true items, ${rec.pred_items} predicted)`,
  `${ape('Item mass:', im, im.mae_g, 'g')} (+${im.n_small_excluded} items under 10 g scored in grams only)`,
  ape('Meal kcal: ', mk, mk.mae_kcal, 'kcal'),
  `Bland-Altman (kcal): mean diff ${num(ba.mean_diff)}, SD ${num(ba.sd)}, limits ${num(ba.lower)} to ${num(ba.upper)}, n=${ba.n}`,
  `Macro MAE per meal (g): protein ${num(mc.protein_g.mae_g, 2)}, carbs ${num(mc.carbs_g.mae_g, 2)}, fat ${num(mc.fat_g.mae_g, 2)}`,
  `80% intervals: coverage ${pct(iv.coverage)}${ci(iv.ci95)}, mean width ${num(iv.mean_width_g)} g, n=${iv.n}`,
  `Gate inputs (upper 95%): meal kcal MAPE ${pct(g.meal_kcal_mape_upper95)}, item mass MAPE ${pct(g.item_mass_mape_upper95)}, |bias| kcal ${pct(g.meal_kcal_abs_bias_upper95)}, |bias| mass ${pct(g.item_mass_abs_bias_upper95)}`,
  `Unscored: ${c.meals_without_prediction} meals without predictions, ${c.predictions_outside_split} predictions outside the split, ${c.predictions_unknown_meal} for unknown meals`,
];
if (opts.out) {
  fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  fs.writeFileSync(opts.out, `${JSON.stringify(r, null, 2)}\n`);
  lines.push(`Full report: ${opts.out}`);
}
console.log(lines.join('\n'));
