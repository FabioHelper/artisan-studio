# parity-cab — QUICKSTART (drive the harness on any project)

**The goal is MODULARIZATION** — turning a monolith into faithful, *working* modules.
parity-cab is the **verification companion** to that primary act (the decomposition
itself is the `modularize-monolith` skill). It proves a split was faithful at three
levels, in order of what is verified today:
1. **Structural parity** — symbols + AST + coverage survived the split (the deterministic
   gates below). Necessary, but **NOT sufficient.**
2. **Scaffold / wiring** — the modular app's module paths + import chains resolve so it
   actually boots (`05b-scaffold-check`, from the first N=2 test — see `HARDENING-PLAN.md`).
3. **Runtime** — behavior / scene-graph / anim / pixel parity, when a browser is available.

Scripts do the brute mechanical work; the LLM only **dispositions** the findings.
Agent-agnostic: any LLM that runs shell + Node can drive it.

> ⚠️ **`GO · parity=1.0` ≠ "the app works."** It means the symbols matched. A real N=2
> test passed structural parity while the app was broken (wrong module path + `window.onload`
> timing). Always run the scaffold check + the runtime checklist before declaring victory.

> **New here / testing the harness?** Do it on the SAFE SANDBOX, not on real
> projects: `examples/demo/` (see its README). It has planted divergences so you
> can confirm the harness works. **Do not point the runtime gates at someone's
> real project unless they ask** — the source gates are read-only and safe.

---

## 0. Requirements
- **Node.js** (v18+). That's it for the SOURCE gates.
- **ast-grep** (`sg`) on PATH for the JSX gate (C5): `npm i -g @ast-grep/cli`.
  If absent, that one gate SKIPs gracefully — nothing else breaks.
- The RUNTIME gates (scene-graph / anim / pixel / behavior) additionally need a
  browser + the project's own harness setup; they are NOT required to use the
  source gates.
- *Optional:* `ripgrep` (`rg`) / `fd` can speed **manual ground-truthing** (grepping the
  modular tree for a missing label/symbol during disposition). Install via your own
  package manager if you like — the harness does **not** require or auto-install them,
  and none of the gates use them.

## 1. Point it at a project — `parity.config.json`
Drop a `parity.config.json` in the project root:

```json
{
  "project": "myapp",
  "monolith": { "root": "./original.jsx", "kind": "single-file" },
  "modular":  { "root": "./src",          "kind": "directory" },
  "out_dir":  "./.parity",
  "thresholds": { "parity_score_min": 0.85, "max_high_open": 0 }
}
```
- `monolith.root`: the original (a single file OR a directory).
- `modular.root`: the modularized tree.
- `out_dir`: where verdicts are written (`*.sij.json`).

### Standalone vs. artifact-system integration (optional)
The harness is **portable and standalone by default** — no server required. The runtime
gates can *optionally* talk to a running artifact-system UI; all of it is config-driven
(no hardcoded hosts), so omit these fields entirely for a clean external run:

| Field | Default | Meaning |
|---|---|---|
| `runtime` | *(optional)* | Custom adapter contract configuring `ready`, `globals`, `vendor`, and `sides` modes (`"html"`, `"eval-jsx"`, `"module"`). |
| `artifact_system_enabled` | `"auto"` | `"auto"`/`true`: gates 06/07/12 probe the UI, use it if reachable, else fall back to local files. **`false` = fully standalone** — never opens a socket. |
| `artifact_system_base` | `http://localhost:4201` | Server origin (health / sink / artifact / telemetry endpoints derive from it). |
| `artifact_system_sink` | *(unset)* | Opt **in** to mirroring verdicts into the UI's `.parity-traces/`. Unset = no mirroring. A full `/api/parity-trace` URL also overrides the derived sink (back-compat). |
| `local_sink_port` | `4203` | Port for the standalone trace sink 06 serves when the UI is absent. |

> **Trust note:** `parity.config.json` is trusted input at the same level as the source code it audits (both are executed by the test harness).

## 2. Run it
Scripts live in `scripts/`. Two ways:

**A) Per-stage (most portable, no browser):**
```bash
node <harness>/scripts/run-all.cjs        --config parity.config.json   # 01→05 source pipeline + CAB verdict
node <harness>/scripts/09b-jsx-coverage.cjs --config parity.config.json # C5 dynamic-JSX labels
node <harness>/scripts/08-singleton-scan.cjs --config parity.config.json
node <harness>/scripts/11-ast-xray.cjs    --config parity.config.json
```

**B) One command (if the project wires npm scripts):** add to the project's
`package.json` (see `projects/megazord/package.json` for the full set):
```
"gate:all": "... gate:tsc && gate:deps && gate:coverage && gate:xray && gate:jsx && gate:scenegraph && gate:materials && gate:anim && gate:pixel"
```
then `npm run gate:all`. Add `--strict` to any gate to make it exit non-zero on
findings (default is soft/report).

## 3. The stages (what each catches)
| Source gates (no browser, run anywhere) | Catches |
|---|---|
| `01–05` inventory/classify/diff/RFC/CAB | dropped/renamed/changed top-level symbols |
| `05b` scaffold-check | broken module paths / unresolved imports / missing DOM ids — the "GO but app dead" class |
| `08` singleton-scan | singleton-lifetime regressions |
| `09` coverage-scan | closures / innerHTML / bus.emit / useState strings the export-diff misses |
| `09b` jsx-coverage (**ast-grep**) | dynamic-JSX labels (`.map`/ternary/template) — the "85%/70%/55% silently dropped" class |
| `11` ast-xray (+`--strict`) | logic-block drops, extraction defects, high side-effect new blocks |
| `11b/11c/11d` block-diff / remendo-scan / new-block-triage | per-line divergence, net-new side effects, split-FP triage |
| `14` materials-deep | per-mesh PBR drift (needs a captured trace) |

| Runtime gates (need a browser capture first) | Catches |
|---|---|
| `06/07` behavior-trace + diff | entities, lights, audio, settings, bus, remount — 13-section runtime parity |
| `13` scene-graph hash | wrong-mesh / wrong-vertex / wrong-UV (structural, no GPU) |
| `15` anim-series | TIME-VARYING regressions (flicker/easing/accumulators) |
| `12` pixel-diff | SSIM visual parity (GPU-dependent — see note in domain-notes) |

Runtime gates read the LAST capture; produce one with the project's capture
driver (Megazord: `npm run gate:visual:auto`). With no capture they SKIP (exit 0).

## 4. Disposition the findings (the LLM's job)
Every stage emits `<out_dir>/<stage>.sij.json` with findings. Each finding is a
**candidate**, not a verdict — ground-truth it (grep the modular for the missing
thing) and record a disposition (`<stage>.dispositions.json`). A real drop →
restore it via the reconciliation packet (`11b --label <X>`). A refactor-form
difference → disposition it closed. **Never edit the modular `src/` off an
un-ground-truthed finding.**

## 5. Folder layout
```
parity-cab/
├── QUICKSTART.md      ← you are here
├── SKILL.md           ← full agent contract (laws, stage details)
├── scripts/           ← all stages (01–15) + lib/
└── examples/demo/     ← SAFE sandbox: tiny monolith+modular with planted bugs
```
