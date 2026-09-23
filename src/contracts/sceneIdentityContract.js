import {
  CONTRACT_VERSION,
  SCENE_IDENTITY_KINDS,
  SCENE_IDENTITY_SCHEMA_VERSION,
  canonicalJson,
  formatSceneIdentity
} from './artisanContract.js';

const FULL_HASH = /^sha256:[0-9a-f]{64}$/;
const COMPACT_AUTHORED = /^sha256:[0-9a-f]{32}$/;
const LOGICAL_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const OPERATIONS = new Set(['compile-ack', 'screenshot', 'telemetry', 'telemetry-import', 'manifest-export', 'audit', 'performance-report']);
const SOURCES = new Set(['live', 'headless']);

export class SceneIdentityError extends Error {
  constructor(code, message, issues = []) {
    super(code + ': ' + message);
    this.name = 'SceneIdentityError';
    this.code = code;
    this.issues = issues;
  }
}

const fail = (code, message, path = 'sceneReference') => {
  throw new SceneIdentityError(code, message, [{ code, path, message }]);
};

export const isFullSha256 = value => FULL_HASH.test(String(value || ''));
export const hashHex = value => isFullSha256(value) ? value.slice(7) : null;

export function normalizeDependencyPath(value) {
  const path = String(value || '');
  if (!path || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('IDENTITY_UNRESOLVED', 'dependency paths must be exact repo-relative POSIX paths', 'dependencies.path');
  }
  return path;
}

export function canonicalDependencies(dependencies) {
  if (!Array.isArray(dependencies)) fail('IDENTITY_UNRESOLVED', 'dependencies must be an array', 'dependencies');
  const seen = new Set();
  const seenFolded = new Set();
  const rows = dependencies.map((dependency, index) => {
    if (!dependency || typeof dependency !== 'object') fail('IDENTITY_UNRESOLVED', 'dependency must be an object', 'dependencies.' + index);
    const path = normalizeDependencyPath(dependency.path);
    if (seen.has(path)) fail('IDENTITY_UNRESOLVED', 'duplicate dependency path: ' + path, 'dependencies.' + index + '.path');
    if (seenFolded.has(path.toLowerCase())) fail('IDENTITY_UNRESOLVED', 'case-ambiguous dependency path: ' + path, 'dependencies.' + index + '.path');
    seen.add(path);
    seenFolded.add(path.toLowerCase());
    if (!isFullSha256(dependency.sha256)) fail('IDENTITY_STALE', 'dependency hash must be a full lowercase SHA-256: ' + path, 'dependencies.' + index + '.sha256');
    return { path, sha256: dependency.sha256 };
  });
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function identityHashDocument({ kind, logicalId, contentVersion, contractVersion = CONTRACT_VERSION, dependencies, parentContentHash = null }) {
  if (!SCENE_IDENTITY_KINDS.includes(kind) || kind === 'authored-world') fail('IDENTITY_KIND_MISMATCH', 'generated identity kind is invalid: ' + kind, 'kind');
  if (!LOGICAL_ID.test(String(logicalId || ''))) fail('IDENTITY_UNRESOLVED', 'logicalId is invalid', 'logicalId');
  if (!Number.isInteger(contentVersion) || contentVersion < 1) fail('IDENTITY_UNRESOLVED', 'contentVersion must be a positive integer', 'contentVersion');
  if (kind === 'zone' && !isFullSha256(parentContentHash)) fail('IDENTITY_PARENT_MISMATCH', 'zone identity requires its parent content hash', 'parentContentHash');
  if (kind !== 'zone' && parentContentHash !== null) fail('IDENTITY_PARENT_MISMATCH', 'only zone identities may include a parent content hash', 'parentContentHash');
  return {
    identitySchemaVersion: SCENE_IDENTITY_SCHEMA_VERSION,
    kind,
    logicalId,
    contentVersion,
    contractVersion,
    dependencies: canonicalDependencies(dependencies),
    ...(parentContentHash ? { parentContentHash } : {})
  };
}

export function runtimeSceneIdentity(kind, contentVersion, contentHash) {
  if (!isFullSha256(contentHash)) fail('IDENTITY_STALE', 'contentHash must be a full lowercase SHA-256', 'contentHash');
  const compact = hashHex(contentHash).slice(0, 32);
  if (kind === 'walkable-world') return 'fantastic-world:walkable:v' + contentVersion + ':' + compact;
  if (kind === 'zone') return 'fantastic-hall:zone:v' + contentVersion + ':' + compact;
  if (kind === 'diorama-adaptation') return 'fantastic-hall:diorama:v' + contentVersion + ':' + compact;
  if (kind === 'authored-world') return 'sha256:' + compact;
  fail('IDENTITY_KIND_MISMATCH', 'unsupported identity kind: ' + kind, 'kind');
}

export function authoredSceneReference({ worldId, version, sourceManifestHash, rendererHash, renderPlanHash = null }) {
  if (!LOGICAL_ID.test(String(worldId || ''))) fail('IDENTITY_UNRESOLVED', 'authored worldId is invalid', 'logicalId');
  if (!Number.isInteger(version) || version < 1) fail('IDENTITY_UNRESOLVED', 'authored version must be a positive integer', 'contentVersion');
  if (!isFullSha256(sourceManifestHash)) fail('IDENTITY_STALE', 'sourceManifestHash must be a full lowercase SHA-256', 'sourceManifestHash');
  const reference = {
    identitySchemaVersion: SCENE_IDENTITY_SCHEMA_VERSION,
    kind: 'authored-world',
    logicalId: worldId,
    contentVersion: version,
    contractVersion: CONTRACT_VERSION,
    contentHash: sourceManifestHash,
    sceneIdentity: formatSceneIdentity(hashHex(sourceManifestHash)),
    parentSceneIdentity: null,
    sourceManifestHash,
    rendererHash,
    renderPlanHash,
    legacyAliases: []
  };
  return validateSceneReference(reference);
}

export async function computeAuthoredSceneReference(manifest, rendererHash, subtle = globalThis.crypto?.subtle) {
  if (!subtle) fail('IDENTITY_UNRESOLVED', 'crypto.subtle is unavailable for authored identity', 'sourceManifestHash');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(manifest)));
  const sourceManifestHash = 'sha256:' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return authoredSceneReference({
    worldId: manifest?.worldId,
    version: manifest?.version,
    sourceManifestHash,
    rendererHash
  });
}

export function validateSceneReference(reference, { allowLegacy = false } = {}) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) fail('IDENTITY_UNRESOLVED', 'structured scene reference is required');
  if (reference.legacy === true && !allowLegacy) fail('IDENTITY_UNRESOLVED', 'legacy identity cannot be canonical proof', 'legacy');
  if (reference.identitySchemaVersion !== SCENE_IDENTITY_SCHEMA_VERSION) fail('IDENTITY_STALE', 'identity schema version mismatch', 'identitySchemaVersion');
  if (!SCENE_IDENTITY_KINDS.includes(reference.kind)) fail('IDENTITY_KIND_MISMATCH', 'unknown scene kind: ' + reference.kind, 'kind');
  if (!LOGICAL_ID.test(String(reference.logicalId || ''))) fail('IDENTITY_UNRESOLVED', 'logicalId is invalid', 'logicalId');
  if (!Number.isInteger(reference.contentVersion) || reference.contentVersion < 1) fail('IDENTITY_UNRESOLVED', 'contentVersion is invalid', 'contentVersion');
  if (reference.contractVersion !== CONTRACT_VERSION) fail('IDENTITY_STALE', 'contract version mismatch', 'contractVersion');
  if (!isFullSha256(reference.contentHash)) fail('IDENTITY_STALE', 'contentHash is not a full lowercase SHA-256', 'contentHash');
  if (!isFullSha256(reference.rendererHash)) fail('IDENTITY_STALE', 'rendererHash is not a full lowercase SHA-256', 'rendererHash');
  if (reference.renderPlanHash !== null && !isFullSha256(reference.renderPlanHash)) fail('IDENTITY_STALE', 'renderPlanHash is invalid', 'renderPlanHash');
  if (!Array.isArray(reference.legacyAliases) || new Set(reference.legacyAliases).size !== reference.legacyAliases.length) fail('IDENTITY_UNRESOLVED', 'legacyAliases must be a unique array', 'legacyAliases');
  const expectedRuntime = runtimeSceneIdentity(reference.kind, reference.contentVersion, reference.contentHash);
  if (reference.sceneIdentity !== expectedRuntime) fail('IDENTITY_STALE', 'compact scene identity does not match contentHash', 'sceneIdentity');
  if (reference.kind === 'authored-world') {
    if (reference.parentSceneIdentity !== null) fail('IDENTITY_PARENT_MISMATCH', 'authored world cannot have a parent', 'parentSceneIdentity');
    if (reference.sourceManifestHash !== reference.contentHash || !COMPACT_AUTHORED.test(reference.sceneIdentity)) fail('IDENTITY_STALE', 'authored identity must remain derived from the full manifest hash', 'sourceManifestHash');
  } else if (reference.sourceManifestHash !== null) {
    fail('IDENTITY_STALE', 'generated Fantastic identity cannot claim a source manifest hash', 'sourceManifestHash');
  }
  if (reference.kind === 'zone') {
    if (typeof reference.parentSceneIdentity !== 'string' || !reference.parentSceneIdentity) fail('IDENTITY_PARENT_MISMATCH', 'zone identity requires a parent scene identity', 'parentSceneIdentity');
  } else if (reference.parentSceneIdentity !== null) {
    fail('IDENTITY_PARENT_MISMATCH', 'non-zone identity cannot have a parent', 'parentSceneIdentity');
  }
  return Object.freeze({
    identitySchemaVersion: reference.identitySchemaVersion,
    kind: reference.kind,
    logicalId: reference.logicalId,
    contentVersion: reference.contentVersion,
    contractVersion: reference.contractVersion,
    contentHash: reference.contentHash,
    sceneIdentity: reference.sceneIdentity,
    parentSceneIdentity: reference.parentSceneIdentity,
    sourceManifestHash: reference.sourceManifestHash,
    rendererHash: reference.rendererHash,
    renderPlanHash: reference.renderPlanHash,
    legacyAliases: Object.freeze([...reference.legacyAliases])
  });
}

export function verifySceneReference(actual, expected, { expectedParent = null } = {}) {
  const want = validateSceneReference(expected);
  const got = validateSceneReference(actual);
  if (got.kind !== want.kind) fail('IDENTITY_KIND_MISMATCH', 'scene kind ' + got.kind + ' cannot prove ' + want.kind, 'kind');
  if (got.parentSceneIdentity !== want.parentSceneIdentity) fail('IDENTITY_PARENT_MISMATCH', 'scene parent does not match the expected parent', 'parentSceneIdentity');
  if (expectedParent && got.parentSceneIdentity !== validateSceneReference(expectedParent).sceneIdentity) {
    fail('IDENTITY_PARENT_MISMATCH', 'zone is not bound to the rendered parent world', 'parentSceneIdentity');
  }
  const fields = ['identitySchemaVersion', 'logicalId', 'contentVersion', 'contractVersion', 'contentHash', 'sceneIdentity', 'sourceManifestHash', 'rendererHash', 'renderPlanHash'];
  const stale = fields.find(field => got[field] !== want[field]);
  if (stale) fail('IDENTITY_STALE', stale + ' does not match the expected scene', stale);
  return got;
}

export function sceneCatalogByIdentity(catalog) {
  const values = Object.values(catalog || {}).map(value => validateSceneReference(value));
  return new Map(values.map(value => [value.sceneIdentity, value]));
}

export function resolveSceneAlias(input, { identities, aliases }) {
  const value = String(input || '');
  const byIdentity = sceneCatalogByIdentity(identities);
  if (byIdentity.has(value)) return { sceneReference: byIdentity.get(value), alias: null };
  const key = aliases?.[value];
  if (!key || !identities?.[key]) fail('IDENTITY_UNRESOLVED', 'unknown scene alias: ' + value, 'alias');
  const sceneReference = validateSceneReference(identities[key]);
  if (!sceneReference.legacyAliases.includes(value)) fail('IDENTITY_STALE', 'alias is not declared by its generated descriptor', 'legacyAliases');
  return { sceneReference, alias: value };
}

export function evidenceNamespace(sceneReference, zoneReference = null) {
  const scene = validateSceneReference(sceneReference);
  const hex = hashHex(scene.contentHash);
  if (zoneReference) {
    const zone = verifySceneReference(zoneReference, zoneReference, { expectedParent: scene });
    if (zone.kind !== 'zone') fail('IDENTITY_KIND_MISMATCH', 'zone evidence requires a zone descriptor', 'zoneReference.kind');
    return 'evidence/zone/' + zone.logicalId + '/v' + zone.contentVersion + '/' + hex + '/' + hashHex(zone.contentHash);
  }
  if (scene.kind === 'zone') fail('IDENTITY_PARENT_MISMATCH', 'zone cannot replace the parent scene identity', 'sceneReference.kind');
  if (scene.kind === 'authored-world') return 'evidence/authored-world/' + encodeURIComponent(scene.logicalId) + '/v' + scene.contentVersion + '/' + hex;
  return 'evidence/' + scene.kind + '/' + scene.logicalId + '/v' + scene.contentVersion + '/' + hex;
}

function verifiedZoneEvidence(render, sceneReference, zoneReference, camera, inFrustum) {
  const proof = render?.zoneEvidence;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) fail('IDENTITY_UNRESOLVED', 'zone evidence requires a camera/frustum proof', 'render.zoneEvidence');
  if (proof.parentSceneIdentity !== sceneReference.sceneIdentity || proof.zoneSceneIdentity !== zoneReference.sceneIdentity) {
    fail('IDENTITY_PARENT_MISMATCH', 'zone camera/frustum proof is not bound to the rendered parent and zone', 'render.zoneEvidence');
  }
  if (proof.cameraInZone !== true) fail('IDENTITY_STALE', 'camera is outside the requested zone', 'render.zoneEvidence.cameraInZone');
  const provenCamera = camera ?? proof.camera;
  if (!provenCamera || !Array.isArray(provenCamera.position) || provenCamera.position.length !== 3
    || provenCamera.position.some(value => typeof value !== 'number' || !Number.isFinite(value))
    || typeof provenCamera.fov !== 'number' || !Number.isFinite(provenCamera.fov)) {
    fail('IDENTITY_UNRESOLVED', 'zone evidence requires a finite camera position and fov', 'camera');
  }
  const provenFrustum = inFrustum ?? proof.inFrustum;
  if (!Array.isArray(provenFrustum) || new Set(provenFrustum).size !== provenFrustum.length
    || provenFrustum.some(value => typeof value !== 'string')) {
    fail('IDENTITY_UNRESOLVED', 'zone evidence requires an exact unique frustum object list', 'inFrustum');
  }
  if (typeof proof.zoneObjectId !== 'string' || !provenFrustum.includes(proof.zoneObjectId)) {
    fail('IDENTITY_STALE', 'the requested zone is not present in the parent render frustum', 'inFrustum');
  }
  return Object.freeze({
    parentSceneIdentity: proof.parentSceneIdentity,
    zoneSceneIdentity: proof.zoneSceneIdentity,
    cameraInZone: true,
    zoneObjectId: proof.zoneObjectId,
    camera: Object.freeze({ ...provenCamera, position: Object.freeze([...provenCamera.position]), ...(Array.isArray(provenCamera.target) ? { target: Object.freeze([...provenCamera.target]) } : {}) }),
    inFrustum: Object.freeze([...provenFrustum])
  });
}

export function bindEvidenceRecord({ operation, source, render, expectedScene, expectedZone = null, renderer = {}, camera = null, inFrustum = null, artifactSha256 = null }) {
  if (!OPERATIONS.has(operation)) fail('IDENTITY_UNRESOLVED', 'unknown evidence operation: ' + operation, 'operation');
  if (!SOURCES.has(source)) fail('IDENTITY_UNRESOLVED', 'unknown evidence source: ' + source, 'source');
  if (!render || typeof render !== 'object') fail('IDENTITY_UNRESOLVED', 'render record is required', 'render');
  const sceneReference = verifySceneReference(render.sceneReference, expectedScene);
  if (render.sceneIdentity !== sceneReference.sceneIdentity) fail('IDENTITY_STALE', 'render sceneIdentity disagrees with its descriptor', 'render.sceneIdentity');
  if (!Number.isInteger(render.epoch) || render.epoch < 0) fail('IDENTITY_STALE', 'render epoch is missing', 'render.epoch');
  if (!Array.isArray(render.renderedEntityIds) || new Set(render.renderedEntityIds).size !== render.renderedEntityIds.length) fail('IDENTITY_STALE', 'renderedEntityIds must be exact and unique', 'render.renderedEntityIds');
  const zoneReference = expectedZone ? verifySceneReference(render.zoneReference, expectedZone, { expectedParent: sceneReference }) : null;
  if (!expectedZone && render.zoneReference != null) fail('IDENTITY_PARENT_MISMATCH', 'unexpected zone label on world evidence', 'render.zoneReference');
  const zoneEvidence = zoneReference ? verifiedZoneEvidence(render, sceneReference, zoneReference, camera, inFrustum) : null;
  if (artifactSha256 !== null && !isFullSha256(artifactSha256)) fail('IDENTITY_STALE', 'artifactSha256 is invalid', 'artifactSha256');
  return Object.freeze({
    operation,
    source,
    sceneIdentity: sceneReference.sceneIdentity,
    sceneReference,
    zoneReference,
    zoneEvidence,
    namespace: evidenceNamespace(sceneReference, zoneReference),
    renderEpoch: render.epoch,
    epoch: render.epoch,
    renderedEntityIds: Object.freeze([...render.renderedEntityIds]),
    renderer: Object.freeze({ ...renderer, rendererHash: sceneReference.rendererHash }),
    rendererHash: sceneReference.rendererHash,
    renderPlanHash: sceneReference.renderPlanHash,
    camera: zoneEvidence?.camera ?? camera,
    inFrustum: zoneEvidence?.inFrustum ?? (Array.isArray(inFrustum) ? Object.freeze([...inFrustum]) : null),
    artifactSha256,
    identityVerified: true,
    authored: sceneReference.kind === 'authored-world',
    legacy: false
  });
}

export function verifyEvidenceWindow(start, end, expectedScene, expectedIds = null) {
  const before = verifySceneReference(start?.sceneReference, expectedScene);
  const after = verifySceneReference(end?.sceneReference, expectedScene);
  if (start?.sceneIdentity !== before.sceneIdentity || end?.sceneIdentity !== after.sceneIdentity) fail('IDENTITY_STALE', 'evidence window compact identity changed', 'sceneIdentity');
  if (!Number.isInteger(start?.epoch) || end?.epoch !== start.epoch) fail('IDENTITY_STALE', 'scene changed during evidence capture', 'renderEpoch');
  if (expectedIds) {
    const same = value => Array.isArray(value) && value.length === expectedIds.length && new Set(value).size === value.length && expectedIds.every(id => value.includes(id));
    if (!same(start.renderedEntityIds) || !same(end.renderedEntityIds)) fail('IDENTITY_STALE', 'rendered entity set changed during evidence capture', 'renderedEntityIds');
  }
  return { start: before, end: after };
}

export function canonicalIdentityJson(value) {
  return canonicalJson(value);
}
