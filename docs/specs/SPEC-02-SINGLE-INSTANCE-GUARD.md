# SPEC-02: Single-Instance Execution Guard & Context Teardown

## 1. Objective
Enforce absolute mutual exclusion across all visual scenes and game loops in Artisan 3D Studio. At any given moment, strictly at most one rendering loop, scene graph, and event processing subsystem may be active. Toggling between Diorama Mode and Game Mode (The Fantastic World) must release 100% of WebGL contexts, cancel all animation frames, tear down event listeners, silence WebAudio contexts, and reset collision and animation pools.

## 2. Identified Hazards & Leaks in Existing Code
1. **Dangling Event Listeners**: `setupControls()` in `src/game/fantastic-world/player/controls.js` bound `keydown`, `keyup`, `mousemove`, `mousedown`, `mouseup`, `pointerlockchange`, and touch events to `window` and `document` without storing references or providing a teardown mechanism. Returning to Diorama Mode left active listeners responding to keypresses and mouse drags.
2. **WebAudio Thread Leak**: `startAmbience()` in `src/game/fantastic-world/audio/ambience.js` created an `AudioContext` with continuous oscillators, LFOs, and noise generators. No teardown function existed; the audio context kept running indefinitely in the background even after returning to diorama mode.
3. **Double Boot / Frame Race Conditions**: Rapid switching between modes created concurrent `requestAnimationFrame` loops fighting for the WebGL canvas, creating GPU thrash and unstable frametimes.
4. **Accumulating Engine State**: `ctx.colliders`, `ctx.walls`, `ctx.animations`, `ctx.candleLights`, and `ctx.interactables` were never cleared in `teardownFantasticWorld()`. Every re-boot appended duplicate colliders and animation functions.

## 3. Architectural Design

### 3.1 SingleInstanceGuard Subsystem (`src/engine/SingleInstanceGuard.js`)
- **State Machine**: `IDLE` -> `DIORAMA_STARTING` -> `DIORAMA_RUNNING` -> `GAME_STARTING` -> `GAME_RUNNING` -> `TEARING_DOWN`.
- **Atomic Transition Lock**: `acquire(mode, startCallback, teardownCallback)`:
  - If a mode is already active, `teardownCallback` of the active mode is awaited synchronously/asynchronously.
  - Generates a unique monotonic run token (`runId`). If a cancellation occurs mid-transition, stale boot callbacks abort before touching the DOM or WebGL context.
  - Sets global telemetry `window.__singleInstanceGuard`.

### 3.2 Full Teardown Contracts
- **`teardownControls()`**:
  - Remove all bound listeners on `window`, `document`, and `canvas`.
  - Clear pressed key sets (`keys.clear()`), reset drag variables, exit pointer lock.
- **`stopAmbience()`**:
  - Linear ramp master gain to 0 over 100ms.
  - Disconnect and stop all active oscillators and noise nodes.
  - Close or suspend `AudioContext` and set references to `null`.
  - Set `ctx.audioReady = false`.
- **`teardownBridge()`**:
  - Cancel active poll timers and status reversion timeouts.
  - Detach global hotkey listeners.
- **`resetCtx()`**:
  - Empty arrays: `colliders`, `walls`, `animations`, `candleLights`, `interactables`.
  - Reset velocity, moveInput, reading, bridging, and focus.
- **Scene Graph Disposal**:
  - Recursively traverse `ctx.scene`, disposing geometries, textures, and materials.
  - Cancel `animFrameId`.

## 4. Verification & Invariants
- `window.__fantasticWorldActive` is `false` when in Diorama Mode.
- Total active `requestAnimationFrame` handlers is exactly 1.
- Number of active AudioContexts is 0 when in Diorama Mode.
- No memory growth after 10 consecutive toggles between Diorama and Game modes.
