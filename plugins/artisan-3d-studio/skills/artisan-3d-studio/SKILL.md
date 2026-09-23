---
name: artisan-3d-studio
description: Author studio-grade Three.js worlds with the local Artisan 3D Studio MCP (artisan-3d). Use for 3D scene building, spatial layout, procedural props, lighting moods, draw-call/FPS budgets, previews and screenshots in Artisan Studio, or when extending its procedural foundry. Enforces the non-degradation invariant and the 5-Tier Compounding Law.
---

# Artisan 3D Studio

You edit the WORLD; the deterministic Studio decides how to RENDER it. Author declarative manifests through the `artisan-3d` MCP tools — never hand-write Three.js for scene content, and never reduce a handcrafted prop to a raw box, cylinder or cone.

## Core law (keep in mind, don't restate)
Every asset honours the 5 tiers: **ground contact & plinth → bevelled structural core → articulation & fasteners → asymmetric narrative clutter → calibrated dual-temperature light.** Coordinates are meters, right-handed, +Y up, +X east, +Z south, rotations in degrees.

## Workflow
1. Read `artisan://essence` once per task. Pull only what you need next:
   `artisan://catalog/archetypes`, `artisan://catalog/materials`, `artisan://archetype/{id}` (anchors, dimensions), `artisan://contract` (limits, budgets, relationships, seeds), `artisan://schema/world`.
2. `create_world` → `add_entity`: architecture shell first, then floor-standing pieces, then clutter stacked with `parent` + `anchor`. Pass explicit `seed`s when repeatability matters (omitted seeds are derived deterministically).
3. `validate_scene` until valid with no Law A warnings.
4. `compile_preview` (Studio at http://127.0.0.1:5173 must be open for live preview) → `get_engine_telemetry` → `capture_viewport_screenshot`.
5. Report the `sceneIdentity`, draw calls vs the profile budget, and the screenshot path.

## Rules of engagement
- Errors are structured (`error.code`, `error.issues[].path`). Fix the named field; do not retry blindly.
- Unknown archetypes/materials are rejected by design. If a genuinely new asset is needed, extend the foundry — see [references/foundry-extension.md](references/foundry-extension.md).
- Budgets are per mode (`diorama` vs `fantastic_world`); cite the profile, never a universal number.
- Outputs (screenshots, audits, logs) stay in the local artifacts dir; the preview bridge is loopback-only.
- Governance state lives in `artisan://governance` and `artisan://findings`; read them only for audit/perf work.
