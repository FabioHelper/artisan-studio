# SPEC-06: Governed Cabinet Vault & Parity Engine

## 1. Objective
Deliver a bulletproof, zero-trust promotion workflow for *The Fantastic World* and Three.js runtime development.
Ensure that performance-enhancing candidate modifications can only be promoted to the active project baseline if they pass strict perceptual similarity gates ($\ge 98\%$), scene graph invariance, and frametime budgets.

## 2. Forked Parity Engine (`parity-cab-artisan`)
- Preserve the original `parity-cab` repository at `C:\Users\Fabio D\.claude\skills\parity-cab` 100% untouched.
- Create a clean git fork at `tools/parity-cab-artisan` (and `C:\Users\Fabio D\.claude\skills\parity-cab-artisan`).
- Implement SPEC-16 to add `mode: "html"`, allowing standard Three.js projects to be audited via Stage 06/07/12/13/14/15.

## 3. Smart Intent JSON (SIJ) & Cabinet System
- Partition the project into modular, lockable compartments:
  - `CAB-LIGHTING`: Cathedral & Chandelier Lighting Rig
  - `CAB-MATERIALS`: PBR Architecture & Refractive Glass
  - `CAB-SHADOWS`: Directional Moonlight & Shadow Caching
- Each cabinet defines:
  - `target_file`: file in active working tree
  - `golden_ref`: immutable reference in virgin artifact directory
  - `status`: `LOCKED` (promoted baseline) | `UNLOCKED` (candidate under test)
  - `similarity_min`: 0.98 (98% perceptual visual match)
  - `frametime_max_ms`: 16.6 ms (60 FPS budget)

## 4. Live Visual Vault Deck
- Expose WebSocket event stream over port 3456.
- Render interactive visual HUD in Artisan Studio showing animated lock/unlock state and real-time similarity metrics.
