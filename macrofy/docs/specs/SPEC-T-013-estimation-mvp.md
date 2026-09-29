# SPEC-T-013: Estimation MVP in the PWA (uncalibrated)

Task: T-013 · Goal(s): G-2, G-3, G-4, G-5 · Status tracked in `control/plan.json` (not here)

## Problem

The capture app only records weighed meals. Nothing yet turns a photo into grams and macros, so
the eval engine has no pipeline to score and the owner cannot feel the end-to-end flow on the phone.

## Outcome

On the home screen, "Estimar" walks the owner through: photo, registered plate, one tap on the
plate rim (scale), one tap per food (outline), confirm the name from the top 3 (or search), one
oil question, then a result card with grams, an 80% range and kcal/protein/carbs/fat per item and
in total, badged "Não calibrado — estimativa inicial". It saves the estimate (optionally linked to
a weighed meal by id) and exports macrofy.predictions/1 for the eval engine.

## Scope

- In: the pure core, priors, models loader, the estimate screens, IndexedDB store, export.
- Out (explicitly): depth, multi-photo fusion, conformal ranges (T-008), fitting calibration
  factors (needs weighed meals), any training (ADR 0003), native app (ADR 0004).

## Design

- Core, `web/estimate/core.mjs` (no imports; the browser copy is `web/app/vendor/estimate-core.mjs`):
  - Ellipse from a binary plate mask by second moments: semi-axes `a >= b` are `2*sqrt(eigenvalue)`.
    `mm_per_px = diameter_mm / (2a)`, and `cos_tilt` is b divided by a.
  - `area_mm2 = pixels * mm_per_px^2 / cos_tilt`. Assumption: items lie on the plate plane, and
    perspective is ignored (the plate is a planar ellipse, camera far compared with the plate).
  - `volume_ml = area_mm2 * thickness_mm / 1000`; thickness and cv come from `web/estimate/priors.json`.
  - Density per F-004: the vocab density when its kind is `served`; for `pieces` on a solid group
    (grilled meat, fish, egg, fruit, cheese) the `solid_density_g_per_ml` prior; loose foods keep `pieces`.
  - `grams = volume_ml * density * calibration_factor(group)`; the factor is 1.0 until
    `web/estimate/calibration.json` has fitted values. Macros come from `nutrition/lookup-core.mjs` plus oil.
  - Oil: Sem óleo / Pouco / Normal / Muito = 0 / 0.5 / 1 / 2 times the class `default_oil_g_per_100g`.
  - 80% range: `sigma = sqrt(ln(1+cv^2) + ln(1+s^2))`, `lo80 = grams * exp(-1.2816 sigma)`, `hi80 = grams * exp(1.2816 sigma)`,
    s = 5% scale uncertainty (an assumption). T-008 replaces this with conformal calibration.
  - `toPredictions` builds macrofy.predictions/1; labels are the vocab `pt` names, as in the capture app.
- Priors: every number that is not measured (thickness and cv per group, solid density, scale
  uncertainty) carries `assumption: true`, `calibrate_from` and a one-line rationale.
- Models, `web/lib/models.mjs`, shared with the feasibility page: transformers.js from jsdelivr,
  4.3.0 first and 3.8.1 if the import fails; SAM2.1-tiny then SlimSAM; SigLIP 2 then SigLIP;
  WebGPU then WASM. The app takes an injected model object (`window.__macrofyModels`), so tests mock it.
- App: `web/app/estimate.mjs` (screens, wired from `web/app/app.mjs`), store `estimates` in `web/app/db.mjs`.

## Acceptance

- A1, check `estimator-selftest`: hand-computed fixtures (ellipse, area, tilt, volume, grams and
  macros for rice, steak, salad), range formula, oil mapping, export accepted by `validatePredictions`
  and scored by `evaluate`, plus a negative check proving the assertions bite.
- A2, manual: the owner runs one real plate on the iPhone 16e.
- Also: `web/selftest.mjs` covers the new files; a headless smoke, `web/estimate/smoke.mjs`, walks the UI with a mocked model layer (manual run: it needs a browser).

## Risks and open questions

- Model ids and the transformers.js 4.3.0 API are unverified in the build sandbox (no CDN access).
- SAM on a single rim tap may return a rim or a well instead of the whole plate: the mask preview is shown so the owner can retry.
- Priors are guesses; expect large errors until calibrated on weighed meals (F-004 stays open).
