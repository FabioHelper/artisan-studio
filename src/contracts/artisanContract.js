// ==========================================================================
// ARTISAN WORLD COMPASS — CANONICAL CONTRACT (single source of truth)
// Consumed by: MCP server (mcp-server/), browser SpatialValidator/WorldCompiler,
// the Astra skill (via MCP resources), and scripts/check_contract_drift.mjs.
// Pure ESM, no three.js import, so Node and the browser can both load it.
// ==========================================================================

export const CONTRACT_VERSION = '2.0.0';
// P0.6 identity is additive: authored manifests and their compact sha256 identities remain unchanged.
export const SCENE_IDENTITY_SCHEMA_VERSION = 1;
export const SCENE_IDENTITY_KINDS = ['walkable-world', 'zone', 'diorama-adaptation', 'authored-world'];

export const COORDINATE_SYSTEM = {
  units: 'meter',
  handedness: 'right',
  up: '+Y',
  east: '+X',
  south: '+Z',
  rotationUnit: 'degrees',
  rotationOrder: '[pitchX, yawY, rollZ]',
  origin: 'center of finished floor surface [0,0,0]',
  note: 'Authored in degrees. Compiler converts to radians.'
};

export const AXIS = { handedness: 'right', up: '+Y', east: '+X', south: '+Z' };

// Relationships are ALWAYS an array of records: [{ type, target, anchor? }].
export const RELATIONSHIP_TYPES = ['supported_by', 'attached_to', 'adjacent_to'];
export const SUPPORT_RELATIONSHIPS = ['supported_by', 'attached_to'];
export const GROUND_TARGET_PATTERN = '^ground(\\.[a-z0-9_]+)*$';
export const DEFAULT_GROUND_TARGET = 'ground.stone';

export const LIGHTING_PRESETS = ['dusk', 'hearth', 'day'];
export const ENTITY_KINDS = ['architecture', 'furniture', 'workshop', 'storage', 'lighting', 'decor', 'prop', 'room', 'actor'];
// Categories that are self-supporting (no Law A relationship required).
export const SELF_SUPPORTING_CATEGORIES = ['architecture', 'lighting', 'decor'];

export const LIMITS = {
  idPattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$',
  maxEntities: 200,
  maxMaterialRefs: 8,
  positionMinM: [-50, -1, -50],
  positionMaxM: [50, 20, 50],
  rotationAbsMaxDeg: 360,
  scaleMin: 0.1,
  scaleMax: 10,
  roomSizeMinM: 1,
  roomSizeMaxM: 100,
  seedMax: 2147483646,
  floatWarnY: 4.0,
  buriedWarnY: -0.5
};

// Mode-specific performance budgets. There is no universal budget: each render
// mode is governed by its own profile.
export const PERFORMANCE_PROFILES = {
  mtx_preview: {
    description: 'MTX Hardline authoring preview; runtime frame budgets are verified in Godot.',
    drawCallsMax: 30,
    trianglesTarget: 15000,
    targetFps: 60
  },
  diorama: {
    description: 'Declarative World Compass dioramas (the 7 preset scenes and MCP-authored worlds).',
    drawCallsMax: 30,
    trianglesTarget: 15000,
    targetFps: 60
  },
  fantastic_world: {
    description: 'Walkable Fantastic World runtime; budget applies to draw calls visible from the active camera.',
    visibleDrawCallsMax: 35,
    trianglesTarget: null,
    targetFps: 60
  }
};

// Readability gates per lighting preset (SPEC-07), measured by scripts/measure_brightness.mjs on the
// renderer canvas at 1280x720 with Rec.709 luma. 'day' is the preset the UI labels "Sol".
export const VISIBILITY_THRESHOLDS = {
  dusk: { meanYMin: 58, medianYMin: 42, nearBlackPctMax: 22, clippedPctMax: 2 },
  hearth: { meanYMin: 38, medianYMin: 30, nearBlackPctMax: 38, clippedPctMax: 2 },
  day: { meanYMin: 68, medianYMin: 52, nearBlackPctMax: 16, clippedPctMax: 2 }
};
// Every diorama must visibly respond to every preset change.
export const MODE_RESPONSE = { meanSpreadMin: 12, solOverHearthMin: 10, changedFieldsMin: 2, pairRmsMin: 3 };

// Tone-mapping exposure bound from the essence (never flat, never blown out).
export const EXPOSURE_RANGE = [0.95, 1.10];

// Canonical scene-family x preset lighting matrix consumed by LightingRig (and main.js for exposure).
// Dual-temperature rule: warm key/local against a cool fill in every profile; no flat white ambient.
// `local` is the scene's practical light (hearth, witchlight, desk lamp); flicker: none | fire | arcane.
// The `fantastic` family freezes the pre-SPEC-07 medieval values so the walkable hall is out of scope.
export const LIGHTING_FAMILIES = ['medieval', 'tokyo', 'winterhold', 'fantastic'];
export const LIGHTING_PROFILES = {
  medieval: {
    dusk: {
      background: '#1b1e25', exposure: 1.08,
      hemi: { sky: '#a8bccf', ground: '#4a3a2c', intensity: 1.25 },
      key: { color: '#ffeed6', intensity: 1.90, position: [3.2, 5.8, 4.0] },
      fill: { color: '#5a7394', intensity: 1.00, position: [-4.5, 4.5, 3.0] },
      local: { color: '#ff6e1a', intensity: 18.0, distance: 10.0, decay: 1.4, flicker: 'fire' }
    },
    hearth: {
      background: '#1e2128', exposure: 1.10,
      hemi: { sky: '#6e7890', ground: '#6a4428', intensity: 1.80 },
      key: { color: '#4a6282', intensity: 0.90, position: [3.2, 5.8, 4.0] },
      fill: { color: '#34465e', intensity: 1.00, position: [-4.5, 4.5, 3.0] },
      local: { color: '#ff5a0a', intensity: 30.0, distance: 14.0, decay: 1.2, flicker: 'fire' }
    },
    day: {
      background: '#262c36', exposure: 1.08,
      hemi: { sky: '#dce6f2', ground: '#6e6052', intensity: 1.70 },
      key: { color: '#fff7e8', intensity: 2.30, position: [3.2, 5.8, 4.0] },
      fill: { color: '#8fa8c8', intensity: 1.00, position: [-4.5, 4.5, 3.0] },
      local: { color: '#ff6e1a', intensity: 8.0, distance: 10.0, decay: 1.4, flicker: 'fire' }
    }
  },
  tokyo: {
    dusk: {
      background: '#12151b', exposure: 1.02,
      hemi: { sky: '#607a9e', ground: '#28221c', intensity: 0.42 },
      key: { color: '#fff6ec', intensity: 1.70, position: [3.2, 5.8, 4.0] },
      fill: { color: '#3e5476', intensity: 0.44, position: [-4.2, 3.8, -2.2] },
      local: { color: '#ffb060', intensity: 0, distance: 4.0, decay: 1.6, flicker: 'none' }
    },
    hearth: {
      background: '#0e1116', exposure: 1.00,
      hemi: { sky: '#4a5f80', ground: '#2a2018', intensity: 0.30 },
      key: { color: '#ffd9a8', intensity: 1.20, position: [3.2, 5.8, 4.0] },
      fill: { color: '#2c3a52', intensity: 0.30, position: [-4.2, 3.8, -2.2] },
      local: { color: '#ffb060', intensity: 6.0, distance: 4.0, decay: 1.6, flicker: 'none' }
    },
    day: {
      background: '#1c222c', exposure: 1.04,
      hemi: { sky: '#c8d8ec', ground: '#5a4c3c', intensity: 0.80 },
      key: { color: '#fffaf2', intensity: 2.20, position: [3.2, 5.8, 4.0] },
      fill: { color: '#9ab4d4', intensity: 0.70, position: [-4.2, 3.8, -2.2] },
      local: { color: '#ffb060', intensity: 0, distance: 4.0, decay: 1.6, flicker: 'none' }
    }
  },
  winterhold: {
    dusk: {
      background: '#10151d', exposure: 1.10,
      hemi: { sky: '#7397c4', ground: '#2a3444', intensity: 2.30 },
      key: { color: '#f0dcc0', intensity: 3.20, position: [3.4, 6.5, 4.6] },
      fill: { color: '#4a6488', intensity: 1.80, position: [-4.2, 4.0, 3.2] },
      local: { color: '#0ea5e9', intensity: 14.0, distance: 10.0, decay: 1.2, flicker: 'arcane' }
    },
    hearth: {
      background: '#121821', exposure: 1.08,
      hemi: { sky: '#5a7aa4', ground: '#1e2836', intensity: 1.00 },
      key: { color: '#d8b890', intensity: 0.80, position: [3.4, 6.5, 4.6] },
      fill: { color: '#334760', intensity: 0.65, position: [-4.2, 4.0, 3.2] },
      local: { color: '#0ea5e9', intensity: 24.0, distance: 11.0, decay: 1.1, flicker: 'arcane' }
    },
    day: {
      background: '#1a2230', exposure: 1.10,
      hemi: { sky: '#b4cbe6', ground: '#3a4452', intensity: 2.70 },
      key: { color: '#fff4e6', intensity: 3.50, position: [3.4, 6.5, 4.6] },
      fill: { color: '#7c98bc', intensity: 1.70, position: [-4.2, 4.0, 3.2] },
      local: { color: '#0ea5e9', intensity: 6.0, distance: 9.0, decay: 1.2, flicker: 'arcane' }
    }
  },
  fantastic: {
    dusk: {
      background: '#161920', exposure: 1.02,
      hemi: { sky: '#a8bccf', ground: '#382d24', intensity: 0.50 },
      key: { color: '#ffeed6', intensity: 1.55, position: [3.2, 5.8, 4.0] },
      fill: { color: '#4e6580', intensity: 0.45, position: [-4.2, 3.8, -2.2] },
      local: { color: '#ff6e1a', intensity: 15.0, distance: 10.0, decay: 1.4, flicker: 'fire' }
    },
    hearth: {
      background: '#0f1216', exposure: 1.02,
      hemi: { sky: '#7a8b9e', ground: '#2d1f14', intensity: 0.40 },
      key: { color: '#4a6282', intensity: 0.65, position: [3.2, 5.8, 4.0] },
      fill: { color: '#283648', intensity: 0.30, position: [-4.2, 3.8, -2.2] },
      local: { color: '#ff5500', intensity: 20.0, distance: 10.0, decay: 1.4, flicker: 'fire' }
    },
    day: {
      background: '#1e232b', exposure: 1.02,
      hemi: { sky: '#ffffff', ground: '#6e6052', intensity: 0.95 },
      key: { color: '#fff7e8', intensity: 1.95, position: [3.2, 5.8, 4.0] },
      fill: { color: '#8fa8c8', intensity: 0.65, position: [-4.2, 3.8, -2.2] },
      local: { color: '#ff6e1a', intensity: 8.0, distance: 10.0, decay: 1.4, flicker: 'fire' }
    }
  }
};

// Preset scenes accepted by main.js loadScene(); `profile` selects the performance budget,
// `lightingFamily` selects the LIGHTING_PROFILES row.
export const PRESET_SCENES = {
  trio: { profile: 'diorama', lightingFamily: 'medieval', title: 'Blacksmith Forge Trio' },
  tavern: { profile: 'diorama', lightingFamily: 'medieval', title: 'Medieval Tavern' },
  alchemist: { profile: 'diorama', lightingFamily: 'medieval', title: 'Alchemist Laboratory' },
  armory: { profile: 'diorama', lightingFamily: 'medieval', title: 'Dungeon Armory' },
  library: { profile: 'diorama', lightingFamily: 'medieval', title: 'Hermit Library' },
  tokyo: { profile: 'diorama', lightingFamily: 'tokyo', title: 'Tokyo Nintendo Office' },
  winterhold: { profile: 'diorama', lightingFamily: 'winterhold', title: 'College of Winterhold' },
  fantastic: { profile: 'fantastic_world', lightingFamily: 'fantastic', title: 'Fantastic World (walkable hall + garden)' }
};

// Authored (MCP) worlds: the shell archetype selects the lighting family; anything else is medieval.
export const AUTHORED_LIGHTING_FAMILY_BY_ARCHETYPE = {
  'arch.tokyo_apartment_shell': 'tokyo',
  'arch.tokyo_walls': 'tokyo',
  'arch.winterhold_shell': 'winterhold'
};
// Where an authored world's practical (local) light sits, relative to the first matching entity origin.
export const LOCAL_LIGHT_ANCHORS = {
  'forge.stone_chimney_family': [0, 0.6, 0.3],
  'arch.fireplace': [0, 0.5, 0.3],
  'arch.hearth': [0, 0.5, 0.3],
  'hearth.stone_family': [0, 0.5, 0.3],
  'lighting.winterhold_brazier': [0, 1.05, 0],
  'lighting.lantern': [0, 0.2, 0],
  'kitchen.cauldron': [0, 0.5, 0]
};

/** Resolves a preset scene id or a family id to a lighting family (unknown → medieval). */
export function sceneLightingFamily(sceneOrFamily) {
  if (LIGHTING_FAMILIES.includes(sceneOrFamily)) return sceneOrFamily;
  return PRESET_SCENES[sceneOrFamily]?.lightingFamily || 'medieval';
}

/** Canonical profile for a family/preset pair (unknown preset → dusk). */
export function resolveLightingProfile(family, preset) {
  const row = LIGHTING_PROFILES[sceneLightingFamily(family)];
  return row[preset] || row.dusk;
}

/** Lighting family and local-light position for an authored world manifest. */
export function authoredLighting(manifest) {
  const entities = Array.isArray(manifest?.entities) ? manifest.entities : [];
  let family = 'medieval';
  for (const e of entities) if (AUTHORED_LIGHTING_FAMILY_BY_ARCHETYPE[e.assetRef]) { family = AUTHORED_LIGHTING_FAMILY_BY_ARCHETYPE[e.assetRef]; break; }
  let localPosition = null;
  for (const e of entities) {
    const off = LOCAL_LIGHT_ANCHORS[e.assetRef];
    if (!off) continue;
    const p = e.transform?.positionM || [0, 0, 0];
    localPosition = [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
    break;
  }
  return { family, localPosition };
}

// Camera presets accepted by main.js setCameraAngle().
export const CAMERA_ANGLES = ['hero', 'enchanter', 'shelf', 'aurora'];

export const MATERIAL_CATALOG = {
  'mtx.neutral.stone': { color: '#676E73', roughness: 0.88, metalness: 0.04, description: 'MTX semantic neutral stone; preview swatch only' },
  'mtx.neutral.black_lacquer': { color: '#15191D', roughness: 0.25, metalness: 0.35, description: 'MTX semantic black lacquer; preview swatch only' },
  'mtx.metal.brushed_dark': { color: '#303A40', roughness: 0.48, metalness: 0.75, description: 'MTX semantic brushed dark metal; preview swatch only' },
  'mtx.glass.cyan': { color: '#42C8D5', roughness: 0.12, metalness: 0.10, description: 'MTX semantic cyan glass; preview swatch only' },
  'mtx.signal.green_code': { color: '#52D890', roughness: 0.55, metalness: 0.0, emissive: '#168F50', emissiveIntensity: 0.8, description: 'MTX semantic green code signal; preview swatch only' },
  'mtx.signal.red_alarm': { color: '#D94A4A', roughness: 0.55, metalness: 0.0, emissive: '#A52424', emissiveIntensity: 0.8, description: 'MTX semantic red alarm; preview swatch only' },
  'mtx.real.amber': { color: '#D7A14C', roughness: 0.72, metalness: 0.0, description: 'MTX semantic human refuge amber; preview swatch only' },
  'mtx.construct.white': { color: '#E8ECEB', roughness: 0.82, metalness: 0.0, description: 'MTX semantic Construct white; preview swatch only' },
  'wood.dark_oak': { color: '#3D2817', roughness: 0.85, metalness: 0.05, description: 'Heavy dark brown timber, matte finish' },
  'wood.weathered_oak': { color: '#4E3E32', roughness: 0.9, metalness: 0.02, description: 'Age-greyed and weather-beaten oak' },
  'wood.floor_oak': { color: '#2E1E12', roughness: 0.8, metalness: 0.05, description: 'Dark stained floorboard planks' },
  'plaster.lime_warm': { color: '#9E9688', roughness: 0.92, metalness: 0.0, description: 'Muted authentic lime plaster (not blown-out white)' },
  'plaster.tokyo_wall': { color: '#E8E4DC', roughness: 0.94, metalness: 0.0, description: 'Clean modern Japanese off-white matte plaster' },
  'stone.rough_local': { color: '#686E77', roughness: 0.9, metalness: 0.04, description: 'Weathered grey masonry stone' },
  'stone.hearth': { color: '#5E646D', roughness: 0.88, metalness: 0.06, description: 'Heat-patinated hearth stone' },
  'metal.forged_iron': { color: '#1A1C20', roughness: 0.55, metalness: 0.88, description: 'Dark hand-forged iron with hammer marks' },
  'metal.polished_iron': { color: '#2F343B', roughness: 0.38, metalness: 0.92, description: 'Polished iron work surfaces and blades' },
  'leather.worn': { color: '#5C381E', roughness: 0.82, metalness: 0.05, description: 'Well-worn, oiled leather' },
  'cloth.woven_cushion': { color: '#8A402A', roughness: 0.9, metalness: 0.0, description: 'Warm woven fabric cushion' },
  'cloth.painted_panel': { color: '#FFFFFF', roughness: 0.85, metalness: 0.0, textured: true, procedural: true, description: 'Illustrated parchment canvas (procedural texture)' },
  'cloth.woven_rug': { color: '#FFFFFF', roughness: 0.95, metalness: 0.0, textured: true, procedural: true, description: 'Geometric dyed wool rug (procedural texture)' },
  'ceramic.dish': { color: '#1C1F24', roughness: 0.2, metalness: 0.05, description: 'Earthenware ceramic' },
  'ember': { color: '#FF4D00', roughness: 0.7, metalness: 0.0, emissive: '#FF6600', emissiveIntensity: 2.4, description: 'Glowing fire embers' },
  'wood.birch_light': { color: '#DFCBAF', roughness: 0.55, metalness: 0.0, description: 'Clean light Japanese birch / hinoki timber' },
  'metal.matte_black': { color: '#181A1E', roughness: 0.38, metalness: 0.82, description: 'Matte black anodized aluminum' },
  'metal.aluminum_brushed': { color: '#D2D7E0', roughness: 0.22, metalness: 0.95, description: 'Crisp brushed natural aluminum' },
  'plastic.joycon_red': { color: '#FF3B20', roughness: 0.36, metalness: 0.04, description: 'Nintendo Neon Red' },
  'plastic.joycon_blue': { color: '#0AB8E6', roughness: 0.36, metalness: 0.04, description: 'Nintendo Neon Blue' },
  'screen.dev_glow': { color: '#FFFFFF', roughness: 0.12, metalness: 0.05, emissive: '#FFFFFF', emissiveIntensity: 0.9, textured: true, description: 'Illuminated IDE monitor screen' },
  'screen.mario_glow': { color: '#FFFFFF', roughness: 0.12, metalness: 0.05, emissive: '#FFFFFF', emissiveIntensity: 0.9, textured: true, description: 'Secondary dev monitor with red theme' },
  'fabric.tatami': { color: '#CBBD90', roughness: 0.84, metalness: 0.0, description: 'Woven rush grass tatami mat' },
  'fabric.tatami_border': { color: '#1C2027', roughness: 0.85, metalness: 0.0, description: 'Traditional dark cloth tatami edge' },
  'paper.shoji': { color: '#FCF8EE', roughness: 0.95, metalness: 0.0, description: 'Translucent warm washi rice paper' },
  'plant.bonsai': { color: '#2E5929', roughness: 0.72, metalness: 0.0, description: 'Miniature Japanese pine foliage' },
  'ceramic.white': { color: '#F8F6F0', roughness: 0.18, metalness: 0.05, description: 'Glazed porcelain white mug/pot' },
  'decor.nintendo_art': { color: '#FFFFFF', roughness: 0.45, metalness: 0.0, textured: true, description: 'Framed Zelda Triforce crest with Nintendo seal' },
  'skyline.tokyo_night': { color: '#FFFFFF', roughness: 0.8, metalness: 0.0, emissive: '#FFFFFF', emissiveIntensity: 1.4, textured: true, description: 'Tokyo night skyline with lit skyscrapers and Tokyo Tower' },
  'glass.window': { color: '#E0F2FE', roughness: 0.04, metalness: 0.12, description: 'Clear architectural window glass' },
  'metal.brass_gold': { color: '#F59E0B', roughness: 0.2, metalness: 0.94, description: 'Polished brass and gold accents' },
  'metal.dwemer_brass': { color: '#D4AF37', roughness: 0.32, metalness: 0.88, description: 'Antique Dwemer gold/brass' },
  'stone.winterhold_masonry': { color: '#3D434D', roughness: 0.92, metalness: 0.06, description: 'Weathered ancient Nordic granite' },
  'stone.nordic_carved': { color: '#2A2F38', roughness: 0.86, metalness: 0.08, description: 'Dark carved rune-etched stone' },
  'ice.glacial': { color: '#88CCEE', roughness: 0.1, metalness: 0.05, description: 'Glacial pack ice' },
  'crystal.soul_gem': { color: '#9333EA', roughness: 0.12, metalness: 0.1, emissive: '#A855F7', emissiveIntensity: 2.4, description: 'Grand Soul Gem (Glowing Amethyst)' },
  'crystal.soul_gem_cyan': { color: '#06B6D4', roughness: 0.12, metalness: 0.1, emissive: '#22D3EE', emissiveIntensity: 2.6, description: 'Lesser Soul Gem (Glowing Cyan)' },
  'magic.witchlight_blue': { color: '#38BDF8', roughness: 0.5, metalness: 0.0, emissive: '#0284C7', emissiveIntensity: 3.5, description: 'Arcane blue witchlight flame' },
  'magic.witchlight_coals': { color: '#181E26', roughness: 0.88, metalness: 0.05, emissive: '#0369A1', emissiveIntensity: 1.6, description: 'Chilled enchanted charcoal with deep sapphire inner ember glow' },
  'leather.spellbook_navy': { color: '#1E293B', roughness: 0.75, metalness: 0.05, description: 'Deep navy grimoire leather' },
  'leather.spellbook_crimson': { color: '#6B1D1D', roughness: 0.75, metalness: 0.05, description: 'Crimson grimoire leather' },
  'magic.arcane_rune': { color: '#FFFFFF', roughness: 0.85, metalness: 0.1, emissive: '#00B4D8', emissiveIntensity: 2.2, textured: true, description: 'Glowing arcane rune circle on flagstones' },
  'skyline.winterhold_aurora': { color: '#FFFFFF', roughness: 0.95, metalness: 0.0, emissive: '#10B981', emissiveIntensity: 2.2, textured: true, description: 'Swirling Aurora Borealis over Sea of Ghosts' },
  'skyline.misty_mountains': { color: '#FFFFFF', roughness: 0.95, metalness: 0.0, emissive: '#93C5FD', emissiveIntensity: 1.1, textured: true, procedural: true, description: 'Misty mountain range backdrop (library)' },
  'skyline.cobblestone_alley': { color: '#FFFFFF', roughness: 0.95, metalness: 0.0, emissive: '#F59E0B', emissiveIntensity: 0.9, textured: true, procedural: true, description: 'Cobblestone alley backdrop (alchemist)' },
  'skyline.stormy_bastion': { color: '#FFFFFF', roughness: 0.95, metalness: 0.0, emissive: '#F97316', emissiveIntensity: 0.85, textured: true, procedural: true, description: 'Stormy fortress bastion backdrop (armory)' },
  'skyline.twilight_valley': { color: '#FFFFFF', roughness: 0.95, metalness: 0.0, emissive: '#FBBF24', emissiveIntensity: 0.7, textured: true, procedural: true, description: 'Alpine twilight valley backdrop (forge)' },
  'skyline.village_sunset': { color: '#FFFFFF', roughness: 0.95, metalness: 0.0, emissive: '#F59E0B', emissiveIntensity: 0.8, textured: true, procedural: true, description: 'Medieval village sunset backdrop (tavern)' },
  'banner.winterhold': { color: '#FFFFFF', roughness: 0.85, metalness: 0.05, textured: true, description: 'College of Winterhold Eye of Magnus banner' },
  'book.grimoire_page': { color: '#FFFFFF', roughness: 0.8, metalness: 0.0, textured: true, description: 'Ancient vellum page with Daedric spell glyphs' },
  'bone.weathered_ivory': { color: '#9A9180', roughness: 0.88, metalness: 0.02, description: 'Aged ancient beast bone (matte, crevice-friendly, anti-blowout)' },
  'bone.horn_dark': { color: '#221A15', roughness: 0.7, metalness: 0.06, description: 'Deep patinated ram horn' },
  'wax.candle': { color: '#F5EEDB', roughness: 0.45, metalness: 0.02, description: 'Tallow candle wax' }
};

const SHELL = [4.8, 3.6, 4.8];

export const ARCHETYPE_CATALOG = {
  'mtx.fixture.hardline_booth': {
    category: 'architecture', dimensions: [1.1, 2.55, 1.1],
    description: 'MTX Hardline booth with stepped plinth, bevelled enclosure, inset cyan receiver, cable, latches, and restrained code signal',
    anchors: ['anchor.front_interaction', 'anchor.cable_exit'],
    anchorPositionsM: { frontInteractionM: [0, 0, 0.85], cableExitM: [0, 2.4, -0.4] },
    // Local metres, booth origin at floor centre, interactive face toward +Z (south).
    clearance: [{ id: 'front', kind: 'box', sizeM: [1.2, 2, 1.2], centerM: [0, 1, 1.15] }],
    collision: { kind: 'box', class: 'static_solid', sizeM: [1.1, 2.55, 1.1], centerM: [0, 1.275, 0] },
    interaction: { kind: 'hardline', anchor: 'frontInteractionM', zone: 'cylinder', reachM: 1.25, heightM: 2 },
    surfaces: ['mtx.neutral.black_lacquer', 'mtx.glass.cyan', 'mtx.signal.green_code'],
    lodClass: 'hero_static', variantSeed: 'entity.seed',
    mesoFeatures: ['stepped grounded plinth', 'bevelled enclosure', 'receiver recess', 'steel latches', 'cable exit', 'asymmetric service tag']
  },
  'mtx.plaza.floor_field': {
    category: 'architecture', dimensions: [16, 0.05, 16],
    description: 'MTX plaza floor field: 1 m stone slabs with a polished black lacquer inlay grid; the reflective-floor test surface',
    anchors: ['anchor.surface.floor'],
    anchorPositionsM: { centerTopM: [0, 0.05, 0] },
    clearance: [],
    collision: { kind: 'box', class: 'walkable', sizeM: [16, 0.05, 16], centerM: [0, 0.025, 0] },
    interaction: null,
    surfaces: ['mtx.neutral.stone', 'mtx.neutral.black_lacquer'],
    lodClass: 'static', variantSeed: 'entity.seed',
    mesoFeatures: ['1 m slab grid', 'polished lacquer inlay', 'bevelled slab edge']
  },
  'mtx.plaza.arrival_circle': {
    category: 'architecture', dimensions: [4.8, 0.12, 4.8],
    description: 'MTX Arrival Circle: a low stepped stone dais with a white arrival ring and a cyan glyph ring',
    anchors: ['anchor.arrival.center', 'anchor.arrival.approach'],
    anchorPositionsM: { centerM: [0, 0.12, 0], approachM: [0, 0, 2.9] },
    clearance: [{ id: 'arrival_column', kind: 'box', sizeM: [3.2, 3, 3.2], centerM: [0, 1.62, 0] }],
    collision: { kind: 'box', class: 'walkable', sizeM: [4.8, 0.12, 4.8], centerM: [0, 0.06, 0] },
    interaction: { kind: 'arrival', anchor: 'centerM', zone: 'cylinder', reachM: 1.6, heightM: 2.4 },
    surfaces: ['mtx.neutral.stone', 'mtx.construct.white', 'mtx.glass.cyan'],
    lodClass: 'hero_static', variantSeed: 'entity.seed',
    mesoFeatures: ['two-step dais', 'white arrival ring', 'cyan glyph ring', 'four approach notches']
  },
  'mtx.surface.code_wall': {
    category: 'architecture', dimensions: [8, 3.6, 0.5],
    description: 'MTX code wall: black lacquer frame holding a field of green glyph cells',
    anchors: ['anchor.face.center'],
    anchorPositionsM: { faceCenterM: [0, 1.8, 0.25] },
    clearance: [{ id: 'front', kind: 'box', sizeM: [8, 2.2, 1], centerM: [0, 1.1, 0.75] }],
    collision: { kind: 'box', class: 'static_solid', sizeM: [8, 3.6, 0.5], centerM: [0, 1.8, 0] },
    interaction: null,
    surfaces: ['mtx.neutral.black_lacquer', 'mtx.signal.green_code'],
    lodClass: 'static', variantSeed: 'entity.seed',
    mesoFeatures: ['lacquer frame', 'glyph cell field', 'plinth kick', 'mullions']
  },
  'mtx.edge.glass_rail': {
    category: 'architecture', dimensions: [6, 1.1, 0.2],
    description: 'MTX glass edge rail: dark brushed posts and cap holding cyan glass panes at the plaza edge',
    anchors: ['anchor.rail.left', 'anchor.rail.right'],
    anchorPositionsM: { leftEndM: [-3, 0, 0], rightEndM: [3, 0, 0] },
    clearance: [],
    collision: { kind: 'box', class: 'static_solid', sizeM: [6, 1.1, 0.2], centerM: [0, 0.55, 0] },
    interaction: null,
    surfaces: ['mtx.metal.brushed_dark', 'mtx.glass.cyan'],
    lodClass: 'static', variantSeed: 'entity.seed',
    mesoFeatures: ['posts every 1.5 m', 'cap rail', 'glass panes', 'kick plate']
  },
  'mtx.actor.hero_avatar': {
    category: 'actor', dimensions: [0.7, 1.85, 0.45],
    description: 'MTX hero avatar stand-in: long black coat, brushed collar, cyan visor; the readable player',
    anchors: ['anchor.feet', 'anchor.head', 'anchor.nameplate'],
    anchorPositionsM: { feetM: [0, 0, 0], headM: [0, 1.7, 0], nameplateM: [0, 2.05, 0] },
    clearance: [],
    collision: { kind: 'box', class: 'actor', sizeM: [0.6, 1.85, 0.4], centerM: [0, 0.925, 0] },
    interaction: null,
    surfaces: ['mtx.neutral.black_lacquer', 'mtx.metal.brushed_dark', 'mtx.neutral.stone', 'mtx.glass.cyan'],
    lodClass: 'hero_actor', variantSeed: 'entity.seed',
    mesoFeatures: ['long coat skirt', 'collar', 'visor', 'readable hands']
  },
  'mtx.actor.crowd_figure': {
    category: 'actor', dimensions: [0.7, 1.85, 0.5],
    description: 'MTX crowd silhouette stand-in: coat and head only, readable at plaza distance',
    anchors: ['anchor.feet', 'anchor.head'],
    anchorPositionsM: { feetM: [0, 0, 0], headM: [0, 1.68, 0] },
    clearance: [],
    collision: { kind: 'box', class: 'actor', sizeM: [0.6, 1.85, 0.45], centerM: [0, 0.925, 0] },
    interaction: null,
    surfaces: ['mtx.neutral.black_lacquer', 'mtx.metal.brushed_dark', 'mtx.neutral.stone'],
    lodClass: 'crowd_actor', variantSeed: 'entity.seed',
    mesoFeatures: ['coat silhouette', 'shoulder line', 'head']
  },
  'mtx.construct.white_floor': {
    category: 'architecture', dimensions: [12, 0.05, 12],
    description: 'MTX Construct floor: 1 m white slabs with hairline stone seams; the loading-program void',
    anchors: ['anchor.surface.floor'],
    anchorPositionsM: { centerTopM: [0, 0.05, 0] },
    clearance: [],
    collision: { kind: 'box', class: 'walkable', sizeM: [12, 0.05, 12], centerM: [0, 0.025, 0] },
    interaction: null,
    surfaces: ['mtx.construct.white', 'mtx.neutral.stone'],
    lodClass: 'static', variantSeed: 'entity.seed',
    mesoFeatures: ['1 m white slab grid', 'hairline stone seams', 'white edge skirt']
  },
  'mtx.construct.artifact_plinth': {
    category: 'architecture', dimensions: [0.9, 1.0, 0.9],
    description: 'MTX Construct plinth: a stepped white pedestal with an inset green code band; it holds the Program artifact',
    anchors: ['anchor.front_interaction', 'anchor.artifact'],
    anchorPositionsM: { frontInteractionM: [0, 0, 0.8], artifactM: [0, 1.0, 0] },
    clearance: [{ id: 'front', kind: 'box', sizeM: [1.0, 2, 1.0], centerM: [0, 1, 1.0] }],
    collision: { kind: 'box', class: 'static_solid', sizeM: [0.9, 1.0, 0.9], centerM: [0, 0.5, 0] },
    interaction: { kind: 'artifact', anchor: 'frontInteractionM', zone: 'cylinder', reachM: 1.4, heightM: 2 },
    surfaces: ['mtx.construct.white', 'mtx.signal.green_code'],
    lodClass: 'hero_static', variantSeed: 'entity.seed',
    mesoFeatures: ['stepped white plinth', 'inset green code band', 'artifact socket']
  },
  // Architecture — diorama shells (dimensions are approximate footprints)
  'arch.forge_pavilion': { category: 'architecture', dimensions: SHELL, description: 'Open timber-and-stone forge pavilion diorama shell with twilight valley backdrop', anchors: ['anchor.surface.floor'], mesoFeatures: ['timber posts', 'stone plinth', 'skyline backdrop'] },
  'arch.tavern_hall': { category: 'architecture', dimensions: SHELL, description: 'Medieval tavern hall shell with plaster, timber framing and village sunset window', anchors: ['anchor.surface.floor', 'anchor.wall.mount'], mesoFeatures: ['timber framing', 'plaster', 'skyline backdrop'] },
  'arch.alchemist_shell': { category: 'architecture', dimensions: SHELL, description: 'Stone-and-timber alchemist laboratory shell with cobblestone alley window', anchors: ['anchor.surface.floor', 'anchor.wall.mount'], mesoFeatures: ['stone walls', 'timber beams', 'leaded window'] },
  'arch.armory_shell': { category: 'architecture', dimensions: SHELL, description: 'Dungeon armory shell with forged-iron fittings and stormy bastion window', anchors: ['anchor.surface.floor', 'anchor.wall.mount'], mesoFeatures: ['iron fittings', 'stone vault', 'skyline backdrop'] },
  'arch.library_shell': { category: 'architecture', dimensions: SHELL, description: 'Hermit library / scriptorium shell with misty mountain window', anchors: ['anchor.surface.floor', 'anchor.wall.mount'], mesoFeatures: ['stone walls', 'oak beams', 'tall window'] },
  'arch.tokyo_apartment_shell': { category: 'architecture', dimensions: [4.4, 2.8, 4.4], description: 'Modern Tokyo apartment cutaway shell with night skyline', anchors: ['anchor.surface.floor', 'anchor.wall.mount'], mesoFeatures: ['off-white plaster', 'wood baseboards', 'balcony glazing'] },
  'arch.winterhold_shell': { category: 'architecture', dimensions: SHELL, description: 'Ancient Nordic granite diorama shell with rune dais, lancet window, aurora skyline and witchlight chandelier', anchors: ['anchor.surface.floor', 'anchor.wall.mount', 'anchor.rune.center'], mesoFeatures: ['groin vault ribs', 'lancet arch tracery', 'aurora borealis', 'witchlight chandelier'] },
  'forge.stone_chimney_family': { category: 'architecture', dimensions: [1.8, 2.5, 0.9], description: 'Stone hearth base with masonry bricks, hooded chimney, glowing fire bed', anchors: ['anchor.fire', 'anchor.flue'], mesoFeatures: ['mortared joints', 'heat-cracked bricks', 'soot deposits'] },
  'arch.fireplace': { category: 'architecture', dimensions: [1.4, 1.6, 0.7], description: 'Medieval stone lintel hearth with glowing coals', anchors: ['anchor.fire', 'anchor.mantel'], mesoFeatures: ['stone lintel', 'firebox void', 'ash bed'] },
  'arch.hearth': { category: 'architecture', dimensions: [1.4, 1.6, 0.7], description: 'Simple stone hearth with embers', anchors: ['anchor.fire'], mesoFeatures: ['mortared stones', 'firebox void'] },
  'hearth.stone_family': { category: 'architecture', dimensions: [1.4, 1.6, 0.7], description: 'Stone hearth family with masonry', anchors: ['anchor.fire'], mesoFeatures: ['mortared stones'] },
  'arch.floor': { category: 'architecture', dimensions: [8, 0.03, 6], description: 'Instanced dark oak floorboards with plank seams', anchors: ['anchor.surface.floor'], mesoFeatures: ['plank gaps', 'age warping'] },
  'arch.wall': { category: 'architecture', dimensions: [8, 3, 0.15], description: 'Plaster wall with vertical exposed dark oak timber posts', anchors: ['anchor.wall.mount'], mesoFeatures: ['timber posts', 'plaster texture'] },
  'arch.tatami_floor': { category: 'architecture', dimensions: [3.6, 0.03, 3.6], description: 'Traditional Japanese 6-mat tatami floor with cloth borders', anchors: ['anchor.surface.floor'], mesoFeatures: ['rush weave', 'cloth borders'] },
  'arch.shoji_window': { category: 'architecture', dimensions: [2.4, 1.8, 0.06], description: 'Japanese shoji lattice sliding window with warm rice paper panel', anchors: ['anchor.window.sill'], mesoFeatures: ['kumiko lattice', 'translucent washi', 'timber frame'] },
  'arch.balcony_window': { category: 'architecture', dimensions: [3.2, 2.4, 0.08], description: 'Tokyo floor-to-ceiling balcony sliding window with railing and night skyline', anchors: ['anchor.balcony.rail'], mesoFeatures: ['sliding glass', 'aluminum frame', 'tokyo skyline'] },
  'arch.tokyo_walls': { category: 'architecture', dimensions: [4.4, 2.8, 4.4], description: 'Modern Japanese apartment cutaway walls with wood baseboards and wall-mounted AC', anchors: ['anchor.wall.mount', 'anchor.ac.mount'], mesoFeatures: ['off-white plaster', 'wood baseboards', 'mini-split ac'] },
  // Furniture
  'furniture.table': { category: 'furniture', dimensions: [2.1, 0.78, 0.95], description: 'Heavy oak dining table with 4 legs and stretcher', anchors: ['anchor.surface.top'], mesoFeatures: ['mortise joints', 'stretcher bars', 'chamfered edges'] },
  'table.domestic_oak_01': { category: 'furniture', dimensions: [2.1, 0.78, 0.95], description: 'Heavy domestic oak table with tableware', anchors: ['anchor.surface.top'], mesoFeatures: ['mortise joints', 'tableware'] },
  'furniture.desk': { category: 'furniture', dimensions: [1.4, 0.75, 0.75], description: 'Compact study desk', anchors: ['anchor.surface.top'], mesoFeatures: ['drawer slot', 'writing surface'] },
  'furniture.tokyo_desk': { category: 'furniture', dimensions: [1.6, 0.75, 0.8], description: 'Light birch desk with matte black steel legs and deskmat', anchors: ['anchor.surface.top'], mesoFeatures: ['chamfered birch', 'steel square legs', 'cable grommet'] },
  'furniture.bench': { category: 'furniture', dimensions: [1.6, 0.45, 0.32], description: 'Sturdy timber bench with optional cushion', anchors: ['anchor.surface.top'], mesoFeatures: ['slab seat', 'splayed legs'] },
  'furniture.bookshelf': { category: 'furniture', dimensions: [1.2, 2.2, 0.38], description: 'Tall 4-shelf oak bookcase with procedural grimoires', anchors: ['anchor.shelf.1', 'anchor.shelf.2', 'anchor.shelf.3', 'anchor.shelf.4'], mesoFeatures: ['dowel pins', 'book spines'] },
  'furniture.ergonomic_chair': { category: 'furniture', dimensions: [0.65, 1.05, 0.65], description: 'Ergonomic mesh office chair with lumbar support and 5-star castor base', anchors: ['anchor.seat'], mesoFeatures: ['mesh backrest', 'lumbar pillow', 'castor wheels'] },
  'furniture.game_shelf': { category: 'furniture', dimensions: [1.2, 0.25, 0.22], description: 'Floating birch wall shelf with game cases and golden Triforce', anchors: ['anchor.shelf.top'], mesoFeatures: ['red game spines', 'golden triforce', 'hidden brackets'] },
  // Workshop
  'anvil.forged_iron_01': { category: 'workshop', dimensions: [0.7, 0.85, 0.35], description: 'Blacksmith anvil on timber stump with iron hoop', anchors: ['anchor.face', 'anchor.horn', 'anchor.hardy'], mesoFeatures: ['riveted iron band', 'polished striking face', 'hardy hole'] },
  'bellows.leather_iron_01': { category: 'workshop', dimensions: [1.0, 0.65, 0.45], description: 'Forge bellows with oak rocker, leather bladder, iron nozzle', anchors: ['anchor.nozzle'], mesoFeatures: ['skid trestle', 'pivot pin', 'leather folds'] },
  'workshop.weapon_rack': { category: 'workshop', dimensions: [1.6, 1.8, 0.5], description: 'Timber A-frame rack with forged swords and axes', anchors: ['anchor.slot.1', 'anchor.slot.2', 'anchor.slot.3'], mesoFeatures: ['crossguard pegs', 'notched frame'] },
  'kitchen.cauldron': { category: 'workshop', dimensions: [0.7, 0.5, 0.7], description: 'Heavy iron cauldron on tripod with glowing brew', anchors: ['anchor.interior'], mesoFeatures: ['tripod rim', 'heat embers'] },
  'prop.nintendo_rig': { category: 'workshop', dimensions: [1.1, 0.45, 0.6], description: 'Dual-monitor dev workstation with mechanical keyboard, docked Switch and ceramic mug', anchors: ['anchor.screen.primary', 'anchor.switch.dock'], mesoFeatures: ['curved ultrawide display', 'neon joy-cons', 'mechanical keycaps'] },
  'workshop.arcane_enchanter': { category: 'workshop', dimensions: [1.8, 1.2, 0.95], description: 'Arcane Enchanter stone altar with horned skull, levitating soul gems, alembic and grimoire', anchors: ['anchor.altar.top', 'anchor.soul_gem'], mesoFeatures: ['horned daedric skull', 'floating grand soul gem', 'alembic flask', 'open grimoire'] },
  // Storage
  'storage.chest': { category: 'storage', dimensions: [0.85, 0.55, 0.5], description: 'Wooden chest with iron corner straps and latch', anchors: ['anchor.interior', 'anchor.lid'], mesoFeatures: ['iron strapping', 'lock latch'] },
  'chest.storage_strapped_01': { category: 'storage', dimensions: [0.85, 0.55, 0.5], description: 'Reinforced storage chest', anchors: ['anchor.interior', 'anchor.lid'], mesoFeatures: ['iron strapping', 'lock latch'] },
  'storage.barrel': { category: 'storage', dimensions: [0.55, 0.85, 0.55], description: 'Weathered oak stave barrel with iron hoops', anchors: ['anchor.bung', 'anchor.top'], mesoFeatures: ['dual iron hoops', 'wooden bung', 'stave gaps'] },
  'storage.crate': { category: 'storage', dimensions: [0.7, 0.6, 0.7], description: 'Slat-constructed cargo crate with diagonal braces', anchors: ['anchor.interior'], mesoFeatures: ['chamfered slats', 'iron corner braces'] },
  'storage.arcanaeum_bookshelf': { category: 'storage', dimensions: [1.6, 2.5, 0.44], description: 'Massive dark Nordic oak bookcase with grimoires, scrolls and wax seals', anchors: ['anchor.shelf.1', 'anchor.shelf.2', 'anchor.shelf.3', 'anchor.shelf.4'], mesoFeatures: ['iron strap brackets', 'ancient grimoires', 'scroll rolls'] },
  // Props
  'prop.armillary_sphere': { category: 'prop', dimensions: [0.7, 1.6, 0.7], description: 'Celestial astrolabe with brass gimbal rings and floating cyan soul gem', anchors: ['anchor.core'], mesoFeatures: ['concentric brass gimbals', 'floating cyan soul gem', 'stone pedestal'] },
  'prop.spell_lectern': { category: 'prop', dimensions: [0.65, 1.2, 0.52], description: 'Carved stone lectern holding an open illuminated grimoire', anchors: ['anchor.reading_desk'], mesoFeatures: ['carved stone pillar', 'illuminated pages', 'soul shard bookmark'] },
  // Lighting & Decor
  'lighting.lantern': { category: 'lighting', dimensions: [0.2, 0.35, 0.2], description: 'Forged iron cage lantern with warm ember core', anchors: ['anchor.hook', 'anchor.base'], mesoFeatures: ['iron cage bars', 'emissive core'] },
  'lighting.winterhold_brazier': { category: 'lighting', dimensions: [0.7, 1.2, 0.7], description: 'Wrought-iron tripod brazier with arcane blue witchlight fire', anchors: ['anchor.fire'], mesoFeatures: ['splayed tripod legs', 'witchlight flame', 'heat patinated iron'] },
  'decor.woven_rug': { category: 'decor', dimensions: [2.4, 0.02, 1.6], description: 'Geometric patterned woven rug', anchors: [], mesoFeatures: ['sunburst pattern', 'fringe edges'] },
  'painting.sun_mountain_01': { category: 'decor', dimensions: [0.6, 0.8, 0.05], description: 'Framed parchment painting with mountain sigil', anchors: ['anchor.wall_hook'], mesoFeatures: ['oak frame', 'parchment texture'] },
  'decor.bonsai': { category: 'decor', dimensions: [0.28, 0.35, 0.28], description: 'Potted miniature pine bonsai in glazed white ceramic pot', anchors: ['anchor.pot.base'], mesoFeatures: ['shallow ceramic dish', 'gnarled trunk', 'cloud foliage'] },
  'decor.nintendo_art': { category: 'decor', dimensions: [0.85, 1.05, 0.04], description: 'Framed Triforce crest wall artwork with red seal', anchors: ['anchor.wall_hook'], mesoFeatures: ['anodized frame', 'golden triforce', 'red seal'] }
};

// Audited expected-route oracle (SOL-FIX-1). Authored here, independently of WorldCompiler's route
// table: scripts/check_contract_drift.mjs spies on every UniversalFoundry build* method and every
// WorldCompiler inline builder, compiles each catalog id, and requires the builder that actually ran
// to equal this entry. `kind`: 'foundry' = UniversalFoundry method, 'inline' = WorldCompiler compound.
// `temporary` marks a route P1 must replace; do not re-baseline these from runtime output.
const FOUNDRY_ROUTE_GROUPS = {
  buildHardlineBooth: ['mtx.fixture.hardline_booth'],
  buildMtxFloorField: ['mtx.plaza.floor_field'],
  buildMtxArrivalCircle: ['mtx.plaza.arrival_circle'],
  buildMtxCodeWall: ['mtx.surface.code_wall'],
  buildMtxGlassRail: ['mtx.edge.glass_rail'],
  buildMtxHeroAvatar: ['mtx.actor.hero_avatar'],
  buildMtxCrowdFigure: ['mtx.actor.crowd_figure'],
  buildMtxConstructFloor: ['mtx.construct.white_floor'],
  buildMtxArtifactPlinth: ['mtx.construct.artifact_plinth'],
  buildWinterholdShell: ['arch.winterhold_shell'],
  buildLibraryShell: ['arch.library_shell'],
  buildAlchemistShell: ['arch.alchemist_shell'],
  buildArmoryShell: ['arch.armory_shell'],
  buildForgePavilionShell: ['arch.forge_pavilion'],
  buildTavernHallShell: ['arch.tavern_hall'],
  buildArcaneEnchanter: ['workshop.arcane_enchanter'],
  buildArcanaeumBookshelf: ['storage.arcanaeum_bookshelf'],
  buildArmillarySphere: ['prop.armillary_sphere'],
  buildWinterholdBrazier: ['lighting.winterhold_brazier'],
  buildSpellLectern: ['prop.spell_lectern'],
  buildTokyoApartmentShell: ['arch.tokyo_apartment_shell'],
  buildTatamiFloor: ['arch.tatami_floor'],
  buildTokyoDesk: ['furniture.tokyo_desk'],
  buildNintendoRig: ['prop.nintendo_rig'],
  buildErgonomicChair: ['furniture.ergonomic_chair'],
  buildShojiWindow: ['arch.shoji_window'],
  buildBonsai: ['decor.bonsai'],
  buildGameShelf: ['furniture.game_shelf'],
  buildHearth: ['forge.stone_chimney_family'],
  buildFireplace: ['arch.fireplace', 'arch.hearth', 'hearth.stone_family'],
  buildAnvil: ['anvil.forged_iron_01'],
  buildBellows: ['bellows.leather_iron_01'],
  buildBookshelf: ['furniture.bookshelf'],
  buildWeaponRack: ['workshop.weapon_rack'],
  buildCauldron: ['kitchen.cauldron'],
  buildTable: ['furniture.table', 'table.domestic_oak_01', 'furniture.desk'],
  buildChest: ['storage.chest', 'chest.storage_strapped_01'],
  buildBarrel: ['storage.barrel'],
  buildCrate: ['storage.crate'],
  buildLantern: ['lighting.lantern'],
  buildBench: ['furniture.bench'],
  buildFloor: ['arch.floor'],
  buildWall: ['arch.wall']
};
const INLINE_ROUTE_GROUPS = {
  compileFramedPanel: ['painting.sun_mountain_01', 'decor.nintendo_art'],
  compileRug: ['decor.woven_rug']
};
const TEMPORARY_ROUTES = {
  'arch.balcony_window': { kind: 'inline', route: 'compileBalconyWindow', temporary: 'P1: UniversalFoundry never had a balcony builder (pre-SPEC-07 route threw TypeError); P1 moves this compound into a foundry-owned builder (FND-TOKYO-FOUNDRY-BUILDERS-MISSING).' },
  'arch.tokyo_walls': { kind: 'foundry', route: 'buildTokyoApartmentShell', temporary: 'P1: historical full-shell semantics (the pre-SPEC-07 apartment-shell branch shadowed the walls branch); P1 delivers walls-only semantics or renames/deprecates the id.' }
};
export const ARCHETYPE_EXPECTED_ROUTES = Object.freeze(Object.fromEntries([
  ...Object.entries(FOUNDRY_ROUTE_GROUPS).flatMap(([route, ids]) => ids.map(id => [id, Object.freeze({ kind: 'foundry', route })])),
  ...Object.entries(INLINE_ROUTE_GROUPS).flatMap(([route, ids]) => ids.map(id => [id, Object.freeze({ kind: 'inline', route })])),
  ...Object.entries(TEMPORARY_ROUTES).map(([id, r]) => [id, Object.freeze({ ...r })])
]));

export function isKnownArchetype(ref) {
  return typeof ref === 'string' && Object.prototype.hasOwnProperty.call(ARCHETYPE_CATALOG, ref);
}

export function isKnownMaterial(ref) {
  return typeof ref === 'string' && Object.prototype.hasOwnProperty.call(MATERIAL_CATALOG, ref);
}

/**
 * Deterministic seed from stable identity (FNV-1a 32-bit), used when the caller omits one.
 * Same worldId + entityId always yields the same seed in [1, LIMITS.seedMax].
 */
export function deriveSeed(worldId, entityId) {
  const text = `${worldId}::${entityId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % LIMITS.seedMax) + 1;
}

/** Stable JSON (sorted keys) for hashing/scene identity. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Scene identity + preview-bridge protocol (SPEC-08). An authored world is `sha256:` + the first 32 hex
// of SHA-256(canonicalJson(manifest)); the Studio recomputes it from the manifest it actually compiled.
// Presets are `preset:<id>`, game mode `mode:game`, nothing loaded `none`: never equal to a sha256 identity.
export const BRIDGE_PROTOCOL = 2;
export const SCENE_IDENTITY_PREFIX = 'sha256:';
export const SCENE_IDENTITY_HEX_CHARS = 32;

export function formatSceneIdentity(hex) {
  return SCENE_IDENTITY_PREFIX + String(hex).slice(0, SCENE_IDENTITY_HEX_CHARS);
}

/** WebCrypto identity (browser and Node). Throws INSECURE_CONTEXT when crypto.subtle is unavailable. */
export async function computeSceneIdentity(manifest, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('INSECURE_CONTEXT: crypto.subtle is unavailable (open the Studio on localhost/127.0.0.1)');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(manifest)));
  return formatSceneIdentity([...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join(''));
}

const vec3 = (description) => ({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description });

export const RELATIONSHIP_SCHEMA = {
  type: 'object',
  required: ['type', 'target'],
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: RELATIONSHIP_TYPES },
    target: { type: 'string', description: 'Entity id in this world, or a ground target such as "ground.stone".' },
    anchor: { type: 'string', description: 'Anchor on the target, e.g. "anchor.surface.top".' }
  }
};

export const ENTITY_SCHEMA = {
  type: 'object',
  required: ['id', 'assetRef', 'transform'],
  properties: {
    id: { type: 'string', pattern: LIMITS.idPattern },
    kind: { type: 'string', enum: ENTITY_KINDS },
    assetRef: { type: 'string', description: 'Key of ARCHETYPE_CATALOG (resource artisan://catalog/archetypes).' },
    transform: {
      type: 'object',
      required: ['positionM'],
      properties: {
        positionM: vec3('[x,y,z] meters; +X east, +Y up, +Z south; floor y=0.'),
        rotationDeg: vec3('[pitch, yaw, roll] degrees.'),
        scale: { ...vec3('Per-axis scale.'), items: { type: 'number', minimum: LIMITS.scaleMin, maximum: LIMITS.scaleMax } }
      }
    },
    materialRefs: { type: 'array', items: { type: 'string' }, maxItems: LIMITS.maxMaterialRefs },
    relationships: { type: 'array', items: RELATIONSHIP_SCHEMA },
    seed: { type: 'integer', minimum: 0, maximum: LIMITS.seedMax },
    authorship: {
      type: 'object',
      properties: {
        maker: { type: 'string' },
        ageYears: { type: 'number', minimum: 0 },
        care: { type: 'number', minimum: 0, maximum: 1 },
        wealth: { type: 'number', minimum: 0, maximum: 1 }
      }
    }
  }
};

export const WORLD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'artisan://schema/world',
  title: 'Artisan World Compass manifest',
  description: `Contract v${CONTRACT_VERSION}. The LLM edits the WORLD; the compiler decides how to RENDER it.`,
  type: 'object',
  required: ['worldId', 'entities'],
  properties: {
    worldId: { type: 'string', pattern: LIMITS.idPattern },
    version: { type: 'integer', minimum: 1 },
    contractVersion: { type: 'string' },
    units: { const: 'meter' },
    axis: { type: 'object', const: AXIS },
    lighting: { type: 'string', enum: LIGHTING_PRESETS },
    roomSize: { type: 'array', items: { type: 'number', minimum: LIMITS.roomSizeMinM, maximum: LIMITS.roomSizeMaxM }, minItems: 3, maxItems: 3 },
    entities: { type: 'array', maxItems: LIMITS.maxEntities, items: ENTITY_SCHEMA }
  }
};
