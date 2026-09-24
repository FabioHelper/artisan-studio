// MTX Slice 3: author the small playable V2 plaza through the MCP and export it as one
// multi-entity mtx.world/1 layout. Fifteen placements: the plaza floor, the Arrival Circle (where
// the player spawns: avatar.hero stands in it), two Hardline booths flanking the code wall, six
// glass edge rails and three crowd figures (a pair talking, one loner). The north corners are
// left open on purpose: walking off the plaza is the respawn test.
// Every placement carries an explicit seed. The layout is validated with zero warnings, rendered
// headless (identity-verified), screenshotted and exported.
// Needs the Studio dev server (npm run dev) and a Chromium browser (ARTISAN_BROWSER_PATH on Linux).
// Usage: node scripts/export_mtx_slice3_plaza.mjs   -> one JSON line; artifacts under .artisan-artifacts/
import path from 'path';
import { fileURLToPath } from 'url';
import { connect } from '../mcp-server/test_stdio_client.js';
import { ARCHETYPE_CATALOG } from '../src/contracts/artisanContract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = process.env.ARTISAN_ARTIFACTS_DIR || path.join(root, '.artisan-artifacts');
const FLOOR_TOP = 0.05;

// [entityId, assetRef, position, rotationDeg, seed, parent]
const LAYOUT = [
  ['floor.main', 'mtx.plaza.floor_field', [0, 0, 0], [0, 0, 0], 131, null],
  ['arrival.circle', 'mtx.plaza.arrival_circle', [0, FLOOR_TOP, 1.5], [0, 0, 0], 232, 'floor.main'],
  ['wall.code', 'mtx.surface.code_wall', [0, FLOOR_TOP, -7.2], [0, 0, 0], 333, 'floor.main'],
  ['hardline.001', 'mtx.fixture.hardline_booth', [-4.6, FLOOR_TOP, -4.4], [0, 0, 0], 42, 'floor.main'],
  ['hardline.002', 'mtx.fixture.hardline_booth', [4.6, FLOOR_TOP, -4.4], [0, 0, 0], 43, 'floor.main'],
  ['rail.w1', 'mtx.edge.glass_rail', [-7.8, FLOOR_TOP, -3.0], [0, 90, 0], 401, 'floor.main'],
  ['rail.w2', 'mtx.edge.glass_rail', [-7.8, FLOOR_TOP, 3.0], [0, 90, 0], 402, 'floor.main'],
  ['rail.e1', 'mtx.edge.glass_rail', [7.8, FLOOR_TOP, -3.0], [0, -90, 0], 403, 'floor.main'],
  ['rail.e2', 'mtx.edge.glass_rail', [7.8, FLOOR_TOP, 3.0], [0, -90, 0], 404, 'floor.main'],
  ['rail.s1', 'mtx.edge.glass_rail', [-3.0, FLOOR_TOP, 7.8], [0, 180, 0], 405, 'floor.main'],
  ['rail.s2', 'mtx.edge.glass_rail', [3.0, FLOOR_TOP, 7.8], [0, 180, 0], 406, 'floor.main'],
  ['avatar.hero', 'mtx.actor.hero_avatar', [0, FLOOR_TOP + 0.12, 1.5], [0, 180, 0], 7, 'arrival.circle'],
  ['crowd.001', 'mtx.actor.crowd_figure', [-2.7, FLOOR_TOP, -2.1], [0, 70, 0], 21, 'floor.main'],
  ['crowd.002', 'mtx.actor.crowd_figure', [-1.6, FLOOR_TOP, -2.5], [0, -105, 0], 22, 'floor.main'],
  ['crowd.003', 'mtx.actor.crowd_figure', [3.4, FLOOR_TOP, 3.6], [0, -140, 0], 23, 'floor.main'],
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
  await call('create_world', { worldId: 'slice3_plaza', roomSize: [16, 4, 16] });
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
  const shot = await call('capture_viewport_screenshot', { filename: 'mtx_slice3_plaza', angle: 'hero' });
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
