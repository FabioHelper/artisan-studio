# AGENTS.md — Artisan 3D Studio Instructions & Guidelines

## Core Principles
1. **Zero Primitive Box Reductionism**: Every architectural asset must use hierarchical procedural compounding (mouldings, chamfers, brackets, plinths).
2. **Dual-Temperature Photometrics**: Calibrate key lighting and fill lighting with contrasting Kelvin / chromatic color temperatures.
3. **PBR Material Pooling**: Pool shared materials (e.g. `darkWoodMat`, `stoneRoughMat`, `goldFoilMat`) across procedural generators to minimize GPU context changes.
4. **Performance Budget (per mode)**: Dioramas and MCP-authored worlds: <= 30 draw calls, ~15,000 triangles target. Fantastic World: <= 35 draw calls visible from the active camera. 60 FPS in Balanced/Ultra. Canonical values: `PERFORMANCE_PROFILES` in `src/contracts/artisanContract.js`.
5. **Quality Modes**: Respect the active preset (`ultra`, `balanced`, `perf`, `battery`). Never force continuous shadow re-bakes on static geometry.

## Commands
- Start dev server: `npm run dev`
- Run spatial laws test: `node test_spatial_laws.js`
- Capture scene views: `node capture_angles.js`
- Contract drift check: `node scripts/check_contract_drift.mjs`
- Full harness verification (MCP + bridge + E2E + gates): `node scripts/verify_astra_harness.mjs`

## MCP / Astra harness
- Canonical contract (catalogs, schema, relationships, seeds, budgets): `src/contracts/artisanContract.js`. Edit facts there only.
- MCP server: `mcp-server/index.js` (stdio). The WebSocket on 127.0.0.1:3456 is only the browser-preview bridge.
- Private local Codex plugin: `plugins/artisan-3d-studio/` (marketplace `artisan-local` in `.agents/plugins/marketplace.json`).
- MCP file output is confined to `.artisan-artifacts/` (override `ARTISAN_ARTIFACTS_DIR`).
