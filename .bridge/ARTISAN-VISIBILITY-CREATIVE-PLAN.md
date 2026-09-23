# Artisan Studio — Visibility & Creative Unlock Plan

Status: audit complete; planning only; no implementation performed  
Date: 2026-09-21  
Target: C:/Users/Fabio D/.gemini/antigravity/scratch/artisan-studio-app  
Executed-plan reference: C:/Users/Fabio D/Documents/ChatGPT/Artisan Studio App (newest in GPT)/.bridge/ARTISAN-ASTRA-LOCAL-MCP-PLAN.md

## Executive verdict

Claude built a real private/local MCP server and a valid Codex plugin, not a label or imitation. The core authoring loop works against the current MCP SDK, the Studio receives and compiles authored manifests, determinism is real, the bridge is loopback-bound, and output paths are confined under the configured artifacts root.

The harness is useful now, but it is not yet the finished low-token creative “tech suit” for GPT-6 Astra:

- Local operational readiness: strong.
- Essence preservation and five-tier discipline: strong in the skill and procedural foundry.
- Contract integrity: incomplete. Catalog identifiers agree, but 22 of 53 canonical material records disagree with live PBR values.
- Non-degradation guarantee: safe on the normal manifest path, but not on every callable compiler path because compileEntity uses substring routing.
- Visibility: inadequate in Hearth and Winterhold; Tokyo and Winterhold ignore the three lighting modes.
- Creative range: constrained to fixed archetypes, whole-material replacement, and fixed lighting presets.
- Token efficiency: narrowly inside the 2,000-token tool-schema target, but with essentially no expansion headroom. A normal cold start is approximately 6,000 tokens before tool-result payloads if the skill’s current resource sequence is followed.
- Governance truth: three preset draw-call overages are real and pre-existing, but current governance language still overstates compliance.

Recommendation: refine, do not rewrite. Execute P0 first to make the existing system truthful and visible. Execute P1 only after P0 is accepted, to add bounded creative authorship and lower Astra’s token cost.

## Non-negotiable constraints

1. Keep the project private and local. Publish nothing.
2. Do not touch or import C:/Users/Fabio D/Desktop/THREEJS_HARNESSING.
3. Preserve the current dirty working tree byte-for-byte outside the approved file allowlists below.
4. Preserve the 5-Tier Compounding Law and the non-degradation invariant.
5. Keep the canonical contract in src/contracts/artisanContract.js.
6. Keep deterministic scene identity: identical canonical manifest plus seed must produce identical identity and geometry.
7. No raw-geometry fallback for unknown archetypes.
8. Keep materials pooled; an entity variant may clone or reuse a bounded variant, but must never mutate the shared base material.
9. Keep the preview bridge on loopback and keep all file outputs inside the configured artifact root.
10. Do not loosen the 30-draw diorama or 35-visible-draw Fantastic World budgets to make tests green.
11. No commits.
12. After any PLAN.json edit, run python make_board.py and python scripts/gate.py.
13. Each execution phase starts in a fresh session. Capture a new byte/hash baseline before changing source.

## Phase 1 — Independent audit

### Preservation and handoff reconciliation

| Check | Result | Independent evidence |
|---|---|---|
| HEAD unchanged | PASS | HEAD remains 909d41f182b2c4446411af6e19251f04257e13bf. |
| Claude-declared files versus Git state | PASS | 140 current dirty/untracked paths; after correcting the baseline typo, 26 post-baseline candidate paths exist and every one is covered by handoff.files_changed. Every declared entry has a corresponding real path. |
| All 94 baseline entries still represented | PARTIAL | The ledger contains 94 entries and every valid entry is still present/dirty. The first entry is malformed as ndex.html; the real path is index.html. |
| Byte preservation of all 94 entries | NOT PROVED | The baseline ledger stores paths only, not hashes or copies. An older pre-Claude archive proves 57 of 79 represented files are byte-identical and none are missing; 22 differ and 33 baseline entries are absent from that older archive. That archive cannot prove all edits present immediately before Claude were preserved. |
| Audit added project changes | PASS | Git status after the audit matches the pre-audit status. Audit screenshots/reports were confined to TEMP or the existing ignored .artisan-artifacts directory. |

Ledger discrepancies to correct during execution:

- The handoff cites .bridge/baseline/_dirty_paths.json, but the real file is .bridge/baseline_dirty_paths.json.
- Both the handoff and the ledger record ndex.html instead of index.html.
- A path inventory is not a preservation proof. P0 must create a SHA-256 baseline of the exact starting tree.

### Acceptance-gate audit

| Gate | Status | Independent evidence and limitation |
|---|---|---|
| 1. Current SDK initializes and lists/calls tools, resources, templates, prompts | PASS | Independently discovered 13 tools, 8 resources, 2 resource templates, and 2 prompts through SDK 1.30.0. Full verifier: mcp-stdio-sdk 64/64. |
| 2. Valid and invalid input per tool returns structured results/errors | PASS | World tools have valid coverage; browser-backed tools passed live E2E; all 13 tools have invalid-input coverage with isError and error.code. |
| 3. Authoring prompts validate | PASS | authoring-manual uses role user; scene-template accepts theme and rejects its absence. |
| 4. Fresh Astra task discovers the skill and starts the MCP | PARTIAL | Plugin 2.0.0 is installed, cached, enabled, and starts 13 tools. This already-running task did not dynamically expose the new skill/tool namespace, and no fresh GPT-6 Astra model task has yet followed the skill. A fresh-task acceptance run remains mandatory. |
| 5. Create, author, validate, preview, inspect, screenshot | PASS | Independent cold start using only plugin metadata, skill, MCP schemas/resources, and tools: 7 entities, Dusk, 30/30 draws, 6,144 triangles, about 60 FPS, screenshot at C:/Users/FABIOD~1/AppData/Local/Temp/artisan-audit-coldstart/audit_alchemist_corner.png, identity sha256:a0d3a408942c4f9a81c27da921a3fffc. |
| 6. Same request and seed gives same manifest/identity | PASS | Verifier reproduced sha256:9abb326ff5be418711a593537a11e67f in separate MCP processes. |
| 7. Unknown archetypes never become primitives on every code path | FAIL | Normal WorldCompiler.compile and MCP validation reject unknown ids. Public compileEntity directly accepts unknown.table, unknown.lantern, and totally.alchemist_shell.fake because substring routing matches known builders. The current gate tests only mystery.thing and misses this bypass. |
| 8. Skill, MCP, and engine contracts agree | PARTIAL | IDs, relationships, seed rules, scenes, and budget numbers agree. However, 22/53 material entries differ in color and/or PBR values between MATERIAL_CATALOG and MaterialFoundry. The drift gate checks key sets, not values. Compiler routing is text-matched, not behavior-tested. |
| 9. Loopback/privacy and artifact confinement | PARTIAL | 127.0.0.1 bind, Host/Origin rejection, size cap, traversal prevention, and configured-root confinement pass. The no-writes gate compares Git status strings and cannot detect writes to already-dirty files, ignored paths, or paths outside Git. WebSocket clients with no Origin are currently accepted. |
| 10. Syntax/build/spatial/S.A.R.T./visual/performance gates green | PARTIAL | Syntax, build, spatial checks, and P1-P10 structural governance pass. The verifier is 26/27 with the preset-profile-budgets warning. The visual smoke test checks PNG byte size, not readability. Three declared performance budgets remain exceeded. |
| 11. Tool-schema overhead at or below about 2,000 tokens | PASS, NARROW | 7,873 characters, approximately 1,969 tokens. This leaves about 31 estimated tokens of headroom and uses a chars/4 estimate rather than the exact Astra tokenizer. |

### Specific challenged claims

#### Minimal output schemas

The implementation meets the executed plan’s literal requirement to provide outputSchema and structuredContent, but the schemas are permissive:

- no output field is required;
- additional properties are implicitly allowed;
- nested objects are mostly typed only as object or array;
- the SDK therefore proves only a weak shape.

This is acceptable as a compatibility bridge, not as the final semantic contract. P1 must require ok and the critical success/error fields while staying within the reduced tool budget.

#### PLAN.json INT-2 evidence

PASS. The pre-Claude snapshot pointed INT-2 to mcp-server/index.js. The symbol moved to mcp-server/bridge.js, the new evidence target exists, and board.html reflects it. This was a legitimate evidence-path repair, not plan laundering.

#### Historical draw-call claim

PASS. A snapshot written on 2026-09-20, before Claude’s session, was extracted into an isolated temporary root and run with the same Intel UHD / 1280x720 method:

- Tokyo: 45 draws.
- Winterhold: 39 draws.
- Fantastic: 58 visible draws.

The current verifier reproduced the same values. These overages predate Claude’s MCP/plugin work.

#### Unknown-archetype routing

The normal Studio/MCP path is safe because full-world validation runs before compilation. The stronger claim “every code path” is false until compileEntity performs an exact catalog guard before any routing. Substring routing also makes arch.tokyo_walls match the apartment-shell branch before its intended walls branch, so the current drift test proves textual reachability, not correct semantic routing.

#### Loopback and confinement

The server is appropriately local/private for its current threat model. P0 should strengthen proof rather than invent a network service:

- require an allowed Origin for browser WebSocket upgrades;
- verify reply type as well as request id;
- route every MCP artifact write through artifacts.js;
- replace status-line comparison with a SHA-256 tree comparison excluding the configured artifact root and OS temp.

### Independently measured visibility

Method: renderer canvas only, 1280x720, device scale 1, Intel UHD ANGLE/D3D11, Rec.709 luma Y, one settled frame after each mode change. Near-black means Y below 24; clipped means Y above 245. Clipped pixels were at or below 0.038% in every case.

| Scene | Dusk mean Y / near-black % | Hearth mean Y / near-black % | Sol mean Y / near-black % | Mode response |
|---|---:|---:|---:|---|
| Trio | 57.8 / 24.2 | 30.9 / 53.6 | 72.4 / 15.7 | responds |
| Tavern | 49.3 / 27.9 | 20.1 / 65.1 | 66.3 / 13.9 | responds |
| Alchemist | 56.2 / 24.2 | 26.3 / 53.0 | 67.9 / 11.5 | responds |
| Armory | 67.9 / 10.9 | 35.6 / 28.1 | 79.6 / 8.4 | responds |
| Library | 45.7 / 30.9 | 23.3 / 65.4 | 61.4 / 22.5 | responds |
| Tokyo | 118.3 / 13.1 | 118.3 / 13.1 | 118.3 / 13.1 | no response |
| Winterhold | 32.4 / 65.9 | 33.7 / 65.0 | 33.9 / 64.9 | no preset response; small difference is animated witchlight |

The suspected cause is confirmed in source: LightingRig has unconditional Tokyo and Winterhold branches that ignore preset. The medieval Hearth profile is intentionally lower than Dusk but crosses from dramatic into unreadable in four scenes. The manual MCP alchemist screenshot is also visibly underlit.

### Measured context cost

| Context item | Characters | Approx. tokens |
|---|---:|---:|
| 13 always-advertised tool declarations | 7,873 | 1,969 |
| Invoked plugin skill | 2,419 | 605 |
| artisan://essence | 2,719 | 680 |
| Full archetype catalog | 8,755 | 2,189 |
| Full material catalog | 3,257 | 815 |
| Seven selected archetype templates | 2,216 | 554 |

The current skill directs a normal task to load essence, the full archetype catalog, and then selected templates. That path is about 5,997 tokens before material lookup and before tool results. With the material catalog it is about 6,812. Repeated add_entity results then return full entity records, adding substantial avoidable context.

Conclusion: the tool list is compact by MCP standards, but the whole Astra workflow is not yet low-token.

## Decisions for execution

### D1 — Consolidate tools; do not raise the default budget

Target 11 advertised tools:

1. create_world
2. add_entities, replacing add_entity and supporting one or many entities atomically
3. update_entity, replacing move_entity and replace_material
4. remove_entity
5. set_lighting
6. validate_scene
7. get_telemetry
8. compile_preview
9. get_engine_telemetry, with an optional saveArtifact flag replacing import_telemetry_logs
10. run_performance_audit
11. capture_viewport_screenshot

Do not add separate light/material/parameter tools. Put canonical parameters on add_entities and update_entity. Keep old v2 tool names only behind ARTISAN_LEGACY_TOOLS=1 for one plugin version; do not advertise them by default.

### D2 — Make lazy knowledge genuinely progressive

- Add a compact archetype index grouped by category.
- Keep the full catalog available, but stop instructing Astra to read it by default.
- Put parameter schemas and light/material policies on individual archetype/material resources.
- Do not require artisan://essence for every ordinary build; invoke it for style-sensitive design, extension, or ambiguity.
- Keep governance/findings resources audit-only.

### D3 — Correct governance truth now; defer geometry optimization

Do now:

- record measured scene-level draw calls, viewport, GPU, timestamp, and measurement method;
- open explicit findings for Tokyo 45/30, Winterhold 39/30, and Fantastic 58/35;
- remove or qualify any claim that Fantastic is at or below 24 visible draws;
- preserve the canonical 30/35 budgets.

Do not blindly replace every cabinet’s last_verified_drawcalls with a whole-scene number. Those fields appear component-scoped and currently lack a reproducible isolation method. Add a scene_baselines section and either document cabinet-level measurement or set unverifiable cabinet metrics to unknown.

Defer draw-call remediation to a dedicated P2 performance plan after visibility and creative-contract work. Mixing geometry batching with a lighting/contract change makes visual regressions harder to attribute.

### D4 — Preserve dark artisan materials; improve illumination first

Do not globally bleach dark oak, forged iron, Nordic stone, or the moody palette. First fix the lighting-profile matrix, fill/bounce, exposure, and local authored lights. Permit targeted albedo changes only if numeric visibility gates still fail and a before/after contact sheet shows the material’s identity remains intact.

### D5 — Add a real compound candle asset

The current catalog has wax.candle as a material but no candle archetype. The requested “candle-lit alchemist corner” therefore substituted a lantern. P1 should add lighting.candle_cluster as a procedural compound archetype with bounded candleCount, asymmetry from seed, merged wax/flame geometry, and a constrained cavity/accent light. It must not be a raw cylinder-and-cone fallback.

## Phase 2 — Execution plan

## P0 — Truth, visibility, and trustworthy gates

Recommended executor: Claude Opus 5 in a fresh session. This phase crosses rendering, contracts, measurement, security, and governance; it should not be split among speculative fixes. GPT-6 Astra should perform the final black-box cold-start acceptance, not be used as proof of its own packaging.

### P0.0 Preserve the exact starting state

1. Create .bridge/ARTISAN-VISIBILITY-CREATIVE-BASELINE.json containing:
   - HEAD and branch;
   - complete porcelain status;
   - SHA-256 for every tracked or untracked project file outside .git, node_modules, .artisan-artifacts, and the new baseline file;
   - explicit normalization from ndex.html to index.html.
2. At each phase end, compare path presence and hashes for files outside that phase’s allowlist.
3. Stop immediately if an unapproved file changes.

### P0.1 Repair contract proof

1. Add an exact isKnownArchetype guard at the beginning of WorldCompiler.compileEntity.
2. Replace substring-only proof with executable routing tests for every catalog archetype and adversarial near-match ids such as unknown.table and totally.alchemist_shell.fake.
3. Resolve the 22 material-value mismatches without changing appearance:
   - first update the canonical contract to match current live material values;
   - then make MaterialFoundry consume or assert the canonical comparable fields;
   - keep procedural texture/shader construction in MaterialFoundry.
4. Strengthen output/write proof:
   - every artifact write routes through artifacts.js;
   - hash the project tree before and after verification;
   - require allowed Origin on browser WebSocket upgrades;
   - verify response type and id for pending bridge requests.

### P0.2 Add the brightness measurement harness

Create scripts/measure_brightness.mjs and npm script measure:brightness.

Measurement contract:

- 1280x720 viewport, device scale 1, fixed browser executable;
- renderer canvas only, no UI chrome;
- three settled samples per scene/mode; use the median;
- Rec.709 luma;
- near-black: Y below 24;
- clipped highlight: Y above 245;
- record mean, p10, p50, p90, near-black percentage, clipped percentage, draw calls, triangles, renderer/GPU, and screenshot hash;
- JSON report under ARTISAN_ARTIFACTS_DIR;
- optional PNG contact sheet under the same root;
- nonzero exit when an approved threshold or mode-response gate fails.

### P0.3 Make all lighting modes real and readable

1. Add a canonical scene-family by preset lighting-profile matrix to artisanContract.js.
2. Make LightingRig consume that matrix for medieval, Tokyo, Winterhold, and authored MCP worlds.
3. Make main.js apply profile exposure and expose read-only lighting telemetry for tests.
4. Tune in this order:
   - ambient/hemi bounce;
   - cool fill;
   - key intensity and direction;
   - local hearth/witchlight;
   - exposure within the existing 0.95 to 1.10 essence bound;
   - only then narrowly adjust albedo if still necessary.
5. Keep the dual-temperature relationship visible: warm key against cool fill, never flat white ambient.

Proposed approval thresholds:

| Mode | Mean luma floor | Near-black ceiling | Median luma floor | Clipped ceiling |
|---|---:|---:|---:|---:|
| Dusk | 58 | 22% | 42 | 2% |
| Hearth | 38 | 38% | 30 | 2% |
| Sol | 68 | 16% | 52 | 2% |

Mode response for every diorama:

- max mean-luma spread across Dusk/Hearth/Sol at least 12 points;
- Sol versus Hearth mean-luma difference at least 10 points;
- at least two canonical light/background fields change between every pair of presets;
- fixed-frame image RMS difference at least 3/255 between every pair.

### P0.4 Record performance truth without widening scope

1. Add scene_baselines to HARNESS-SIJ.json with the independently measured values.
2. Clarify or retire unverifiable cabinet draw-call fields.
3. Update FINDINGS.json with the three open overages.
4. Add governed PLAN.json nodes for visibility, contract truth, and creative unlocks.
5. Add docs/specs/SPEC-07-VISIBILITY-CREATIVE-CONTRACT.md.
6. Regenerate board.html and run the P1-P10 gate.
7. Keep the three overages as explicit non-blocking findings in this plan; do not claim the entire performance contract is green.

### P0 exact file allowlist

- .bridge/ARTISAN-VISIBILITY-CREATIVE-BASELINE.json — new
- src/contracts/artisanContract.js
- src/engine/LightingRig.js
- src/engine/MaterialFoundry.js
- src/engine/WorldCompiler.js
- src/main.js
- mcp-server/artifacts.js
- mcp-server/bridge.js
- mcp-server/test_ws_bridge.js
- scripts/measure_brightness.mjs — new
- scripts/check_contract_drift.mjs
- scripts/verify_astra_harness.mjs
- package.json
- HARNESS-SIJ.json
- FINDINGS.json
- PLAN.json
- docs/specs/SPEC-07-VISIBILITY-CREATIVE-CONTRACT.md — new
- board.html — generated only

No other file may change in P0 without pausing and amending this plan.

### P0 acceptance gates

1. scripts/measure_brightness.mjs passes every numeric target above.
2. Tokyo and Winterhold visibly and numerically respond to all three modes.
3. Clipped highlights remain at or below 2% in every measured scene/mode.
4. A Fabio-reviewed before/after contact sheet preserves the moody dual-temperature character and material identity.
5. Material contract versus live comparable PBR values: 0 mismatches out of 53.
6. All 44 known archetypes compile through their intended exact route.
7. unknown.table, unknown.lantern, primitive.box, and totally.alchemist_shell.fake fail through validateWorld, compile, and compileEntity.
8. Existing passing preset draw counts do not increase; Tokyo, Winterhold, and Fantastic do not exceed 45, 39, and 58 respectively.
9. No new scene exceeds 15,000 triangles.
10. Bridge and artifact tests include Origin-required WebSocket, wrong reply type, traversal, and configured-root confinement.
11. SHA-256 preservation check reports changes only in the P0 allowlist and approved artifacts.
12. node scripts/verify_astra_harness.mjs has zero blocking failures; the only permitted non-blocking findings are the explicitly recorded draw-call overages.
13. python make_board.py followed by python scripts/gate.py passes.

## P1 — Bounded creative authorship and Astra token economy

Recommended executor: Claude Opus 5 in a second fresh session, followed by a new GPT-6 Astra task for black-box usability acceptance. The executor must use the P0 hash baseline and stop if any P0 visual gate regresses.

### P1.1 Extend the canonical entity contract

Add to artisanContract.js:

1. Authored light entity definitions:
   - types: point and spot;
   - roles: key, fill, accent, cavity;
   - Kelvin: 1,800 to 10,000;
   - lux at 1 meter:
     - cavity at most 0.25;
     - accent at most 50;
     - fill at most 120;
     - key at most 250;
   - range: 0.25 to 12 meters;
   - spot angle: 10 to 80 degrees;
   - penumbra: 0 to 1;
   - maximum 4 authored lights per world;
   - no authored shadow casting in v1.
2. Material variant definition:
   - at most 4 variant slots per entity;
   - tint plus tintMix from 0 to 0.35;
   - roughnessOffset from -0.20 to +0.20;
   - absolute emissiveIntensity at most 4.0;
   - non-emissive base materials capped at 0.5 unless their catalog policy explicitly permits more;
   - unknown fields rejected.
3. Archetype parameter schemas:
   - furniture.table: lengthM 1.2 to 2.6, wear 0 to 1;
   - furniture.bookshelf and storage.arcanaeum_bookshelf: shelfCount 2 to 6, bookDensity 0.15 to 1.0, wear 0 to 1;
   - lighting.candle_cluster: candleCount 1 to 7, spreadM bounded by the archetype footprint, wear 0 to 1;
   - unknown parameters rejected per archetype.

Resolved defaults must be canonical and deterministic. Explicit parameters and seed participate in sceneIdentity.

### P1.2 Implement without breaking pooling or budgets

1. MaterialFoundry:
   - keep the 53 base materials pooled and immutable;
   - create a bounded variant cache keyed by base material id plus normalized variant;
   - cap the cache at 128 entries with deterministic eviction or explicit rejection;
   - never mutate the base material.
2. WorldCompiler:
   - pass normalized seed, parameters, variants, and light data to exact builders;
   - construct authored PointLight/SpotLight objects only from validated contract data;
   - convert Kelvin deterministically;
   - preserve entity transforms and relationships.
3. UniversalFoundry:
   - accept a seeded RNG/context instead of fixed or ambient randomness;
   - parameterize table, bookshelf, arcanaeum bookshelf, and candle cluster;
   - merge repeated wax, wick, fastener, and book geometry by material;
   - keep the five tiers visible at minimum settings.
4. LightingRig:
   - combine authored lights with the canonical global profile;
   - enforce the count/role caps at runtime as defense in depth.

### P1.3 Consolidate the MCP and reduce result payloads

1. Replace the advertised mutation surface with add_entities and update_entity.
2. Make add_entities atomic: either every entity validates and commits, or none do.
3. Return compact mutation acknowledgements by default:
   - ok, worldId, version, sceneIdentity, entityCount;
   - changed ids and warning count;
   - no full entity echo unless explicitly requested through get_telemetry.
4. Remove import_telemetry_logs from the default tool list and add saveArtifact to get_engine_telemetry.
5. Strengthen output schemas with required critical fields and an explicit structured error branch.
6. Add compact lazy resources:
   - grouped archetype index;
   - grouped material index;
   - per-archetype parameter/light schema through the existing template;
   - per-material variant policy through the existing template.
7. Shorten the skill and remove the unconditional instruction to load essence and the full catalog.

### P1.4 Repackage and dogfood

1. Bump the private plugin from 2.0.0 to 2.1.0.
2. Update the local marketplace entry and reinstall the private plugin with the normal cachebuster flow.
3. Validate the plugin and skill with the bundled OpenAI validators.
4. Start a genuinely fresh GPT-6 Astra task and issue exactly:

   Use $artisan-3d-studio to build and preview a candle-lit alchemist corner. Use Dusk lighting.

5. Astra must discover the skill and MCP without source reading, use lighting.candle_cluster rather than silently substituting a lantern, stay within budget, and report identity, draws, triangles, FPS, and screenshot path.

### P1 exact file allowlist

- src/contracts/artisanContract.js
- src/engine/MaterialFoundry.js
- src/engine/WorldCompiler.js
- src/engine/UniversalFoundry.js
- src/engine/LightingRig.js
- src/main.js
- mcp-server/index.js
- mcp-server/Validator.js
- mcp-server/WorldSession.js
- mcp-server/knowledge/essence.md
- mcp-server/test_stdio_client.js
- scripts/check_contract_drift.mjs
- scripts/verify_astra_harness.mjs
- scripts/measure_brightness.mjs
- scripts/test_creative_contract.mjs — new
- plugins/artisan-3d-studio/.codex-plugin/plugin.json
- plugins/artisan-3d-studio/skills/artisan-3d-studio/SKILL.md
- plugins/artisan-3d-studio/skills/artisan-3d-studio/agents/openai.yaml
- plugins/artisan-3d-studio/skills/artisan-3d-studio/references/foundry-extension.md
- .agents/plugins/marketplace.json
- HARNESS-SIJ.json
- FINDINGS.json
- PLAN.json
- docs/specs/SPEC-07-VISIBILITY-CREATIVE-CONTRACT.md
- board.html — generated only

The plugin .mcp.json should not change unless the executable path itself changes.

### P1 acceptance gates

1. Advertised tool count: 11.
2. Tool declaration payload: at most approximately 1,800 tokens, leaving at least 10% headroom.
3. Skill entrypoint: at most approximately 450 tokens.
4. Default pre-tool cold-start budget for the exact candle task:
   - tools plus skill plus compact index plus selected templates at most 3,500 approximate tokens;
   - no full catalog or essence read unless justified.
5. One 12-entity add_entities success response: at most 1,200 characters.
6. Every tool has meaningful required success fields and a structured error branch; valid and invalid outputs validate against their schemas.
7. Same manifest, parameters, variants, lights, and seed produce byte-identical manifest, identical sceneIdentity, identical geometry counts, and identical screenshot hash under a fixed audit clock.
8. A changed seed changes allowed narrative clutter/wear while remaining inside the same bounds and budgets.
9. Fifth authored light fails with a specific MAX_AUTHORED_LIGHTS error.
10. Cavity light above 0.25 lux fails; Kelvin, range, angle, and role overages fail at the named field.
11. Base material object identity and properties remain unchanged after variant rendering.
12. Variant cache never exceeds 128 entries.
13. Unknown parameter, variant, material, archetype, or light field fails before rendering.
14. Candle cluster visibly satisfies all five tiers and adds no more than 3 draw calls after material batching.
15. P0 brightness and clipping gates remain green.
16. No passing preset draw count regresses; no new scene exceeds the applicable 30/35 profile.
17. Full verifier, plugin validator, skill validator, spatial laws, S.A.R.T. gate, and board freshness pass.
18. Fresh Astra acceptance reports discovery, approximate retrieval cost, sceneIdentity, draw calls, triangles, FPS, and artifact path.
19. SHA-256 preservation check reports changes only in the P1 allowlist and approved artifacts.

## Risks and controls

| Risk | Control |
|---|---|
| Raising mean brightness flattens the mood | Tune bounce/fill before albedo; enforce clipped cap, percentile metrics, dual-temperature profile checks, and Fabio contact-sheet approval. |
| Background pixels make a mean-luma gate misleading | Gate mean, p50, near-black, and clipping together; use the renderer canvas only. |
| Material variants create one material per entity and raise draws/memory | Immutable pooled bases, normalized variant-key reuse, 4 slots/entity, 128-entry cap, telemetry assertion. |
| Authored lights increase shader/fill cost | Four-light cap, no authored shadows in v1, lux/range caps, performance measurement with lights on. |
| Parametric density explodes geometry | Per-archetype numeric bounds, deterministic feature caps, batching, draw/triangle gates. |
| Tool consolidation breaks old prompts | Plugin 2.1.0, documented mapping, optional ARTISAN_LEGACY_TOOLS=1 for one version, fresh Astra test. |
| Governance becomes green by changing thresholds | Thresholds remain 30/35; overages stay visible findings until a separate performance phase fixes them. |
| Existing dirty work is overwritten | Hash baseline, phase allowlists, stop-on-drift, no commits. |

## Required owner decisions before execution

1. Approve or adjust the proposed visibility thresholds:
   - Dusk: mean at least 58, near-black at most 22%.
   - Hearth: mean at least 38, near-black at most 38%, median at least 30.
   - Sol: mean at least 68, near-black at most 16%.
   - all modes: clipped at most 2%.
2. Approve deferring Tokyo/Winterhold/Fantastic geometry optimization to a separate P2 while recording the overages truthfully now.
3. Approve the 11-tool consolidation and the one-version opt-in legacy surface.
4. Approve the SIJ semantic migration: scene-level measured baselines now; no fabricated overwrite of component-scoped cabinet values.
5. Approve lighting.candle_cluster as part of P1 so the exact candle-lit acceptance prompt is fulfilled literally.

## Stop condition

This plan is complete when P0 and P1 acceptance gates pass, a new GPT-6 Astra task completes the exact candle-lit workflow without source reading, the only remaining declared limitations are explicitly governed findings, and the starting dirty tree is preserved outside the approved allowlists.

Do not begin implementation in the planning session. After Fabio approves the decisions above, run /clear and execute this plan from the target project in fresh sessions, one phase at a time.
