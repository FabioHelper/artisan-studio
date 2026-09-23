# SPEC-12-PIXEL-DIFF — Visual fidelity gate (parity-cab Stage 12)

**Status:** DRAFT · awaiting CAB approval (Fabio sign-off)
**Author:** Claude (Opus 4.7) · 2026-05-26
**Origin:** evaluation in artifact-system/STATE.md item #23 + meta-introspection of LLM failure modes (this session, see chat transcript). One of the 4 SOTA gaps identified for parity-cab.
**Companion:** `~/.claude/skills/modularize-monolith/SKILL.md` `<verification_companion>` block — this stage extends it.
**Scope:** parity-cab skill addition only. NO production code changes outside the skill + (1-line) artifact-system body-limit bump.

---

## 0. Goal & non-goals

**Goal.** Add a deterministic visual-fidelity gate that compares monolith vs modular rendered output at a fixed set of camera presets and flags HIGH severity if SSIM < threshold or per-pixel diff exceeds tolerance. Zero LLM in the verification loop — every claim is shell-verifiable + hash-anchored.

**Non-goals.**
- Subjective visual quality ("does it look pretty?") — out of scope.
- Animation timing parity — handled by future Stage 14 (anim-series).
- Performance benchmarking — handled by future Stage 13 (perf-bench).
- Cross-resolution rendering equivalence (we capture at one resolution per preset, project-configured).
- Replacing or rewriting any existing stage.

---

## 1. Capabilities (declared, with graceful fallback)

```xml
<cap name="PIXEL_CAPTURE">
  <purpose>Read RGBA8 pixels of a Three.js canvas after a forced render.</purpose>
  <primary>
    Browser: const dataURL = renderer.domElement.toDataURL("image/png");
    Works on any HTMLCanvasElement that is not tainted (no cross-origin
    textures without crossOrigin attribute). Megazord textures are
    procedural (no external images) → never tainted.
  </primary>
  <fallback id="rtt">
    Browser: render to off-screen WebGLRenderTarget, then
             renderer.readRenderTargetPixels(target, 0, 0, W, H, buf).
    Use when canvas is tainted (host loads external textures) or when
    a different resolution from the main canvas is required.
  </fallback>
  <fallback id="puppeteer">
    Node headless: puppeteer page.screenshot({ clip, type: 'png' }).
    Use when running parity-cab outside any browser-based harness
    (no artifact-system iframe, no localhost sink). NOT shipped in
    Phase 1 — add only when first non-browser project requests it.
  </fallback>
</cap>

<cap name="IMAGE_COMPARE">
  <purpose>Score similarity between two RGBA8 buffers; emit visual diff mask.</purpose>
  <primary>
    Node: pixelmatch (pure JS, no native deps). Returns mismatch pixel
          count + writes diff PNG with red highlights on mismatches.
    Used for: per-pixel diff_pct + visual debug artifact.
  </primary>
  <complement>
    Node: image-ssim (pure JS). Returns SSIM score 0..1.
    Used for: perceptual similarity (more meaningful than pixel-by-pixel
    for anti-aliasing / tonemap jitter).
  </complement>
  <fallback>
    Pure Node MSE (mean squared error) if neither lib installable.
    Less informative — only as last resort.
  </fallback>
</cap>
```

**Cap design follows `<tool_contract>` pattern in modularize-monolith/SKILL.md.** Each cap declares ≥1 primary impl + ≥1 fallback. Skill works on any harness that satisfies one of each.

---

## 2. Architecture choice — piggyback on recorder (NO puppeteer in Phase 1)

The existing pipeline already opens both sides' harness HTMLs in browser (artifact-system iframe via Path A, or localhost:4203 via Path B). The Three.js canvas + scene + renderer + camera all live inside that browser context. Adding pixel capture **as another `scrub*` step in `trace-recorder.js`** reuses 100% of existing plumbing.

**No new dependencies in the harness side.** No puppeteer, no headless Chrome, no extra port. Recorder gains one new function; trace JSON gains one new field.

**Tradeoff.** Captures depend on browser actually opening (existing requirement). For full Node-headless workflow (CI without browser), add `puppeteer` fallback later — when concrete need surfaces.

---

## 3. Camera presets schema

Lives in `parity.config.json` under new top-level key `camera_presets`. If absent, stage 12 emits "warn — no presets defined" and skips comparison (NOT fail — projects must opt in).

```json
{
  "camera_presets": [
    {
      "name": "front",
      "position": [0, 4, 12],
      "look_at": [0, 1, 0],
      "fov": 50,
      "resolution": [640, 480],
      "ssim_threshold": 0.95,
      "diff_pct_max": 1.5
    },
    {
      "name": "orbit-side",
      "position": [12, 4, 0],
      "look_at": [0, 1, 0],
      "fov": 50,
      "resolution": [640, 480]
    }
  ]
}
```

**Defaults applied per preset if omitted:**
- `fov` → keep current camera value
- `resolution` → [640, 480]
- `ssim_threshold` → 0.95
- `diff_pct_max` → 1.5 (%)

**Megazord initial preset set** (proposed in §11):
6 presets covering: front of guild hall, back overview, top-down, NPC close-up, cauldron mid-distance, library wall.

---

## 4. Recorder integration — `scrubPixelPresets(presets)`

New step in `trace-recorder.js`. Inserted in the `start()` pipeline AFTER `scrubRemountStress()` and BEFORE `postTrace()`. Captures all presets sequentially.

**Per-preset flow:**
1. Save current camera state (`position.clone()`, `quaternion.clone()`, `fov`)
2. Resize renderer to `preset.resolution` (cache previous size)
3. Apply preset:
   - `camera.position.set(...preset.position)`
   - `camera.lookAt(...preset.look_at)`
   - if `preset.fov` set: `camera.fov = preset.fov; camera.updateProjectionMatrix()`
4. Force one render: `renderer.render(scene, camera)`
5. Capture via PIXEL_CAPTURE primary: `renderer.domElement.toDataURL("image/png")`
6. SHA-256 the base64 payload (browser SubtleCrypto.digest)
7. Push to `trace.pixel_captures[preset.name] = { dataURL, sha256, size_bytes, resolution }`
8. Restore camera state + resize back

**Determinism guards:**
- Freeze `Date.now` + `performance.now` during the scrub (same pattern as `scrubEngineSettings`), so any time-dependent shader uniforms see identical t for both sides.
- Two RAF frames after each render before capture (lets browser composite).

**Payload size.** PNG at 640×480 ≈ 80-200KB base64 per preset. 6 presets ≈ 0.5-1.2MB per side. Within the body-limit bump (§10).

---

## 5. `12-pixel-diff.cjs` — the diff tool

Reads both sides' traces from artifact-system (API-first per `fetchSidePair` pattern in 07-trace-diff). For each preset present in BOTH sides:

1. Decode mono dataURL + mod dataURL via `pngjs` → RGBA8 buffers
2. Verify dimensions match (HIGH error if not)
3. Run pixelmatch → `{ mismatch_pixels, diff_png_buffer }`
4. Run image-ssim → `{ ssim }`
5. Write to disk:
   - `<out>/pixels/<preset>-monolith.png`
   - `<out>/pixels/<preset>-modular.png`
   - `<out>/pixels/<preset>-diff.png`
   - All paths + SHA-256 embedded in verdict JSON
6. Severity per preset:
   - `pass`: ssim ≥ threshold AND diff_pct ≤ max
   - `warn`: ssim ≥ (threshold - 0.03) AND diff_pct ≤ (max × 1.5)
   - `fail`: otherwise
7. Overall decision: PASS if all presets pass, WARN if any warn (none fail), FAIL if any fail
8. Exit code: 0 on PASS, 1 on FAIL, 0-with-stderr on WARN

**No new external dependencies beyond `pixelmatch` and `pngjs` (a peer dep of pixelmatch). `image-ssim` is a complementary lib — install if available, else compute SSIM via inline impl (~60 LOC).**

---

## 6. Output schema (`pixel-diff.sij.json`) — provenance-embedded

Follows SIJ convention. Every claim is reproducible.

```json
{
  "schema_version": "1.0.0",
  "schema_kind": "parity-cab/pixel-diff",
  "generated_at": "2026-05-26T...",
  "tool_version": "1.0.0",
  "tool_hash": "<git hash-object of 12-pixel-diff.cjs>",
  "host_env_fingerprint": {
    "node": "v22.18.0",
    "platform": "win32",
    "browser_user_agent": "<from mono.notes if available>",
    "cwd_hash": "<sha256 of project root abs path>"
  },
  "command_reproducer": "node ~/.claude/skills/parity-cab/scripts/12-pixel-diff.cjs --config parity.config.json",
  "presets_compared": 6,
  "summary": {
    "decision": "pass | warn | fail",
    "ssim_min": 0.97,
    "ssim_mean": 0.99,
    "diff_pct_max": 0.4,
    "diff_pct_mean": 0.08
  },
  "per_preset": [
    {
      "name": "front",
      "decision": "pass",
      "ssim": 0.987,
      "diff_pct": 0.34,
      "mismatch_pixels": 1040,
      "total_pixels": 307200,
      "resolution": [640, 480],
      "monolith_png": ".parity-traces/megazord/pixels/front-monolith.png",
      "monolith_sha256": "...",
      "modular_png":  ".parity-traces/megazord/pixels/front-modular.png",
      "modular_sha256": "...",
      "diff_png":     ".parity-traces/megazord/pixels/front-diff.png",
      "diff_sha256": "...",
      "threshold_used": { "ssim": 0.95, "diff_pct": 1.5 },
      "explains_field": null
    }
  ],
  "cross_pillar_joins": [
    {
      "preset": "front",
      "from": "pixel-diff",
      "to": ["camera_state", "materials_deep", "scene_config"],
      "explanation": "If FAIL, check camera_state (camera was moved correctly), then materials_deep (PBR drift), then scene_config (fog/bg)."
    }
  ],
  "issues": [
    /* Same as other SIJ outputs — populated only when warn/fail */
  ]
}
```

**Hash chain rule.** Every PNG path is followed by its sha256. Re-running stage 12 with no input change must produce byte-identical PNGs → identical hashes → identical verdict. Idempotent gate.

---

## 6.5. Hash-verified incremental skip (Principle 9 — baked-in from v1.0.0)

**Origin.** Fabio prompted the audit (2026-05-26). We use `plan_hash` + `idempotency_key` + per-file `git hash-object` in modularize-monolith, but parity-cab verdicts have no input-fingerprint. Re-running stage 12 on identical inputs (common when other unrelated edits trigger gate:all) wastes 1-2s of pixel decode + SSIM compute per run. With fingerprint, ~1ms hash check + reuse prior verdict.

**Protocol.**

```
1. Compute input_fingerprint =
     sha256(
       sha256(sorted monolith pixel_captures dataURLs)
       || sha256(sorted modular  pixel_captures dataURLs)
       || sha256(JSON.stringify(camera_presets))
       || tool_hash
     )

2. If prior pixel-diff.sij.json exists AND prior.input_fingerprint === current.input_fingerprint:
     - Read prior verdict.
     - Refresh last_verified_at = now.
     - Re-write the JSON (only that field changes).
     - Print: "[pixel-diff] noop — inputs unchanged (fingerprint=<12-char prefix>). Decision: <prior>".
     - Exit prior.summary.decision === "fail" ? 1 : 0.

3. Otherwise: full run (decode → SSIM → pixelmatch → PNG write → verdict).
```

**Forward-application.** This pattern becomes Principle 9 of the harness:

> *Every parity-cab artifact embeds `input_fingerprint` (hash of inputs that produced it). Every stage checks: if current inputs hash to the same fingerprint, return prior verdict unchanged. Otherwise full run.*

Retrofit candidates (separate sessions, prioritized by re-run cost):
- Stage 11 (AST X-Ray) — re-parses 75 files every run; per-file hash skip yields 10-50× speedup
- Stage 9 (coverage-scan) — same re-parse cost
- Stage 5 (CAB gate) — inputs are inventory + parity-report JSONs; fingerprint trivially computable
- Stage 7 (trace-diff) — inputs are 2 trace JSONs; fingerprint trivially computable
- Stage 10 (coverage-gate) — inputs are coverage-inventory + RFC dispositions

After retrofit, `gate:all` on a no-op state runs in <100ms instead of ~10-30s. Big win for tight edit loops.

## 7. Cross-pillar joins (Principle 6 from meta-introspection)

`07-trace-diff.cjs` gets a new section `pixel_diff` that READS `pixel-diff.sij.json` and embeds it as a section. Adds a `cross_pillar_joins` analyzer:

| If pixel-diff FAIL on preset X | Suggest looking at |
|---|---|
| `camera_state.frustum_visible_meshes_delta` non-zero | "Camera didn't apply correctly — check scrubPixelPresets" |
| `materials_deep` flags any material drift | "Material PBR drift may explain visual divergence" |
| `scene_config.fog_*` drift | "Fog density/color drift causes whole-frame intensity shift" |
| `renderer_config.toneMapping/.outputColorSpace` drift | "Color-space pipeline divergence" |
| None of above | "Geometric/lighting-position issue — inspect manually" |

The agent never has to guess. The verdict tells.

---

## 8. Integration points (concrete file:line edits)

| # | File | Edit |
|---|---|---|
| 1 | `~/.claude/skills/parity-cab/scripts/lib/trace-recorder.js` | Add `scrubPixelPresets(presets)` (~80 LOC); add `trace.pixel_captures` schema field; insert into `start()` pipeline. |
| 2 | `~/.claude/skills/parity-cab/scripts/12-pixel-diff.cjs` | NEW (~250-300 LOC). |
| 3 | `~/.claude/skills/parity-cab/scripts/07-trace-diff.cjs` | Add `diffPixel(monoCaptures, modCaptures)` section; consume `pixel-diff.sij.json` if present; emit cross_pillar_joins. |
| 4 | `~/.claude/skills/parity-cab/SKILL.md` | New §"Stage 12 — Pixel-diff" + cap declarations. |
| 5 | `~/.claude/skills/parity-cab/scripts/run-all.cjs` | Add stage 12 to orchestrator (after stage 7, optional). |
| 6 | `workspace/artifact-system/src/server/index.ts:232` | Bump body limit `512 * 1024` → `3 * 1024 * 1024` (3MB) on `/api/parity-trace` to fit pixel captures. |
| 7 | `workspace/artifact-system/projects/megazord/parity.config.json` | Add `camera_presets[]` with 6 initial presets (§11). |
| 8 | `workspace/artifact-system/projects/megazord/package.json` | Add `gate:pixel` npm script + chain into `gate:all`. |
| 9 | `workspace/artifact-system/scripts/check-handoff-ready.cjs` | Add check #17: pixel-diff verdict reachable + PASS-or-WARN-not-FAIL. |
| 10 | `workspace/artifact-system/projects/megazord/STATE.md` | R7 → DONE; mention pixel-diff.sij.json + handoff check #17. |
| 11 | `workspace/artifact-system/STATE.md` | New item #24 documenting stage 12 landing. |

**No other artifact-system code changes in Phase 1.** UI section (Workbench renders pixel-diff thumbnails + SSIM scores) is Phase 2 in a separate session.

---

## 9. Regression test (Principle 5 — gate must prove it catches)

Before declaring stage 12 done, prove it FIRES on a known visual regression:

1. Branch megazord modular src.
2. Inject visual bug: in one creator (e.g., `src/creator/vase.ts`), change a material color hex by 10 (e.g., `#1a0a04` → `#1aff04`).
3. Re-run `06-behavior-trace` + `12-pixel-diff`.
4. Assert stage 12 verdict = FAIL with SSIM dropping ≥ 0.05 on at least the preset that shows the vase.
5. Revert the bug. Re-run. Assert verdict = PASS.
6. Commit the bug-injection patch + revert as `test/visual-parity.regression.cjs` in parity-cab. Wired into `gate:regression` (new optional gate).

**Without this test, stage 12 is unproven and "passing" means nothing.**

---

## 10. Dependencies

| Package | Where | Size | License | Why |
|---|---|---|---|---|
| `pixelmatch` | dev-dep of parity-cab (or zero-install via `npx --yes`) | ~10KB | ISC | Pure-JS pixel diff + diff PNG output. |
| `pngjs` | transitive (peer of pixelmatch) | ~30KB | MIT | PNG encode/decode. |
| `image-ssim` (optional) | optional dev-dep | ~15KB | MIT | SSIM scoring. Skip if not installable; fall back to inline impl. |

**No native compilation. No browser binary. No Chromium download. Total install footprint: <60KB.**

`parity-cab/SKILL.md` will document: install via `npx --yes pixelmatch@latest` per-invocation (zero global install), OR `npm i -D pixelmatch image-ssim` per-project for repeat use.

---

## 11. Megazord initial camera presets

| Name | Position | LookAt | FOV | Why this view |
|---|---|---|---|---|
| `front` | [0, 4, 12] | [0, 1, 0] | 50 | Hall overview — covers most entities |
| `back` | [0, 4, -12] | [0, 1, 0] | 50 | Reverse overview — catches occluded gear |
| `top` | [0, 14, 0.1] | [0, 0, 0] | 50 | Bird's-eye — layout parity |
| `npc-close` | [2.5, 2, 2.5] | [2, 1.5, 2] | 35 | NPC wizard close-up — joints + materials |
| `cauldron-mid` | [-1, 2, 4] | [-1, 0.5, 0] | 45 | Cauldron + steam sprites |
| `library-wall` | [5, 3, -3] | [4, 2, -5] | 45 | Bookshelves + telemetry HUD edge |

(Subject to Fabio's veto — these are educated guesses based on entity positions in showcases.ts. Final list confirmed visually before first regression test.)

---

## 12. Risks + mitigations

| Risk | Mitigation |
|---|---|
| `canvas.toDataURL` returns tainted error on cross-origin textures | Megazord textures are procedural; non-issue here. For other projects, fallback to RTT (cap fallback id="rtt"). |
| Browser-vs-browser rendering differences (mono = Chromium-via-iframe, mod = same — same engine, SAME render) | Both sides share the artifact-system iframe → same browser → same WebGL impl → same shader compiler. No mitigation needed for Megazord. Cross-browser harness would be a separate concern. |
| Antialiasing jitter between identical scenes causes false FAIL | SSIM (0.95 threshold) tolerates AA jitter. pixelmatch `threshold: 0.1` ignores ≤10% per-pixel color delta. |
| PNG dataURL bloats trace JSON | Bumped /api/parity-trace body limit to 3MB. Captures only when presets defined. |
| Recorder freeze of clock interacts with pixel capture | Already handled — freeze applies during scrub, captured AFTER unfreeze (pixel capture step happens at end). |
| Regression test ships a bug-injection script that could be accidentally enabled | The script LIVES in test/, never imported by production. CI gate ensures revert applied before test exits. |

---

## 13. What Fabio will see manually after this lands

**During implementation:** nothing visible. Code lands in skill + 1 line in server.

**After landing + Fabio runs `npm run gate:pixel` (or `npm run gate:all`):**
- New file: `workspace/artifact-system/projects/megazord/.parity/pixel-diff.sij.json`
- New directory: `workspace/artifact-system/projects/megazord/.parity/pixels/` with 18 PNGs (6 presets × 3 outputs each)
- Gate exits 0 if PASS, 1 if FAIL

**After landing + Fabio runs full pipeline (06-behavior-trace + 12-pixel-diff):**
- artifact-system Workbench: NO change in Phase 1 (no UI section yet)
- `behavior-trace.sij.json` gains `pixel_diff` section (visible in current Workbench section list)
- HANDOFF-STATUS.md gains check #17

**Phase 2 (separate session, NOT this RFC):**
- ModularizationWorkbench gets a Visual Parity panel: per-preset thumbnails (mono | mod | diff) + SSIM badge + click-to-zoom
- Server gets `/api/pixel-diff/png?project=X&preset=Y&kind=monolith|modular|diff` endpoint (serves PNG from disk)

---

## 14. Rollback

If stage 12 misbehaves:
- Remove `gate:pixel` from `gate:all` chain (1 npm script edit)
- Delete `12-pixel-diff.cjs` (no other code calls it)
- Revert `trace-recorder.js` scrubPixelPresets addition (1 function + 1 schema field)
- Revert server body limit (1 line)
- Delete `.parity/pixel-diff.sij.json` + `.parity/pixels/`

Total revert: ~5 file edits. Each reversible via `git revert`. No data loss (PNGs are derivatives).

---

## 15. Estimated build cost

| Component | LOC | Tokens |
|---|---|---|
| `12-pixel-diff.cjs` | ~280 | ~3500 |
| Recorder patch (scrubPixelPresets) | ~80 | ~1000 |
| `07-trace-diff.cjs` pixel section + cross_pillar_joins | ~60 | ~800 |
| Server body limit bump | 1 line | ~50 |
| SKILL.md §Stage 12 | ~40 lines | ~500 |
| `parity.config.json` presets | ~50 lines JSON | ~300 |
| `run-all.cjs` stage 12 entry | ~10 lines | ~200 |
| `check-handoff-ready.cjs` check 17 | ~30 lines | ~400 |
| Megazord package.json gate:pixel | 2 lines | ~100 |
| STATE.md updates (×2) | ~30 lines | ~600 |
| Regression test scaffold | ~50 lines | ~700 |
| **Total** | **~630 LOC** | **~8150 tokens** |

Within 1 session budget.

---

## 16. APPROVAL token

After reading: respond with one of:

- `APPROVE SPEC-12-PIXEL-DIFF` → I proceed to implement per §8.
- `AMEND ...` → tell me what to change; I revise + re-present.
- `REJECT` → I drop the spec; we re-discuss the approach.
