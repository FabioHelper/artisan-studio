#!/usr/bin/env node
// Artisan 3D Studio MCP server (stdio). Canonical contract: ../src/contracts/artisanContract.js
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  CONTRACT_VERSION,
  COORDINATE_SYSTEM,
  RELATIONSHIP_TYPES,
  SELF_SUPPORTING_CATEGORIES,
  DEFAULT_GROUND_TARGET,
  LIGHTING_PRESETS,
  LIMITS,
  PERFORMANCE_PROFILES,
  PRESET_SCENES,
  CAMERA_ANGLES,
  ARCHETYPE_CATALOG,
  MATERIAL_CATALOG,
  WORLD_SCHEMA,
  deriveSeed
} from '../src/contracts/artisanContract.js';
import { WorldSession } from './WorldSession.js';
import { buildMtxManifest } from './mtxExport.js';
import {
  validateWorld, formatIssues, checkId, checkPosition, checkRotation, checkScale,
  checkMaterials, checkSeed, checkLighting, checkArchetype
} from './Validator.js';
import { renderEvidence, STUDIO_URL } from './HeadlessRunner.js';
import { ARTIFACTS_DIR, PROJECT_ROOT, safeArtifactPath, safeArtifactRelPath, writeArtifactAt } from './artifacts.js';
import { startBridge, HANDSHAKE_GRACE_MS } from './bridge.js';
import {
  SceneIdentityError,
  bindEvidenceRecord,
  evidenceNamespace,
  resolveSceneAlias,
  verifySceneReference
} from '../src/contracts/sceneIdentityContract.js';
import { SCENE_ALIASES, SCENE_IDENTITIES } from '../src/contracts/sceneIdentityManifest.generated.js';

const SERVER_VERSION = '2.0.0';
const KNOWLEDGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'knowledge');
const SIJ_FILE = path.join(PROJECT_ROOT, 'HARNESS-SIJ.json');
const SCENE_IDS = Object.keys(PRESET_SCENES);
const SCENE_INPUTS = [
  ...SCENE_IDS,
  'preset:fantastic',
  SCENE_IDENTITIES.dioramaAdaptation.sceneIdentity,
  'mode:game',
  SCENE_IDENTITIES.walkableWorld.sceneIdentity,
  SCENE_IDENTITIES.fantasticHallZone.sceneIdentity
];
const PROFILE_IDS = Object.keys(PERFORMANCE_PROFILES);

// Live preview bridge (loopback). null = explicitly disabled (ARTISAN_BRIDGE=off, state 'disabled').
const bridge = process.env.ARTISAN_BRIDGE === 'off'
  ? null
  : startBridge({ studioUrl: STUDIO_URL, sijFile: SIJ_FILE, serverVersion: SERVER_VERSION, getWorld: () => worldIdentity() });
const session = new WorldSession();
// This process's identity in every evidence envelope (the bridge's instanceId; its own id when the bridge is disabled).
const INSTANCE_ID = bridge?.instanceId ?? crypto.randomUUID();

/** Authored world identity as served by GET /api/bridge/identity (never manifest content). */
function worldIdentity() {
  const m = session.getManifest();
  const sceneReference = session.sceneReference(m);
  return { worldId: m.worldId, version: m.version, sceneIdentity: sceneReference.sceneIdentity, sceneReference, rendererHash: sceneReference.rendererHash, entityCount: m.entities.length };
}

/** Bridge state summary attached to compile and evidence responses. */
function bridgeInfo() {
  if (!bridge) return { state: 'disabled' };
  const state = bridge.state();
  return { state, instanceId: bridge.instanceId, port: bridge.port, ...(state === 'conflict' ? { owner: bridge.owner() } : {}) };
}

const hasLiveClient = () => !!bridge && bridge.isListening() && bridge.clientCount() > 0;

// ---------------------------------------------------------------- helpers
class ToolError extends Error {
  constructor(code, message, issues = []) { super(message); this.code = code; this.issues = issues; }
}

function ok(data, text) {
  return { content: [{ type: 'text', text }], structuredContent: { ok: true, ...data } };
}

function fail(code, message, issues = []) {
  const shown = issues.slice(0, 25);
  const lines = [`${code}: ${message}`, ...formatIssues(shown.slice(0, 10))];
  return {
    isError: true,
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: { ok: false, error: { code, message, issues: shown } }
  };
}

function rejectUnknownArgs(args, allowed) {
  const extra = Object.keys(args).filter(k => !allowed.includes(k));
  if (extra.length) throw new ToolError('INVALID_ARGUMENT', `Unknown argument(s): ${extra.join(', ')}`, extra.map(k => ({ code: 'UNKNOWN_ARGUMENT', path: k, message: `'${k}' is not accepted` })));
}

function throwIfIssues(errors, code = 'INVALID_ARGUMENT', message = 'Invalid arguments') {
  if (errors.length) throw new ToolError(code, message, errors);
}

function optionalEnum(value, list, path, errors) {
  if (value !== undefined && !list.includes(value)) errors.push({ code: 'INVALID_ENUM', path, message: `${path} must be one of ${list.join(', ')}` });
}

function worldSummary(manifest = session.getManifest()) {
  const v = validateWorld(manifest);
  const sceneReference = session.sceneReference(manifest);
  return {
    worldId: manifest.worldId,
    version: manifest.version,
    sceneIdentity: sceneReference.sceneIdentity,
    sceneReference,
    sourceManifestHash: sceneReference.sourceManifestHash,
    rendererHash: sceneReference.rendererHash,
    renderPlanHash: sceneReference.renderPlanHash,
    entityCount: manifest.entities.length,
    validation: { valid: v.valid, errors: v.errors.length, warnings: v.warnings.length }
  };
}

/** Validate a candidate world; commit + broadcast only if it satisfies the contract. */
function commitCandidate(candidate, opts) {
  const report = validateWorld(candidate);
  if (!report.valid) throw new ToolError('CONTRACT_VIOLATION', 'Change rejected: the resulting world violates the contract', report.errors);
  const committed = session.commit(candidate, opts);
  lastVerifiedRender = null;
  bridge?.publishWorld(committed);
  return { summary: worldSummary(committed), warnings: formatIssues(report.warnings).slice(0, 15) };
}

function evaluateBudget(profileId, telemetry) {
  const profile = PERFORMANCE_PROFILES[profileId];
  const max = profile.drawCallsMax ?? profile.visibleDrawCallsMax;
  const trianglesTarget = profile.trianglesTarget ?? null;
  const drawCalls = typeof telemetry?.drawCalls === 'number' ? telemetry.drawCalls : null;
  const triangles = typeof telemetry?.triangles === 'number' ? telemetry.triangles : null;
  const settled = telemetry ? telemetry.settled === true : null;
  // Budgets are judged on settled frames only (no shadow-bake passes); unsettled or unmeasured -> null.
  const withinBudget = drawCalls === null || settled !== true ? null : drawCalls <= max && (trianglesTarget === null || (triangles !== null && triangles <= trianglesTarget));
  return { profile: profileId, drawCallsMax: max, trianglesTarget, drawCalls, triangles, settled, withinBudget };
}

const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && new Set(a).size === a.length && b.every(x => a.includes(x));

function canonicalSceneRoute(scene) {
  if (scene === SCENE_IDENTITIES.fantasticHallZone.sceneIdentity) {
    return { sceneReference: SCENE_IDENTITIES.walkableWorld, zoneReference: SCENE_IDENTITIES.fantasticHallZone, studioScene: scene };
  }
  if (scene === 'mode:game' || scene === SCENE_IDENTITIES.walkableWorld.sceneIdentity) {
    return { sceneReference: resolveSceneAlias(scene, { identities: SCENE_IDENTITIES, aliases: SCENE_ALIASES }).sceneReference, zoneReference: null, studioScene: scene };
  }
  if (scene === 'fantastic' || scene === 'preset:fantastic' || scene === SCENE_IDENTITIES.dioramaAdaptation.sceneIdentity) {
    return {
      sceneReference: resolveSceneAlias(scene === 'fantastic' ? 'preset:fantastic' : scene, { identities: SCENE_IDENTITIES, aliases: SCENE_ALIASES }).sceneReference,
      zoneReference: null,
      studioScene: scene
    };
  }
  return { sceneReference: null, zoneReference: null, studioScene: scene };
}

function identityFailure(error) {
  if (error instanceof SceneIdentityError) throw new ToolError(error.code, error.message.replace(/^[A-Z_]+:\s*/, ''), error.issues);
  throw error;
}

function verifyRenderedScene(render, expectedScene, expectedIds = null) {
  try {
    const verified = verifySceneReference(render?.sceneReference, expectedScene);
    if (render?.sceneIdentity !== verified.sceneIdentity) {
      throw new SceneIdentityError('IDENTITY_STALE', 'render sceneIdentity disagrees with its structured reference', [{ code: 'IDENTITY_STALE', path: 'sceneIdentity', message: 'compact and structured identity disagree' }]);
    }
    if (expectedIds && !sameIds(render?.renderedEntityIds, expectedIds)) {
      throw new SceneIdentityError('IDENTITY_STALE', 'rendered entity set does not match the expected scene', [{ code: 'IDENTITY_STALE', path: 'renderedEntityIds', message: 'entity set mismatch' }]);
    }
    return verified;
  } catch (error) {
    identityFailure(error);
  }
}

function identityArtifactPath(sceneReference, relativePath, zoneReference = null) {
  const namespace = evidenceNamespace(sceneReference, zoneReference);
  const target = path.resolve(ARTIFACTS_DIR, ...namespace.split('/'), ...String(relativePath).split('/'));
  const relative = path.relative(ARTIFACTS_DIR, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new ToolError('ARTIFACT_PATH_ESCAPE', 'derived evidence namespace escaped the artifact root');
  return target;
}

function requestSceneRoute(scene = null) {
  return scene ? canonicalSceneRoute(scene) : { sceneReference: session.sceneReference(), zoneReference: null, studioScene: null };
}

// ---------------------------------------------------------------- evidence binding (SPEC-08 §3.5)
// Every evidence response says which renderer measured it and whether that renderer PROVED the scene identity.
let lastVerifiedRender = null;

function noteVerifiedRender(evidence) {
  if (!evidence?.identityVerified || !evidence.authored || !evidence.sceneIdentity) return;
  lastVerifiedRender = {
    sceneIdentity: evidence.sceneIdentity,
    sceneReference: evidence.sceneReference,
    zoneReference: evidence.zoneReference ?? null,
    source: evidence.source,
    renderEpoch: evidence.renderEpoch,
    renderedEntityIds: [...evidence.renderedEntityIds],
    renderer: { ...evidence.renderer },
    rendererHash: evidence.rendererHash,
    renderPlanHash: evidence.renderPlanHash,
    camera: evidence.camera ?? null,
    identityVerified: true,
    authored: true,
    at: new Date().toISOString()
  };
}

function evidenceEnvelope({ operation, source, render, clientId = null, connectionId = null, headlessRunId = null, camera = null, inFrustum = undefined, preset = null, artifactSha256 = null }) {
  const r = render || {};
  const authored = !preset;
  const manifest = session.getManifest();
  const route = authored ? { sceneReference: session.sceneReference(manifest), zoneReference: null } : canonicalSceneRoute(preset);
  const expectedScene = route.sceneReference;
  const expectedZone = route.zoneReference;
  const renderer = { kind: source === 'live' ? 'live-studio' : 'headless-studio', instanceId: INSTANCE_ID, clientId, connectionId, headlessRunId };
  if (!expectedScene) {
    const identityVerified = r.sceneIdentity === 'preset:' + preset && r.legacy === true;
    return {
      operation, sceneIdentity: r.sceneIdentity ?? null, sceneReference: null, namespace: null,
      identityVerified, authored: false, legacy: true, source,
      worldId: null, version: null,
      entityCount: Array.isArray(r.renderedEntityIds) ? r.renderedEntityIds.length : 0,
      renderedEntityIds: Array.isArray(r.renderedEntityIds) ? [...r.renderedEntityIds] : [],
      renderer, rendererHash: r.rendererHash ?? null, renderPlanHash: r.renderPlanHash ?? null,
      camera: camera ?? null, measuredAt: new Date().toISOString(), renderEpoch: r.epoch ?? null, epoch: r.epoch ?? null,
      artifactSha256, bridge: bridgeInfo(), ...(Array.isArray(inFrustum) ? { inFrustum } : {})
    };
  }
  if (authored && !sameIds(r.renderedEntityIds, manifest.entities.map(entity => entity.id))) {
    throw new ToolError('IDENTITY_STALE', 'rendered entity set does not match the authored world; nothing was written', [{ code: 'IDENTITY_STALE', path: 'renderedEntityIds', message: 'entity set mismatch' }]);
  }
  try {
    const bound = bindEvidenceRecord({ operation, source, render: r, expectedScene, expectedZone, renderer, camera, inFrustum, artifactSha256 });
    return {
      ...bound,
      worldId: authored ? (r.worldId ?? null) : null,
      version: authored ? (r.version ?? null) : null,
      entityCount: r.renderedEntityIds.length,
      measuredAt: new Date().toISOString(),
      bridge: bridgeInfo(),
      ...(Array.isArray(inFrustum) ? { inFrustum } : {})
    };
  } catch (error) {
    identityFailure(error);
  }
}

function sourceTag(source) {
  if (source === 'live') return '[live]';
  return bridge?.state() === 'conflict' ? `[headless; live bridge owned by ${bridge.describeOwner()}]` : '[headless]';
}

async function settleBridge() {
  if (!bridge) return;
  await bridge.ready();
  if (bridge.state() === 'conflict') await bridge.reacquire();
}

/**
 * Where evidence of the AUTHORED world comes from: the verified primary Studio when its measured identity and
 * rendered entity set equal the session (else PREVIEW_STALE: no automatic re-push, no silent source switch);
 * with no verified Studio (none connected, conflict, disabled) a headless authored render.
 */
async function resolveAuthoredTarget() {
  await settleBridge();
  if (!hasLiveClient()) return { source: 'headless' };
  const res = await bridge.request('GET_TELEMETRY', { probe: true }, 8000, { clientId: bridge.primaryClientId() });
  const r = res.msg.render || {};
  const manifest = session.getManifest();
  const expected = session.sceneIdentity(manifest);
  verifyRenderedScene(r, session.sceneReference(manifest), manifest.entities.map(entity => entity.id));
  if (r.sceneIdentity !== expected || !sameIds(r.renderedEntityIds, manifest.entities.map(e => e.id))) {
    throw new ToolError('PREVIEW_STALE', `Studio ${String(res.clientId).slice(0, 8)} shows ${r.sceneIdentity ?? 'an unverifiable scene'}; authored is ${expected}. Run compile_preview to push the authored world (nothing is re-pushed automatically; nothing was written).`);
  }
  return { source: 'live', clientId: res.clientId, connectionId: res.connectionId, epoch: r.epoch };
}

/** Preset evidence (explicit `scene`): the verified Studio if one is connected, else headless. */
async function resolvePresetTarget() {
  await settleBridge();
  return hasLiveClient() ? { source: 'live', clientId: bridge.primaryClientId() } : { source: 'headless' };
}

/** The live reply must still show the authored world of the probe (same identity, same epoch). */
function assertLiveRender(render, target) {
  const r = render || {};
  const expected = session.sceneIdentity();
  verifyRenderedScene(r, session.sceneReference(), session.getManifest().entities.map(entity => entity.id));
  if (r.sceneIdentity !== expected || (typeof target.epoch === 'number' && r.epoch !== target.epoch)) {
    throw new ToolError('PREVIEW_STALE', `The Studio scene changed while measuring (${r.sceneIdentity ?? 'unknown'}, epoch ${target.epoch} -> ${r.epoch}); authored is ${expected}; nothing was written.`);
  }
}

function assertPresetRender(render, scene) {
  const route = canonicalSceneRoute(scene);
  if (route.sceneReference) {
    verifyRenderedScene(render, route.sceneReference);
    try {
      if (route.zoneReference) {
        verifySceneReference(render?.zoneReference, route.zoneReference, { expectedParent: route.sceneReference });
        bindEvidenceRecord({ operation: 'telemetry', source: 'live', render, expectedScene: route.sceneReference, expectedZone: route.zoneReference, renderer: {}, camera: render?.zoneEvidence?.camera, inFrustum: render?.zoneEvidence?.inFrustum });
      } else if (render?.zoneReference != null) {
        throw new SceneIdentityError('IDENTITY_PARENT_MISMATCH', 'unexpected zone scope on world evidence');
      }
    } catch (error) {
      identityFailure(error);
    }
    return;
  }
  if (render?.sceneIdentity !== `preset:${scene}`) {
    throw new ToolError('EVIDENCE_UNVERIFIED', `The Studio reports ${render?.sceneIdentity ?? 'unknown'} instead of preset:${scene}; nothing was written.`);
  }
}

const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj?.[k] !== undefined).map(k => [k, obj[k]]));
const TELEMETRY_KEYS = ['gpu', 'isSoftwareRasterizer', 'fps', 'frametimeMs', 'frametimeP95Ms', 'drawCalls', 'triangles', 'geometries', 'textures', 'pixelRatio', 'viewport', 'settled', 'frames'];

// ---------------------------------------------------------------- tool declarations
const S = (type, extra = {}) => ({ type, ...extra });
const vec3 = S('array', { items: S('number'), minItems: 3, maxItems: 3 });
// Output schemas name the key fields only (extra fields allowed) to keep tools/list light.
const out = (props = {}) => ({ type: 'object', properties: { ok: S('boolean'), ...props } });
const WORLD_OUT = out({ sceneIdentity: S('string'), entityCount: S('integer'), validation: S('object') });
const ann = (title, readOnly, destructive, idempotent) => ({ title, readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false });
const noArgs = { type: 'object', properties: {}, additionalProperties: false };

const TOOLS = [
  {
    name: 'create_world',
    description: 'Start a new world (replaces the current one). Call first.',
    inputSchema: { type: 'object', properties: { worldId: S('string'), roomSize: { ...vec3, description: '[w,h,d] m' }, lighting: S('string', { enum: LIGHTING_PRESETS }) }, required: ['worldId'], additionalProperties: false },
    outputSchema: WORLD_OUT,
    annotations: ann('Create world', false, true, true)
  },
  {
    name: 'add_entity',
    description: 'Add a catalog archetype (artisan://catalog/archetypes); unknown ids are rejected. Default support: ground.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: S('string'), assetRef: S('string'),
        position: { ...vec3, description: '[x,y,z] m, +Y up' }, rotation: { ...vec3, description: 'deg' }, scale: vec3,
        materialRefs: S('array', { items: S('string') }),
        parent: S('string'), anchor: S('string'), relation: S('string', { enum: RELATIONSHIP_TYPES }),
        seed: S('integer'), authorship: S('object')
      },
      required: ['entityId', 'assetRef'],
      additionalProperties: false
    },
    outputSchema: out({ sceneIdentity: S('string'), entity: S('object') }),
    annotations: ann('Add entity', false, false, false)
  },
  {
    name: 'move_entity',
    description: 'Set position and/or rotation of an entity.',
    inputSchema: { type: 'object', properties: { entityId: S('string'), position: vec3, rotation: vec3 }, required: ['entityId'], additionalProperties: false },
    outputSchema: WORLD_OUT,
    annotations: ann('Move entity', false, false, true)
  },
  {
    name: 'remove_entity',
    description: 'Remove an entity. Rejected while other entities reference it.',
    inputSchema: { type: 'object', properties: { entityId: S('string') }, required: ['entityId'], additionalProperties: false },
    outputSchema: WORLD_OUT,
    annotations: ann('Remove entity', false, true, true)
  },
  {
    name: 'replace_material',
    description: 'Replace an entity\'s materialRefs (artisan://catalog/materials).',
    inputSchema: { type: 'object', properties: { entityId: S('string'), materialRefs: S('array', { items: S('string') }) }, required: ['entityId', 'materialRefs'], additionalProperties: false },
    outputSchema: WORLD_OUT,
    annotations: ann('Replace material', false, false, true)
  },
  {
    name: 'set_lighting',
    description: 'Set lighting preset.',
    inputSchema: { type: 'object', properties: { preset: S('string', { enum: LIGHTING_PRESETS }) }, required: ['preset'], additionalProperties: false },
    outputSchema: WORLD_OUT,
    annotations: ann('Set lighting', false, false, true)
  },
  {
    name: 'validate_scene',
    description: 'Validate the world against the contract and spatial laws.',
    inputSchema: noArgs,
    outputSchema: out({ valid: S('boolean'), errors: S('array'), warnings: S('array') }),
    annotations: ann('Validate scene', true, false, true)
  },
  {
    name: 'get_telemetry',
    description: 'World identity and usage stats; optionally the manifest.',
    inputSchema: { type: 'object', properties: { includeManifest: S('boolean') }, additionalProperties: false },
    outputSchema: out({ sceneIdentity: S('string'), archetypes: S('object'), manifest: S('object') }),
    annotations: ann('World telemetry', true, false, true)
  },
  {
    name: 'compile_preview',
    description: 'Validate, push to the live Studio and await its verified compile ack.',
    inputSchema: { type: 'object', properties: { timeoutMs: S('integer', { minimum: 500, maximum: 30000 }) }, additionalProperties: false },
    outputSchema: out({ livePreview: S('boolean'), ack: S(['object', 'null']), budget: S('object') }),
    annotations: ann('Compile preview', false, false, true)
  },
  {
    name: 'get_engine_telemetry',
    description: 'GPU, FPS, draws, tris from live Studio (else headless) vs a budget profile.',
    inputSchema: { type: 'object', properties: { profile: S('string', { enum: PROFILE_IDS }) }, additionalProperties: false },
    outputSchema: out({ telemetry: S('object'), budget: S('object') }),
    annotations: ann('Engine telemetry', true, false, true)
  },
  {
    name: 'run_performance_audit',
    description: 'Empirical performance audit; report saved to artifacts.',
    inputSchema: { type: 'object', properties: { scene: S('string', { description: 'Preset id, mode:game, or canonical Fantastic world/Hall/diorama identity.' }) }, additionalProperties: false },
    outputSchema: out({ verdict: S('string'), metrics: S('object'), artifacts: S('object') }),
    annotations: ann('Performance audit', false, false, false)
  },
  {
    name: 'capture_viewport_screenshot',
    description: 'Save a clean canvas PNG of the authored world or selected preset; filename may include subdirs.',
    inputSchema: { type: 'object', properties: { filename: S('string'), angle: S('string', { enum: CAMERA_ANGLES }), scene: S('string', { description: 'Preset id, mode:game, or canonical Fantastic world/Hall/diorama identity.' }) }, additionalProperties: false },
    outputSchema: out({ source: S('string'), path: S('string'), bytes: S('integer') }),
    annotations: ann('Capture screenshot', false, false, false)
  },
  {
    name: 'export_mtx_manifest',
    description: 'Write the verified Hardline MTX manifest to Studio artifacts.',
    inputSchema: noArgs,
    outputSchema: out({ path: S('string') }),
    annotations: ann('MTX export', false, false, true)
  },
  {
    name: 'import_telemetry_logs',
    description: 'Save identity-verified engine telemetry + manifest as a JSON artifact.',
    inputSchema: noArgs,
    outputSchema: out({ path: S('string') }),
    annotations: ann('Import telemetry logs', false, false, false)
  }
];

// ---------------------------------------------------------------- tool handlers
const HANDLERS = {
  create_world(args) {
    rejectUnknownArgs(args, ['worldId', 'roomSize', 'lighting']);
    const errors = [];
    checkId(args.worldId, 'worldId', errors);
    if (args.lighting !== undefined) checkLighting(args.lighting, 'lighting', errors);
    if (args.roomSize !== undefined) {
      const r = args.roomSize;
      if (!Array.isArray(r) || r.length !== 3 || r.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < LIMITS.roomSizeMinM || n > LIMITS.roomSizeMaxM)) {
        errors.push({ code: 'INVALID_VECTOR', path: 'roomSize', message: `roomSize must be 3 finite numbers in [${LIMITS.roomSizeMinM}, ${LIMITS.roomSizeMaxM}] m` });
      }
    }
    throwIfIssues(errors);
    const candidate = session.createWorldManifest(args.worldId, args.roomSize, args.lighting || 'dusk');
    const { summary } = commitCandidate(candidate, { bumpVersion: false });
    return ok(summary, `World '${summary.worldId}' created (${summary.sceneIdentity}).`);
  },

  add_entity(args) {
    rejectUnknownArgs(args, ['entityId', 'assetRef', 'position', 'rotation', 'scale', 'materialRefs', 'parent', 'anchor', 'relation', 'seed', 'authorship']);
    const errors = [];
    checkId(args.entityId, 'entityId', errors);
    const known = checkArchetype(args.assetRef, 'assetRef', errors);
    if (args.position !== undefined) checkPosition(args.position, 'position', errors);
    if (args.rotation !== undefined) checkRotation(args.rotation, 'rotation', errors);
    if (args.scale !== undefined) checkScale(args.scale, 'scale', errors);
    if (args.materialRefs !== undefined) checkMaterials(args.materialRefs, 'materialRefs', errors);
    if (args.seed !== undefined) checkSeed(args.seed, 'seed', errors);
    if (args.parent !== undefined) checkId(args.parent, 'parent', errors);
    optionalEnum(args.relation, RELATIONSHIP_TYPES, 'relation', errors);
    if ((args.anchor !== undefined || args.relation !== undefined) && args.parent === undefined) {
      errors.push({ code: 'MISSING_PARENT', path: 'parent', message: 'anchor/relation require parent' });
    }
    if (args.authorship !== undefined && (typeof args.authorship !== 'object' || Array.isArray(args.authorship) || args.authorship === null)) {
      errors.push({ code: 'INVALID_AUTHORSHIP', path: 'authorship', message: 'authorship must be an object {maker, ageYears, care, wealth}' });
    }
    if (session.findEntity(args.entityId)) errors.push({ code: 'DUPLICATE_ID', path: 'entityId', message: `Entity '${args.entityId}' already exists` });
    throwIfIssues(errors);

    const archetype = known ? ARCHETYPE_CATALOG[args.assetRef] : null;
    const kind = archetype.category;
    const relationships = [];
    if (args.parent) {
      const rel = { type: args.relation || (args.anchor ? 'attached_to' : 'supported_by'), target: args.parent };
      if (args.anchor) rel.anchor = args.anchor;
      relationships.push(rel);
    } else if (!SELF_SUPPORTING_CATEGORIES.includes(kind)) {
      relationships.push({ type: 'supported_by', target: DEFAULT_GROUND_TARGET });
    }
    const { seed: authorSeed, ...authorship } = args.authorship || {};
    const worldId = session.getManifest().worldId;
    const entity = {
      id: args.entityId,
      assetRef: args.assetRef,
      kind,
      transform: { positionM: args.position || [0, 0, 0], rotationDeg: args.rotation || [0, 0, 0], scale: args.scale || [1, 1, 1] },
      materialRefs: args.materialRefs || [],
      relationships,
      seed: args.seed ?? (Number.isInteger(authorSeed) ? authorSeed : deriveSeed(worldId, args.entityId)),
      authorship
    };
    const candidate = session.preview(d => { d.entities.push(entity); });
    const { summary, warnings } = commitCandidate(candidate);
    const dims = archetype.dimensions.join('×');
    return ok({ ...summary, entity, warnings }, `Added ${kind} ${entity.id} [${entity.assetRef}] ${dims} m, seed ${entity.seed}.${warnings.length ? ` ${warnings.length} warning(s).` : ''}`);
  },

  move_entity(args) {
    rejectUnknownArgs(args, ['entityId', 'position', 'rotation']);
    const errors = [];
    checkId(args.entityId, 'entityId', errors);
    if (args.position === undefined && args.rotation === undefined) errors.push({ code: 'NOTHING_TO_DO', path: '$', message: 'Provide position and/or rotation' });
    if (args.position !== undefined) checkPosition(args.position, 'position', errors);
    if (args.rotation !== undefined) checkRotation(args.rotation, 'rotation', errors);
    throwIfIssues(errors);
    if (!session.findEntity(args.entityId)) throw new ToolError('NOT_FOUND', `Entity '${args.entityId}' not found`);
    const candidate = session.preview(d => {
      const e = d.entities.find(x => x.id === args.entityId);
      if (args.position) e.transform.positionM = args.position;
      if (args.rotation) e.transform.rotationDeg = args.rotation;
    });
    const { summary, warnings } = commitCandidate(candidate);
    return ok({ ...summary, warnings }, `Moved ${args.entityId}.`);
  },

  remove_entity(args) {
    rejectUnknownArgs(args, ['entityId']);
    const errors = [];
    checkId(args.entityId, 'entityId', errors);
    throwIfIssues(errors);
    if (!session.findEntity(args.entityId)) throw new ToolError('NOT_FOUND', `Entity '${args.entityId}' not found`);
    const dependents = session.getManifest().entities.filter(e => (e.relationships || []).some(r => r.target === args.entityId)).map(e => e.id);
    if (dependents.length) {
      throw new ToolError('HAS_DEPENDENTS', `Remove or re-parent dependents first: ${dependents.join(', ')}`, dependents.map(id => ({ code: 'DEPENDENT', path: id, message: `${id} references ${args.entityId}` })));
    }
    const candidate = session.preview(d => { d.entities = d.entities.filter(e => e.id !== args.entityId); });
    const { summary } = commitCandidate(candidate);
    return ok({ ...summary, warnings: [] }, `Removed ${args.entityId}.`);
  },

  replace_material(args) {
    rejectUnknownArgs(args, ['entityId', 'materialRefs']);
    const errors = [];
    checkId(args.entityId, 'entityId', errors);
    checkMaterials(args.materialRefs, 'materialRefs', errors);
    throwIfIssues(errors);
    if (!session.findEntity(args.entityId)) throw new ToolError('NOT_FOUND', `Entity '${args.entityId}' not found`);
    const candidate = session.preview(d => { d.entities.find(x => x.id === args.entityId).materialRefs = args.materialRefs; });
    const { summary, warnings } = commitCandidate(candidate);
    return ok({ ...summary, warnings }, `Materials for ${args.entityId}: ${args.materialRefs.join(', ') || 'archetype defaults'}.`);
  },

  set_lighting(args) {
    rejectUnknownArgs(args, ['preset']);
    const errors = [];
    checkLighting(args.preset, 'preset', errors);
    throwIfIssues(errors);
    const candidate = session.preview(d => { d.lighting = args.preset; });
    const { summary, warnings } = commitCandidate(candidate);
    return ok({ ...summary, warnings }, `Lighting: ${args.preset}.`);
  },

  validate_scene(args) {
    rejectUnknownArgs(args, []);
    const manifest = session.getManifest();
    const r = validateWorld(manifest);
    return ok({ valid: r.valid, errors: r.errors, warnings: r.warnings.slice(0, 50), stats: r.stats, sceneIdentity: session.sceneIdentity(manifest) },
      `${r.valid ? 'VALID' : 'INVALID'}: ${r.errors.length} error(s), ${r.warnings.length} warning(s), ${r.stats.entityCount} entities.`);
  },

  get_telemetry(args) {
    rejectUnknownArgs(args, ['includeManifest']);
    const manifest = session.getManifest();
    const archetypes = {};
    const materials = new Set();
    for (const e of manifest.entities) {
      archetypes[e.assetRef] = (archetypes[e.assetRef] || 0) + 1;
      (e.materialRefs || []).forEach(m => materials.add(m));
    }
    // Session state (authored), plus the last render that proved this identity, for cross-checking exports.
    const data = { ...worldSummary(manifest), authored: true, lighting: manifest.lighting, archetypes, materials: [...materials], lastVerifiedRender };
    if (args.includeManifest === true) {
      const currentIds = manifest.entities.map(entity => entity.id);
      if (!lastVerifiedRender || lastVerifiedRender.identityVerified !== true || lastVerifiedRender.authored !== true
        || !['live', 'headless'].includes(lastVerifiedRender.source)) {
        throw new ToolError('EVIDENCE_UNVERIFIED', 'Manifest export requires a verified live or headless render of the current session; render evidence first.');
      }
      if (!Number.isInteger(lastVerifiedRender.renderEpoch) || !sameIds(lastVerifiedRender.renderedEntityIds, currentIds)) {
        throw new ToolError('IDENTITY_STALE', 'Manifest export render epoch/entity binding is missing or stale; no manifest returned.');
      }
      const expectedRendererKind = lastVerifiedRender.source === 'live' ? 'live-studio' : 'headless-studio';
      const rendererBinding = lastVerifiedRender.renderer;
      const rendererComplete = rendererBinding && rendererBinding.kind === expectedRendererKind
        && typeof rendererBinding.instanceId === 'string'
        && (lastVerifiedRender.source === 'live'
          ? typeof rendererBinding.clientId === 'string' && typeof rendererBinding.connectionId === 'string'
          : typeof rendererBinding.headlessRunId === 'string');
      if (!rendererComplete) throw new ToolError('EVIDENCE_UNVERIFIED', 'Manifest export renderer binding is incomplete; no manifest returned.');
      let manifestExport;
      try {
        manifestExport = bindEvidenceRecord({
          operation: 'manifest-export',
          source: lastVerifiedRender.source,
          render: {
            sceneIdentity: lastVerifiedRender.sceneIdentity,
            sceneReference: lastVerifiedRender.sceneReference,
            zoneReference: null,
            rendererHash: lastVerifiedRender.rendererHash,
            renderPlanHash: lastVerifiedRender.renderPlanHash,
            epoch: lastVerifiedRender.renderEpoch,
            renderedEntityIds: lastVerifiedRender.renderedEntityIds
          },
          expectedScene: data.sceneReference,
          renderer: rendererBinding,
          camera: lastVerifiedRender.camera,
          artifactSha256: data.sourceManifestHash
        });
      } catch (error) {
        identityFailure(error);
      }
      data.manifest = manifest;
      data.manifestExport = { ...manifestExport, worldId: data.worldId, version: data.version, entityCount: currentIds.length };
    }
    return ok(data, `${data.worldId} v${data.version}: ${data.entityCount} entities, lighting ${data.lighting}, ${data.sceneIdentity} (authored; last verified render: ${lastVerifiedRender ? `${lastVerifiedRender.source} ${lastVerifiedRender.sceneIdentity}` : 'none'}).`);
  },

  async compile_preview(args) {
    rejectUnknownArgs(args, ['timeoutMs']);
    const timeoutMs = Number.isInteger(args.timeoutMs) ? Math.min(Math.max(args.timeoutMs, 500), 30000) : 10000;
    const manifest = session.getManifest();
    const previewProfile = manifest.entities.length > 0 && manifest.entities.every(entity => entity.assetRef?.startsWith('mtx.')) ? 'mtx_preview' : 'diorama';
    const report = validateWorld(manifest);
    if (!report.valid) throw new ToolError('CONTRACT_VIOLATION', 'World is invalid; not pushed to preview', report.errors);
    const summary = worldSummary(manifest);
    const warnings = formatIssues(report.warnings).slice(0, 15);
    if (!bridge) {
      return ok({ ...summary, studioUrl: STUDIO_URL, warnings, bridge: bridgeInfo(), livePreview: false, ack: null, budget: evaluateBudget(previewProfile, null) },
        'Valid world; live preview bridge disabled (ARTISAN_BRIDGE=off).');
    }
    await bridge.ready();
    if (bridge.state() === 'conflict') await bridge.reacquire(); // lazy: the owner may have exited
    if (bridge.state() === 'conflict') {
      const owner = bridge.owner();
      throw new ToolError('BRIDGE_CONFLICT', bridge.conflictMessage(), [{ code: 'BRIDGE_CONFLICT', path: 'bridge', message: `port ${bridge.port} owner: ${owner?.kind}${owner?.instanceId ? ` ${owner.instanceId}` : ''}; this instance ${bridge.instanceId}` }]);
    }
    const studioUrl = bridge.pinnedStudioUrl();
    const base = { ...summary, studioUrl, warnings, bridge: bridgeInfo() };
    // A tab that has just connected gets its handshake window before it is judged unverified.
    for (let t = Date.now(); bridge.clientCount() === 0 && bridge.handshakesInFlight() > 0 && Date.now() - t < HANDSHAKE_GRACE_MS + 250;) await new Promise(r => setTimeout(r, 50));
    if (bridge.clientCount() === 0) {
      if (bridge.unverifiedCount() > 0) {
        throw new ToolError('STUDIO_UNVERIFIED', `${bridge.unverifiedCount()} Studio tab(s) on port ${bridge.port} never completed the protocol-v2 handshake with MCP instance ${bridge.instanceId} (a stale pre-P0.5 page?). Reload the tab or open ${studioUrl}.`);
      }
      return ok({ ...base, livePreview: false, ack: null, budget: evaluateBudget(previewProfile, null) },
        `Valid world; no live Studio connected to MCP instance ${bridge.instanceId.slice(0, 8)}. Open ${studioUrl} to preview.`);
    }
    const expect = { worldId: summary.worldId, version: summary.version, entityCount: summary.entityCount, sceneIdentity: summary.sceneIdentity };
    // Identity is verified field by field below (a spoofed or stale ack is ACK_MISMATCH, never a silent timeout).
    const res = await bridge.request('MANIFEST', { expect, manifest }, timeoutMs, { verifyIdentity: false });
    const ack = res.msg;
    if (ack.ok !== true) throw new ToolError('COMPILE_FAILED', `Studio rejected the manifest: ${String(ack.error || 'unknown').slice(0, 300)}`);
    const r = ack.render || {};
    const ids = manifest.entities.map(e => e.id);
    verifyRenderedScene(r, summary.sceneReference, ids);
    const rendered = Array.isArray(r.renderedEntityIds) ? r.renderedEntityIds : (Array.isArray(ack.renderedEntityIds) ? ack.renderedEntityIds : null);
    const issues = [];
    const expectField = (path, got, want) => { if (got !== want) issues.push({ code: 'ACK_MISMATCH', path, message: `${path}: expected ${JSON.stringify(want)}, Studio reported ${JSON.stringify(got ?? null)}` }); };
    expectField('instanceId', ack.instanceId, bridge.instanceId);
    expectField('clientId', ack.clientId, res.clientId);
    expectField('sceneIdentity', r.sceneIdentity ?? null, summary.sceneIdentity);
    if (ack.sceneIdentity !== undefined && ack.sceneIdentity !== r.sceneIdentity) expectField('sceneIdentity', ack.sceneIdentity, summary.sceneIdentity);
    if (ack.identityError) issues.push({ code: 'ACK_MISMATCH', path: 'sceneIdentity', message: `Studio could not compute the identity: ${String(ack.identityError).slice(0, 80)}` });
    expectField('worldId', r.worldId ?? null, summary.worldId);
    expectField('version', r.version ?? null, summary.version);
    expectField('entityCount', ack.entityCount ?? null, summary.entityCount);
    if (!sameIds(rendered, ids)) {
      const missing = ids.filter(id => !(rendered || []).includes(id));
      const extra = (rendered || []).filter(id => !ids.includes(id));
      issues.push({ code: 'ACK_MISMATCH', path: 'renderedEntityIds', message: `rendered ${rendered ? rendered.length : 'no'} entities; missing [${missing.slice(0, 8).join(', ')}] extra [${extra.slice(0, 8).join(', ')}]` });
    }
    if (issues.length) {
      throw new ToolError('ACK_MISMATCH', `The Studio acknowledgement does not prove the authored world (${[...new Set(issues.map(i => i.path))].join(', ')}); nothing is reported as previewed.`, issues);
    }
    bridge.setPrimary(res.clientId);
    const compileEvidence = evidenceEnvelope({ operation: 'compile-ack', source: 'live', render: r, clientId: res.clientId, connectionId: res.connectionId });
    noteVerifiedRender(compileEvidence);
    const drawCalls = r.drawCalls ?? ack.drawCalls ?? null;
    const triangles = r.triangles ?? ack.triangles ?? null;
    const settled = (r.settled ?? ack.settled) === true;
    const ackData = { sceneIdentity: r.sceneIdentity, sceneReference: r.sceneReference, rendererHash: r.rendererHash, renderPlanHash: r.renderPlanHash, worldId: r.worldId, version: r.version, entityCount: ack.entityCount, renderedEntityIds: rendered, instanceId: ack.instanceId, clientId: ack.clientId, connectionId: res.connectionId, drawCalls, triangles, settled, warnings: ack.warnings, render: { drawCalls, triangles, settled }, evidence: compileEvidence };
    const budget = evaluateBudget(previewProfile, { drawCalls, triangles, settled });
    return ok({ ...base, livePreview: true, ack: ackData, budget },
      `Preview compiled and verified in Studio ${res.clientId.slice(0, 8)} (${r.sceneIdentity}): ${ackData.entityCount} entities, ${drawCalls ?? '?'} draws, ${triangles ?? '?'} tris${settled ? '' : ' (NOT settled)'} (${previewProfile} max ${budget.drawCallsMax} draws / ${budget.trianglesTarget} tris).`);
  },

  async get_engine_telemetry(args) {
    rejectUnknownArgs(args, ['profile']);
    const errors = [];
    optionalEnum(args.profile, PROFILE_IDS, 'profile', errors);
    throwIfIssues(errors);
    const target = await resolveAuthoredTarget();
    let telemetry, evidence;
    if (target.source === 'live') {
      const res = await bridge.request('GET_TELEMETRY', { frames: 120 }, 30000, { clientId: target.clientId });
      assertLiveRender(res.msg.render, target);
      telemetry = res.msg.telemetry || {};
      evidence = evidenceEnvelope({ operation: 'telemetry', source: 'live', render: res.msg.render, clientId: res.clientId, connectionId: res.connectionId, camera: telemetry.camera });
    } else {
      const r = await renderEvidence({ manifest: session.getManifest(), expectedIdentity: session.sceneIdentity(), expectedSceneReference: session.sceneReference(), want: ['telemetry'], frames: 120 });
      telemetry = r.telemetry;
      evidence = evidenceEnvelope({ operation: 'telemetry', source: 'headless', render: r.render, headlessRunId: r.headlessRunId, camera: r.camera });
    }
    noteVerifiedRender(evidence);
    const t = pick(telemetry, TELEMETRY_KEYS);
    const budget = evaluateBudget(args.profile || 'diorama', t);
    return ok({ source: target.source, sceneIdentity: evidence.sceneIdentity, telemetry: t, budget, evidence },
      `${sourceTag(target.source)} ${evidence.sceneIdentity}: ${t.gpu || 'unknown GPU'}${t.isSoftwareRasterizer ? ' (SOFTWARE)' : ''}: ${t.fps ?? '?'} FPS (p95 ${t.frametimeP95Ms ?? '?'} ms), ${t.drawCalls ?? '?'} draws (max ${budget.drawCallsMax}), ${t.triangles ?? '?'} tris${t.settled ? '' : ' (NOT settled)'}.`);
  },

  async run_performance_audit(args) {
    rejectUnknownArgs(args, ['scene']);
    const errors = [];
    optionalEnum(args.scene, SCENE_INPUTS, 'scene', errors);
    throwIfIssues(errors);
    const requestedRoute = requestSceneRoute(args.scene);
    const targets = requestedRoute.sceneReference
      ? {
          json: identityArtifactPath(requestedRoute.sceneReference, 'perf_audit_report.json', requestedRoute.zoneReference),
          md: identityArtifactPath(requestedRoute.sceneReference, 'perf_audit_report.md', requestedRoute.zoneReference)
        }
      : { json: safeArtifactPath('perf_audit_report', '.json'), md: safeArtifactPath('perf_audit_report', '.md') };
    let report, jsonPath, mdPath, evidence, source;
    const target = args.scene ? await resolvePresetTarget() : await resolveAuthoredTarget();
    source = target.source;
    if (source === 'live') {
      if (args.scene) await bridge.request('SET_SCENE', { scene: args.scene }, 5000, { clientId: target.clientId });
      const res = await bridge.request('RUN_AUDIT', {}, 120000, { clientId: target.clientId });
      report = res.msg.report;
      if (!report) throw new ToolError('PROFILER_UNAVAILABLE', 'Live Studio returned no audit report');
      if (args.scene) assertPresetRender(res.msg.render, args.scene);
      else assertLiveRender(res.msg.render, target);
      if (report.scene && (report.scene.epochStart !== report.scene.epochEnd || (!args.scene && report.scene.sceneIdentity !== session.sceneIdentity()))) {
        throw new ToolError('PREVIEW_STALE', `The Studio scene changed during the audit (${report.scene.sceneIdentity}, epoch ${report.scene.epochStart} -> ${report.scene.epochEnd}); nothing was written.`);
      }
      evidence = evidenceEnvelope({ operation: 'performance-report', source: 'live', render: res.msg.render, clientId: res.clientId, connectionId: res.connectionId, preset: args.scene });
      jsonPath = writeArtifactAt(targets.json, JSON.stringify({ ...report, evidence }, null, 2));
      mdPath = res.msg.markdown ? writeArtifactAt(targets.md, `${res.msg.markdown}\n\n<!-- evidence: ${JSON.stringify(evidence)} -->\n`) : null;
    } else {
      const r = await renderEvidence(args.scene
        ? { scene: args.scene, want: ['audit'], targets, envelope: (x) => evidenceEnvelope({ operation: 'performance-report', source: 'headless', render: x.render, headlessRunId: x.headlessRunId, camera: x.camera, inFrustum: x.inFrustum, preset: args.scene }) }
        : { manifest: session.getManifest(), expectedIdentity: session.sceneIdentity(), expectedSceneReference: session.sceneReference(), want: ['audit'], targets, envelope: (x) => evidenceEnvelope({ operation: 'performance-report', source: 'headless', render: x.render, headlessRunId: x.headlessRunId, camera: x.camera }) });
      report = r.audit.report;
      evidence = r.evidence;
      ({ json: jsonPath, md: mdPath = null } = r.paths);
    }
    if (jsonPath && fs.existsSync(jsonPath)) evidence = { ...evidence, artifactSha256: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(jsonPath)).digest('hex') };
    if (!args.scene) noteVerifiedRender(evidence);
    const tm = report.telemetry || {};
    const metrics = pick({
      baselineFrametimeMs: tm.baselineFrametime, baselineP99Ms: tm.baselineP99, jitterMs: tm.baselineJitter, baselineFps: report.baselineFps,
      shadowRebakePenaltyMs: tm.shadowRebakePenaltyMs, envMapCostMs: tm.envMapCostMs, dprCostMs: tm.dprCostMs,
      gpu: report.device?.gpu ?? report.device?.gpuRenderer
    }, ['baselineFrametimeMs', 'baselineP99Ms', 'jitterMs', 'baselineFps', 'shadowRebakePenaltyMs', 'envMapCostMs', 'dprCostMs', 'gpu']);
    const smokingGuns = (report.smokingGuns || []).slice(0, 5).map(sg => pick(sg, ['severity', 'culprit', 'impactMs', 'status', 'repairApplied']));
    const scene = args.scene || 'authored';
    return ok({ source, scene, sceneIdentity: evidence.sceneIdentity, verdict: String(report.verdict || 'UNKNOWN'), metrics, smokingGuns, artifacts: { json: jsonPath, markdown: mdPath }, evidence },
      `${sourceTag(source)} audit ${evidence.sceneIdentity}: ${report.verdict}; baseline ${metrics.baselineFrametimeMs?.toFixed?.(2) ?? '?'} ms; ${smokingGuns.length} observation(s). Report: ${jsonPath}`);
  },

  async capture_viewport_screenshot(args) {
    rejectUnknownArgs(args, ['filename', 'angle', 'scene']);
    const errors = [];
    optionalEnum(args.angle, CAMERA_ANGLES, 'angle', errors);
    optionalEnum(args.scene, SCENE_INPUTS, 'scene', errors);
    if (args.filename !== undefined && (typeof args.filename !== 'string' || args.filename.length > 120)) errors.push({ code: 'INVALID_FILENAME', path: 'filename', message: 'filename must be a string of at most 120 chars' });
    throwIfIssues(errors);
    let rel;
    try { rel = safeArtifactRelPath(args.filename, '.png', 'artisan_capture', { mkdir: false }); }
    catch (err) {
      const code = String(err.message).split(':')[0];
      throw new ToolError(code === 'ARTIFACT_PATH_ESCAPE' ? code : 'INVALID_FILENAME', String(err.message).replace(/^[A-Z_]+:\s*/, '').slice(0, 200), [{ code, path: 'filename', message: String(err.message).slice(0, 200) }]);
    }
    const requestedRoute = requestSceneRoute(args.scene);
    const target = requestedRoute.sceneReference ? identityArtifactPath(requestedRoute.sceneReference, rel.relative, requestedRoute.zoneReference) : rel.path;
    const tgt = args.scene ? await resolvePresetTarget() : await resolveAuthoredTarget();
    let png, width, height, evidence;
    if (tgt.source === 'live') {
      if (args.scene) await bridge.request('SET_SCENE', { scene: args.scene }, 5000, { clientId: tgt.clientId });
      const res = await bridge.request('CAPTURE_SCREENSHOT', args.angle ? { angle: args.angle } : {}, 30000, { clientId: tgt.clientId });
      const m = res.msg;
      if (m.error) throw new ToolError('PREVIEW_STALE', `Studio capture refused: ${String(m.error).slice(0, 200)}`);
      if (args.scene) assertPresetRender(m.render, args.scene);
      else assertLiveRender(m.render, tgt);
      const prefix = 'data:image/png;base64,';
      if (typeof m.dataUrl !== 'string' || !m.dataUrl.startsWith(prefix)) throw new ToolError('CAPTURE_FAILED', 'Studio returned no PNG data');
      png = Buffer.from(m.dataUrl.slice(prefix.length), 'base64');
      ({ width, height } = m);
      evidence = evidenceEnvelope({ operation: 'screenshot', source: 'live', render: m.render, clientId: res.clientId, connectionId: res.connectionId, camera: m.camera, inFrustum: m.inFrustum, preset: args.scene });
      writeArtifactAt(target, png);
    } else {
      const r = await renderEvidence(args.scene
        ? { scene: args.scene, angle: args.angle, want: ['capture'], targets: { png: target } }
        : { manifest: session.getManifest(), expectedIdentity: session.sceneIdentity(), expectedSceneReference: session.sceneReference(), angle: args.angle, want: ['capture'], targets: { png: target } });
      png = r.capture.png;
      ({ width, height } = r.capture);
      evidence = evidenceEnvelope({ operation: 'screenshot', source: 'headless', render: r.render, headlessRunId: r.headlessRunId, camera: r.capture.camera, inFrustum: r.capture.inFrustum, preset: args.scene });
    }
    if (!args.scene) noteVerifiedRender(evidence);
    const pngSha256 = crypto.createHash('sha256').update(png).digest('hex');
    evidence = { ...evidence, artifactSha256: 'sha256:' + pngSha256 };
    return ok({ source: tgt.source, sceneIdentity: evidence.sceneIdentity, requestedFilename: args.filename ?? null, path: target, bytes: png.length, pngSha256, width, height, normalized: rel.normalized, evidence },
      `${sourceTag(tgt.source)} canvas ${width}x${height} of ${evidence.sceneIdentity}${evidence.inFrustum ? ` (${evidence.inFrustum.length}/${evidence.entityCount} entities in frustum)` : ''}: ${png.length} bytes -> ${target}`);
  },

  export_mtx_manifest(args) {
    rejectUnknownArgs(args, []);
    const manifest = session.getManifest();
    const validation = validateWorld(manifest);
    if (!validation.valid) throw new ToolError('CONTRACT_VIOLATION', 'World is invalid; no MTX artifact written', validation.errors);
    // Reuse the established render-epoch/entity binding gate. A stale or unverified preview cannot export.
    const verified = HANDLERS.get_telemetry({ includeManifest: true }).structuredContent;
    let projected;
    try { projected = buildMtxManifest(manifest, verified.sceneReference); }
    catch (error) {
      const message = String(error?.message || error);
      throw new ToolError(message.split(':')[0], message);
    }
    const bytes = Buffer.from(JSON.stringify(projected, null, 2) + '\n', 'utf8');
    const hash = 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
    const file = identityArtifactPath(verified.sceneReference, `mtx_world_1_${verified.sourceManifestHash.slice(7)}.json`);
    if (fs.existsSync(file)) {
      if (!fs.readFileSync(file).equals(bytes)) throw new ToolError('ARTIFACT_CONFLICT', 'Content-addressed MTX export already exists with different bytes');
    } else {
      writeArtifactAt(file, bytes);
    }
    return ok({ path: file, sceneIdentity: verified.sceneIdentity, sourceManifestHash: verified.sourceManifestHash, artifactSha256: hash, schemaVersion: projected.schemaVersion },
      `MTX Hardline manifest ${verified.sceneIdentity} -> ${file}`);
  },

  async import_telemetry_logs(args) {
    rejectUnknownArgs(args, []);
    const target = await resolveAuthoredTarget();
    const manifest = session.getManifest();
    let telemetry, evidence;
    if (target.source === 'live') {
      const res = await bridge.request('GET_TELEMETRY', { frames: 60 }, 30000, { clientId: target.clientId });
      assertLiveRender(res.msg.render, target);
      telemetry = res.msg.telemetry || {};
      evidence = evidenceEnvelope({ operation: 'telemetry-import', source: 'live', render: res.msg.render, clientId: res.clientId, connectionId: res.connectionId, camera: telemetry.camera });
    } else {
      const r = await renderEvidence({ manifest, expectedIdentity: session.sceneIdentity(manifest), expectedSceneReference: session.sceneReference(manifest), want: ['telemetry'], frames: 60 });
      telemetry = r.telemetry;
      evidence = evidenceEnvelope({ operation: 'telemetry-import', source: 'headless', render: r.render, headlessRunId: r.headlessRunId, camera: r.camera });
    }
    if (evidence.identityVerified !== true) throw new ToolError('EVIDENCE_UNVERIFIED', `Telemetry could not be bound to the authored world (${evidence.sceneIdentity}); no file written.`);
    noteVerifiedRender(evidence);
    const file = identityArtifactPath(session.sceneReference(manifest), 'telemetry_import_' + Date.now() + '.json');
    writeArtifactAt(file, JSON.stringify({ timestamp: new Date().toISOString(), evidence, telemetry, manifest }, null, 2));
    evidence = { ...evidence, artifactSha256: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
    return ok({ path: file, source: target.source, sceneIdentity: evidence.sceneIdentity, evidence }, `${sourceTag(target.source)} verified telemetry of ${evidence.sceneIdentity} -> ${file}`);
  }
};

// ---------------------------------------------------------------- resources
function readKnowledge(name) {
  return fs.readFileSync(path.join(KNOWLEDGE_DIR, name), 'utf8');
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8')); } catch { return null; }
}

const oneLine = (catalog, keys) => Object.fromEntries(Object.entries(catalog).map(([id, v]) => [id, pick(v, keys)]));

/** artisan://capabilities previewBridge block (protocol v2): state, identity, clients, conflict owner + remediation. */
function previewBridgeCapabilities() {
  const note = 'Loopback WebSocket used only to push manifests to the local Studio page; not an MCP transport.';
  if (!bridge) return { state: 'disabled', protocol: null, instanceId: null, host: null, port: null, listening: false, studioClients: 0, unverifiedClients: 0, note: `${note} Disabled by ARTISAN_BRIDGE=off.` };
  const state = bridge.state();
  return {
    state, protocol: bridge.protocol, instanceId: bridge.instanceId, pid: bridge.pid, startedAt: bridge.startedAt,
    host: bridge.host, port: bridge.port, listening: bridge.isListening(),
    studioClients: bridge.clientCount(), unverifiedClients: bridge.unverifiedCount(), clients: bridge.clients(), primaryClientId: bridge.primaryClientId(),
    studioUrl: bridge.pinnedStudioUrl(),
    ...(state === 'conflict' ? { owner: bridge.owner(), remediation: bridge.remediation() } : {}),
    note
  };
}

const RESOURCES = {
  'artisan://essence': { name: 'Artisan essence & authoring contract', mimeType: 'text/markdown', read: () => readKnowledge('essence.md') },
  'artisan://contract': {
    name: 'Canonical contract (coordinates, relationships, seeds, limits, budgets)', mimeType: 'application/json',
    read: () => ({ contractVersion: CONTRACT_VERSION, coordinates: COORDINATE_SYSTEM, relationships: { shape: '[{type, target, anchor?}]', types: RELATIONSHIP_TYPES, defaultGround: DEFAULT_GROUND_TARGET, selfSupportingCategories: SELF_SUPPORTING_CATEGORIES }, seeds: { rule: 'explicit seed, else FNV-1a(worldId::entityId) in [1, seedMax]' }, lighting: LIGHTING_PRESETS, limits: LIMITS, performance: PERFORMANCE_PROFILES })
  },
  'artisan://schema/world': { name: 'World manifest JSON Schema', mimeType: 'application/schema+json', read: () => WORLD_SCHEMA },
  'artisan://catalog/archetypes': { name: 'Archetype index', mimeType: 'application/json', read: () => oneLine(ARCHETYPE_CATALOG, ['category', 'dimensions', 'description']) },
  'artisan://catalog/materials': { name: 'Material index', mimeType: 'application/json', read: () => Object.fromEntries(Object.entries(MATERIAL_CATALOG).map(([id, v]) => [id, v.description])) },
  'artisan://capabilities': {
    name: 'Studio capabilities & preset scenes', mimeType: 'application/json',
    read: () => ({
      serverVersion: SERVER_VERSION, contractVersion: CONTRACT_VERSION, transport: 'stdio',
      previewBridge: previewBridgeCapabilities(),
      studioUrl: STUDIO_URL, artifactsDir: ARTIFACTS_DIR,
      presetScenes: PRESET_SCENES, cameraAngles: CAMERA_ANGLES,
      workflow: ['create_world', 'add_entity', 'validate_scene', 'compile_preview', 'get_engine_telemetry', 'capture_viewport_screenshot']
    })
  },
  'artisan://governance': {
    name: 'Governance & harness summary (PLAN / HARNESS-SIJ)', mimeType: 'application/json',
    read: () => {
      const plan = readJsonSafe('PLAN.json');
      const sij = readJsonSafe('HARNESS-SIJ.json');
      const count = (arr, key) => (arr || []).reduce((a, n) => { const k = n?.[key] ?? 'unspecified'; a[k] = (a[k] || 0) + 1; return a; }, {});
      return {
        mission: plan?.mission ?? null,
        arcs: (plan?.arcs || []).map(a => a.id),
        nodes: { total: plan?.nodes?.length ?? 0, byKind: count(plan?.nodes, 'kind'), byStatus: count(plan?.nodes, 'status') },
        gates: { governance: 'python scripts/gate.py', spatial: 'node test_spatial_laws.js', harness: 'node scripts/verify_astra_harness.mjs', contractDrift: 'node scripts/check_contract_drift.mjs' },
        cabinets: { framework: sij?.governance?.framework ?? null, rule: sij?.governance?.rule ?? null, count: Array.isArray(sij?.cabinets) ? sij.cabinets.length : Object.keys(sij?.cabinets || {}).length, thresholds: sij?.global_thresholds ?? null }
      };
    }
  },
  'artisan://findings': {
    name: 'Findings & known limits', mimeType: 'application/json',
    read: () => {
      const f = readJsonSafe('FINDINGS.json');
      return {
        findings: (f?.findings || []).map(x => pick(x, ['id', 'title', 'status', 'severity', 'opened_on'])),
        knownLimits: [
          'Evidence (screenshot, engine telemetry, telemetry export, audit) without `scene` is the authored world: the verified live Studio when it proves the session identity (else PREVIEW_STALE), otherwise a headless render that proves the identity before any file is written.',
          'Budgets are judged on settled frames (shadow-bake passes excluded); withinBudget is null when the Studio could not settle.',
          'One MCP instance owns the live bridge port; any other reports BRIDGE_CONFLICT (headless evidence keeps working). Pin a Studio tab with ?mcpPort=N&mcpInstance=<id>.',
          'World state is in-memory per MCP process; persist by reading get_telemetry {includeManifest:true}.'
        ]
      };
    }
  }
};

const TEMPLATES = [
  { uriTemplate: 'artisan://archetype/{id}', name: 'One archetype (dimensions, anchors, meso features)', mimeType: 'application/json' },
  { uriTemplate: 'artisan://material/{id}', name: 'One material (PBR parameters)', mimeType: 'application/json' }
];

// Legacy URIs from the v1 server, kept readable (not listed).
const LEGACY = { 'materials://catalog': 'artisan://catalog/materials', 'archetypes://catalog': 'artisan://catalog/archetypes', 'schemas://world': 'artisan://schema/world' };

function resourceBody(uri, mimeType, value) {
  return { contents: [{ uri, mimeType, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

// ---------------------------------------------------------------- server wiring
const server = new Server(
  { name: 'artisan-3d', version: SERVER_VERSION },
  {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: 'Artisan 3D Studio: author declarative 3D worlds from catalog archetypes; never write Three.js. Read artisan://essence once per task; catalogs, schema and budgets are resources. Workflow: create_world → add_entity → validate_scene → compile_preview → get_engine_telemetry → capture_viewport_screenshot.'
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params?.name;
  const args = request.params?.arguments ?? {};
  const handler = HANDLERS[name];
  if (!handler) return fail('UNKNOWN_TOOL', `Unknown tool: ${name}`);
  if (typeof args !== 'object' || Array.isArray(args)) return fail('INVALID_ARGUMENT', 'arguments must be an object');
  try {
    return await handler(args);
  } catch (err) {
    if (err instanceof ToolError) return fail(err.code, err.message, err.issues);
    const msg = String(err?.message || err).slice(0, 300);
    const code = msg.split(':')[0].match(/^[A-Z_]+$/) ? msg.split(':')[0] : 'INTERNAL_ERROR';
    return fail(code, msg);
  }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: Object.entries(RESOURCES).map(([uri, r]) => ({ uri, name: r.name, mimeType: r.mimeType }))
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: TEMPLATES }));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const requested = request.params?.uri;
  const uri = LEGACY[requested] || requested;
  if (RESOURCES[uri]) return resourceBody(requested, RESOURCES[uri].mimeType, RESOURCES[uri].read());
  let m = /^artisan:\/\/archetype\/([A-Za-z0-9._-]+)$/.exec(uri || '');
  if (m && ARCHETYPE_CATALOG[m[1]]) return resourceBody(requested, 'application/json', { id: m[1], ...ARCHETYPE_CATALOG[m[1]] });
  m = /^artisan:\/\/material\/([A-Za-z0-9._-]+)$/.exec(uri || '');
  if (m && MATERIAL_CATALOG[m[1]]) return resourceBody(requested, 'application/json', { id: m[1], ...MATERIAL_CATALOG[m[1]] });
  throw new McpError(ErrorCode.InvalidParams, `Resource not found: ${String(requested).slice(0, 120)}`);
});

const PROMPTS = [
  { name: 'authoring-manual', description: 'Artisan essence and authoring contract as a working brief' },
  { name: 'scene-template', description: 'Guided create_world → add_entity → preview sequence for a theme', arguments: [{ name: 'theme', description: 'e.g. "alpine smithy"', required: true }] }
];

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const name = request.params?.name;
  const args = request.params?.arguments || {};
  if (name === 'authoring-manual') {
    return {
      description: 'Artisan authoring brief',
      messages: [{ role: 'user', content: { type: 'text', text: `Follow this Artisan 3D authoring contract for the rest of the task.\n\n${readKnowledge('essence.md')}` } }]
    };
  }
  if (name === 'scene-template') {
    const theme = String(args.theme || '').trim().slice(0, 120);
    if (!theme) throw new McpError(ErrorCode.InvalidParams, 'Missing required argument: theme');
    return {
      description: `Scene template: ${theme}`,
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Author an Artisan 3D world themed "${theme}".`,
            '1. Read artisan://essence and artisan://catalog/archetypes (fetch artisan://archetype/{id} for anchors when stacking).',
            '2. create_world with a semantic worldId and a lighting preset.',
            '3. add_entity: one architecture shell first, then furniture/workshop pieces on the floor, then clutter attached to surfaces via parent + anchor. Pass explicit seeds for repeatability.',
            '4. validate_scene until valid with no Law A warnings.',
            '5. compile_preview, then get_engine_telemetry and confirm the diorama budget; capture_viewport_screenshot for review.'
          ].join('\n')
        }
      }]
    };
  }
  throw new McpError(ErrorCode.InvalidParams, `Prompt not found: ${String(name).slice(0, 80)}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Artisan 3D MCP ${SERVER_VERSION} on stdio (contract ${CONTRACT_VERSION}; artifacts ${ARTIFACTS_DIR})`);

const shutdown = async () => { try { await bridge?.close(); } finally { process.exit(0); } };
process.stdin.on('close', shutdown);
process.on('SIGTERM', shutdown);
