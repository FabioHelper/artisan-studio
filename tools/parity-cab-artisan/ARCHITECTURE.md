# Monolith→Modular Pipeline Architecture

> **Two skills, one pipeline.** This document maps how `modularize-monolith` (extraction) and `parity-cab` (verification) work together.

## System Overview

```
modularize-monolith (EXTRACTION)          parity-cab (VERIFICATION)
────────────────────────────────          ─────────────────────────
P0: Recon                                 S01: Inventory (per side)
P1: Deterministic Index                   S02: Classify
P1.5: Coverage Scan ──────────────────→   S09: coverage-scan.cjs
P2: RFC Draft                             S03: Diff
P2.5: Singleton Scan ─────────────────→   S08: singleton-scan.cjs
P3: CAB Gate (human approval)             S04: RFC-Gen
P4: Chunked Extraction (LLM writes code)  S05: CAB Gate (GO/NO-GO)
P5: Zero-Trust Verify (V1-V7)            S06: Behavior Trace (harness gen)
P5.5: Coverage Gate ──────────────────→   S10: coverage-gate.cjs
P6: Cutover/Rollback                      S07: Trace Diff (behavioral)
```

### Cross-skill dependency

Scripts 08-10 live in parity-cab but are **invoked by modularize-monolith** during extraction phases:

| Script | Extraction Phase | Verification Stage |
|---|---|---|
| `08-singleton-scan.cjs` | P2.5 | (pre-extraction check) |
| `09-coverage-scan.cjs` | P1.5 | (pre-extraction coverage) |
| `10-coverage-gate.cjs` | P5.5 | (pre-cutover gate) |

## Script Inventory

### Structural Parity (Stages 1-5)
| Script | Input | Output | Purpose |
|---|---|---|---|
| `01-inventory.cjs` | source files + `--side` | `.parity/inventory.{side}.sij.json` | Symbol enumeration |
| `02-classify.cjs` | inventory JSON | `.parity/inventory.{side}.tagged.json` | Domain/risk/volatility tagging |
| `03-diff.cjs` | both tagged inventories | `.parity/parity-report.sij.json` | Joint symbol diff |
| `04-rfc-gen.cjs` | parity report | `.parity/rfcs/RFC-NNNN-*.md` | Per-gap RFC stubs |
| `05-cab-gate.cjs` | RFCs + dispositions | `.parity/cab-verdict.json` | GO/NO-GO verdict |
| `run-all.cjs` | - | (chains 01→05) | Convenience runner |

### Behavioral Parity (Stages 6-7)
| Script | Input | Output | Purpose |
|---|---|---|---|
| `06-behavior-trace.cjs` | `parity.config.json` | HTML harness files | Generates browser harnesses with instrumentation |
| `07-trace-diff.cjs` | two trace JSONs | `.parity/trace-diff.sij.json` | Behavioral comparison (18 sections) |

### Extraction-Phase Tools (invoked by modularize-monolith)
| Script | Input | Output | Purpose |
|---|---|---|---|
| `08-singleton-scan.cjs` | modular source tree | `singleton-lifetime-report.sij.json` | Detect singleton lifetime bugs |
| `09-coverage-scan.cjs` | monolith + modular | `.parity/coverage-inventory.sij.json` | Deep coverage (closures, bus.emit, innerHTML) |
| `10-coverage-gate.cjs` | coverage inventory + RFCs | `.parity/coverage-verdict.json` | Block cutover on undispositioned orphans |
| `bulk-disposition.cjs` | RFC directory | (updates RFC frontmatter) | Bulk disposition changes |

### Shared Libraries (`lib/`)
| File | Type | Purpose |
|---|---|---|
| `heuristics.cjs` | Node CJS | Risk/domain/volatility classifiers |
| `parse.cjs` | Node CJS | Symbol parser (regex + optional Babel) |
| `sij.cjs` | Node CJS | SIJ read/write, config loader, CLI arg parser |
| `trace-recorder.js` | Browser IIFE | Runtime instrumentation (injected into harness HTML) |

## Capture ↔ Diff Coverage Matrix (R7)

> **DIFF_EVERYTHING principle (R7):** Every field captured by trace-recorder.js MUST have a corresponding diff function in 07-trace-diff.cjs. Uncovered fields are bugs.

| trace-recorder captures | 07-trace-diff section | Added in |
|---|---|---|
| `three_version` | `three_version` | v1 |
| `entities[]` | `entities` | v1 |
| `lights_initial[]` (intensity) | `initial_lights` | v1 |
| `lights_initial[]` (position, type) | `light_positions` | R7 |
| `materials[]` | `materials` | R7 |
| `gpu_telemetry` | `gpu_telemetry` | R7 |
| `entities[].descendant_count` | `entity_metadata` | R7 |
| `scene_census` | `scene_census` | R7 |
| `renderer_config` | `renderer_config` | R7 |
| `scene_config` | `scene_config` | R7 |
| `settings_scrub[]` (lights, renderer) | `settings_scrub` | v1 |
| `settings_scrub[].lights[].position` | `settings_light_positions` | R7 |
| `audio_scrub` | `audio_category_names` | v1 |
| `audio_ready` | `audio_functional` | v1 |
| `remount_stress` | `remount_stress` | RFC-008 App D |
| `bus_events` | `bus_events` | v1 |
| `hud` (buttons, panels) | `hud` | v1 |
| `hud` (canvas_size, titles) | `hud_deep` | R7 |

## Configuration

All scripts read `parity.config.json` from the project root:

```json
{
  "project": "<id>",
  "monolith": { "root": "<path>", "kind": "single-file|directory" },
  "modular":  { "root": "<path>", "kind": "directory" },
  "out_dir":  "./.parity",
  "thresholds": { "parity_score_min": 0.85, "max_high_open": 0 },
  "artifact_system_sink": "http://localhost:4201/api/parity-trace"
}
```

## Version History

See [CHANGELOG.md](CHANGELOG.md).
