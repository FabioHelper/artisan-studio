# SPEC-05: Verification Suite, Smart Diff & Rollback Safety

## 1. Objective
Establish an uncompromising verification and quality assurance harness for the Artisan 3D Studio application. Enforce quality gates, smart diff comparisons before refactoring and implementations, automated rollback readiness, and end-to-end headless Puppeteer verification testing.

## 2. Smart Diff Comparison Engine (`--diff`)
- **Invocation**: `python scripts/gate.py --diff <baseline_json> <current_json>`
- **Classification Categories**:
  - `APPEARED`: New failure or metric that was not present in the baseline. If not listed in `FINDINGS.json`, flags a critical regression.
  - `RESOLVED`: A previous failure that now passes. If still registered as an expected failure in `FINDINGS.json`, flags a stale disposition.
  - `VALUES MOVED`: Metric moved beyond expected jitter bands (e.g. frametime delta > 3ms, draw calls increased).
  - `JITTER`: Fluctuations within acceptable empirical measurement spread (e.g., ±0.8ms frametime).

## 3. Rollback Safety Mechanism
- **Implementation**: `scripts/rollback.py`
- **Capabilities**:
  - `python scripts/rollback.py --snapshot <tag>`: Creates a self-contained, timestamped archive or git tree reference of the current codebase state.
  - `python scripts/rollback.py --restore <tag>`: Restores code, manifests, and configs safely to the designated snapshot, allowing instant rollback in the event of pipeline failure.
  - `python scripts/rollback.py --list`: Lists all available snapshots.

## 4. End-to-End Puppeteer Test Suite
- **Script**: `scripts/verify_artisan_board_pipeline.js`
- **Assertions**:
  1. Application loads without console errors or shader compilation exceptions.
  2. Diorama Mode: Default Winterhold / Tokyo scenes load, draw calls <= 30, triangles <= 15k, 60 FPS.
  3. Single-Instance Guard: Switching between Diorama and Game modes terminates old loops, releases listeners, and maintains strictly 1 active loop.
  4. Fantastic World Game Mode: Total draw calls remain <= 35 across multiple camera angles (Hero view, Moon Window, Dream Garden vista).
  5. Omegamon Process Table: Inspects and renders all active entities and subsystems with accurate VRAM/draw call metrics.
  6. Subsystem Toggles: Shadows, Bloom, and Wireframe toggles operate live without crashing or dropping frames.
