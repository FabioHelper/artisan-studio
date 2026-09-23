# Artisan Studio P0.6 — Architecture and Acceptance Specification

Status: **specification only; no implementation authorized by this document**  
Target repository: `C:\Users\Fabio D\.gemini\antigravity\scratch\artisan-studio-app`  
Verified HEAD: `909d41f182b2c4446411af6e19251f04257e13bf`  
Specification date: 2026-09-22  
Contract observed: `artisanContract` `2.0.0`

## 1. Scope lock and startup record

This is the implementation-ready follow-on to completed P0.5. It specifies only the identity boundary, world-level render plan, deterministic pooling/batching, independent ABG-1 acceptance, and read-only Fantastic Hall references. It does not execute the completed MCP master plan, implement P0.6, start P1, change governance state, or modify a Fantastic/Vault cabinet.

Before this file was written, the authoring task verified:

- The target exists and HEAD is exactly `909d41f182b2c4446411af6e19251f04257e13bf`.
- `.bridge/ARTISAN-MCP-EVIDENCE-INTEGRITY-ACCEPTANCE.json` has `verdict: "ACCEPT"`; its report SHA-256 is `451c8ff5567b83184140285c28729bf50ae505ecf7c405eb1c62b0a07c6119a3`; only nonblocking A-12 fails.
- `PLAN.json`: `BUILD-EVIDENCE` and `EVI-6` are `closed`; `BUILD-AUTHORED-BUDGET` and `ABG-1` are `draft`; `BUILD-CREATIVE` is `approved` but unstarted and depends on incomplete `BUILD-AUTHORED-BUDGET`/`ABG-1`.
- `.bridge/ARTISAN-ASTRA-HANDOFF.json` says `status: "complete"`. The completed `.bridge/ARTISAN-ASTRA-LOCAL-MCP-PLAN.md` was used only as historical architecture and roadmap. It was not re-executed or modified.
- The target has no `.ctx` directory. CTX is not a P0.6 dependency and requires no action.
- The worktree was already substantially dirty. Every existing change is preserved; dirtiness is not evidence of P0.6 implementation.

### 1.1 Decisive observed evidence

| Fact | Current evidence |
|---|---|
| Authored identity | `WorldSession.sceneIdentity()` and browser `computeSceneIdentity()` hash canonical manifest JSON and emit `sha256:` plus 32 hex characters. |
| Fantastic ambiguity | `src/main.js` emits `mode:game` for the walkable runtime and `preset:fantastic` for the smaller adaptation. |
| Walkable source | `bootFantasticWorld()` builds sky, Hall, props, exterior, particles, lighting and runtime systems; Hall is 24 × 23 × 8.6 m. |
| Diorama source | `buildFantasticWorld()` builds a 7.4 × 6.2 × 3.6 m adaptation; its seven-item editor pseudo-manifest is informational, not compiler input. |
| Authored result | Canonical 13-entity `dogfood-alchemist-midnight-study` v15, identity `sha256:f4bb39db91d785d657fb56059e7222f4`: 56 draws, 12,870 triangles, 59.08 headless FPS and 59.56 live FPS at 1280×720 DPR 1 on Intel UHD 0x9B41. |
| Compiler | `WorldCompiler.optimizeEntityGroup()` merges standard meshes only within each entity, grouping by material object. |
| Material hazard | `Validator` rejects explicit unknown refs, but `MaterialFoundry.get()` silently returns `wood.dark_oak`; missing/default/computed paths can mask defects. |
| Evidence integrity | Compile ack, screenshot, telemetry, manifest export, audit and headless evidence bind to scene identity and entity set; stale live evidence fails `PREVIEW_STALE`. |
| Vault | Nine cabinets map one-to-one to walkable lighting, Hall, exterior, sky, props, particles, palette, ambience and controls. Existing cabinet metrics are stored/default-backed, not sufficient proof of live Hall performance. |

Immutable acceptance inputs: `authored-world.json` SHA-256 `85a83b04d36a5cdb01d08ce3cbe0b1ca559c2da38fcadbf9ea1ded6b69448c0f`; `tool-call-log.json` `2c6898056244fde844fd9895047458ede5f03beea2f243aac19cb5f9a1b89304`; P0.5 live hero `c5115dede06c118a3729ff3048395b1d51b908cf91e819606e16378b8ac7e434`; P0.5 headless hero `2a21a81eeb7e60afe14b1eef4e9929ba62edc21eee2e1c7f4932d71a1996fb7a`.

## 2. Global architecture laws

1. Authored intent remains declarative. Optimization is compiler-owned and never rewrites the manifest.
2. Manifest identity stays invariant when only realization changes. A separate `renderPlanHash` proves realization.
3. Every evidence operation binds to a structured scene reference, renderer identity, entity set, render epoch and render-plan hash. A legacy Fantastic label alone is insufficient.
4. One named transform/debug node remains for every authored entity. Shared GPU resources never erase semantic ownership.
5. Unknown, incompatible or unhashable resources fail before scene replacement with structured issues. No dark-oak, generic-material, primitive or unrelated fallback is permitted.
6. Opaque and transparent work use separate deterministic queues. Budget pressure never authorizes unsafe transparent merging.
7. Live and headless use the same compiler, identity descriptor and render-plan algorithm.
8. The non-degradation invariant and five-tier compounding law remain contract invariants. P0.6 may optimize realization, never reduce assets or visuals.
9. All P0.5 integrity gates remain blocking. A-12 becomes blocking only in independent ABG-1 acceptance.
10. The walkable Fantastic implementation is read-only throughout P0.6. Hall optimization is P2/Vault work.

## 3. P0.6-A — Identity boundary

### Objective and problem

Replace ambiguous Fantastic labels with distinct, versioned, content-bound identities while preserving ordinary authored identity. This slice changes labels and evidence routing only; it makes no visual, compiler, material, lighting or performance change.

### Canonical identity model

Every rendered surface exposes:

```json
{
  "identitySchemaVersion": 1,
  "kind": "walkable-world | zone | diorama-adaptation | authored-world",
  "logicalId": "stable id",
  "contentVersion": 1,
  "contractVersion": "2.0.0",
  "contentHash": "sha256:<64 lowercase hex>",
  "sceneIdentity": "compact runtime identity",
  "parentSceneIdentity": null,
  "sourceManifestHash": "sha256:<64 lowercase hex> | null",
  "rendererHash": "sha256:<64 lowercase hex>",
  "renderPlanHash": "sha256:<64 lowercase hex> | null",
  "legacyAliases": []
}
```

| Surface | Canonical name | `kind` / `logicalId` / version | Runtime identity |
|---|---|---|---|
| Entire walkable runtime | **The Fantastic World** | `walkable-world` / `fantastic-world.walkable` / `1` | `fantastic-world:walkable:v1:<first32(contentHash)>` |
| Interior zone | **The Fantastic Hall** | `zone` / `fantastic-world.fantastic-hall` / `1` | `fantastic-hall:zone:v1:<first32(contentHash)>`; always with parent walkable identity |
| Smaller Studio preset | **Fantastic Hall Diorama Adaptation v2** | `diorama-adaptation` / `fantastic-hall.diorama-adaptation` / `2` | `fantastic-hall:diorama:v2:<first32(contentHash)>` |
| Ordinary MCP world | Manifest `worldId` | `authored-world` / `worldId` / manifest `version` | Existing `sha256:<first32(sourceManifestHash)>` unchanged |

`contentHash` is SHA-256 of canonical JSON containing identity schema version, kind, logical id, content version, contract version and a path-sorted list of `{path, sha256}` dependencies. The generated identity manifest is excluded from its own source set. For authored worlds, `sourceManifestHash` is full SHA-256 of `canonicalJson(manifest)` and is the content hash; `rendererHash` separately fingerprints contract/compiler/material/lighting/evidence code. A Hall-zone identity also hashes its parent walkable content hash, preventing reuse under another world.

Implementation creates a shared identity contract, a generated Fantastic fingerprint module and `scripts/generate_scene_identities.mjs`. `--write` is implementation-only; tests and acceptance use `--check`, which fails on missing, extra, reordered or changed dependencies. Dependency sets are explicit and path-sorted; globs are forbidden identity input.

### Version, compatibility and migration

- `identitySchemaVersion` changes only for interpretation-breaking schema changes. `contentVersion` changes only for an intentional semantic revision; source edits change `contentHash`, not version.
- `mode:game` remains an input/router alias for one release but is never emitted in new evidence. It resolves only after the loaded walkable fingerprint passes.
- `preset:fantastic` remains an input alias for the diorama adaptation for one release. New evidence emits its v2 canonical identity.
- Existing `mode:game` and `preset:fantastic` artifacts remain immutable `legacy: true` records. They are not rewritten or accepted as canonical proof.
- Ordinary authored `sha256:<32>` identities remain byte-compatible. Evidence adds the full manifest hash and structured reference.
- Unknown aliases, missing descriptor, kind mismatch, parent mismatch or hash mismatch fail with `IDENTITY_UNRESOLVED`, `IDENTITY_KIND_MISMATCH`, `IDENTITY_PARENT_MISMATCH` or `IDENTITY_STALE`; no guessing.

### Evidence namespaces and cross-label proof

```text
evidence/walkable-world/fantastic-world.walkable/v1/<64hex>/...
evidence/zone/fantastic-world.fantastic-hall/v1/<parent64>/<zone64>/...
evidence/diorama-adaptation/fantastic-hall.diorama-adaptation/v2/<64hex>/...
evidence/authored-world/<encoded-worldId>/v<manifestVersion>/<manifest64>/...
```

Compile ack, screenshot, telemetry, telemetry import, manifest export, audit and performance report each echo the structured scene reference plus `renderEpoch`, exact `renderedEntityIds`, renderer identity, source, `rendererHash`, `renderPlanHash` when applicable, artifact SHA-256 and camera where applicable. The writer derives its namespace from this verified record; caller paths cannot choose identity. Zone evidence contains both scene and zone descriptors and proves camera/frustum belongs to the parent render. A zone may scope evidence but never replace scene identity.

For each of those six operations, tests attempt walkable→diorama, diorama→walkable, zone→world, authored→Fantastic, stale-hash and legacy-alias cross-labeling in live and headless paths. Every attempt must fail before writing, with artifact-tree hash unchanged.

### Slice A execution contract

- **Evidence:** current identity helpers/labels, P0.5 gates, and Appendix A hashes.
- **Preconditions:** P0.5 `ACCEPT`; P0.6 baseline created before implementation; Hall/Vault hashes match Appendix A.
- **Exact expected file allowlist:** `src/contracts/artisanContract.js`; new `src/contracts/sceneIdentityContract.js`; new `src/contracts/sceneIdentityManifest.generated.js`; `src/main.js`; `mcp-server/WorldSession.js`; `mcp-server/bridge.js`; `mcp-server/index.js`; `mcp-server/HeadlessRunner.js`; new `mcp-server/test_scene_identity.js`; `mcp-server/test_evidence_integrity.js`; `scripts/check_contract_drift.mjs`; new `scripts/generate_scene_identities.mjs`; `scripts/verify_mcp_evidence_integrity.mjs`; `.bridge/ARTISAN-P06-BASELINE.json`; `.bridge/ARTISAN-P06-WORKLOG.jsonl`; `.bridge/ARTISAN-P06-HANDOFF.json`.
- **Forbidden files:** all `src/game/fantastic-world/**`, `src/foundry/FantasticWorldBuilder.js`, compiler/material/lighting implementation, Vault definitions/gates, fixtures, existing baselines and acceptance records.
- **Ownership:** identity contract names/derives; host routing selects; evidence verifies/serializes; renderers report but never invent identity.
- **Contract/schema change:** additive identity schema v1 and evidence fields; no authored manifest break.
- **Migration:** input-only aliases; historical evidence stays legacy; no rewrite.
- **Positive tests:** four identities distinct/deterministic; authored compact identity unchanged; dependency reorder neutral; source change visible; live/headless identity equal.
- **Negative/adversarial tests:** prefix collision, truncated/full confusion, path case/separator ambiguity, duplicate dependency, unknown alias, stale generated module, parent mismatch, mid-capture scene change, forged bridge record, full cross-label matrix.
- **Performance guard:** existing fixture draws/triangles unchanged; identity work absent from frame loop.
- **Identity guard:** all evidence surfaces and render sources tested.
- **Visual guard:** current screenshot comparison; expected pixel change zero.
- **Vault impact:** hashes read only; no cabinet change.
- **Rollback boundary:** revert only the allowlist and remove only new identity/test files; never alter legacy artifacts.
- **Dependencies:** completed P0.5.
- **Explicit non-goals:** render/Hall optimization, new creative tools or materials, reference pack.
- **Stop condition:** visual/performance change, authored identity change, ambiguous dependency closure or P0.5 regression.
- **Recommended model:** GPT-5.6 Sol High.
- **Expected implementation-task size:** one fresh High task, about 10–13 code/test files plus three governance files; split before acceptance.

## 4. P0.6-B — World-level render plan

### Objective and problem

Introduce a deterministic intermediate plan that can compile the unchanged 13-entity manifest from 56 draws toward ≤30 without changing manifest identity, visuals or named entity ownership. Current entity-local merging cannot pool identical resources across entities.

### Required data structure

`WorldRenderPlan` v1 is immutable after validation:

```text
header: planVersion, sceneRef, manifestHash, compilerHash, deterministicSeed, renderPlanHash
entityNodes[]: entityId, authoredOrdinal, transform, debugName, assetRef, contributionIds[]
materials[]: materialKey, catalogRef, descriptorHash, renderState, ownershipRefs[]
geometries[]: geometryKey, descriptorHash, topology, attributes, indexHash, bounds, lifecycleKey
contributions[]: contributionId, entityId, localOrdinal, geometryKey, materialKey,
                 local/world matrix, shadow flags, transparencyClass, renderOrder,
                 eligibility, rejectionReasons[]
batches[]: batchId, queue, strategy, materialKey, geometryKey?, contributionIds[],
           deterministicOrder, drawRanges/instanceMap, bounds, disposalRefs[]
transparentQueue[]: contributionId, stableTieBreak, originalRenderOrder, depthPolicy
ownershipIndex: entityId -> contribution/batch/instance/draw-range mappings
diagnostics: pre/post draw estimate, triangles, exclusions, structured warnings
```

`renderPlanHash` is full SHA-256 of canonical plan semantics excluding runtime UUIDs, timestamps, GPU handles and prose. Stable order is manifest entity ordinal, entity id tie-breaker, depth-first local mesh ordinal, material key, geometry key, contribution id. Locale sorting, insertion-order accidents, UUIDs and `Math.random()` are forbidden inputs.

### Compilation stages and ownership

1. **Validate:** reject manifest/archetype/material defects before mutation.
2. **Semantic compile:** existing builders populate one named entity staging group each; transforms and five-tier detail remain unchanged.
3. **Extract:** traverse groups into immutable contributions, preserving render order, shadows, geometry attributes, material descriptors and owner.
4. **Normalize:** compute content keys and world matrices without disposing sources.
5. **Plan:** classify queues, choose eligible merge/instance/reuse strategy and create ownership maps.
6. **Validate plan:** every drawable occurs exactly once; triangles are conserved; every contribution has exactly one entity; unsupported cases stay unbatched.
7. **Realize:** create shared resources and batches under a renderer-owned root. Keep a lightweight named transform/debug node for each entity under the world root; metadata points to ownership mappings.
8. **Commit:** atomically swap only a fully realized plan. Failure disposes the candidate and leaves prior scene, identity and epoch untouched.

`WorldCompiler` owns semantic compilation and requests a plan. `WorldRenderPlan` owns extraction, ordering, classification, realization metadata and disposal references. `MaterialFoundry` owns canonical descriptors/instances, not batching policy. `ArtisanProfiler` consumes `ownershipIndex` for inspection/bisection. `main.js` owns atomic scene replacement and lifecycle. Evidence reports hashes but cannot alter the plan.

Named nodes are semantic/debug nodes, not one draw object per entity. Selection resolves through `ownershipIndex`; highlighting uses a temporary non-evidence overlay or deterministic filtered recompile. Bisection recompiles with an explicit sorted entity mask and proves unchanged contribution hashes for unmasked entities. Evidence is forbidden while an overlay or partial mask is active.

### Preservation rules

- Scene identity and canonical manifest bytes remain exact.
- Geometry transforms, topology, attributes, material descriptors, shadows, layers and visibility are conserved.
- Opaque contributions batch only after eligibility proof. Transparent contributions remain separately sortable unless Slice C proves its conservative rule.
- The contact shadow catcher retains one system contribution/draw and is not assigned to an authored entity.
- Live/headless must produce the same plan hash; mismatch is `RENDER_PLAN_MISMATCH`.
- The fixture stays ≤15,000 triangles; proxy/debug geometry is excluded from production evidence because it must be absent, not because the counter ignores it.

### Slice B execution contract

- **Evidence:** 55 per-entity draws plus one catcher; current batching is entity-local; material vocabulary is shared.
- **Preconditions:** Slice A accepted; fixture/hash unchanged; P0.5 heroes authenticated.
- **Exact expected file allowlist:** `src/engine/WorldCompiler.js`; new `src/engine/WorldRenderPlan.js`; `src/engine/ArtisanProfiler.js`; `src/main.js`; `src/contracts/artisanContract.js`; new `mcp-server/test_render_plan.js`; `scripts/check_contract_drift.mjs`; `scripts/verify_mcp_evidence_integrity.mjs`; `.bridge/ARTISAN-P06-WORKLOG.jsonl`; `.bridge/ARTISAN-P06-HANDOFF.json`.
- **Forbidden files:** `MaterialFoundry.js` until Slice C; every Fantastic/Vault file; manifests, dogfood fixtures, P0.5 artifacts/baselines/acceptance.
- **Ownership:** compiler/plan/profiler/main boundaries above are normative.
- **Contract/schema change:** additive `RENDER_PLAN_VERSION`, diagnostics and evidence `renderPlanHash`; no manifest field.
- **Migration:** compiler path changes atomically after parity tests; no stored-world migration.
- **Positive tests:** deterministic plan/hash; all 13 named nodes; ownership bijection; entity select/filter/bisection; live/headless equality; triangle conservation; atomic replacement.
- **Negative/adversarial tests:** duplicate/missing owner, nondeterministic traversal, unsupported attributes, multi-material geometry, custom hooks, plan tamper, debug mask during evidence, realization failure, partial disposal.
- **Performance guard:** estimator ≤30 draws and ≤15,000 triangles; actual closure belongs to D.
- **Identity guard:** manifest identity unchanged; plan hash changes with realization semantics and never substitutes for scene identity.
- **Visual guard:** structural signature exact; live/headless hero SSIM ≥0.995, mean absolute channel error ≤1/255, 99.9th-percentile error ≤4/255, no masks/crops; owner review in D.
- **Vault impact:** none; only immutable hash guard.
- **Rollback boundary:** remove new plan/test, restore allowlisted call sites; dispose candidates without touching active scene.
- **Dependencies:** Slice A.
- **Explicit non-goals:** material API repair, new materials/variants, Hall batching, creative schema, assemblies/zones/lights.
- **Stop condition:** ownership loss, identity drift, transparent-order difference, triangle/topology change, visual miss, P0.5 failure or >30 estimate.
- **Recommended model:** GPT-5.6 Sol High.
- **Expected implementation-task size:** one fresh High task, about 7–9 files; never combine with independent acceptance.

## 5. P0.6-C — Deterministic pooling and batching

### Objective and problem

Realize the plan with cross-entity material pooling, geometry reuse and safe batching so the canonical replay actually reaches budget while semantic/debug ownership, visuals, evidence and lifecycle remain intact.

### Resource keys and eligibility

`MaterialFoundry.get(ref)` becomes strict: known ref returns the pooled canonical material; unknown ref throws a structured `UNKNOWN_MATERIAL` issue at the original manifest/entity path. Missing optional slots use only the exact route-declared default after validating that default. No caller may infer success from a material object unrelated to the requested ref.

`materialKey` hashes catalog ref plus canonical PBR fields, texture/content hashes, shader defines, side, alpha/transparent/opacity, depth test/write, blending, vertex colors, tone mapping, polygon offset and required extensions. Object identity is never the key. `geometryKey` hashes primitive/type parameters when available and final typed attribute/index bytes, usage, groups, morph/skinning state and draw range. Mutable/unhashable/custom resources are ineligible, not approximated.

Deterministic strategy precedence:

1. Preserve already valid `InstancedMesh` and its instance ordering.
2. Instance two or more contributions only when geometry key, material key, render state, shadows, layers and supported per-instance attributes match exactly.
3. Merge static opaque contributions sharing material/render state when transforms can be baked without topology or normal/tangent corruption.
4. Reuse geometry/material without batching where draw-order or behavior prevents combination.
5. Emit unchanged individual draws with a structured exclusion reason.

Opaque batches sort by queue, explicit render order, material key, geometry key, first authored ordinal and contribution id. Emissive materials pool only when emissive color/intensity and all other key fields match. Variants never merge merely because visible base color matches.

Transparent contributions preserve Three.js object-level sorting. Cross-entity transparent merge/instancing is prohibited in P0.6 unless a validator proves: identical full key, identical explicit render order, pairwise non-overlapping camera-depth intervals across all canonical cameras, and no order-dependent blending. If proof is absent, keep individual contributions with stable tie-break `(renderOrder, original authored ordinal, local ordinal, contributionId)`. Failure to meet budget does not weaken this rule.

### Lifecycle, mutation and failure

`RenderResourcePool` is world-instance scoped, never process-global. Entries are content-keyed and reference-counted by plan. Candidate compilation acquires into an isolated generation; atomic commit transfers ownership; rejected/old generations release once. A resource is disposed only at refcount zero and only if the pool created it. Foundry-owned immutable catalog materials are released from the plan but disposed by their owner.

Cache key includes identity schema version, full scene content hash, contract version, compiler hash, plan version and quality profile. World change, contract/compiler change, material registration/reassignment, geometry mutation or profile change invalidates the affected generation. Entity mutation always recompiles from the committed manifest; it never patches GPU batches in place. Same manifest and compiler produce the same plan hash. Cross-world reuse is forbidden in P0.6 even for equal keys.

On validation, planning or realization failure: return `{error:{code,message,issues[]}}`; keep prior world active; write no evidence; increment no committed epoch; dispose the candidate generation; include no fallback object. Minimum codes are `UNKNOWN_MATERIAL`, `INCOMPATIBLE_MATERIAL`, `UNHASHABLE_MATERIAL`, `INELIGIBLE_GEOMETRY`, `BATCH_OWNERSHIP_ERROR`, `TRANSPARENT_ORDER_UNSAFE`, `RENDER_PLAN_STALE`, `RESOURCE_GENERATION_MISMATCH`, `RENDER_PLAN_REALIZATION_FAILED`.

Each issue includes `path`, `entityId`, requested ref/key, stage and a repair-oriented message. Error ordering is path then code then entity id.

### Required fixtures

| Fixture | Required proof |
|---|---|
| Positive shared opaque material | Contributions across ≥3 entities collapse to one batch; ownership remains 3-way inspectable. |
| Positive geometry reuse/instancing | Same geometry/material instances share one draw and stable instance→entity map. |
| Positive emissive variants | Exact variants pool; differing intensity/defines remain separate. |
| Aliasing | `const x = foundry.get; x(bad)` cannot bypass strict lookup or structured path attribution. |
| Reassignment | Rebinding/wrapping `get`, `register`, pool map or compiler resolver cannot introduce fallback or evade guard tests. |
| Computed access | `foundry['get'](bad)`, optional chaining and computed catalog access fail identically. |
| Transparent order | Intersecting/depth-crossing transparent objects are not merged; canonical camera images retain order. |
| Identity collision | Same 32-hex prefix with different full hashes is rejected; cache uses full hash. |
| Incorrect merge | Same color but different side, blending, texture, emissive, depth or shader define stays separate. |
| Cross-world contamination | Equal material/geometry keys in two worlds have distinct generations; dispose/mutate one leaves the other unchanged. |
| Stale plan | Any manifest/contract/compiler/profile mutation rejects old plan before commit/evidence. |
| Ownership loss | Missing, duplicate or wrong instance/draw-range owner is blocking. |
| Disposal | Recompile/switch/failure disposes exactly owned zero-ref resources once; no active resource is disposed. |

### Slice C execution contract

- **Evidence:** `MaterialFoundry.get()` fallback at lines 357–359; Validator's explicit-ref guard; Slice B plan.
- **Preconditions:** A and B accepted; render-plan schema frozen; baseline parity passes before optimization.
- **Exact expected file allowlist:** `src/engine/MaterialFoundry.js`; `src/engine/WorldCompiler.js`; `src/engine/WorldRenderPlan.js`; new `src/engine/RenderResourcePool.js`; `src/main.js`; `mcp-server/Validator.js`; `mcp-server/test_render_plan.js`; `mcp-server/test_evidence_integrity.js`; `mcp-server/test_stdio_client.js`; `scripts/check_contract_drift.mjs`; `scripts/verify_mcp_evidence_integrity.mjs`; `.bridge/ARTISAN-P06-WORKLOG.jsonl`; `.bridge/ARTISAN-P06-HANDOFF.json`.
- **Forbidden files:** every Fantastic/Vault file, `UniversalFoundry.js` and archetype builders, authored fixture/log, performance baselines, existing acceptance records.
- **Ownership:** foundry describes/pools materials; plan chooses strategy; world-scoped pool owns runtime resources; main owns generation swap.
- **Contract/schema change:** strict lookup API, canonical descriptor/key schemas, pool-generation diagnostics; no new authored parameter.
- **Migration:** audit every `get()` call; route defaults become explicit and validated. Existing valid refs retain exact material values. Any formerly masked unknown now intentionally fails.
- **Positive tests:** table above plus canonical replay ≤30 estimate/actual in focused harness.
- **Negative/adversarial tests:** every table attack and direct/map-level fallback injection; errors must be deterministic and write-free.
- **Performance guard:** canonical replay actual ≤30 draws, ≤15,000 triangles, mean ≥60.00 FPS after fixed warm-up; no preset regression beyond recorded values.
- **Identity guard:** scene identity unchanged; live/headless full identity and plan hash equal; cache key uses full hash.
- **Visual guard:** B thresholds at both P0.5 hero sources plus structural signature and transparent adversarial cameras.
- **Vault impact:** none; Hall/material source files are not a cache or fixture.
- **Rollback boundary:** remove resource-pool module, restore strict call sites and prior planner realization only; never restore silent fallback as a temporary fix—rollback means whole Slice C.
- **Dependencies:** A then B.
- **Explicit non-goals:** PBR texture pipeline, atlasing, LOD, Hall optimization, new catalog materials, creative variants, cross-world cache.
- **Stop condition:** threshold miss, fallback, nondeterminism, leak/double-dispose, cross-world contamination, ownership/parity/P0.5 regression.
- **Recommended model:** GPT-5.6 Sol Medium after B design is frozen; use Sol High if batching, debug and evidence boundaries must change together.
- **Expected implementation-task size:** one fresh task, about 8–11 files; if more than two ownership boundaries change, stop and re-plan at High.

## 6. P0.6-D — ABG-1 independent acceptance

### Objective and independence

Close `BUILD-AUTHORED-BUDGET` and `ABG-1` only when the unchanged canonical replay passes budget, identity, visual, integrity and tree-preservation gates. Acceptance runs in a fresh GPT-5.6 Sol Medium task that did not implement A–C. The implementer may supply a handoff and candidate artifact hashes but may not edit the verifier result, acceptance record or review verdict.

No budget waiver, fixture substitution, baseline refresh, image masking, threshold change, selective camera omission, software-renderer substitution, `--skip-p0`, or silent retry is allowed. A failed run remains recorded. A rerun requires the cause to be identified, any acceptance-side mutation reverted, and a new independently labeled run; old evidence is never overwritten.

### Preconditions

1. Startup guards in §1 still hold except for explicitly allowlisted P0.6 implementation files.
2. A–C handoff says implementation complete, identifies implementer task, exact changed paths and pre/post hashes, and has no unresolved failure.
3. `.bridge/ARTISAN-P06-BASELINE.json` predates implementation and authenticates HEAD, dirty-tree fingerprint, existing P0.5 records, fixture files, hero images, Hall/Vault files and every pre-existing allowlist file.
4. Canonical fixture remains exactly `dogfood-alchemist-midnight-study`, version 15, 13 exact entity ids, contract 2.0.0, source identity `sha256:f4bb39db91d785d657fb56059e7222f4`, with the file hashes in §1.
5. Browser is the same installed Edge/Chrome family used by P0.5; viewport 1280×720, DPR 1, Balanced, fixed canonical hero camera, hardware WebGL, Intel UHD 0x9B41 or an owner-approved equivalent recorded before the run. Software rasterization is a hard failure.
6. Protected ports are untouched; the verifier owns hermetic Vite/bridge ports and kills nothing.
7. Generated Fantastic identities pass `node scripts/generate_scene_identities.mjs --check` and all cabinet targets hash-match the P0.6 baseline.

### One-command acceptance

The only acceptance command is:

```powershell
node scripts/verify_authored_budget.mjs
```

The new orchestrator runs once and writes only `.artisan-artifacts/verify-authored-budget/<run-id>/` plus an atomic `latest` pointer/manifest inside that artifact root. It invokes the focused identity/render-plan/material/adversarial suites, contract drift, the complete unflagged P0.5 verifier, canonical live/headless replay, visual comparisons, resource lifecycle checks and final tree comparison. It must not call a mutable external server, reuse an already open Studio, or modify baselines/governance.

Required stages:

| Stage | Blocking result |
|---|---|
| S0 preflight | Exact fixture/source/baseline hashes, browser/GPU, free hermetic ports, no other verifier, generated identity current. |
| S1 static/contracts | Identity dependency closure, strict material paths, plan schema, no silent fallback, contract drift all pass. |
| S2 unit/adversarial | All A–C positive, negative and adversarial fixtures pass; negative cases write nothing. |
| S3 canonical live | Compile ack proves exact scene/entity/plan; settled metrics and hero capture emitted. |
| S4 canonical headless | Same scene/content/renderer/plan identity and entity set; settled metrics and hero capture emitted. |
| S5 parity | Structural signature exact; live and headless each compared to its authenticated P0.5 hero; thresholds pass; diff images unmasked. |
| S6 P0.5 regression | Full `node scripts/verify_mcp_evidence_integrity.mjs` semantics pass A-1…A-11 and A-12; no skip flag. |
| S7 negative evidence | Cross-label, stale plan, transparent order, cache contamination, bad material, ownership and mid-capture mutations fail closed. |
| S8 tree preservation | Before/after SHA-256 tree identical outside artifact root; acceptance process created no project file. |
| S9 verdict | All blocking gates pass and artifact manifest hashes every output. |

### Numeric and parity gates

- Live and headless draw calls: each `≤30`; values must be equal after settling.
- Live and headless triangles: each `≤15,000`; values must equal 12,870 unless a separately explained index-preserving representation changes the counter without topology change. Any topology/signature difference still fails.
- Mean FPS: each `≥60.00` over 120 measured frames after ten quiet frames and completed shadow bake. Also report mean frametime, p95 and p99; p95 >16.67 ms is reported as a cadence failure. No rounding into compliance.
- GPU, viewport, DPR, quality profile, frame count, settled state and camera are mandatory.
- Manifest canonical JSON, compact identity, full manifest hash, entity-id set, named-node set, ownership bijection, material descriptors, geometry/topology signature, light profile and camera must match the P0.5 baseline.
- Corresponding live/headless hero: 1280×720, SSIM `≥0.995`, mean absolute channel error `≤1/255`, 99.9th percentile absolute error `≤4/255`, no crop/mask/rescale. Emit baseline, candidate and amplified diff with hashes.
- Transparent adversarial cameras must be exact in ordering signature and pass the same pixel thresholds.
- Owner reviews the unmasked side-by-side and diff after metric pass. Owner rejection prevents closure even if metrics pass; owner approval cannot waive a metric failure.

### Required artifacts

`report.json`, `report.md`, `console.log`, `environment.json`, `fixture-manifest.json`, `identity-matrix.json`, `render-plan.json`, `ownership-map.json`, `resource-lifecycle.json`, `negative-fixtures.json`, `p05-regression.json`, `tree-before.json`, `tree-after.json`, `tree-diff.json`, live/headless telemetry and screenshots, each parity diff, and `artifact-manifest.json`. The manifest records relative path, bytes and SHA-256 for every artifact and hashes itself via a detached `artifact-manifest.sha256`.

### Acceptance JSON schema

Only after the independent report passes and the owner approves visuals may the independent task create `.bridge/ARTISAN-AUTHORED-BUDGET-ACCEPTANCE.json`:

```json
{
  "schema_version": "1.0",
  "authored_budget_acceptance": "PASS",
  "verdict": "ACCEPT",
  "date": "ISO-8601",
  "owner": "Fabio",
  "owner_visual_approval": { "approved": true, "artifact_sha256": "<64hex>", "recorded_at": "ISO-8601" },
  "independent_review": { "model": "GPT-5.6 Sol", "effort": "Medium", "task_ref": "<id>", "implementer_task_ref": "<different id>" },
  "repository": { "head": "<40hex>", "baseline_sha256": "<64hex>", "tree_before_sha256": "<64hex>", "tree_after_sha256": "<same>" },
  "fixture": { "world_id": "dogfood-alchemist-midnight-study", "version": 15, "entity_count": 13, "scene_identity": "sha256:f4bb39db91d785d657fb56059e7222f4", "manifest_sha256": "85a83b...48c0f", "tool_log_sha256": "2c6898...9304" },
  "identity": { "identity_schema_version": 1, "content_hash": "<64hex>", "renderer_hash": "<64hex>", "render_plan_hash": "<64hex>", "live_headless_equal": true },
  "measurements": { "live": { "draw_calls": 0, "triangles": 0, "fps": 0, "p95_ms": 0 }, "headless": { "draw_calls": 0, "triangles": 0, "fps": 0, "p95_ms": 0 } },
  "visual_parity": { "live_ssim": 0, "headless_ssim": 0, "mean_abs_max": 0, "p999_abs_max": 0, "owner_approved": true },
  "regressions": { "p05": "PASS", "negative_fixtures": "PASS", "tree_preservation": "PASS", "vault_hashes_unchanged": true },
  "artifacts": { "root": ".artisan-artifacts/verify-authored-budget/<run-id>", "report_sha256": "<64hex>", "manifest_sha256": "<64hex>" },
  "closes": ["BUILD-AUTHORED-BUDGET", "ABG-1", "FND-AUTHORED-REPLAY-DRAW-BUDGET"],
  "deferred": ["BUILD-CREATIVE and P1 remain unstarted", "Hall/Vault optimization remains P2"]
}
```

Ellipsized sample hashes above are explanatory only; produced JSON requires full lowercase 64-hex values. Schema validation rejects unknown top-level keys, missing data, task-ref equality, hash shortening, rounded metrics and any non-PASS required gate.

### Closeout order and rollback

1. Verifier writes artifact-root outputs only and exits 0.
2. Independent reviewer validates artifact hashes, report semantics, exact fixture and tree equality; records review in `.bridge/ARTISAN-AUTHORED-BUDGET-INDEPENDENT-REVIEW.json`.
3. Owner reviews visual sheet/diffs and gives explicit approval; without it, stop with governance unchanged.
4. Independent reviewer creates the acceptance JSON.
5. Append immutable entries to `.bridge/ARTISAN-P06-WORKLOG.jsonl` and update `.bridge/ARTISAN-P06-HANDOFF.json`.
6. Close finding `FND-AUTHORED-REPLAY-DRAW-BUDGET`, then `ABG-1`, then `BUILD-AUTHORED-BUDGET` in `FINDINGS.json`/`PLAN.json`; do not start or close `BUILD-CREATIVE`.
7. Regenerate `board.html` with the existing generator and run the governance gate. Record its output hash in the acceptance addendum; never edit the board by hand.
8. Final tree comparison allows only the exact review, acceptance, worklog, handoff, `FINDINGS.json`, `PLAN.json` and generated `board.html` closeout paths. Existing P0/P0.5 records remain byte-identical.

Stop without closeout on any gate failure, environment mismatch, unexpected path, fixture/baseline drift, unstable measurement, owner rejection, artifact hash mismatch or tree difference. If implementation rollback is required, restore only A–C allowlist preimages from the P0.6 baseline and remove only P0.6-created files after exact-path review; never use broad reset/checkout and never change the fixture or thresholds. Re-run starts a new run id and preserves the failed run.

### Slice D execution contract

- **Evidence:** P0.5 report/acceptance, canonical fixture/hash, A-12, plan nodes and implementation handoff.
- **Preconditions:** all above; fresh independent task.
- **Exact expected file allowlist:** new `scripts/verify_authored_budget.mjs`; focused tests only if the independent review proves a verifier defect and stops before changing them; generated artifact root; new `.bridge/ARTISAN-AUTHORED-BUDGET-INDEPENDENT-REVIEW.json`; new `.bridge/ARTISAN-AUTHORED-BUDGET-ACCEPTANCE.json`; `.bridge/ARTISAN-P06-WORKLOG.jsonl`; `.bridge/ARTISAN-P06-HANDOFF.json`; `FINDINGS.json`; `PLAN.json`; generated `board.html`. The acceptance task must not edit A–C product code.
- **Forbidden files:** fixture, baselines, P0.5 records, product/source code, existing master plan, Hall/Vault, `.ctx`, plugin installation.
- **Ownership:** verifier measures; independent reviewer adjudicates; owner alone approves visual parity; governance closeout follows both.
- **Contract/schema change:** acceptance schema above only.
- **Migration:** none.
- **Positive tests:** one canonical run plus artifact/schema self-validation.
- **Negative/adversarial tests:** all A–C negatives, threshold boundary 30/31 and 15000/15001, FPS 59.999, fixture substitution, baseline mutation, same-task reviewer, hash tamper, masked diff, tree mutation.
- **Performance guard:** numeric gates are closure conditions, never warnings.
- **Identity guard:** full live/headless identity/plan equality and no cross-label artifact.
- **Visual guard:** objective thresholds plus owner approval.
- **Vault impact:** cabinet hashes must remain unchanged; no cabinet command.
- **Rollback boundary:** governance closeout is not attempted on failure; artifact run is retained. Closeout files alone are reverted if post-closeout governance gate fails.
- **Dependencies:** A, B and C implemented and handed off.
- **Explicit non-goals:** implementation repair during acceptance, baseline updates, P1 start, Hall acceptance.
- **Stop condition:** any failed or unverifiable requirement.
- **Recommended model:** fresh GPT-5.6 Sol Medium.
- **Expected implementation-task size:** one independent acceptance task; one command plus review/closeout, no product edits.

## 7. P0.6-E — Read-only Fantastic Hall references

### Objective and conflict policy

Expose a compact, conflict-aware MCP reference pack without adding tools or altering either Fantastic implementation. The pack keeps the walkable world/Hall and diorama adaptation in separate namespaces until the owner deliberately selects a future creative target. It never presents adaptation telemetry as walkable telemetry, observed code as approved intent, or intent as implemented contract.

Canonical URIs remain the proposed safer structure:

```text
artisan://reference/fantastic-hall/index
artisan://reference/fantastic-hall/walkable/v1/{summary,zones,kit,materials,lighting,composition,performance,vault}
artisan://reference/fantastic-hall/diorama-adaptation/v2/{summary,kit,materials,composition,performance}
```

### Common compact envelope

Every resource returns the following envelope; payload-specific schemas appear below.

```json
{
  "uri": "artisan://...",
  "referenceContractVersion": "fantastic-hall-reference/1.0.0",
  "sceneRef": {},
  "truthClasses": ["OBSERVED_TRUTH"],
  "claims": [{ "class": "OBSERVED_TRUTH | CREATIVE_INTENT | TARGET_CONTRACT", "confidence": "high | medium | low", "text": "...", "sourceIds": ["..."] }],
  "sourceFiles": ["repo-relative/path"],
  "sourceHashes": { "repo-relative/path": "sha256:<64hex>" },
  "supportingArtifacts": [{ "path": "...", "sha256": "<64hex>", "identity": {} }],
  "evidenceSha256": "sha256:<64hex>",
  "refreshedAt": "ISO-8601",
  "refreshRule": "explicit rule id",
  "stale": false,
  "staleReasons": [],
  "payload": {}
}
```

`evidenceSha256` is SHA-256 of canonical JSON containing URI, reference-contract version, structured identity, claims, source hashes, supporting-artifact hashes and payload, excluding `refreshedAt` and the digest field itself. It authenticates the resource response; it does not turn an unauthenticated metric into evidence. Each claim has exactly one truth class. Mixed resources separate claims rather than applying one ambiguous label.

The server computes file hashes at read time and compares them with the generated identity/reference manifest. Missing source, hash/contract/identity mismatch, unapproved new dependency, missing evidence, wrong evidence identity or generator drift returns structured `REFERENCE_STALE` with URI and `staleReasons`; substantive payload is withheld. No stale cached payload is served. A known absence, such as no authenticated walkable performance report, is current Observed Truth and returns `measurementStatus: "unavailable"` with no numeric metric.

Refresh is explicit: update the relevant source set, regenerate identity/reference hashes in the implementation task, review claim classification, and pass reference tests. No request, Studio launch or MCP startup auto-refreshes checked-in hashes. Responses are deterministically sorted and reject output above the token envelope instead of truncating fields silently.

### Source sets

Every set below means the exact listed paths and their current SHA-256 values in Appendix A; Slice A generated identity files are added after they exist.

- **I:** `src/contracts/artisanContract.js`, `src/contracts/sceneIdentityContract.js`, `src/contracts/sceneIdentityManifest.generated.js`, `src/main.js`.
- **W-CORE:** `src/game/fantastic-world/main.js`, `core/{ctx,palette}.js`, `world/{hall,props,exterior,sky}.js`, `fx/{particles,lighting}.js`, `player/{avatar,controls}.js`, `interaction/interaction.js`, `ui/{hud,bridge}.js`, `audio/ambience.js`.
- **W-ZONES:** walkable `main.js`, `hall.js`, `exterior.js`, `controls.js`, `interaction.js`, `hud.js`.
- **W-KIT:** walkable `hall.js`, `props.js`, `exterior.js`, `sky.js`, `particles.js`.
- **W-MATERIALS:** walkable `palette.js`, `hall.js`, `props.js`, `exterior.js`, `sky.js`, `particles.js`, `lighting.js`.
- **W-LIGHTING:** walkable `fx/lighting.js`, `props.js`, `exterior.js`, `palette.js`.
- **W-COMPOSITION:** walkable `main.js`, `hall.js`, `props.js`, `exterior.js`, `sky.js`; support `scripts/view_south_hall.png`.
- **W-PERFORMANCE:** I + W-CORE + `PERFORMANCE_PROFILES`; authenticated walkable evidence is currently absent.
- **W-VAULT:** `HARNESS-SIJ.json`, `scripts/gate_cabinet.js`, `scripts/verify_live_vault_and_game.mjs`, `docs/specs/SPEC-06-GOVERNED-CABINETS.md`.
- **D-CORE:** `src/foundry/FantasticWorldBuilder.js`, `src/main.js`, `src/engine/{MaterialFoundry,LightingRig}.js`, `src/contracts/artisanContract.js`.
- **D-COMPOSITION:** D-CORE plus `.artisan-artifacts/verify/artifacts/preset_fantastic.png`.
- **D-PERFORMANCE:** D-CORE plus `.artisan-artifacts/verify/verify_report.json` and that preset screenshot.

### Resource-by-resource contract

| URI suffix | Purpose and compact `payload` schema | Sources / truth classes | Refresh and fail-closed discriminator | Max useful tokens |
|---|---|---|---|---:|
| `index` | `identities[] {name,kind,logicalId,version,sceneIdentity,dimensions,canonicalRole,aliases}`, `conflicts[]`, `resources[] {uri,class,status}` | I, W-CORE digest, D-CORE digest; Observed Truth and explicitly labeled Target Contract for canonical names | Any identity/source-set digest or reference-contract change; withhold index on unresolved identity or alias collision | 600 |
| `walkable/v1/summary` | `{purpose,scale,implementationType,invariants,heroElements[],knownDefects[],notThis[]}` | I + W-CORE; Observed Truth, Creative Intent only as separate claims | Any W-CORE change; fail if dependency closure drifts | 500 |
| `walkable/v1/zones` | `zones[] {id,name,boundsOrPredicate,entrances[],anchors[],sightlines[],confidence}`, `unmodeled[]` | I + W-ZONES; Observed Truth plus labeled Creative Intent | Zone source/parent identity change; fail on unprovable bound/predicate, never synthesize geometry | 800 |
| `walkable/v1/kit` | `modules[] {id,sourceSymbol,dimensions,repeatRule,instanceCount,fiveTierRole,limitations}`, `targetMappings[]` | I + W-KIT; Observed Truth; mappings are Target Contract | Builder/source change; fail if symbol/count extraction is ambiguous | 900 |
| `walkable/v1/materials` | `roles[] {id,paletteValue,currentImplementation,pooled,targetCatalogId,defects[]}` | I + W-MATERIALS; Observed Truth and separate Target Contract | Palette/material constructor change; unknown target id is an error, never dark oak | 900 |
| `walkable/v1/lighting` | `groups[] {id,purpose,temperatureRole,anchors,intensity,shadowPolicy,costStatus}`, `post` | I + W-LIGHTING; Observed Truth and Creative Intent | Any light/post/palette change; fail on unbounded or inferred cost | 800 |
| `walkable/v1/composition` | `anchors[]`, `sightlines[] {from,to,role,confidence}`, `cameraHypotheses[]`, `artifactRefs[]` | I + W-COMPOSITION; Observed Truth and explicitly low/medium-confidence Creative Intent | Source or screenshot hash change; missing screenshot removes artifact-backed claims, never reuses adaptation image | 700 |
| `walkable/v1/performance` | `{measurementStatus,profile,budget,lastAuthenticatedMeasurement,knownStaticContributors[],evidenceGap}` | I + W-PERFORMANCE; Observed Truth and Target Contract budget | Until identity-bound game report exists, `measurementStatus:"unavailable"`, metrics null; reject `preset:fantastic` report | 700 |
| `walkable/v1/vault` | `cabinets[] {id,target,status,checkType,metricSource,goldenStatus,gaps[]}`, `globalThresholds`, `claimsLimit` | I + W-VAULT; Observed Truth only | Any SIJ/gate/spec/live-script change; fail if stored/default metric is presented as live | 750 |
| `diorama-adaptation/v2/summary` | `{purpose,scale,implementationType,invariants,knownDefects[],relationshipToWalkable}` | I + D-CORE; Observed Truth | Any D-CORE/identity change; fail if labeled as walkable/canonical Hall | 500 |
| `diorama-adaptation/v2/kit` | `modules[] {id,sourceRange,geometryStrategy,instanceCount,dimensions,limitations}` | I + `FantasticWorldBuilder.js`; Observed Truth | Builder hash change; fail on pseudo-manifest substitution | 850 |
| `diorama-adaptation/v2/materials` | `roles[] {requestedRef,resolvedRef,catalogStatus,currentDescriptor,defect,targetRule}` | I + D-CORE; Observed Truth and Target Contract | Builder/foundry/catalog change; explicitly surface current fallback defect until Slice C removes it | 750 |
| `diorama-adaptation/v2/composition` | `anchors[]`, `sightlines[]`, `camera`, `artifactRefs[]`, `differencesFromWalkable[]` | I + D-COMPOSITION; Observed Truth and labeled Creative Intent | Source/image hash change; fail on cross-image or cross-identity use | 650 |
| `diorama-adaptation/v2/performance` | `{profile,identity,viewport,gpu,drawCalls,triangles,fps,budget,within,evidenceRef}` | I + D-PERFORMANCE; Observed Truth and Target Contract budget | Report must hash-match and identify adaptation; current evidence is 58/35, 7,036 triangles, 60.2 FPS; fail on legacy-only attribution | 650 |

### Slice E execution contract

- **Evidence:** completed Hall reference pass, independently confirmed source symbols/hashes, identity model A and current MCP resource implementation.
- **Preconditions:** Slice A accepted; reference contract/source manifest generated; no source-set drift.
- **Exact expected file allowlist:** new `mcp-server/reference-fantastic-hall.js`; `mcp-server/index.js`; new `mcp-server/test_reference_resources.js`; `mcp-server/test_stdio_client.js`; `scripts/check_contract_drift.mjs`; `.bridge/ARTISAN-P06-WORKLOG.jsonl`; `.bridge/ARTISAN-P06-HANDOFF.json`. Artifact-only test output may use `.artisan-artifacts/reference-tests/`.
- **Forbidden files:** all referenced Hall/diorama/Vault source, images/reports, identity baselines, product compiler/foundry, fixtures, PLAN/FINDINGS/board until D closeout.
- **Ownership:** reference module extracts/classifies/serializes; identity contract authenticates; MCP index registers read-only resources; referenced systems remain owners of facts.
- **Contract/schema change:** additive read-only resource contract `fantastic-hall-reference/1.0.0`; no tools and no manifest fields.
- **Migration:** none; index documents legacy aliases without serving legacy metrics as canonical.
- **Positive tests:** every URI, schema, deterministic ordering/hash, token limit, truth-class separation, exact source lists and current unavailable walkable performance state.
- **Negative/adversarial tests:** source/evidence tamper, missing source, extra dependency, stale identity, wrong namespace, adaptation-as-walkable report, stored Vault default as live, over-token payload, unknown material target and legacy alias collision.
- **Performance guard:** resource reads are bounded O(total declared source bytes), cached only by full source-set digest, and never launch/render; response token caps above.
- **Identity guard:** every response carries correct structured identity; cross-label evidence rejected.
- **Visual guard:** read-only; screenshot hashes may support claims but files are never transformed.
- **Vault impact:** cabinet definitions/gates are read-only and their limitations reported literally.
- **Rollback boundary:** remove the one new module/test and resource registrations only; no referenced file is touched.
- **Dependencies:** Slice A; independent of B/C/D implementation.
- **Explicit non-goals:** authoring assemblies/zones/cameras/lights, Hall edits, performance repair, new tools, auto-refresh, choosing a canonical future surface.
- **Stop condition:** stale data served, truth classes mixed, cross-label metric, token overflow, any referenced-file write or Studio/render launch.
- **Recommended model:** GPT-5.6 Sol Medium; Terra Medium may perform read-only inventory only.
- **Expected implementation-task size:** one fresh Medium task, 4–6 files plus append-only handoff/worklog.

## 8. Vault boundary

P0.6 A–E work is outside the nine walkable cabinets. The only unavoidable cabinet-adjacent actions are read-only hashing and extraction for identity dependencies and reference resources. The protected files are:

`src/game/fantastic-world/fx/lighting.js`, `world/hall.js`, `world/exterior.js`, `world/sky.js`, `world/props.js`, `fx/particles.js`, `core/palette.js`, `audio/ambience.js`, and `player/controls.js`.

P0.6 must not modify those files, the walkable host's visuals, exterior, props, sky, particles, palette, ambience, controls or lighting, nor use them as mutable tests. Changes to any protected source, golden reference, SIJ cabinet record, thresholds, promotion state, gate semantics, Hall performance baseline or Vault tool require a separate owner-authorized P2/Vault specification, fresh baseline, real live measurements, visual acceptance and rollback plan. The same separate authorization is required to optimize the walkable Hall. P0.6's 30-draw goal applies only to the authored replay, not the 35-visible-draw walkable profile.

## 9. Long-term creative power-tool roadmap (not implemented here)

| Capability | Classification | Boundary carried forward |
|---|---|---|
| Reusable assemblies | P1 creative authoring | Versioned graphs, named parts/anchors/dependencies; absent from P0.6. |
| Parametric smart constructors | P1 creative authoring | Typed bounded parameters and constructor versions. |
| Five-tier geometry/detail | P0.6 prerequisite | Preserve law/invariant only; no new generator machinery. |
| Deterministic variation | P0.6 prerequisite | Stable scene/entity seeds and content identity only. |
| LOD and collision variants | P2 Hall/Vault work | Named outputs selected by profile/semantic intent. |
| Procedural/generated/imported textures | P1 creative authoring | Explicit repeatable source recipes and provenance. |
| Albedo/normal/roughness/metallic/AO/emissive maps | P1 creative authoring | Typed channel slots and validation. |
| UV/atlas/triplanar strategies | P1 creative authoring | Authored mapping policy, never implicit guess. |
| Hashing/caching/dedup/provenance for texture assets | P1 creative authoring | Content-address source+settings; retain provenance. |
| Resolution/memory/compression budgets | P2 Hall/Vault work | Mode/platform residency, mip, atlas and compression gates. |
| Visual-quality/fallback rules | P0.6 prerequisite | Explicit, observable, quality-ranked; no silent generic replacement. |
| Walkable zones | P2 Hall/Vault work | Typed navigation surface semantics. |
| Spawn/interaction anchors | P2 Hall/Vault work | Purpose, orientation, clearance, ownership and validation. |
| Portals/transitions | P2 Hall/Vault work | Declarative endpoints; runtime owns loading/presentation. |
| Trigger volumes | P2 Hall/Vault work | Typed inspectable volumes and filters. |
| Navigation/collision intent | P2 Hall/Vault work | Renderer-independent policies. |
| Environmental storytelling roles | P1 creative authoring | Deterministic narrative roles and placement guidance. |
| Audio/effects anchors | P2 Hall/Vault work | Named spatial anchors plus event intent. |
| Gameplay-state bindings | Later game-production layer | Versioned state machines only after authoring/Hall semantics stabilize. |

No roadmap item expands A–E. Each future phase requires its own schema, migrations, budgets, authoring surface, tests, acceptance and rollback.

## 10. Execution order, governance and model routing

Execution uses fresh tasks and the exact allowlist of one slice at a time:

```text
A identity (accepted) ──> B render plan ──> C pooling/batching ──> D independent ABG-1 acceptance
        └───────────────> E read-only references (may run separately after A)
```

Before A, create the immutable P0.6 baseline and handoff. Do not combine design, implementation and independent acceptance in one task. After each slice, append worklog/handoff with hashes, stop, and use a fresh task. D alone may close governance. P1 remains blocked until D accepts and E passes its resource contract.

Default routing:

- P0.6-A identity boundary: GPT-5.6 Sol High.
- P0.6-B render-plan implementation: GPT-5.6 Sol High.
- P0.6-C bounded mechanical implementation after B freezes design: GPT-5.6 Sol Medium.
- Cross-boundary batching/debug/evidence contradiction: GPT-5.6 Sol High.
- P0.6-D independent ABG-1 acceptance: fresh GPT-5.6 Sol Medium.
- P0.6-E deterministic references: GPT-5.6 Sol Medium.
- Routine read-only inventory: GPT-5.6 Terra Medium.
- Final independent end-to-end creative dogfood: GPT-6 Astra High.

Do not route to Astra before final dogfood unless Sol documents a proven cross-boundary contradiction that survives the specified discriminators.

### Open owner decisions

1. Which surface—walkable world/Hall or diorama adaptation—should become the future primary creative-authoring target. P0.6 intentionally does not choose.
2. The D-stage visual parity approval after objective metrics pass. This is required but cannot waive a failure.
3. When to authorize P2 Vault hardening and walkable Hall optimization. Neither blocks authored-budget work but both remain outside it.

## 11. Appendix A — observed source-hash baseline

These lowercase SHA-256 values were read at verified HEAD/worktree state and make reference provenance explicit. The future P0.6 baseline must re-read and authenticate them before implementation; a mismatch stops rather than silently updating this table.

| Path | SHA-256 |
|---|---|
| `src/main.js` | `cc3df893cebfeaa3114ad50a7e3547a1d0c4b0bbf7804d985a3e02ee62005c83` |
| `src/contracts/artisanContract.js` | `d16ab7df20d91f7a909419d2447fbffaf5c212ef86c278137f572d6ce4640b9a` |
| `src/engine/WorldCompiler.js` | `f93751c20498a6232e7017551cd1874fb335d6463fa520e017d3d28924ec3149` |
| `src/engine/MaterialFoundry.js` | `eb55948e2ccd9cc4bbb41e6126140f434afef17723d8380c8df8aeef6f754643` |
| `src/engine/LightingRig.js` | `67c11fba558ac984ee1fe993127c560c2eae92d5bd10a86c9c0a073f51f72282` |
| `mcp-server/WorldSession.js` | `d41e5023d34f55ae70a8fa4cc099f843478acb3cb0b3aa77c2eec678aaaf48c1` |
| `mcp-server/Validator.js` | `e0dda3ee3f01500ce6e6731df3a0790e74db87ea1dc94a39f2edfc86a50651cc` |
| `mcp-server/index.js` | `74a23b2c7fd8a0d0e75cd3c3a2a1d8fb364cbbadd52590b1c06c3721b83cf388` |
| `mcp-server/HeadlessRunner.js` | `fd5d8d6dc7d5483eb7ca1f9277933967feca8229929e2e589e377141f16ac362` |
| `src/game/fantastic-world/main.js` | `d2b752b707ede5859d636a2aee6c45e339f9f515e1298935f29af131b2d5a2fb` |
| `src/game/fantastic-world/core/ctx.js` | `82d40cff19e64ec923fa95d72d1ece00b4f9c8aa374802a73523985ca6b66313` |
| `src/game/fantastic-world/core/palette.js` | `0b91d06ec9dc88214b88808a7b45a5ade39ee632b9b450b74413198caa8080fd` |
| `src/game/fantastic-world/world/hall.js` | `25a625237ba4d370b24ff4043ec70b1fd25b844d448fb2c43eabca266a0dc1de` |
| `src/game/fantastic-world/world/props.js` | `94338b4518021fe5f089b1b4e988ce1c7d61da68c8d9aae1e9df99e8ad67d90e` |
| `src/game/fantastic-world/world/exterior.js` | `f39c4f5340e3210bf5877015e6f9e36afb4f0ef6fd08843080eaaea3f3c50be9` |
| `src/game/fantastic-world/world/sky.js` | `f69ff8fbb31f04f7a61aa9b48399563fe1f64c47d4d7af5dd16d5a17e0278309` |
| `src/game/fantastic-world/fx/particles.js` | `7e761d737f1b8176fb99c5e9735f4af6874ca91c0c66ef9e54d28e60a2e863b2` |
| `src/game/fantastic-world/fx/lighting.js` | `a1b81bccaa3ca276a3711d6229621ac67d4852a6c1a0f3dd10791c5b77f75390` |
| `src/game/fantastic-world/player/avatar.js` | `bfce098d300820aae3ad0c0bf3095f759439262b685ac0c056e618285976e98a` |
| `src/game/fantastic-world/player/controls.js` | `17a122b2e21e3f773f0ec3e19a2b5840ab4217dc0e7a310cbbc7c092f49413eb` |
| `src/game/fantastic-world/interaction/interaction.js` | `41634925068fb45b0098fd6e59c3c1d96907c51601cf08ed12ff30058acddd02` |
| `src/game/fantastic-world/ui/hud.js` | `cb9bc9a8225b1cde65037f6bba06678062d1e73c8f16d346b138ce7aa31e448a` |
| `src/game/fantastic-world/ui/bridge.js` | `f9eb0e1b49399ce0d1930502cbf15c1227cee89c99742a17e8e7733f750a6263` |
| `src/game/fantastic-world/audio/ambience.js` | `23dcb8701ea8f2ccaaced374cd2624e6b9d1b9d0e6d76cc313b303127ad24599` |
| `src/foundry/FantasticWorldBuilder.js` | `14fa7340ce312bf2ed3cab1fbf1d51eb2d9fdc8f53968742d47440fad3e1c81c` |
| `HARNESS-SIJ.json` | `32a64f910f34f408fc34037403d0e7508a03067b38c109b1738e05ed50a801c1` |
| `scripts/gate_cabinet.js` | `e52dcc3a23f5244530f46c83ce02108c0a0c1d438f0cdf3362d7e1c3eb86d037` |
| `scripts/verify_live_vault_and_game.mjs` | `d75bd6aa5fe2f53a21c6894b1c05a78258a4ff0d5511244ef5bffb0d928bb570` |
| `docs/specs/SPEC-06-GOVERNED-CABINETS.md` | `37ad9379d1111316f2e1de10a172c255e080fbd32bc83563b44879f776a455ab` |
| `.artisan-artifacts/verify/verify_report.json` | `215f25a33b20eb5b8998a9eed1c8c6ea5fb3258a6b28d91af7d1e63ce0994089` |
| `.artisan-artifacts/verify/artifacts/preset_fantastic.png` | `3aadde3de4862b90be45c8f10340a23f4cbc84c267c94e2525136165fae62fe7` |
| `scripts/view_south_hall.png` | `6a35efd564930a67649ebe88f2984cddb2701f0beed639b13321b2d782a63953` |
| `.artisan-artifacts/verify-evidence/latest/evidence_integrity_report.json` | `451c8ff5567b83184140285c28729bf50ae505ecf7c405eb1c62b0a07c6119a3` |

## 12. Specification stop condition

This document is the only authorized output of the present task. No source, test, fixture, governance state, baseline, worklog, handoff, board, plugin, `.ctx`, Vault/Hall file or external harness was modified; no server, Studio, browser, render or expensive verifier was started; no implementation or P1 work occurred. The next action, if authorized, is a fresh Slice A implementation task—not execution in this specification task.
