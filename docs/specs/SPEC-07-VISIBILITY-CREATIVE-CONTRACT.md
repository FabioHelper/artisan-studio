# SPEC-07: Visibility, Contract Truth & Creative Unlock

Source plan: `.bridge/ARTISAN-VISIBILITY-CREATIVE-PLAN.md` (P0 = truth, visibility and trustworthy gates; P1 = bounded creative authorship and Astra token economy; P2 = scene draw-call remediation).

## 1. Objective
Make the existing World Compass system truthful and readable before it becomes more creative:
every lighting mode must be readable and must actually change the image, the canonical contract must
equal what the engine renders, unknown archetypes must be rejected on every code path, and governance
must report measured performance rather than aspirational numbers.

## 2. Canonical sources (all in `src/contracts/artisanContract.js`)
| Export | Consumed by | Rule |
|---|---|---|
| `LIGHTING_PROFILES`, `LIGHTING_FAMILIES` | `LightingRig.setSceneProfile`, `main.js` (exposure) | Family x preset matrix (`medieval`, `tokyo`, `winterhold`, `fantastic`) x (`dusk`, `hearth`, `day`). `LightingRig` holds no scene-name branches. |
| `PRESET_SCENES[*].lightingFamily` | `LightingRig`, `main.js loadScene` | Every preset scene maps to one family. |
| `AUTHORED_LIGHTING_FAMILY_BY_ARCHETYPE`, `LOCAL_LIGHT_ANCHORS`, `authoredLighting()` | `main.js` MCP bridge | An authored world's shell picks its family; its first fire/lamp archetype positions the practical light. A world without one gets no practical light. |
| `VISIBILITY_THRESHOLDS`, `MODE_RESPONSE`, `EXPOSURE_RANGE` | `scripts/measure_brightness.mjs`, `scripts/check_contract_drift.mjs` | Approved readability gates (section 4). |
| `MATERIAL_CATALOG` | `MaterialFoundry.register`, MCP resources | Every record carries `color`, `roughness`, `metalness` (+ `emissive`/`emissiveIntensity` when emissive, `textured` when a procedural map exists). `MaterialFoundry.register()` applies these canonical fields and records any construction disagreement in `contractDrift`. Textures and shaders stay procedural in `MaterialFoundry`. |
| `ARCHETYPE_CATALOG` + `isKnownArchetype` | `WorldCompiler.compileEntity` | Exact catalog guard before any routing; exact id -> builder table (`ARCHETYPE_ROUTES`); no substring routing. |

## 3. Lighting rules
- Tuning order (D4): hemisphere bounce -> cool fill -> key intensity/direction -> practical light -> exposure (0.95-1.10) -> only then albedo. P0 needed no albedo change.
- Dual temperature: fill is always cool (B > R); the key or an active practical is warm (R > B). No hemisphere sky is flat white.
- Every pair of presets differs in at least 2 canonical light/background fields.
- `fantastic` family = the frozen pre-SPEC-07 medieval values; the walkable Fantastic World is out of P0 scope.
- `window.__artisan.getLightingTelemetry()` exposes the applied fields read-only; `window.__artisan.setLighting(preset)` switches presets.

## 4. Visibility gates (`npm run measure:brightness`)
Method: 1280x720, deviceScaleFactor 1, fixed Edge/Chrome executable with ANGLE D3D11, renderer canvas only (UI hidden), three settled samples per scene/mode (median by mean luma), Rec.709 luma on 8-bit sRGB. Report JSON + contact sheet under `ARTISAN_ARTIFACTS_DIR/brightness/<tag>/`; non-zero exit on any failure.

| Mode | Mean Y floor | Median Y floor | Near-black (Y<24) ceiling | Clipped (Y>245) ceiling |
|---|---:|---:|---:|---:|
| Dusk | 58 | 42 | 22% | 2% |
| Hearth | 38 | 30 | 38% | 2% |
| Sol (`day`) | 68 | 52 | 16% | 2% |

Mode response per diorama: mean-luma spread >= 12, Sol - Hearth >= 10, >= 2 changed light fields and fixed-frame RMS >= 3/255 for every preset pair.

## 5. Contract-proof gates (`node scripts/check_contract_drift.mjs`)
- 53/53 materials: comparable values equal the contract; construction drift empty (Node) and browser drift empty (`verify_astra_harness.mjs` gate `material-contract-browser`).
- 44/44 archetypes compile through their intended exact route (builder spy, not source text).
- `unknown.table`, `unknown.lantern`, `primitive.box`, `totally.alchemist_shell.fake` fail through `validateWorld`, the browser `SpatialValidator`, `compile` and `compileEntity`.
- Every MCP file write (fs writes and Puppeteer `screenshot({ path })`) targets a path produced by `mcp-server/artifacts.js`.

## 6. Bridge and artifact proof (`node mcp-server/test_ws_bridge.js`)
- WebSocket upgrades require an allowed `Origin` (a missing Origin is refused; HTTP may omit it for local tools).
- Bridge requests resolve only on a reply with the same id AND the expected reply type (`REPLY_TYPES`); unknown request types are refused.
- Artifact names cannot traverse; `writeArtifactAt` refuses paths outside the configured root.
- The verifier's `no-writes-outside-artifacts` gate compares SHA-256 of every project file (excluding `.git`, `node_modules`, the artifact root) before and after verification.

## 7. Performance truth
- Budgets stay 30 draws (diorama) / 35 visible draws (Fantastic World).
- `HARNESS-SIJ.json.scene_baselines` records measured scene-level draws with viewport, GPU, date and method.
- Tokyo 45/30, Winterhold 39/30 and Fantastic 58/35 are open, non-blocking findings until P2; they must not increase.
- Cabinet `last_verified_drawcalls` values are component-scoped and have no reproducible isolation method; they are marked unverified, not overwritten with scene numbers.

## 8. Known limits carried to P1/P2
- `arch.balcony_window` never had a foundry builder; P0 compiles it inline in `WorldCompiler` (3 draws). P1 moves it into `UniversalFoundry`.
- `arch.tokyo_walls` has no walls-only builder and routes (explicitly) to the apartment shell, as it rendered before SPEC-07.
- `mcp-server/index.js` and `HeadlessRunner.js` still call `fs.writeFileSync`/`page.screenshot` themselves on `safeArtifactPath()` results (outside the P0 allowlist); the static scan proves confinement. P1 may route them through `writeArtifactAt`.
- `scripts/gate_cabinet.js` substitutes 20 when a cabinet has no draw-call value (outside the P0 allowlist).
- Owner review of the before/after contact sheet is required before the build closes.
