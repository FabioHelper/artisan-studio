import { ARCHETYPE_CATALOG, AXIS, CONTRACT_VERSION } from '../src/contracts/artisanContract.js';

const HARDLINE = 'mtx.fixture.hardline_booth';
const SURFACES = ['mtx.neutral.black_lacquer', 'mtx.glass.cyan', 'mtx.signal.green_code'];

/** Pure, versioned semantic projection. The Godot importer never receives preview geometry/PBR. */
export function buildMtxManifest(manifest, sceneReference) {
  if (manifest?.contractVersion !== CONTRACT_VERSION) throw new Error('MTX_CONTRACT_VERSION: authored contract version is unsupported');
  if (!sceneReference || !/^sha256:[0-9a-f]{32}$/.test(sceneReference.sceneIdentity || '')
    || !/^sha256:[0-9a-f]{64}$/.test(sceneReference.sourceManifestHash || '')) {
    throw new Error('MTX_IDENTITY: canonical scene identity and full manifest hash are required');
  }
  if (!Array.isArray(manifest.entities) || manifest.entities.length !== 1) {
    throw new Error('MTX_PILOT_SCOPE: the pilot export requires exactly one Hardline booth');
  }
  if (JSON.stringify(manifest.axis) !== JSON.stringify(AXIS) || manifest.units !== 'meter') {
    throw new Error('MTX_COORDINATES: expected meter and the canonical right-handed axes');
  }
  const entity = manifest.entities[0];
  if (entity.assetRef !== HARDLINE) throw new Error(`MTX_ARCHETYPE: unsupported archetype ${entity.assetRef}`);
  if (JSON.stringify(entity.materialRefs) !== JSON.stringify(SURFACES)) {
    throw new Error('MTX_SURFACE: Hardline requires the three canonical semantic surfaces in order');
  }
  const archetype = ARCHETYPE_CATALOG[HARDLINE];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  return {
    schemaVersion: 'mtx.world/1',
    source: {
      worldId: manifest.worldId,
      contractVersion: CONTRACT_VERSION,
      sceneIdentity: sceneReference.sceneIdentity,
      sourceManifestHash: sceneReference.sourceManifestHash
    },
    units: 'meter', axis: clone(AXIS),
    entities: [{
      id: entity.id,
      assetRef: HARDLINE,
      transform: clone(entity.transform),
      seed: entity.seed,
      materialRefs: clone(SURFACES),
      dimensionsM: clone(archetype.dimensions),
      anchors: clone(archetype.anchorPositionsM),
      collision: clone(archetype.collision),
      interaction: { ...clone(archetype.interaction), frontClearanceM: clone(archetype.clearance.frontM) }
    }]
  };
}
