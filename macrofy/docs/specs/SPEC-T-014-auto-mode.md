# SPEC-T-014: Automatic mode (zero taps by default)

Task: T-014 · Goal(s): G-2, G-3, G-5 · Status tracked in `control/plan.json` (not here)

## Problem

The T-013 flow needs a rim tap and one tap per food. Goal G-5 allows at most one confirmation tap
for a typical plate. Design and rationale: [ADR 0005](../decisions/0005-automatic-plate-and-food-detection.md).

## Outcome

Photo in, one prefilled confirmation screen out: the plate and each food outlined, top-1 names,
grams, an 80% range and macros. Taps are only for corrections: rename, remove, merge, split, add a
missed item by tap (the existing tap flow). "Modo manual" keeps the whole tap flow.

## Scope

- In: pure mask post-processing, a batched multi-point SAM decode, the auto flow and confirmation
  screen, timings saved with each estimate, oil multipliers moved into priors.
- Out: tuning thresholds (owner phone and benchmark), the OWL-ViT fallback of the ADR (only if the
  grid is too slow), depth, conformal ranges (T-008).

## Design

- `web/estimate/autoseg.mjs` is pure (masks are `{width, height, data}` plus a predicted `score`).
  It has `gridPoints`, `maskIoU`, `dedupe`, `ellipseResidual` (1 minus the IoU between a mask and its
  moment-fitted ellipse), `selectPlate`, `filterFoods`, `resolveOverlaps`, `mergeSameLabel`,
  `rejectNonFood`, `plateSetup` and `detectAuto`, which composes them over an injected model object.
- Plate: the largest mask that covers the image centre, has a low ellipse residual and is not
  near-whole-image. None found: since T-017 the foods are still found and the typical-plate scale is used, said on screen (SPEC-T-017 follow-up); `no_plate` remains only with `fallback: false`.
  A plate with no food left after the filters is `empty_plate`: the app offers add-by-tap.
- Foods: a denser grid inside the plate ellipse, then dedupe, area and predicted-IoU filters,
  overlap resolution, SigLIP naming over the food names plus non-food labels, non-food rejection,
  then merging of adjacent fragments that got the same top-1 name.
- Every threshold is in `web/estimate/priors.json` under `autoseg`, each an assumption with a
  one-line rationale. The oil multipliers moved there as `oil_levels`.
- Plate scale: the last used registered plate, else the only registered plate, else the "prato
  típico" prior (`typical_plate`) whose wider scale uncertainty widens every range. The user can
  change the plate on the confirmation screen.
- `web/lib/models.mjs` gains `segmentPoints`: one prompt per point in batches, reusing the image
  embedding, with a time budget and a progress callback; it falls back to one prompt per decode if
  batched prompts are refused. Version fallback 4.3.0 then 3.8.1 is unchanged. Memory (F-005): SlimSAM q8 first, then SAM 2.1 tiny
  q8/fp16, never fp32; on iOS one model is resident at a time (SAM, then SigLIP once SAM is freed; a correction tap reloads SAM).
- The estimate in progress is saved as a draft in IndexedDB, so a tab that Safari killed or reloaded resumes instead of restarting.
- Each saved estimate records `mode` and `timings` (encoder ms, decode count and ms, naming ms,
  total ms, whether the budget ran out), which is what A2 needs.

## Acceptance

- A1, check `autoseg-selftest`: synthetic scenes (tilted plate on a table, three foods, one split
  into two fragments, a fork-shaped strip, noise masks) with one fixture per rule, negative checks
  proving each assertion bites, and the no-plate and empty-plate cases.
- A2, manual (owner, 10 plates on the iPhone 16e): not covered by code.
- Also: `web/selftest.mjs` covers the new files and the batched decode against a fake library;
  `web/estimate/smoke.mjs` walks the auto flow and the manual flow with a mocked model layer.

## Risks and open questions

- The batched prompt shape for SAM 2.1 in transformers.js is unverified in the build sandbox; the
  per-prompt fallback keeps it working, only slower.
- Thresholds are guesses. Under-segmentation (two foods in one mask) is corrected with the split tap.
- Merging trusts the top-1 name; two different foods with the same name would be merged.
