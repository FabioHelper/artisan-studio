import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SpatialValidator } from './SpatialValidator.js';
import { UniversalFoundry } from './UniversalFoundry.js';
import { isKnownArchetype } from '../contracts/artisanContract.js';

// Exact archetype -> builder routes (SPEC-07 P0.1). Keys equal ARCHETYPE_CATALOG ids exactly (no
// substring matching). `route` is this table's own label only; scripts/check_contract_drift.mjs spies
// on the builders, executes every route, and compares the builder that actually ran against the
// independent ARCHETYPE_EXPECTED_ROUTES oracle in the contract (SOL-FIX-1), never against this label.
const ARCHETYPE_ROUTES = {
  'mtx.fixture.hardline_booth': { route: 'buildHardlineBooth', build(g, m) { this.foundry.buildHardlineBooth(g, m(0, 'mtx.neutral.black_lacquer'), m(1, 'mtx.glass.cyan'), m(2, 'mtx.signal.green_code')); } },
  'mtx.plaza.floor_field': { route: 'buildMtxFloorField', build(g, m) { this.foundry.buildMtxFloorField(g, m(0, 'mtx.neutral.stone'), m(1, 'mtx.neutral.black_lacquer')); } },
  'mtx.plaza.arrival_circle': { route: 'buildMtxArrivalCircle', build(g, m) { this.foundry.buildMtxArrivalCircle(g, m(0, 'mtx.neutral.stone'), m(1, 'mtx.construct.white'), m(2, 'mtx.glass.cyan')); } },
  'mtx.surface.code_wall': { route: 'buildMtxCodeWall', build(g, m) { this.foundry.buildMtxCodeWall(g, m(0, 'mtx.neutral.black_lacquer'), m(1, 'mtx.signal.green_code')); } },
  'mtx.edge.glass_rail': { route: 'buildMtxGlassRail', build(g, m) { this.foundry.buildMtxGlassRail(g, m(0, 'mtx.metal.brushed_dark'), m(1, 'mtx.glass.cyan')); } },
  'mtx.actor.hero_avatar': { route: 'buildMtxHeroAvatar', build(g, m) { this.foundry.buildMtxHeroAvatar(g, m(0, 'mtx.neutral.black_lacquer'), m(1, 'mtx.metal.brushed_dark'), m(2, 'mtx.neutral.stone'), m(3, 'mtx.glass.cyan')); } },
  'mtx.actor.crowd_figure': { route: 'buildMtxCrowdFigure', build(g, m) { this.foundry.buildMtxCrowdFigure(g, m(0, 'mtx.neutral.black_lacquer'), m(1, 'mtx.metal.brushed_dark'), m(2, 'mtx.neutral.stone')); } },
  'mtx.construct.white_floor': { route: 'buildMtxConstructFloor', build(g, m) { this.foundry.buildMtxConstructFloor(g, m(0, 'mtx.construct.white'), m(1, 'mtx.neutral.stone')); } },
  'mtx.construct.artifact_plinth': { route: 'buildMtxArtifactPlinth', build(g, m) { this.foundry.buildMtxArtifactPlinth(g, m(0, 'mtx.construct.white'), m(1, 'mtx.signal.green_code')); } },
  'arch.winterhold_shell': { route: 'buildWinterholdShell', build(g, m) { this.foundry.buildWinterholdShell(g, m(0, 'stone.winterhold_masonry'), m(1, 'stone.nordic_carved'), m(2, 'magic.arcane_rune'), m(3, 'banner.winterhold'), m(4, 'metal.forged_iron'), m(5, 'skyline.winterhold_aurora'), m(6, 'magic.witchlight_blue'), m(7, 'ice.glacial')); } },
  'arch.library_shell': { route: 'buildLibraryShell', build(g, m) { this.foundry.buildLibraryShell(g, m(0, 'stone.rough_local'), m(1, 'wood.dark_oak'), m(2, 'glass.window'), m(3, 'skyline.misty_mountains')); } },
  'arch.alchemist_shell': { route: 'buildAlchemistShell', build(g, m) { this.foundry.buildAlchemistShell(g, m(0, 'stone.rough_local'), m(1, 'wood.dark_oak'), m(2, 'glass.window'), m(3, 'skyline.cobblestone_alley')); } },
  'arch.armory_shell': { route: 'buildArmoryShell', build(g, m) { this.foundry.buildArmoryShell(g, m(0, 'stone.rough_local'), m(1, 'metal.forged_iron'), m(2, 'wood.weathered_oak'), m(3, 'skyline.stormy_bastion')); } },
  'arch.forge_pavilion': { route: 'buildForgePavilionShell', build(g, m) { this.foundry.buildForgePavilionShell(g, m(0, 'stone.rough_local'), m(1, 'wood.dark_oak'), m(2, 'skyline.twilight_valley')); } },
  'arch.tavern_hall': { route: 'buildTavernHallShell', build(g, m) { this.foundry.buildTavernHallShell(g, m(0, 'plaster.lime_warm'), m(1, 'wood.dark_oak'), m(2, 'stone.rough_local'), m(3, 'glass.window'), m(4, 'skyline.village_sunset')); } },
  'workshop.arcane_enchanter': { route: 'buildArcaneEnchanter', build(g, m) { this.foundry.buildArcaneEnchanter(g, m(0, 'stone.winterhold_masonry'), m(1, 'stone.nordic_carved'), m(2, 'crystal.soul_gem'), m(3, 'crystal.soul_gem_cyan'), m(4, 'metal.forged_iron'), m(5, 'metal.brass_gold'), m(6, 'magic.witchlight_blue'), m(7, 'book.grimoire_page'), m(8, 'bone.weathered_ivory'), m(9, 'bone.horn_dark'), m(10, 'wax.candle'), m(11, 'ember')); } },
  'storage.arcanaeum_bookshelf': { route: 'buildArcanaeumBookshelf', build(g, m) { this.foundry.buildArcanaeumBookshelf(g, m(0, 'wood.dark_oak'), m(1, 'metal.forged_iron'), m(2, 'leather.spellbook_navy'), m(3, 'leather.spellbook_crimson'), m(4, 'book.grimoire_page')); } },
  'prop.armillary_sphere': { route: 'buildArmillarySphere', build(g, m) { this.foundry.buildArmillarySphere(g, m(0, 'stone.nordic_carved'), m(1, 'metal.brass_gold'), m(2, 'crystal.soul_gem_cyan')); } },
  'lighting.winterhold_brazier': { route: 'buildWinterholdBrazier', build(g, m) { this.foundry.buildWinterholdBrazier(g, m(0, 'metal.forged_iron'), m(1, 'magic.witchlight_blue'), m(2, 'magic.witchlight_coals')); } },
  'prop.spell_lectern': { route: 'buildSpellLectern', build(g, m) { this.foundry.buildSpellLectern(g, m(0, 'stone.nordic_carved'), m(1, 'metal.brass_gold'), m(2, 'leather.spellbook_navy'), m(3, 'book.grimoire_page'), m(4, 'crystal.soul_gem_cyan')); } },
  'arch.tokyo_apartment_shell': { route: 'buildTokyoApartmentShell', build(g, m) { buildTokyoShell.call(this, g, m); } },
  // UniversalFoundry has no walls-only builder; the walls ship inside the apartment shell, which is
  // what this id rendered as before SPEC-07. A walls-only foundry builder is a P1 item.
  'arch.tokyo_walls': { route: 'buildTokyoApartmentShell', build(g, m) { buildTokyoShell.call(this, g, m); } },
  'arch.tatami_floor': { route: 'buildTatamiFloor', build(g, m) { this.foundry.buildTatamiFloor(g, m(0, 'fabric.tatami'), m(1, 'fabric.tatami_border')); } },
  // UniversalFoundry never had buildTokyoBalconyWindow (the pre-SPEC-07 route threw a TypeError);
  // the compound is built here until P1 moves it into the foundry.
  'arch.balcony_window': { route: 'compileBalconyWindow', build(g, m) { INLINE_BUILDERS.compileBalconyWindow(g, m(0, 'metal.matte_black'), m(1, 'glass.window'), m(2, 'skyline.tokyo_night')); } },
  'furniture.tokyo_desk': { route: 'buildTokyoDesk', build(g, m) { this.foundry.buildTokyoDesk(g, m(0, 'wood.birch_light'), m(1, 'metal.matte_black')); } },
  'prop.nintendo_rig': { route: 'buildNintendoRig', build(g, m) { this.foundry.buildNintendoRig(g, m(0, 'screen.dev_glow'), m(1, 'screen.mario_glow'), m(2, 'metal.matte_black'), m(3, 'plastic.joycon_red'), m(4, 'plastic.joycon_blue'), m(5, 'ceramic.white')); } },
  'furniture.ergonomic_chair': { route: 'buildErgonomicChair', build(g, m) { this.foundry.buildErgonomicChair(g, m(0, 'fabric.tatami_border'), m(1, 'metal.matte_black')); } },
  'arch.shoji_window': { route: 'buildShojiWindow', build(g, m) { this.foundry.buildShojiWindow(g, m(0, 'wood.birch_light'), m(1, 'paper.shoji')); } },
  'decor.bonsai': { route: 'buildBonsai', build(g, m) { this.foundry.buildBonsai(g, m(0, 'ceramic.white'), m(1, 'plant.bonsai'), m(2, 'wood.dark_oak')); } },
  'furniture.game_shelf': { route: 'buildGameShelf', build(g, m) { this.foundry.buildGameShelf(g, m(0, 'wood.birch_light'), m(1, 'plastic.joycon_red')); } },
  'painting.sun_mountain_01': { route: 'compileFramedPanel', build(g, m) { INLINE_BUILDERS.compileFramedPanel(g, m(1, 'wood.dark_oak'), m(0, 'cloth.painted_panel')); } },
  'decor.nintendo_art': { route: 'compileFramedPanel', build(g, m) { INLINE_BUILDERS.compileFramedPanel(g, m(1, 'metal.matte_black'), m(0, 'decor.nintendo_art')); } },
  'forge.stone_chimney_family': { route: 'buildHearth', build(g, m) { this.foundry.buildHearth(g, m(0, 'stone.hearth'), m(1, 'plaster.lime_warm'), m(2, 'ember')); } },
  'arch.fireplace': { route: 'buildFireplace', build(g, m) { this.foundry.buildFireplace(g, m(0, 'stone.hearth'), m(1, 'ember')); } },
  'arch.hearth': { route: 'buildFireplace', build(g, m) { this.foundry.buildFireplace(g, m(0, 'stone.hearth'), m(1, 'ember')); } },
  'hearth.stone_family': { route: 'buildFireplace', build(g, m) { this.foundry.buildFireplace(g, m(0, 'stone.hearth'), m(1, 'ember')); } },
  'anvil.forged_iron_01': { route: 'buildAnvil', build(g, m) { this.foundry.buildAnvil(g, m(0, 'metal.forged_iron'), m(1, 'metal.polished_iron'), m(2, 'wood.weathered_oak')); } },
  'bellows.leather_iron_01': { route: 'buildBellows', build(g, m) { this.foundry.buildBellows(g, m(0, 'wood.dark_oak'), m(1, 'leather.worn'), m(2, 'metal.forged_iron')); } },
  'furniture.bookshelf': { route: 'buildBookshelf', build(g, m) { this.foundry.buildBookshelf(g, m(0, 'wood.dark_oak')); } },
  'workshop.weapon_rack': { route: 'buildWeaponRack', build(g, m) { this.foundry.buildWeaponRack(g, m(0, 'wood.dark_oak'), m(1, 'metal.forged_iron')); } },
  'kitchen.cauldron': { route: 'buildCauldron', build(g, m) { this.foundry.buildCauldron(g, m(0, 'metal.forged_iron'), m(1, 'ember')); } },
  'furniture.table': { route: 'buildTable', build(g, m) { this.foundry.buildTable(g, m(0, 'wood.dark_oak'), m(1, 'ceramic.dish')); } },
  'table.domestic_oak_01': { route: 'buildTable', build(g, m) { this.foundry.buildTable(g, m(0, 'wood.dark_oak'), m(1, 'ceramic.dish')); } },
  'furniture.desk': { route: 'buildTable', build(g, m) { this.foundry.buildTable(g, m(0, 'wood.dark_oak'), m(1, 'ceramic.dish')); } },
  'storage.chest': { route: 'buildChest', build(g, m) { this.foundry.buildChest(g, m(0, 'wood.weathered_oak'), m(1, 'metal.forged_iron')); } },
  'chest.storage_strapped_01': { route: 'buildChest', build(g, m) { this.foundry.buildChest(g, m(0, 'wood.weathered_oak'), m(1, 'metal.forged_iron')); } },
  'storage.barrel': { route: 'buildBarrel', build(g, m) { this.foundry.buildBarrel(g, m(0, 'wood.weathered_oak'), m(1, 'metal.forged_iron')); } },
  'storage.crate': { route: 'buildCrate', build(g, m) { this.foundry.buildCrate(g, m(0, 'wood.weathered_oak'), m(1, 'metal.forged_iron')); } },
  'lighting.lantern': { route: 'buildLantern', build(g, m) { this.foundry.buildLantern(g, m(0, 'metal.forged_iron'), m(1, 'ember')); } },
  'furniture.bench': { route: 'buildBench', build(g, m) { this.foundry.buildBench(g, m(0, 'wood.dark_oak'), m(1, 'cloth.woven_cushion')); } },
  'arch.floor': { route: 'buildFloor', build(g, m) { this.foundry.buildFloor(g, m(0, 'wood.floor_oak')); } },
  'arch.wall': { route: 'buildWall', build(g, m) { this.foundry.buildWall(g, m(0, 'plaster.lime_warm'), m(1, 'wood.dark_oak')); } },
  'decor.woven_rug': { route: 'compileRug', build(g, m) { INLINE_BUILDERS.compileRug(g, m(0, 'cloth.woven_rug')); } }
};

// Inline compounds are called through this object (not directly) so the drift check can observe
// which inline builder actually ran, exactly as it does for UniversalFoundry build* methods.
const INLINE_BUILDERS = { compileBalconyWindow, compileFramedPanel, compileRug };

function buildTokyoShell(g, m) {
  this.foundry.buildTokyoApartmentShell(g, m(0, 'plaster.tokyo_wall'), m(1, 'wood.birch_light'), m(2, 'fabric.tatami'), m(3, 'fabric.tatami_border'), m(4, 'glass.window'), m(5, 'metal.matte_black'), m(6, 'skyline.tokyo_night'), m(7, 'ceramic.white'));
}

function compileFramedPanel(group, frameMat, canvasMat) {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.05, 0.04), frameMat);
  frame.castShadow = true;
  group.add(frame);
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.98), canvasMat);
  canvas.position.z = 0.025;
  group.add(canvas);
}

function compileRug(group, rugMat) {
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.01;
  rug.receiveShadow = true;
  group.add(rug);
}

/**
 * Tokyo floor-to-ceiling balcony slider (catalog footprint 3.2 x 2.4 x 0.08 m, origin at floor centre).
 * Macro: aluminium frame + two overlapping sliding panes. Meso: meeting stiles, floor track, balcony
 * railing with balusters. Backdrop: night skyline card behind the railing. Merges to 3 draws (frame, glass, skyline).
 */
function compileBalconyWindow(group, frameMat, glassMat, skylineMat) {
  const W = 3.2, H = 2.4, F = 0.07;
  const box = (w, h, d, mat, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mat === frameMat;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  // Outer frame and floor track
  box(W, F, 0.08, frameMat, 0, H - F / 2, 0);
  box(W, 0.03, 0.16, frameMat, 0, 0.015, 0);
  box(F, H, 0.08, frameMat, -W / 2 + F / 2, H / 2, 0);
  box(F, H, 0.08, frameMat, W / 2 - F / 2, H / 2, 0);
  // Two sliding panes on offset tracks, overlapping at the centre meeting stiles
  const paneW = (W - 2 * F) / 2 + 0.03, paneH = H - F - 0.03;
  for (const side of [-1, 1]) {
    const x = side * (paneW / 2 - 0.015), z = side * 0.018;
    box(paneW - 0.06, paneH - 0.06, 0.008, glassMat, x, 0.03 + paneH / 2, z);
    box(0.04, paneH, 0.03, frameMat, x - side * (paneW / 2 - 0.02), 0.03 + paneH / 2, z);
    box(paneW, 0.035, 0.03, frameMat, x, 0.03 + paneH - 0.0175, z);
    box(paneW, 0.05, 0.03, frameMat, x, 0.055, z);
  }
  // Balcony railing outside the glass
  const railZ = -0.42;
  box(W, 0.04, 0.05, frameMat, 0, 1.05, railZ);
  box(W, 0.03, 0.04, frameMat, 0, 0.12, railZ);
  for (let i = 0; i <= 12; i++) box(0.018, 0.93, 0.018, frameMat, -W / 2 + 0.05 + i * ((W - 0.1) / 12), 0.585, railZ);
  // Night skyline card
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, H + 0.2), skylineMat);
  sky.position.set(0, H / 2, -0.75);
  group.add(sky);
}

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
    this.routes = ARCHETYPE_ROUTES;
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
    // Exact catalog guard BEFORE any routing: unknown or near-match ids (unknown.table,
    // totally.alchemist_shell.fake, primitive.box) never reach a builder or a raw primitive.
    const isRoomRoot = entity.kind === 'room' && entity.assetRef === undefined;
    if (!isRoomRoot && !isKnownArchetype(entity.assetRef)) {
      throw new Error(`Unknown archetype "${entity.assetRef}" for entity "${entity.id}" has no procedural builder.`);
    }

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

    if (isRoomRoot) return group; // Room root: pure grouping node

    const getMat = (index = 0, defaultMat = 'wood.dark_oak') => {
      const ref = entity.materialRefs?.[index] || defaultMat;
      return this.materials.get(ref);
    };

    const route = Object.prototype.hasOwnProperty.call(this.routes, entity.assetRef) ? this.routes[entity.assetRef] : null;
    if (!route) {
      // Non-reduction invariant: a catalog id without an exact route is a contract defect, never a primitive.
      throw new Error(`Archetype "${entity.assetRef}" is in the catalog but has no exact compiler route.`);
    }
    route.build.call(this, group, getMat);
    return this.optimizeEntityGroup(group);
  }

  /** Name of the exact builder route for an archetype id (null when unknown/unroutable). */
  static routeFor(assetRef) {
    return isKnownArchetype(assetRef) ? (ARCHETYPE_ROUTES[assetRef]?.route ?? null) : null;
  }

  /** The production route table (read by tests that build deliberately mis-mapped negative fixtures). */
  static get ROUTES() { return ARCHETYPE_ROUTES; }

  /** Inline compound builders, exposed so tests can spy on which one ran. */
  static get INLINE_BUILDERS() { return INLINE_BUILDERS; }

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
