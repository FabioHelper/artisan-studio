import { ARCHETYPE_CATALOG, AXIS, CONTRACT_VERSION } from '../src/contracts/artisanContract.js';

// mtx.world/1 — the only shape the MTX Godot compiler accepts. The canonical spec is
// data/schema/mtx.world.1.schema.json in the MTX repository; validateMtxWorld() below is its
// Artisan-side mirror and runs before any byte is written. The Godot importer validates again.
export const MTX_SCHEMA_VERSION = 'mtx.world/1';
export const MTX_COMPILER = 'mtx.v2.compiler/1';
// Three.js applies Euler angles in XYZ order (Object3D default). Godot's default is YXZ, so
// the order is part of the record rather than a convention either side has to remember.
export const MTX_ROTATION_ORDER = 'XYZ';

const SUPPORTED = Object.fromEntries(
  Object.entries(ARCHETYPE_CATALOG).filter(([id]) => id.startsWith('mtx.')).map(([id, archetype]) => [id, archetype.surfaces])
);

const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Pure, versioned semantic projection. The Godot importer never receives preview geometry/PBR. */
export function buildMtxManifest(manifest, sceneReference) {
  if (manifest?.contractVersion !== CONTRACT_VERSION) throw new Error('MTX_CONTRACT_VERSION: authored contract version is unsupported');
  if (!sceneReference || !/^sha256:[0-9a-f]{32}$/.test(sceneReference.sceneIdentity || '')
    || !/^sha256:[0-9a-f]{64}$/.test(sceneReference.sourceManifestHash || '')) {
    throw new Error('MTX_IDENTITY: canonical scene identity and full manifest hash are required');
  }
  if (sceneReference.sceneIdentity.slice(7) !== sceneReference.sourceManifestHash.slice(7, 39)) {
    throw new Error('MTX_IDENTITY: scene identity is not derived from the manifest hash');
  }
  if (!Array.isArray(manifest.entities) || manifest.entities.length < 1 || manifest.entities.length > 64) {
    throw new Error('MTX_SCOPE: an MTX world holds 1 to 64 entities');
  }
  if (!same(manifest.axis, AXIS) || manifest.units !== 'meter') {
    throw new Error('MTX_COORDINATES: expected meter and the canonical right-handed axes');
  }
  const entities = manifest.entities.map(entity => {
    if (!SUPPORTED[entity.assetRef]) throw new Error(`MTX_ARCHETYPE: unsupported archetype ${entity.assetRef}`);
    if (!same(entity.materialRefs, SUPPORTED[entity.assetRef])) {
      throw new Error(`MTX_SURFACE: ${entity.assetRef} requires surfaces ${JSON.stringify(SUPPORTED[entity.assetRef])}`);
    }
    // Collision, clearance and reach are archetype facts in metres. A scaled entity would need
    // them re-derived, and non-uniform scale is unreliable in Godot physics: refuse, don't guess.
    if (!same(entity.transform?.scale ?? [1, 1, 1], [1, 1, 1])) {
      throw new Error('MTX_SCALE: MTX archetypes are authored at unit scale');
    }
    if (!Number.isInteger(entity.seed)) throw new Error('MTX_SEED: an explicit integer variant seed is required');
    const archetype = ARCHETYPE_CATALOG[entity.assetRef];
    return {
      id: entity.id,
      assetRef: entity.assetRef,
      transform: {
        positionM: clone(entity.transform?.positionM ?? [0, 0, 0]),
        rotationDeg: clone(entity.transform?.rotationDeg ?? [0, 0, 0]),
        scale: [1, 1, 1]
      },
      seed: entity.seed,
      materialRefs: clone(SUPPORTED[entity.assetRef]),
      dimensionsM: clone(archetype.dimensions),
      anchors: clone(archetype.anchorPositionsM),
      collision: clone(archetype.collision),
      interaction: clone(archetype.interaction),
      clearance: clone(archetype.clearance),
      lodClass: archetype.lodClass
    };
  });
  const doc = {
    schemaVersion: MTX_SCHEMA_VERSION,
    requires: { compiler: MTX_COMPILER },
    source: {
      tool: 'artisan-3d',
      worldId: manifest.worldId,
      contractVersion: CONTRACT_VERSION,
      sceneIdentity: sceneReference.sceneIdentity,
      sourceManifestHash: sceneReference.sourceManifestHash
    },
    units: 'meter', axis: clone(AXIS), rotationOrder: MTX_ROTATION_ORDER,
    entities
  };
  const errors = validateMtxWorld(doc);
  if (errors.length) throw new Error(`MTX_SCHEMA: ${errors.join('; ')}`);
  return doc;
}

const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const isPositive3 = (v) => isVec3(v) && v.every(n => n > 0);
const onlyKeys = (obj, keys, where, errors) => {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) errors.push(`${where}: unknown field ${k}`);
};

/** Structural check of an mtx.world/1 document. Returns a list of errors; empty means valid. */
export function validateMtxWorld(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['document is not an object'];
  onlyKeys(doc, ['schemaVersion', 'requires', 'source', 'units', 'axis', 'rotationOrder', 'entities'], 'root', errors);
  if (doc.schemaVersion !== MTX_SCHEMA_VERSION) errors.push(`schemaVersion must be ${MTX_SCHEMA_VERSION}`);
  if (doc.requires?.compiler !== MTX_COMPILER) errors.push(`requires.compiler must be ${MTX_COMPILER}`);
  const s = doc.source || {};
  if (s.tool !== 'artisan-3d' || typeof s.worldId !== 'string' || typeof s.contractVersion !== 'string') errors.push('source: tool, worldId and contractVersion are required');
  if (!/^sha256:[0-9a-f]{32}$/.test(s.sceneIdentity || '') || !/^sha256:[0-9a-f]{64}$/.test(s.sourceManifestHash || '')
    || s.sceneIdentity.slice(7) !== s.sourceManifestHash.slice(7, 39)) errors.push('source: sceneIdentity must be the 32-hex prefix of sourceManifestHash');
  if (doc.units !== 'meter' || !same(doc.axis, AXIS)) errors.push('units/axis must be meter and the canonical axes');
  if (doc.rotationOrder !== MTX_ROTATION_ORDER) errors.push(`rotationOrder must be ${MTX_ROTATION_ORDER}`);
  if (!Array.isArray(doc.entities) || doc.entities.length < 1 || doc.entities.length > 64) { errors.push('MTX_SCOPE: an MTX world holds 1 to 64 entities'); return errors; }
  const ids = new Set();
  for (const [i, e] of doc.entities.entries()) {
    const at = `entities[${i}]`;
    onlyKeys(e, ['id', 'assetRef', 'transform', 'seed', 'materialRefs', 'dimensionsM', 'anchors', 'collision', 'interaction', 'clearance', 'lodClass'], at, errors);
    if (typeof e.id !== 'string' || !/^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(e.id)) errors.push(`${at}: invalid id`);
    else if (ids.has(e.id)) errors.push(`${at}: duplicate id ${e.id}`);
    ids.add(e.id);
    if (!SUPPORTED[e.assetRef]) errors.push(`${at}: unsupported archetype ${e.assetRef}`);
    else if (!same(e.materialRefs, SUPPORTED[e.assetRef])) errors.push(`${at}: materialRefs do not match the archetype surfaces`);
    const t = e.transform || {};
    if (!isVec3(t.positionM) || !isVec3(t.rotationDeg) || !same(t.scale, [1, 1, 1])) errors.push(`${at}: transform needs positionM, rotationDeg and unit scale`);
    if (!Number.isInteger(e.seed)) errors.push(`${at}: seed must be an integer`);
    if (!isPositive3(e.dimensionsM)) errors.push(`${at}: dimensionsM must be three positive metres`);
    if (!e.anchors || typeof e.anchors !== 'object' || !Object.values(e.anchors).every(isVec3)) errors.push(`${at}: anchors must map names to vec3`);
    const archetype = ARCHETYPE_CATALOG[e.assetRef];
    const c = e.collision || {};
    if (c.kind !== 'box' || !['static_solid', 'walkable', 'actor'].includes(c.class) || !isPositive3(c.sizeM) || !isVec3(c.centerM) || c.class !== archetype?.collision?.class) errors.push(`${at}: collision must be a box matching the archetype's class`);
    if (archetype?.interaction === null) {
      if (e.interaction !== null) errors.push(`${at}: interaction must be null`);
    } else {
      const n = e.interaction || {};
      if (!['hardline', 'arrival'].includes(n.kind) || n.kind !== archetype?.interaction?.kind || n.zone !== 'cylinder' || !(n.reachM > 0) || !(n.heightM > 0) || !e.anchors?.[n.anchor]) errors.push(`${at}: interaction must name an anchor and a positive cylinder`);
    }
    if (!Array.isArray(e.clearance) || !e.clearance.every(z => typeof z.id === 'string' && z.kind === 'box' && isPositive3(z.sizeM) && isVec3(z.centerM))) errors.push(`${at}: clearance must be a list of boxes`);
    if (!['hero_static', 'static', 'hero_actor', 'crowd_actor'].includes(e.lodClass) || e.lodClass !== archetype?.lodClass) errors.push(`${at}: lodClass must match the archetype`);
  }
  return errors;
}
