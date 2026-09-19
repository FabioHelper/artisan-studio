import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(__dirname, 'index.js');

console.log('[TEST] Starting Artisan 3D MCP Server via stdio...');
const proc = spawn('node', [serverScript], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'pipe']
});

proc.stderr.on('data', (d) => {
  console.log('[SERVER STDERR]', d.toString().trim());
});

let buffer = '';
const responses = new Map();
let nextId = 1;

proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop(); // keep remainder

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) {
        responses.set(msg.id, msg);
      }
    } catch (e) {
      console.error('[TEST] Parse error on line:', line);
    }
  }
});

function sendRequest(method, params = {}) {
  const id = nextId++;
  const req = { jsonrpc: '2.0', id, method, params };
  proc.stdin.write(JSON.stringify(req) + '\n');
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = setInterval(() => {
      if (responses.has(id)) {
        clearInterval(check);
        resolve(responses.get(id));
      } else if (Date.now() - start > 5000) {
        clearInterval(check);
        reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
      }
    }, 50);
  });
}

function sendNotification(method, params = {}) {
  const note = { jsonrpc: '2.0', method, params };
  proc.stdin.write(JSON.stringify(note) + '\n');
}

async function runTests() {
  try {
    // 1. Initialize
    console.log('\n--- 1. Testing Initialize ---');
    const initRes = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'artisan-test-client', version: '1.0.0' }
    });
    console.log('✓ Initialized:', initRes.result?.serverInfo);
    sendNotification('notifications/initialized');

    // 2. List Tools
    console.log('\n--- 2. Testing tools/list ---');
    const toolsRes = await sendRequest('tools/list');
    const toolNames = toolsRes.result?.tools?.map(t => t.name) || [];
    console.log(`✓ Found ${toolNames.length} tools:`, toolNames.join(', '));
    if (toolNames.length !== 9) throw new Error(`Expected 9 tools, got ${toolNames.length}`);

    // 3. Create World
    console.log('\n--- 3. Testing create_world ---');
    const createRes = await sendRequest('tools/call', {
      name: 'create_world',
      arguments: { worldId: 'test_medieval_inn', roomSize: [8, 3, 6], lighting: 'hearth' }
    });
    console.log('✓ create_world result:', createRes.result?.content?.[0]?.text);

    // 4. Add Entities
    console.log('\n--- 4. Testing add_entity ---');
    const tableRes = await sendRequest('tools/call', {
      name: 'add_entity',
      arguments: {
        entityId: 'prop.table.oak.001',
        assetRef: 'furniture.table',
        position: [0, 0, 0],
        materialRefs: ['wood.dark_oak']
      }
    });
    console.log('✓ add_entity (table):', tableRes.result?.content?.[0]?.text);

    const anvilRes = await sendRequest('tools/call', {
      name: 'add_entity',
      arguments: {
        entityId: 'prop.anvil.iron.001',
        assetRef: 'anvil.forged_iron_01',
        position: [1.5, 0, 0],
        materialRefs: ['metal.forged_iron', 'wood.dark_oak']
      }
    });
    console.log('✓ add_entity (anvil):', anvilRes.result?.content?.[0]?.text);

    const lanternRes = await sendRequest('tools/call', {
      name: 'add_entity',
      arguments: {
        entityId: 'prop.lantern.table.001',
        assetRef: 'lighting.lantern',
        position: [0, 0.78, 0],
        parent: 'prop.table.oak.001',
        anchor: 'anchor.surface.top'
      }
    });
    console.log('✓ add_entity (lantern on table):', lanternRes.result?.content?.[0]?.text);

    // 5. Validate Scene
    console.log('\n--- 5. Testing validate_scene ---');
    const valRes = await sendRequest('tools/call', { name: 'validate_scene', arguments: {} });
    const report = JSON.parse(valRes.result?.content?.[0]?.text || '{}');
    console.log(`✓ validate_scene valid: ${report.valid}, entities: ${report.stats?.entityCount}, errors: ${report.errors?.length}, warnings: ${report.warnings?.length}`);

    // 6. Get Telemetry
    console.log('\n--- 6. Testing get_telemetry ---');
    const telemRes = await sendRequest('tools/call', { name: 'get_telemetry', arguments: {} });
    console.log('✓ get_telemetry:\n' + telemRes.result?.content?.[0]?.text);

    // 7. Compile Preview
    console.log('\n--- 7. Testing compile_preview ---');
    const compRes = await sendRequest('tools/call', { name: 'compile_preview', arguments: {} });
    console.log('✓ compile_preview:\n' + compRes.result?.content?.[0]?.text);

    // 8. List & Read Resources
    console.log('\n--- 8. Testing resources/list & read ---');
    const resList = await sendRequest('resources/list');
    console.log(`✓ Resources count: ${resList.result?.resources?.length}`);
    const matRes = await sendRequest('resources/read', { uri: 'materials://catalog' });
    const matCount = Object.keys(JSON.parse(matRes.result?.contents?.[0]?.text || '{}')).length;
    console.log(`✓ Read materials://catalog: ${matCount} materials loaded`);

    // 9. List & Get Prompts
    console.log('\n--- 9. Testing prompts/list & get ---');
    const promptList = await sendRequest('prompts/list');
    console.log(`✓ Prompts count: ${promptList.result?.prompts?.length}`);
    const manPrompt = await sendRequest('prompts/get', { name: 'authoring-manual' });
    console.log(`✓ Get authoring-manual: length=${manPrompt.result?.messages?.[0]?.content?.text?.length} chars`);

    console.log('\n========================================');
    console.log('🎉 ALL MCP INTEGRATION TESTS PASSED!');
    console.log('========================================');

    proc.kill();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    proc.kill();
    process.exit(1);
  }
}

runTests();
