# Artisan 3D Studio — Essence & Authoring Contract

The LLM edits the WORLD; the deterministic Studio decides how to RENDER it.

## Inversion of control
- Author declarative world manifests through the MCP tools. Never write Three.js, vertex buffers or raw geometry.
- Every entity references a catalog archetype (`artisan://catalog/archetypes`). Unknown archetypes are rejected — they never degrade to a box.
- Materials come only from the locked PBR vocabulary (`artisan://catalog/materials`).

## Non-degradation invariant
Never reduce an organic, handcrafted or structural prop to a standalone box, cylinder or cone. Every asset is built by Artisan Procedural Compounding.

## The 5-Tier Compounding Law
1. **Ground contact & plinth** — nothing floats: footpads, stretchers, runner skids, stepped plinths.
2. **Structural core with bevels** — stepped profiles, chamfers, anatomical vaults instead of flat slabs.
3. **Mechanical articulation & fasteners** — tenons, corbels, straps, rivets, hoops, hasps.
4. **Asymmetric narrative clutter** — varied book heights and leans, tableware, tools; perfect symmetry kills immersion.
5. **Calibrated dual-temperature photometrics** — cool fills against warm keys; local cavity lights stay dim (≤ 0.25 lux); ACES exposure within [0.95, 1.10].

## Spatial laws
- **Coordinates**: meters, right-handed, +Y up, +X east, +Z south; origin at floor center; rotations in degrees. Canonical values: `artisan://contract`.
- **Law A (support)**: every non-architecture, non-lighting, non-decor entity declares `relationships: [{type: "supported_by"|"attached_to", target, anchor?}]`. `add_entity` defaults to `supported_by ground.stone`; pass `parent` (+ `anchor`) to stack on another entity.
- **Law B/C (clearance, reachability)**: leave open floor in front of functional pieces (hearths, benches, workstations).
- **Law D (scale)**: grounded proportions — tables ~0.75 m, seats ~0.45 m, ceilings ~2.8 m; scale factors stay within contract limits.
- **Law G (determinism)**: pass a `seed` for repeatable grain; when omitted a stable seed is derived from worldId + entityId, so the same authored request always yields the same scene identity.

## Performance
Budgets are mode-specific (see `performance` in `artisan://contract`): dioramas and MCP-authored worlds follow the `diorama` profile; the walkable Fantastic World follows `fantastic_world` (visible-camera draw calls). Pool materials; never force continuous shadow re-bakes on static geometry.

## Workflow
`create_world` → `add_entity` (architecture shell first, then furniture, then clutter anchored to surfaces) → `validate_scene` → `compile_preview` (live Studio) → `get_engine_telemetry` → `capture_viewport_screenshot`.
