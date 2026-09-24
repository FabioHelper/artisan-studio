// MTX Slice 2: author the two-profile comparison scene through the MCP and export it as one
// multi-entity mtx.world/1 layout. Ten placements of seven MTX archetypes: the plaza floor,
// the Arrival Circle, one Hardline booth, the code wall, the glass edge rail, one hero avatar
// and four crowd figures (one of them the arriving player, standing in the circle).
// Every placement carries an explicit seed. The layout is validated with zero warnings, rendered
// headless (identity-verified), screenshotted and exported.
// Needs the Studio dev server (npm run dev) and a Chromium browser (ARTISAN_BROWSER_PATH on Linux).
// Usage: node scripts/export_mtx_slice2_challenge.mjs   -> one JSON line; artifacts under .artisan-artifacts/
import path from 'path';
import { fileURLToPath } from 'url';
import { connect } from '../mcp-server/test_stdio_client.js';
import { ARCHETYPE_CATALOG } from '../src/contracts/artisanContract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = process.env.ARTISAN_ARTIFACTS_DIR || path.join(root, '.artisan-artifacts');
const FLOOR_TOP = 0.05;

// [entityId, assetRef, position, rotationDeg, seed, parent]
const LAYOUT = [
  ['floor.main', 'mtx.plaza.floor_field', [0, 0, 0], [0, 0, 0], 101, null],
  ['arrival.circle', 'mtx.plaza.arrival_circle', [0, FLOOR_TOP, 0], [0, 0, 0], 202, 'floor.main'],
  ['hardline.001', 'mtx.fixture.hardline_booth', [4.2, FLOOR_TOP, -2.2], [0, -40, 0], 42, 'floor.main'],
  ['wall.code', 'mtx.surface.code_wall', [0, FLOOR_TOP, -6.6], [0, 0, 0], 303, 'floor.main'],
  ['rail.edge', 'mtx.edge.glass_rail', [-7.4, FLOOR_TOP, 0], [0, 90, 0], 404, 'floor.main'],
  ['avatar.hero', 'mtx.actor.hero_avatar', [1.7, FLOOR_TOP, 2.6], [0, -15, 0], 7, 'floor.main'],
  ['crowd.001', 'mtx.actor.crowd_figure', [-5.4, FLOOR_TOP, 4.2], [0, 90, 0], 11, 'floor.main'],
  ['crowd.002', 'mtx.actor.crowd_figure', [3.0, FLOOR_TOP, 1.0], [0, 66, 0], 12, 'floor.main'],
  ['crowd.003', 'mtx.actor.crowd_figure', [4.1, FLOOR_TOP, 1.5], [0, -114, 0], 13, 'floor.main'],
  ['crowd.004', 'mtx.actor.crowd_figure', [0, FLOOR_TOP + 0.12, 0], [0, 30, 0], 14, 'arrival.circle'],
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
  await call('create_world', { worldId: 'slice2_challenge', roomSize: [16, 4, 16] });
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
  const shot = await call('capture_viewport_screenshot', { filename: 'mtx_slice2_challenge', angle: 'hero' });
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
