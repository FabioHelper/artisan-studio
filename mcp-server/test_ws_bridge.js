// Loopback preview-bridge + privacy test (current SDK over stdio, bridge on 127.0.0.1).
// A fake Studio client answers bridge commands so no browser is needed.
// Usage: node mcp-server/test_ws_bridge.js [--json]   (port: TEST_WS_PORT, default 3456)
import WebSocket from 'ws';
import http from 'http';
import os from 'os';
import fs from 'fs';
import path from 'path';
import net from 'net';
import crypto from 'crypto';
import { connect } from './test_stdio_client.js';
import { RENDERER_HASH } from '../src/contracts/sceneIdentityManifest.generated.js';

const PORT = parseInt(process.env.TEST_WS_PORT || '3456', 10);
const ORIGIN = 'http://127.0.0.1:5173';
const ARTIFACTS = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan_ws_test_'));
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: String(detail).slice(0, 200) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// Independent fake-Studio oracle: this intentionally does not import production identity helpers.
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const fullHashOf = manifest => 'sha256:' + crypto.createHash('sha256').update(canonical(manifest)).digest('hex');
const identityOf = manifest => 'sha256:' + fullHashOf(manifest).slice(7, 39);
const sceneReferenceOf = manifest => {
  const sourceManifestHash = fullHashOf(manifest);
  return {
    identitySchemaVersion: 1,
    kind: 'authored-world',
    logicalId: manifest.worldId,
    contentVersion: manifest.version,
    contractVersion: '2.0.0',
    contentHash: sourceManifestHash,
    sceneIdentity: 'sha256:' + sourceManifestHash.slice(7, 39),
    parentSceneIdentity: null,
    sourceManifestHash,
    rendererHash: RENDERER_HASH,
    renderPlanHash: null,
    legacyAliases: []
  };
};
const namespaceOf = reference => `evidence/authored-world/${encodeURIComponent(reference.logicalId)}/v${reference.contentVersion}/${reference.contentHash.slice(7)}`;

function treeHash(root) {
  const rows = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) rows.push(path.relative(root, absolute).replace(/\\/g, '/') + '\0' + crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'));
    }
  };
  walk(root);
  return crypto.createHash('sha256').update(rows.sort().join('\n')).digest('hex');
}

function httpReq({ host = '127.0.0.1', method = 'GET', pathName, headers = {}, body }) {
  return new Promise((resolve) => {
    const req = http.request({ host, port: PORT, method, path: pathName, headers, timeout: 3000, agent: false }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.code }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'TIMEOUT' }); });
    if (body) req.write(body);
    req.end();
  });
}

// Protocol v2: a Studio page answers BRIDGE_HELLO with BRIDGE_HELLO_ACK; only then does the bridge use the socket.
function openWs(origin, host = '127.0.0.1', { handshake = true, port = PORT } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${host}:${port}`, origin ? { origin } : {});
    const inbox = [];
    const self = { ws, inbox, ok: true, clientId: crypto.randomUUID(), hello: null };
    ws.on('message', d => {
      let m;
      try { m = JSON.parse(d.toString()); } catch { return; }
      inbox.push(m);
      if (m.type === 'BRIDGE_HELLO') {
        self.hello = m;
        if (handshake) ws.send(JSON.stringify({ type: 'BRIDGE_HELLO_ACK', protocol: m.protocol, instanceId: m.instanceId, connectionId: m.connectionId, clientId: self.clientId, pinnedInstance: null, render: null }));
      }
    });
    ws.on('open', () => resolve(self));
    ws.on('unexpected-response', (_req, res) => resolve({ ok: false, status: res.statusCode }));
    ws.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
  });
}

async function waitFor(pred, ms = 3000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (pred()) return true; await sleep(25); }
  return false;
}

function freePort() {
  return new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
}

// Direct bridge-module checks: replies must match id AND the expected reply type.
async function bridgeUnitChecks() {
  const port = await freePort();
  process.env.MCP_WS_PORT = String(port);
  const { startBridge } = await import(`./bridge.js?unit=${port}`);
  const bridge = startBridge({ studioUrl: ORIGIN + '/', sijFile: path.join(ARTIFACTS, 'no_sij.json'), log: () => {} });
  await waitFor(() => bridge.isListening(), 3000);
  const fake = await openWs(ORIGIN, '127.0.0.1', { port });
  const ws = fake.ws;
  await waitFor(() => bridge.clientCount() > 0, 2000);
  const ids = () => ({ instanceId: fake.hello?.instanceId, clientId: fake.clientId });
  let mode = 'wrong-only';
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type !== 'GET_TELEMETRY') return;
    ws.send(JSON.stringify({ type: 'SCREENSHOT_RESULT', id: m.id, ...ids(), dataUrl: 'data:,spoof' }));
    if (mode === 'wrong-then-right') ws.send(JSON.stringify({ type: 'TELEMETRY_RESULT', id: m.id, ...ids(), telemetry: { fps: 60 } }));
  });
  let err = null;
  try { await bridge.request('GET_TELEMETRY', {}, 600); } catch (e) { err = e.message; }
  check('bridge ignores reply with wrong type (times out)', /BRIDGE_TIMEOUT/.test(err || ''), err);
  mode = 'wrong-then-right';
  const good = await bridge.request('GET_TELEMETRY', {}, 2000).then(r => r.msg).catch(e => ({ error: e.message }));
  check('bridge resolves only on matching reply type', good.type === 'TELEMETRY_RESULT' && good.telemetry?.fps === 60, JSON.stringify(good).slice(0, 120));
  let unknownErr = null;
  try { await bridge.request('DELETE_EVERYTHING', {}, 500); } catch (e) { unknownErr = e.message; }
  check('bridge rejects unknown request type', /BRIDGE_UNKNOWN_REQUEST/.test(unknownErr || ''), unknownErr);
  ws.close();
  await bridge.close();
  delete process.env.MCP_WS_PORT;
}

// artifacts.js: traversal is neutralised and every write stays inside the configured root.
async function artifactUnitChecks() {
  process.env.ARTISAN_ARTIFACTS_DIR = ARTIFACTS;
  const A = await import('./artifacts.js?unit=1');
  check('artifacts root honours ARTISAN_ARTIFACTS_DIR', path.resolve(A.ARTIFACTS_DIR) === path.resolve(ARTIFACTS), A.ARTIFACTS_DIR);
  const trav = A.safeArtifactPath('../../../../Windows/System32/evil', '.json');
  check('traversal name confined to artifacts root', A.isInsideArtifacts(trav) && path.dirname(trav) === path.resolve(ARTIFACTS), trav);
  let escaped = false;
  try { A.writeArtifactAt(path.join(ARTIFACTS, '..', 'escape.json'), '{}'); } catch (e) { escaped = /ARTIFACT_PATH_ESCAPE/.test(e.message); }
  check('writeArtifactAt refuses a path outside the root', escaped && !fs.existsSync(path.join(ARTIFACTS, '..', 'escape.json')));
  check('artifacts root itself is not a writable target', !A.isInsideArtifacts(ARTIFACTS));
  const w = A.writeArtifact('unit probe', '.json', '{}');
  check('writeArtifact lands inside the root', A.isInsideArtifacts(w) && fs.existsSync(w), w);

  // SOL-FIX-2: confinement is enforced at the write boundary, not by where a variable came from.
  let p = A.safeArtifactPath('reassign_probe', '.json');
  p = path.join(ARTIFACTS, '..', 'artisan_reassigned_escape.json');
  let reassignedRefused = false;
  try { A.writeArtifactAt(p, '{}'); } catch (e) { reassignedRefused = /ARTIFACT_PATH_ESCAPE/.test(e.message); }
  check('writeArtifactAt refuses a confined path reassigned outside the root', reassignedRefused && !fs.existsSync(p));
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const shot = A.writeArtifactAt(A.safeArtifactPath('../../screenshot probe', '.png'), bytes);
  check('in-memory screenshot bytes written inside the root', A.isInsideArtifacts(shot) && fs.readFileSync(shot).equals(Buffer.from(bytes)), shot);
  const profile = A.createBrowserProfileDir();
  const inTmp = path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('artisan_mcp_') && fs.existsSync(profile);
  await new Promise(res => A.removeBrowserProfileDir(profile, res));
  check('browser profile dir created under OS temp and removed', inTmp && !fs.existsSync(profile), profile);
  const refuses = (dir) => { try { A.removeBrowserProfileDir(dir); return false; } catch (e) { return /BROWSER_PROFILE_ESCAPE/.test(e.message); } };
  check('removeBrowserProfileDir refuses the project root and non-profile temp dirs', refuses(A.PROJECT_ROOT) && refuses(ARTIFACTS) && refuses(path.join(os.tmpdir(), 'artisan_mcp_x', '..', '..')) && fs.existsSync(ARTIFACTS));
}

async function main() {
  const asJson = process.argv.includes('--json');
  const client = await connect({ ARTISAN_BRIDGE: 'on', MCP_WS_PORT: String(PORT), ARTISAN_ARTIFACTS_DIR: ARTIFACTS, ARTISAN_STUDIO_URL: 'http://127.0.0.1:5173/' });
  const caps = async () => JSON.parse((await client.readResource({ uri: 'artisan://capabilities' })).contents[0].text);
  await waitFor(() => false, 300);
  const c0 = await caps();
  check('bridge listening on 127.0.0.1', c0.previewBridge.listening === true && c0.previewBridge.host === '127.0.0.1', JSON.stringify(c0.previewBridge));

  // Not reachable on non-loopback interfaces
  const lan = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
  if (lan) {
    const r = await httpReq({ host: lan.address, pathName: '/api/vault/status' });
    check('not reachable on LAN interface', r.status === 0, `${lan.address}: ${r.error || r.status}`);
  } else check('not reachable on LAN interface', true, 'no non-loopback IPv4 present');

  // HTTP origin/host policy
  check('HTTP no-origin allowed', (await httpReq({ pathName: '/api/vault/status' })).status === 200);
  const good = await httpReq({ pathName: '/api/vault/status', headers: { Origin: ORIGIN } });
  check('HTTP studio origin allowed + echoed', good.status === 200 && good.headers['access-control-allow-origin'] === ORIGIN);
  check('HTTP foreign origin rejected', (await httpReq({ pathName: '/api/vault/status', headers: { Origin: 'https://evil.example' } })).status === 403);
  check('HTTP DNS-rebinding host rejected', (await httpReq({ pathName: '/api/vault/status', headers: { Host: `evil.example:${PORT}` } })).status === 403);
  check('HTTP unknown path 404', (await httpReq({ pathName: '/etc/passwd' })).status === 404);

  // WebSocket origin policy
  const evil = await openWs('https://evil.example');
  check('WS foreign origin rejected', !evil.ok, evil.status || evil.error);
  const noOrigin = await openWs(null);
  check('WS missing origin rejected', !noOrigin.ok, noOrigin.status || noOrigin.error);
  const studio = await openWs(ORIGIN);
  check('WS studio origin accepted', studio.ok);
  check('WS receives cabinet_init', await waitFor(() => studio.inbox.some(m => m.type === 'cabinet_init')));

  // Vault update: size cap + payload validation + sanitised broadcast
  const big = await httpReq({ method: 'POST', pathName: '/api/vault/update', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'cabinet_gate_update', pad: 'x'.repeat(70 * 1024) }) });
  check('vault update >64KB rejected (413)', big.status === 413 || big.status === 0, big.status || big.error);
  const bad = await httpReq({ method: 'POST', pathName: '/api/vault/update', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'RUN_AUDIT', id: 'x' }) });
  check('vault update command-injection rejected (400)', bad.status === 400, bad.status || bad.error);
  const okUpd = await httpReq({ method: 'POST', pathName: '/api/vault/update', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'cabinet_gate_update', cabinetId: 'CAB-01', allPass: true, injected: '<script>' }) });
  check('vault update valid accepted', okUpd.status === 200);
  check('vault broadcast sanitised', await waitFor(() => studio.inbox.some(m => m.type === 'cabinet_gate_update' && m.cabinetId === 'CAB-01' && !('injected' in m))));

  // Fake Studio: answer preview/screenshot/telemetry commands
  // Fake Studio (protocol v2): recomputes the identity of what it renders and reports it in every reply.
  let rendered = { sceneIdentity: 'preset:trio', sceneReference: null, rendererHash: RENDERER_HASH, renderPlanHash: null, legacy: true, epoch: 1, worldId: null, version: null, renderedEntityIds: [] };
  let identityAttack = null;
  const renderOf = (manifest) => {
    const sceneReference = sceneReferenceOf(manifest);
    return {
      sceneIdentity: sceneReference.sceneIdentity,
      sceneReference,
      rendererHash: sceneReference.rendererHash,
      renderPlanHash: sceneReference.renderPlanHash,
      legacy: false,
      epoch: rendered.epoch + 1,
      worldId: manifest.worldId,
      version: manifest.version,
      renderedEntityIds: manifest.entities.map(entity => entity.id)
    };
  };
  const attackedRender = () => {
    if (!identityAttack) return rendered;
    if (identityAttack === 'forged') return { ...rendered, sceneReference: { ...rendered.sceneReference, contentHash: 'sha256:bad' } };
    if (identityAttack === 'stale') {
      const staleHash = 'sha256:' + 'b'.repeat(64);
      return { ...rendered, sceneIdentity: 'sha256:' + 'b'.repeat(32), sceneReference: { ...rendered.sceneReference, contentHash: staleHash, sourceManifestHash: staleHash, sceneIdentity: 'sha256:' + 'b'.repeat(32) } };
    }
    if (identityAttack === 'cross-label') {
      const contentHash = 'sha256:' + 'c'.repeat(64);
      const sceneReference = {
        identitySchemaVersion: 1, kind: 'diorama-adaptation', logicalId: 'fantastic-hall.diorama-adaptation', contentVersion: 2,
        contractVersion: '2.0.0', contentHash, sceneIdentity: 'fantastic-hall:diorama:v2:' + 'c'.repeat(32),
        parentSceneIdentity: null, sourceManifestHash: null, rendererHash: RENDERER_HASH, renderPlanHash: null, legacyAliases: ['preset:fantastic']
      };
      return { ...rendered, sceneIdentity: sceneReference.sceneIdentity, sceneReference, worldId: null, version: null };
    }
    if (identityAttack === 'null-epoch') return { ...rendered, epoch: null };
    return rendered;
  };
  studio.ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const base = (type) => ({ type, id: m.id, instanceId: studio.hello?.instanceId, clientId: studio.clientId, render: attackedRender() });
    if (m.type === 'WORLD_UPDATE') rendered = renderOf(m.manifest);
    if (m.type === 'MANIFEST') {
      rendered = renderOf(m.manifest);
      studio.ws.send(JSON.stringify({ ...base('MANIFEST_RESULT'), ok: true, worldId: rendered.worldId, version: rendered.version, sceneIdentity: rendered.sceneIdentity, entityCount: rendered.renderedEntityIds.length, renderedEntityIds: rendered.renderedEntityIds, drawCalls: 12, triangles: 4000, settled: true, render: { ...rendered, drawCalls: 12, triangles: 4000, settled: true } }));
    }
    if (m.type === 'CAPTURE_SCREENSHOT') studio.ws.send(JSON.stringify({ ...base('SCREENSHOT_RESULT'), dataUrl: PNG, width: 1, height: 1, inFrustum: attackedRender().renderedEntityIds }));
    if (m.type === 'GET_TELEMETRY') studio.ws.send(JSON.stringify({ ...base('TELEMETRY_RESULT'), telemetry: { gpu: 'FakeGPU', fps: 60, drawCalls: 12, triangles: 4000, settled: true } }));
    if (m.type === 'RUN_AUDIT') studio.ws.send(JSON.stringify({ ...base('AUDIT_RESULT'), report: { verdict: 'PASS', baselineFps: 60, telemetry: {}, device: { gpu: 'FakeGPU' }, smokingGuns: [] }, markdown: '# fake audit' }));
  });
  const lurker = await openWs(ORIGIN, '127.0.0.1', { handshake: false });

  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  await call('create_world', { worldId: 'bridge_world' });
  check('WORLD_UPDATE published to the verified Studio on create_world', await waitFor(() => studio.inbox.some(m => m.type === 'WORLD_UPDATE' && m.manifest?.worldId === 'bridge_world' && m.instanceId === studio.hello?.instanceId)));
  const cU = await caps();
  check('unverified socket gets no WORLD_UPDATE or commands and is not counted', cU.previewBridge.studioClients === 1 && cU.previewBridge.unverifiedClients === 1 && !lurker.inbox.some(m => m.type === 'WORLD_UPDATE' || m.worldId) && lurker.inbox[0]?.type === 'BRIDGE_HELLO', JSON.stringify({ studio: cU.previewBridge.studioClients, unverified: cU.previewBridge.unverifiedClients, lurkerTypes: lurker.inbox.map(m => m.type) }));
  await call('add_entity', { entityId: 'storage.barrel.001', assetRef: 'storage.barrel', position: [1, 0, 1] });
  const noRenderExport = await call('get_telemetry', { includeManifest: true });
  check('manifest export rejects session-only claims before a verified render', noRenderExport.isError === true && noRenderExport.structuredContent?.error?.code === 'EVIDENCE_UNVERIFIED', noRenderExport.content[0].text);
  const prev = await call('compile_preview');
  check('compile_preview awaits Studio ack', prev.structuredContent?.livePreview === true && prev.structuredContent.ack?.drawCalls === 12 && prev.structuredContent.budget?.withinBudget === true, prev.content[0].text);
  const tel = await call('get_engine_telemetry', {});
  check('get_engine_telemetry live', tel.structuredContent?.source === 'live' && tel.structuredContent.telemetry.gpu === 'FakeGPU');
  const manifestExport = await call('get_telemetry', { includeManifest: true });
  const exportEvidence = manifestExport.structuredContent?.manifestExport;
  check('manifest export requires and returns a complete current live render binding',
    manifestExport.structuredContent?.ok === true
    && exportEvidence?.identityVerified === true
    && exportEvidence?.source === 'live'
    && Number.isInteger(exportEvidence?.renderEpoch)
    && exportEvidence?.renderer?.kind === 'live-studio'
    && typeof exportEvidence?.renderer?.clientId === 'string'
    && exportEvidence?.artifactSha256 === rendered.sceneReference.sourceManifestHash,
    JSON.stringify(exportEvidence ?? manifestExport.structuredContent?.error ?? null).slice(0, 200));

  const negativeBefore = treeHash(ARTIFACTS);
  const negativeLiveCases = [
    ['forged', 'capture_viewport_screenshot', { filename: 'negative/forged.png' }],
    ['stale', 'import_telemetry_logs', {}],
    ['cross-label', 'run_performance_audit', {}],
    ['null-epoch', 'capture_viewport_screenshot', { filename: 'negative/null-epoch.png' }]
  ];
  const negativeCodes = [];
  for (const [attack, tool, args] of negativeLiveCases) {
    identityAttack = attack;
    const result = await call(tool, args);
    negativeCodes.push(`${attack}:${result.structuredContent?.error?.code || 'accepted'}`);
    identityAttack = null;
  }
  check('production live handlers reject forged, stale, cross-label and null-epoch renders before artifact writes',
    negativeCodes.every(item => /:IDENTITY_(?:UNRESOLVED|STALE|KIND_MISMATCH)$/.test(item)) && treeHash(ARTIFACTS) === negativeBefore,
    negativeCodes.join(' '));
  const filesBefore = fs.readdirSync(ARTIFACTS, { recursive: true }).length;
  const shot = await call('capture_viewport_screenshot', { filename: '..\\..\\..\\Windows\\evil<>.png' });
  check('screenshot traversal filename rejected (INVALID_FILENAME), no file anywhere', shot.isError === true && shot.structuredContent?.error?.code === 'INVALID_FILENAME' && fs.readdirSync(ARTIFACTS, { recursive: true }).length === filesBefore && !fs.existsSync(path.join(ARTIFACTS, '..', '..', '..', 'Windows', 'evil__.png')), shot.content[0].text);
  const sub = await call('capture_viewport_screenshot', { filename: 'reviews/p1/shot.png' });
  const sp = sub.structuredContent?.path || '';
  const identityRoot = rendered.sceneReference
    ? path.resolve(ARTIFACTS, ...namespaceOf(rendered.sceneReference).split('/'))
    : path.resolve(ARTIFACTS, '__missing_identity__');
  const expectedShot = path.join(identityRoot, 'reviews', 'p1', 'shot.png');
  check('screenshot uses identity namespace, keeps requested subdirectory, and stays confined', sub.structuredContent?.ok && path.resolve(sp) === expectedShot && path.resolve(sp).startsWith(path.resolve(ARTIFACTS) + path.sep) && sub.structuredContent?.evidence?.sceneReference?.contentHash === rendered.sceneReference?.contentHash && fs.existsSync(sp), sp || JSON.stringify(sub.structuredContent?.error));
  const logs = await call('import_telemetry_logs');
  check('telemetry log uses the same identity namespace and stays confined', path.resolve(logs.structuredContent?.path || '').startsWith(identityRoot + path.sep) && path.resolve(logs.structuredContent?.path || '').startsWith(path.resolve(ARTIFACTS) + path.sep));

  await call('add_entity', { entityId: 'storage.crate.001', assetRef: 'storage.crate', position: [-1, 0, 1] });
  const staleExport = await call('get_telemetry', { includeManifest: true });
  check('manifest export rejects a stale prior render after session mutation without fallback entities',
    staleExport.isError === true && staleExport.structuredContent?.error?.code === 'EVIDENCE_UNVERIFIED' && staleExport.structuredContent?.manifest === undefined,
    staleExport.content[0].text);

  studio.ws.close();
  lurker.ws.close();
  await client.close();
  await sleep(300);
  const after = await httpReq({ pathName: '/api/vault/status' });
  check('bridge released after MCP exit', after.status === 0, after.error || after.status);

  await bridgeUnitChecks();
  await artifactUnitChecks();

  fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  const passed = results.filter(r => r.pass).length;
  const summary = { suite: 'ws-bridge', port: PORT, passed, failed: results.length - passed, failures: results.filter(r => !r.pass) };
  if (asJson) console.log(JSON.stringify({ summary, results }));
  else {
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
    console.log(`\n${passed}/${results.length} passed`);
  }
  process.exit(summary.failed ? 1 : 0);
}

main().catch(err => { console.error('FATAL', err); process.exit(2); });
