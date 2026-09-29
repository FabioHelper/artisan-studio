# SPEC-T-017: Real-model contract

Task: T-017 · Goal(s): G-1, G-5 · Status tracked in `control/plan.json` (not here) · Finding: F-008

## Problem

On the owner's iPhone 16e, with the real models, SAM 2.1 tiny failed in auto mode and in the manual rim tap:
"failed to call OrtRun(). Got invalid dimensions for input: input_points ... index: 1 Got: 4 Expected: 1".
The grid decode sent 4 prompt groups in one run, but the model fixes that dimension to 1. Every test used
mocked models (the sandbox cannot reach Hugging Face), so the real tensor contract was never checked.

## Outcome

- The app decodes one prompt group per decoder run and loops the grid points; the image embedding is still computed once per photo.
- The real ONNX input/output contract of every model file the app can load is recorded in CI and committed.
- Our hand-built tensors are checked against that contract by a local test, so this class of bug fails
  in `web/selftest.mjs`, not on the phone. The real pipeline also runs in CI on a test photo.

## Scope

- In: prompt tensor building and decode in the model layer, contract recording, the local contract test, the real-pipeline CI job.
- Out: new models, accuracy tuning, timing (per-point decodes are slower than one batch would be; the time budget still applies).

## Design

- `web/lib/models.mjs`: pure functions on plain `{ name, type, dims, data }` specs: `samPromptTensors` (one group, rank taken
  from the contract), `checkTensorSpecs` (name, type, rank, fixed dimensions), `checkSamDecoder`, `checkNamingVision`, `scaleSamPoint`.
  `createModels` decodes each point with them; a failing decode is an error (no silent fallback, which hid F-008).
- `tools/probe-contracts.mjs` (run by the models workflow): downloads every .onnx the backends can load (SAM encoder and decoder,
  the naming image towers, depth), reads the graph inputs and outputs with a small protobuf reader (works without the external weight
  files), cross-checks the names with onnxruntime-node where the file is self-contained, and writes the model-contracts file in
  `web/lib/`: per file `{ path, inputs: [{ name, type, dims }], outputs }`, symbolic dimensions as strings.
- `web/lib/model-contracts.fixture.json`: hand-written stand-in for SAM 2.1 tiny's `input_points` (dimension 1 fixed to 1), used only
  until the real file exists, and always for the negative fixture.
- `tools/model-integration-test.mjs` (run by macrofy-model-it): transformers.js 4.3.0 in a temp dir, our `createModels` through the
  injectable importer, CPU q8, a test plate photo built in code; single tap, grid, auto mode and naming for SlimSAM, SAM 2.1 tiny, CLIP B/32.
- Auto mode on SAM 2.1 tiny found no plate in the first CI run (SlimSAM did). Hypothesis, to be confirmed by the plate table the CI summary now
  prints: the best-scoring mask is the plate without its food, whose ellipse residual fails. The plate is now judged with its holes filled, the plate
  grid keeps all three masks per point, and the food filter drops the plate itself. The CI test asserts plate and food on a synthetic and a real photo.
- Workflows: only macrofy-models commits (probe, contracts, embeddings). macrofy-model-it is read-only. A red selftest there still
  commits the probe and contracts (the evidence) but not the embeddings, then fails the job.

## Follow-up: real photos and the iPhone (2026-09-29)

Owner's iPhone, real meal (blue plate on a patterned cloth): auto mode found no plate and fell back to the rim tap (not zero setup),
and a reload landed on `#/estimate/resume`, which re-ran the same analysis and Safari killed the tab repeatedly (crash loop).

- Plate variants (`web/estimate/autoseg.mjs`): a mask is also judged with its holes filled (the plate without its food), as the
  region a table-sized mask encloses (`via: 'hole'`) and as the convex hull of a rim ring (`via: 'ring'`: the ring must reach
  `plate_ring_min_arc` of the way around and keep `plate_ring_min_band` of its pixels in the rim band, so a placemat cross is not a ring).
- No plate is not a failure and never asks for a tap: foods come from a grid over the photo centre, the plate is a circle around
  them (`syntheticPlate`), the scale is the typical plate with the wider `no_plate_scale_uncertainty`, and the result says
  "prato não detectado — escala aproximada".
- Memory: auto mode reads masks straight from SAM's low-res logits at `mask_side` (`lowResMask` in `web/lib/models.mjs`) instead of
  the library's full-photo float upsampling per decode; the chosen plate and foods are resized to the photo.
- Crash guard (`web/app/estimate.mjs`): the analysis writes its stage to localStorage; a mark found at page load means the tab died,
  so the resume shows what happened and offers a lighter retry (`crash_retry` in priors) instead of re-running. The resume URL is
  left before anything heavy runs. A "Diagnóstico" panel (copyable JSON: device, models, timings, plate candidates, last crash)
  is on the analysis, error and result screens.
- Plate choice by consensus: the first real-model run with these variants (7465909) chose a 0.78-0.88 band of table (its hull passed the ring test)
  over the 0.43 plate that ~30 grid prompts returned, because the largest passing mask won; every weight would have come out about half. The plate is
  now the passing mask most others agree with (`plate_support_iou`), the largest only on a tie, judged on the raw grid (no dedupe: repeats are the evidence).
  The integration test requires the chosen plate on the synthetic photo to be within 20% of the drawn plate's area.
- One model per page on the iPhone: the owner's second run (gallery photo) found the plate and 4 foods, then the tab died at "dando nome aos
  alimentos (0/4)": loading the naming model after SAM in the same page. The feasibility run that worked (run 3) loaded one model per page. With
  sequential models (iOS) `detectAuto({ split: true })` stops before naming, the app stores the plate and kept masks (mask_side) in the draft and
  reloads into `#/estimate/name`, where `finishAuto` names them with only the naming model loaded (`models.loadNaming`). A death in the naming page
  offers to name again without re-running SAM; a correction tap loads SAM only then. Desktop keeps the one-page flow.
- Naming page on the CPU first: the owner's third run got through the SAM page and the reload, then died loading the naming model on WebGPU in
  the fresh page (GPU memory from the SAM page likely not yet given back). The naming page now follows priors `naming_page_plans`, one backend plan
  per attempt: the CPU (CLIP image tower q4, then q8; 224 px input) first, WebGPU q4f16 on the retry. The retry reloads into a fresh naming page
  (the crash-card page may hold SAM, warmed up by the home screen), and the crash card names the backends that died. CI loads the naming page's
  first plan (`naming_page` stage).
- First full result on the phone (fries and rice): the CPU naming plan (q4 first) died; the WebGPU retry in a fresh tab worked. So the plans are
  now WebGPU q4f16 first, CPU q8 second; the SAM page destroys its WebGPU device before the reload (`models.releaseAll`); and the naming page KEEPS
  its URL while the model loads, so Safari's own reload after a death comes back to it and goes on with the next plan by itself (bounded by the
  number of plans; then the crash card). The result named fries "arroz branco": the text vectors were the average of a Portuguese and an English
  prompt, and CLIP/SigLIP were trained on English captions. The vectors now come from English prompts only ("a photo of {en}, a type of food.";
  non-food labels from priors `non_food_labels_en`); the app still looks them up by its Portuguese prompt strings. Measuring naming accuracy stays T-010.
- Diagnóstico: every food-grid mask with the reason it is or is not an item (`food_candidates`: kept k, duplicate, plate, rim, low_score,
  too_small, too_large, off_plate, background, overlap, over_max) and the naming model's top 3 plus the best non-food label per kept mask.
- CI: the integration test runs auto mode in the same low-res mask space, checks low-res vs full-size masks of one tap (IoU >= 0.9),
  and requires >= 1 food on the pinned Commons photo (`tools/it-photo.json`); a stand-in plate there is a warning.

## Acceptance

- A1, `web-selftest`: tensors for a single tap and for a grid of N points (N runs) match the recorded names, ranks and fixed
  dimensions (fixture until the real file exists, then the real file, failing on any mismatch); the F-008 shape is rejected by a negative fixture;
  a contract-enforcing decoder runs `createModels`; the protobuf reader and the integration script run against fakes.
- A2, manual: a macrofy-model-it run on the fixing commit passes (URL in a journal note).
- A3, manual: the owner on the iPhone 16e gets a result for a real plate.

## Risks and open questions

- Until the models workflow first runs, only the fixture backs the check; SlimSAM, naming and depth contracts are unverified until then.
- The manual rim tap sent a single prompt group already, so its failure is not explained by F-008 alone; the CI single-tap decode
  on the real model will show whether something else is wrong.
- A CPU q8 run proves the shapes, not WebGPU behaviour: only the owner's phone proves that.
