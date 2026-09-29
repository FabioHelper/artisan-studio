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
Specs: [SPEC-T-012](specs/SPEC-T-012-browser-feasibility.md), [SPEC-T-013](specs/SPEC-T-013-estimation-mvp.md), [SPEC-T-014](specs/SPEC-T-014-auto-mode.md); owner procedure:
[feasibility-test](runbooks/feasibility-test.md).

| Module | Responsibility |
|---|---|
| `web/index.html` | Landing page linking to the tools |
| `web/feasibility/index.html`, `web/feasibility/run.mjs` | pt-BR page and browser runner: one stage per page load (the page reloads between stages so earlier models are freed), candidates tried in order, a tab killed by Safari is recorded as a crashed candidate and the run resumes with the next candidate of the same stage; WebGPU then WASM, times load, cached load and inference, saves progress to localStorage |
| `web/feasibility/candidates.mjs` | Stages (segmentation, naming, then depth, informational) and labels; the depth candidates live here, the segmentation and naming candidates and the transformers.js versions come from `web/lib/models.mjs` |
| `web/feasibility/verdict.mjs` | Pure verdict (go = segmentation and naming loaded and summed median inference at most 2 s; depth is informational) and result JSON, plus the crash-recovery helpers; importable from Node |
| `web/app/` (`index.html`, `app.mjs`, `lib.mjs`, `db.mjs`, `sw.js`, `manifest.webmanifest`) | Capture app (T-011, [spec](specs/SPEC-T-011-capture-app.md)): pt-BR PWA shell with plate registry, weighed-meal entry, IndexedDB storage and export in the macrofy.bench/1 manifest format; `lib.mjs` is the pure, Node-testable logic (dHash, split, manifest, pt-BR problems), tested by `capture/selftest.mjs` |
| `web/sync-data.mjs` | Copies the shared sources (`nutrition/vocab.json`, `bench/schema-core.mjs`, `nutrition/lookup-core.mjs`, the estimation core, priors and calibration, the model loader) into `web/app/` (Pages serves only `web/`); `--check` and `web/selftest.mjs` fail on a stale copy |
| `web/selftest.mjs` | The check `web-selftest`: files, syntax, pinned CDN versions and their fallback, candidates, the model layer against a fake library, verdict fixtures, app files, service worker shell, copy drift |

Invariants: the transformers.js URL carries an exact version (4.3.0, then 3.8.1 if the import fails); model ids are tried in order and the
result records which loaded and why others failed; verdict logic lives only in `verdict.mjs`;
each stage runs in its own page load and models are disposed after use (F-005: the iPhone 16e killed the tab when SAM loaded on top of the depth model).

## Estimation (`web/estimate/`)

Photo to grams, macros and an 80% range, uncalibrated. Specs: [SPEC-T-013](specs/SPEC-T-013-estimation-mvp.md) (maths, manual flow), [SPEC-T-014](specs/SPEC-T-014-auto-mode.md) (automatic mode).

| Module | Responsibility |
|---|---|
| `web/estimate/core.mjs` | Pure, import-free maths: ellipse fit from a plate mask (second moments), mm per pixel and tilt, item area, volume, F-004 solid-aware density, calibration factor, oil levels, lognormal 80% range (scale error counted twice), plate totals combined in log space (independent thickness, shared scale), name prompts, and `toPredictions` (macrofy.predictions/1) |
| `web/estimate/autoseg.mjs` | Pure automatic plate and food detection ([SPEC-T-014](specs/SPEC-T-014-auto-mode.md)): grid prompts, IoU dedupe, ellipse residual and plate selection, food area filters, overlap resolution, same-label fragment merge, non-food rejection, the plate scale prior, and `detectAuto` over an injected model; the browser runs a copy with its core import renamed by `web/sync-data.mjs` |
| `web/estimate/priors.json` | The only invented numbers: thickness and cv per food group, the solid density, the scale uncertainty, the oil multipliers, the typical plate and its wider scale uncertainty, and every automatic-mode threshold (`autoseg`); each labelled as an assumption with a rationale and what to calibrate it from |
| `web/estimate/calibration.json` | Per-group grams factors fitted later on weighed meals; empty means 1.0 |
| `web/estimate/selftest.mjs` | The check `estimator-selftest`: hand-computed fixtures, range, oil, export accepted and scored by the evaluation engine, negative checks |
| `web/estimate/autoseg-selftest.mjs` | The check `autoseg-selftest`: synthetic scenes, one fixture per rule, negative checks, the no-plate and empty-plate cases |
| `web/estimate/smoke.mjs` | Headless browser walk of the automatic flow (progress, zero taps, corrections, reload resume, unknown plate, no-plate fallback) and of the manual flow with a mocked model layer (manual run; needs a browser) |
| `web/lib/models.mjs` | Shared model layer (app and feasibility page): transformers.js import with version fallback, SlimSAM q8 then SAM2.1-tiny q8/fp16 (smallest first, never fp32), SigLIP 2 then SigLIP, WebGPU then WASM, progress, one model resident at a time on iOS (`sequential`), the batched multi-point SAM decode `segmentPoints` on the cached image embedding (time budget, progress, per-prompt fallback), the injectable model object |
| `web/app/estimate.mjs` | The pt-BR estimate screens (automatic flow with one confirmation screen, manual tap flow) and the saved-estimates list with the predictions export; stores in the `estimates` IndexedDB store, keeps the estimate in progress as a draft so a reloaded tab resumes |

Invariants: the core has no imports (the browser runs a copy synced by `web/sync-data.mjs`); the
app takes its models from `window.__macrofyModels` when present, so tests mock the model layer;
every estimate is labelled uncalibrated and carries the pipeline name and version; export labels
are the vocab `pt` names; the shipped priors are assumptions until T-008 replaces the range with
conformal calibration.
