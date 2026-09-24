import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './test_stdio_client.js';
import { buildMtxManifest, validateMtxWorld, MTX_COMPILER } from './mtxExport.js';
import { AXIS, CONTRACT_VERSION } from '../src/contracts/artisanContract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const surfaces = ['mtx.neutral.black_lacquer', 'mtx.glass.cyan', 'mtx.signal.green_code'];
const source = { sceneIdentity: 'sha256:' + 'a'.repeat(32), sourceManifestHash: 'sha256:' + 'a'.repeat(64) };
const artifacts = process.env.ARTISAN_ARTIFACTS_DIR || path.join(root, '.artisan-artifacts');
const world = { worldId: 'hardline_pilot', version: 2, contractVersion: CONTRACT_VERSION, units: 'meter', axis: AXIS,
  entities: [{ id: 'hardline.001', assetRef: 'mtx.fixture.hardline_booth', transform: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] }, seed: 42, materialRefs: surfaces }] };
const projected = buildMtxManifest(world, source);
assert.deepEqual(projected.entities[0].dimensionsM, [1.1, 2.55, 1.1]);
assert.deepEqual(projected.entities[0].anchors.frontInteractionM, [0, 0, 0.85]);
assert.deepEqual(projected.entities[0].collision.centerM, [0, 1.275, 0]);
assert.equal(projected.entities[0].interaction.reachM, 1.25);
assert.throws(() => buildMtxManifest({ ...world, entities: [{ ...world.entities[0], assetRef: 'storage.crate' }] }, source), /MTX_ARCHETYPE/);
assert.throws(() => buildMtxManifest({ ...world, entities: [{ ...world.entities[0], materialRefs: ['wood.dark_oak'] }] }, source), /MTX_SURFACE/);
assert.throws(() => buildMtxManifest({ ...world, entities: [] }, source), /MTX_PILOT_SCOPE/);
assert.equal(projected.requires.compiler, MTX_COMPILER);
assert.equal(projected.rotationOrder, 'XYZ');
assert.deepEqual(projected.entities[0].clearance, [{ id: 'front', kind: 'box', sizeM: [1.2, 2, 1.2], centerM: [0, 1, 1.15] }]);
assert.equal(projected.entities[0].interaction.anchor, 'frontInteractionM');
assert.equal(projected.entities[0].collision.class, 'static_solid');
assert.deepEqual(validateMtxWorld(projected), []);
assert.throws(() => buildMtxManifest({ ...world, entities: [{ ...world.entities[0], transform: { ...world.entities[0].transform, scale: [2, 1, 1] } }] }, source), /MTX_SCALE/);
assert.throws(() => buildMtxManifest(world, { ...source, sceneIdentity: 'sha256:' + 'b'.repeat(32) }), /MTX_IDENTITY/);
assert.throws(() => buildMtxManifest({ ...world, contractVersion: '1.0.0' }, source), /MTX_CONTRACT_VERSION/);
// The validator is what refuses a hand-edited artifact: each mutation must be named, never repaired.
const mutate = (fn) => { const d = JSON.parse(JSON.stringify(projected)); fn(d); return validateMtxWorld(d); };
assert.notDeepEqual(mutate(d => { d.schemaVersion = 'mtx.world/2'; }), []);
assert.notDeepEqual(mutate(d => { d.requires.compiler = 'mtx.v2.compiler/0'; }), []);
assert.notDeepEqual(mutate(d => { d.entities[0].geometry = []; }), []);
assert.notDeepEqual(mutate(d => { d.entities[0].interaction.anchor = 'nope'; }), []);
assert.notDeepEqual(mutate(d => { d.entities.push(JSON.parse(JSON.stringify(d.entities[0]))); }), []);

const client = await connect({ ARTISAN_ARTIFACTS_DIR: artifacts });
try {
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const tools = (await client.listTools()).tools;
  assert(tools.some(tool => tool.name === 'export_mtx_manifest'));
  assert.equal((await call('create_world', { worldId: 'hardline_pilot' })).structuredContent.ok, true);
  const added = await call('add_entity', { entityId: 'hardline.001', assetRef: 'mtx.fixture.hardline_booth', seed: 42, materialRefs: surfaces });
  assert.equal(added.structuredContent.ok, true);
  assert.equal((await call('validate_scene')).structuredContent.valid, true);
  const premature = await call('export_mtx_manifest');
  assert.equal(premature.structuredContent.error.code, 'EVIDENCE_UNVERIFIED');
  const preview = await call('compile_preview');
  assert.equal(preview.structuredContent.budget.profile, 'mtx_preview');
  const telemetry = await call('get_engine_telemetry', { profile: 'mtx_preview' });
  assert.equal(telemetry.structuredContent.ok, true, telemetry.content?.[0]?.text);
  assert.equal(telemetry.structuredContent.evidence.identityVerified, true);
  const first = await call('export_mtx_manifest');
  assert.equal(first.structuredContent.ok, true, first.content?.[0]?.text);
  const receipt = first.structuredContent;
  assert(fs.existsSync(receipt.path));
  const artifact = JSON.parse(fs.readFileSync(receipt.path, 'utf8'));
  assert.equal(artifact.schemaVersion, 'mtx.world/1');
  assert.equal(artifact.source.sceneIdentity, receipt.sceneIdentity);
  assert.deepEqual(artifact.entities[0].materialRefs, surfaces);
  assert.deepEqual(validateMtxWorld(artifact), []);
  assert.equal(artifact.source.sourceManifestHash, receipt.sourceManifestHash);
  assert.equal(receipt.artifactSha256, 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(receipt.path)).digest('hex'));
  const second = await call('export_mtx_manifest');
  assert.equal(second.structuredContent.path, receipt.path);
  assert.equal(second.structuredContent.artifactSha256, receipt.artifactSha256);
  console.log(JSON.stringify({ result: 'PASS', path: receipt.path, sceneIdentity: receipt.sceneIdentity,
    sourceManifestHash: receipt.sourceManifestHash, artifactSha256: receipt.artifactSha256,
    gpu: telemetry.structuredContent.telemetry.gpu, drawCalls: telemetry.structuredContent.telemetry.drawCalls,
    triangles: telemetry.structuredContent.telemetry.triangles }));
} finally {
  await client.close();
}
