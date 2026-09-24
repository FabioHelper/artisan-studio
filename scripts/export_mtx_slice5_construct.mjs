// MTX Slice 5: author the tiny white Construct through the MCP and export it as one
// multi-entity mtx.world/1 layout. Three placements: the Construct floor, the artifact plinth
// (the Program artifact's socket) and a Hardline booth as the exit back to the plaza.
// Every placement carries an explicit seed. The layout is validated with zero warnings, rendered
// headless (identity-verified), screenshotted and exported.
// Needs the Studio dev server (npm run dev) and a Chromium browser (ARTISAN_BROWSER_PATH on Linux).
// Usage: node scripts/export_mtx_slice5_construct.mjs   -> one JSON line; artifacts under .artisan-artifacts/
import path from 'path';
import { fileURLToPath } from 'url';
import { connect } from '../mcp-server/test_stdio_client.js';
import { ARCHETYPE_CATALOG } from '../src/contracts/artisanContract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = process.env.ARTISAN_ARTIFACTS_DIR || path.join(root, '.artisan-artifacts');
const FLOOR_TOP = 0.05;

// [entityId, assetRef, position, rotationDeg, seed, parent]
const LAYOUT = [
  ['floor.white', 'mtx.construct.white_floor', [0, 0, 0], [0, 0, 0], 501, null],
  ['plinth.artifact', 'mtx.construct.artifact_plinth', [0, FLOOR_TOP, -2.5], [0, 0, 0], 502, 'floor.white'],
  ['hardline.exit', 'mtx.fixture.hardline_booth', [0, FLOOR_TOP, 3.5], [0, 180, 0], 503, 'floor.white'],
];

const client = await connect({ ARTISAN_ARTIFACTS_DIR: artifacts });
const calls = [];
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  calls.push(name);
  if (!r.structuredContent?.ok) throw new Error(`${name}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};
try {
  await call('create_world', { worldId: 'slice5_construct', roomSize: [12, 4, 12] });
  for (const [entityId, assetRef, position, rotation, seed, parent] of LAYOUT) {
    const args = { entityId, assetRef, position, rotation, seed, materialRefs: ARCHETYPE_CATALOG[assetRef].surfaces };
    if (parent) Object.assign(args, { parent, relation: 'supported_by' });
    await call('add_entity', args);
  }
  const v = await call('validate_scene');
  if (!v.valid || v.warnings.length) throw new Error(`validation: ${JSON.stringify(v.warnings)}`);
  await call('compile_preview');
  const t = await call('get_engine_telemetry', { profile: 'mtx_preview' });
  if (t.evidence?.identityVerified !== true) throw new Error('telemetry is not identity-verified');
  const shot = await call('capture_viewport_screenshot', { filename: 'mtx_slice5_construct', angle: 'hero' });
  const x = await call('export_mtx_manifest');
  console.log(JSON.stringify({
    result: 'PASS', entities: LAYOUT.length, mcpCalls: calls.length, artifact: x.path, artifactSha256: x.artifactSha256,
    sceneIdentity: x.sceneIdentity, sourceManifestHash: x.sourceManifestHash, screenshot: shot.path,
    gpu: t.telemetry?.gpu, drawCalls: t.telemetry?.drawCalls, triangles: t.telemetry?.triangles,
    fps: t.telemetry?.fps, source: t.source
  }));
} finally {
  await client.close();
}
