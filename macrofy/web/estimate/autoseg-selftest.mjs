// Check `autoseg-selftest`: node web/estimate/autoseg-selftest.mjs (run from macrofy/, Node built-ins only).
// Synthetic 160 x 120 scene drawn in code: a table, a plate seen at a tilt (ellipse, 20 degrees), three foods, one food split into two
// fragments, a second food overlapping the first, a fork-shaped strip (non-food), and noise masks. One fixture per rule, then negative
// checks (each rule replaced by a broken version must be reported as a failure), then the composed pipeline with a mocked model:
// success, "no plate found" (falls back to manual) and "empty plate".
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from './autoseg.mjs';
import * as core from './core.mjs';
import { createLookup } from '../../nutrition/lookup-core.mjs';
import { VOCAB } from '../../nutrition/lookup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const priors = JSON.parse(fs.readFileSync(join(HERE, 'priors.json'), 'utf8'));
const P = A.autosegParams(priors);
const classes = VOCAB.classes;

let failures = 0;
const ok = (name) => console.log(`PASS ${name}`);
const bad = (name, detail = '') => { failures++; console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`); };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
const closeTo = (name, actual, expected, tol) => check(name, near(actual, expected, tol), `got ${actual}, expected ${expected} +- ${tol}`);
const throws = (name, fn, re) => { try { fn(); bad(name, 'did not throw'); } catch (e) { check(name, re.test(e.message), `wrong error: ${e.message}`); } };

// ---------------------------------------------------------------- drawing
const W = 160; const H = 120;
const draw = (fn, score) => { const d = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fn(x, y)) d[y * W + x] = 1; return { width: W, height: H, data: d, score }; };
const ell = (cx, cy, a, b, ang = 0, score) => draw((x, y) => { const c = Math.cos(ang); const s = Math.sin(ang); const u = (x - cx) * c + (y - cy) * s; const v = -(x - cx) * s + (y - cy) * c; return (u / a) ** 2 + (v / b) ** 2 <= 1; }, score);
const rect = (x0, y0, x1, y1, score) => draw((x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1, score);
const count = (m) => core.maskCount(m);
const at = (m, x, y) => m.data[y * m.width + x];
const inter = (a, b) => { let n = 0; for (let i = 0; i < a.data.length; i++) if (a.data[i] && b.data[i]) n++; return n; };

const ANG = Math.PI / 9; // 20 degrees
const S = {
  table: rect(0, 0, W - 1, H - 1, 0.99), // best score of all: the plate must not be picked by score
  plate: ell(80, 62, 64, 46, ANG, 0.93),
  plateDup: ell(80, 62, 63, 45, ANG, 0.9), // near-duplicate of the plate
  rice: ell(58, 60, 14, 14, 0, 0.95),
  riceDup: ell(58, 60, 15, 15, 0, 0.85), // near-duplicate of the rice, worse score
  pasta: ell(48, 68, 10, 10, 0, 0.9), // overlaps the rice
  meat: ell(100, 58, 12, 8, 0.5, 0.92),
  salad: ell(80, 80, 9, 9, 0, 0.9),
  fragA: ell(72, 44, 6, 6, 0, 0.9), // one bean pile drawn as two fragments 2 px apart
  fragB: ell(86, 44, 6, 6, 0, 0.85),
  fork: rect(100, 79, 127, 81, 0.9), // thin strip on the plate
  bigBlob: ell(80, 62, 61, 44, ANG, 0.9), // nearly the whole plate: it is the plate, not a food
  bleed: ell(140, 84, 10, 10, 0, 0.9), // half on the plate, half on the table
  speckOutside: rect(20, 20, 21, 21, 0.9), // 4 px on the table
  speckInside: rect(90, 40, 92, 42, 0.9), // 9 px on the plate: under 0.5% of the plate
  lowScore: ell(100, 92, 8, 8, 0, 0.5), // unstable mask: predicted IoU under the threshold
  rim: ell(80, 62, 64, 46, ANG, 0.6), // plate again, a worse duplicate score
};
// A placemat: a cross bigger than the plate, over the centre of the photo, with a high score. Not an ellipse.
const mat = draw((x, y) => (x >= 10 && x <= 149 && y >= 40 && y <= 84) || (x >= 50 && x <= 109 && y >= 5 && y <= 114), 0.97);
const plateArea = count(S.plate);
const plateParams = { minAreaFrac: P.plate_min_area_frac, maxAreaFrac: P.plate_max_area_frac, centerFrac: P.plate_center_frac, centerCoverMin: P.plate_center_cover_min, maxResidual: P.plate_max_residual,
  ringMinArc: P.plate_ring_min_arc, ringMinBand: P.plate_ring_min_band, ringBandLo: P.plate_ring_band_lo, ringSectors: P.plate_ring_sectors, supportIou: P.plate_support_iou };
const foodParams = { minFrac: P.food_min_frac, maxFrac: P.food_max_frac, minPredIoU: P.food_min_pred_iou, minInsideFrac: P.food_min_inside_frac };
const all = Object.values(S);

// ---------------------------------------------------------------- priors: every autoseg threshold and the oil multipliers are labelled assumptions
check('priors.autoseg: every entry has a value, assumption: true and a one-line rationale', Object.entries(priors.autoseg).filter(([k]) => k !== 'note')
  .every(([, e]) => 'value' in e && e.assumption === true && typeof e.rationale === 'string' && e.rationale.length > 10 && !e.rationale.includes('\n')));
for (const k of ['plate_grid_n', 'food_grid_n', 'decode_batch', 'time_budget_ms', 'dedupe_iou', 'plate_min_area_frac', 'plate_max_residual', 'food_min_frac', 'food_max_frac', 'food_min_pred_iou', 'merge_adjacency_px', 'non_food_labels']) check(`priors.autoseg has ${k}`, k in P);
closeTo('ADR 0005: dedupe IoU 0.7, food area 0.5% to 85% of the plate', P.dedupe_iou + P.food_min_frac + P.food_max_frac, 0.7 + 0.005 + 0.85, 1e-12);
check('ADR 0005: non-food labels are prato vazio, talher, guardanapo, copo, mesa', JSON.stringify(P.non_food_labels) === JSON.stringify(['prato vazio', 'talher', 'guardanapo', 'copo', 'mesa']));
check('priors.oil_levels: Sem óleo / Pouco / Normal / Muito = 0 / 0.5 / 1 / 2, all assumptions with a rationale',
  JSON.stringify(priors.oil_levels.map((o) => [o.label, o.factor])) === JSON.stringify([['Sem óleo', 0], ['Pouco', 0.5], ['Normal', 1], ['Muito', 2]]) && priors.oil_levels.every((o) => o.assumption === true && o.rationale.length > 10));
check('priors.typical_plate and its wider scale uncertainty are assumptions', priors.typical_plate.assumption === true && priors.typical_plate_scale_uncertainty.assumption === true && priors.typical_plate_scale_uncertainty.value > priors.scale_uncertainty.value);
throws('autosegParams: an entry without the assumption flag is an error', () => A.autosegParams({ autoseg: { x: { value: 1, rationale: 'a rationale here' } } }), /assumption/);

// ---------------------------------------------------------------- rule: grid prompts
// 4 x 4 grid of a 160 x 120 image: x = (i + 0.5) 160 / 4 = 20, 60, 100, 140; y = (j + 0.5) 120 / 4 = 15, 45, 75, 105.
const g4 = A.gridPoints(160, 120, 4);
check('grid: 16 points, row by row, from (20, 15) to (140, 105)', g4.length === 16 && g4[0].x === 20 && g4[0].y === 15 && g4[1].x === 60 && g4[15].x === 140 && g4[15].y === 105);
// Inside a circle of radius 30 at (80, 60): (60|100, 45|75) are 25 away -> 4 points; (20, ...) and (140, ...) are 60+ away.
const gIn = A.gridPoints(160, 120, 4, { insideEllipse: { cx: 80, cy: 60, a: 30, b: 30, angle_rad: 0 } });
check('grid inside an ellipse: exactly the 4 points near the centre', gIn.length === 4 && gIn.every((p) => [60, 100].includes(p.x) && [45, 75].includes(p.y)));
check('grid inside a thin ellipse keeps only the points near its axis', A.gridPoints(160, 120, 4, { insideEllipse: { cx: 80, cy: 45, a: 70, b: 5, angle_rad: 0 } }).map((p) => `${p.x},${p.y}`).join('|') === '20,45|60,45|100,45|140,45');
throws('grid: n < 1 is an error', () => A.gridPoints(160, 120, 0), /grade/);

// ---------------------------------------------------------------- rule: IoU and dedupe
// Two 10 x 10 squares shifted by 5 px: intersection 5 x 10 = 50, union 100 + 100 - 50 = 150, IoU = 1/3.
const sq = (x0) => rect(x0, 10, x0 + 9, 19);
closeTo('IoU of squares shifted by 5 px is 1/3', A.maskIoU(sq(10), sq(15)), 1 / 3, 1e-12);
closeTo('IoU of a mask with itself is 1', A.maskIoU(sq(10), sq(10)), 1, 1e-12);
closeTo('IoU of disjoint masks is 0', A.maskIoU(sq(10), sq(40)), 0, 1e-12);
closeTo('IoU of two empty masks is 0 (no division by zero)', A.maskIoU(rect(5, 5, 4, 4), rect(5, 5, 4, 4)), 0, 1e-12);
throws('IoU of masks of different sizes is an error', () => A.maskIoU(sq(10), { width: 2, height: 2, data: new Uint8Array([1, 1, 1, 1]) }), /tamanhos/);
const riceIoU = A.maskIoU(S.rice, S.riceDup);
check('the rice duplicate is over the 0.7 threshold, the overlapping pasta is not', riceIoU > P.dedupe_iou && A.maskIoU(S.rice, S.pasta) < P.dedupe_iou, `rice/dup ${riceIoU}, rice/pasta ${A.maskIoU(S.rice, S.pasta)}`);
const dd = (impl) => impl([S.riceDup, S.rice, S.pasta, S.meat, rect(0, 0, -1, -1, 0.99)], P.dedupe_iou);
const ddOut = dd(A.dedupe);
check('dedupe: keeps the higher predicted IoU of a duplicate pair (input order irrelevant)', ddOut.includes(S.rice) && !ddOut.includes(S.riceDup));
check('dedupe: keeps distinct overlapping masks and drops empty ones, best score first', ddOut.length === 3 && ddOut.map((m) => m.score).join() === '0.95,0.92,0.9');
check('dedupe: at a threshold of 1 the near-duplicate stays', A.dedupe([S.rice, S.riceDup], 1).length === 2);

// ---------------------------------------------------------------- rule: ellipse residual and plate selection
const resid = { plate: A.ellipseResidual(S.plate), rice: A.ellipseResidual(S.rice), mat: A.ellipseResidual(mat), fork: A.ellipseResidual(S.fork), square: A.ellipseResidual(rect(50, 30, 110, 90)) };
check('ellipse residual: a tilted plate and a round food are ellipses (< 0.05)', resid.plate < 0.05 && resid.rice < 0.05, JSON.stringify(resid));
check('ellipse residual: a placemat cross and a square are not ellipses (> maxResidual); the thin fork is closer to one than a square', resid.mat > P.plate_max_residual && resid.square > P.plate_max_residual, JSON.stringify(resid));
closeTo('ellipse residual of a 2 px mask is 1', A.ellipseResidual(rect(20, 20, 21, 20)), 1, 1e-12);
const withMat = [...all, mat];
const selectRule = (impl) => { const r = impl(withMat, plateParams); return !!r && r.mask === S.plate; };
const sel = A.selectPlate(all, plateParams);
check('plate selection: the plate mask, not the higher-scored table, the duplicates or the big blob', sel?.mask === S.plate);
closeTo('plate ellipse: semi-major axis 64 (+- 2)', sel?.ellipse.a, 64, 2); closeTo('plate ellipse: semi-minor axis 46 (+- 2)', sel?.ellipse.b, 46, 2);
closeTo('plate ellipse: centre x 80', sel?.ellipse.cx, 80, 1); closeTo('plate ellipse: tilt 20 degrees (+- 1)', sel?.ellipse.angle_rad, ANG, 0.0175);
check('plate selection: with no plate-like mask there is no plate', A.selectPlate([S.table, S.rice, S.meat, S.fork, S.salad, S.speckInside], plateParams) === null);
const offCentre = ell(40, 35, 38, 28, 0, 0.9); // ellipse-shaped and big enough (17% of the photo) but not at the centre
check('plate selection: an ellipse away from the centre is not the plate', A.selectPlate([offCentre], plateParams) === null && A.selectPlate([offCentre], { ...plateParams, centerCoverMin: 0 })?.mask === offCentre);
check('plate selection: the whole-image mask is refused by max area (a 4:3 rectangle is too close to an ellipse for the residual alone)', A.selectPlate([S.table], plateParams) === null && A.selectPlate([S.table], { ...plateParams, maxAreaFrac: 1 })?.mask === S.table);
check('plate selection: a larger placemat over the centre is refused by the ellipse residual, and chosen without it (one prompt each: the tie goes to the larger)', A.selectPlate([...all, mat], plateParams)?.mask === S.plate && A.selectPlate([S.plate, mat], plateParams)?.mask === S.plate && A.selectPlate([S.plate, mat], { ...plateParams, maxResidual: 1 })?.mask === mat);
check('plate selection: a plate under the minimum area is refused', A.selectPlate([ell(80, 60, 20, 15, 0, 0.9)], plateParams) === null);
check('plate selection: the largest of two plate-like masks wins', A.selectPlate([S.bigBlob, S.plate], plateParams)?.mask === S.plate);

// ---------------------------------------------------------------- rule: food area filters
const foodRule = (impl) => {
  const kept = impl(all, sel, foodParams);
  const want = [S.rice, S.pasta, S.meat, S.salad, S.fragA, S.fragB, S.fork, S.riceDup];
  const drop = [S.plate, S.plateDup, S.bigBlob, S.rim, S.table, S.bleed, S.speckOutside, S.speckInside, S.lowScore];
  return want.every((m) => kept.some((k) => k.data === m.data)) && drop.every((m) => !kept.some((k) => k.data === m.data));
};
const foods = A.filterFoods(all, sel, foodParams);
check('area filters: keeps the foods and the fork, drops the plate, its big blob and duplicates, the table, the bleed, specks and the unstable mask', foodRule(A.filterFoods));
check('area filters: nothing over 85% of the plate survives, nothing under 0.5%', foods.every((m) => m.plate_frac >= P.food_min_frac && m.plate_frac <= P.food_max_frac));
const only = (m, extra) => A.filterFoods([m], sel, { ...foodParams, ...extra }).length;
check('area filter: minFrac bites on the 9 px speck (0.1% of the plate)', only(S.speckInside) === 0 && only(S.speckInside, { minFrac: 0.0005 }) === 1);
check('area filter: maxFrac bites on the near-plate blob', only(S.bigBlob) === 0 && only(S.bigBlob, { maxFrac: 1 }) === 1);
check('area filter: predicted IoU bites on the unstable mask', only(S.lowScore) === 0 && only(S.lowScore, { minPredIoU: 0.4 }) === 1);
check('area filter: inside-the-plate share bites on the mask half on the table', only(S.bleed) === 0 && only(S.bleed, { minInsideFrac: 0.3 }) === 1);
closeTo('area filter: rice is disc r 14 = 615 px of the plate ellipse (6.6%)', foods.find((m) => m.data === S.rice.data).plate_frac, count(S.rice) / plateArea, 1e-9);

// ---------------------------------------------------------------- rule: overlap resolution
// Rice (0.95) and pasta (0.9) overlap in a lens: each lens pixel goes to the rice, so the pasta loses exactly the lens.
const lens = inter(S.rice, S.pasta);
const ovRule = (impl) => {
  const [r, p] = impl([S.rice, S.pasta]);
  return inter(r, p) === 0 && count(r) === count(S.rice) && count(p) === count(S.pasta) - lens;
};
const [r1, p1] = A.resolveOverlaps([S.rice, S.pasta]);
check('overlaps: the lens is a real overlap in the fixture', lens > 50, `lens ${lens}`);
check('overlaps: no pixel in two masks; the higher predicted IoU keeps the lens', ovRule(A.resolveOverlaps));
const [p2, r2] = A.resolveOverlaps([{ ...S.pasta, score: 0.99 }, S.rice]);
check('overlaps: raise the pasta score above the rice and the pasta gets the lens', count(p2) === count(S.pasta) && count(r2) === count(S.rice) - lens);
check('overlaps: the union of pixels is unchanged; inputs are not modified', count(r1) + count(p1) === count(S.rice) + count(S.pasta) - lens && r1.data !== S.rice.data);
check('overlaps: a mask fully covered by a better one is dropped', A.resolveOverlaps([S.rice, ell(58, 60, 5, 5, 0, 0.5)]).length === 1);
check('overlaps: nothing in, nothing out', A.resolveOverlaps([]).length === 0);

// ---------------------------------------------------------------- rule: same-label fragment merge
const item = (label, mask, score) => ({ label, mask, score });
const frags = () => [item('feijão', S.fragA, 0.9), item('arroz', S.rice, 0.95), item('feijão', S.fragB, 0.85), item('macarrão', S.pasta, 0.9), item('feijão', ell(130, 100, 5, 5, 0, 0.8), 0.8)];
const mergeRule = (impl) => {
  const out = impl(frags(), 6);
  const beans = out.filter((i) => i.label === 'feijão');
  const merged = beans.find((i) => count(i.mask) === count(S.fragA) + count(S.fragB));
  return out.length === 4 && beans.length === 2 && !!merged && merged.score === 0.9 && merged.parts?.length === 2 && out.some((i) => i.label === 'arroz') && out.some((i) => i.label === 'macarrão');
};
const mrg = A.mergeSameLabel(frags(), 6);
check('merge: the two bean fragments 2 px apart merge (union mask, best score, parts kept); a far bean pile and other labels stay', mergeRule(A.mergeSameLabel));
check('merge: rice and pasta touch but have different labels: not merged', mrg.some((i) => i.label === 'arroz') && mrg.some((i) => i.label === 'macarrão'));
check('merge: the gap is 2 px, so adjacency 1 does not merge and adjacency 2 does', A.mergeSameLabel(frags(), 1).length === 5 && A.mergeSameLabel(frags(), 2).length === 4);
check('merge: the merged item keeps the position of its first member', mrg[0].label === 'feijão' && mrg[1].label === 'arroz');
check('merge: a single item comes back as it is', A.mergeSameLabel([item('arroz', S.rice, 0.9)], 6).length === 1);

// ---------------------------------------------------------------- rule: non-food rejection
const nf = A.nonFoodPrompts(P.non_food_labels);
check('non-food prompts use the same form as the food prompts', nf[1] === core.NAME_PROMPT('talher') && nf.length === 5);
const sc = (best, second = []) => [{ label: core.NAME_PROMPT('arroz branco cozido'), score: 0.1 }, ...second, { label: best, score: 0.8 }];
const nfItems = [item('x', S.rice), item('x', S.fork), item('x', S.meat), item('x', S.salad)];
const nfScores = [sc(core.NAME_PROMPT('arroz branco cozido')), sc(core.NAME_PROMPT('talher')), sc(core.NAME_PROMPT('bife grelhado'), [{ label: core.NAME_PROMPT('mesa'), score: 0.3 }]), sc(core.NAME_PROMPT('mesa'))];
const nfRule = (impl) => { const r = impl(nfItems, nfScores, nf); return r.foods.length === 2 && r.rejected.length === 2 && r.rejected.every((i) => [S.fork, S.salad].some((m) => m === i.mask)) && r.foods.every((i) => [S.rice, S.meat].some((m) => m === i.mask)); };
check('non-food: best label talher or mesa is rejected; a non-food label that is only second best is not', nfRule(A.rejectNonFood));
check('non-food: the best label is attached to every item', A.rejectNonFood(nfItems, nfScores, nf).foods[1].best_label === core.NAME_PROMPT('bife grelhado'));
throws('non-food: scores must be one list per item', () => A.rejectNonFood(nfItems, nfScores.slice(1), nf), /pontuações/);

// ---------------------------------------------------------------- plate scale prior
const known = A.plateSetup(priors, { id: 'raso', name: 'Prato raso', diameter_mm: 240 });
const typical = A.plateSetup(priors, null);
check('plate setup: a registered plate keeps its diameter and the normal scale uncertainty', known.diameter_mm === 240 && known.typical === false && known.scale_uncertainty === priors.scale_uncertainty.value);
check('plate setup: an unknown plate is the "prato típico" prior with the wider uncertainty', typical.typical === true && typical.diameter_mm === priors.typical_plate.diameter_mm && typical.scale_uncertainty === priors.typical_plate_scale_uncertainty.value && typical.name === 'Prato típico');
const lookup = createLookup(VOCAB); const scale = core.scaleFromAxes(200, 160, 260);
const rng = (setup) => core.estimateItem({ cls: classes.find((c) => c.id === 'arroz-branco-cozido'), pixels: 20000, scale, oil: 'normal', priors: A.priorsForPlate(priors, setup), lookup });
const rk = rng(known); const rt = rng(typical);
check('plate setup: the same grams get a wider 80% range for an unknown plate; the grams are unchanged', rk.grams === rt.grams && rt.hi80 - rt.lo80 > rk.hi80 - rk.lo80 && rt.sigma_scale > rk.sigma_scale);

// ---------------------------------------------------------------- negative checks: the assertions must fail on broken rules
const bites = (name, fn) => check(`negative: ${name}`, fn() === false, 'the assertion did not catch the broken rule');
bites('dedupe that keeps everything is caught', () => { const o = dd((m) => m); return o.includes(S.rice) && !o.includes(S.riceDup) && o.length === 3; });
bites('dedupe that keeps the lower score is caught', () => { const o = dd((ms, t) => A.dedupe(ms.map((m) => ({ ...m, score: -(m.score ?? 0) })), t)); return o.some((m) => m.data === S.rice.data) && !o.some((m) => m.data === S.riceDup.data); });
bites('plate = highest score is caught', () => selectRule((ms) => ({ mask: ms.reduce((p, q) => ((q.score ?? 0) > (p.score ?? 0) ? q : p)) })));
bites('plate = largest mask, ignoring the ellipse residual and the max area, is caught', () => selectRule((ms) => ({ mask: ms.reduce((p, q) => (count(q) > count(p) ? q : p)) })));
bites('plate selection with the residual limit switched off is caught', () => A.selectPlate([S.plate, mat], { ...plateParams, maxResidual: 1 })?.mask === S.plate);
bites('plate selection with the area limit switched off is caught', () => A.selectPlate([S.table, S.plate], { ...plateParams, maxAreaFrac: 1, maxResidual: 1 })?.mask === S.plate);
bites('food filter that lets everything through is caught', () => foodRule((ms) => ms));
bites('food filter without the area limits is caught', () => foodRule((ms, pl, o) => A.filterFoods(ms, pl, { ...o, minFrac: 0, maxFrac: 10, minInsideFrac: 0 })));
bites('food filter without the predicted-IoU limit is caught', () => foodRule((ms, pl, o) => A.filterFoods(ms, pl, { ...o, minPredIoU: 0 })));
bites('overlap resolution that returns the masks untouched is caught', () => ovRule((ms) => ms));
bites('overlap resolution in the wrong order (lower score wins) is caught', () => ovRule((ms) => A.resolveOverlaps(ms.map((m) => ({ ...m, score: -(m.score ?? 0) })))));
bites('merge that never merges is caught', () => mergeRule((it) => it));
bites('merge that ignores the label is caught', () => mergeRule((it, adj) => A.mergeSameLabel(it.map((i) => ({ ...i, label: 'x' })), adj)));
bites('merge with adjacency 0 is caught', () => mergeRule((it) => A.mergeSameLabel(it, 0)));
bites('non-food rejection that rejects nothing is caught', () => nfRule((it) => ({ foods: it, rejected: [] })));
bites('non-food rejection that drops an item whenever a non-food label appears is caught', () => nfRule((it, s) => { const r = A.rejectNonFood(it, s, nf); const anyNf = it.map((x, i) => s[i].some((e) => nf.includes(e.label))); return { foods: it.filter((x, i) => !anyNf[i]), rejected: it.filter((x, i) => anyNf[i]) }; }));

// ---------------------------------------------------------------- pipeline over a mocked model (detectAuto)
const LM = { rice: [58, 60], pasta: [42, 72], meat: [100, 58], salad: [80, 80], fragA: [72, 44], fragB: [86, 44], fork: [110, 80] };
const NAME = { rice: 'arroz branco cozido', pasta: 'macarrão cozido', meat: 'bife grelhado', salad: 'salada mista crua (alface, tomate, cenoura)', fragA: 'feijão carioca cozido', fragB: 'feijão carioca cozido', fork: 'talher' };
function makeModels({ plateStage, foodStage, timedOut = false, override = {} }) {
  const calls = { seg: [], classify: 0 };
  return { calls,
    async segmentPoints(points, opts) { calls.seg.push({ n: points.length, opts }); const masks = calls.seg.length === 1 ? plateStage : foodStage; return { masks, decodes: points.length, ms: 7, timed_out: timedOut }; },
    async classify(blob, prompts) {
      calls.classify++;
      // the crop is the mask itself here; the label is the landmark the mask covers (resolved overlaps: the rice keeps its own landmark)
      const key = Object.keys(LM).find((k) => at(blob, ...LM[k]));
      const label = override[key] ?? NAME[key];
      return prompts.map((p) => ({ label: p, score: p === core.NAME_PROMPT(label) ? 0.9 : 0.01 }));
    } };
}
const detect = (models, extra = {}) => A.detectAuto({ models, params: P, classes, width: W, height: H, crop: async (m) => m, ...extra });
const scene = { plateStage: [S.table, S.plate, S.plateDup, S.speckOutside, S.rice], foodStage: [S.plate, S.bigBlob, S.rice, S.riceDup, S.pasta, S.meat, S.salad, S.fragA, S.fragB, S.fork, S.bleed, S.speckInside, S.lowScore, S.table] };
const ok1 = await detect(makeModels(scene));
check('pipeline: status ok, plate found with the right ellipse', ok1.status === 'ok' && ok1.plate?.mask === S.plate && near(ok1.plate.ellipse.a, 64, 2));
const names = ok1.items.map((i) => i.cls.id).sort();
check('pipeline: 5 items (rice, pasta, steak, salad, beans merged from 2 fragments); the fork is not one of them', JSON.stringify(names) === JSON.stringify(['arroz-branco-cozido', 'bife-grelhado', 'feijao-carioca-cozido', 'macarrao-cozido', 'salada-mista-crua'].sort()), names.join());
const beans = ok1.items.find((i) => i.cls.id === 'feijao-carioca-cozido');
check('pipeline: merged beans = both fragments, with the parts kept for a later split', !!beans && count(beans.mask) === count(S.fragA) + count(S.fragB) && beans.parts.length === 2);
check('pipeline: the fork was rejected as non-food (talher) and reported', ok1.rejected.length === 1 && ok1.rejected[0].best_label === core.NAME_PROMPT('talher'));
const rice1 = ok1.items.find((i) => i.cls.id === 'arroz-branco-cozido'); const pasta1 = ok1.items.find((i) => i.cls.id === 'macarrao-cozido');
check('pipeline: overlapping items do not share pixels (rice keeps the lens)', inter(rice1.mask, pasta1.mask) === 0 && count(rice1.mask) === count(S.rice) && count(pasta1.mask) === count(S.pasta) - lens);
check('pipeline: every item has top-3 names, the top-1 as its class', ok1.items.every((i) => i.top.length === 3 && i.top[0].cls === i.cls && i.label === i.cls.id));
const models1 = makeModels(scene); await detect(models1);
check('pipeline: two grids decoded (plate grid, then foods inside the plate) with the batch and time budget from priors', models1.calls.seg.length === 2 && models1.calls.seg[0].n === P.plate_grid_n ** 2 && models1.calls.seg[1].n < P.food_grid_n ** 2 && models1.calls.seg[1].n > 0 && models1.calls.seg.every((c) => c.opts.batch === P.decode_batch && c.opts.budgetMs <= P.time_budget_ms));
check('pipeline: timings record decodes, decode ms, classify ms and total ms', ok1.timings.decodes === models1.calls.seg[0].n + models1.calls.seg[1].n && ok1.timings.decode_ms === 14 && ok1.timings.total_ms >= 0 && ok1.timings.classify_ms >= 0 && ok1.timings.timed_out === false);
const stages = []; await detect(makeModels(scene), { onStage: (e) => stages.push(e.stage) });
check('pipeline: progress goes plate, foods, naming', stages.indexOf('plate') === 0 && stages.includes('foods') && stages.at(-1) === 'naming' && stages.indexOf('foods') < stages.indexOf('naming'));
// a food named as non-food by SigLIP is dropped even with no fork in the scene
const ok2 = await detect(makeModels({ ...scene, foodStage: [S.rice, S.meat] }));
check('pipeline: two foods only -> two items', ok2.status === 'ok' && ok2.items.length === 2);

// no plate found: only foods, the table and noise -> falls back to manual, no foods are decoded
const np = makeModels({ plateStage: [S.table, S.rice, S.meat, S.fork, S.salad, S.speckInside], foodStage: [S.rice] });
const noPlate = await detect(np, { fallback: false });
check('no plate found, fallback switched off: status no_plate, no plate, no items, and the foods grid is never decoded (manual fallback)', noPlate.status === 'no_plate' && noPlate.plate === null && noPlate.items.length === 0 && np.calls.seg.length === 1 && np.calls.classify === 0);
const to = await detect(makeModels({ plateStage: [], foodStage: [], timedOut: true }), { fallback: false });
check('no plate found because the time budget ran out: no_plate and timed_out is recorded', to.status === 'no_plate' && to.timings.timed_out === true);
// empty plate: the plate is found but nothing on it survives (only noise), or everything on it is cutlery
const empty1 = await detect(makeModels({ plateStage: scene.plateStage, foodStage: [S.plate, S.speckInside, S.lowScore, S.bleed, S.bigBlob] }));
check('empty plate: plate found, nothing passes the food filters -> empty_plate (offer add-by-tap)', empty1.status === 'empty_plate' && !!empty1.plate && empty1.items.length === 0);
const empty2 = await detect(makeModels({ ...scene, foodStage: [S.fork] }));
check('empty plate: the only mask is cutlery -> rejected as non-food -> empty_plate', empty2.status === 'empty_plate' && empty2.rejected.length === 1);
const empty3 = await detect(makeModels({ ...scene, foodStage: [] }));
check('empty plate: the foods grid returns nothing -> empty_plate', empty3.status === 'empty_plate' && empty3.items.length === 0);
const capped = await detect(makeModels(scene), { params: { ...P, max_food_items: 2 } });
check('pipeline: max_food_items keeps the largest few', capped.items.length === 2);
// ---------------------------------------------------------------- T-017: the plate SAM 2.1 returns is the plate WITHOUT its food (hypothesis from the CI run: auto mode
// found no plate on SAM 2.1 tiny while SlimSAM did; the CI summary now logs per-prompt area and residual to confirm). The food is a hole in that mask:
// the raw mask fails the ellipse rule, the mask with its holes filled passes, and foods on the plate must not be rejected as "off the plate".
const holed = { ...S.plate, score: 0.97, data: Uint8Array.from(S.plate.data, (v, i) => (v && !S.rice.data[i] && !S.meat.data[i] && !S.salad.data[i] ? 1 : 0)) };
const filled = A.fillHoles(holed);
check('fillHoles: the three food holes are filled back to the whole plate; score and size are kept', count(filled) === count(S.plate) && filled.score === 0.97 && filled !== holed && at(filled, 58, 60) === 1 && at(filled, 100, 58) === 1);
check('fillHoles: a mask without a hole is returned as it is (same object)', A.fillHoles(S.plate) === S.plate && A.fillHoles(S.rice) === S.rice);
const notch = { ...S.plate, data: Uint8Array.from(S.plate.data, (v, i) => (v && !(i % W >= 76 && i % W <= 84 && Math.floor(i / W) <= 62) ? 1 : 0)) }; // a bite from the centre to the top rim, open to the outside
check('fillHoles: background connected to the photo border is not a hole (an open notch stays open)', count(A.fillHoles(notch)) === count(notch));
const dgn = A.plateDiagnostics([S.table, holed, S.rice], plateParams);
check('the raw plate-without-food mask fails the ellipse rule, the filled one passes: residual_raw above the limit, residual below', dgn[1].residual_raw > P.plate_max_residual && dgn[1].residual <= P.plate_max_residual && dgn[1].area_raw < dgn[1].area_frac && dgn[1].verdict === 'ok');
check('diagnostics say why each mask is not the plate: table too large, rice too small; rows carry area, cover, residual and verdict', dgn[0].verdict === 'too_large' && dgn[2].verdict === 'too_small' && ['x', 'y', 'score', 'area_frac', 'area_raw', 'cover', 'residual', 'residual_raw', 'verdict'].every((k) => k in dgn[1]));
const selHoled = A.selectPlate([S.table, holed, S.rice], plateParams);
check('plate selection: the plate without its food is the plate (filled), its source is kept and the ellipse is the plate\'s', !!selHoled && selHoled.filled === true && selHoled.source === holed && selHoled.mask !== holed && near(selHoled.ellipse.a, 64, 2) && selHoled.index === 1);
check('food filter: the plate again, with or without its food, is not a food (plateDupIou); foods on the filled plate are inside it', (() => {
  const fs = A.filterFoods([holed, S.plate, S.rice, S.meat], selHoled, { ...foodParams, plateDupIou: P.dedupe_iou });
  return fs.length === 2 && fs.every((m) => m.inside_frac === 1);
})());
const holedScene = { plateStage: [S.table, holed, S.speckOutside], foodStage: [holed, S.rice, S.meat, S.salad, S.lowScore] };
const mh = makeModels(holedScene); const rh = await detect(mh, { diagnostics: true });
check('pipeline with a plate that has holes for its food: plate found (filled), 3 foods kept, the plate-without-food mask is not one of them', rh.status === 'ok' && rh.plate.filled === true && rh.items.map((i) => i.cls.id).sort().join() === 'arroz-branco-cozido,bife-grelhado,salada-mista-crua');
check('pipeline: the plate grid keeps all multimask outputs (plate_masks_per_point), the food grid the best one', mh.calls.seg[0].opts.perPoint === P.plate_masks_per_point && P.plate_masks_per_point === 3 && mh.calls.seg[1].opts.perPoint === P.masks_per_point);
check('pipeline: per-stage decode timings and (on request) the plate diagnostics; without the flag no diagnostics', rh.timings.plate_decode_ms === 7 && rh.timings.food_decode_ms === 7 && Array.isArray(rh.plate_candidates) && rh.plate_candidates.length === 3 && rh.plate_candidates.some((r) => r.verdict === 'ok') && !('plate_candidates' in ok1));
const nop = await detect(makeModels({ plateStage: [S.table, S.rice], foodStage: [] }), { diagnostics: true, fallback: false });
check('no plate with diagnostics: the rows explain it', nop.status === 'no_plate' && nop.plate_candidates.map((r) => r.verdict).join() === 'too_large,too_small');
// ---------------------------------------------------------------- T-017: real photos. In the CI run on a Commons photo (a plate of Thai chicken rice) SAM 2.1 returned
// (a) the TABLE as a big mask with the plate as its hole (raw area 0.38, filled 0.99, so too_large) and (b) the plate rim as a ring around the food that
// does not close (centre cover 0.05, residual 0.6). Both are plates in disguise: the region a table mask encloses, and the hull of an almost closed ring.
const annulus = (gapDeg = 0, inner = 0.55, score = 0.96) => draw((x, y) => {
  const c = Math.cos(ANG); const sn = Math.sin(ANG); const u = ((x - 80) * c + (y - 62) * sn) / 64; const v = (-(x - 80) * sn + (y - 62) * c) / 46; const rho = Math.hypot(u, v);
  if (rho > 1 || rho < inner) return false; const deg = (Math.atan2(v, u) * 180) / Math.PI; return !(gapDeg && Math.abs(deg + 90) <= gapDeg / 2);
}, score);
const ringOpen = annulus(60); const ringClosed = annulus(0); const ringHalf = draw((x, y) => at(annulus(0), x, y) && y > 62, 0.9);
const tableMinusPlate = draw((x, y) => !at(S.plate, x, y), 0.95); // the table as a mask, the plate is its hole
const arcP = { sectors: P.plate_ring_sectors, bandLo: P.plate_ring_band_lo }; const plateE = A.selectPlate([S.plate], plateParams).ellipse;
closeTo('arcCoverage: a closed annulus reaches all the way around', A.arcCoverage(ringClosed, plateE, arcP), 1, 0.001);
check('arcCoverage: an annulus with a 60 degree gap reaches about 90% (above the 0.75 limit), a half ring 50%', near(A.arcCoverage(ringOpen, plateE, arcP), 0.875, 0.07) && A.arcCoverage(ringOpen, plateE, arcP) >= P.plate_ring_min_arc && near(A.arcCoverage(ringHalf, plateE, arcP), 0.5, 0.07));
check('ring test: a placemat cross reaches every sector but most of it is off the rim band, so it is not a ring; heaps of food reach no sector; the open ring is one', !A.isRing(mat, plateE, plateParams) && A.ringFit(mat, plateE, arcP).band < P.plate_ring_min_band && A.isRing(ringOpen, plateE, plateParams) && A.arcCoverage(S.rice, plateE, arcP) === 0 && A.arcCoverage(S.salad, plateE, arcP) === 0);
const hull = A.convexHull(ringOpen);
check('convexHull: an open ring becomes the disc minus the chord over its 60 degree gap (a 2.9% segment, so within 5% of the plate ellipse), a convex mask keeps its area', near(count(hull) / plateArea, 1, 0.05) && count(hull) / plateArea < 1 && near(count(A.convexHull(S.rice)) / count(S.rice), 1, 0.04) && A.convexHull(S.speckOutside).data.length === W * H && count(A.convexHull(rect(5, 5, 5, 5))) === 1);
const regs = A.enclosedRegions(tableMinusPlate, 100);
check('enclosedRegions: the table mask encloses exactly the plate (one region, its pixels are the plate ellipse\'s); a mask with no hole encloses none', regs.length === 1 && near(count(regs[0]) / plateArea, 1, 0.001) && regs[0].score === 0.95 && A.enclosedRegions(S.plate).length === 0 && A.enclosedRegions(S.plate, 100).length === 0);
const selHole = A.selectPlate([S.table, tableMinusPlate, S.rice], plateParams);
check('plate selection: the region a table-sized mask encloses is the plate (via hole); the table mask itself is refused (too large)', !!selHole && selHole.via === 'hole' && selHole.source === tableMinusPlate && near(selHole.ellipse.a, 64, 2) && A.plateDiagnostics([tableMinusPlate], plateParams)[0].via === 'hole');
const selRing = A.selectPlate([S.table, ringOpen, S.rice], plateParams);
check('plate selection: an almost closed ring around the food is the plate through its hull (via ring), with the plate ellipse', !!selRing && selRing.via === 'ring' && near(selRing.ellipse.a, 64, 3) && near(selRing.ellipse.b, 46, 3) && near(selRing.area_frac, plateArea / (W * H), 0.02));
check('plate selection: a closed ring is the plate by filling its hole (via filled), no hull needed', A.selectPlate([ringClosed], plateParams)?.via === 'filled');
check('plate selection: a half ring, a placemat cross and food heaps are NOT plates (no ring: too few sectors reached, or not an ellipse)', A.selectPlate([ringHalf], plateParams) === null && A.selectPlate([mat], plateParams) === null && A.selectPlate([S.rice, S.meat, S.salad, S.fork], plateParams) === null);
check('plate selection: with the variants off (variants: false) the ring and the table mask are refused, as before', A.selectPlate([ringOpen, tableMinusPlate], { ...plateParams, variants: false }) === null);
const drow = A.plateDiagnostics([ringOpen, ringHalf], plateParams);
check('diagnostics: the open ring passes as ring, the half ring says why not (verdict and via reported)', drow[0].verdict === 'ok' && drow[0].via === 'ring' && drow[1].verdict !== 'ok' && drow[1].via === 'raw');
check('food filter: the plate rim (a ring around the plate) is not a food, foods inside are kept', (() => {
  const fs = A.filterFoods([ringOpen, S.rice, S.meat], selRing, { ...foodParams, plateDupIou: P.dedupe_iou, ringMinArc: P.plate_ring_min_arc, ringMinBand: P.plate_ring_min_band, ringBandLo: P.plate_ring_band_lo, ringSectors: P.plate_ring_sectors });
  return fs.length === 2 && fs.every((m) => m !== ringOpen);
})());
const rr = await detect(makeModels({ plateStage: [S.table, ringOpen, tableMinusPlate.score ? S.speckOutside : null], foodStage: [ringOpen, S.rice, S.meat, S.salad] }), { diagnostics: true });
check('pipeline on a photo where SAM returns the plate as an open ring: plate found (ring), 3 foods, the rim is not one of them, plate_detected true', rr.status === 'ok' && rr.plate_detected === true && rr.plate.via === 'ring' && rr.items.length === 3 && !('note' in rr));
const rtab = await detect(makeModels({ plateStage: [S.table, tableMinusPlate], foodStage: [S.rice, S.meat, S.salad] }));
check('pipeline on a photo where SAM returns the table with the plate as its hole: plate found (hole), 3 foods', rtab.status === 'ok' && rtab.plate.via === 'hole' && rtab.items.length === 3);

// The second real-model CI run (SAM 2.1 and SlimSAM, synthetic photo): ~30 prompts returned the plate (0.43 of the photo), one returned a band of table
// around it whose hull passed the ring test at 0.88, and "largest wins" chose the band (every weight would come out ~half). The plate is the candidate
// most passing masks agree with; the largest only breaks a tie.
const band = draw((x, y) => { const c = Math.cos(ANG); const sn = Math.sin(ANG); const u = ((x - 80) * c + (y - 62) * sn) / 76; const v = (-(x - 80) * sn + (y - 62) * c) / 55; const rho = Math.hypot(u, v); return rho <= 1 && !at(S.plate, x, y); }, 0.8);
const bandSel = A.selectPlate([band], plateParams);
check('a band of table around the plate passes as a plate on its own (its hole filled, larger than the plate): the case consensus must handle', !!bandSel && bandSel.area_frac > 1.3 * plateArea / (W * H));
const cons = A.selectPlate([band, S.plate, S.plateDup, tableMinusPlate, S.rice], plateParams);
check('plate selection: the plate seen by several prompts (raw, near-duplicate, table hole) beats a larger band seen by one; support is reported', !!cons && near(cons.area_frac, plateArea / (W * H), 0.01) && cons.support === 3);
check('plate selection: supportIou is a prior (plate_support_iou, an assumption with a rationale)', P.plate_support_iou === 0.85 && priors.autoseg.plate_support_iou.assumption === true);
bites('plate selection by size alone (no consensus) is caught: it picks the band', () => A.selectPlate([band, S.plate, S.plateDup, tableMinusPlate], { ...plateParams, supportIou: 1.01 })?.mask === S.plate);
const rband = await detect(makeModels({ plateStage: [band, S.plate, S.plateDup, tableMinusPlate], foodStage: [S.rice, S.meat, S.salad] }), { diagnostics: true });
check('pipeline: the plate grid is judged without dedupe (repeats are the evidence), the band is not the plate, diagnostics list every raw mask', rband.status === 'ok' && near(rband.plate.area_frac, plateArea / (W * H), 0.01) && rband.plate_candidates.length === 4 && rband.items.length === 3);

// ---------------------------------------------------------------- T-017: still no plate: zero setup means no tap. Foods from a centre grid, a circle standing in for the plate
const fbScene = { plateStage: [S.table, S.fork, S.speckInside], foodStage: [S.table, S.rice, S.meat, S.salad, S.fork, S.lowScore, S.speckInside] }; // no S.bleed: "half off the plate" needs a plate to be judged
const fbModels = makeModels(fbScene); const fb = await detect(fbModels);
check('no plate found: no failure and no tap: status ok, plate_detected false, the honest note, the foods found on a centre grid over the whole photo', fb.status === 'ok' && fb.plate_detected === false && fb.note === A.NO_PLATE_NOTE && A.NO_PLATE_NOTE === 'prato não detectado — escala aproximada' && fb.items.map((i) => i.cls.id).sort().join() === 'arroz-branco-cozido,bife-grelhado,salada-mista-crua');
check('no plate: the table, the crumb, the unstable mask and the cutlery are not foods; two grids are decoded (plate grid, then the centre food grid) with the plate decode time kept apart', fbModels.calls.seg.length === 2 && fbModels.calls.seg[1].n < P.food_grid_n ** 2 && fbModels.calls.seg[1].n >= 16 && fb.timings.food_decode_ms === 7 && fb.timings.plate_decode_ms === 7);
const ue = fitUnion([S.rice, S.meat, S.salad]);
function fitUnion(ms) { const d = new Uint8Array(W * H); for (const m of ms) for (let i = 0; i < d.length; i++) if (m.data[i]) d[i] = 1; return core.fitEllipse({ width: W, height: H, data: d }); }
check('no plate: the stand-in plate is a circle (no tilt) centred on the food with the food ellipse\'s radius times noplate_span_factor, marked synthetic, the scale is the typical plate\'s', fb.plate.synthetic === true && fb.plate.via === 'synthetic' && near(fb.plate.ellipse.a, Math.sqrt(ue.a * ue.b) * P.noplate_span_factor, 1.5) && near(fb.plate.ellipse.b, fb.plate.ellipse.a, 0.6) && near(fb.plate.ellipse.cx, ue.cx, 1.5) && core.scaleFromPlateMask(fb.plate.mask, 260).cos_tilt > 0.98);
const sp = A.plateSetup(priors, null, { noPlate: true }); const tp = A.plateSetup(priors, null);
check('no plate: the setup is the typical plate with the wider no-plate scale uncertainty (an assumption in priors) and says so; known plates and the typical plate are unchanged', sp.typical === true && sp.no_plate === true && sp.diameter_mm === 260 && sp.scale_uncertainty === priors.no_plate_scale_uncertainty.value && sp.scale_uncertainty > tp.scale_uncertainty && tp.no_plate === false && A.plateSetup(priors, { id: 'p', name: 'x', diameter_mm: 270 }).no_plate === false && priors.no_plate_scale_uncertainty.assumption === true && A.priorsForPlate(priors, sp).scale_uncertainty.value === sp.scale_uncertainty);
const fbEmpty = await detect(makeModels({ plateStage: [], foodStage: [S.table, S.fork] }));
check('no plate and no food: still no tap and no failure: empty_plate with a default circle at the photo centre (noplate_default_plate_frac of the short side), plate_detected false', fbEmpty.status === 'empty_plate' && fbEmpty.plate_detected === false && fbEmpty.plate.synthetic === true && near(fbEmpty.plate.ellipse.cx, W / 2, 1) && near(fbEmpty.plate.ellipse.a, P.noplate_default_plate_frac * H / 2, 1) && fbEmpty.items.length === 0);
const fbTo = await detect(makeModels({ plateStage: [], foodStage: [], timedOut: true }));
check('no plate because the time budget ran out: the fallback still answers (empty_plate), timed_out is recorded', fbTo.status === 'empty_plate' && fbTo.timings.timed_out === true && fbTo.plate_detected === false);
check('priors: the ring and no-plate thresholds are assumptions in priors.json (autosegParams checks value, assumption and rationale)', ['plate_ring_min_arc', 'plate_ring_band_lo', 'plate_ring_sectors', 'noplate_center_frac', 'noplate_span_factor', 'noplate_default_plate_frac', 'noplate_food_min_image_frac', 'noplate_food_max_image_frac'].every((k) => k in P));
// ---------------------------------------------------------------- T-017: auto mode in a small mask space (memory on the iPhone: masks from the low-res logits)
const big = A.resizeMask(S.plate, W * 4, H * 4);
check('resizeMask: x4 keeps the plate area (x16 pixels, within 1%) and the score; back down to the original size is the same mask; same size returns the same object', near(count(big) / (16 * count(S.plate)), 1, 0.01) && big.score === S.plate.score && count(A.resizeMask(big, W, H)) === count(S.plate) && A.resizeMask(S.plate, W, H) === S.plate);
const lowCalls = []; const lowModels = { ...makeModels(scene), async segmentPoints(points, opts) { lowCalls.push({ points, opts }); return { masks: lowCalls.length === 1 ? scene.plateStage : scene.foodStage, decodes: points.length, ms: 7 }; } };
const lowRes = await A.detectAuto({ models: lowModels, params: P, classes, width: W, height: H, photoWidth: W * 4, photoHeight: H * 4, crop: async (m) => m });
check('mask space smaller than the photo: points go to the model in photo pixels (x4), masks are asked at the mask size (lowRes), the result is the same as at full size', lowRes.status === 'ok' && lowCalls[0].opts.lowRes.w === W && lowCalls[0].opts.lowRes.h === H && near(lowCalls[0].points[0].x, 4 * (0.5 * W / P.plate_grid_n), 1e-9) && lowRes.items.length === ok1.items.length);
let sizeErr = null; try { await A.detectAuto({ models: { ...lowModels, segmentPoints: async () => ({ masks: [big], decodes: 1, ms: 1 }) }, params: P, classes, width: W, height: H, photoWidth: W * 4, photoHeight: H * 4, crop: async (m) => m }); } catch (e) { sizeErr = e; }
check('mask space: a model that returns masks of another size is an error (not a silent wrong scale)', sizeErr instanceof Error && /esperado 160x120/.test(sizeErr.message));
check('priors: mask_side and the crash-retry settings are assumptions', P.mask_side === 384 && P.crash_retry.plate_grid_n < P.plate_grid_n && P.crash_retry.mask_side < P.mask_side);
let missing = null; try { await detect({ classify: async () => [] }); } catch (e) { missing = e; }
check('pipeline: a model layer without segmentPoints rejects', missing instanceof Error);

console.log(failures ? `autoseg-selftest: ${failures} check(s) FAILED` : 'autoseg-selftest: all checks passed');
process.exit(failures ? 1 : 0);
