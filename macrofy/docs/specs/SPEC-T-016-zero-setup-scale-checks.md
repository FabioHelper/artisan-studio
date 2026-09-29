# SPEC-T-016: Zero setup and scale checks

Task: T-016 · Goal(s): G-2, G-4, G-5 · Status tracked in `control/plan.json` (not here)

## Problem

The owner's words (ADR 0006): "I simply point my camera at the food and it comes up with its details
and macros. No ruler, no manual work. The only comparison I'll do is weigh on a real scale and check
a calorie app afterwards." The app still opens on "Pesar refeição", nags about plate registration and
never learns from a weighing.

## Outcome

- Home opens on "Apontar para o prato": camera, automatic analysis (T-014), result. No plate,
  ruler or tap is required; plate scale is the typical-plate prior and its wider uncertainty stays in the ranges.
- Plate registration, manual taps, oil, weighed-meal linking and the old "Pesar refeição" flow live under "Ajustes / Corrigir".
- On the result, optional "Conferir com balança": grams per item or one plate total, plus an optional
  `other_app_kcal` (comparison only, never truth). Each check is stored in IndexedDB with the estimate it belongs to.
- The result says "Não calibrado" until checks exist, then "Calibrado com N conferências".
- "Precisão" scores the checks with the evaluation engine and exports them as JSON.

## Design

- `web/estimate/calibration.mjs` (pure, import-free; the browser runs a copy): `learn(checks, params)`,
  `buildCheck`, `checksToBench`, `applyRanges`, `otherAppComparison`.
  - Global factor: exp(n/(n+k) x mean ln(truth/raw)), the geometric mean of truth/predicted shrunk toward 1.
  - Group factor once a group has N item checks: pooled toward the global one, exp(L + w (m_g - L)), w = n_g/(n_g+k).
  - Conformal 80%: with at least M checks, q is the ceil((n+1) x 0.8)-th smallest |ln(truth/shown)|; range = shown x exp(-+q).
    Shown grams are what the app displayed before the truth was known, so the residuals are out of sample.
  - Before M checks the model-based ranges stay; with zero checks every factor is 1.
- `web/estimate/priors.json` `calibration`: `shrinkage_k`, `group_min_checks` (N), `conformal_min_checks` (M); all assumptions.
- Checks learn from `raw_grams` (before any factor) so corrections never compound. A total-only check
  contributes to the global factor and to meal-level ranges, and to kcal in the bench (truth split in
  proportion to the shown grams); it never feeds item mass metrics or group factors.
- `web/app/accuracy.mjs` ("Precisão"): checks to a macrofy.bench/1 manifest plus predictions, then
  `evaluate` from a copy of `eval/metrics.mjs` (bootstrap by capture day). "precisa de mais conferências" under 5.
  The kcal truth comes from the nutrition lookup on the scale grams (oil in proportion to the shown oil).
- `web/sync-data.mjs` also copies the calibration module and the evaluation engine; the drift check covers them.

## Acceptance

- A1, `calibration-selftest`: hand-computed shrunk global and group factors, conformal quantile, zero-check
  fallback (typical plate, wider ranges), checks to manifest and predictions to `evaluate`, negative checks.
- A2, `estimator-selftest`: the pure no-plate walk, a check changing the calibration state, and source
  assertions on the default path. `web/estimate/smoke.mjs` walks it in a browser (manual, mocked models).
- A3, manual: the owner on the iPhone 16e.

## Risks and open questions

- N, M and k are assumptions (`calibrate_from` the checks themselves); a check with items of one
  plate shares one scale error, so residuals within a check are correlated and ranges may be slightly narrow.
- A learned factor absorbs plate-size error; registering a plate later shifts the truth it learned from.
- The same photo checked twice counts once in the bench (newest wins).
