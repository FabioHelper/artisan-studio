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
