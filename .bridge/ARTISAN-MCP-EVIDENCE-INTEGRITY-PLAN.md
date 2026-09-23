# Artisan MCP Evidence Integrity — P0.5 Repair Plan

- **Status:** PLAN ONLY. Nothing in this plan has been implemented. This session wrote only this file inside the repository (plus a throwaway draw-call estimator in the OS temp scratchpad, outside the repo).
- **Date:** 2026-09-22 · **Author:** Claude Opus 5 (deep-plan session) · **Owner:** Fabio
- **Phase name:** P0.5 — MCP Evidence Integrity (`BUILD-EVIDENCE`, spec `SPEC-08`)
- **Position:** after `BUILD-VIS` (closed), and a **hard blocker** for `BUILD-CREATIVE` (P1, approved, unstarted).
- **Execution model:** **Claude Opus 5 (`claude-opus-5`), high effort**, in fresh sessions (see §18 for the rationale and per-step routing). Split: Session A = Phases 0–3, Session B = Phases 4–7, with a handoff at the Phase 3 boundary.
- **Sequence decided (D-1, §0):** P0.5 Evidence Integrity → P0.6 Authored-World Budget Conformance → P1 `BUILD-CREATIVE`. Both P0.5 and P0.6 block P1.
- **Standing prohibitions carried into execution:** no P1 creative features; no commits unless the owner asks; no publishing; no access to `C:/Users/Fabio D/Desktop/THREEJS_HARNESSING`; never kill, restart, or reconfigure MCP processes or ports that the executor did not start (PIDs 4424/25324/25384, ports 3456/5173 stay untouched); verification is hermetic on its own ports.

---

## 0. Decision D-1 (decided 2026-09-22): measure first, then optimize, and both block P1

**The ≤30-draw criterion is predicted to FAIL on the unmodified replay world.** This repair measures honestly; it does not optimize.

A read-only, in-memory compile (Node, `WorldCompiler` + `MaterialFoundry`, counting visible mesh draw groups and indexed triangles) was calibrated against the preset scenes and matches the harness's browser measurements:

| Scene | Static estimate (draws / tris) | Browser-measured (source) |
|---|---|---|
| trio | 16 / 1,616 | 16 / 1,616 (dogfood "default headless" telemetry; harness baseline) |
| alchemist | 25 / 4,814 | 25 / 4,814 (dogfood final preset capture) |
| tavern / armory / library | 17 / 22 / 28 | 17 / 22 / 28 (harness `BASELINE_PRESET_DRAWS`) |
| tokyo / winterhold | 45 / 38 | 45 / 39 |
| **authored `dogfood-alchemist-midnight-study` v15** | **56 / 12,870** | never rendered |

Per-entity draws in the authored world: alchemy-station 13, books-west 6, books-east 6, table-lantern 5, chest-lantern 5, study-shell 4, worktable 4, cauldron 3, chest/barrel/crate 2 each, mountain-sigil 2, rug 1, shadow-catcher ground 1. Triangles (12,870) are predicted to pass the 15,000 target. Draws are predicted to fail by roughly 26. The hero camera may cull a few meshes, but not 26 draws' worth.

**Feasibility evidence** (second read-only, in-memory pass):
- Every entity already uses exactly one mesh per material, so merging inside each entity saves **0** draws.
- The world uses **28 distinct materials** (3 transparent, 6 emissive). The theoretical floor with full world-level static batching by material is therefore **≈28 draws: under 30, but with only 2 draws to spare**.
- Getting there means restructuring the compiler's output (world-level batching that still preserves per-entity identity) and proving visual parity. P1's candle clusters and authored lights then add materials on top.

So budget conformance is a real rendering-architecture change with visual-quality risk. It is not a tweak.

**Decision (the best approach for integrity and quality):**
1. **Keep the criterion exactly as written** (unmodified replay world, ≤30 draws, ≤15,000 triangles, FPS reported). Do not weaken it, change the fixture, or sign an exception.
2. **Assign it to the phase that can honestly satisfy it**, in the right order:
   - **P0.5 (this plan) proves the measuring instrument.** It closes when the evidence pipeline is correct: identity-bound, settled, live equals headless, and a correct verdict on both a within-budget control world and the replay world. The replay's real draws/tris/FPS are measured and printed, with a truthful PASS or FAIL.
   - **P0.6 Authored-World Budget Conformance (`BUILD-AUTHORED-BUDGET`)** owns the ≤30/≤15,000 criterion on the unmodified replay world, with a visual-parity proof. It is planned *after* P0.5 lands, because you cannot validate an optimization with an instrument that has not been proven.
   - **Both P0.5 and P0.6 block P1** through `PLAN.json` edges (§14.1). The P1 plan's own acceptance ("stay within budget" with candle-lit scenes) cannot pass while a realistic 13-entity room sits near 2× the budget. Building P1 first would guarantee a P1 failure and rework.
3. **Why not optimize inside P0.5:** it would mix two risk classes (MCP protocol vs rendering structure) into one rollback unit, validate the optimization with an unproven instrument, and break the "narrow P0.5" scope. It would also risk shipping the batching design before the entity-identity proof it must preserve exists.
4. **Standing constraint on P0.6** (recorded now so the proof survives): any batching must keep one named transform node per entity (`group.name === entity.id`) under `activeWorldGroup`, so that P0.5's `renderedEntityIds` proof, audit bisection, and per-entity identity keep working. P0.6 must also pass every P0.5 gate unchanged.
5. **When the owner has to decide:** only if the P0.6 deep plan proves ≤30 is unreachable without visible quality loss. Then the owner decides budget policy for authored worlds, with trustworthy numbers in hand. No owner decision is needed now.

If the measurement surprises and the replay is already ≤30 / ≤15,000, P0.6 closes immediately on the P0.5 report (§14.3).

---

## 1. Evidence base

Established by the owner (restated) and re-verified by reading source during planning:

| # | Evidence | Where |
|---|---|---|
| E1 | Three `mcp-server/index.js` processes ran at once (PIDs 4424, 25324, 25384); only 4424 owned 127.0.0.1:3456 and the Studio connection. | owner-established; `tool-call-log.json` `runtime.portOwner` |
| E2 | `EADDRINUSE` is caught and only logged to stderr, which the MCP client never sees. The instance keeps serving stdio with `listening=false`. | `mcp-server/bridge.js:128-131` |
| E3 | With no bridge, `compile_preview` returns **ok:true**, `livePreview:false`, `ack:null` and the text "no live Studio connected", even though a Studio *is* connected (to another instance). | `mcp-server/index.js:394-396`; log steps 16, 21 |
| E4 | The Studio indicator shows "MCP: CONNECTED (3456)", which identifies a port, not an instance. | `src/main.js:1372` |
| E5 | Headless paths never consume the session manifest: the audit and screenshot call `loadScene(preset)`, and telemetry loads the default page. That default page is `trio` (`main.js:211`), which exactly matches the dogfood's "default headless" 16 draws / 1,616 tris. A headless audit with no scene defaults to **tokyo**. | `HeadlessRunner.js:55-104`; `index.js:436` |
| E6 | `import_telemetry_logs` attaches the session `sceneIdentity` and manifest to whatever telemetry it got. The dogfood artifact claims `sha256:f4bb…` beside 16 draws / 1,616 tris from the trio page. | `index.js:478-485`; `telemetry_import_1790046515831.json` |
| E7 | A live screenshot stamps `session.sceneIdentity()` whenever `scene` is absent, without asking the browser what it shows. Live telemetry is never checked at all. | `index.js:469`, `index.js:114-122` |
| E8 | The compile ack is unverified. `worldId`/`version` are echoes, `entityCount` is `manifest.entities.length` (not what was rendered), there is no identity, and draws are read two rAFs after `requestShadowBake(3)`, so they include shadow-map depth passes. | `main.js:1502-1516`; `WorldCompiler.js:167`; `index.js:398-403` |
| E9 | A bridge request resolves on the first reply with a matching id from **any** socket, and non-manifest commands go to `clients[0]` blindly. | `bridge.js:154-173`, `bridge.js:185-194` |
| E10 | Headless capture uses `page.screenshot`, so DOM overlays (`#rtss-overlay` OSD, `#mcp-indicator`, command deck) land in the evidence. | `HeadlessRunner.js:86`; `index.html:62,73` |
| E11 | `safeArtifactPath` applies `path.basename()`, so the requested `dogfood/p1-current-harness/initial-hero.png` silently landed at the artifact root. | `artifacts.js:21-32`; log step 18/20/25 args |
| E12 | The profiler emits prewritten `actionTaken` text and `status: RESOLVED/MITIGATED` whenever a threshold trips. The verdict strings claim "ZERO GUESSWORK" / "LOCKED 60 FPS", `gpuRenderer` is the literal 'WebGL 2.0', and the dogfood rootCause says "Retina/HiDPI (1x)". | `ArtisanProfiler.js:1062-1109` |
| E13 | The audit **mutates** state: it restores pixel ratio to `Math.min(orig, 1.0)` rather than `orig`. This is an unverified "repair" applied by a measurement. | `ArtisanProfiler.js:1027` |
| E14 | The browser handles bridge messages in an un-serialized `async onmessage`, so a telemetry request can overtake an in-flight manifest compile. | `main.js:1394` |
| E15 | The replay fixture is deterministic. Recomputing `sha256(canonicalJson(authored-world.json))` gives exactly `sha256:f4bb39db91d785d657fb56059e7222f4`. The log's 15 mutating calls (create + 13 add + move) fully reproduce v15. | recomputed during planning; `tool-call-log.json` steps 1-14, 22 |
| E16 | The tool-schema footprint is 7,873 chars ≈ 1,969 tokens against a 2,000-token gate, which leaves about 127 chars of headroom. | `.artisan-artifacts/verify/verify_report.json`; `test_stdio_client.js:53-55` |

**Hypothesis (unverified, not needed by the fix):** H-1. The three processes were spawned by separate MCP client sessions. The Codex plugin `.mcp.json` launches the repo `index.js` directly, once per session. The fix does not depend on H-1.

---

## 2. Evidence-ranked root cause

1. **RC-1 — Bridge ownership is process-global; world state is process-local; nothing links them.** (E1–E4, E9.) The TCP port acts as an implicit, invisible lock. The losing instance degrades silently (E2), then reports a false "no Studio connected" success (E3), while the UI reports a port-level "CONNECTED" (E4). Neither side carries an instance identity, so nobody can tell which MCP owns the Studio. *Direct cause of the dogfood's live-preview failure and of every fallback that followed.*
2. **RC-2 — Evidence tools never ask the renderer what it rendered.** (E5–E7.) The headless paths render presets or the default trio page, while the live paths trust the session. `import_telemetry_logs`, and live screenshots without `scene`, stamp the authored identity onto evidence from an unrelated scene. *Direct cause of the provenance-mismatched artifacts.*
3. **RC-3 — The compile acknowledgement is an echo, not a proof.** (E8, E9, E14.) The ack repeats the sent `worldId`/`version`, counts manifest entries rather than rendered entities, has no identity, measures during shadow-bake frames, and can resolve from any socket.
4. **RC-4 — The capture and artifact paths lose fidelity silently.** (E10, E11.) Overlays get into the screenshot, and requested subdirectories are dropped without notice.
5. **RC-5 — The audit asserts repairs it never performed and mutates what it measures.** (E12, E13.)

The environmental trigger (Vite not running on 5173 at first) is not a code defect. It is covered only by clearer error text (`STUDIO_UNREACHABLE`).

---

## 3. Chosen architecture

### 3.1 Identity model (verifiable at every hop)

| Identity | Scope | Generated by | Visible in |
|---|---|---|---|
| `instanceId` | one MCP process | `crypto.randomUUID()` at startup, in `bridge.js` | capabilities resource, `GET /api/bridge/identity`, every bridge message, the Studio indicator (first 8 hex digits), every evidence envelope |
| `connectionId` | one WebSocket | bridge, per accepted socket (`conn-<n>`) | `BRIDGE_HELLO`, the capabilities client list |
| `clientId` | one Studio page load | browser `crypto.randomUUID()` | `BRIDGE_HELLO_ACK`, every reply, evidence envelope |
| `sceneIdentity` (authored) | manifest content | `sha256:` + first 32 hex of SHA-256(`canonicalJson(manifest)`) (unchanged bytes) | WorldSession, the ack, evidence |
| `sceneIdentity` (measured) | what a renderer shows | **browser recomputes** from the manifest it actually compiled; presets use `preset:<id>`; game mode is `mode:game`; nothing loaded is `none` | every reply's `render` block, evidence |
| `epoch` | render-state version in one page | browser counter, +1 on every scene swap | every reply; captures and audits check it is unchanged start→end |

The `preset:` / `mode:` namespaces can never equal a `sha256:` identity, so a preset can never be mislabeled as authored.

### 3.2 Multi-instance policy: fail additional instances *clearly and actionably*, keep them useful

- The first instance to bind the configured port (default 3456) owns the live bridge. **No automatic port switching.**
- On `EADDRINUSE`, the instance enters bridge state **`conflict`**. It stays alive on stdio, because authoring and validation do not need the bridge, and it:
  1. probes `GET http://127.0.0.1:<port>/api/bridge/identity` (1.5 s timeout, strict shape validation, strings truncated). The owner is classified as `artisan` (repaired instance: `instanceId`, `pid`, `startedAt`, current `worldId`/`version`/`sceneIdentity`), `artisan-legacy` (`GET /` returns the old "Artisan 3D Preview Bridge" page), or `foreign`;
  2. logs a multi-line **CONFLICT** banner to stderr;
  3. reports `previewBridge.state:'conflict'` plus `owner` and `remediation` in `artisan://capabilities`;
  4. makes `compile_preview` fail with **`BRIDGE_CONFLICT`**, whose message names the port, the owner classification and instanceId/pid, this instance's id, and two fixes: stop the owner (the `netstat -ano | findstr :<port>` hint for legacy or foreign owners), or relaunch this MCP with `MCP_WS_PORT=<free port>` and open `http://127.0.0.1:5173/?mcpPort=<port>&mcpInstance=<instanceId>`;
  5. still serves **headless** evidence. Headless evidence is rendered by this instance's own browser and identity-verified (§3.5), so it is safe. Every evidence response then carries `bridge:{state:'conflict', owner}` and a text prefix `[headless; live bridge owned by <owner>]`. Nothing is silent.
- **Lazy re-acquire:** before any live-dependent operation in `conflict`, the instance retries `listen()` once. If the owner has exited, this instance becomes the owner (state `listening`). There are no background timers.
- `ARTISAN_BRIDGE=off` gives state **`disabled`**, an explicit opt-out: `compile_preview` stays ok with `livePreview:false` (the existing stdio contract).
- Supported multi-instance use stays the existing explicit mechanism (`MCP_WS_PORT` plus the Studio's `?mcpPort=`). It is now made safe by instance pinning (`?mcpInstance=`).

### 3.3 Bridge protocol v2 (loopback, origin rules unchanged)

- **On connect**, the server sends `BRIDGE_HELLO {protocol:2, instanceId, connectionId, pid, port, startedAt, serverVersion}` *before* `cabinet_init`.
- The **browser replies** `BRIDGE_HELLO_ACK {protocol:2, instanceId, connectionId, clientId, pinnedInstance, render}`. The server marks the connection **verified** only if `protocol`, `instanceId` and `connectionId` match. Unverified sockets (for example a stale pre-repair tab) get vault messages only; they never receive commands or `WORLD_UPDATE`, and they are counted separately.
- **Pinning:** if the page URL has `mcpInstance=<id>` and the HELLO disagrees, the browser closes with code 4002, shows `MCP: WRONG INSTANCE (<port>)`, and retries slowly. A verified label reads `MCP: CONNECTED (3456 · a1b2c3d4)`. With no HELLO within 2 s, it reads `MCP: CONNECTED (3456 · UNVERIFIED legacy)` and the page keeps the legacy bare-manifest behavior (§7).
- **Commands:** `{type, id, instanceId, …}`. **Replies:** `{type:<REPLY>, id, instanceId, clientId, render:{sceneIdentity, epoch, worldId, version, renderedEntityIds}, …}`. A pending request resolves **only** if the reply arrives on the *same socket* it was sent to, and `instanceId`, `clientId` and reply type all match. Everything else is ignored and logged.
- **Compile:** `MANIFEST {id, instanceId, expect:{worldId, version, entityCount, sceneIdentity}, manifest}` is sent to all verified clients and resolves on the first verified ack. That client becomes the **primary client** for later commands (explicit `clientId` targeting replaces `clients[0]`).
- **Passive updates:** `commitCandidate` publishes `WORLD_UPDATE {instanceId, manifest}` to verified clients only. There is no reply, but it updates the browser's render state.
- **Browser message handling is serialized** through a single promise queue (fixes E14).
- `GET /api/bridge/identity` returns `{service:'artisan-mcp-bridge', protocol:2, instanceId, pid, startedAt, port, serverVersion, verifiedClients, world:{worldId, version, sceneIdentity, entityCount}}`. It is subject to the existing host and origin policy and never includes manifest content.

### 3.4 One render path in the browser (`src/main.js`)

- `applyAuthoredManifest(manifest)` holds the existing bridge manifest handler body, extracted verbatim (lighting preset, `authoredLighting`, compile, group swap, practical light, profile, shadow bake). It computes the identity **before** compile with `crypto.subtle` over the contract's `canonicalJson`, sets render state, increments `epoch`, and returns `{sceneIdentity, worldId, version, manifestEntityCount, renderedEntityIds}` (the names of the entity groups under `activeWorldGroup`). The live WS handler, `WORLD_UPDATE`, and the headless runner all call this one function.
- `loadScene(preset)` sets render state `preset:<id>`; game mode sets `mode:game`.
- `waitForSettled({quietFrames:10, timeoutMs})` resolves when `sceneWarmupFrames===0` and `shadowBakeFrames===0` hold for 10 consecutive frames. It reports `settled:false` on timeout.
- `measureRender({frames})` samples frames through rAF and returns `drawCalls` (max over the sample), `triangles` (max), mean and p95 frametime, `fps = 1000/mean`, GPU string, `isSoftwareRasterizer`, pixel ratio, viewport, and camera position/target.
- `captureCanvas({angle})` optionally sets the camera angle and waits for settle, then runs `renderer.render(scene, camera)` and `renderer.domElement.toDataURL('image/png')` in the **same task**. It returns `{dataUrl, width, height, render}` and fails if `epoch` changed. The live `CAPTURE_SCREENSHOT` handler and the headless runner both use it.
- The compile ack reports `render.drawCalls/triangles` **after** `waitForSettled`, so shadow-bake passes are excluded (E8).
- In an insecure context (no `crypto.subtle`, for example a LAN-IP origin), `sceneIdentity:null` and `identityError:'INSECURE_CONTEXT'` are reported, and the server refuses to verify.
- Everything is exported on `window.__artisan` (`applyAuthoredManifest`, `getRenderState`, `waitForSettled`, `measureRender`, `captureCanvas`, `computeSceneIdentity`).

### 3.5 Evidence resolution rule (`mcp-server/index.js`), identical for every evidence tool

The evidence tools are screenshot, engine telemetry, telemetry export (`import_telemetry_logs`), and audit; `compile_preview` is covered by the ack rules.

1. **`scene` argument given** (screenshot/audit only): render the preset. Evidence is `sceneIdentity:'preset:<id>'`, `authored:false`, with **no authored identity and no manifest attached**.
2. **Otherwise the target is the authored world:**
   - Bridge `listening` and a verified primary client: ask the browser. Proceed live only if the browser's measured `sceneIdentity` equals the session identity *and* `renderedEntityIds` set-equals the manifest ids. Otherwise fail with **`PREVIEW_STALE`** ("Studio shows `<x>`; authored is `<y>`; run compile_preview"). No automatic re-push, and no silent source switch.
   - Bridge `listening` with no verified client, or `conflict`, or `disabled`: **headless authored render**. `HeadlessRunner.renderEvidence` injects the manifest through a `page.evaluate` argument (never a URL or a temp file), requires the browser-computed identity and entity-id set to equal the session's, and **only then** writes artifacts. On mismatch it throws `HEADLESS_IDENTITY_MISMATCH` and writes nothing.
3. Every evidence response carries one envelope:
   `evidence:{sceneIdentity (measured), identityVerified, authored, source:'live'|'headless', worldId, version, entityCount, renderer:{kind, instanceId, clientId|null, connectionId|null, headlessRunId|null}, camera, measuredAt, bridge:{state, owner?}}`.
   The top-level `sceneIdentity` in evidence outputs is **always the measured one**.
4. **`import_telemetry_logs`** writes `{timestamp, evidence, telemetry, manifest}` only when `identityVerified===true`. Otherwise it fails with `EVIDENCE_UNVERIFIED` and writes no file.
5. **`get_telemetry` (the manifest export)** stays session state, labeled `authored`. It adds `lastVerifiedRender:{sceneIdentity, source, instanceId, clientId, at}` so an export can be cross-checked against render evidence.
6. **Error codes** (new): `BRIDGE_CONFLICT`, `STUDIO_UNVERIFIED`, `ACK_MISMATCH`, `PREVIEW_STALE`, `EVIDENCE_UNVERIFIED`, `HEADLESS_IDENTITY_MISMATCH`, `STUDIO_UNREACHABLE` (maps `net::ERR_CONNECTION_REFUSED`). Existing: `INVALID_FILENAME`, `ARTIFACT_PATH_ESCAPE`, `COMPILE_FAILED`, `PROFILER_UNAVAILABLE`.

### 3.6 Verified compile acknowledgement

`compile_preview` succeeds with `livePreview:true` only if the ack satisfies all of:
- it arrived on the same socket;
- `instanceId` matches;
- the verified `clientId` matches;
- `ok===true`;
- the browser-computed `sceneIdentity` equals the expected one;
- `worldId` and `version` equal the expected values;
- `renderedEntityIds.length === entityCount === manifest.entities.length`, with ids set-equal.

Any failure raises **`ACK_MISMATCH`** with one issue per failing field (expected vs got). The ack returns `render:{drawCalls, triangles, settled}` and a budget computed from settled numbers; `withinBudget` is `null` when not settled.
- Bridge `conflict`: `BRIDGE_CONFLICT`.
- Only unverified clients: `STUDIO_UNVERIFIED` (reload the tab).
- Listening with no client: ok, `livePreview:false`, plus the pinned `studioUrl` `?mcpPort=<port>&mcpInstance=<id>`.

### 3.7 Clean capture and artifact subdirectories

- Every capture is canvas-sourced (`captureCanvas`), live and headless. `HeadlessRunner` makes **no `page.screenshot` call**.
- The headless camera is deterministic: `angle` if given, else `hero` for authored worlds; presets keep their own camera when no angle is given (current behavior).
- New `safeArtifactRelPath(requested, ext, fallbackStem)` in `artifacts.js`:
  - accepts ≤ 4 segments split on `/` or `\`;
  - each segment is sanitized with today's stem rules plus trailing-dot stripping;
  - **rejects** (with `INVALID_FILENAME`, never silently rewritten) absolute paths, drive letters, UNC paths, any `..` or `.` segment, Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`), empty segments, segments over 64 chars, and totals over 120 chars;
  - creates missing directories *inside* `artifacts.js`;
  - enforces **realpath confinement**: the deepest existing ancestor and the final directory must realpath inside `realpath(ARTIFACTS_DIR)`, which defeats junctions and symlinks;
  - reports `normalized:true` whenever characters were substituted.
- `safeArtifactPath` (basename semantics) is unchanged for internal fixed names.
- Capture responses return `requestedFilename`, `path`, `bytes`, `pngSha256`, and `width`/`height`.

### 3.8 Audit: observations, not claims (`ArtisanProfiler.js`)

- `smokingGuns[]` keeps its key and `culprit`/`severity`/`impactMs`/`jitterMs`. It **drops `actionTaken` and `rootCause` narratives** and adds `observation` (the measured delta sentence), `recommendation` (explicitly "not applied"), `status:'OBSERVED'`, and `repairApplied:false`. A repair may only be reported if a future code path applies it and re-measures it; none exists in P0.5.
- The verdict becomes `OBSERVED <n> FINDING(S) ABOVE THRESHOLD` or `NO FINDING ABOVE THRESHOLD`. No FPS claim unless measured: the report carries `baselineFps = 1000/baseline.avg`.
- `device.gpu` is the real renderer string (the same source RTSS uses). `device.webglVersion` replaces the old `gpuRenderer:'WebGL 2.0'`, and `gpuRenderer` is kept as an alias holding the GPU string for compatibility.
- The report gains `scene:{sceneIdentity, epochStart, epochEnd, entityIds}` from `getRenderState()`. An audit whose epoch changed is invalid.
- **State restoration is exact.** Pixel ratio, shadow `autoUpdate`/`needsUpdate`, `castShadow`, `envMapIntensity`, and entity visibility all return to their pre-audit values. The report carries `restoredState:{pixelRatioBefore, pixelRatioAfter, ok}`.
- The UI log prints "Observed:" instead of "Fix:". The Markdown uses "Observation" and "Recommendation (not applied)". `run_perf_audit.js` prints `observation`.

---

## 4. Rejected alternatives

| # | Alternative | Why rejected |
|---|---|---|
| R1 | Exit the process on `EADDRINUSE` (hard fail-fast) | Kills authoring and validation too. One stale or orphaned owner would brick every new client session. MCP clients surface an opaque "server failed to start" rather than an actionable diagnosis. |
| R2 | Auto-fallback to another or ephemeral port | Creates a bridge no Studio tab can discover (the Studio tries only 3456/9900), which recreates the "UI connected to a different instance" confusion. |
| R3 | A shared bridge broker multiplexing MCP instances | New cross-process trust model and protocol; P1+ scope. |
| R4 | Takeover (the new instance asks the owner to yield) | Cross-process control; can steal a live user's session. |
| R5 | Lockfile or instance registry on disk | Needs fs writes outside `artifacts.js` (a drift-policy change) and leaves stale locks on crash. The port bind is already an atomic lock, and the identity endpoint gives the diagnosis. |
| R6 | The browser echoes the MCP-sent identity | An echo proves nothing. The browser must recompute from what it compiled and report rendered entity ids. |
| R7 | Pass the manifest to headless through a URL parameter or temp file | Size and data-exposure risk, and the temp file breaks write confinement. `page.evaluate` arguments carry it in memory. |
| R8 | Keep `page.screenshot`; hide overlays with CSS | Brittle as overlays are added. The canvas is the ground truth. |
| R9 | New tools (`load_world`, `verify_evidence`) or new args (`clean`, `outDir`) | Only about 127 chars of schema headroom (E16), and P1 plans an 11-tool consolidation. Everything here uses existing args. |
| R10 | Hash preset manifests like authored ones | `loadScene` adds camera and lighting logic, and `fantastic` is procedural, so a manifest hash would not prove the render. The `preset:<id>` namespace is honest. |
| R11 | Auto-push the manifest when the live identity is stale | Hidden side effect that changes the user's live view mid-inspection. An explicit `PREVIEW_STALE` plus `compile_preview` is deterministic. |
| R12 | Delete the audit's `smokingGuns` or rename the schema | Breaks `index.js` picks and E2E. Semantics change; structure stays. |
| R13 | Optimize draw calls inside P0.5 to meet the 30-draw acceptance | Moved to P0.6 (`BUILD-AUTHORED-BUDGET`), which also blocks P1. Inside P0.5 it would validate an optimization with an unproven instrument and mix protocol and rendering risk in one rollback unit (§0, D-1). |
| R14 | Weaken or waive the 30-draw criterion, or swap the replay fixture | Violates integrity. The criterion is kept verbatim and owned by P0.6. |

---

## 5. Exact file allowlist

Every write in execution must be one of these files. Anything else means stop (S-4).

### 5.1 Modify: product and MCP source

| File | Change | Preserve (gate-bearing text) |
|---|---|---|
| `mcp-server/bridge.js` | instanceId, protocol v2 HELLO/ACK, per-socket client registry, verified routing, same-socket reply binding, `conflict`/`disabled` states, owner probe, lazy re-acquire, `/api/bridge/identity`, `publishWorld` | `export const REPLY_TYPES` (VIS-4); `const WS_PORT = process.env.MCP_WS_PORT` (INT-2); `BRIDGE_HOST = '127.0.0.1'` and `listen(WS_PORT, BRIDGE_HOST` (drift); origin/host policy, 64 KB body cap, vault sanitizer |
| `mcp-server/index.js` | evidence resolution (§3.5), ack verification (§3.6), new error codes, evidence envelopes, `safeArtifactRelPath` for `filename`, `lastVerifiedRender`, capabilities `previewBridge` v2, corrected `knownLimits` text, tool-description edits within budget (§6) | 13 tools, all input schemas unchanged; no `enum: [` literals (drift); `commitCandidate` validation-before-commit |
| `mcp-server/HeadlessRunner.js` | `renderEvidence({manifest|scene, expectedIdentity, angle, want})`; authored-manifest injection; `waitForSettled`/`measureRender`/`captureCanvas`; identity check **before** writes; `STUDIO_UNREACHABLE`; the three legacy exports become thin wrappers | `?mcpBridge=off` on headless pages; ANGLE D3D11 args; throwaway profile dirs; **keep ≥5 helper write sites across mcp-server** (the drift check's `helperWrites >= 5`; writes stay in HeadlessRunner and index.js; never lower the threshold) |
| `mcp-server/artifacts.js` | `safeArtifactRelPath`, confined `mkdir`, realpath/junction confinement | `safeArtifactPath` semantics; `writeArtifact`/`writeArtifactAt`/`assertInsideArtifacts`; browser-profile helpers; "ONLY fs-mutating module" rule |
| `mcp-server/WorldSession.js` | compute identity through the contract helper (byte-identical output) | undo stack; `sceneIdentity()` output bytes |
| `src/contracts/artisanContract.js` | **additive only**: `BRIDGE_PROTOCOL = 2`, `SCENE_IDENTITY_PREFIX`, `SCENE_IDENTITY_HEX_CHARS = 32`, `formatSceneIdentity(hex)`, `async computeSceneIdentity(manifest, subtle = globalThis.crypto?.subtle)` | every existing export untouched (`LIGHTING_PROFILES` VIS-3, catalogs, `canonicalJson`) |
| `src/main.js` | §3.4 render state, `applyAuthoredManifest` extraction, `waitForSettled`/`measureRender`/`captureCanvas`, HELLO/ACK, pinning, serialized queue, identity in all replies, indicator label | `const MCP_WS_PORTS = [3456, 9900]` (INT-3); `SingleInstanceGuard.getInstance().acquire` (LIFE-5); `// VAULT: Live Cabinet Visual Deck` (CAB-3); `?mcpBridge=off`, `?mcpPort=` |
| `src/engine/ArtisanProfiler.js` | §3.8 | `// OMEGAMON: Process Hierarchy Telemetry` (INT-1); phase order and sample counts; `smokingGuns`/`telemetry`/`device`/`verdict` keys |
| `scripts/run_perf_audit.js` | one line: print `observation` instead of `actionTaken`; neutral completion line | everything else |

### 5.2 Modify: tests and gates

| File | Change |
|---|---|
| `mcp-server/test_ws_bridge.js` | Fake Studio speaks v2 (HELLO_ACK, recomputed identity, `renderedEntityIds`). Broadcast check becomes `WORLD_UPDATE`. The traversal case changes from "confined at root" to "`INVALID_FILENAME`, no file anywhere". Add a subdirectory-preserved case, same-socket and instanceId reply-binding unit checks, and an unverified-client check. All 33 existing check names are kept or replaced one-for-one (listed in the baseline JSON). |
| `mcp-server/test_stdio_client.js` | Touch **only if needed**: tools == 13 and footprint ≤ 2,000 tokens stay; optionally assert `bridge.state==='disabled'` under `ARTISAN_BRIDGE=off`. |
| `scripts/verify_astra_harness.mjs` | Add suite gate `mcp-evidence-integrity-node` running `mcp-server/test_evidence_integrity.js --json`. The E2E page URL gains `&mcpInstance=<id>`. `e2e-live-preview` also requires `ack.sceneIdentity === preview.sceneIdentity`. `e2e-screenshot` and `e2e-telemetry` require `evidence.identityVerified`. `e2e-headless-fallback` requires `evidence.sceneIdentity==='preset:winterhold' && authored===false`. `e2e-audit-bounded` stays < 6,000 chars (the audit response carries an entity **count**, not the id list). No gate id is removed or renamed. |
| `scripts/check_contract_drift.mjs` | Two **additive** static checks: (a) `HeadlessRunner.js` contains no `page.screenshot(` call; (b) `ArtisanProfiler.js` and `run_perf_audit.js` contain none of `actionTaken`, `'MITIGATED'`, `'RESOLVED'`, `ZERO GUESSWORK`, `LOCKED 60 FPS`. No existing check or threshold changes. |

### 5.3 Create

| File | Purpose |
|---|---|
| `mcp-server/test_evidence_integrity.js` | Node-level red/green suite (§10.1). `test_` prefix, so it is excluded from the fs scan. |
| `scripts/verify_mcp_evidence_integrity.mjs` | The single deterministic verification script (§11), including both replays (§12) |
| `docs/specs/SPEC-08-MCP-EVIDENCE-INTEGRITY.md` | Normative spec (identity model, protocol v2, evidence rule, error codes, capture/artifact rules, audit semantics); required by gate P9 |
| `.bridge/ARTISAN-MCP-EVIDENCE-INTEGRITY-BASELINE.json` | Pre-change SHA-256 of every allowlisted file, the list of files to be created, P0 gate baseline, the recorded red results |
| `.bridge/ARTISAN-MCP-EVIDENCE-INTEGRITY-WORKLOG.jsonl` | Append-only execution log |
| `.bridge/ARTISAN-MCP-EVIDENCE-INTEGRITY-HANDOFF.json` | Phase-boundary and final handoff |
| `.bridge/ARTISAN-MCP-EVIDENCE-INTEGRITY-ACCEPTANCE.json` | Written **only** after a run with `overall==='PASS'` (`EVI-6` evidence). It always states the `authored_budget` result. |
| `.bridge/ARTISAN-AUTHORED-BUDGET-ACCEPTANCE.json` | Written **only** if the same run has `authoredBudget==='PASS'` (`ABG-1` evidence). Otherwise it is P0.6's deliverable. |

### 5.4 Governance and doc edits (§13)

`PLAN.json`, `FINDINGS.json`, `board.html` (regenerated by `python make_board.py`, never hand-edited), `.bridge/ARTISAN-VISIBILITY-CREATIVE-PLAN.md` (append a prerequisite section only), `CLAUDE.md` (+1 command line), `AGENTS.md` (+1 rule line under "MCP / Astra harness").

### 5.5 Generated (tool output, not authored)

- `.snapshots/pre_p05_*.zip` (made by `scripts/rollback.py --snapshot`)
- `.artisan-artifacts/verify-evidence/latest/**`
- `.artisan-artifacts/verify/**` (harness)

### 5.6 Forbidden in P0.5

`WorldCompiler.js`, all `src/foundry/**`, `UniversalFoundry.js`, `MaterialFoundry.js`, `LightingRig.js`, `RivaTunerOSD.js`, `SpatialValidator.js`, `src/presets/**`, `mcp-server/Validator.js`, `mcp-server/catalogs.js`, `mcp-server/knowledge/**`, `plugins/**` (including `.mcp.json` and `SKILL.md`), `index.html`, `src/style.css`, `package.json` and lockfiles (**no new dependencies**), `HARNESS-SIJ.json`, `scripts/gate.py`, `make_board.py`, `test_spatial_laws.js`, the dogfood evidence folder (read-only fixture), all P0 historical `.bridge` records, and anything under `C:/Users/Fabio D/Desktop/THREEJS_HARNESSING`.

---

## 6. Tool-surface budget (hard)

- Tools stay at **13**, and no input argument is added, removed, or retyped. Output schemas are unchanged; the new fields ride in the "extra fields allowed" objects.
- **Cap:** `JSON.stringify(tools).length ≤ 7,960` chars (≈1,990 tokens; the gate is 2,000). Current is 7,873, so edits may add at most **87 chars net**.
- Preferred description edits (≈ +50 chars total):
  - `capture_viewport_screenshot`: "Save a clean canvas PNG of the authored world (preset if scene set) to artifacts; filename may include subdirs."
  - `import_telemetry_logs`: "Save identity-verified engine telemetry + manifest as a JSON artifact."
  - `compile_preview`: "Validate, push to the live Studio and await its verified compile ack."
- If the cap would be exceeded, move the subdirectory note into the `artisan://capabilities` resource (`artifactNaming`) instead.

---

## 7. Compatibility

| Surface | Before | After | Notes |
|---|---|---|---|
| MCP tools | 13 | 13, same inputs | outputs are supersets, except the new refusal errors below |
| `compile_preview`, port conflict | ok, `livePreview:false` | **error `BRIDGE_CONFLICT`** | intentional; the core of RC-1 |
| `compile_preview`, `ARTISAN_BRIDGE=off` | ok, `livePreview:false` | same, plus `bridge.state:'disabled'` | stdio test unchanged |
| Evidence while live Studio shows something else | mislabeled success | **`PREVIEW_STALE`** | fix: `compile_preview` |
| Headless without `scene` | trio page (telemetry), tokyo (audit), trio (screenshot) | **authored world** | preset still available with `scene` |
| Screenshot `filename` with subdirs | dirs dropped silently | dirs preserved | traversal / absolute / reserved names now **rejected** (`INVALID_FILENAME`) instead of silently flattened |
| Screenshot content | page including overlays | canvas only | same 1280×720 |
| Audit report | `actionTaken`, `RESOLVED/MITIGATED`, rhetorical verdict | `observation`, `recommendation`, `OBSERVED`, `repairApplied:false`, measured verdict | `smokingGuns`/`verdict`/`telemetry` keys kept; `gpuRenderer` kept as an alias |
| Audit side effect | DPR clamped to ≤1.0 afterwards | exact restore | HiDPI live users keep their DPR |
| Repaired Studio ↔ legacy MCP (e.g. a still-running PID 4424) | — | no HELLO → label "UNVERIFIED legacy"; legacy bare-manifest rendering kept | lets rollback work without reloading tabs |
| Legacy Studio tab ↔ repaired MCP | — | unverified socket; `STUDIO_UNVERIFIED` until the tab is reloaded | never silently used |
| Codex plugin `.mcp.json` | launches the repo `index.js` | unchanged | running processes keep old code until the owner restarts them (not the executor) |
| Env vars | `MCP_WS_PORT`, `ARTISAN_BRIDGE`, `ARTISAN_STUDIO_URL`, `ARTISAN_ARTIFACTS_DIR` | same; no new required vars | — |
| `sceneIdentity` bytes | sha256 of canonicalJson, 32 hex | identical | proven against `sha256:f4bb39db91d785d657fb56059e7222f4` |

---

## 8. Rollback strategy

The repository has a single initial commit and a large uncommitted, partly untracked tree (including `bridge.js` and `artifacts.js`), so **git is not the rollback mechanism**.

1. **Before any edit:** `python scripts/rollback.py --snapshot pre_p05_evidence_integrity`, then record SHA-256 of every §5.1–5.4 existing file, and the list of §5.3 files to be created, in the baseline JSON. Repeat the snapshot at each phase boundary (`pre_p05_phase<N>`).
2. **Targeted restore only.** Never use `rollback.py --restore`: it extracts the whole tree, overwrites unrelated work and the artifacts, and deletes nothing. Instead, extract **only** allowlisted members from the phase snapshot zip (a Python `zipfile` loop over the allowlist from the baseline JSON), then delete that phase's newly created files.
3. **After any restore:** re-hash the restored files against the baseline, run `python make_board.py`, then `python scripts/gate.py` and `node scripts/verify_astra_harness.mjs`. Rollback is accepted only if P0 is back to **29 passing gates plus the one pre-existing non-blocking `preset-profile-budgets`**.
4. **Governance is not rolled back with code.** The `BUILD-EVIDENCE` nodes stay `approved`, so a code rollback never unblocks P1. Only the owner may remove the blocker.
5. **Runtime rollback for users:** restart the MCP client sessions. A repaired Studio still works against legacy MCPs (§7).

---

## 9. Execution phases

Each phase ends with its listed checks green, a worklog entry, a snapshot, and, where the phase lands an `EVI-*` evidence symbol, flipping that phase's `intent` to `closed` in the same step and then running `python make_board.py && python scripts/gate.py` (gate P4 fails if landed evidence stays `approved`).

- **Phase 0 — Baseline, blocker, red tests (no product-source edits)**
  1. Snapshot; baseline hashes; verify fixture integrity (`authored-world.json` SHA-256 `85A83B04…448C0F` and `tool-call-log.json` `2C689805…B89304` match `evidence-files.json`).
  2. Governance first: add `BUILD-EVIDENCE` with `EVI-1..6`, `BUILD-AUTHORED-BUDGET` with `ABG-1`, the dependency edges, the five findings, and `SPEC-08`; regenerate the board; `gate.py` must pass. P1 is now mechanically blocked.
  3. Write `test_evidence_integrity.js` and `verify_mcp_evidence_integrity.mjs` so they tolerate missing fields and report FAIL rather than crash.
  4. Run both against unmodified code. **Every red test in §10 must FAIL as predicted.** Record per-test results in the baseline JSON. If any passes, stop (**S-2**).
  5. Record the P0 harness baseline.
- **Phase 1 — Artifacts (`EVI-1`):** `safeArtifactRelPath` plus realpath confinement. Green: T-ART-1..5.
- **Phase 2 — Identity core in the browser and contract (`EVI-2` part):** contract helpers, WorldSession delegation, `main.js` render state, `applyAuthoredManifest` extraction, `waitForSettled`/`measureRender`/`captureCanvas`, serialized queue, v2 client handshake and pinning. Green: T-BRW-1..4.
- **Phase 3 — Bridge v2 and conflict (`EVI-2`):** the §3.2–3.3 server side. Green: T-BRG-1..7. *(Session split point: write the handoff, suggest `/clear`.)*
- **Phase 4 — Evidence tools and headless authored path (`EVI-3`, `EVI-4`):** §3.5–3.7 in `index.js` and `HeadlessRunner.js`, description edits within §6. Green: T-EVD-1..8.
- **Phase 5 — Audit semantics (`EVI-5`):** §3.8, `run_perf_audit.js`. Green: T-AUD-1..4.
- **Phase 6 — Gate updates and full verification:** §5.2 edits, then **one** run of `node ~/.claude/tools/synapse/synapse.js wrap -- node scripts/verify_mcp_evidence_integrity.mjs`. Read the tail and the report JSON.
- **Phase 7 — Closeout (conditional):** only on `overall==='PASS'`, run the §14.3 closeout, regenerate the board, run the gate, write the handoff, and **stop** (S-1). The authored-budget result decides whether P0.6 closes now or is planned next; it never blocks the P0.5 closeout and is never hidden.

---

## 10. Tests that fail before the repair

All must be observed FAILING on baseline in Phase 0, with the reason recorded.

### 10.1 `mcp-server/test_evidence_integrity.js` (Node; no browser; hermetic free ports; temp artifact dirs)

| ID | Test | Why it fails today |
|---|---|---|
| T-BRG-1 | A decoy HTTP listener owns port P; an MCP started with `MCP_WS_PORT=P` has `previewBridge.state==='conflict'` and `owner.kind==='foreign'` | no `state`; only `listening:false` |
| T-BRG-2 | In that conflict, `compile_preview` returns `isError` with code `BRIDGE_CONFLICT`, and the message contains the port, the instance id, `MCP_WS_PORT` and `mcpInstance=` | returns ok with `livePreview:false` (E3) |
| T-BRG-3 | Two MCPs on the same P: B's `owner.kind==='artisan'` and `owner.instanceId === A.instanceId` (read from A's capabilities and `/api/bridge/identity`) | no instanceId, no endpoint |
| T-BRG-4 | A fake Studio's first message is `BRIDGE_HELLO` with the instanceId shown in capabilities | first message is `cabinet_init` or none |
| T-BRG-5 | A client that never sends HELLO_ACK: `compile_preview` returns `STUDIO_UNVERIFIED` and `studioClients===0` | any socket counts and acks |
| T-BRG-6 | Unit: a reply with the right id from a *different* socket, or with a wrong instanceId, is ignored (times out) | resolves from any socket (E9) |
| T-BRG-7 | Lazy re-acquire: after the decoy closes, the next `compile_preview` rebinds and `state==='listening'` | no retry path |
| T-EVD-1 | Fake Studio acks with a wrong or missing `sceneIdentity`, a wrong version, a missing entity id, or a wrong instanceId: each gives `ACK_MISMATCH` with the field named | ack fields unchecked (E8) |
| T-EVD-2 | Fake Studio recomputes the identity correctly: ok, `ack.sceneIdentity === summary.sceneIdentity`, 13 `renderedEntityIds` | ack has no identity |
| T-EVD-3 | Fake Studio reports `render.sceneIdentity='preset:trio'`: `get_engine_telemetry`, `capture_viewport_screenshot` (no scene), `run_performance_audit` (no scene) and `import_telemetry_logs` each fail with `PREVIEW_STALE`, and **no file** appears in the artifact dir | all succeed; import stamps the authored identity (E6, E7) |
| T-EVD-4 | `ARTISAN_BRIDGE=off`: `compile_preview` ok, `bridge.state==='disabled'` | no `state` field |
| T-EVD-5 | Identity parity: WorldSession sync identity == contract `computeSceneIdentity` (webcrypto) == `sha256:f4bb39db91d785d657fb56059e7222f4` for `authored-world.json` | helper does not exist |
| T-ART-1 | `filename:'dogfood/p1/x.png'` lands at `<artifacts>/dogfood/p1/x.png` | basename-stripped to the root (E11) |
| T-ART-2 | `'..\\..\\Windows\\evil.png'`, `'C:/x.png'`, `'\\\\srv\\s\\x.png'`, `'con.png'`, a 5-segment path: each gives `INVALID_FILENAME`, no file anywhere | silently confined to the root |
| T-ART-3 | A junction `<artifacts>/link → <tmp>/outside`, then `filename:'link/x.png'`, gives `ARTIFACT_PATH_ESCAPE` and nothing written outside | no realpath check (function absent) |
| T-ART-4 | Sanitized characters (`a<b>.png`) are reported with `normalized:true` | field absent |
| T-ART-5 | The existing `safeArtifactPath` traversal unit check still confines to the root (regression guard; passes before and after) | *(guard, not red)* |

### 10.2 Browser-level stage of `verify_mcp_evidence_integrity.mjs` (own Vite; headless Edge/Chrome; `?mcpBridge=off` unless stated)

| ID | Test | Why it fails today |
|---|---|---|
| T-BRW-1 | `await __artisan.computeSceneIdentity(authored-world.json) === 'sha256:f4bb39db91d785d657fb56059e7222f4'` | function absent |
| T-BRW-2 | `applyAuthoredManifest(authored)` gives `renderedEntityIds` set-equal to the 13 manifest ids, and `getRenderState().sceneIdentity` equals the above | function absent |
| T-BRW-3 | **Clean canvas:** inject a full-screen `#FF00FF` fixed overlay at max z-index. `captureCanvas()` PNG has ≤ 0.1% magenta pixels, while the negative control `page.screenshot()` has ≥ 99% magenta. PNG is 1280×720. | `captureCanvas` absent; the headless path uses `page.screenshot` |
| T-BRW-4 | **Pinning:** an MCP instance on port P, plus a page `?mcpPort=P&mcpInstance=00000000-…`, gives the label `MCP: WRONG INSTANCE`, and the MCP's `studioClients===0` | connects to any instance |
| T-AUD-1 | After `applyAuthoredManifest` and a fixed (non-auto) DPR preset, `renderer.setPixelRatio(1.5)` then `runAudit()` leaves `getPixelRatio()===1.5` and `restoredState.ok===true` | restores `min(1.5,1.0)=1.0` (E13) |
| T-AUD-2 | Report: no `actionTaken` key; every smoking gun has `status==='OBSERVED' && repairApplied===false`; the verdict has no "ZERO GUESSWORK" or "LOCKED 60 FPS" | canned claims (E12) |
| T-AUD-3 | `report.scene.sceneIdentity === f4bb…`, `epochStart===epochEnd`, and every `entityDeltas[].name` is in the manifest ids | no `scene` block |
| T-AUD-4 | `device.gpu` is a non-empty GPU string, not `'WebGL 2.0'` | literal 'WebGL 2.0' |
| T-EVD-6 | MCP with bridge listening and no client: `capture_viewport_screenshot` (no scene) has `source:'headless'`, `evidence.sceneIdentity===f4bb…`, `identityVerified:true`, 13 entities | renders trio/default; no identity (E5) |
| T-EVD-7 | Same for `get_engine_telemetry` and `run_performance_audit` (no scene): headless authored, identity f4bb, audit entity names come from the manifest | trio telemetry; **tokyo** audit |
| T-EVD-8 | `capture_viewport_screenshot {scene:'alchemist'}`: `evidence.sceneIdentity==='preset:alchemist'`, `authored:false`, no authored identity or manifest in the response | live returns `null`; headless returns nothing |

Static red checks (drift additions, §5.2): `HeadlessRunner.js` has no `page.screenshot(` (fails today at line 86); no claim tokens in `ArtisanProfiler.js` or `run_perf_audit.js` (fails today).

---

## 11. The single deterministic verification script

**Command** (the only acceptance command):

```
node ~/.claude/tools/synapse/synapse.js wrap -- node scripts/verify_mcp_evidence_integrity.mjs
```

`--skip-p0` exists for inner dev loops only; an acceptance run must use no flags.

**Determinism rules:**
- fixed candidate port lists that exclude 3456, 9900 and 5173 (Vite 5189/5188/5187; bridges 3481–3489);
- the script refuses to run rather than kill anything if no candidate is free;
- viewport 1280×720, DPR 1, fixed DPR preset, camera `hero`;
- identities are content hashes;
- artifacts go to a fixed `.artisan-artifacts/verify-evidence/latest/`, removed at start;
- FPS is reported, never gated.

**Stages** (each stage appends gates `{id, status, evidence, blocking}`):

| Stage | What |
|---|---|
| S0 Preflight | Node ≥ 22; browser found; ports free; fixture SHA-256 match `evidence-files.json`; project tree hash (same exclusions as the harness) |
| S1 Static | `node scripts/check_contract_drift.mjs --json`; `python scripts/gate.py` |
| S2 Node suites | `test_stdio_client.js`, `test_ws_bridge.js`, `test_evidence_integrity.js` (all `--json`) |
| S3 Browser units | T-BRW-1..4, T-AUD-1..4 |
| S4 Replay LIVE | §12.1 |
| S5 Replay CONFLICT | §12.2 |
| S6 Acceptance | §12.3 measurements and A-1..A-11 |
| S7 P0 regression | `node scripts/verify_astra_harness.mjs`: all blocking gates pass, `preset-profile-budgets` is still the only non-blocking fail, preset draws unchanged (16/17/25/22/28/45/39/58), tools 13, schema ≤ 2,000 tokens |
| S8 Integrity | tree hash unchanged outside the artifact root (only artifacts written) |

**Output:** `.artisan-artifacts/verify-evidence/latest/evidence_integrity_report.json` with:
- `verdict:{integrity, budgetInstrument, p0, overall, authoredBudget}`;
- the identity table (one row per evidence kind: identity, source, instanceId, clientId, path, sha256);
- measurements;
- PNG paths and hashes.

`overall` (the P0.5 verdict) is `integrity && budgetInstrument && p0`. `authoredBudget` is the truthful ≤30/≤15,000 verdict on the replay world. It is printed on its own line in the console, for example `AUTHORED BUDGET: FAIL 56/30 draws, 12,870/15,000 tris, 58.9 FPS — owned by BUILD-AUTHORED-BUDGET (P0.6), blocks P1`. It is never folded into `overall` and never hidden.

Exit code 0 only when `overall==='PASS'`. The console tail prints all five verdict lines and the report path. P0.6 re-runs this script, and its acceptance requires `authoredBudget==='PASS'` as well.

---

## 12. Replay acceptance test (`authored-world.json`)

The replay source is the 15 mutating calls in `.artisan-artifacts/dogfood/p1-current-harness/tool-call-log.json` (steps 1–14 and 22, exact `args`). Cross-check: the final manifest must deep-equal `authored-world.json`, and the identity must be `sha256:f4bb39db91d785d657fb56059e7222f4`. The fixture folder is read-only.

### 12.1 R-LIVE (the intended path)

1. Start own Vite on a free port. Start MCP **A** with a free bridge port and `ARTISAN_ARTIFACTS_DIR=…/latest/mcp-live`. Open a headless Studio page `?mcpPort=<pA>&mcpInstance=<A.instanceId>` and wait for `studioClients===1` (verified).
2. Replay the 15 calls, then `validate_scene` (expect 0 errors, 0 warnings, 13 entities).
3. `compile_preview {timeoutMs:20000}`: verified ack.
4. `get_engine_telemetry {profile:'diorama'}`.
5. `capture_viewport_screenshot {filename:'replay/live/authored-hero.png', angle:'hero'}`.
6. `import_telemetry_logs`, then `get_telemetry {includeManifest:true}`.
7. `run_performance_audit` (no scene).
8. **Negative leg:** from the page, `__artisan.loadScene('alchemist')`. Then `get_engine_telemetry`, `import_telemetry_logs` and `run_performance_audit` (no scene) must each return `PREVIEW_STALE` and create no file. `capture_viewport_screenshot {scene:'alchemist', filename:'replay/live/preset-alchemist.png'}` must be labeled `preset:alchemist`, `authored:false`.

### 12.2 R-CONFLICT (the dogfood failure, reproduced and fixed)

1. Start decoy MCP **D** on bridge port `pD` with a different world (`create_world decoy_world` plus one barrel). Connect a Studio page to D (verified), mirroring the dogfood's "UI connected to another instance".
2. Start MCP **B** with `MCP_WS_PORT=pD` and `ARTISAN_ARTIFACTS_DIR=…/latest/mcp-conflict`.
3. Replay the same 15 calls into B.
4. Expect:
   - B's capabilities show `state:'conflict'`, `owner.kind:'artisan'`, `owner.instanceId===D.instanceId`;
   - B's `compile_preview` fails with `BRIDGE_CONFLICT` and actionable text;
   - B's `capture_viewport_screenshot {filename:'replay/headless/authored-hero.png', angle:'hero'}`, `get_engine_telemetry`, `import_telemetry_logs` and `run_performance_audit` all return `source:'headless'`, identity f4bb, `identityVerified:true`, `renderer.instanceId===B.instanceId`, and a `bridge.state:'conflict'` notice;
   - D's page render state is not f4bb;
   - no artifact in either artifact dir is labeled f4bb unless its renderer is A's verified client or B's headless run.

### 12.3 Measurements

- **Budget** comes from the S5 headless authored evidence render: settled, `measureRender({frames:120})`, 1280×720, DPR 1, `hero`. Report `drawCalls` (max), `triangles` (max), mean and p95 frametime, FPS, GPU, `isSoftwareRasterizer`.
- Report the R-LIVE settled numbers alongside. Live and headless draws and triangles must be equal (same compile path, camera, viewport); any difference is a blocking integrity failure.
- **Instrument correctness (the budget gate must be able to say both PASS and FAIL):**
  - A **control world** made of the first three replay entities (`study-shell`, `worktable`, `water-barrel`; static estimate 4+4+2+1 = 11 draws) must yield `withinBudget:true`.
  - The replay world must yield `withinBudget === (drawCalls ≤ 30 && triangles ≤ 15,000)`.
  - Measured draws must be ≤ the static full-scene count from the in-memory estimator (the §0 method, reimplemented inside the script). Measured > static means the measurement is wrong, which is a blocking failure.

---

## 13. Acceptance criteria

| ID | Criterion | Blocking |
|---|---|---|
| A-1 | Replay fidelity: deep-equal manifest; `sha256:f4bb39db91d785d657fb56059e7222f4`; v15; 13 entities; 0 errors, 0 warnings | yes |
| A-2 | R-LIVE compile ack verified: identity, worldId, version 15, entityCount 13, 13 `renderedEntityIds` set-equal, instanceId/clientId of the pinned page, `settled:true` | yes |
| A-3 | **Same `sceneIdentity` across compile ack, screenshot, engine telemetry, export (the `import_telemetry_logs` file *and* the `get_telemetry` manifest export) and audit**, all `identityVerified:true`, same instanceId and clientId in R-LIVE | yes |
| A-4 | R-CONFLICT: conflict state with the correct owner; `BRIDGE_CONFLICT`; all four evidence kinds headless-verified f4bb with B's instanceId; no cross-instance labeling | yes |
| A-5 | Refusal: `PREVIEW_STALE` with no files when the live page shows a preset; the preset capture is labeled `preset:alchemist` with no authored identity or manifest | yes |
| A-6 | **Authored-world measurement (instrument):** replay draws, triangles, FPS (mean, p95 frametime), GPU and `isSoftwareRasterizer` measured settled and reported; FPS finite > 0; live == headless for draws and triangles; control world `withinBudget:true`; replay verdict correct; measured ≤ static count (§12.3) | yes, for P0.5 |
| A-12 | **Authored-world budget conformance:** unmodified replay `drawCalls ≤ 30` and `triangles ≤ 15,000` (`authoredBudget==='PASS'`), with visual parity | reported by P0.5 (**predicted FAIL: ≈56 draws**); **blocking for P0.6 and therefore for P1** |
| A-7 | **Clean screenshot evidence of the authored 13-entity world:** canvas-sourced PNG 1280×720 at the requested subdirectory (live and headless); T-BRW-3 magenta test with negative control; non-blank (luma std-dev ≥ 10, mean 20–235); 13/13 entity groups intersect the camera frustum (reported as "inFrustum", not "visible"); PNG SHA-256 in the response and the report | yes |
| A-8 | Artifact confinement: T-ART-1..5; harness `no-writes-outside-artifacts` passes | yes |
| A-9 | Audit semantics: T-AUD-1..4; the audit in A-3 has no canned claims and `repairApplied:false` | yes |
| A-10 | P0 preservation: S1, S2 and S7 all green; 13 tools; schema ≤ 7,960 chars; preset draws unchanged; `gate.py` P1–P10 pass | yes |
| A-11 | Identity surfaces agree: capabilities, `/api/bridge/identity`, Studio indicator short id, and the evidence envelopes | yes |

---

## 14. Governance updates (make P0.5 a blocker before `BUILD-CREATIVE`)

All applied in **Phase 0**, before any source edit, so the blocker exists even if execution stops early.

### 14.1 `PLAN.json`: add a build and six phases

```json
{ "id": "BUILD-EVIDENCE", "kind": "build", "arc": "ARC-INTEGRATION",
  "title": "SPEC-08 P0.5: MCP evidence integrity",
  "plain": "Verifiable MCP/browser instance identity; loud bridge conflicts; compile acks, screenshots, telemetry, exports and audits bound to the scene the renderer proved it drew; headless renders the authored manifest; clean canvas captures in requested subdirectories; audits report observations, not repairs.",
  "intent": "approved", "depends_on": ["BUILD-VIS"], "guard": [], "owner_decides": null,
  "buys": "dogfood evidence can be trusted to belong to the world the LLM authored",
  "spec": "docs/specs/SPEC-08-MCP-EVIDENCE-INTEGRITY.md", "mode": "spec_driven",
  "closes_findings": ["FND-MCP-BRIDGE-SILENT-CONFLICT", "FND-MCP-EVIDENCE-PROVENANCE", "FND-MCP-CAPTURE-OVERLAY-SUBDIR", "FND-AUDIT-CANNED-REPAIR-CLAIMS"] }
```

Phases (`kind:"phase"`, `parent:"BUILD-EVIDENCE"`, `arc:"ARC-INTEGRATION"`, `intent:"approved"`, `guard:[]`, `owner_decides:null`). None of these evidence strings exists today, so gate P4 holds.

| id | title | depends_on | evidence file | evidence symbol |
|---|---|---|---|---|
| EVI-1 | Confined artifact subdirectories | [] | `mcp-server/artifacts.js` | `export function safeArtifactRelPath` |
| EVI-2 | Bridge instance identity & loud conflicts | [] | `mcp-server/bridge.js` | `'BRIDGE_HELLO'` |
| EVI-3 | Verified compile acknowledgement & evidence binding | ["EVI-2"] | `mcp-server/index.js` | `ACK_MISMATCH` |
| EVI-4 | Authored-manifest headless render, clean canvas | ["EVI-1"] | `mcp-server/HeadlessRunner.js` | `export async function renderEvidence` |
| EVI-5 | Measured audit observations | [] | `src/engine/ArtisanProfiler.js` | `repairApplied: false` |
| EVI-6 | Evidence-integrity acceptance recorded | ["EVI-1","EVI-2","EVI-3","EVI-4","EVI-5"] | `.bridge/ARTISAN-MCP-EVIDENCE-INTEGRITY-ACCEPTANCE.json` | `"evidence_integrity_acceptance": "PASS"` |

**Also add the P0.6 build and its phase now** (intent `draft`; the owner approves its plan later; no `spec` field until its plan exists, so gate P9 holds):

```json
{ "id": "BUILD-AUTHORED-BUDGET", "kind": "build", "arc": "ARC-PERFORMANCE",
  "title": "SPEC-08 P0.6: Authored-world budget conformance",
  "plain": "The unmodified dogfood replay world renders at <= 30 draws and <= 15,000 triangles, measured by the P0.5 instrument, with visual parity and per-entity identity preserved.",
  "intent": "draft", "depends_on": ["BUILD-EVIDENCE"], "guard": [], "owner_decides": null,
  "buys": "a realistic 13-entity authored room fits the diorama budget before creative features add to it",
  "closes_findings": ["FND-AUTHORED-REPLAY-DRAW-BUDGET"] }
```

| id | parent | title | depends_on | evidence file | evidence symbol |
|---|---|---|---|---|---|
| ABG-1 | BUILD-AUTHORED-BUDGET | Authored replay within budget, parity proven | ["EVI-6"] | `.bridge/ARTISAN-AUTHORED-BUDGET-ACCEPTANCE.json` | `"authored_budget_acceptance": "PASS"` |

**Blocking edges:**
- `BUILD-CREATIVE.depends_on` becomes `["BUILD-VIS", "BUILD-EVIDENCE", "BUILD-AUTHORED-BUDGET"]`.
- `CRE-1.depends_on` becomes `["EVI-6", "ABG-1"]`. `CRE-2` already depends on `CRE-1`.

Effect: gate **P3** fails the moment any P1 phase lands before *both* acceptance records exist. The harness runs `gate.py` as the blocking gate `sart-gate-P1-P10`, so P1 cannot pass verification early. The graph stays acyclic (P2).

### 14.2 `FINDINGS.json`: five open findings

Each has `expected_failures: []` (gate P6 is called with no actual failures), `owner: "BUILD-EVIDENCE"`, `opened_on: "2026-09-22"`, `opened_by: "P1 current-harness dogfood"`, evidence citing §1, and `disposition: "open"` until closeout.

- `FND-MCP-BRIDGE-SILENT-CONFLICT`: a second MCP instance silently lost the live bridge while the Studio stayed connected to another instance.
- `FND-MCP-EVIDENCE-PROVENANCE`: headless evidence rendered presets, and export/screenshot stamped the authored identity on unrelated renders.
- `FND-MCP-CAPTURE-OVERLAY-SUBDIR`: captures included UI overlays, and requested artifact subdirectories were dropped.
- `FND-AUDIT-CANNED-REPAIR-CLAIMS`: the audit emitted prewritten RESOLVED/MITIGATED repair claims and mutated pixel ratio.
- **Phase 0, from the static estimate:** `FND-AUTHORED-REPLAY-DRAW-BUDGET`, "The dogfood replay world (13 entities) is estimated at ~56 draws against the 30-draw diorama budget", with the §0 estimate and feasibility numbers, `owner: "BUILD-AUTHORED-BUDGET"`, `disposition: "open"`, and `expected_failures: []`. At P0.5 closeout its evidence is replaced with the **measured** values from the report. If the measurement is ≤30 / ≤15,000, it is closed on that report together with `ABG-1`.

### 14.3 Other records

- `docs/specs/SPEC-08-MCP-EVIDENCE-INTEGRITY.md`: created in Phase 0 (gate P9).
- `.bridge/ARTISAN-VISIBILITY-CREATIVE-PLAN.md`: append a "Prerequisite (2026-09-22)" section. P1 readiness requires `BUILD-EVIDENCE` **and** `BUILD-AUTHORED-BUDGET` intent `closed`, plus both acceptance records at `PASS`, in addition to the existing four readiness checks.
- `CLAUDE.md`: add ``- Evidence integrity (P0.5): `node scripts/verify_mcp_evidence_integrity.mjs` ``.
- `AGENTS.md`: add "A second MCP instance never takes the live bridge silently: it reports `BRIDGE_CONFLICT`. Pin a Studio tab with `?mcpPort=N&mcpInstance=<id>`. Evidence is valid only when `evidence.identityVerified` is true."
- `board.html`: `python make_board.py` after every PLAN/FINDINGS edit, so gate P10 stays byte-identical.
- **Closeout (S-1 only):**
  - `EVI-6` and `BUILD-EVIDENCE` go to `closed`, and the four evidence findings go to `closed` with a rationale citing the report.
  - The acceptance record carries `evidence_integrity_acceptance: "PASS"`, **and** `authored_budget: "PASS"|"FAIL"` with the measured draws/tris/FPS, the report path and SHA-256, the identity table, and the executor/date. The budget result is stated in the record, never omitted.
  - If `authored_budget` is PASS: also write `.bridge/ARTISAN-AUTHORED-BUDGET-ACCEPTANCE.json` (`authored_budget_acceptance: "PASS"`, same report), close `ABG-1`, `BUILD-AUTHORED-BUDGET` and the budget finding.
  - The handoff states that `BUILD-CREATIVE` remains **approved and unstarted**, and names the next step (the P0.6 deep plan, or P1 readiness if P0.6 closed).

---

## 15. Stop conditions

- **S-1 Success:** A-1..A-11 all PASS (A-12 reported truthfully either way). Closeout per §14.3, `gate.py` green, handoff written, then **stop**. Do not start P0.6 or P1 in the same session.
- **S-2 Diagnosis invalid:** any §10 red test passes on baseline code. Stop before any source edit, record which test and why, and return to planning.
- **S-3 Authored budget FAIL** (the predicted outcome) is **not** a P0.5 failure, and it triggers no optimization in P0.5.
  - Do **not** optimize, re-author the fixture, change archetypes, or touch the compiler or foundries.
  - Update `FND-AUTHORED-REPLAY-DRAW-BUDGET` with the measured values and the per-entity draw table.
  - `BUILD-AUTHORED-BUDGET` stays `draft`, so P1 stays blocked.
  - The handoff's next action is "deep-plan P0.6 in a fresh Opus session, using the P0.5 instrument as its measurement gate".
- **S-4 Scope breach:** any need to write outside §5, add a dependency, change a tool input schema, exceed the §6 cap, lower any existing gate threshold, or regress any P0 gate. Stop, run a targeted rollback of the offending phase (§8), and report.
- **S-5 Environment:** no free hermetic ports, no browser, or the fixture hash does not match. Stop without killing or reconfiguring anything.
- **S-6 Session economy:** statusline shows the `!!` marker or the Phase 3 boundary is reached. Write the handoff and propose `/clear` plus "execute plan `.bridge/ARTISAN-MCP-EVIDENCE-INTEGRITY-PLAN.md` from Phase <N>".

---

## 16. Explicitly out of scope (deferred, not forgotten)

- **P1:** candle clusters, authored lights, material variants, archetype parameters, anchor offsets and relation semantics, batch authoring, compact resources, the 11-tool consolidation.
- **P0.6 (next, separately planned):** draw-call conformance of the authored replay world (§0, `BUILD-AUTHORED-BUDGET`). Its deep plan must cover:
  - world-level batching by material that preserves per-entity nodes, transparency sort order, emissive/flicker behavior and shadow flags;
  - a canvas pixel-diff parity proof against the P0.5 capture, plus the brightness gates;
  - no preset draw regressions;
  - a material-pooling budget strategy for P1's added candles and lights.
- **P2:** preset scene remediation (Tokyo, Winterhold, Fantastic; `BUILD-PERF-SCENES`), unchanged.
- The `artisan://governance` resource counting a non-existent `status` field (all nodes "unspecified"). This is a real truth bug but not render evidence; it is recorded here for a later governance task.
- Audit and import output **filenames** (still fixed or timestamped at the artifact root). Their content now carries the identity envelope.
- Process hygiene for stale MCP instances (the H-1 cause). Diagnosis is now actionable; stopping processes remains the owner's action.

---

## 17. Handoff

When this plan is approved: run `/clear`, select **Claude Opus 5**, then say "execute plan `.bridge/ARTISAN-MCP-EVIDENCE-INTEGRITY-PLAN.md`", starting at Phase 0.

---

## 18. Model routing (decided)

| Step | Model | Why |
|---|---|---|
| **P0.5 execution, Sessions A and B** | **Claude Opus 5 (`claude-opus-5`), high effort** | This is cross-boundary integrity work: Node MCP ↔ WebSocket protocol ↔ browser `main.js` ↔ headless Chromium ↔ governance gates. It carries about 30 red-first tests, 8 gate-bearing text anchors that must survive, a tool-schema cap with 87 chars of slack, and conflict semantics across processes. A subtle mistake here recreates the exact defect this phase removes. It also matches the project's own routing rule: Opus for execution, and Opus for cross-boundary work. |
| Optional speed | `/fast` in Session B | Fast mode is the same Opus model with faster output, not a smaller model, so quality is unchanged. Use it if wall-clock time matters. |
| Independent check before the P0.5 closeout | a fresh-context review (`/code-review high` on the P0.5 diff), plus an independent re-audit like P0's Sol audit if you want one | The P0 precedent: an independent audit caught a false-passing write scan. |
| P0.6 deep plan | Claude Opus 5 | rendering-architecture and visual-parity design |
| Not recommended here | Fable 5.1 (project rule: routine audit/planning only), Sonnet 5 / Haiku 4.5 (the savings are not worth the integrity risk for this phase) | — |
