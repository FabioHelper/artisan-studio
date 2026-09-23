# SPEC-16 Demo-Three Generic Fixture

This fixture proves that `parity-cab` runtime gates operate seamlessly on any ordinary Three.js project without requiring Babel transpilation, React, MatPool, ArcaneAudio, or the event bus.

## Architecture
- **Side A (`a/index.html`)**: Pristine baseline Three.js application exposing `window.__viewport = { scene, renderer, camera }`.
- **Side B (`b/index.html`)**: Mutated Three.js application with exactly three planted regressions.

## Planted Divergences & Catching Stages

| # | Planted Divergence in Side B | Catching Stage | Verification Mechanism |
|---|-----------------------------|----------------|------------------------|
| 1 | **Geometry Mutation**: `geo1` changed from `BoxGeometry(1, 1, 1)` to `CylinderGeometry(0.5, 0.5, 1, 16)` | **Stage 13** (`13-scenegraph-hash.cjs`) | FNV double-lane hash of quantized vertex buffer attributes detects structural shape delta. |
| 2 | **Material Parameter Mutation**: `mat2` roughness changed from `0.3` to `0.8` | **Stage 14** (`14-materials-deep.cjs`) | Deep material census compares PBR properties (`roughness`, `metalness`, `color`). |
| 3 | **Time-Varying Animation Mutation**: `pointLight.intensity` sine wave flicker removed (held constant at 2.0) | **Stage 15** (`15-anim-series.cjs`) | Fixed-Δt tick stream detects lack of frame-by-frame scalar/transform variance. |

## Harness Generation
Generate harnesses with:
```bash
node scripts/06-behavior-trace.cjs --config examples/demo-three/parity.config.json --dry-run
```
Output is written to `examples/demo-three/.parity/`.
