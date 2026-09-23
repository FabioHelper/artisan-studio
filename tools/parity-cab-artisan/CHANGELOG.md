# Changelog
 
All notable changes to the parity-cab pipeline are documented here.

## [R8] — 2026-09-20

### Added — Runtime Adapter Contract (SPEC-16)
- **Generic `mode: "html"`**: Added zero-transpile general Three.js execution path. Directly reads entry HTML, injects recorder script and runtime configuration before all downstream scripts/importmaps, and serves static files from side directory.
- **Template-Driven Harness Builder**: Refactored `06-behavior-trace.cjs` to parameterize `buildHarness(cfg, side, recorderJs, project, sinkUrl)` for `mode: "html"`, `mode: "eval-jsx"`, and `mode: "module"`. All vendor pins, imports, and mount points now config-driven.
- **Decoupled Runtime Seams in `trace-recorder.js`**:
  - `ready.global` and `ready.timeout_ms` dynamically resolved from `__PARITY_RUNTIME`.
  - Configurable application globals (`matpool`, `audio`, `bus`) with graceful no-op degradations.
  - Configurable `hud_probes` array replacing hardcoded panel checks.
  - Configurable `settings_presets` with explicit `{ skipped: true }` recording when absent.
- **S3 Megazord Golden Baseline Verification**:
  Proved byte-identical output across absent runtime and explicit Megazord reference runtime (`examples/megazord.runtime.config.jsonc`):
  - `MONOLITH SHA256: 66aa6e002143006dbc0293252eae9a7f9cae66580b489f2874f507b54660b912`
  - `MODULAR  SHA256: d86b50932a9a9ece4e9d80f2c4d27bb059a10febfed32db60ad00f7d85777d43`
- **Generic Fixture (`examples/demo-three/`)**:
  Two lightweight Three.js apps (`a/index.html`, `b/index.html`) demonstrating zero-dep execution with three planted regressions caught by Stages 13, 14, and 15.
- **Offline Selftest**: `node scripts/06-behavior-trace.cjs --selftest` (exit 0) validating all three modes, `<head>` injection ordering, bad-mode exception handling, and S3 hash invariance.

## [R7] — 2026-05-24

### Root Cause Analysis (RC1-RC4)

Four systemic root causes identified for behavioral blind spots:
- **RC1**: Capture-Diff Asymmetry — trace-recorder captured 14 fields that trace-diff never compared
- **RC2**: Observable Config Gap — no mechanism to verify literal value preservation during LLM extraction
- **RC3**: Environment Blind Spot — trace only saw tagged entities, not infrastructure meshes
- **RC4**: Renderer Config Blind Spot — toneMapping, fog, shadowMap never captured

### Added — 07-trace-diff.cjs

9 new diff functions closing 14 blind spots:

- `diffLightFull()` — compares light positions + types (not just intensity). Closes B1, B2.
- `diffMaterials()` — compares material arrays with per-param comparison. Closes B6, C1.
- `diffGpuTelemetry()` — compares GPU totals (tris, calls, lines, geos, matpool). Closes B7, B8.
- `diffEntityMeta()` — compares descendant_count per matched entity. Closes B3.
- `diffSceneCensus()` — compares non-entity mesh/line/sprite counts by group. Closes RC3.
- `diffRendererConfig()` — compares toneMapping, shadowMap, outputColorSpace. Closes RC4.
- `diffSceneConfig()` — compares fog type/density/color, background color. Closes RC4.
- `diffHudDeep()` — compares canvas_size + button title set. Closes B10, B12.
- `diffSettingsPositions()` — compares per-preset light positions. Closes B13.

Total sections in trace-diff: 9 (v1) → 18 (R7).

### Added — trace-recorder.js

3 new capture sections:

- `scene_census` — per-group mesh/line/sprite/points count for non-entity objects
- `renderer_config` — toneMapping, toneMappingExposure, outputColorSpace, shadowMap, pixelRatio
- `scene_config` — fog type/density/color, background color

### Added — Documentation

- `ARCHITECTURE.md` — system-level architecture covering both skills, all scripts, data flow
- `CHANGELOG.md` — this file

### Principle — DIFF_EVERYTHING

New rule: every field captured by trace-recorder MUST have a corresponding diff in 07-trace-diff.cjs. Uncovered fields are bugs, not features.

---

## [R6] — 2026-05-22

### Added — trace-recorder.js
- `captureGpuTelemetry()` — triangle/geometry/material/matpool census + per-object-type breakdown + sharing analysis

### Added — 07-trace-diff.cjs
- `diffRemountStress()` — RFC-008 Appendix D dynamic singleton lifetime check

---

## [v1] — 2026-05-19

Initial release. 10 scripts (01-10) + trace-recorder + trace-diff.
9 diff sections: three_version, entities, initial_lights, settings_scrub, audio_category_names, audio_functional, bus_events, hud, remount_stress.
