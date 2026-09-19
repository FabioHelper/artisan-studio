# Artisan 3D Studio

Deterministic World Compass v2 3D Generation Studio for LLMs and Three.js spatial engineering.

## Overview
Artisan 3D Studio is an interactive, browser-based WebGL procedural environment engine featuring 7 hyper-detailed scenes built on Three.js:
- **Tavern of the Moon** — Isometric fantasy interior with hearth and bar counter.
- **Dwarven Forge** — Volcanic anvil, glowing slag runnels, and heavy stonework.
- **Royal Armory** — Halberd stands, ceremonial plate armor, and gilded sconces.
- **Alchemist Scriptorium** — Distillation alembics, glowing reagents, and botanical shelves.
- **Great Grand Library** — Soaring walnut bookcases, rolling ladders, and celestial astrolabes.
- **Neo-Tokyo Cyber Alley** — Neon rain, wet asphalt reflections, and holographic signs.
- **Winterhold Citadel** — Glacial battlements, frosted pine trees, and blizzard atmospheric particles.

## Architecture & Features
- **Deterministic Procedural Compounding**: Tier 1 to Tier 5 architectural compounding (no primitive box reductionism).
- **Dual-Temperature Photometrics**: Calibrated warm key / cool fill lighting.
- **Unified PBR Material Pooling**: Reusable physically-based materials with roughness and metalness maps.
- **Adaptive Quality Matrix**: 4 presets (Ultra, Balanced, Performance, Battery-Saver) with dynamic pixel ratios and shadow rebake gating.
- **Integrated MCP Bridge**: Automated screenshot capture, scene switching, camera framing, and real-time performance telemetry.

## Quick Start
```bash
npm install
npm run dev
```
Runs at `http://localhost:5173`.

## Verification & Tests
```bash
node test_spatial_laws.js
node capture_angles.js
```

## Roadmap & Next Steps
- [ ] Multi-pass volumetric god rays
- [ ] Post-processing bloom compositor integration
- [ ] GLTF export serialization
