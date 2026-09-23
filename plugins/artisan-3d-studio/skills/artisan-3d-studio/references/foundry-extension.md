# Extending the Artisan foundry (new archetypes)

Use only when the catalog genuinely lacks an asset. Scene authoring never needs this.

## Where things live (repo: artisan-studio-app)
- Canonical contract: `src/contracts/artisanContract.js` — add the archetype entry (category, dimensions, anchors, mesoFeatures, description).
- Builder: `src/engine/UniversalFoundry.js` — add a `buildX(group, ...materials)` method.
- Route: `src/engine/WorldCompiler.js` `compileEntity()` — add a `ref.includes('x')` branch *before* broader matches. There is no fallback primitive: unrouted archetypes throw.
- Materials: `src/engine/MaterialFoundry.js` `register()` + the contract's `MATERIAL_CATALOG`.
- Guard: `node scripts/check_contract_drift.mjs` must pass; then `node scripts/verify_astra_harness.mjs`.

## Procedural compounding standards
- **Never a lone primitive.** Merge compound sub-parts; the compiler batches same-material meshes per entity.
- **Skulls / organic forms**: dodecahedron braincase (≈0.96, 0.74, 1.18), brow ridges into recessed orbits, tapered snout with fangs, segmented logarithmic horns with growth rings; weathered ivory (`bone.weathered_ivory`).
- **Fire**: coal bed (cylinder + dodecahedron charcoal), central flame tongue + 3 curved offset petals, bright inner nucleus; never a single cone.
- **Barrel**: double-tapered bilge, recessed chime, bung, 4 forged hoops. **Crate**: corner stiles, planking, X-bracing, iron angle caps. **Chest**: runner skids, domed lid, strapped rivets, hasp and drop handles.
- **Light**: local cavity lights ≤ 0.25 lux with short range; cool fill vs warm key; no uncalibrated point lights touching geometry.
- **Determinism**: no `Math.random()` in builders — use a fixed-seed PRNG.
- **Performance**: reuse pooled materials from `MaterialFoundry`; prefer `InstancedMesh` for repeats; stay within the mode's draw-call profile.
