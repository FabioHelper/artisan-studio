# SPEC-T-015: Fit segmentation and naming in Safari on the iPhone 16e

Task: T-015 · Goal(s): G-3, G-5 · Status tracked in `control/plan.json` (not here)

## Problem

The owner's iPhone 16e run ([device evidence](../../research/device-runs/2026-09-29-iphone16e-feasibility.json))
showed: depth loads (0.9 s); SlimSAM and SAM 2.1 tiny on WebGPU q8 kill the tab; every SigLIP
attempt fails at once with "Load failed" (likely the hundreds of MB of the full model, text tower
included). The resume logic skipped the remaining backends of a crashed model, so the WASM and fp16
paths of SAM were never tried (finding F-006; memory finding F-005).

## Outcome

The feasibility page tries every (model, device, dtype) attempt of a stage once, a killed tab
costs only that attempt, and naming loads only a vision encoder. The next owner run says why a
stage failed (storage quota, failing file URL, error name) instead of a bare "Load failed".

## Scope

- In: per-attempt crash resume; vision-only naming against precomputed text embeddings; a CI job
  that probes the candidates on Hugging Face and builds those embeddings; storage and error
  diagnostics in the results JSON; a smaller naming candidate (CLIP ViT-B/32).
- Out: a no-SAM segmentation fallback (a separate task if the WASM SAM also fails); tuning
  thresholds; the owner's re-run (A2).

## Design

- Crash record: the attempt key is model, device, dtype. State keeps `tried[stage]` (keys) and
  `running`; a tab that died leaves `running` set, so that one attempt is recorded as crashed and
  the next load continues the SAME stage with the next untried attempt. A stage ends only when all
  attempts were tried, so the loop always terminates. Pure helpers: `web/feasibility/verdict.mjs`.
- Naming candidates carry a vision class (`SiglipVisionModel`, `CLIPVisionModelWithProjection`) and
  load the vision-only ONNX file; when the probe file exists they are ordered by vision-file size,
  smallest first (`orderBySize` in `web/lib/models.mjs`).
- Text embeddings: one JSON per naming candidate under the app data folder, with model id,
  revision, dim, prompt templates, `labels_sha256`, the vocab `pt` labels and normalised
  embeddings (the pt prompt averaged with the en prompt), plus the non-food labels of the priors
  for the rejection step. `checkEmbeddings` refuses a file whose model, hash or dimensions do not
  match the vocab: the stage then reports "embeddings missing/stale" and never guesses. `classify`
  scores cosine similarities (softmax, temperature 100), so its callers are unchanged.
- CI: `.github/workflows/macrofy-models.yml` runs `tools/build-text-embeddings.mjs`, which probes
  the Hugging Face API (commit sha, ONNX files and sizes), builds the embeddings on the runner and
  commits only those outputs. They do not exist until the workflow first runs.
- Diagnostics per stage: `navigator.storage.estimate()` and `persisted()` before the stage; on
  failure the error name, message and the file being fetched (from the progress callback).
- Verdict unchanged: depth optional; go = segmentation and naming ok and summed inference at most 2 s.
- `web/sync-data.mjs` publishes the probe and embedding files under the app folder when they exist.

## Acceptance

- A1 (`web-selftest`): simulated crash sequences attempt each (model, device, dtype) exactly once
  and end; naming loads only the vision class and scores against a mocked embedding file whose
  provenance is checked; a stale or missing file is reported, not guessed.
- A2 (manual): the owner re-runs the page on the phone.

## Risks and open questions

- Class and file names of transformers.js are unverified offline; the CI probe confirms them.
- A vision-only file may be absent for a repo: that attempt fails and is recorded.
- If SAM also dies on WASM, a no-SAM fallback needs its own task and owner input.
