# SPEC-04: Omegamon Telemetry & MCP Server Bridge Integration

## 1. Objective
Ensure the Omegamon Process & Hierarchy Table inside `ArtisanProfiler.js` operates seamlessly end-to-end, providing accurate resource profiling across all diorama presets and the optimized Fantastic World game runtime. In addition, adapt and configure the MCP Server WebSocket bridge to support port 3456 with bidirectional command dispatch, error resilience, and graceful fallback.

## 2. Omegamon Telemetry Subsystem
- **Inspection Engine**: `scanEntityProcesses()` in `src/engine/ArtisanProfiler.js`.
- **Requirements**:
  1. Detect mode context (`diorama` vs `game`) dynamically.
  2. For Fantastic World:
     - Enumerate subsystems: `EffectComposer & UnrealBloomPass`, `Moonlight & Chandelier Rig`, `WebAudio Ambience & Chimes`.
     - Inspect primary world nodes: `Sky Dome Celestial Moon`, `Great Hall Architecture`, `Hall Props And Furniture`, `Exterior Terrain Pond Stairs`, `Particle Simulation Motes`, `Explorer Avatar Rig`.
     - Calculate exact geometry attributes: draw calls, triangles, vertices, VBO memory in KB, texture memory, and material types.
     - Enforce budget thresholds: Entities under budget are flagged `CLEAN` (green); entities violating budgets are flagged `GUILTY` (red) or `MODERATE` (yellow).
  3. UI Synchronization:
     - Ensure live meters (CPU/GPU frametimes, VRAM Geometry, Texture targets, draw calls) update in real-time.
     - Support process selection and subsystem live toggles (Shadows, Bloom, Wireframe).

## 3. MCP Server & WebSocket Bridge Adaptability
- **Port Flexibility**:
  - The MCP server in `mcp-server/index.js` defaults to port 3456 as specified in the environment (`process.env.MCP_WS_PORT || 3456`).
  - If port 3456 is unavailable, it handles `EADDRINUSE` gracefully without crashing stdio communication.
- **Client Resilience (`src/main.js`)**:
  - `setupMCPBridge()` attempts connection to `ws://localhost:3456`. If connection fails or times out, it falls back to port 9900.
  - Exponential backoff reconnects automatically if the server restarts.
  - Visual status indicator in the top-left UI reflects live connection state (`MCP: CONNECTED` vs `MCP: STANDBY`).
- **Tool Protocol**:
  - All 11 MCP tools (`create_world`, `add_entity`, `move_entity`, `remove_entity`, `replace_material`, `validate_scene`, `compile_preview`, `set_lighting`, `get_telemetry`, `run_performance_audit`, `capture_viewport_screenshot`, `get_engine_telemetry`, `import_telemetry_logs`) remain 100% functional over stdio and WebSocket.
