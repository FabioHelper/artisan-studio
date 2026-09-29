# Macrofy architecture (codemap)

A map of where things live and which invariants hold. It names modules and paths, never line
numbers or counts. Update it in the same commit as any change that makes it wrong.

## Product

Not started. Design: [ADR 0002](decisions/0002-geometry-first-food-estimation.md) (amended by [ADR 0004](decisions/0004-pwa-first-on-iphone-16e.md): PWA first on iPhone 16e) and [ADR 0003](decisions/0003-no-model-training.md) (pretrained models only, no training) (see [STATUS.md](STATUS.md));
its modules will be mapped here as they land.

## Mission-control harness (`harness/`)

| Module | Responsibility |
|---|---|
| `harness/mc.mjs` | CLI. The only writer of task status: every mutation appends to the journal, updates `control/plan.json`, re-renders `docs/STATUS.md` |
| `harness/lib/state.mjs` | Loading control files into a snapshot (from disk or an in-memory fixture), journal parsing, status derivation, acceptance hashing, done-evidence rules |
| `harness/lib/gates.mjs` | The gates. Pure functions `snapshot → problems[]`; each problem carries a fix instruction written for an agent |
| `harness/lib/render.mjs` | Deterministic `docs/STATUS.md` and the session brief, including the NEXT-action rule |
| `harness/selftest.mjs` | Negative fixtures: proves each gate fails on broken input and passes on good input |
| `harness/hooks/` | Claude Code adapters (SessionStart, Stop) plus their selftest in a throwaway git repo |

Wiring outside `macrofy/`: hooks are registered in the repo's `.claude/settings.json`, the reviewer
subagent is `.claude/agents/macrofy-reviewer.md`, and CI runs `.github/workflows/macrofy-harness.yml`.

## Invariants

- Task status is derived from `control/journal.jsonl`; `plan.json`'s `status` field is a cache the
  gates compare against the derivation.
- The journal is append-only relative to `HEAD` locally and to the base commit in CI.
- The harness has no dependencies beyond Node built-ins, so every agent and CI can run it.
- Hooks are inert unless the session changed or discussed `macrofy/`.

## Extending the harness

- **New check:** add it to `control/checks.json` (argv array, run from `macrofy/`, exit 0 = pass),
  then reference it from acceptance criteria.
- **New gate:** add a function to `harness/lib/gates.mjs`, register it in `GATES`, and add at
  least one negative fixture to `harness/selftest.mjs` — the selftest fails for any gate that
  has never been observed failing.
- **Another agent tool:** reuse `mc`; only write a thin adapter like `harness/hooks/` if that tool
  has lifecycle hooks.

## Benchmark (`bench/`)

The weighed benchmark is the only judge of accuracy. Procedure: [weighing protocol](runbooks/weighing-protocol.md).

| Module | Responsibility |
|---|---|
| `bench/schema-core.mjs`, `bench/schema.mjs` | Manifest format and the pure `validateManifest` in `schema-core.mjs` (no imports, so the browser runs it too); `schema.mjs` re-exports it and adds the Node sha256 (named rules: types, unique ids and photos, plate references, plausible grams, split by date, near-duplicate leakage, frozen test set, completeness); canonical JSON and the test-set hash |
| `bench/lock.mjs` | CLI that freezes the test split into a lock file; refuses invalid manifests and silent relocks |
| `bench/validate.mjs` | CLI and the checks `bench-validate` / `bench-complete`: runs the negative fixtures, then validates the real manifest and lock |
| `bench/fixtures.mjs` | One known-good manifest plus broken variants, each tagged with the rule it must trip |

Invariants: photos are never in git (a manifest references each by sha256 and perceptual hash);
the test split (its meals and the plates they reference) is frozen by the hash of its canonical
JSON, required for a complete benchmark, and never edited without an explicit, recorded relock; a date belongs to one split only; a rule with no failing fixture fails the run.

## Evaluation (`eval/`)

The one place accuracy numbers are computed; every phase gate reads its report. Spec:
[SPEC-T-004](specs/SPEC-T-004-evaluation-engine.md).

| Module | Responsibility |
|---|---|
| `eval/metrics.mjs` | Pure functions: prediction-file validation, per-meal item matching, per-sample metrics (MAPE, median APE, signed bias, within bands, MAE, Bland-Altman, 80% interval coverage), `bootstrapCI`, and `evaluate`, which returns the JSON report including the CI upper bounds the gates use |
| `eval/run.mjs` | CLI: manifest and predictions in, compact summary out, full JSON report with `--out` |
| `eval/selftest.mjs` | The check `eval-selftest`: hand-computed fixtures, seeded and by-day bootstrap proofs, perturbation checks that the assertions bite, the CLI end to end |

Invariants: errors are per sample, never pooled; the bootstrap resamples capture days (the date of
captured_at as written, the same notion of a day the split-by-date rule uses), seeded, so a report is
reproducible; items under 10 g are scored in grams only; ground-truth nutrients arrive through a
callback (the nutrition module, T-005), and kcal or macro metrics are null rather than zero without
it; the manifest is validated (and the test lock verified when given) before anything is scored.

## Nutrition (`nutrition/`)

Turns a food label and grams into kcal and macros, and millilitres into grams. Spec:
[SPEC-T-005](specs/SPEC-T-005-nutrition-mapping.md).

| Module | Responsibility |
|---|---|
| `nutrition/vocab.json` | The food classes (schema macrofy.vocab/1): pt and en names, facets state, method and default oil, nutrients per 100 g with their source row, density with its FNDDS portion. Generated, never edited by hand |
| `nutrition/sources.json` | Every bundled data source with version, URL, retrieval date, license, attribution and commercial-use flag |
| `nutrition/data/` | Only the TACO and FNDDS rows the classes use, each extract with origin, hashes and license in its metadata |
| `nutrition/tools/class_spec.mjs` | The human-authored class-to-row mapping; contains no nutrient or density numbers |
| `nutrition/tools/build_vocab.mjs` | Reads the spec and the extracts, writes the vocab and sources files; `nutrition/tools/extract_sources.mjs` rebuilds the extracts from raw downloads |
| `nutrition/lookup-core.mjs` | The pure lookup (`createLookup`: `nutrientsFor`, `massFromVolume`, the `truthNutrients` adapter for `evaluate()` in `eval/metrics.mjs`), with no Node imports so the browser runs it too |
| `nutrition/lookup.mjs` | Node wrapper: loads the real vocab and re-exports the lookup functions |
| `nutrition/validate.mjs` | The check `nutrition-map-validate`: negative fixtures per rule, lookup arithmetic, then the real vocab and sources |

Invariants: every nutrient and density is copied or derived from a bundled source row (the validator
compares them to the extracts), never typed; every bundled source is commercially usable (true or
with-citation), which excludes TBCA; nutrients of a recipe are computed from its ingredient classes;
a density is an FNDDS cup portion in grams divided by 236.6 mL and states whether the FNDDS food is
the same (`exact`) or the closest available (`analog`); a rule with no failing fixture fails the run.

## Web (`web/`)

Static site published to GitHub Pages by the workflow `macrofy-pages.yml`; no build step, plain ES
modules. It becomes the Macrofy PWA (ADR 0004). Today it holds the on-phone feasibility test, the capture app and the estimation flow built on it.
Specs: [SPEC-T-012](specs/SPEC-T-012-browser-feasibility.md), [SPEC-T-013](specs/SPEC-T-013-estimation-mvp.md), [SPEC-T-014](specs/SPEC-T-014-auto-mode.md), [SPEC-T-015](specs/SPEC-T-015-fit-models-in-safari.md), [SPEC-T-016](specs/SPEC-T-016-zero-setup-scale-checks.md); owner procedure:
[feasibility-test](runbooks/feasibility-test.md).

| Module | Responsibility |
|---|---|
| `web/index.html` | Landing page linking to the tools |
| `web/feasibility/index.html`, `web/feasibility/run.mjs` | pt-BR page and browser runner: one stage per page load (the page reloads between stages so earlier models are freed); the unit is one attempt (model, device, dtype): each is marked tried and saved before it starts, a tab killed by Safari is recorded as that one crashed attempt and the next page load continues the SAME stage with the next untried attempt (F-006); WebGPU then WASM; times load, cached load and inference; records `navigator.storage` quota, usage and persisted before each stage and, on a failure, the error name, message and the file being fetched (T-015); saves progress to localStorage |
| `web/feasibility/candidates.mjs` | Stages (segmentation, naming, then depth, informational); the depth candidates live here, the segmentation and naming candidates and the transformers.js versions come from `web/lib/models.mjs` |
| `web/feasibility/verdict.mjs` | Pure verdict (go = segmentation and naming loaded and summed median inference at most 2 s; depth is informational) and result JSON with the storage and failure diagnostics, plus the per-attempt crash-resume helpers (attempt plan, tried set, crash record); importable from Node |
| `web/app/` (`index.html`, `app.mjs`, `lib.mjs`, `db.mjs`, `sw.js`, `manifest.webmanifest`) | The pt-BR PWA shell. Home is "Apontar para o prato" (camera, then the automatic estimate: zero setup, [ADR 0006](decisions/0006-zero-setup-and-scale-checks.md)); "Ajustes / Corrigir" holds the optional tools: the plate registry, weighed-meal entry (the T-011 capture flow, [spec](specs/SPEC-T-011-capture-app.md)) and the macrofy.bench/1 manifest export. IndexedDB stores plates, meals, photos, estimates, checks and settings; `lib.mjs` is the pure, Node-testable logic (dHash, split, manifest, pt-BR problems), tested by `capture/selftest.mjs` |
| `web/app/accuracy.mjs` | The "Precisão" screen (T-016): builds the checks into a manifest plus predictions and scores them with a copy of the evaluation engine (kcal and item mass MAPE and bias with 95% CIs by capture day, interval coverage, the other-app comparison), and exports the checks as JSON through the share sheet |
| `web/sync-data.mjs` | Copies the shared sources (`nutrition/vocab.json`, `bench/schema-core.mjs`, `nutrition/lookup-core.mjs`, the estimation core, priors and calibration, the calibration module, the evaluation engine (its schema import renamed to the vendored core), the model loader, and the model probe once the workflow has produced it) into `web/app/` (Pages serves only `web/`); `--check` and `web/selftest.mjs` fail on a stale copy |
| `web/selftest.mjs` | The check `web-selftest`: files, syntax, pinned CDN versions and their fallback, candidates, the model layer against a fake library, simulated crash sequences (every attempt once, no loop), vision-only naming and text-embedding provenance, the CI tool and workflow, verdict fixtures, app files, service worker shell, copy drift |
| `tools/build-text-embeddings.mjs` | CI tool ([SPEC-T-015](specs/SPEC-T-015-fit-models-in-safari.md)): probes every candidate of `web/lib/models.mjs` on the Hugging Face API (commit sha, ONNX files with sizes), and loads the text tower of each naming candidate in Node (transformers.js 4.3.0 in a temp dir) to embed the vocab names, so the phone needs only the image tower |
| `.github/workflows/macrofy-models.yml` | Runs that tool on a runner with internet (manual dispatch, or a push to main touching the vocab, the model layer or the workflow), runs the web selftest and commits only the files it wrote: the model probe (in `web/lib/` and its copy in `web/app/data/`) and one text-embedding JSON per naming model in a text-emb folder of the app data; then starts the Pages workflow, because a push by the workflow token triggers nothing. These generated files do not exist until the first run; the app and the page treat their absence as "embeddings missing/stale" and keep the default candidate order |

Invariants: the transformers.js URL carries an exact version (4.3.0, then 3.8.1 if the import fails); model ids are tried in order and the
result records which loaded and why others failed; verdict logic lives only in `verdict.mjs`;
each stage runs in its own page load and models are disposed after use (F-005: the iPhone 16e killed the tab when SAM loaded on top of the depth model);
an attempt (model, device, dtype) runs at most once across page loads and a stage ends only when every attempt was tried (F-006);
naming never loads a text tower in the browser, and the text embeddings are only ever produced by the CI tool, never guessed at runtime.

## Estimation (`web/estimate/`)

Photo to grams, macros and an 80% range, with no setup: the plate scale is the typical-plate prior until scale checks calibrate it. Specs: [SPEC-T-013](specs/SPEC-T-013-estimation-mvp.md) (maths, manual flow), [SPEC-T-014](specs/SPEC-T-014-auto-mode.md) (automatic mode), [SPEC-T-016](specs/SPEC-T-016-zero-setup-scale-checks.md) (zero setup, scale checks).

| Module | Responsibility |
|---|---|
| `web/estimate/core.mjs` | Pure, import-free maths: ellipse fit from a plate mask (second moments), mm per pixel and tilt, item area, volume, F-004 solid-aware density, calibration factor, oil levels, lognormal 80% range (scale error counted twice), plate totals combined in log space (independent thickness, shared scale), name prompts, and `toPredictions` (macrofy.predictions/1) |
| `web/estimate/autoseg.mjs` | Pure automatic plate and food detection ([SPEC-T-014](specs/SPEC-T-014-auto-mode.md)): grid prompts, IoU dedupe, ellipse residual and plate selection, food area filters, overlap resolution, same-label fragment merge, non-food rejection, the plate scale prior, and `detectAuto` over an injected model; the browser runs a copy with its core import renamed by `web/sync-data.mjs` |
| `web/estimate/priors.json` | The only invented numbers: thickness and cv per food group, the solid density, the scale uncertainty, the oil multipliers, the typical plate and its wider scale uncertainty, every automatic-mode threshold (`autoseg`) and the calibration priors (`calibration`: shrinkage, the minimum checks for a group factor and for conformal ranges); each labelled as an assumption with a rationale and what to calibrate it from |
| `web/estimate/calibration.mjs` | Pure, import-free learning from scale checks (T-016): a shrunk global grams factor (geometric mean of truth over raw grams), per-group factors once a group has enough checks, split-conformal 80% ranges from the log residuals once there are enough checks, the state label ("Não calibrado", "Calibrado com N conferências"), `buildCheck`, the checks to macrofy.bench/1 manifest and predictions conversion, the other-app comparison and the accuracy report over an injected `evaluate` |
| `web/estimate/calibration.json` | Shipped per-group grams factors; empty means 1.0. Learned factors from the checks replace it as soon as one check exists |
| `web/estimate/selftest.mjs` | The check `estimator-selftest`: hand-computed fixtures, range, oil, export accepted and scored by the evaluation engine, the pure no-plate walk with a scale check that changes the calibration state, source assertions on the zero-setup default path, negative checks |
| `web/estimate/calibration-selftest.mjs` | The check `calibration-selftest`: hand-computed shrunk global and group factors, the conformal quantile, the zero-check fallback (typical plate, wider ranges), checks to manifest and predictions scored by `evaluate`, the other-app comparison, negative checks |
| `web/estimate/autoseg-selftest.mjs` | The check `autoseg-selftest`: synthetic scenes, one fixture per rule, negative checks, the no-plate and empty-plate cases |
| `web/estimate/smoke.mjs` | Headless browser walk with a mocked model layer (manual run; needs a browser): the zero-setup flow (no plate registered, no taps, a scale check that changes the calibration state, the accuracy screen, the export, conformal ranges after ten checks), the automatic flow's corrections under "Ajustes / Corrigir" (reload resume, plate choice, no-plate fallback) and the manual flow |
| `web/lib/models.mjs` | Shared model layer (app and feasibility page): transformers.js import with version fallback, SlimSAM q8 then SAM2.1-tiny q8/fp16 (never fp32), vision-only naming (T-015: CLIP ViT-B/32, SigLIP, SigLIP 2 image towers scored against precomputed text embeddings whose model id, revision and labels hash are checked against the vocab; missing or stale means "embeddings missing/stale", never a guess), candidate order by real size from the probe when it exists, WebGPU then WASM, progress and the fetching-file tracker, one model resident at a time on iOS (`sequential`), the batched multi-point SAM decode `segmentPoints`, the injectable model object |
| `web/app/estimate.mjs` | The pt-BR estimate screens: the automatic flow ending in one result screen (corrections, the plate choice, oil and the weighed-meal link sit under "Ajustes / Corrigir"), "Conferir com balança" (stores each check in the `checks` IndexedDB store, linked to the saved estimate), the manual tap flow, and the saved-estimates list with the predictions export; stores in the `estimates` store, keeps the estimate in progress as a draft so a reloaded tab resumes; applies the learned state to the displayed grams and ranges |

Invariants: the core has no imports (the browser runs a copy synced by `web/sync-data.mjs`); the
app takes its models from `window.__macrofyModels` when present, so tests mock the model layer;
every estimate is labelled with its calibration state ("Não calibrado" until a scale check exists) and carries the pipeline name and version; export labels
are the vocab `pt` names; the shipped priors are assumptions, and the ranges are the model's until enough scale checks give conformal ones.
Scale checks are the only source of accuracy claims: they store the raw (uncorrected) grams next to the shown grams and the weighed truth, learning uses the raw
grams so a correction never compounds, and an other-app kcal is comparison only and is never learned from. No plate, ruler or tap is required anywhere in the default flow.
