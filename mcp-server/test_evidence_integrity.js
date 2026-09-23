// P0.5 evidence-integrity suite (SPEC-08). Node only: no browser, hermetic OS-assigned ports, temp artifact dirs.
// Fake Studio clients speak bridge protocol v2 (and tolerate the pre-v2 wire format, so this suite reports
// FAIL instead of crashing on unrepaired code). Usage: node mcp-server/test_evidence_integrity.js [--json]
import WebSocket from 'ws';
import http from 'http';
import net from 'net';
import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { connect } from './test_stdio_client.js';
import * as C from '../src/contracts/artisanContract.js';
import { WorldSession } from './WorldSession.js';
import { RENDERER_HASH, SCENE_IDENTITIES } from '../src/contracts/sceneIdentityManifest.generated.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const FIXTURE = path.join(ROOT, '.artisan-artifacts', 'dogfood', 'p1-current-harness');
const AUTHORED = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'authored-world.json'), 'utf8'));
const F4BB = 'sha256:f4bb39db91d785d657fb56059e7222f4';
const MUTATING = new Set([...Array.from({ length: 14 }, (_, i) => i + 1), 22]);
const REPLAY = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'tool-call-log.json'), 'utf8')).mcpCalls
  .filter(c => MUTATING.has(c.step)).map(c => [c.name, c.args]);
const ORIGIN = 'http://127.0.0.1:5173';
// Never the owner's Vite: an accidental headless render fails fast instead of touching port 5173.
const DEAD_STUDIO = 'http://127.0.0.1:9/';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan_evi_test_'));

const results = [];
const check = (id, name, pass, detail = '') => results.push({ id, name: `${id} ${name}`, pass: !!pass, detail: String(detail).slice(0, 300) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const identityOf = (m) => 'sha256:' + crypto.createHash('sha256').update(C.canonicalJson(m)).digest('hex').slice(0, 32);
const codeOf = (r) => r?.structuredContent?.error?.code ?? (r?.structuredContent?.ok ? 'OK' : 'NONE');
const textOf = (r) => r?.content?.[0]?.text || '';
const setEq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && new Set(a).size === a.length && b.every(x => a.includes(x));

async function waitFor(pred, ms = 3000, step = 50) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await pred()) return true; await sleep(step); }
  return false;
}
function freePort() {
  return new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
}
function artDir(tag) { const d = path.join(TMP, tag); fs.mkdirSync(d, { recursive: true }); return d; }
function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !e.isSymbolicLink()) listFiles(p, out); else out.push(p);
  }
  return out;
}
function httpJson(port, pathName) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathName, method: 'GET', timeout: 2000, agent: false }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, json: null }); } });
    });
    req.on('error', () => resolve({ status: 0, json: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null }); });
    req.end();
  });
}
function decoyServer(port) {
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('not an artisan bridge'); });
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

async function startMcp(env) {
  const client = await connect({ ARTISAN_BRIDGE: 'on', ARTISAN_STUDIO_URL: DEAD_STUDIO, ...env });
  const caps = async () => JSON.parse((await client.readResource({ uri: 'artisan://capabilities' })).contents[0].text);
  const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  return { client, caps, call };
}
/** Polls capabilities until the bridge has settled (listening, conflict or disabled); returns the last read. */
async function settledBridge(mcp, ms = 5000) {
  let c = null;
  await waitFor(async () => {
    c = await mcp.caps();
    const b = c.previewBridge || {};
    return (b.state && b.state !== 'starting') || b.listening === true;
  }, ms, 100);
  return c;
}
async function replay(mcp) {
  for (const [name, args] of REPLAY) {
    const r = await mcp.call(name, args);
    if (!r.structuredContent?.ok) throw new Error(`replay ${name} failed: ${textOf(r).slice(0, 160)}`);
  }
}
async function smallWorld(mcp, worldId = 'evi_small') {
  await mcp.call('create_world', { worldId });
  await mcp.call('add_entity', { entityId: 'store.barrel.001', assetRef: 'storage.barrel', position: [1, 0, 1], seed: 5 });
  await mcp.call('add_entity', { entityId: 'furn.table.001', assetRef: 'furniture.table', position: [-0.5, 0, 0], seed: 6 });
}

/**
 * Fake Studio page. Speaks protocol v2 (HELLO -> HELLO_ACK, MANIFEST/WORLD_UPDATE, render blocks in every
 * reply) and also answers the pre-v2 wire format (bare manifests with previewRequestId, id-only commands).
 */
async function fakeStudio(port, opts = {}) {
  const identitySession = new WorldSession();
  const st = {
    clientId: opts.clientId || crypto.randomUUID(), inbox: [], hello: null, handshake: opts.handshake !== false,
    render: { sceneIdentity: 'preset:trio', sceneReference: null, zoneReference: null, rendererHash: RENDERER_HASH, renderPlanHash: null, legacy: true, epoch: 1, worldId: null, version: null, renderedEntityIds: [] },
    renderOverride: null, ackMutate: null, onCommand: opts.onCommand || null, ws: null
  };
  const render = () => ({ ...st.render, ...(st.renderOverride || {}) });
  const applyRender = (m) => {
    const sceneReference = identitySession.sceneReference(m);
    st.render = { sceneIdentity: sceneReference.sceneIdentity, sceneReference, zoneReference: null, rendererHash: sceneReference.rendererHash, renderPlanHash: null, legacy: false, epoch: st.render.epoch + 1, worldId: m.worldId, version: m.version, renderedEntityIds: (m.entities || []).map(e => e.id) };
  };
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: ORIGIN });
  st.ws = ws;
  st.send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const base = (type, id) => ({ type, id, instanceId: st.hello?.instanceId, clientId: st.clientId, render: render() });
  st.base = base;
  ws.on('message', (d) => {
    let m;
    try { m = JSON.parse(d.toString()); } catch { return; }
    st.inbox.push(m);
    if (m.type === 'BRIDGE_HELLO') {
      st.hello = m;
      if (st.handshake) st.send({ type: 'BRIDGE_HELLO_ACK', protocol: 2, instanceId: m.instanceId, connectionId: m.connectionId, clientId: st.clientId, pinnedInstance: null, render: render() });
      return;
    }
    if (st.onCommand && st.onCommand(m, st)) return;
    let manifest = null, id = null;
    if (m.type === 'MANIFEST' && m.manifest) { manifest = m.manifest; id = m.id; }
    else if (!m.type && m.previewRequestId) { const { previewRequestId, ...rest } = m; manifest = rest; id = previewRequestId; }
    else if (m.type === 'WORLD_UPDATE' && m.manifest) { applyRender(m.manifest); return; }
    else if (!m.type && Array.isArray(m.entities)) { applyRender(m); return; }
    if (manifest) {
      applyRender(manifest);
      const r = render();
      let ack = { ...base('MANIFEST_RESULT', id), ok: true, worldId: manifest.worldId, version: manifest.version, entityCount: r.renderedEntityIds.length,
        renderedEntityIds: r.renderedEntityIds, sceneIdentity: r.sceneIdentity, drawCalls: 12, triangles: 4000, settled: true, warnings: 0 };
      ack.render = { ...ack.render, drawCalls: 12, triangles: 4000, settled: true };
      if (st.ackMutate) ack = st.ackMutate(JSON.parse(JSON.stringify(ack)));
      st.send(ack);
      return;
    }
    const tel = { gpu: 'FakeGPU', isSoftwareRasterizer: false, fps: 60, frametimeMs: 16.7, drawCalls: 12, triangles: 4000, pixelRatio: 1, viewport: '1280x720', settled: true };
    if (m.type === 'GET_TELEMETRY') st.send({ ...base('TELEMETRY_RESULT', m.id), telemetry: tel });
    else if (m.type === 'CAPTURE_SCREENSHOT') st.send({ ...base('SCREENSHOT_RESULT', m.id), dataUrl: PNG, width: 1, height: 1 });
    else if (m.type === 'RUN_AUDIT') {
      const r = render();
      st.send({ ...base('AUDIT_RESULT', m.id), report: { verdict: 'NO FINDING ABOVE THRESHOLD', telemetry: { baselineFrametime: 16.7 }, smokingGuns: [], device: { gpu: 'FakeGPU' },
        scene: { sceneIdentity: r.sceneIdentity, epochStart: r.epoch, epochEnd: r.epoch, entityIds: r.renderedEntityIds } } });
    } else if (m.type === 'SET_SCENE') {
      const fantastic = m.scene === 'fantastic' || m.scene === 'preset:fantastic';
      const sceneReference = fantastic ? SCENE_IDENTITIES.dioramaAdaptation : null;
      st.render = { sceneIdentity: sceneReference?.sceneIdentity || ('preset:' + m.scene), sceneReference, zoneReference: null, rendererHash: RENDERER_HASH, renderPlanHash: null, legacy: !sceneReference, epoch: st.render.epoch + 1, worldId: null, version: null, renderedEntityIds: [] };
      st.send({ ...base('SCENE_RESULT', m.id), scene: m.scene });
    }
  });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); ws.once('unexpected-response', (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); });
  return st;
}

async function test(id, name, fn) {
  try { await fn(); } catch (err) { check(id, name, false, `threw: ${err?.message || err}`); }
}

// ---------------------------------------------------------------- T-BRG: bridge identity and conflicts
async function bridgeConflictTests() {
  // T-BRG-1 / T-BRG-2: a foreign listener owns the port
  const p = await freePort();
  const decoy = await decoyServer(p);
  const b = await startMcp({ MCP_WS_PORT: String(p), ARTISAN_ARTIFACTS_DIR: artDir('brg1') });
  try {
    await test('T-BRG-1', 'foreign port owner -> state conflict, owner.kind foreign', async () => {
      const c = await settledBridge(b, 5000);
      const pb = c.previewBridge || {};
      check('T-BRG-1', 'foreign port owner -> state conflict, owner.kind foreign', pb.state === 'conflict' && pb.owner?.kind === 'foreign', `state=${pb.state} owner=${JSON.stringify(pb.owner)} listening=${pb.listening}`);
    });
    await test('T-BRG-2', 'compile_preview in conflict -> BRIDGE_CONFLICT with actionable text', async () => {
      await smallWorld(b);
      const inst = (await b.caps()).previewBridge?.instanceId;
      const r = await b.call('compile_preview', { timeoutMs: 1500 });
      const t = textOf(r);
      const actionable = typeof inst === 'string' && inst.length >= 8 && t.includes(String(p)) && t.includes(inst) && t.includes('MCP_WS_PORT') && t.includes('mcpInstance=');
      check('T-BRG-2', 'compile_preview in conflict -> BRIDGE_CONFLICT with actionable text', r.isError === true && codeOf(r) === 'BRIDGE_CONFLICT' && actionable, `code=${codeOf(r)} livePreview=${r.structuredContent?.livePreview} text=${t.slice(0, 160)}`);
    });
  } finally { await b.client.close(); await new Promise(r => decoy.close(r)); }

  // T-BRG-3 / T-BRG-4: two MCPs on one port; the loser identifies the owner
  const q = await freePort();
  const a = await startMcp({ MCP_WS_PORT: String(q), ARTISAN_ARTIFACTS_DIR: artDir('brg3a') });
  let bb = null;
  try {
    const ca = await settledBridge(a, 5000);
    const aId = ca.previewBridge?.instanceId;
    bb = await startMcp({ MCP_WS_PORT: String(q), ARTISAN_ARTIFACTS_DIR: artDir('brg3b') });
    await test('T-BRG-3', 'second MCP on the same port -> owner.kind artisan with the owner instanceId', async () => {
      const cb = await settledBridge(bb, 5000);
      const idn = await httpJson(q, '/api/bridge/identity');
      const pb = cb.previewBridge || {};
      const pass = typeof aId === 'string' && pb.state === 'conflict' && pb.owner?.kind === 'artisan' && pb.owner?.instanceId === aId && idn.json?.instanceId === aId && pb.instanceId && pb.instanceId !== aId;
      check('T-BRG-3', 'second MCP on the same port -> owner.kind artisan with the owner instanceId', pass, `A=${aId} B.state=${pb.state} B.owner=${JSON.stringify(pb.owner)?.slice(0, 120)} identity=${idn.status}/${idn.json?.instanceId}`);
    });
    await test('T-BRG-4', 'first bridge message is BRIDGE_HELLO carrying the capabilities instanceId', async () => {
      const s = await fakeStudio(q);
      await waitFor(() => s.inbox.length > 0, 2000);
      const first = s.inbox[0];
      check('T-BRG-4', 'first bridge message is BRIDGE_HELLO carrying the capabilities instanceId', first?.type === 'BRIDGE_HELLO' && typeof aId === 'string' && first.instanceId === aId && first.protocol === 2, `first=${first?.type} instanceId=${first?.instanceId} caps=${aId}`);
      s.ws.close();
    });
  } finally { await bb?.client.close(); await a.client.close(); }

  // T-BRG-5: a socket that never completes the handshake is never used
  const u = await freePort();
  const e = await startMcp({ MCP_WS_PORT: String(u), ARTISAN_ARTIFACTS_DIR: artDir('brg5') });
  try {
    await test('T-BRG-5', 'client without HELLO_ACK -> STUDIO_UNVERIFIED, studioClients 0', async () => {
      await settledBridge(e, 5000);
      await smallWorld(e);
      const raw = await fakeStudio(u, { handshake: false, onCommand: () => true });
      await sleep(2500);
      const r = await e.call('compile_preview', { timeoutMs: 1500 });
      const c = await e.caps();
      check('T-BRG-5', 'client without HELLO_ACK -> STUDIO_UNVERIFIED, studioClients 0', r.isError === true && codeOf(r) === 'STUDIO_UNVERIFIED' && c.previewBridge?.studioClients === 0, `code=${codeOf(r)} studioClients=${c.previewBridge?.studioClients}`);
      raw.ws.close();
    });
  } finally { await e.client.close(); }

  // T-BRG-7: lazy re-acquire once the owner exits
  const w = await freePort();
  const decoy2 = await decoyServer(w);
  const f = await startMcp({ MCP_WS_PORT: String(w), ARTISAN_ARTIFACTS_DIR: artDir('brg7') });
  try {
    await test('T-BRG-7', 'owner exits -> next compile_preview rebinds, state listening', async () => {
      const c0 = await settledBridge(f, 5000);
      await new Promise(r => decoy2.close(r));
      await smallWorld(f);
      const r = await f.call('compile_preview', { timeoutMs: 1500 });
      const c1 = await f.caps();
      check('T-BRG-7', 'owner exits -> next compile_preview rebinds, state listening', c0.previewBridge?.state === 'conflict' && r.structuredContent?.ok === true && c1.previewBridge?.state === 'listening', `before=${c0.previewBridge?.state} compile=${codeOf(r)} after=${c1.previewBridge?.state}`);
    });
  } finally { await f.client.close(); }
}

// T-BRG-6: same-socket and instanceId reply binding (bridge module, in-process)
async function bridgeBindingUnit() {
  const port = await freePort();
  process.env.MCP_WS_PORT = String(port);
  let bridge = null;
  const socks = [];
  try {
    const mod = await import(`./bridge.js?evi=${port}`);
    bridge = mod.startBridge({ studioUrl: ORIGIN + '/', sijFile: path.join(TMP, 'no_sij.json'), log: () => {} });
    if (typeof bridge.ready === 'function') await bridge.ready(); else await waitFor(() => bridge.isListening(), 3000);
    let mode = 'other-socket';
    const onCommand = (m, self) => {
      if (m.type !== 'GET_TELEMETRY') return true;
      const other = socks.find(s => s !== self);
      if (mode === 'other-socket') other.send({ ...other.base('TELEMETRY_RESULT', m.id), telemetry: { fps: 1 } });
      else if (mode === 'wrong-instance') self.send({ ...self.base('TELEMETRY_RESULT', m.id), instanceId: crypto.randomUUID(), telemetry: { fps: 2 } });
      else self.send({ ...self.base('TELEMETRY_RESULT', m.id), telemetry: { fps: 60 } });
      return true;
    };
    const x = await fakeStudio(port, { onCommand });
    socks.push(x);
    const y = await fakeStudio(port, { onCommand });
    socks.push(y);
    await waitFor(() => bridge.clientCount() === 2, 3000);
    const req = async () => { try { return { ok: true, res: await bridge.request('GET_TELEMETRY', {}, 700, { clientId: x.clientId }) }; } catch (err) { return { ok: false, err: err.message }; } };
    mode = 'other-socket';
    const r1 = await req();
    mode = 'wrong-instance';
    const r2 = await req();
    mode = 'right';
    const r3 = await req();
    const got3 = r3.res?.msg ?? r3.res;
    const pass = !r1.ok && /BRIDGE_TIMEOUT/.test(r1.err) && !r2.ok && /BRIDGE_TIMEOUT/.test(r2.err) && r3.ok && got3?.telemetry?.fps === 60;
    check('T-BRG-6', 'reply from another socket or with a foreign instanceId is ignored (times out)', pass, `other-socket=${r1.ok ? 'RESOLVED' : r1.err} wrong-instance=${r2.ok ? 'RESOLVED' : r2.err} control=${r3.ok ? 'resolved' : r3.err}`);
  } catch (err) {
    check('T-BRG-6', 'reply from another socket or with a foreign instanceId is ignored (times out)', false, `threw: ${err.message}`);
  } finally {
    socks.forEach(s => s.ws.close());
    try { await bridge?.close(); } catch {}
    delete process.env.MCP_WS_PORT;
  }
}

// ---------------------------------------------------------------- T-EVD: verified ack + evidence binding
async function evidenceTests() {
  // T-EVD-1: ack fields are verified, one issue per failing field
  const g = await freePort();
  const mg = await startMcp({ MCP_WS_PORT: String(g), ARTISAN_ARTIFACTS_DIR: artDir('evd1') });
  try {
    await settledBridge(mg, 5000);
    const s = await fakeStudio(g);
    await waitFor(async () => (await mg.caps()).previewBridge?.studioClients === 1, 3000);
    await smallWorld(mg, 'evi_ack_world');
    const cases = [
      ['sceneIdentity', 'IDENTITY_STALE', 'wrong sceneIdentity', (a) => { a.sceneIdentity = 'sha256:' + '0'.repeat(32); a.render.sceneIdentity = a.sceneIdentity; return a; }],
      ['sceneIdentity', 'IDENTITY_STALE', 'missing sceneIdentity', (a) => { delete a.sceneIdentity; delete a.render.sceneIdentity; return a; }],
      ['version', 'ACK_MISMATCH', 'wrong version', (a) => { a.version += 1; a.render.version = a.version; return a; }],
      ['renderedEntityIds', 'IDENTITY_STALE', 'missing entity id', (a) => { a.renderedEntityIds = a.renderedEntityIds.slice(1); a.render.renderedEntityIds = a.renderedEntityIds; a.entityCount -= 1; return a; }],
      ['instanceId', 'ACK_MISMATCH', 'wrong instanceId', (a) => { a.instanceId = crypto.randomUUID(); return a; }]
    ];
    const outcomes = [];
    let allPass = true;
    for (const [field, expectedCode, label, mutate] of cases) {
      s.ackMutate = mutate;
      const r = await mg.call('compile_preview', { timeoutMs: 3000 });
      const issues = r.structuredContent?.error?.issues || [];
      const pass = r.isError === true && codeOf(r) === expectedCode && issues.some(i => i.path === field);
      allPass = allPass && pass;
      outcomes.push(`${label}:${pass ? 'ok' : codeOf(r)}`);
    }
    s.ackMutate = null;
    check('T-EVD-1', 'mismatched ack fails closed with identity or ACK code naming the field', allPass, outcomes.join(' '));
    s.ws.close();
  } catch (err) {
    check('T-EVD-1', 'mismatched ack (identity, version, entity set, instanceId) -> ACK_MISMATCH naming the field', false, `threw: ${err.message}`);
  } finally { await mg.client.close(); }

  // T-EVD-2 + T-ART-1 (tool) + T-ART-2 (tool) + T-EVD-3 on one live MCP with the 13-entity replay world
  const h = await freePort();
  const artH = artDir('evd2');
  const mh = await startMcp({ MCP_WS_PORT: String(h), ARTISAN_ARTIFACTS_DIR: artH });
  let s = null;
  try {
    await settledBridge(mh, 5000);
    s = await fakeStudio(h);
    await waitFor(async () => (await mh.caps()).previewBridge?.studioClients === 1, 3000);
    await replay(mh);
    await test('T-EVD-2', 'correct recomputed identity -> verified live ack with 13 rendered entities', async () => {
      const r = await mh.call('compile_preview', { timeoutMs: 5000 });
      const sc = r.structuredContent || {};
      const pass = sc.ok === true && sc.livePreview === true && sc.sceneIdentity === F4BB && sc.ack?.sceneIdentity === sc.sceneIdentity && sc.ack?.renderedEntityIds?.length === 13;
      check('T-EVD-2', 'correct recomputed identity -> verified live ack with 13 rendered entities', pass, `code=${codeOf(r)} summary=${sc.sceneIdentity} ack.sceneIdentity=${sc.ack?.sceneIdentity} rendered=${sc.ack?.renderedEntityIds?.length}`);
    });
    try {
      const r = await mh.call('capture_viewport_screenshot', { filename: 'dogfood/p1/x.png' });
      const got = r.structuredContent?.path;
      const normalized = String(got || '').replace(/\\/g, '/');
      toolArt1 = { pass: r.structuredContent?.ok === true && normalized.includes('/evidence/authored-world/') && normalized.endsWith('/dogfood/p1/x.png') && fs.existsSync(got), detail: 'tool code=' + codeOf(r) + ' path=' + got };
    } catch (err) { toolArt1 = { pass: false, detail: `tool threw: ${err.message}` }; }
    try {
      const before = listFiles(TMP).length;
      const r = await mh.call('capture_viewport_screenshot', { filename: '..\\..\\Windows\\evil.png' });
      toolArt2 = { pass: r.isError === true && codeOf(r) === 'INVALID_FILENAME' && listFiles(TMP).length === before, detail: `tool code=${codeOf(r)} newFiles=${listFiles(TMP).length - before}` };
    } catch (err) { toolArt2 = { pass: false, detail: `tool threw: ${err.message}` }; }
    await test('T-EVD-3', 'live page shows preset:trio -> every evidence tool refuses PREVIEW_STALE, no file', async () => {
      s.renderOverride = { sceneIdentity: 'preset:trio', sceneReference: null, legacy: true, worldId: null, version: null, renderedEntityIds: [] };
      const before = new Set(listFiles(artH));
      const outs = [];
      for (const [name, args] of [['get_engine_telemetry', {}], ['capture_viewport_screenshot', { filename: 'stale/x.png' }], ['run_performance_audit', {}], ['import_telemetry_logs', {}]]) {
        const r = await mh.call(name, args);
        outs.push([name, r.isError === true && codeOf(r) === 'IDENTITY_UNRESOLVED', codeOf(r)]);
      }
      const added = listFiles(artH).filter(f => !before.has(f));
      s.renderOverride = null;
      check('T-EVD-3', 'live page shows preset:trio -> every evidence tool refuses PREVIEW_STALE, no file', outs.every(o => o[1]) && added.length === 0, `${outs.map(o => `${o[0]}:${o[2]}`).join(' ')} filesWritten=${added.length}`);
    });
  } catch (err) {
    if (!results.some(r => r.id === 'T-EVD-2')) check('T-EVD-2', 'correct recomputed identity -> verified live ack with 13 rendered entities', false, `threw: ${err.message}`);
  } finally { s?.ws.close(); await mh.client.close(); }

  // T-EVD-4: explicit opt-out keeps the stdio contract and says so
  const mj = await startMcp({ ARTISAN_BRIDGE: 'off', ARTISAN_ARTIFACTS_DIR: artDir('evd4') });
  try {
    await test('T-EVD-4', 'ARTISAN_BRIDGE=off -> compile ok, livePreview false, bridge.state disabled', async () => {
      await smallWorld(mj);
      const r = await mj.call('compile_preview');
      const sc = r.structuredContent || {};
      check('T-EVD-4', 'ARTISAN_BRIDGE=off -> compile ok, livePreview false, bridge.state disabled', sc.ok === true && sc.livePreview === false && sc.bridge?.state === 'disabled', `ok=${sc.ok} livePreview=${sc.livePreview} bridge=${JSON.stringify(sc.bridge)}`);
    });
  } finally { await mj.client.close(); }

  // T-EVD-5: one identity everywhere (node crypto, WebCrypto helper, the fixture)
  await test('T-EVD-5', 'identity parity: WorldSession == contract computeSceneIdentity == f4bb', async () => {
    const sync = new WorldSession().sceneIdentity(AUTHORED);
    let web = null, err = '';
    try { web = typeof C.computeSceneIdentity === 'function' ? await C.computeSceneIdentity(AUTHORED) : null; } catch (e) { err = e.message; }
    check('T-EVD-5', 'identity parity: WorldSession == contract computeSceneIdentity == f4bb', sync === F4BB && web === F4BB && C.formatSceneIdentity?.('ab'.repeat(32)) === 'sha256:' + 'ab'.repeat(16), `sync=${sync} webcrypto=${web ?? 'ABSENT'} ${err}`);
  });
}
let toolArt1 = { pass: false, detail: 'tool check not run' };
let toolArt2 = { pass: false, detail: 'tool check not run' };

// ---------------------------------------------------------------- T-ART: confined artifact subdirectories
async function artifactTests() {
  const ART = artDir('art_root');
  const OUTSIDE = artDir('art_outside');
  process.env.ARTISAN_ARTIFACTS_DIR = ART;
  const A = await import('./artifacts.js?evi=1');
  const rel = (name) => A.safeArtifactRelPath(name, '.png', 'artisan_capture');

  await test('T-ART-1', 'requested subdirectory preserved (tool, live capture)', async () => {
    let unit = false, detail = '';
    try {
      const t = rel('dogfood/p1/x.png');
      A.writeArtifactAt(t.path, 'png');
      const want = path.join(ART, 'dogfood', 'p1', 'x.png');
      unit = path.resolve(t.path) === path.resolve(want) && fs.existsSync(want) && t.normalized === false;
      detail = `unit path=${t.path}`;
    } catch (e) { detail = `unit threw: ${e.message}`; }
    check('T-ART-1', 'requested subdirectory preserved (unit + tool)', unit && toolArt1.pass, `${detail}; ${toolArt1.detail}`);
  });

  await test('T-ART-2', 'traversal / absolute / UNC / reserved / 5-segment -> INVALID_FILENAME, no file', async () => {
    const bad = ['..\\..\\Windows\\evil.png', 'C:/x.png', '\\\\srv\\s\\x.png', 'con.png', 'a/b/c/d/e.png', 'a/../x.png', 'ok/./x.png', 'a//x.png'];
    const before = listFiles(TMP).length;
    const outs = bad.map(name => {
      try { const t = rel(name); return [name, false, `ACCEPTED ${t?.path ?? t}`]; }
      catch (e) { return [name, /^INVALID_FILENAME/.test(e.message), e.message.slice(0, 40)]; }
    });
    const noFiles = listFiles(TMP).length === before && !fs.existsSync(path.join(ART, 'Windows'));
    check('T-ART-2', 'traversal / absolute / UNC / reserved / 5-segment -> INVALID_FILENAME, no file', outs.every(o => o[1]) && noFiles && toolArt2.pass, `${outs.filter(o => !o[1]).map(o => `${o[0]}=>${o[2]}`).join(' | ') || 'unit ok'}; noFiles=${noFiles}; ${toolArt2.detail}`);
  });

  await test('T-ART-3', 'junction escaping the root -> ARTIFACT_PATH_ESCAPE, nothing written outside', async () => {
    const link = path.join(ART, 'link');
    if (!fs.existsSync(link)) fs.symlinkSync(OUTSIDE, link, 'junction');
    let code = 'NONE';
    try { const t = rel('link/x.png'); A.writeArtifactAt(t.path, 'png'); code = 'WRITTEN'; }
    catch (e) { code = e.message.split(':')[0]; }
    const leaked = listFiles(OUTSIDE).length;
    check('T-ART-3', 'junction escaping the root -> ARTIFACT_PATH_ESCAPE, nothing written outside', code === 'ARTIFACT_PATH_ESCAPE' && leaked === 0, `code=${code} filesOutside=${leaked}`);
    try { fs.unlinkSync(link); } catch {}
  });

  await test('T-ART-4', 'sanitized characters reported as normalized:true', async () => {
    let t = null, err = '';
    try { t = rel('a<b>.png'); } catch (e) { err = e.message; }
    check('T-ART-4', 'sanitized characters reported as normalized:true', t?.normalized === true && path.basename(t.path) === 'a_b_.png', t ? `path=${t.path} normalized=${t.normalized}` : `threw: ${err}`);
  });

  await test('T-ART-5', 'guard: legacy safeArtifactPath still confines traversal to the root', async () => {
    const trav = A.safeArtifactPath('../../../../Windows/System32/evil', '.json');
    check('T-ART-5', 'guard: legacy safeArtifactPath still confines traversal to the root', A.isInsideArtifacts(trav) && path.dirname(trav) === path.resolve(ART), trav);
  });
  delete process.env.ARTISAN_ARTIFACTS_DIR;
}

async function main() {
  const asJson = process.argv.includes('--json');
  await bridgeConflictTests();
  await bridgeBindingUnit();
  await evidenceTests();
  await artifactTests();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  // Every planned test id must report; one that never ran (an earlier step threw) is a FAIL, not a gap.
  const EXPECTED = [...[1, 2, 3, 4, 5, 6, 7].map(n => `T-BRG-${n}`), ...[1, 2, 3, 4, 5].map(n => `T-EVD-${n}`), ...[1, 2, 3, 4, 5].map(n => `T-ART-${n}`)];
  for (const id of EXPECTED) if (!results.some(r => r.id === id)) check(id, 'not executed', false, 'an earlier step in its group threw before this test ran');
  const order =(r) => { const m = /^T-([A-Z]+)-(\d+)/.exec(r.id) || []; return `${m[1]}${String(m[2]).padStart(2, '0')}`; };
  results.sort((a, b) => order(a).localeCompare(order(b)));
  const passed = results.filter(r => r.pass).length;
  const summary = { suite: 'mcp-evidence-integrity', passed, failed: results.length - passed, failures: results.filter(r => !r.pass) };
  if (asJson) console.log(JSON.stringify({ summary, results }));
  else {
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    console.log(`\n${passed}/${results.length} passed`);
  }
  process.exit(summary.failed ? 1 : 0);
}

main().catch(err => { console.error('FATAL', err); process.exit(2); });
