# SPEC-T-004: Evaluation engine

Task: T-004 · Goal(s): G-2, G-4 · Status tracked in `control/plan.json` (not here)

## Problem

Every phase gate is a claim about accuracy on the locked test set. Without one engine that turns
ground truth plus predictions into numbers, each gate would compute its own, and pooled error
("PMAE") would hide that a few large meals dominate. Nothing yet defines matching, the interval
score or the confidence interval.

## Outcome

`node eval/run.mjs --manifest <path> --predictions <path>` prints a compact summary and can write
one JSON report holding every metric plus the 95% CI upper bounds the gates read.

## Scope

- In: matching, per-sample metrics, cluster bootstrap, CLI, hand-computed selftest.
- Out (explicitly): ground-truth nutrients (T-005 supplies them through the `truthNutrients`
  callback), running any pipeline, recognition top-k naming accuracy (T-010), the gate thresholds.

## Design

- Inputs: a bench manifest and a predictions file (schema id macrofy.predictions/1: pipeline name and
  version, meals with items carrying label, grams, optional lo80 and hi80, kcal, protein_g, carbs_g, fat_g).
  Both are validated; invalid input throws. The manifest is checked with `validateManifest` (plus the lock when given).
- Matching, per meal: labels compared after trim and lower-casing; a repeated label pairs greedily by
  smallest gram difference. Unmatched truth is an omission (pred 0 g); unmatched prediction an
  intrusion. A meal with no prediction entry is all omissions.
- Item metrics (truth-anchored, omissions included): APE = |pred-true|/true. True mass under 10 g is
  scored in absolute grams only (in MAE, coverage) and excluded from APE; its count is reported.
- Meal metrics: meal kcal is the sum of item kcal. A meal is scored for a nutrient only if every truth
  item has truth values and every predicted item has that field; exclusions are counted.
- Reported: MAPE, median APE, signed bias (mean of (pred-true)/true), share within 10/20/30% (APE <= bound),
  MAE grams and kcal, macro MAE per meal, Bland-Altman on meal kcal (sample SD, limits mean +/- 1.96 SD),
  80% interval coverage (lo80 <= true <= hi80, matched items only) and mean width.
- `bootstrapCI(values, clusterKeys, {stat, resamples=2000, seed})`: resamples capture days (calendar date
  of `captured_at` as written) with replacement; percentile 2.5 and 97.5 by linear interpolation;
  PRNG mulberry32. The upper bound of |bias| is the 97.5th percentile of the resampled |bias|.
- `gates` in the report: upper 95% bounds of meal-kcal MAPE, item-mass MAPE and |bias| (meal kcal and item mass),
  plus the point coverage.
- Code: `eval/metrics.mjs` (pure), `eval/run.mjs` (CLI), `eval/selftest.mjs`.

## Acceptance

- A1 (`eval-selftest`): every metric equals a hand-computed value (arithmetic in the fixture comments,
  tolerance 1e-9); resampling is provably by day (resample outcomes are whole-day combinations; the CI
  widens against per-meal resampling); the seed makes it reproducible; each asserted value is perturbed
  to prove the assertion fails; invalid input and the CLI are exercised end to end.

## Risks and open questions

- Gate reading of "|bias|" is ambiguous (meal kcal or item mass): both upper bounds are reported.
- Bootstrapping few days gives a coarse, optimistic CI; the gates should require enough test days.
