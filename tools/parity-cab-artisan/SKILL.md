---
name: parity-cab
description: Deterministic monolith→modular cutover auditor with RFC/CAB gates. Use when validating that a refactor preserved every public symbol from the original code; when finalizing a Strangler Fig cutover; when you need a zero/low-trust GO/NO-GO before flipping a feature flag or merging a "modularization" PR. Output is SIJ-compliant JSON + Markdown RFCs the LLM reads, not raw source. Token cost: ~3k for a 3000-LOC audit (vs ~30k reading file-by-file).
---

# parity-cab — Monolith→Modular Cutover Auditor

## Philosophy

**Code does the work; LLM reads the verdict.** Five `.cjs` scripts walk the codebase locally and emit SIJ-compliant JSON. The LLM never reads source files during the audit — only the rolled-up reports.

**Zero/low-trust by default.** Nothing is "accepted" implicitly:
- Every divergence ≥ MED risk produces an RFC stub for human/LLM review.
- CAB gate refuses GO if: `tsc` fails, parity score < threshold, or unresolved HIGH RFCs exist.
- Scripts NEVER delete, NEVER auto-correct. They *propose* — disposition is a manual decision.

**Conservative-reformist.** A missing symbol is loud (HIGH). A new symbol is suspicious (MED). A divergent signature is escalated (HIGH). A renamed/moved symbol with same semantics is OK *if* manually annotated.

**SIJ compliance.** All JSON outputs carry `{ schema_version, generated_at, entity_id_strategy, entities: [...] }`. `entity_id` is stable (`file::symbol`), so re-runs are diffable.

## When to use

- Closing a Strangler Fig cutover (e.g., monolith.jsx → dist/ modules).
- Before flipping a feature flag from monolith→modular at runtime.
- Quarterly drift audits on long-running modularizations.
- Cross-checking that a "refactor" PR didn't drop public API surface.

**Do NOT use** for greenfield code (nothing to compare against), API-level breaking change detection between versions of a *published* package (use `api-extractor` instead), or for behavioral / runtime parity (this is structural only).

## Pipeline

```
┌────────────────┐  ┌────────────────┐  ┌────────────┐  ┌──────────────┐  ┌────────────┐
│ 01-inventory   │→│ 02-classify    │→│ 03-diff    │→│ 04-rfc-gen   │→│ 05-cab-gate│
└────────────────┘  └────────────────┘  └────────────┘  └──────────────┘  └────────────┘
   *.sij.json         *.tagged.json     parity.json    rfcs/*.md         verdict.json
   (per side)         (per side)        (joint)        (per gap)         (final)
```

Each stage is *deterministic*. Re-running with no input change yields byte-identical output.

## Quick start

```bash
# 1) Configure (one-off): write parity.config.json to the project root
{
  "monolith": { "root": "C:/.../megazord_v12_8.jsx.bak", "kind": "single-file" },
  "modular":  { "root": "C:/.../megazord/src",            "kind": "directory" },
  "out_dir":  "C:/.../megazord/.parity",
  "thresholds": { "parity_score_min": 0.85, "max_high_open": 0 }
}

# 2) Run the pipeline
node ~/.claude/skills/parity-cab/scripts/01-inventory.cjs --config parity.config.json --side monolith
node ~/.claude/skills/parity-cab/scripts/01-inventory.cjs --config parity.config.json --side modular
node ~/.claude/skills/parity-cab/scripts/02-classify.cjs --config parity.config.json
node ~/.claude/skills/parity-cab/scripts/03-diff.cjs     --config parity.config.json
node ~/.claude/skills/parity-cab/scripts/04-rfc-gen.cjs  --config parity.config.json
node ~/.claude/skills/parity-cab/scripts/05-cab-gate.cjs --config parity.config.json

# 3) Read the verdict
cat .parity/cab-verdict.json
ls  .parity/rfcs/
```

Or run all five in sequence:

```bash
node ~/.claude/skills/parity-cab/scripts/run-all.cjs --config parity.config.json
```

## Output artifacts (what the LLM reads)

| File | Purpose | Typical size |
|---|---|---|
| `.parity/inventory.monolith.sij.json` | Every exported symbol on the monolith side | ~20 KB |
| `.parity/inventory.modular.sij.json` | Every exported symbol on the modular side | ~40 KB |
| `.parity/parity-report.sij.json` | Joint diff with risk-classified entries | ~10 KB |
| `.parity/rfcs/RFC-NNNN-*.md` | One stub per ≥MED divergence | ~1 KB each |
| `.parity/cab-verdict.json` | GO/NO-GO + checklist | ~2 KB |

**The LLM should read `cab-verdict.json` first, then `parity-report.sij.json` summary, then specific RFCs if NO-GO.**

## Risk classification

| Risk | Trigger | Required action |
|---|---|---|
| HIGH | Monolith symbol missing from modular | RFC + manual disposition. Blocks CAB unless `disposition=intentional_drop` with justification. |
| HIGH | Signature changed in a domain tagged `core`/`scene` | RFC + manual review. Blocks CAB unless `disposition=approved`. |
| MED  | New symbol in modular not present in monolith | RFC stub. CAB warns; doesn't block. |
| MED  | Signature changed in domain tagged `creator`/`audio`/`ui` | RFC stub. CAB warns. |
| LOW  | Pure-additive type/interface; renamed-but-aliased export | Logged in parity-report. No RFC. |

Risk is configurable via `parity.config.json::risk_overrides`.

## SIJ schema cheat sheet

```json
{
  "schema_version": "1.0.0",
  "schema_kind": "parity-cab/inventory",
  "generated_at": "2026-05-19T00:00:00Z",
  "entity_id_strategy": "file_path::symbol_name",
  "side": "monolith|modular",
  "entities": [
    {
      "entity_id": "src/scene/viewport.ts::mountViewport",
      "file": "src/scene/viewport.ts",
      "line": 53,
      "name": "mountViewport",
      "kind": "function|component|class|const|type|interface",
      "exported": true,
      "signature": "function mountViewport(THREE, options)",
      "loc": 224,
      "jsdoc": { "stability": "STABLE", "description": "..." },
      "tags": { "domain": "scene", "risk": "low", "volatility": "STABLE" }
    }
  ]
}
```

## CAB gate verdict shape

```json
{
  "decision": "GO|NO-GO|GO-WITH-WARNINGS",
  "parity_score": 0.94,
  "checks": {
    "tsc_clean":        { "status": "pass", "details": "0 errors" },
    "parity_threshold": { "status": "pass", "expected": 0.85, "actual": 0.94 },
    "high_rfcs_open":   { "status": "pass", "count": 0 },
    "med_rfcs_open":    { "status": "warn", "count": 3 }
  },
  "next_steps": ["Review .parity/rfcs/RFC-0003-*.md before merge"]
}
```

## RFC disposition workflow

Each RFC stub has a YAML front-matter slot for the human/LLM verdict:

```yaml
---
disposition: pending   # → approved | intentional_drop | regression_to_fix | intentional_rename | rejected
reviewer: <name>
reviewed_at: <ISO>
notes: <free text>
---
```

Re-running `05-cab-gate.cjs` re-reads the dispositions and recomputes the verdict. RFCs with `pending` block GO.

### Disposition policy (industrial — non-negotiable)

> **Cross-skill rule.** Same policy lives in `~/.claude/skills/modularize-monolith/SKILL.md` as `<disposition_policy_rule v1.0>`. Both skills enforce it because both produce dispositioned RFCs.

1. **`intentional_drop` requires explicit user sign-off** in the session transcript (chat: "OK drop X", "yes drop these", or equivalent). Agent never marks visible surfaces as drop unilaterally.
2. **Default disposition for any user-facing surface** (HUD elements, telemetry log strings, panels, buttons, banners, runtime emits) = `regression_to_fix`. Bias toward closing the gap, not hiding it.
3. **Bulk RFCs split on disposition divergence.** If 19 items share a frontmatter and one item's disposition flips, split the RFC so each disposition is auditable per-item.
4. **Reverts require audit trail.** When changing disposition, add `reverted_from: <previous>` + `reverted_at: <ISO>` to frontmatter. The `notes` field must cite evidence (user message, screenshot, test failure).
5. **(v1.1, 2026-05-27)** Modular code that introduces NEW logic (`new_blocks` in AST X-Ray vocabulary) which mutates SHARED RUNTIME STATE is `regression_to_fix` by default. Shared runtime state = `THREE.Light.intensity`, `THREE.Material.*` props, `THREE.Scene.*` props, `THREE.Camera.*` props, `THREE.WebGLRenderer.*` settings, singletons (audio, MatPool, brain), global event listeners, top-level RAF callbacks. **Modularize ≠ improve.** Code that subjectively "looks better" than the monolith is STILL a regression if it diverges. Improvement is a separate phase AFTER 100% parity is signed off.

**Why this rule exists:** on 2026-05-22 we discovered 25 items had been silently marked `intentional_drop` by the agent on 2026-05-20 with smart-sounding justifications ("marketing self-promotion banner", "future consumer can subscribe to bus.emit"). The CAB gate reported PASS. Reality: PROF profiler panel missing, NPC FSM dormant, multiple boot banners gone, several telemetry emit lines not in modular. The user caught it only via side-by-side screenshots. Agent judgment is an unreliable check on what counts as "intentional".

## Operational rules

1. **Idempotent.** Running twice with no change yields no diff. CI-safe.
2. **Side-effect-free.** Writes only inside `out_dir`. NEVER touches source.
3. **No deps beyond Node built-ins.** Optional: `@babel/parser` if found in the project's `node_modules` for higher-fidelity JSX parsing; falls back to regex parser.
4. **Windows-native paths.** All path handling uses `path.posix` internally; `\` is normalized on input.
5. **Streaming.** Inventories stream-write so 30k-LOC files don't OOM.
6. **Stable IDs.** `entity_id` is path+name; renames produce a missing+new pair (which RFC-gen reconciles via alias rules).

## Extending

- Add a custom risk rule: edit `parity.config.json::risk_overrides`.
- Add a domain tagger: extend `scripts/lib/heuristics.cjs::DOMAIN_RULES`.
- Add a new check to CAB gate: edit `scripts/05-cab-gate.cjs::CHECKS`.

## Limitations

- Structural parity only — does not detect behavioral regressions (use a separate test suite OR run Stage 6 below).
- Regex parser misses some advanced TS syntax (computed property names, complex generics in signatures); use the AST fallback for high-fidelity needs.
- No automatic alias resolution across renames. RFC-gen flags them as missing+new; reviewer marks `disposition=intentional_rename` to dismiss.

## What v1 misses — acknowledged from the Megazord cutover (2026-05-19)

The first real-world run shipped a structural `GO`, then the user pushed back. Investigation found these classes of divergence that parity-cab **cannot detect by design**:

1. **Function-body contents.** Both sides have `animate()` with matching signature. Inside, the monolith ran a 4-line keyL flicker (`keyL.intensity = 2.8 + sin(t·1.7)·.18 + …`). The modular version had none. parity-cab compares signatures, not bodies — invisible to it.
2. **Closure-captured state mutations.** `keyL` is created in `buildGuildLights()` and mutated inside `animate()`. Both side-effect sites are inside function bodies and don't appear in the symbol inventory.
3. **Runtime data convention shifts.** Monolith tagged scene entities as `userData.entityId = "<id>"`; modular tags them as `userData.entity = <Entity>`. Both "work" but the shape differs. parity-cab doesn't introspect runtime data shapes.
4. **DOM/UI render output.** parity-cab sees `<ChatPanel/>` is imported and rendered. It can't tell whether the chat panel renders 3 buttons or 7.
5. **Coordination effects.** When the monolith ran 4 distinct per-frame side effects synchronously inside `animate()`, and the modular split this into `atmosphere.tick(t)` + entity loop + (nothing for flicker), parity-cab sees all the modules exist — it can't detect the *missing coordination*.

These gaps required adding **Stage 6 (behavior-trace)** as a complement. See [`scripts/06-behavior-trace.cjs`](scripts/06-behavior-trace.cjs) and [`scripts/07-trace-diff.cjs`](scripts/07-trace-diff.cjs).

## Stage 6 (optional but recommended) — Behavioral trace

For codebases where structural parity is necessary but not sufficient (anything rendering 3D, anything with HUDs, anything with per-frame animation):

### Path A — artifact-system integrated (preferred when artifact-system is running)

If the artifact-system is running on `:4200` / `:4201`, traces POST directly to its server and the tracker UI auto-reveals (no separate localhost sink). Set `"project": "<id>"` in `parity.config.json` (or 06 falls back to `path.basename(modular.root)`).

```bash
# 1) Generate harness HTMLs. 06 probes :4201 — if up, traces POST to
#    /api/parity-trace?project=<id>&side=<X>. Otherwise, falls back to Path B.
node ~/.claude/skills/parity-cab/scripts/06-behavior-trace.cjs --config parity.config.json

# 2) Open both harness URLs in browser tabs. Each auto-scrubs and POSTs.

# 3) Tracker UI appears automatically (Ctrl+T pill; Ctrl+Shift+T workbench).
#    If multiple projects tracked, dropdown lets you switch.

# 4) Diff the captured traces. 07 auto-uploads the diff to artifact-system
#    too (POST /api/parity-trace/diff?project=<id>).
node ~/.claude/skills/parity-cab/scripts/07-trace-diff.cjs --config parity.config.json

# 5) Re-run CAB gate.
node ~/.claude/skills/parity-cab/scripts/05-cab-gate.cjs --config parity.config.json
```

### Path B — standalone localhost sink (when artifact-system is not running)

If artifact-system is not available, `06-behavior-trace.cjs` falls back to starting its own ephemeral sink on `:4203`:

```bash
node ~/.claude/skills/parity-cab/scripts/06-behavior-trace.cjs --config parity.config.json
# Then open http://localhost:4203/harness-monolith.html and harness-modular.html
```

### Agent-agnostic note

The `/api/parity-trace` HTTP endpoint is **agent-agnostic** — any agent that can shell out (Claude Code, GPT Codex, Cursor, Google Antigravity, Gemini CLI) can run the parity-cab scripts and the harnesses will POST traces directly. The artifact-system UI surface (Pill, Tracker panel, Workbench overlay) is incidental — the data flow is plain HTTP JSON.

The harness instrumentation library (`scripts/lib/trace-recorder.js`) captures:
- THREE.js revision (cross-bundle parity check)
- Scene state: entity tree (accepts both `userData.entity` and `userData.entityId` conventions), light intensities, renderer dimensions
- MatPool material allocations (unique-hash count)
- Engine Settings response: scrubs through 3 presets + 5 brightness slider values, captures the scene state after each step
- Audio Mixer response: walks every category, mute/unmute, records the gain values
- Bus event sequence (first 200 events with relative timestamps)
- HUD/DOM snapshot: button count, button titles, panel presence (Brain Explorer, Inspector, AI Director), Settings & Mixer toggles visible, canvas dimensions

The diff (`07-trace-diff.cjs`) reports per-section scores and enforces strict zero-trust thresholds for high-severity issues like:
- THREE version mismatch (strict equality)
- Light count or intensity drift beyond tolerance (0.01 threshold)
- Entity count, position, or scale drift (0.01 threshold)
- Settings scrub: same preset producing different lights/renderer dimensions
- Audio category missing or audio context killed
- HUD shape mismatch (settings button visible on one side but not the other)

## When to require Stage 6

Add Stage 6 to your `cab-gate` thresholds whenever the project:
- Renders 3D or has per-frame animation (any THREE.js / Pixi.js / Phaser app)
- Has a rich HUD or settings panel (multi-panel React studio, video settings, audio mixer)
- Uses closure-captured state across modules
- Was refactored in ways that could shift runtime conventions (e.g., `userData.x` shapes, event payload shapes, animation cadences)

## Runtime adapter contract

Stage 6 and downstream runtime gates (12 pixel diff, 13 scene-graph hash, 14 materials deep, 15 anim series) support any Three.js project via the optional `runtime` block in `parity.config.json`.

### Three Execution Modes (`sides[*].mode`)
- **`"html"` (General Three.js Path)**: Reads the side's entry HTML (`entry_html`), injects the recorder `<script>` and configuration immediately after `<head>` before any other script or importmap, and serves the directory statically. Zero Babel transpile, zero eval, zero vendor pinning required.
- **`"eval-jsx"`**: Single-file monolith evaluation path with Babel transform into a `new Function` closure (Megazord backward-compatible).
- **`"module"`**: ES module entry path driven by importmap and module-scoped singletons (Megazord backward-compatible).

### Readiness Contract Seam
Every instrumented Three.js application must expose:
```javascript
window.__viewport = { scene, renderer, camera };
```
The trace-recorder polls for this object (configured via `runtime.ready.global`, default `__viewport`) within `runtime.ready.timeout_ms` (default `20000`) before capturing scene snapshots, GPU telemetry, and running scrubbers.

For pure data-transformation libraries (parsers, calculators, formatters) Stage 6 adds little; the structural parity from Stages 1-5 is usually enough.

## Stage 12 — Pixel Diff (visual fidelity gate)

For projects that produce visible output (3D, dashboards, configurators, games), Stages 1-7 prove structural + behavioral parity but not visual. Two scenes can render different colors / materials / fog with identical entity counts. Stage 12 closes this gap deterministically.

### When to require Stage 12

- Any Three.js / Pixi / Babylon / Phaser scene rendering
- React/Vue dashboards where visual layout matters
- Configurators or design tools where output fidelity is the product
- Skip for pure logic libs (no canvas → nothing to compare)

### How it works (zero-trust + Principle 9 — hash-verified incremental skip)

1. `parity.config.json::camera_presets[]` defines N viewpoints — name, position, look_at, fov, resolution, ssim_threshold, diff_pct_max.
2. `06-behavior-trace.cjs` injects the presets array as `window.__PIXEL_PRESETS` into both harness HTMLs.
3. `trace-recorder.js::scrubPixelPresets` (runs after scrubRemountStress, before postTrace): for each preset, saves camera state → applies preset → renders → `canvas.toDataURL("image/png")` → restores. Captures stored as `trace.pixel_captures[preset.name] = { dataURL, resolution, size_bytes }`. Both sides POST traces (with captures embedded) to `/api/parity-trace`.
4. `12-pixel-diff.cjs`:
   - Computes `input_fingerprint = sha256(monoDataURLs || modDataURLs || presets || tool_hash)`. If prior verdict has matching fingerprint → noop refresh, exit 0 (~1ms).
   - Else: decodes PNGs (pngjs), runs `pixelmatch` (per-pixel diff) + inline SSIM (Rec.709 luminance), writes verdict + 3 PNGs per preset (`<preset>-monolith.png`, `<preset>-modular.png`, `<preset>-diff.png`).
   - Per-preset decision: `pass` if SSIM ≥ threshold AND diff_pct ≤ max ; `warn` if within 0.03 SSIM / 1.5× diff ; `fail` otherwise.
   - Exit code: 1 only on actual visual divergence after compare. Exit 0 on `pass`, `warn`, `skipped` (no presets), `needs_recapture` (no captures yet).

### Output

`<out_dir>/pixel-diff.sij.json` (provenance-embedded: `tool_hash`, `input_fingerprint`, `host_env_fingerprint`, `command_reproducer`, per-PNG sha256).

```json
{
  "schema_kind": "parity-cab/pixel-diff",
  "input_fingerprint": "<sha256>",
  "summary": { "decision": "pass|warn|fail|needs_recapture|skipped", "ssim_min": 0.987, "ssim_mean": 0.99, "diff_pct_max": 0.4, "presets_compared": 6 },
  "per_preset": [...],
  "cross_pillar_joins": [{ "from": "pixel-diff", "to": ["camera_state", "scene_config", "renderer_config", "materials"], "explanation": "..." }]
}
```

### Quick start

```bash
# 1) Add camera_presets[] to parity.config.json (see SPEC-12-PIXEL-DIFF.md).
# 2) Install per-project deps (one-time):
npm i -D pixelmatch pngjs

# 3) Run trace (recorder captures pixels into trace.pixel_captures):
node ~/.claude/skills/parity-cab/scripts/06-behavior-trace.cjs --config parity.config.json
# Open both harness URLs; each auto-captures presets + POSTs trace.

# 4) Run pixel-diff:
node ~/.claude/skills/parity-cab/scripts/12-pixel-diff.cjs --config parity.config.json

# 5) Read verdict:
cat .parity/pixel-diff.sij.json | jq '.summary'
ls .parity/pixels/  # per-preset PNGs (monolith / modular / diff)
```

### Cross-pillar joins

When `pixel-diff` FAILs on preset X, the verdict's `cross_pillar_joins` field tells the agent the inspection order: `camera_state` (was the preset applied correctly?) → `scene_config` (fog/background drift) → `renderer_config` (tone mapping / color space) → `materials` (PBR drift). Eliminates manual "where do I look?" debugging.

### Spec

Full design rationale, capabilities, integration map, dependencies, risks, regression test: see `~/.claude/skills/parity-cab/SPEC-12-PIXEL-DIFF.md`.
