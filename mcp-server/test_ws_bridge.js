import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(__dirname, 'index.js');

console.log('[TEST] Starting Artisan 3D MCP Server for WebSocket bridge test...');
const proc = spawn('node', [serverScript], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'pipe']
});

proc.stderr.on('data', (d) => {
  const msg = d.toString().trim();
  if (msg) console.log('[SERVER]', msg);
});

let buffer = '';
const responses = new Map();
let nextId = 1;

proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) responses.set(msg.id, msg);
    } catch (e) {}
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
        reject(new Error(`Timeout waiting for ${method}`));
      }
    }, 50);
  });
}

function sendNotification(method, params = {}) {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

async function runWebSocketTest() {
  try {
    // 1. Initialize MCP server
    await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-runner', version: '1.0.0' }
    });
    sendNotification('notifications/initialized');

    // 2. Connect WebSocket client to preview bridge
    console.log('\n--- Connecting WebSocket client to ws://localhost:9900 ---');
    await new Promise(resolve => setTimeout(resolve, 500)); // wait for WS server to bind

    const ws = new WebSocket('ws://localhost:9900');
    const receivedManifests = [];

    ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString());
      receivedManifests.push(parsed);
      console.log(`[WS CLIENT] Received manifest: "${parsed.worldId}" with ${parsed.entities?.length || 0} entities (v${parsed.version})`);
    });

    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        console.log('✓ WebSocket connected to Artisan MCP preview bridge!');
        resolve();
      });
      ws.on('error', reject);
    });

    // 3. Trigger tool calls and verify WebSocket broadcasts
    console.log('\n--- Calling create_world ---');
    await sendRequest('tools/call', {
      name: 'create_world',
      arguments: { worldId: 'live_ws_tavern', lighting: 'dusk' }
    });

    await new Promise(r => setTimeout(r, 200));

    console.log('\n--- Calling add_entity (Bookshelf) ---');
    await sendRequest('tools/call', {
      name: 'add_entity',
      arguments: {
        entityId: 'prop.bookshelf.arcane.001',
        assetRef: 'furniture.bookshelf',
        position: [-2.0, 0, -1.0],
        materialRefs: ['wood.dark_oak']
      }
    });

    await new Promise(r => setTimeout(r, 200));

    console.log('\n--- Calling set_lighting (day) ---');
    await sendRequest('tools/call', {
      name: 'set_lighting',
      arguments: { preset: 'day' }
    });

    await new Promise(r => setTimeout(r, 300));

    console.log(`\n✓ Total WebSocket broadcast packets received: ${receivedManifests.length}`);
    if (receivedManifests.length < 3) {
      throw new Error(`Expected at least 3 broadcast messages, got ${receivedManifests.length}`);
    }

    const last = receivedManifests[receivedManifests.length - 1];
    if (last.worldId !== 'live_ws_tavern') throw new Error(`Wrong worldId: ${last.worldId}`);
    if (last.lighting !== 'day') throw new Error(`Wrong lighting: ${last.lighting}`);
    if (last.entities.length !== 1) throw new Error(`Wrong entity count: ${last.entities.length}`);

    console.log('\n========================================');
    console.log('🎉 LIVE WEBSOCKET PREVIEW BRIDGE VERIFIED!');
    console.log('========================================');

    ws.close();
    proc.kill();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ WEBSOCKET TEST FAILED:', err);
    proc.kill();
    process.exit(1);
  }
}

runWebSocketTest();
