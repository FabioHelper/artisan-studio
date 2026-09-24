// Current-SDK stdio integration test: protocol surface, valid/invalid inputs, determinism,
// schema footprint. Browser-backed tools get valid-input coverage in scripts/verify_astra_harness.mjs.
// Usage: node mcp-server/test_stdio_client.js [--json]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { AXIS, CONTRACT_VERSION } from '../src/contracts/artisanContract.js';
import { WorldSession } from './WorldSession.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail: String(detail).slice(0, 200) }); };

export async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(here, 'index.js')],
    cwd: here,
    env: { ...process.env, ARTISAN_BRIDGE: 'off', ARTISAN_ARTIFACTS_DIR: path.join(os.tmpdir(), 'artisan_stdio_test'), ...env },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'artisan-stdio-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function expectError(client, name, args, code) {
  const r = await client.callTool({ name, arguments: args });
  const got = r.structuredContent?.error?.code;
  check(`invalid:${name}:${code}`, r.isError === true && r.structuredContent?.ok === false && got === code, `got ${got}`);
}

async function author(client, seedMode) {
  const call = (name, args) => client.callTool({ name, arguments: args });
  const created = await call('create_world', { worldId: 'determinism_forge', roomSize: [6, 3, 5], lighting: 'hearth' });
  const manifest = {
    worldId: 'determinism_forge',
    version: created.structuredContent.version,
    contractVersion: CONTRACT_VERSION,
    units: 'meter',
    axis: { ...AXIS },
    lighting: 'hearth',
    entities: [],
    roomSize: [6, 3, 5]
  };
  const add = async args => {
    const result = await call('add_entity', args);
    manifest.version = result.structuredContent.version;
    manifest.entities.push(result.structuredContent.entity);
  };
  await add({ entityId: 'arch.shell.001', assetRef: 'arch.forge_pavilion' });
  await add({ entityId: 'furn.table.001', assetRef: 'furniture.table', position: [0.5, 0, 0.2], ...(seedMode ? { seed: 42 } : {}) });
  await add({ entityId: 'prop.lantern.001', assetRef: 'lighting.lantern', position: [0.5, 0.78, 0.2], parent: 'furn.table.001', anchor: 'anchor.surface.top' });
  const summary = (await call('get_telemetry')).structuredContent;
  return { ...summary, manifest, directSceneIdentity: new WorldSession().sceneIdentity(manifest) };
}

async function main() {
  const asJson = process.argv.includes('--json');
  const client = await connect();

  // --- protocol surface
  const info = client.getServerVersion();
  check('initialize', info?.name === 'artisan-3d', JSON.stringify(info));
  const { tools } = await client.listTools();
  check('tools/list count == 14', tools.length === 14, tools.length);
  check('every tool has outputSchema + annotations', tools.every(t => t.outputSchema && t.annotations && typeof t.annotations.readOnlyHint === 'boolean' && t.annotations.title));
  const toolChars = JSON.stringify(tools).length;
  const toolTokens = Math.ceil(toolChars / 4);
  check('tool-schema footprint <= 2000 tokens', toolTokens <= 2000, `${toolChars} chars ≈ ${toolTokens} tokens`);

  const { resources } = await client.listResources();
  check('resources/list >= 8', resources.length >= 8, resources.map(r => r.uri).join(','));
  for (const r of resources) {
    const body = await client.readResource({ uri: r.uri });
    const text = body.contents?.[0]?.text || '';
    check(`resource:${r.uri}`, text.length > 20, `${text.length} chars`);
  }
  const schema = JSON.parse((await client.readResource({ uri: 'artisan://schema/world' })).contents[0].text);
  check('world schema is real JSON Schema', schema.$schema && schema.properties?.entities?.items?.properties?.relationships?.type === 'array');
  const { resourceTemplates } = await client.listResourceTemplates();
  check('resource templates == 2', resourceTemplates.length === 2);
  const arch = JSON.parse((await client.readResource({ uri: 'artisan://archetype/furniture.table' })).contents[0].text);
  check('template archetype read', arch.id === 'furniture.table' && Array.isArray(arch.anchors));
  const mat = JSON.parse((await client.readResource({ uri: 'artisan://material/wood.dark_oak' })).contents[0].text);
  check('template material read', mat.id === 'wood.dark_oak' && typeof mat.roughness === 'number');
  let unknownResourceRejected = false;
  try { await client.readResource({ uri: 'artisan://archetype/raw.box' }); } catch { unknownResourceRejected = true; }
  check('unknown resource rejected', unknownResourceRejected);
  const legacy = await client.readResource({ uri: 'materials://catalog' });
  check('legacy URI alias readable', legacy.contents[0].text.includes('wood.dark_oak'));

  const { prompts } = await client.listPrompts();
  check('prompts/list == 2', prompts.length === 2);
  const manual = await client.getPrompt({ name: 'authoring-manual' });
  check('authoring-manual validates (role user)', manual.messages.every(m => ['user', 'assistant'].includes(m.role)) && manual.messages[0].content.text.includes('5-Tier'));
  const tpl = await client.getPrompt({ name: 'scene-template', arguments: { theme: 'alpine smithy' } });
  check('scene-template validates', tpl.messages[0].role === 'user' && tpl.messages[0].content.text.includes('alpine smithy'));
  let promptRejected = false;
  try { await client.getPrompt({ name: 'scene-template', arguments: {} }); } catch { promptRejected = true; }
  check('scene-template requires theme', promptRejected);

  // --- valid calls (world tools)
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  let r = await call('create_world', { worldId: 'astra_smithy_01', roomSize: [8, 3, 6], lighting: 'dusk' });
  check('valid:create_world', r.structuredContent?.ok && r.structuredContent.sceneIdentity?.startsWith('sha256:'));
  r = await call('add_entity', { entityId: 'arch.shell.forge.001', assetRef: 'arch.forge_pavilion', materialRefs: ['stone.rough_local', 'wood.dark_oak', 'skyline.twilight_valley'] });
  check('valid:add_entity(architecture)', r.structuredContent?.ok && r.structuredContent.entity.relationships.length === 0);
  r = await call('add_entity', { entityId: 'furn.table.001', assetRef: 'furniture.table', position: [0.4, 0, 0.3] });
  const table = r.structuredContent?.entity;
  check('valid:add_entity default ground support (array shape)', Array.isArray(table?.relationships) && table.relationships[0]?.type === 'supported_by' && table.relationships[0]?.target === 'ground.stone');
  check('derived deterministic seed', Number.isInteger(table?.seed) && table.seed > 0);
  r = await call('add_entity', { entityId: 'prop.lantern.001', assetRef: 'lighting.lantern', position: [0.4, 0.78, 0.3], parent: 'furn.table.001', anchor: 'anchor.surface.top', seed: 7 });
  check('valid:add_entity anchored', r.structuredContent?.entity?.relationships?.[0]?.type === 'attached_to' && r.structuredContent.entity.seed === 7);
  r = await call('move_entity', { entityId: 'furn.table.001', position: [0.5, 0, 0.3], rotation: [0, 15, 0] });
  check('valid:move_entity', r.structuredContent?.ok);
  r = await call('replace_material', { entityId: 'furn.table.001', materialRefs: ['wood.weathered_oak'] });
  check('valid:replace_material', r.structuredContent?.ok);
  r = await call('set_lighting', { preset: 'hearth' });
  check('valid:set_lighting', r.structuredContent?.ok);
  r = await call('validate_scene');
  check('valid:validate_scene', r.structuredContent?.valid === true && r.structuredContent.errors.length === 0, r.content[0].text);
  r = await call('get_telemetry');
  check('valid:get_telemetry', r.structuredContent?.entityCount === 3 && !r.structuredContent.manifest);
  r = await call('get_telemetry', { includeManifest: true });
  check('valid:get_telemetry pre-render manifest export rejected',
    r.isError === true && r.structuredContent?.error?.code === 'EVIDENCE_UNVERIFIED' && r.structuredContent?.manifest === undefined,
    `got ${r.structuredContent?.error?.code || 'success-with-manifest'}`);
  r = await call('export_mtx_manifest');
  check('MTX export requires identity-verified preview', r.isError === true && r.structuredContent?.error?.code === 'EVIDENCE_UNVERIFIED');
  r = await call('compile_preview');
  check('valid:compile_preview (no studio → livePreview false)', r.structuredContent?.ok && r.structuredContent.livePreview === false);
  r = await call('remove_entity', { entityId: 'prop.lantern.001' });
  check('valid:remove_entity', r.structuredContent?.ok && r.structuredContent.entityCount === 2);

  // --- invalid calls (all 14 tools)
  await expectError(client, 'create_world', { worldId: '../evil' }, 'INVALID_ARGUMENT');
  await expectError(client, 'create_world', { worldId: 'ok_world', lighting: 'neon' }, 'INVALID_ARGUMENT');
  await expectError(client, 'create_world', { worldId: 'ok_world', roomSize: [1, 2] }, 'INVALID_ARGUMENT');
  await expectError(client, 'add_entity', { entityId: 'x.box', assetRef: 'primitive.box' }, 'INVALID_ARGUMENT');
  await expectError(client, 'add_entity', { entityId: 'furn.table.001', assetRef: 'furniture.table' }, 'INVALID_ARGUMENT');
  await expectError(client, 'add_entity', { entityId: 'x.nan', assetRef: 'storage.barrel', position: [0, 'a', 0] }, 'INVALID_ARGUMENT');
  await expectError(client, 'add_entity', { entityId: 'x.far', assetRef: 'storage.barrel', position: [0, 0, 999] }, 'INVALID_ARGUMENT');
  await expectError(client, 'add_entity', { entityId: 'x.mat', assetRef: 'storage.barrel', materialRefs: ['unobtanium'] }, 'INVALID_ARGUMENT');
  await expectError(client, 'add_entity', { entityId: 'x.seed', assetRef: 'storage.barrel', seed: -3 }, 'INVALID_ARGUMENT');
  await expectError(client, 'add_entity', { entityId: 'x.orphan', assetRef: 'storage.barrel', parent: 'ghost.parent' }, 'CONTRACT_VIOLATION');
  await expectError(client, 'add_entity', { entityId: 'x.anchor', assetRef: 'storage.barrel', parent: 'furn.table.001', anchor: 'anchor.nope' }, 'CONTRACT_VIOLATION');
  await expectError(client, 'add_entity', { entityId: 'x.extra', assetRef: 'storage.barrel', color: 'red' }, 'INVALID_ARGUMENT');
  await expectError(client, 'move_entity', { entityId: 'ghost.entity', position: [0, 0, 0] }, 'NOT_FOUND');
  await expectError(client, 'move_entity', { entityId: 'furn.table.001' }, 'INVALID_ARGUMENT');
  await expectError(client, 'remove_entity', { entityId: 'ghost.entity' }, 'NOT_FOUND');
  await expectError(client, 'replace_material', { entityId: 'furn.table.001', materialRefs: ['plastic.chrome_unicorn'] }, 'INVALID_ARGUMENT');
  await expectError(client, 'set_lighting', { preset: 'disco' }, 'INVALID_ARGUMENT');
  await expectError(client, 'validate_scene', { verbose: true }, 'INVALID_ARGUMENT');
  await expectError(client, 'get_telemetry', { includeManifest: true, extra: 1 }, 'INVALID_ARGUMENT');
  await expectError(client, 'compile_preview', { force: true }, 'INVALID_ARGUMENT');
  await expectError(client, 'get_engine_telemetry', { profile: 'mobile' }, 'INVALID_ARGUMENT');
  await expectError(client, 'run_performance_audit', { scene: 'moon_base' }, 'INVALID_ARGUMENT');
  await expectError(client, 'capture_viewport_screenshot', { angle: 'workstation' }, 'INVALID_ARGUMENT');
  await expectError(client, 'import_telemetry_logs', { path: 'C:/Windows' }, 'INVALID_ARGUMENT');
  await expectError(client, 'no_such_tool', {}, 'UNKNOWN_TOOL');

  // dependents guard: table has no dependents now; re-add lantern then try to remove table
  await call('add_entity', { entityId: 'prop.lantern.002', assetRef: 'lighting.lantern', parent: 'furn.table.001', anchor: 'anchor.surface.top' });
  await expectError(client, 'remove_entity', { entityId: 'furn.table.001' }, 'HAS_DEPENDENTS');
  await client.close();

  // --- determinism: identical authored requests in fresh processes → identical manifest + identity
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const c = await connect();
    runs.push(await author(c, i >= 0));
    await c.close();
  }
  check('determinism: same manifest', JSON.stringify(runs[0].manifest) === JSON.stringify(runs[1].manifest));
  check('determinism: same sceneIdentity', runs[0].sceneIdentity === runs[1].sceneIdentity && runs.every(run => run.sceneIdentity === run.directSceneIdentity), runs[0].sceneIdentity);
  const c2 = await connect();
  const unseeded = await author(c2, false);
  await c2.close();
  const c3 = await connect();
  const unseeded2 = await author(c3, false);
  await c3.close();
  check('determinism: omitted seed derives same seed', unseeded.sceneIdentity === unseeded2.sceneIdentity && unseeded.manifest.entities.every(e => Number.isInteger(e.seed)));

  const passed = results.filter(r => r.pass).length;
  const summary = { suite: 'mcp-stdio', passed, failed: results.length - passed, toolSchemaChars: toolChars, toolSchemaTokens: toolTokens, failures: results.filter(r => !r.pass) };
  if (asJson) console.log(JSON.stringify({ summary, results }));
  else {
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    console.log(`\n${passed}/${results.length} passed; tool schema ${toolChars} chars ≈ ${toolTokens} tokens`);
  }
  process.exit(summary.failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error('FATAL', err); process.exit(2); });
}
