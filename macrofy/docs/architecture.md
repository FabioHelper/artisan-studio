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
| `bench/schema.mjs` | Manifest format and the pure `validateManifest` (named rules: types, unique ids and photos, plate references, plausible grams, split by date, near-duplicate leakage, frozen test set, completeness); canonical JSON and the test-set hash |
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
