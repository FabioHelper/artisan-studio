import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './test_stdio_client.js';
import { buildMtxManifest } from './mtxExport.js';
import { AXIS, CONTRACT_VERSION } from '../src/contracts/artisanContract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const surfaces = ['mtx.neutral.black_lacquer', 'mtx.glass.cyan', 'mtx.signal.green_code'];
const source = { sceneIdentity: 'sha256:' + 'a'.repeat(32), sourceManifestHash: 'sha256:' + 'a'.repeat(64) };
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

const client = await connect({ ARTISAN_ARTIFACTS_DIR: path.join(root, '.artisan-artifacts') });
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
