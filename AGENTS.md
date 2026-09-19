# AGENTS.md — Artisan 3D Studio Instructions & Guidelines

## Core Principles
1. **Zero Primitive Box Reductionism**: Every architectural asset must use hierarchical procedural compounding (mouldings, chamfers, brackets, plinths).
2. **Dual-Temperature Photometrics**: Calibrate key lighting and fill lighting with contrasting Kelvin / chromatic color temperatures.
3. **PBR Material Pooling**: Pool shared materials (e.g. `darkWoodMat`, `stoneRoughMat`, `goldFoilMat`) across procedural generators to minimize GPU context changes.
4. **Performance Budget**: Target <= 30 draw calls and <= 15,000 triangles per scene, guaranteeing 60 FPS in Balanced/Ultra mode.
5. **Quality Modes**: Respect the active preset (`ultra`, `balanced`, `perf`, `battery`). Never force continuous shadow re-bakes on static geometry.

## Commands
- Start dev server: `npm run dev`
- Run spatial laws test: `node test_spatial_laws.js`
- Capture scene views: `node capture_angles.js`
