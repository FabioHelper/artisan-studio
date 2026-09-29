# SPEC-T-011: Capture PWA for the weighed-meal benchmark

Task: T-011 · Goal(s): G-2, G-5 · Status tracked in `control/plan.json` (not here)

## Problem

The owner must weigh and photograph 300 meals over 8+ weeks on an iPhone 16e (Safari, no Mac).
Hand-writing the manifest JSON is error-prone and nobody will do it daily. The same app shell later
hosts estimation (T-013).

## Outcome

Installed to the home screen, the owner registers plates, records a weighed meal (photos with
angle and lighting, items with grams, leftovers, notes) and exports a manifest that the benchmark
validator accepts. Photos stay on the phone; only sha256 and perceptual hash leave it.

## Scope

- In: pt-BR PWA at `web/app/` (home with "Pesar refeição" and a disabled "Estimar (em breve)"),
  plate registry, meal entry, IndexedDB storage plus `navigator.storage.persist()`, add-to-home-screen
  banner, export via share sheet or download, offline app shell, weighing-protocol runbook update.
- Out: estimation, editing a saved meal (delete and re-enter), photo export, cloud sync, any build step.

## Design

- `web/app/lib.mjs`: pure, Node-testable: dHash over a pixel array, sha256 hex, local ISO datetime
  with offset, ISO-week split, manifest builder, pt-BR problem messages, vocab search.
- `web/app/db.mjs`: IndexedDB stores for plates, meals, photo blobs, one draft and settings.
- `web/app/app.mjs` and `web/app/index.html`: hash-routed UI, no framework.
- `web/app/sw.js` and `web/app/manifest.webmanifest`: offline shell (network first, cache fallback).
- Validation reuses the benchmark rules: the pure core `bench/schema-core.mjs` (no Node imports;
  `bench/schema.mjs` adds the Node hashing and re-exports it, behaviour unchanged). `web/sync-data.mjs`
  copies it and `nutrition/vocab.json` into `web/app/`; `web/selftest.mjs` fails on a stale copy.
- Split: ISO week number of the local capture date, odd is calibration, even is test. A date lies in
  one week, so a date is never in both splits. Shown read-only.
- Photo angle tags map to `angle_deg`: Topo is 90, 45 is 45, Natural is 30.

## Acceptance

- A1: check `capture-selftest` (`capture/selftest.mjs`) builds a sample export through the app's
  pure module and requires zero problems from the benchmark validator; it also tests dHash, split
  parity, offsets and the pt-BR messages.
- A2 (manual, owner): one real meal captured and exported on the iPhone.

## Risks and open questions

- iOS may evict storage of non-installed web apps; mitigated by the banner and persist(), but the
  owner should export regularly.
- Item labels use the vocab `pt` names; T-013 predictions must use the same strings to be matched.
- Photo files are not exported, so the evaluator only sees hashes until the owner decides how to ship them.
