# SPEC-03: Fantastic World Geometry Compounding & Draw Call Collapse (<= 35 Calls)

## 1. Objective
Optimize "The Fantastic World" runtime inside `artisan-studio-app/src/game/fantastic-world/` to collapse total forward draw calls from 310+ draws down to **<= 35 draws** while preserving 100% of artistic aesthetics, textures, material properties, and vertex topology. The reference repository (`workspace/artifact-system/artifacts/fantastic-world`) remains untouched.

## 2. Baseline Draw Call Audit & Problem Statement
Prior empirical profiling revealed:
- **Great Hall Architecture**: 129 draw calls.
  - 100 individual meshes for bookshelf vertical posts and horizontal boards.
  - 5 individual ceiling beam meshes.
  - 4 separate wall geometries for plaster partitions.
  - 3 separate wainscot panels.
  - 3 separate seat cushion boxes.
  - Multiple individual meshes for reading nook furniture (bedframe, mattress, quilt, fold, nightstand).
- **Hall Props & Furniture**: 105 draw calls.
  - 17 candles distributed across desk, chandelier, and sconces, each with independent stick and flame meshes (34 draw calls).
  - 11 individual meshes for rolling ladder (2 rails + 9 rungs).
  - 18 individual meshes for chandelier ring, chain, and candles.
  - 9 individual meshes for clocks over the north arch.
  - 24 individual meshes for terrarium (stand, glass, posts, stems, blooms, butterflies).
- **Exterior Terrain, Pines & Portal**: 56 draw calls.
  - 16 individual cylinder meshes for the stone garden path.
  - 9 individual box meshes for the Luminous Stairs.
  - 8 individual box meshes for portal runes.
  - 12 individual meshes across 4 lantern posts (poles, cages, lights).
  - 5 individual meshes for hall facade segments and roof.

## 3. Geometric Compounding Strategy
All batching uses Three.js `BufferGeometryUtils.mergeGeometries` and `InstancedMesh`. Vertex positions, normals, and UVs are preserved exactly through local transformation matrices prior to merging.

### 3.1 Great Hall Architecture (`src/game/fantastic-world/world/hall.js`)
1. **Bookshelf Structural Frames**:
   - Merge all 16 vertical posts and 84 horizontal shelf boards (all sharing `frameMat`) into a single batched `BufferGeometry`.
   - Result: 100 draw calls -> **1 draw call**.
2. **Ceiling Beams**:
   - Merge the 5 timber ceiling beams (sharing `darkWoodMat`) into a single `BufferGeometry`.
   - Result: 5 draw calls -> **1 draw call**.
3. **Plaster Wainscot & Walls**:
   - Merge the 4 plaster wall segments (south, north, east, west) into a single batched geometry with `plasterMat`.
   - Merge the 3 wainscot pieces into 1 geometry with `trimMat`.
   - Result: 7 draw calls -> **2 draw calls**.
4. **Moon Window Rings & Cushions**:
   - Merge outer and inner brass rings into 1 geometry with `brassMat`.
   - Merge the 3 burgundy velvet cushions into 1 geometry with `cushionMat`.
   - Result: 5 draw calls -> **2 draw calls**.
5. **Reading Nook Bed & Furniture**:
   - Merge bedframe and nightstand (`nookFrameMat`) into 1 geometry.
   - Merge quilt and quilt fold (`quiltMat`) into 1 geometry.
   - Result: 5 draw calls -> **2 draw calls**.
6. **Total Great Hall Architecture**: **<= 14 draw calls**.

### 3.2 Hall Props & Furniture (`src/game/fantastic-world/world/props.js`)
1. **Global Candle Instancing**:
   - Transform all 17 candle sticks (desk, chandelier, sconces) into a single `InstancedMesh` with `page` material.
   - Transform all 17 candle flames into a single `InstancedMesh` with `flameMat`. Dynamic flicker is batched via instance matrices or uniform scale.
   - Result: 34 draw calls -> **2 draw calls**.
2. **Rolling Ladder & Chandelier**:
   - Merge 2 ladder rails into 1 geometry; merge 9 rungs into 1 geometry.
   - Merge chandelier brass ring and suspension chain into 1 geometry.
   - Result: 29 draw calls -> **3 draw calls**.
3. **Arch Clocks & Pastel Rainbow**:
   - Merge 3 brass clock rims into 1 geometry; merge 2 non-window faces into 1 geometry.
   - Merge the 7 rainbow arcs with vertex colors into a single `BufferGeometry` using `MeshStandardMaterial({ vertexColors: true })`.
   - Result: 16 draw calls -> **6 draw calls**.
4. **Terrarium**:
   - Merge 4 brass corner posts into 1 geometry.
   - Merge 6 flower stems into 1 geometry; batch 6 blooms into 1 geometry.
   - Result: 24 draw calls -> **6 draw calls**.
5. **Total Hall Props & Furniture**: **<= 18 draw calls**.

### 3.3 Exterior Terrain & Props (`src/game/fantastic-world/world/exterior.js`)
1. **Stone Path**:
   - Merge the 16 stone path stepping stones into a single batched `BufferGeometry` with `stoneMat`.
   - Result: 16 draw calls -> **1 draw call**.
2. **Luminous Stairs & Portal Runes**:
   - Merge 9 stair step boxes into 1 geometry with `stepMat`.
   - Merge 8 brass portal runes into 1 geometry with `runeMat`.
   - Result: 17 draw calls -> **2 draw calls**.
3. **Lantern Posts & Exterior Facade**:
   - Merge 4 lantern poles into 1 geometry; merge 4 lantern cages into 1 geometry; merge 4 glow spheres into 1 geometry.
   - Merge 2 side facade walls and lintel into 1 geometry with `facadeMat`.
   - Result: 17 draw calls -> **4 draw calls**.
4. **Total Exterior**: **<= 15 draw calls**.

## 4. Overall Budget & Telemetry Verification
With frustum culling active during standard first-person and third-person exploration, total active scene draw calls will remain strictly **<= 35 draws** across the entire camera trajectory, achieving a rock-solid 60 FPS.
