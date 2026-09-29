// Check `estimator-selftest`: node web/estimate/selftest.mjs (run from macrofy/, Node built-ins only).
// Every number is compared with one computed by hand; the arithmetic is in the comments next to each fixture.
// The last section proves the assertions bite: perturbed expectations and broken inputs must be reported as failures.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './core.mjs';
import * as calib from './calibration.mjs';
import { plateSetup, priorsForPlate } from './autoseg.mjs';
import { createLookup } from '../../nutrition/lookup-core.mjs';
import { truthNutrients, VOCAB } from '../../nutrition/lookup.mjs';
import { SCHEMA_ID } from '../../bench/schema.mjs';
import { validatePredictions, evaluate, PREDICTIONS_SCHEMA_ID } from '../../eval/metrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const priors = JSON.parse(fs.readFileSync(join(HERE, 'priors.json'), 'utf8'));
const calibrationFile = JSON.parse(fs.readFileSync(join(HERE, 'calibration.json'), 'utf8'));
const lookup = createLookup(VOCAB);
const cls = (id) => VOCAB.classes.find((c) => c.id === id);

let failures = 0;
const ok = (name) => console.log(`PASS ${name}`);
const bad = (name, detail = '') => { failures++; console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`); };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
const closeTo = (name, actual, expected, tol) => check(name, near(actual, expected, tol), `got ${actual}, expected ${expected} +- ${tol}`);
const throws = (name, fn, re) => { try { fn(); bad(name, 'did not throw'); } catch (e) { check(name, re.test(e.message), `wrong error: ${e.message}`); } };

// ---------------------------------------------------------------- ellipse fit from a mask
// Synthetic plate: centre (600, 450), semi-axes a = 300, b = 200, major axis rotated 30 degrees, in a 1200 x 900 mask.
function ellipseMask(w, h, cx, cy, a, b, angle) {
  const data = new Uint8Array(w * h); const c = Math.cos(angle); const s = Math.sin(angle);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x - cx) * c + (y - cy) * s; const v = -(x - cx) * s + (y - cy) * c;
    if ((u / a) ** 2 + (v / b) ** 2 <= 1) data[y * w + x] = 1;
  }
  return { width: w, height: h, data };
}
const ANGLE = Math.PI / 6;
const plateMask = ellipseMask(1200, 900, 600, 450, 300, 200, ANGLE);
const fit = core.fitEllipse(plateMask);
closeTo('ellipse fit: major semi-axis a = 300 within 1%', fit.a, 300, 3);
closeTo('ellipse fit: minor semi-axis b = 200 within 1%', fit.b, 200, 2);
closeTo('ellipse fit: centre x', fit.cx, 600, 1); closeTo('ellipse fit: centre y', fit.cy, 450, 1);
closeTo('ellipse fit: major axis angle 30 degrees within 1 degree', fit.angle_rad, ANGLE, 0.0175);
// A circle: a = b, so cos_tilt = 1 (top-down photo).
const circ = core.fitEllipse(ellipseMask(600, 600, 300, 300, 250, 250, 0));
closeTo('ellipse fit: circle has b/a = 1 within 1%', circ.b / circ.a, 1, 0.01);
throws('ellipse fit: an empty mask is an error', () => core.fitEllipse({ width: 4, height: 4, data: new Uint8Array(16) }), /vazia/);
// Plate 260 mm: mm_per_px = 260 / (2 * 300) = 0.43333; cos_tilt = 200 / 300 = 0.66667 (both within 1% of the true axes).
const fromMask = core.scaleFromPlateMask(plateMask, 260);
closeTo('scale from mask: mm_per_px = 260 / 600 within 1%', fromMask.mm_per_px, 260 / 600, 0.0043);
closeTo('scale from mask: cos_tilt = 2/3 within 1%', fromMask.cos_tilt, 2 / 3, 0.0067);

// ---------------------------------------------------------------- hand-computed fixtures: 3 items on a 260 mm plate
// Plate axes a = 200 px, b = 160 px  =>  mm_per_px = 260 / (2 * 200) = 0.65,  cos_tilt = 160 / 200 = 0.8.
// mm2 per pixel = 0.65^2 / 0.8 = 0.4225 / 0.8 = 0.528125.
const scale = core.scaleFromAxes(200, 160, 260);
closeTo('fixture scale: mm_per_px 0.65', scale.mm_per_px, 0.65, 1e-12);
closeTo('fixture scale: cos_tilt 0.8', scale.cos_tilt, 0.8, 1e-12);
closeTo('area: 1 px = 0.528125 mm2', core.areaMm2(1, scale), 0.528125, 1e-12);
closeTo('volume: 1000 mm2 x 20 mm = 20 mL', core.volumeMl(1000, 20), 20, 1e-12);

// Item 1, rice (arroz-branco-cozido; group rice_pasta 20 mm, cv 0.30; density 0.6678 "served"): 20000 px.
//   area = 20000 x 0.528125 = 10562.5 mm2;  volume = 10562.5 x 20 / 1000 = 211.25 mL
//   grams = 211.25 x 0.6678 = 141.07275 g (211.25 x 0.6 = 126.75, x 0.06 = 12.675, x 0.0078 = 1.64775)
//   oil "normal" = 1 x 2.84 x 1.4107275 = 4.006463 g
//   kcal = 128 x 1.4107275 + 9 x 4.006463 = 180.57312 + 36.058167 = 216.631287 -> 216.63
//   protein = 2.5 x 1.4107275 = 3.526819 -> 3.53;  carbs = 28.1 x 1.4107275 = 39.641443 -> 39.64
//   fat = 0.2 x 1.4107275 + 4.006463 = 0.282146 + 4.006463 = 4.288609 -> 4.29
const rice = core.estimateItem({ cls: cls('arroz-branco-cozido'), pixels: 20000, scale, oil: 'normal', priors, lookup });
closeTo('rice: area_mm2', rice.area_mm2, 10562.5, 0.05); closeTo('rice: volume_ml (reported to 0.1 mL)', rice.volume_ml, 211.25, 0.06);
closeTo('rice: grams (served density 0.6678)', rice.grams, 141.07275, 0.05);
check('rice: density basis is served', rice.density_basis === 'served' && rice.density_g_per_ml === 0.6678);
closeTo('rice: oil_g', rice.oil_g, 4.006463, 0.006); closeTo('rice: kcal', rice.kcal, 216.63, 0.02);
closeTo('rice: protein', rice.protein_g, 3.53, 0.02); closeTo('rice: carbs', rice.carbs_g, 39.64, 0.02); closeTo('rice: fat', rice.fat_g, 4.29, 0.02);

// Item 2, steak (bife-grelhado; group cutlet_meat 15 mm, cv 0.25, solid; vocab density 0.5706 is "pieces", so F-004
// applies the solid prior 1.05): 12000 px.
//   area = 12000 x 0.528125 = 6337.5 mm2;  volume = 6337.5 x 15 / 1000 = 95.0625 mL;  grams = 95.0625 x 1.05 = 99.815625 g
//   (with the pieces density it would be 95.0625 x 0.5706 = 54.24 g: a 46% understatement)
//   kcal = 194 x 0.99815625 = 193.64231 -> 193.64;  protein = 35.9 x 0.99815625 = 35.83381 -> 35.83;  carbs 0
//   fat = 4.5 x 0.99815625 = 4.491703 -> 4.49;  default oil is 0, so oil stays 0
const steak = core.estimateItem({ cls: cls('bife-grelhado'), pixels: 12000, scale, oil: 'normal', priors, lookup });
closeTo('steak: volume_ml', steak.volume_ml, 95.0625, 0.06);
closeTo('steak: grams use the solid density prior 1.05, not pieces 0.5706', steak.grams, 99.815625, 0.05);
check('steak: density basis is solid_prior', steak.density_basis === 'solid_prior' && steak.density_g_per_ml === 1.05);
closeTo('steak: kcal', steak.kcal, 193.64, 0.02); closeTo('steak: protein', steak.protein_g, 35.83, 0.02);
closeTo('steak: carbs', steak.carbs_g, 0, 1e-9); closeTo('steak: fat', steak.fat_g, 4.49, 0.02); closeTo('steak: oil_g', steak.oil_g, 0, 1e-9);

// Item 3, salad (salada-mista-crua; group salad_raw 25 mm, cv 0.40, loose so "pieces" density 0.3085 is kept): 15000 px.
//   area = 15000 x 0.528125 = 7921.875 mm2;  volume = 7921.875 x 25 / 1000 = 198.046875 mL
//   grams = 198.046875 x 0.3085 = 61.097461 g (198.046875 x 0.3 = 59.4140625, x 0.0085 = 1.68339844)
//   kcal = 18.6 x 0.61097461 = 11.36413 -> 11.36;  protein = 1.15 x 0.61097461 = 0.70262 -> 0.70
//   carbs = 3.92 x 0.61097461 = 2.39502 -> 2.40;  fat = 0.14 x 0.61097461 = 0.085536 -> 0.09
const salad = core.estimateItem({ cls: cls('salada-mista-crua'), pixels: 15000, scale, oil: 'normal', priors, lookup });
closeTo('salad: volume_ml', salad.volume_ml, 198.046875, 0.06);
closeTo('salad: grams (loose food keeps the pieces density)', salad.grams, 61.097461, 0.05);
check('salad: density basis is pieces', salad.density_basis === 'pieces' && salad.density_g_per_ml === 0.3085);
closeTo('salad: kcal', salad.kcal, 11.36, 0.02); closeTo('salad: protein', salad.protein_g, 0.7, 0.02);
closeTo('salad: carbs', salad.carbs_g, 2.4, 0.02); closeTo('salad: fat', salad.fat_g, 0.09, 0.02);

// Plate totals: grams and macros are sums of the rounded item values: grams 141.1 + 99.8 + 61.1 = 302.0; kcal 216.63 + 193.64 + 11.36 = 421.63.
// The total's 80% range is combined in log space (see totals() in core.mjs): independent thickness errors by the Fenton-Wilkinson match,
// the shared scale error once. Thickness sigmas: rice sqrt(ln 1.09) = 0.29356, steak sqrt(ln 1.0625) = 0.24622, salad sqrt(ln 1.16) = 0.38525.
//   m_i = g_i exp(s_i^2 / 2): rice 141.1 x 1.04403 = 147.31, steak 99.8 x 1.03078 = 102.87, salad 61.1 x 1.07703 = 65.81;  M = 315.99
//   var_i = m_i^2 (exp(s_i^2) - 1): rice 0.09 x 147.31^2 = 1953.0, steak 0.0625 x 102.87^2 = 661.4, salad 0.16 x 65.81^2 = 693.0;  V = 3307.4
//   sigma_th^2 = ln(1 + V / M^2) = ln(1 + 3307.4 / 99849) = 0.032585;  scale term (2 ln 1.05)^2 = 0.0975803^2 = 0.009522
//   sigma_total = sqrt(0.032585 + 0.009522) = 0.20520;  z sigma = 0.26298;  exp(-0.26298) = 0.76875, exp(+0.26298) = 1.30081
//   lo80 = 302.0 x 0.76875 = 232.2,  hi80 = 302.0 x 1.30081 = 392.8 (392.9 with the unrounded factor).
// Summing the item bounds would give 202.7 to 451.6: a hidden assumption that every error is fully correlated.
const items3 = [rice, steak, salad];
const tot = core.totals(items3);
closeTo('totals: grams 302.0', tot.grams, 302.0, 0.06); closeTo('totals: kcal 421.63', tot.kcal, 421.6, 0.06);
closeTo('totals: protein 40.1', tot.protein_g, 40.1, 0.06);
closeTo('totals: sigma 0.2052 (independent thickness, shared scale)', tot.sigma, 0.2052, 1e-4);
closeTo('totals: lo80 = 302.0 x 0.76875 = 232.2', tot.lo80, 232.2, 0.15); closeTo('totals: hi80 = 302.0 x 1.30081 = 392.9', tot.hi80, 392.9, 0.15);
check('totals: narrower than the sum of the item bounds (202.7 to 451.6) but wider than the shared-scale term alone',
  tot.lo80 > rice.lo80 + steak.lo80 + salad.lo80 && tot.hi80 < rice.hi80 + steak.hi80 + salad.hi80 && tot.sigma > core.scaleSigma(0.05));
const one = core.totals([rice]);
closeTo('totals: one item gives exactly that item\'s sigma', one.sigma, rice.sigma, 1e-4);
closeTo('totals: one item gives that item\'s lo80', one.lo80, rice.lo80, 0.15); closeTo('totals: one item gives that item\'s hi80', one.hi80, rice.hi80, 0.15);

// ---------------------------------------------------------------- the range formula
// Scale enters the area twice (area goes with mm_per_px^2), so its grams sigma is 2 ln(1 + s), not ln(1 + s):
// sigma = sqrt(ln(1 + cv^2) + (2 ln(1 + s))^2).  Rice: cv 0.30, s 0.05: ln(1.09) = 0.0861777, 2 ln(1.05) = 0.0975803,
// squared 0.0095220, sum 0.0956997, sigma = 0.309354.  z sigma = 1.2816 x 0.309354 = 0.396468;  exp(-0.396468) = 0.67269, exp(+0.396468) = 1.48656.
// Rice 141.07275 g: lo80 = 94.90, hi80 = 209.72.  Steak (cv 0.25): 0.0606246 + 0.009522 = 0.0701466, sigma 0.264852, factors 0.71217 / 1.40415,
// 99.8156 g -> 71.09 to 140.16.  Salad (cv 0.40): 0.148420 + 0.009522 = 0.157942, sigma 0.397420, factors 0.60089 / 1.66416, 61.0975 g -> 36.71 to 101.72.
closeTo('sigma: scale term is 2 ln(1.05) = 0.0975803', core.scaleSigma(0.05), 0.0975803, 1e-7);
closeTo('sigma: cv 0.30, s 0.05 (scale counted twice)', core.rangeSigma(0.3, 0.05), 0.309354, 1e-5);
closeTo('sigma: no scale error reduces to sqrt(ln(1 + cv^2))', core.rangeSigma(0.3, 0), Math.sqrt(Math.log(1.09)), 1e-12);
closeTo('range: rice lo80 = 141.07275 x 0.67269 = 94.90', rice.lo80, 94.9, 0.06);
closeTo('range: rice hi80 = 141.07275 x 1.48656 = 209.72', rice.hi80, 209.7, 0.06);
closeTo('range: steak 71.09 to 140.16', steak.lo80, 71.1, 0.06); closeTo('range: steak hi80', steak.hi80, 140.2, 0.06);
closeTo('range: salad 36.71 to 101.72', salad.lo80, 36.7, 0.06); closeTo('range: salad hi80', salad.hi80, 101.7, 0.06);
closeTo('range: symmetric on the log scale (lo x hi = grams^2)', core.range80(100, 0.2).lo80 * core.range80(100, 0.2).hi80, 100 * 100, 1e-9);
closeTo('range: sigma 0.2 gives lo 100 exp(-0.25632) = 0.773894 -> 77.389', core.range80(100, 0.2).lo80, 77.3894, 1e-3);
check('range: zero sigma collapses to the point estimate', core.range80(100, 0).lo80 === 100 && core.range80(100, 0).hi80 === 100);
check('range: lo80 <= grams <= hi80 for every fixture item', items3.every((i) => i.lo80 <= i.grams && i.grams <= i.hi80));

// ---------------------------------------------------------------- oil mapping
check('oil levels: Sem óleo / Pouco / Normal / Muito = 0 / 0.5 / 1 / 2', JSON.stringify(priors.oil_levels.map((o) => [o.label, o.factor])) === JSON.stringify([['Sem óleo', 0], ['Pouco', 0.5], ['Normal', 1], ['Muito', 2]]));
// Rice, 141.07275 g, default 2.84 g per 100 g: base oil 2.84 x 1.4107275 = 4.006463 g; x0 = 0, x0.5 = 2.003232, x2 = 8.012926.
const riceOil = Object.fromEntries(priors.oil_levels.map((o) => [o.id, core.estimateItem({ cls: cls('arroz-branco-cozido'), pixels: 20000, scale, oil: o.id, priors, lookup })]));
closeTo('oil: none = 0 g', riceOil.none.oil_g, 0, 1e-9); closeTo('oil: little = 2.0032 g', riceOil.little.oil_g, 2.003232, 0.006);
closeTo('oil: normal = 4.0065 g', riceOil.normal.oil_g, 4.006463, 0.006); closeTo('oil: lots = 8.0129 g', riceOil.lots.oil_g, 8.012926, 0.006);
// kcal without oil = 128 x 1.4107275 = 180.57; each gram of oil adds 9 kcal and 1 g fat.
closeTo('oil: none gives kcal 180.57', riceOil.none.kcal, 180.57, 0.02);
closeTo('oil: lots adds 8.0129 g x 9 = 72.12 kcal', riceOil.lots.kcal - riceOil.none.kcal, 72.116634, 0.03);
closeTo('oil: lots adds 8.0129 g of fat', riceOil.lots.fat_g - riceOil.none.fat_g, 8.012926, 0.02);
check('oil: the grams do not change with the oil answer', riceOil.none.grams === riceOil.lots.grams);
check('oil: an item with default 0 (steak) gets no oil at "Muito"', core.estimateItem({ cls: cls('bife-grelhado'), pixels: 12000, scale, oil: 'lots', priors, lookup }).oil_g === 0);
throws('oil: an unknown level is an error', () => core.estimateItem({ cls: cls('bife-grelhado'), pixels: 1, scale, oil: 'muitissimo', priors, lookup }), /óleo/);

// ---------------------------------------------------------------- F-004 density rule over the whole vocab
const solidGroups = Object.entries(priors.groups).filter(([, g]) => g.solid).map(([k]) => k);
const dens = VOCAB.classes.map((c) => ({ c, d: core.densityFor(c, priors), solid: solidGroups.includes(priors.class_groups[c.id]) }));
check('F-004: every served class keeps its FNDDS density', dens.filter((x) => x.c.density_source.kind === 'served').every((x) => x.d.density === x.c.density_g_per_ml && x.d.basis === 'served'));
check('F-004: every pieces class in a solid group gets the solid prior', dens.filter((x) => x.c.density_source.kind === 'pieces' && x.solid).every((x) => x.d.density === priors.solid_density_g_per_ml.value && x.d.basis === 'solid_prior'));
check('F-004: every pieces class in a loose group keeps its pieces density', dens.filter((x) => x.c.density_source.kind === 'pieces' && !x.solid).every((x) => x.d.density === x.c.density_g_per_ml && x.d.basis === 'pieces'));
check('F-004: grilled and fried meats, fish, egg and banana are solid; rice, beans, salad and fries are loose', ['bife-grelhado', 'frango-grelhado', 'frango-a-milanesa', 'peixe-frito', 'tilapia-grelhada', 'ovo-frito', 'ovo-cozido', 'banana-prata', 'file-mignon-grelhado'].every((id) => solidGroups.includes(priors.class_groups[id]))
  && ['arroz-branco-cozido', 'feijao-preto-cozido', 'alface-crua', 'salada-mista-crua', 'batata-frita', 'carne-moida-cozida'].every((id) => !solidGroups.includes(priors.class_groups[id])));

// ---------------------------------------------------------------- priors: the only invented numbers, all labelled
const entries = [['scale_uncertainty', priors.scale_uncertainty], ['solid_density_g_per_ml', priors.solid_density_g_per_ml], ...Object.entries(priors.groups)];
check('priors: every entry says assumption: true, calibrate_from "weighed meals" and has a one-line rationale',
  entries.every(([, e]) => e.assumption === true && e.calibrate_from === 'weighed meals' && typeof e.rationale === 'string' && e.rationale.length > 10 && !e.rationale.includes('\n')));
check('priors: every group has a positive thickness_mm, a cv in (0, 1] and a boolean solid flag',
  Object.values(priors.groups).every((g) => g.thickness_mm > 0 && g.cv > 0 && g.cv <= 1 && typeof g.solid === 'boolean'));
check('priors: every vocab class maps to a group that exists, and no mapping is orphaned',
  VOCAB.classes.every((c) => priors.groups[priors.class_groups[c.id]]) && Object.keys(priors.class_groups).every((id) => cls(id)));
check('priors: scale uncertainty defaults to 5%', priors.scale_uncertainty.value === 0.05);

// ---------------------------------------------------------------- calibration factor
check('calibration: the shipped calibration.json is empty, so every factor is 1.0', core.calibrationFactor(core.loadCalibration(calibrationFile), 'rice_pasta') === 1 && core.calibrationFactor(null, 'x') === 1);
const cal = core.loadCalibration({ schema: 'macrofy.calibration/1', factors: { rice_pasta: 1.1, default: 0.9 } });
check('calibration: group factor, then default, then 1', core.calibrationFactor(cal, 'rice_pasta') === 1.1 && core.calibrationFactor(cal, 'salad_raw') === 0.9);
closeTo('calibration: a factor of 1.1 scales the rice grams to 155.18', core.estimateItem({ cls: cls('arroz-branco-cozido'), pixels: 20000, scale, priors, lookup, calibration: cal }).grams, 141.07275 * 1.1, 0.06);
throws('calibration: a non-positive factor is rejected', () => core.loadCalibration({ schema: 'macrofy.calibration/1', factors: { rice_pasta: 0 } }), /fator/);
throws('calibration: a wrong schema is rejected', () => core.loadCalibration({ schema: 'x', factors: {} }), /schema/);

// ---------------------------------------------------------------- masks and naming
const m1 = { width: 4, height: 1, data: [1, 1, 1, 0] }; const m2 = { width: 4, height: 1, data: [0, 1, 1, 1] };
check('exclusive counts: the first tap keeps overlapping pixels (3 + 1, not 3 + 3)', JSON.stringify(core.exclusiveCounts([m1, m2])) === '[3,1]');
check('bbox of a mask', JSON.stringify(core.maskBBox({ width: 5, height: 4, data: [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] })) === '{"x0":1,"y0":1,"x1":2,"y1":2}' && core.maskBBox({ width: 2, height: 2, data: [0, 0, 0, 0] }) === null);
check('naming prompt is "uma foto de {pt}"', core.NAME_PROMPT('arroz branco cozido') === 'uma foto de arroz branco cozido');
const few = [cls('arroz-branco-cozido'), cls('feijao-preto-cozido'), cls('bife-grelhado'), cls('alface-crua')];
const top = core.topNames(core.namePrompts(few).map((p, i) => ({ label: p, score: [0.2, 0.9, 0.5, 0.7][i] })), few, 3);
check('top-3 names sorted by score, mapped back to classes', top.map((t) => t.cls.id).join() === 'feijao-preto-cozido,alface-crua,bife-grelhado');

// ---------------------------------------------------------------- predictions export -> eval engine
const est = { id: 'e1', created_at: '2026-09-08T12:30:00-03:00', meal_id: 't1', items: items3 };
const preds = core.toPredictions([est]);
check('predictions: schema id matches the eval engine', preds.schema === PREDICTIONS_SCHEMA_ID && core.PREDICTIONS_SCHEMA_ID === PREDICTIONS_SCHEMA_ID);
check('predictions: pipeline name and version', preds.pipeline.name === 'macrofy-estimator' && /^\d+\.\d+\.\d+/.test(preds.pipeline.version));
check('predictions: the eval validator accepts the export', validatePredictions(preds).length === 0, validatePredictions(preds).join('; '));
check('predictions: labels are the vocab pt names', preds.meals[0].items.map((i) => i.label).join('|') === 'arroz branco cozido|bife grelhado|salada mista crua (alface, tomate, cenoura)');
check('predictions: item carries grams, macros and the 80% range', Object.keys(preds.meals[0].items[0]).sort().join() === 'carbs_g,fat_g,grams,hi80,kcal,label,lo80,protein_g');
check('predictions: unlinked estimates get an est- id; the newest estimate of a meal wins', (() => {
  const p = core.toPredictions([est, { ...est, id: 'e2', created_at: '2026-09-08T13:00:00-03:00', items: [steak] }, { id: 'e3', created_at: '2026-09-09T10:00:00-03:00', meal_id: null, items: [rice] }]);
  return p.meals.length === 2 && p.meals[0].meal_id === 't1' && p.meals[0].items.length === 1 && p.meals[1].meal_id === 'est-e3' && validatePredictions(p).length === 0;
})());

const sha = (s) => createHash('sha256').update(s).digest('hex');
const sha256 = sha;
const tinyManifest = {
  schema: SCHEMA_ID, scale: { model: 'Fixture Scale', resolution_g: 1 }, plates: [{ id: 'p1', diameter_mm: 260, kind: 'plate' }],
  meals: [{
    id: 't1', captured_at: '2026-09-08T12:10:00-03:00', split: 'test', plate_id: 'p1',
    photos: [{ sha256: sha('photo:t1'), phash: sha('phash:t1').slice(0, 16), angle_deg: 90, lighting: 'daylight' }],
    items: [
      { id: 'i1', label: 'arroz branco cozido', grams: 150, state: 'cooked', method: 'boiled' },
      { id: 'i2', label: 'bife grelhado', grams: 100, state: 'cooked', method: 'grilled' },
      { id: 'i3', label: 'salada mista crua (alface, tomate, cenoura)', grams: 55, state: 'raw', method: 'raw' },
    ],
  }],
};
// Hand-computed score: APE rice |141.1 - 150| / 150 = 0.059333, steak |99.8 - 100| / 100 = 0.002, salad |61.1 - 55| / 55 = 0.110909;
// MAPE = 0.172242 / 3 = 0.057414. The ranges cover 150, 100 and 55 (94.9-209.7, 71.1-140.2, 36.7-101.7), so coverage is 1.
let report = null;
try { report = evaluate(tinyManifest, preds, { truthNutrients }); ok('eval: evaluate scores the export against a matching manifest without errors'); } catch (e) { bad('eval: evaluate scores the export', e.message); }
if (report) {
  check('eval: all 3 items matched by label (no omission, no intrusion)', report.recognition.exact === 3 && report.recognition.omission === 0 && report.recognition.intrusion === 0);
  closeTo('eval: item MAPE 0.057414', report.item_mass.mape, 0.057414, 1e-4);
  closeTo('eval: 80% interval coverage 1', report.interval80.coverage, 1, 1e-12);
  check('eval: meal kcal is scored (not skipped)', report.meal_kcal.n === 1 && near(report.per_meal[0].kcal_pred, 421.63, 0.01) && report.per_meal[0].kcal_true > 0);
}

// ---------------------------------------------------------------- T-016 zero setup: the no-plate walk, scale checks and the default path
// The browser walk is web/estimate/smoke.mjs (manual); this is its pure counterpart: photo (a plate mask) -> typical-plate scale -> estimate -> scale check
// -> learned correction -> the next estimate. No plate is registered and nothing is tapped anywhere in it.
const typicalSetup = plateSetup(priors, null);
const typicalScale = core.scaleFromPlateMask(plateMask, typicalSetup.diameter_mm); // the plate mask of the ellipse fixture, scaled by the 260 mm typical plate
const zeroState = calib.learn([], calib.paramsFrom(priors));
const walk = (calibration) => ['arroz-branco-cozido', 'bife-grelhado', 'salada-mista-crua'].map((id, i) => core.estimateItem({ cls: cls(id), pixels: [20000, 12000, 15000][i], scale: typicalScale, priors: priorsForPlate(priors, typicalSetup), lookup, calibration }));
const w0 = walk(core.loadCalibration(calib.toCalibration(zeroState)));
check('zero setup: with no plate registered the typical plate (26 cm) sets the scale and every factor is 1', typicalSetup.typical === true && typicalSetup.diameter_mm === 260 && w0.every((i) => i.grams === i.raw_grams && i.calibrated === false) && zeroState.label === 'Não calibrado');
check('zero setup: the typical plate widens every range against a measured plate (0.12 vs 0.05 scale uncertainty)', w0.every((i) => i.sigma_scale > core.scaleSigma(0.05) + 0.1));
const shownAll = calib.applyRanges(w0, core.totals(w0), zeroState);
check('zero setup: with no checks the ranges stay the model ranges', shownAll.items.every((i, k) => i.lo80 === w0[k].lo80 && i.hi80 === w0[k].hi80 && i.range_basis === 'model') && shownAll.totals.range_basis === 'model');
const stateOf = (id) => cls(id).state;
const est1 = { id: 'e1', items: w0, totals: core.totals(w0), plate_typical: true, diameter_mm: 260, oil: 'normal', pipeline: core.PIPELINE };
const built = calib.buildCheck({ estimate: est1, truth_items: [String(w0[0].grams * 1.25), '', ''], other_app_kcal: '500', photo_sha256: sha256('walk-photo'), created_at: '2026-09-29T12:00:00-03:00', state: zeroState, stateOf });
check('scale check: the owner types the rice grams (x1.25 of the estimate) and an other-app kcal; nothing else is required', !!built.check && built.check.truth_kind === 'items' && built.check.other_app_kcal === 500 && built.check.items[1].truth_g === null);
const afterOne = calib.learn([built.check], calib.paramsFrom(priors));
// truth / raw = 1.25 and k = 5: weight 1/6, factor 1.25^(1/6) = exp(0.223144 / 6) = exp(0.0371906) = 1.03789
closeTo('scale check: one weighing moves the global factor to 1.25^(1/6) = 1.03789', afterOne.global.factor, 1.03789, 1e-4);
check('scale check: the calibration state changes from "Não calibrado" to "Calibrado com 1 conferência"', zeroState.label === 'Não calibrado' && afterOne.label === 'Calibrado com 1 conferência');
const w1 = walk(core.loadCalibration(calib.toCalibration(afterOne)));
check('scale check: the next estimate shows grams x 1.03789 and is flagged calibrated', w1.every((i, k) => near(i.grams, w0[k].raw_grams * 1.03789, 0.1) && i.calibrated === true && i.raw_grams === w0[k].raw_grams));
check('scale check: the other-app kcal is never learned from (it is not in learn)', !/other_app/.test(calib.learn.toString()) && !/other_app/.test(calib.observations.toString()));
check('scale check: the checks export is an engine input the validator and evaluate accept (round trip in calibration-selftest)', validatePredictions(calib.checksToBench([built.check]).predictions).length === 0);

// The default path, by source: the home screen, the photo screen and the result show no plate, ruler, registration or weighing prompt outside "Ajustes / Corrigir".
const appDir = join(HERE, '..', 'app');
const appJs = fs.readFileSync(join(appDir, 'app.mjs'), 'utf8'); const estJs = fs.readFileSync(join(appDir, 'estimate.mjs'), 'utf8');
const between = (text, a, b) => { const i = text.indexOf(a); const j = text.indexOf(b, i + a.length); return i < 0 || j < 0 ? '' : text.slice(i, j); };
const home = between(appJs, 'async function screenHome()', 'async function screenSettings()');
const photo = between(estJs, 'async function viewPhoto()', '// plate scale:');
const confirmView = between(estJs, 'async function viewConfirm()', 'async function persistEstimate');
const NAGS = /#\/plates|#\/meal|#\/estimate\/new|Pesar refeição|régua|Cadastr|Nenhum prato/i;
check('default path: home is "Apontar para o prato" (camera capture) with a small "Ajustes / Corrigir" link', /Apontar para o prato/.test(home) && /capture: 'environment'/.test(home) && /Ajustes \/ Corrigir/.test(home) && home.length > 200);
check('default path: no plate, ruler, registration or weighing prompt on the home screen', !NAGS.test(home), (home.match(NAGS) ?? [])[0]);
check('default path: no plate prompt on the photo screen', photo.length > 100 && !NAGS.test(photo.replace(/Modo manual/g, '')), (photo.match(NAGS) ?? [])[0]);
const pickerHidden = (view) => { const i = view.indexOf("id: 'adjust'"); return i > 100 && !/plate-select|add-item|go-manual|meal-link|#\/plates/.test(view.slice(0, i)) && /plate-select/.test(view.slice(i)); };
check('default path: on the result the plate picker, manual taps and the weighed-meal link exist only inside the "Ajustes / Corrigir" details', confirmView.length > 500 && pickerHidden(confirmView));
check('default path: "Conferir com balança" is on the result, optional, and stores other_app_kcal as comparison only', /Conferir com balança \(opcional\)/.test(estJs) && /other_app_kcal/.test(fs.readFileSync(join(HERE, 'calibration.mjs'), 'utf8')) && /Nunca é usado como verdade|nunca é usado como verdade/.test(estJs));
check('default path: the checks store exists in IndexedDB and the accuracy screen is routed', /checks: 'id'/.test(fs.readFileSync(join(appDir, 'db.mjs'), 'utf8')) && /#\\\/accuracy/.test(appJs));
check('default path: the "Pesar refeição" code is kept, under Ajustes / Corrigir', /Pesar refeição/.test(between(appJs, 'async function screenSettings()', '// ---------------------------------------------------------------- plates and scale')) && /async function screenMeal/.test(appJs));

// ---------------------------------------------------------------- negative checks: the assertions must bite
const bites = (name, fn) => check(`negative: ${name}`, fn() === true);
bites('a perturbed expectation is reported as a mismatch', () => !near(rice.grams, 141.07275 + 1, 0.05) && !near(steak.kcal, 193.64 * 1.01, 0.02));
bites('treating the steak as loose (pieces density) misses the solid fixture by 46%', () => {
  const loose = { ...priors, groups: { ...priors.groups, cutlet_meat: { ...priors.groups.cutlet_meat, solid: false } } };
  const g = core.estimateItem({ cls: cls('bife-grelhado'), pixels: 12000, scale, priors: loose, lookup }).grams;
  return !near(g, 99.815625, 0.05) && near(g, 54.24, 0.05);
});
bites('ignoring the tilt (cos_tilt = 1) misses the area fixture', () => !near(core.areaMm2(20000, { ...scale, cos_tilt: 1 }), 10562.5, 0.05));
bites('a wrong ellipse (a shrunk by 5%) fails the 1% recovery', () => !near(fit.a * 0.95, 300, 3));
bites('a range with sigma 0 fails the rice fixture', () => !near(core.range80(rice.grams, 0).lo80, 94.9, 0.06));
bites('the old single-count scale term ln(1 + s^2) would fail the sigma and rice range fixtures', () => {
  const old = Math.sqrt(Math.log(1 + 0.3 * 0.3) + Math.log(1 + 0.05 * 0.05)); // 0.297783
  const oldLo = core.range80(141.07275, old).lo80; // 96.30
  return !near(old, 0.309354, 1e-5) && !near(oldLo, 94.9, 0.06) && near(oldLo, 96.3, 0.06);
});
bites('summing the item bounds would fail the totals fixture (202.7 / 451.6 instead of 232.2 / 392.9)', () => {
  const lo = rice.lo80 + steak.lo80 + salad.lo80; const hi = rice.hi80 + steak.hi80 + salad.hi80;
  return !near(lo, 232.2, 0.15) && !near(hi, 392.9, 0.15);
});
bites('treating the scale error as independent per item (no shared term) would fail the totals fixture', () => {
  const noShared = core.totals(items3.map((i) => ({ ...i, sigma_scale: 0 })));
  return !near(noShared.sigma, 0.2052, 1e-4) && !near(noShared.lo80, 232.2, 0.15);
});
bites('a home screen with a plate link or a weighing prompt is caught by the default-path rule', () => NAGS.test(home.replace('Ajustes / Corrigir', 'Cadastrar prato #/plates')) && NAGS.test(`${home} Pesar refeição`) && !NAGS.test(home));
bites('a result whose plate picker sits before the Ajustes details fails the default-path rule', () => pickerHidden(confirmView) && !pickerHidden(`h('select', { id: 'plate-select' }) ${confirmView}`));
bites('a check whose rice was weighed at x1.25 must not leave the state at "Não calibrado"', () => afterOne.label !== 'Não calibrado' && !near(afterOne.global.factor, 1, 1e-3));
bites('learning from the shown (already corrected) grams instead of raw would compound: shown x1.03789 with truth x1.25 gives a different factor', () => {
  const shown = w1[0].grams; const wrong = Math.exp(Math.log(w0[0].raw_grams * 1.25 / shown) / 6);
  return !near(wrong, 1.03789, 1e-3);
});
bites('the eval validator rejects a broken export (negative grams, lo80 > hi80, bad schema)', () => {
  const broken = JSON.parse(JSON.stringify(preds)); broken.meals[0].items[0].grams = -1;
  const inverted = JSON.parse(JSON.stringify(preds)); inverted.meals[0].items[1].lo80 = 500;
  return validatePredictions(broken).length > 0 && validatePredictions(inverted).length > 0 && validatePredictions({ ...preds, schema: 'macrofy.predictions/2' }).length > 0;
});
bites('evaluate throws on a broken export', () => { try { evaluate(tinyManifest, { ...preds, pipeline: {} }); return false; } catch { return true; } });
bites('a priors entry that loses its assumption flag is caught by the priors rule', () => {
  const t = { ...priors.groups.rice_pasta, assumption: false };
  return !(t.assumption === true && t.calibrate_from === 'weighed meals');
});

console.log(failures ? `estimator-selftest: ${failures} FAILED` : 'estimator-selftest: all checks passed');
process.exit(failures ? 1 : 0);
