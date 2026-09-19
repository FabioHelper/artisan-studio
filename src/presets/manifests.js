// ==========================================================================
// ARTISAN WORLD COMPASS — CANONICAL GOLDEN SCENE PRESETS
// Proves any LLM can generate distinct, high-fidelity artisan environments
// ==========================================================================

export const ManifestForgeTrio = {
  "worldId": "blacksmith_forge_hero_v1",
  "version": 2,
  "units": "meter",
  "axis": { "handedness": "right", "up": "+Y", "east": "+X", "south": "+Z" },
  "entities": [
    {
      "id": "arch.shell.forge_pavilion.001",
      "kind": "architecture",
      "transform": { "positionM": [0, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "arch.forge_pavilion",
      "materialRefs": ["stone.rough_local", "wood.dark_oak", "skyline.twilight_valley"],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "arch.hearth.chimney.001",
      "kind": "architecture",
      "transform": { "positionM": [-1.6, 0, -0.6], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "forge.stone_chimney_family",
      "materialRefs": ["stone.rough_local", "plaster.lime_warm", "ember"],
      "seed": 137,
      "relationships": [{ "type": "supported_by", "target": "arch.shell.forge_pavilion.001" }]
    },
    {
      "id": "prop.anvil.blacksmith.001",
      "kind": "prop",
      "transform": { "positionM": [0.1, 0, 0.4], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "anvil.forged_iron_01",
      "materialRefs": ["metal.forged_iron", "metal.polished_iron", "wood.dark_oak"],
      "seed": 211,
      "relationships": [{ "type": "supported_by", "target": "arch.shell.forge_pavilion.001" }]
    },
    {
      "id": "prop.bellows.workshop.001",
      "kind": "prop",
      "transform": { "positionM": [1.5, 0, -0.3], "rotationDeg": [0, -8.5, 0], "scale": [1, 1, 1] },
      "assetRef": "bellows.leather_iron_01",
      "materialRefs": ["wood.dark_oak", "leather.worn", "metal.forged_iron"],
      "seed": 404,
      "relationships": [{ "type": "supported_by", "target": "arch.shell.forge_pavilion.001" }]
    }
  ]
};

export const ManifestMedievalTavern = {
  "worldId": "golden_medieval_house_v1",
  "version": 2,
  "units": "meter",
  "axis": { "handedness": "right", "up": "+Y", "east": "+X", "south": "+Z" },
  "entities": [
    {
      "id": "arch.shell.tavern_hall.001",
      "kind": "architecture",
      "transform": { "positionM": [0, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "arch.tavern_hall",
      "materialRefs": [
        "plaster.lime_warm",
        "wood.dark_oak",
        "stone.rough_local",
        "glass.window",
        "skyline.village_sunset"
      ],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "arch.hearth.stone.001",
      "kind": "architecture",
      "transform": { "positionM": [1.7, 0, -2.05], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "hearth.stone_family",
      "materialRefs": ["stone.rough_local", "ember"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.tavern_hall.001" }]
    },
    {
      "id": "prop.table.oak.001",
      "kind": "prop",
      "transform": { "positionM": [0.1, 0, 0.2], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "table.domestic_oak_01",
      "materialRefs": ["wood.dark_oak"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.tavern_hall.001" }]
    },
    {
      "id": "prop.chest.reinforced.001",
      "kind": "prop",
      "transform": { "positionM": [1.1, 0, 1.45], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "chest.storage_strapped_01",
      "materialRefs": ["wood.weathered_oak", "metal.forged_iron"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.tavern_hall.001" }]
    },
    {
      "id": "decor.wall_painting.sun_mountain.001",
      "kind": "decor",
      "transform": { "positionM": [2.1, 2.05, -2.3], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "painting.sun_mountain_01",
      "materialRefs": ["cloth.painted_panel", "wood.dark_oak"],
      "relationships": [{ "type": "attached_to", "target": "arch.shell.tavern_hall.001" }]
    }
  ]
};

export const ManifestAlchemistLab = {
  "worldId": "alchemist_laboratory_v1",
  "version": 2,
  "units": "meter",
  "axis": { "handedness": "right", "up": "+Y", "east": "+X", "south": "+Z" },
  "entities": [
    {
      "id": "arch.shell.alchemist_lab.001",
      "kind": "architecture",
      "transform": { "positionM": [0, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "arch.alchemist_shell",
      "materialRefs": [
        "stone.rough_local",
        "wood.dark_oak",
        "glass.window",
        "skyline.cobblestone_alley"
      ],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "prop.bookshelf.grimoires.001",
      "kind": "prop",
      "transform": { "positionM": [-1.8, 0, -1.2], "rotationDeg": [0, 20, 0], "scale": [1, 1, 1] },
      "assetRef": "furniture.bookshelf",
      "materialRefs": ["wood.dark_oak"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.alchemist_lab.001" }]
    },
    {
      "id": "prop.cauldron.bubbling.001",
      "kind": "prop",
      "transform": { "positionM": [1.4, 0, -0.6], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "kitchen.cauldron",
      "materialRefs": ["metal.forged_iron", "ember"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.alchemist_lab.001" }]
    },
    {
      "id": "prop.table.alchemist_desk.001",
      "kind": "prop",
      "transform": { "positionM": [0, 0, 0.4], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "furniture.table",
      "materialRefs": ["wood.dark_oak", "ceramic.dish"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.alchemist_lab.001" }]
    },
    {
      "id": "prop.lantern.alchemical.001",
      "kind": "prop",
      "transform": { "positionM": [0.6, 0.82, 0.4], "rotationDeg": [0, 0, 0], "scale": [0.8, 0.8, 0.8] },
      "assetRef": "lighting.lantern",
      "materialRefs": ["metal.forged_iron", "ember"],
      "relationships": [{ "type": "supported_by", "target": "prop.table.alchemist_desk.001" }]
    },
    {
      "id": "prop.barrel.reagents.001",
      "kind": "prop",
      "transform": { "positionM": [1.8, 0, 1.2], "rotationDeg": [0, 45, 0], "scale": [1, 1, 1] },
      "assetRef": "storage.barrel",
      "materialRefs": ["wood.weathered_oak", "metal.forged_iron"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.alchemist_lab.001" }]
    }
  ]
};

export const ManifestDungeonArmory = {
  "worldId": "dungeon_armory_v1",
  "version": 2,
  "units": "meter",
  "axis": { "handedness": "right", "up": "+Y", "east": "+X", "south": "+Z" },
  "entities": [
    {
      "id": "arch.shell.dungeon_armory.001",
      "kind": "architecture",
      "transform": { "positionM": [0, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "arch.armory_shell",
      "materialRefs": [
        "stone.rough_local",
        "metal.forged_iron",
        "wood.weathered_oak",
        "skyline.stormy_bastion"
      ],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "prop.weapon_rack.swords.001",
      "kind": "prop",
      "transform": { "positionM": [-1.4, 0, -0.8], "rotationDeg": [0, 15, 0], "scale": [1, 1, 1] },
      "assetRef": "workshop.weapon_rack",
      "materialRefs": ["wood.dark_oak", "metal.forged_iron"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.dungeon_armory.001" }]
    },
    {
      "id": "prop.anvil.armory_repair.001",
      "kind": "prop",
      "transform": { "positionM": [0.2, 0, 0.2], "rotationDeg": [0, -30, 0], "scale": [1, 1, 1] },
      "assetRef": "anvil.forged_iron_01",
      "materialRefs": ["metal.forged_iron", "metal.polished_iron", "wood.dark_oak"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.dungeon_armory.001" }]
    },
    {
      "id": "prop.crate.armor_strapped.001",
      "kind": "prop",
      "transform": { "positionM": [1.5, 0, -0.4], "rotationDeg": [0, -10, 0], "scale": [1, 1, 1] },
      "assetRef": "storage.crate",
      "materialRefs": ["wood.weathered_oak", "metal.forged_iron"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.dungeon_armory.001" }]
    },
    {
      "id": "prop.chest.iron_strongbox.001",
      "kind": "prop",
      "transform": { "positionM": [1.4, 0, 0.8], "rotationDeg": [0, 25, 0], "scale": [1, 1, 1] },
      "assetRef": "chest.storage_strapped_01",
      "materialRefs": ["wood.weathered_oak", "metal.forged_iron"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.dungeon_armory.001" }]
    },
    {
      "id": "prop.lantern.patrol.001",
      "kind": "prop",
      "transform": { "positionM": [-0.6, 0, 1.2], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "lighting.lantern",
      "materialRefs": ["metal.forged_iron", "ember"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.dungeon_armory.001" }]
    }
  ]
};

export const ManifestHermitLibrary = {
  "worldId": "hermit_library_v1",
  "version": 1,
  "units": "meter",
  "axis": { "handedness": "right", "up": "+Y", "east": "+X", "south": "+Z" },
  "entities": [
    {
      "id": "arch.shell.hermit_library.001",
      "kind": "architecture",
      "transform": { "positionM": [0, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "arch.library_shell",
      "materialRefs": [
        "stone.rough_local",
        "wood.dark_oak",
        "glass.window",
        "skyline.misty_mountains"
      ],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "arch.fireplace.cozy.001",
      "kind": "architecture",
      "transform": { "positionM": [1.6, 0, -1.4], "rotationDeg": [0, -20, 0], "scale": [1, 1, 1] },
      "assetRef": "arch.hearth",
      "materialRefs": ["stone.rough_local", "ember"],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "prop.bookshelf.ancient.001",
      "kind": "prop",
      "transform": { "positionM": [-1.6, 0, -1.2], "rotationDeg": [0, 15, 0], "scale": [1, 1, 1] },
      "assetRef": "furniture.bookshelf",
      "materialRefs": ["wood.dark_oak"],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "prop.bookshelf.ancient.002",
      "kind": "prop",
      "transform": { "positionM": [-0.4, 0, -1.8], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "furniture.bookshelf",
      "materialRefs": ["wood.dark_oak"],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "prop.table.reading_desk.001",
      "kind": "prop",
      "transform": { "positionM": [0.2, 0, 0.2], "rotationDeg": [0, 10, 0], "scale": [0.9, 1, 0.85] },
      "assetRef": "furniture.table",
      "materialRefs": ["wood.dark_oak"],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "prop.bench.cushioned.001",
      "kind": "prop",
      "transform": { "positionM": [0.2, 0, 1.1], "rotationDeg": [0, 10, 0], "scale": [0.8, 1, 1] },
      "assetRef": "furniture.bench",
      "materialRefs": ["wood.dark_oak", "cloth.woven_cushion"],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "decor.rug.warm_starburst.001",
      "kind": "decor",
      "transform": { "positionM": [0.2, 0, 0.6], "rotationDeg": [0, 10, 0], "scale": [1, 1, 1] },
      "assetRef": "decor.woven_rug",
      "materialRefs": ["cloth.woven_rug"],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    }
  ]
};

export const ManifestTokyoNintendoOffice = {
  "worldId": "tokyo_nintendo_office_v2",
  "version": 4,
  "units": "meter",
  "axis": { "handedness": "right", "up": "+Y", "east": "+X", "south": "+Z" },
  "lighting": "dusk",
  "entities": [
    {
      "id": "arch.shell.tokyo_apartment.001",
      "kind": "architecture",
      "transform": { "positionM": [0, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "arch.tokyo_apartment_shell",
      "materialRefs": [
        "plaster.tokyo_wall",
        "wood.birch_light",
        "fabric.tatami",
        "fabric.tatami_border",
        "glass.window",
        "metal.matte_black",
        "skyline.tokyo_night",
        "ceramic.white"
      ],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "prop.desk.tokyo_birch.001",
      "kind": "furniture",
      "transform": { "positionM": [0, 0, -0.4], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "furniture.tokyo_desk",
      "materialRefs": ["wood.birch_light", "metal.matte_black"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.tokyo_apartment.001" }]
    },
    {
      "id": "prop.workstation.nintendo_rig.001",
      "kind": "prop",
      "transform": { "positionM": [0, 0, -0.4], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "prop.nintendo_rig",
      "materialRefs": [
        "screen.dev_glow",
        "screen.mario_glow",
        "metal.matte_black",
        "plastic.joycon_red",
        "plastic.joycon_blue",
        "ceramic.white"
      ],
      "relationships": [{ "type": "supported_by", "target": "prop.desk.tokyo_birch.001" }]
    },
    {
      "id": "prop.chair.ergonomic.001",
      "kind": "furniture",
      "transform": { "positionM": [0, 0, 0.42], "rotationDeg": [0, 180, 0], "scale": [1, 1, 1] },
      "assetRef": "furniture.ergonomic_chair",
      "materialRefs": ["fabric.tatami_border", "metal.matte_black"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.tokyo_apartment.001" }]
    },
    {
      "id": "prop.decor.bonsai.001",
      "kind": "decor",
      "transform": { "positionM": [-0.62, 0.75, -0.38], "rotationDeg": [0, 25, 0], "scale": [0.9, 0.9, 0.9] },
      "assetRef": "decor.bonsai",
      "materialRefs": ["ceramic.white", "plant.bonsai", "wood.dark_oak"],
      "relationships": [{ "type": "supported_by", "target": "prop.desk.tokyo_birch.001" }]
    },
    {
      "id": "prop.shelf.nintendo_games.001",
      "kind": "furniture",
      "transform": { "positionM": [-1.98, 1.45, -0.3], "rotationDeg": [0, 90, 0], "scale": [1, 1, 1] },
      "assetRef": "furniture.game_shelf",
      "materialRefs": ["wood.birch_light", "plastic.joycon_red"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.tokyo_apartment.001" }]
    },
    {
      "id": "decor.poster.zelda_triforce.001",
      "kind": "decor",
      "transform": { "positionM": [1.4, 1.45, -1.98], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "decor.nintendo_art",
      "materialRefs": ["decor.nintendo_art", "metal.matte_black"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.tokyo_apartment.001" }]
    }
  ]
};

export const ManifestWinterholdCollege = {
  "worldId": "skyrim_winterhold_college_v1",
  "version": 1,
  "units": "meter",
  "axis": { "handedness": "right", "up": "+Y", "east": "+X", "south": "+Z" },
  "lighting": "dusk",
  "entities": [
    {
      "id": "arch.shell.winterhold_hall.001",
      "kind": "architecture",
      "transform": { "positionM": [0, 0, 0], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "arch.winterhold_shell",
      "materialRefs": [
        "stone.winterhold_masonry",
        "stone.nordic_carved",
        "magic.arcane_rune",
        "banner.winterhold",
        "metal.forged_iron",
        "skyline.winterhold_aurora",
        "magic.witchlight_blue",
        "ice.glacial"
      ],
      "relationships": [{ "type": "supported_by", "target": "ground.stone" }]
    },
    {
      "id": "prop.altar.arcane_enchanter.001",
      "kind": "workshop",
      "transform": { "positionM": [-1.35, 0, -0.6], "rotationDeg": [0, 25, 0], "scale": [1, 1, 1] },
      "assetRef": "workshop.arcane_enchanter",
      "materialRefs": [
        "stone.winterhold_masonry",
        "stone.nordic_carved",
        "crystal.soul_gem",
        "crystal.soul_gem_cyan",
        "metal.forged_iron",
        "metal.brass_gold",
        "magic.witchlight_blue",
        "book.grimoire_page"
      ],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.winterhold_hall.001" }]
    },
    {
      "id": "furniture.bookshelf.arcanaeum.001",
      "kind": "storage",
      "transform": { "positionM": [-1.95, 0, 0.9], "rotationDeg": [0, 90, 0], "scale": [1, 1, 1] },
      "assetRef": "storage.arcanaeum_bookshelf",
      "materialRefs": [
        "wood.dark_oak",
        "metal.forged_iron",
        "leather.spellbook_navy",
        "leather.spellbook_crimson",
        "book.grimoire_page"
      ],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.winterhold_hall.001" }]
    },
    {
      "id": "prop.device.armillary_orrery.001",
      "kind": "prop",
      "transform": { "positionM": [1.4, 0, -0.5], "rotationDeg": [0, -20, 0], "scale": [1, 1, 1] },
      "assetRef": "prop.armillary_sphere",
      "materialRefs": [
        "stone.nordic_carved",
        "metal.brass_gold",
        "crystal.soul_gem_cyan"
      ],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.winterhold_hall.001" }]
    },
    {
      "id": "prop.lectern.spell_tome.001",
      "kind": "prop",
      "transform": { "positionM": [1.2, 0, 0.9], "rotationDeg": [0, -45, 0], "scale": [1, 1, 1] },
      "assetRef": "prop.spell_lectern",
      "materialRefs": [
        "stone.nordic_carved",
        "metal.brass_gold",
        "leather.spellbook_navy",
        "book.grimoire_page",
        "crystal.soul_gem_cyan"
      ],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.winterhold_hall.001" }]
    },
    {
      "id": "lighting.brazier.witchlight.001",
      "kind": "lighting",
      "transform": { "positionM": [0, 0, 1.8], "rotationDeg": [0, 0, 0], "scale": [1, 1, 1] },
      "assetRef": "lighting.winterhold_brazier",
      "materialRefs": ["metal.forged_iron", "magic.witchlight_blue"],
      "relationships": [{ "type": "supported_by", "target": "arch.shell.winterhold_hall.001" }]
    }
  ]
};


