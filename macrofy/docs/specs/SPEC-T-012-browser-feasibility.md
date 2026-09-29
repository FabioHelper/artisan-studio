# SPEC-T-012: Browser feasibility of the pretrained models on the iPhone 16e

Task: T-012 · Goal(s): G-3, G-5 · Status tracked in `control/plan.json` (not here)

## Problem

The whole plan ([ADR 0004](../decisions/0004-pwa-first-on-iphone-16e.md)) assumes Depth Anything
V2-Small, SAM 2.1-tiny and SigLIP 2 run in Safari on the owner's iPhone 16e. Nothing has shown it.
Safari exposes no JS memory API, so we record download size and whether the tab survived instead.

## Outcome

The owner opens one hosted URL on the phone, taps one button, waits, taps "Copiar resultados" and
pastes a JSON into the chat. From it we read a go/no-go against at most 2 s summed median inference.

## Scope

- In: static page in Portuguese; per stage, candidate model ids tried in order; WebGPU first
  then WASM; first and cached load time, download bytes, median of 3 inferences; progress saved
  to localStorage so a killed tab is reported and the run resumes; GitHub Pages deploy; owner runbook.
- Out (explicitly): the real pipeline, accuracy, PWA manifest or service worker, any build step.

## Design

- `web/feasibility/candidates.mjs`: pinned transformers.js URL, stages, candidate ids, labels.
- `web/feasibility/verdict.mjs`: pure `computeVerdict` / `buildResults` (schema name macrofy.feasibility, version 1).
- `web/feasibility/run.mjs` + `web/feasibility/index.html`: the browser runner and UI.
- `.github/workflows/macrofy-pages.yml`: publishes `macrofy/web`; URL
  https://fabiohelper.github.io/artisan-studio/feasibility/
- Model ids were not verifiable from the build sandbox; `failed_attempts` in the JSON says why a
  candidate did not load.

## Acceptance

- A1 (manual): the owner's phone results, reviewed independently. Text is locked in the plan.
- A2: check `web-selftest` runs `web/selftest.mjs`: files exist, modules parse, CDN version pinned,
  candidate lists non-empty, verdict logic correct on fixtures.

## Risks and open questions

- The candidate model ids and transformers.js support for SAM 2.1 are unverified; the fallbacks
  exist for that. A no-go caused by a bad id is a finding to retry, not a product verdict.
- The first run may not be a true cold download if the browser already cached the files.
