# SPEC-T-003: Benchmark tooling

Task: T-003 · Goal(s): G-2, G-4 · Status tracked in `control/plan.json` (not here)

## Problem

Accuracy is judged only on a weighed benchmark the owner collects alone (300 meals, 150
calibration + 150 locked test, split by capture date). Nothing yet defines the data format, stops
leakage between the splits, or stops the test set being quietly edited after models have seen it.

## Outcome

The owner (and later the capture PWA, T-011) can produce a manifest that a validator accepts or
rejects with a fix hint per problem; the test split can be frozen by hash; the weighing protocol is
written down.

## Scope

- In: manifest format, pure validator, lock CLI, validate CLI with negative fixtures, weighing runbook.
- Out (explicitly): the evaluator (T-004), the capture PWA (T-011), storing photos (never in git).

## Design

- `bench/schema.mjs`: manifest format (schema id macrofy.bench/1) and pure `validateManifest`, returning
  `[{rule, msg, fix}]`. Rules: schema-types, unique-ids, unique-photos, plate-ref, plausible-grams,
  split-by-date (split decided by the ISO date as written in `captured_at`, which must carry a UTC
  offset), near-duplicate-leakage (phash Hamming distance <= 6 across splits), frozen-test-set
  (sha256 of canonical JSON of the test meals sorted by id plus the plates they reference sorted by
  id must equal the lock; plates are included because photo scale comes from plate diameters,
  ADR 0004), completeness (only when meals/weeks are required; then a lock is required too).
- `bench/lock.mjs`: writes the lock from the manifest; refuses an invalid manifest, and an existing
  lock unless `--relock --reason "..."` (reminds to record `mc note`).
- `bench/fixtures.mjs`: one known-good manifest plus broken variants, each tagged with the rule it must trip.
- `bench/validate.mjs`: runs the fixtures (the good one must pass, every rule must fail on at least
  one broken fixture, lock CLI end to end), then validates the real manifest and lock.
  `--require-meals N --min-weeks W` is the `bench-complete` check.
- `docs/runbooks/weighing-protocol.md`: the owner's procedure.

## Acceptance

- A1 (`bench-validate`): leakage (same meal, near-duplicate photo, shared calendar date across
  splits), edited test set after lock, and malformed weights each fail a named negative fixture;
  the run fails if any rule was never observed failing.

## Decisions from review

- The lock covers the test meals and the plates they reference: editing such a plate after locking
  fails frozen-test-set; editing a plate only calibration meals use does not.
- In completeness mode (`bench-complete`) a missing lock fails frozen-test-set; without it, a
  missing lock only prints a warning.

## Risks and open questions

- None open. Anything needing the owner becomes `mc block … --owner-question`.
