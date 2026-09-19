import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SpatialValidator } from './SpatialValidator.js';
import { UniversalFoundry } from './UniversalFoundry.js';

/**
 * WORLD COMPILER (World Compass v2)
 * The authoritative bridge between declarative semantic World Manifests and the Three.js scene graph.
 * "The LLM edits the WORLD; the compiler decides how to RENDER it."
 */
export class WorldCompiler {
  constructor(materialFoundry) {
    this.materials = materialFoundry;
    this.validator = new SpatialValidator(materialFoundry);
    this.foundry = new UniversalFoundry(materialFoundry);
  }

  compile(worldManifest) {
    const validation = this.validator.validateWorld(worldManifest);
    if (!validation.valid) {
      throw new Error(`Spatial compilation rejected:\n` + validation.errors.join('\n'));
    }

    const worldGroup = new THREE.Group();
    worldGroup.name = worldManifest.worldId || 'compiled_world';

    // Compile entities
    for (const entity of worldManifest.entities) {
      const entityGroup = this.compileEntity(entity);
      worldGroup.add(entityGroup);
    }

    // Studio contact shadow catcher (completely invisible plane, only catches soft realistic shadows)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ opacity: 0.4 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    worldGroup.add(ground);

    return {
      group: worldGroup,
      validation: validation,
      entityCount: worldManifest.entities.length
    };
  }

  compileEntity(entity) {
    const group = new THREE.Group();
    group.name = entity.id;

    // Apply authored transform
    const pos = entity.transform?.positionM || [0, 0, 0];
    const rot = entity.transform?.rotationDeg || [0, 0, 0];
    const scale = entity.transform?.scale || [1, 1, 1];

    group.position.set(pos[0], pos[1], pos[2]);
    group.rotation.set(
      THREE.MathUtils.degToRad(rot[0]),
      THREE.MathUtils.degToRad(rot[1]),
      THREE.MathUtils.degToRad(rot[2])
    );
    group.scale.set(scale[0], scale[1], scale[2]);

    const getMat = (index = 0, defaultMat = 'wood.dark_oak') => {
      const ref = entity.materialRefs?.[index] || defaultMat;
      return this.materials.get(ref);
    };

    const ref = (entity.assetRef || entity.id).toLowerCase();

    // Route to Universal Foundry by semantic archetype (Specific archetypes FIRST)
    if (ref.includes('winterhold_shell') || ref.includes('winterhold_room') || ref.includes('mage_quarters') || ref.includes('arcanaeum_hall')) {
      this.foundry.buildWinterholdShell(
        group,
        getMat(0, 'stone.winterhold_masonry'),
        getMat(1, 'stone.nordic_carved'),
        getMat(2, 'magic.arcane_rune'),
        getMat(3, 'banner.winterhold'),
        getMat(4, 'metal.forged_iron'),
        getMat(5, 'skyline.winterhold_aurora'),
        getMat(6, 'magic.witchlight_blue'),
        getMat(7, 'ice.glacial')
      );
    } else if (ref.includes('library_shell') || ref.includes('scriptorium_shell') || ref.includes('monastery_shell')) {
      this.foundry.buildLibraryShell(
        group,
        getMat(0, 'stone.rough_local'),
        getMat(1, 'wood.dark_oak'),
        getMat(2, 'glass.window'),
        getMat(3, 'skyline.misty_mountains')
      );
    } else if (ref.includes('alchemist_shell') || ref.includes('laboratory_shell')) {
      this.foundry.buildAlchemistShell(
        group,
        getMat(0, 'stone.rough_local'),
        getMat(1, 'wood.dark_oak'),
        getMat(2, 'glass.window'),
        getMat(3, 'skyline.cobblestone_alley')
      );
    } else if (ref.includes('armory_shell') || ref.includes('dungeon_shell') || ref.includes('garrison_shell')) {
      this.foundry.buildArmoryShell(
        group,
        getMat(0, 'stone.rough_local'),
        getMat(1, 'metal.forged_iron'),
        getMat(2, 'wood.weathered_oak'),
        getMat(3, 'skyline.stormy_bastion')
      );
    } else if (ref.includes('forge_pavilion') || ref.includes('blacksmith_shell') || ref.includes('forge_shell')) {
      this.foundry.buildForgePavilionShell(
        group,
        getMat(0, 'stone.rough_local'),
        getMat(1, 'wood.dark_oak'),
        getMat(2, 'skyline.twilight_valley')
      );
    } else if (ref.includes('tavern_hall') || ref.includes('tavern_shell') || ref.includes('medieval_house_shell')) {
      this.foundry.buildTavernHallShell(
        group,
        getMat(0, 'plaster.lime_warm'),
        getMat(1, 'wood.dark_oak'),
        getMat(2, 'stone.rough_local'),
        getMat(3, 'glass.window'),
        getMat(4, 'skyline.village_sunset')
      );
    } else if (ref.includes('arcane_enchanter') || ref.includes('enchanter') || ref.includes('enchanting_table')) {
      this.foundry.buildArcaneEnchanter(
        group,
        getMat(0, 'stone.winterhold_masonry'),
        getMat(1, 'stone.nordic_carved'),
        getMat(2, 'crystal.soul_gem'),
        getMat(3, 'crystal.soul_gem_cyan'),
        getMat(4, 'metal.forged_iron'),
        getMat(5, 'metal.brass_gold'),
        getMat(6, 'magic.witchlight_blue'),
        getMat(7, 'book.grimoire_page'),
        getMat(8, 'bone.weathered_ivory'),
        getMat(9, 'bone.horn_dark'),
        getMat(10, 'wax.candle'),
        getMat(11, 'ember')
      );
    } else if (ref.includes('arcanaeum_bookshelf') || ref.includes('mage_bookshelf') || ref.includes('grimoire_shelf')) {
      this.foundry.buildArcanaeumBookshelf(
        group,
        getMat(0, 'wood.dark_oak'),
        getMat(1, 'metal.forged_iron'),
        getMat(2, 'leather.spellbook_navy'),
        getMat(3, 'leather.spellbook_crimson'),
        getMat(4, 'book.grimoire_page')
      );
    } else if (ref.includes('armillary') || ref.includes('orrery') || ref.includes('astrolabe')) {
      this.foundry.buildArmillarySphere(
        group,
        getMat(0, 'stone.nordic_carved'),
        getMat(1, 'metal.brass_gold'),
        getMat(2, 'crystal.soul_gem_cyan')
      );
    } else if (ref.includes('winterhold_brazier') || ref.includes('witchlight_brazier')) {
      this.foundry.buildWinterholdBrazier(
        group,
        getMat(0, 'metal.forged_iron'),
        getMat(1, 'magic.witchlight_blue'),
        getMat(2, 'magic.witchlight_coals')
      );
    } else if (ref.includes('spell_lectern') || ref.includes('grimoire_stand') || ref.includes('pedestal_tome')) {
      this.foundry.buildSpellLectern(
        group,
        getMat(0, 'stone.nordic_carved'),
        getMat(1, 'metal.brass_gold'),
        getMat(2, 'leather.spellbook_navy'),
        getMat(3, 'book.grimoire_page'),
        getMat(4, 'crystal.soul_gem_cyan')
      );
    } else if (ref.includes('apartment_shell') || ref.includes('tokyo_room') || ref.includes('tokyo_walls')) {
      this.foundry.buildTokyoApartmentShell(
        group,
        getMat(0, 'plaster.tokyo_wall'),
        getMat(1, 'wood.birch_light'),
        getMat(2, 'fabric.tatami'),
        getMat(3, 'fabric.tatami_border'),
        getMat(4, 'glass.window'),
        getMat(5, 'metal.matte_black'),
        getMat(6, 'skyline.tokyo_night'),
        getMat(7, 'ceramic.white')
      );
    } else if (ref.includes('tatami')) {
      this.foundry.buildTatamiFloor(group, getMat(0, 'fabric.tatami'), getMat(1, 'fabric.tatami_border'));
    } else if (ref.includes('tokyo_window') || ref.includes('balcony_window') || ref.includes('city_window')) {
      this.foundry.buildTokyoBalconyWindow(group, getMat(0, 'metal.matte_black'), getMat(1, 'glass.window'), getMat(2, 'skyline.tokyo_night'));
    } else if (ref.includes('tokyo_walls') || ref.includes('apartment_walls')) {
      this.foundry.buildTokyoApartmentWalls(group, getMat(0, 'plaster.lime_warm'), getMat(1, 'wood.birch_light'), getMat(2, 'ceramic.white'));
    } else if (ref.includes('tokyo_desk') || ref.includes('nintendo_desk') || ref.includes('birch_desk')) {
      this.foundry.buildTokyoDesk(group, getMat(0, 'wood.birch_light'), getMat(1, 'metal.matte_black'));
    } else if (ref.includes('nintendo_rig') || ref.includes('computer') || ref.includes('workstation')) {
      this.foundry.buildNintendoRig(
        group,
        getMat(0, 'screen.dev_glow'),
        getMat(1, 'screen.mario_glow'),
        getMat(2, 'metal.matte_black'),
        getMat(3, 'plastic.joycon_red'),
        getMat(4, 'plastic.joycon_blue'),
        getMat(5, 'ceramic.white')
      );
    } else if (ref.includes('office_chair') || ref.includes('ergonomic_chair') || ref.includes('task_chair')) {
      this.foundry.buildErgonomicChair(group, getMat(0, 'fabric.tatami_border'), getMat(1, 'metal.matte_black'));
    } else if (ref.includes('shoji') || ref.includes('japanese_window')) {
      this.foundry.buildShojiWindow(group, getMat(0, 'wood.birch_light'), getMat(1, 'paper.shoji'));
    } else if (ref.includes('bonsai')) {
      this.foundry.buildBonsai(group, getMat(0, 'ceramic.white'), getMat(1, 'plant.bonsai'), getMat(2, 'wood.dark_oak'));
    } else if (ref.includes('game_shelf') || ref.includes('nintendo_shelf')) {
      this.foundry.buildGameShelf(group, getMat(0, 'wood.birch_light'), getMat(1, 'plastic.joycon_red'));
    } else if (ref.includes('painting') || ref.includes('nintendo_art') || ref.includes('poster')) {
      const isNintendo = ref.includes('nintendo') || ref.includes('poster');
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.05, 0.04), getMat(1, isNintendo ? 'metal.matte_black' : 'wood.dark_oak'));
      frame.castShadow = true;
      group.add(frame);
      const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.98), getMat(0, isNintendo ? 'decor.nintendo_art' : 'cloth.painted_panel'));
      canvas.position.z = 0.025;
      group.add(canvas);
    } else if (ref.includes('chimney') || ref.includes('forge_hearth')) {
      this.foundry.buildHearth(group, getMat(0, 'stone.hearth'), getMat(1, 'plaster.lime_warm'), getMat(2, 'ember'));
    } else if (ref.includes('fireplace') || ref.includes('hearth')) {
      this.foundry.buildFireplace(group, getMat(0, 'stone.hearth'), getMat(1, 'ember'));
    } else if (ref.includes('anvil')) {
      this.foundry.buildAnvil(group, getMat(0, 'metal.forged_iron'), getMat(1, 'metal.polished_iron'), getMat(2, 'wood.weathered_oak'));
    } else if (ref.includes('bellows')) {
      this.foundry.buildBellows(group, getMat(0, 'wood.dark_oak'), getMat(1, 'leather.worn'), getMat(2, 'metal.forged_iron'));
    } else if (ref.includes('bookshelf') || ref.includes('library')) {
      this.foundry.buildBookshelf(group, getMat(0, 'wood.dark_oak'));
    } else if (ref.includes('weapon_rack') || ref.includes('armory')) {
      this.foundry.buildWeaponRack(group, getMat(0, 'wood.dark_oak'), getMat(1, 'metal.forged_iron'));
    } else if (ref.includes('cauldron') || ref.includes('pot')) {
      this.foundry.buildCauldron(group, getMat(0, 'metal.forged_iron'), getMat(1, 'ember'));
    } else if (ref.includes('table') || ref.includes('desk')) {
      this.foundry.buildTable(group, getMat(0, 'wood.dark_oak'), getMat(1, 'ceramic.dish'));
    } else if (ref.includes('chest')) {
      this.foundry.buildChest(group, getMat(0, 'wood.weathered_oak'), getMat(1, 'metal.forged_iron'));
    } else if (ref.includes('barrel')) {
      this.foundry.buildBarrel(group, getMat(0, 'wood.weathered_oak'), getMat(1, 'metal.forged_iron'));
    } else if (ref.includes('crate')) {
      this.foundry.buildCrate(group, getMat(0, 'wood.weathered_oak'), getMat(1, 'metal.forged_iron'));
    } else if (ref.includes('lantern')) {
      this.foundry.buildLantern(group, getMat(0, 'metal.forged_iron'), getMat(1, 'ember'));
    } else if (ref.includes('bench')) {
      this.foundry.buildBench(group, getMat(0, 'wood.dark_oak'), getMat(1, 'cloth.woven_cushion'));
    } else if (ref.includes('floor')) {
      this.foundry.buildFloor(group, getMat(0, 'wood.floor_oak'));
    } else if (ref.includes('wall')) {
      this.foundry.buildWall(group, getMat(0, 'plaster.lime_warm'), getMat(1, 'wood.dark_oak'));
    } else if (ref.includes('rug')) {
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), getMat(0, 'cloth.woven_rug'));
      rug.rotation.x = -Math.PI / 2;
      rug.position.y = 0.01;
      rug.receiveShadow = true;
      group.add(rug);
    } else if (entity.kind === 'room') {
      // Room root
    } else {
      // Parametric chamfered artisan block
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), getMat(0));
      mesh.position.y = 0.25;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    return this.optimizeEntityGroup(group);
  }

  /**
   * Automated Material-Batching Compounding Pass
   * Consolidates all static sub-meshes sharing identical materials within an entity into single draw calls.
   * Preserves InstancedMeshes, PointLights, hierarchy, and entity boundaries.
   */
  optimizeEntityGroup(entityGroup) {
    if (!entityGroup || !entityGroup.children || entityGroup.children.length === 0) {
      return entityGroup;
    }

    // Force matrix update so all nested sub-meshes have accurate local-to-world transforms
    entityGroup.updateMatrixWorld(true);
    const invEntityMatrix = entityGroup.matrixWorld.clone().invert();

    const meshMap = new Map();
    const toRemove = [];

    entityGroup.traverse(child => {
      // Only batch standard THREE.Mesh objects — skip InstancedMesh, SkinnedMesh, Lights, Cameras
      if (child.isMesh && !child.isInstancedMesh && !child.isSkinnedMesh && child.geometry) {
        toRemove.push(child);
        const mat = child.material;
        if (!meshMap.has(mat)) {
          meshMap.set(mat, []);
        }

        // Compute transform relative to entityGroup
        const relativeMatrix = child.matrixWorld.clone().premultiply(invEntityMatrix);
        let geo = child.geometry.clone();
        if (geo.index) geo = geo.toNonIndexed();
        if (!geo.attributes.normal) geo.computeVertexNormals();
        if (!geo.attributes.uv) {
          geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
        }
        geo.applyMatrix4(relativeMatrix);

        meshMap.get(mat).push({
          geo,
          castShadow: child.castShadow,
          receiveShadow: child.receiveShadow
        });
      }
    });

    // If there is 1 or fewer standard meshes, no batching needed
    if (toRemove.length <= 1) return entityGroup;

    // Remove old loose meshes from their respective parents
    for (const mesh of toRemove) {
      if (mesh.parent) mesh.parent.remove(mesh);
    }

    // Add consolidated merged meshes per material directly to entityGroup
    for (const [mat, items] of meshMap.entries()) {
      const geos = items.map(i => i.geo);
      const merged = BufferGeometryUtils.mergeGeometries(geos, false);
      if (merged) {
        const mergedMesh = new THREE.Mesh(merged, mat);
        mergedMesh.castShadow = items.some(i => i.castShadow);
        mergedMesh.receiveShadow = items.some(i => i.receiveShadow);
        entityGroup.add(mergedMesh);
      }
    }

    return entityGroup;
  }
}
