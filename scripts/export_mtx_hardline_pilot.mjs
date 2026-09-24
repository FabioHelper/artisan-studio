// MTX Slice 1 pilot: author one Hardline booth through the MCP, prove it rendered (identity-verified
// headless Studio), capture a preview, and export the mtx.world/1 artifact the Godot importer takes.
// The booth is placed off-origin and yawed so the MTX side exercises the axis and rotation mapping.
// Needs the Studio dev server (npm run dev) and a Chromium browser (ARTISAN_BROWSER_PATH on Linux).
// Usage: node scripts/export_mtx_hardline_pilot.mjs   -> one JSON line; artifacts under .artisan-artifacts/
import path from 'path';
import { fileURLToPath } from 'url';
import { connect } from '../mcp-server/test_stdio_client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = process.env.ARTISAN_ARTIFACTS_DIR || path.join(root, '.artisan-artifacts');
const client = await connect({ ARTISAN_ARTIFACTS_DIR: artifacts });
const calls = [];
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  calls.push(name);
  if (!r.structuredContent?.ok) throw new Error(`${name}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};
try {
  await call('create_world', { worldId: 'hardline_pilot' });
  await call('add_entity', {
    entityId: 'hardline.001', assetRef: 'mtx.fixture.hardline_booth', seed: 42,
    position: [0.5, 0, -1], rotation: [0, 30, 0],
    materialRefs: ['mtx.neutral.black_lacquer', 'mtx.glass.cyan', 'mtx.signal.green_code']
  });
  const v = await call('validate_scene');
  if (!v.valid || v.warnings.length) throw new Error(`validation: ${JSON.stringify(v.warnings)}`);
  await call('compile_preview');
  const t = await call('get_engine_telemetry', { profile: 'mtx_preview' });
  if (t.evidence?.identityVerified !== true) throw new Error('telemetry is not identity-verified');
  const shot = await call('capture_viewport_screenshot', { filename: 'mtx_hardline_pilot', angle: 'hero' });
  const x = await call('export_mtx_manifest');
  console.log(JSON.stringify({
    result: 'PASS', mcpCalls: calls.length, artifact: x.path, artifactSha256: x.artifactSha256,
    sceneIdentity: x.sceneIdentity, sourceManifestHash: x.sourceManifestHash, screenshot: shot.path,
    gpu: t.telemetry?.gpu, drawCalls: t.telemetry?.drawCalls, triangles: t.telemetry?.triangles,
    fps: t.telemetry?.fps, source: t.source
  }));
} finally {
  await client.close();
}
