# Artisan 3D World Compass v2: Universal LLM Authoring Manual

This manual provides the complete contract and knowledge base for an LLM (Gemini, Claude, GPT, Llama, Mistral) to generate AAA artisan-grade 3D assets and environments with zero effort, ultra-low token consumption (~350 tokens per scene), and 100% physical correctness.

---

## 1. The Core Rule: Inversion of Control

> **"The LLM edits the WORLD; the deterministic Studio decides how to RENDER it."**

- **DO NOT** output Three.js / WebGL / OpenGL / Canvas code.
- **DO NOT** calculate manual vertex buffers, normals, or raw geometry indices.
- **ONLY** output a valid declarative `.world.json` manifest specifying semantic entities, positions, archetypes, materials, and relationships.

---

## 2. Coordinate System Constitution

- **Units**: Metric (1 unit = 1.0 meter).
- **Coordinate Law**: Right-handed Cartesian:
  - `+X` = East / Right
  - `+Y` = Up (Elevation)
  - `+Z` = South / Forward
  - `-Z` = North / Backward
- **Rotation**: Authored in degrees `[pitch_x, yaw_y, roll_z]` (converted to radians by the compiler).
- **Room Origin**: Center of the finished floor surface `[0, 0, 0]`.

---

## 3. Universal Archetype Catalog

When authoring `"assetRef"`, select from or combine these supported semantic archetypes:

### A. Architecture
| Archetype Ref | Description | Key Anchors |
| :--- | :--- | :--- |
| `forge.stone_chimney_family` | Stone hearth base with masonry bricks, hooded chimney, and glowing fire bed. | `anchor.fire`, `anchor.flue` |
| `arch.fireplace` | Medieval stone lintel hearth with glowing coals. | `anchor.fire`, `anchor.mantel` |
| `arch.floor` | Instanced dark oak floorboards with plank seams. | `anchor.surface.floor` |
| `arch.wall` | Plaster wall with vertical exposed dark oak timber posts. | `anchor.wall.mount` |

### B. Furniture & Seating
| Archetype Ref | Description | Dimensions (X, Y, Z) |
| :--- | :--- | :--- |
| `furniture.table` | Heavy oak dining or work table with 4 legs, stretcher, and optional tableware. | `2.1m × 0.78m × 0.95m` |
| `furniture.desk` | Compact study/writing desk for libraries or alchemists. | `1.4m × 0.75m × 0.75m` |
| `furniture.bench` | Sturdy timber bench with optional woven fabric cushion. | `1.6m × 0.45m × 0.32m` |
| `furniture.bookshelf` | Tall 4-shelf oak bookcase populated with procedural grimoires. | `1.2m × 2.2m × 0.38m` |

### C. Workshop & Crafting
| Archetype Ref | Description | Meso Craft Features |
| :--- | :--- | :--- |
| `anvil.forged_iron_01` | Blacksmith anvil (horn, heel, hardy face) mounted on timber stump with iron hoop. | Riveted iron band, polished face |
| `bellows.leather_iron_01` | Workshop forge bellows with oak rocker lever, leather bladder, and iron nozzle. | Skid trestle, pivot pin |
| `workshop.weapon_rack` | Timber A-frame rack holding forged iron swords and battleaxes. | Crossguard pegs, notched frame |
| `kitchen.cauldron` | Heavy iron cauldron on a tripod stand with bubbling glowing brew. | Tripod rim, heat embers |

### D. Storage & Containers
| Archetype Ref | Description | Meso Craft Features |
| :--- | :--- | :--- |
| `storage.chest` | Heavy wooden chest with reinforced forged iron corner straps and latch. | Iron strapping, lock latch |
| `storage.barrel` | Weathered oak stave barrel with forged iron compression hoops. | Dual iron hoops, wooden bung |
| `storage.crate` | Slat-constructed cargo crate with diagonal corner braces. | Chamfered slats, iron braces |

### E. Lighting & Decor
| Archetype Ref | Description | Key Properties |
| :--- | :--- | :--- |
| `lighting.lantern` | Forged iron cage lantern with warm emissive ember core. | Point light emission |
| `decor.woven_rug` | Geometric patterned woven rug (sunburst or tribal motif). | Surface-snapped |
| `painting.sun_mountain_01` | Framed parchment painting with mountain sigil and oak frame. | Wall-attached |

---

## 4. Locked PBR Material Foundry

Use **ONLY** the canonical material vocabulary to ensure 0% stylistic drift:

| Category | Material Identifier | Visual Character |
| :--- | :--- | :--- |
| **Timber** | `wood.dark_oak` | Heavy dark brown timber, matte roughness 0.85 |
| | `wood.weathered_oak` | Desaturated grey-brown aged oak, roughness 0.90 |
| | `wood.floor_oak` | Rich warm polished floor planking, roughness 0.80 |
| **Masonry** | `plaster.lime_warm` | Cream lime plaster wall finish, roughness 0.95 |
| | `stone.rough_local` | Hewn grey mountain stone, roughness 0.92 |
| | `stone.hearth` | Heat-darkened hearth masonry, roughness 0.88 |
| **Metals** | `metal.forged_iron` | Dark hammered blacksmith iron, metalness 0.88 |
| | `metal.polished_iron` | Polished working edge/anvil face, metalness 0.92 |
| **Textiles/Leather**| `leather.worn` | Soft brown weathered leather, roughness 0.82 |
| | `cloth.woven_cushion` | Rust/terracotta woven fabric, roughness 0.95 |
| | `cloth.woven_rug` | Geometric dyed wool rug |
| | `cloth.painted_panel` | Illustrated parchment canvas |
| **Emissive** | `ember` | Hot orange glowing heat (2000K, emissive intensity 2.4) |
| **Ceramic** | `ceramic.dish` | Earthenware tableware glaze, roughness 0.65 |

---

## 5. Spatial Laws (A–G)

1. **Law A (Support)**: Every prop must declare `"relationships": [{"type": "supported_by", "target": "<parent_id_or_ground>"}]`. Props never float!
2. **Law B (Clearance)**: Functional entities (chairs, doors, forges) require unobstructed space in front of them.
3. **Law C (Reachability)**: Interactive points must face open floor space.
4. **Law D (Scale)**: Keep proportions grounded (tables 0.75m, chairs 0.45m, ceilings 2.8m, barrels 0.85m).
5. **Law G (Determinism)**: Supply a numeric `"seed"` (e.g. `137`) to guarantee repeatable procedural grain and offsets.

---

## 6. Standard Manifest JSON Schema Template

```json
{
  "worldId": "unique_scene_name_v1",
  "version": 1,
  "units": "meter",
  "axis": { "handedness": "right", "up": "+Y", "east": "+X", "south": "+Z" },
  "entities": [
    {
      "id": "prop.my_asset.001",
      "kind": "prop",
      "transform": {
        "positionM": [0.0, 0.0, 0.0],
        "rotationDeg": [0.0, 0.0, 0.0],
        "scale": [1.0, 1.0, 1.0]
      },
      "assetRef": "anvil.forged_iron_01",
      "materialRefs": ["metal.forged_iron", "wood.dark_oak"],
      "seed": 137,
      "relationships": [
        { "type": "supported_by", "target": "ground.stone" }
      ]
    }
  ]
}
```
