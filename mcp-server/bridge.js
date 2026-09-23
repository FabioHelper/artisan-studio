// Loopback-only browser preview bridge (HTTP + WebSocket), protocol v2 (SPEC-08).
// This is NOT an MCP transport: MCP runs over stdio. The bridge only pushes manifests
// to the local Studio page and relays its telemetry/screenshot/audit replies.
// Every MCP process has an instanceId; a Studio socket is used only after it answered BRIDGE_HELLO with a
// matching BRIDGE_HELLO_ACK, and a reply resolves a request only on the socket the request was sent to.
import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import { BRIDGE_PROTOCOL } from '../src/contracts/artisanContract.js';
import { validateSceneReference } from '../src/contracts/sceneIdentityContract.js';

export const BRIDGE_HOST = '127.0.0.1';
export const WS_PORT = process.env.MCP_WS_PORT ? parseInt(process.env.MCP_WS_PORT, 10) : 3456;
const MAX_HTTP_BODY = 64 * 1024;
const MAX_WS_PAYLOAD = 24 * 1024 * 1024; // screenshots return as PNG data URLs
const VAULT_UPDATE_TYPES = new Set(['cabinet_gate_update']);
const OWNER_PROBE_MS = 1500;
export const HANDSHAKE_GRACE_MS = 2000;
// Each bridge command resolves only on a reply that carries the same id AND this reply type.
export const REPLY_TYPES = Object.freeze({
  MANIFEST: 'MANIFEST_RESULT',
  GET_TELEMETRY: 'TELEMETRY_RESULT',
  CAPTURE_SCREENSHOT: 'SCREENSHOT_RESULT',
  SET_SCENE: 'SCENE_RESULT',
  RUN_AUDIT: 'AUDIT_RESULT'
});
export const BRIDGE_MESSAGES = Object.freeze({ HELLO: 'BRIDGE_HELLO', HELLO_ACK: 'BRIDGE_HELLO_ACK', WORLD_UPDATE: 'WORLD_UPDATE' });

export function allowedOrigins(studioUrl) {
  const set = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
  try { set.add(new URL(studioUrl).origin); } catch (_) {}
  for (const o of (process.env.ARTISAN_STUDIO_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)) set.add(o);
  return set;
}

function hostAllowed(hostHeader) {
  if (!hostHeader) return true;
  return [`127.0.0.1:${WS_PORT}`, `localhost:${WS_PORT}`, `[::1]:${WS_PORT}`].includes(hostHeader.toLowerCase());
}

/** Validates a vault-update payload; returns a sanitized object or throws. */
export function sanitizeVaultUpdate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload must be an object');
  if (!VAULT_UPDATE_TYPES.has(payload.type)) throw new Error(`type must be one of ${[...VAULT_UPDATE_TYPES].join(', ')}`);
  if (typeof payload.cabinetId !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(payload.cabinetId)) throw new Error('cabinetId must be a short identifier');
  if (typeof payload.allPass !== 'boolean') throw new Error('allPass must be boolean');
  const out = { type: payload.type, cabinetId: payload.cabinetId, allPass: payload.allPass };
  if (typeof payload.timestamp === 'string' && payload.timestamp.length <= 40) out.timestamp = payload.timestamp;
  if (payload.results !== undefined) {
    if (!Array.isArray(payload.results) || payload.results.length > 50) throw new Error('results must be an array of at most 50 items');
    out.results = payload.results;
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v, n = 80) => (typeof v === 'string' ? v.slice(0, n) : null);
const int = (v) => (Number.isInteger(v) ? v : null);

/** Shape-checked summary of a render block reported by a Studio page (never trusted beyond its own fields). */
export function sanitizeRender(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const ids = Array.isArray(r.renderedEntityIds) ? r.renderedEntityIds.filter(x => typeof x === 'string').slice(0, 500).map(x => x.slice(0, 120)) : [];
  let sceneReference = null;
  let zoneReference = null;
  let identityError = null;
  try {
    if (r.sceneReference != null) sceneReference = validateSceneReference(r.sceneReference);
    if (r.zoneReference != null) zoneReference = validateSceneReference(r.zoneReference);
  } catch (error) {
    identityError = error?.code || 'IDENTITY_UNRESOLVED';
  }
  const rawZone = r.zoneEvidence && typeof r.zoneEvidence === 'object' && !Array.isArray(r.zoneEvidence) ? r.zoneEvidence : null;
  const rawCamera = rawZone?.camera && typeof rawZone.camera === 'object' && !Array.isArray(rawZone.camera) ? rawZone.camera : null;
  const cameraPosition = Array.isArray(rawCamera?.position) && rawCamera.position.length === 3 && rawCamera.position.every(Number.isFinite)
    ? rawCamera.position.map(Number)
    : null;
  const cameraTarget = Array.isArray(rawCamera?.target) && rawCamera.target.length === 3 && rawCamera.target.every(Number.isFinite)
    ? rawCamera.target.map(Number)
    : null;
  const zoneEvidence = rawZone && cameraPosition && Number.isFinite(rawCamera?.fov)
    ? {
        parentSceneIdentity: str(rawZone.parentSceneIdentity, 96),
        zoneSceneIdentity: str(rawZone.zoneSceneIdentity, 96),
        cameraInZone: rawZone.cameraInZone === true,
        zoneObjectId: str(rawZone.zoneObjectId, 120),
        camera: { position: cameraPosition, ...(cameraTarget ? { target: cameraTarget } : {}), fov: Number(rawCamera.fov) },
        inFrustum: Array.isArray(rawZone.inFrustum) ? rawZone.inFrustum.filter(value => typeof value === 'string').slice(0, 500).map(value => value.slice(0, 120)) : []
      }
    : null;
  return {
    sceneIdentity: str(r.sceneIdentity, 96),
    sceneReference,
    zoneReference,
    zoneEvidence,
    rendererHash: str(r.rendererHash, 80),
    renderPlanHash: str(r.renderPlanHash, 80),
    legacy: r.legacy === true,
    identityError,
    epoch: int(r.epoch),
    worldId: str(r.worldId, 120),
    version: int(r.version),
    renderedEntityIds: ids
  };
}

function httpGet(port, pathName, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request({ host: BRIDGE_HOST, port, path: pathName, method: 'GET', timeout: timeoutMs, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 16384) body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.end();
  });
}

/** Classifies whatever owns 127.0.0.1:<port>: a repaired Artisan MCP, a pre-v2 Artisan bridge, or something else. */
export async function probeBridgeOwner(port, timeoutMs = OWNER_PROBE_MS) {
  const idn = await httpGet(port, '/api/bridge/identity', timeoutMs);
  if (idn.status === 200) {
    try {
      const j = JSON.parse(idn.body);
      if (j && j.service === 'artisan-mcp-bridge' && typeof j.instanceId === 'string' && UUID.test(j.instanceId)) {
        const w = j.world && typeof j.world === 'object' ? j.world : null;
        return {
          kind: 'artisan', port, protocol: int(j.protocol), instanceId: j.instanceId, pid: int(j.pid), startedAt: str(j.startedAt, 40), serverVersion: str(j.serverVersion, 20),
          verifiedClients: int(j.verifiedClients),
          world: w ? {
            worldId: str(w.worldId),
            version: int(w.version),
            sceneIdentity: str(w.sceneIdentity, 96),
            sceneReference: w.sceneReference || null,
            rendererHash: str(w.rendererHash, 80),
            entityCount: int(w.entityCount)
          } : null
        };
      }
    } catch (_) {}
  }
  const root = await httpGet(port, '/', timeoutMs);
  if (root.status === 200 && root.body.includes('Artisan 3D Preview Bridge')) return { kind: 'artisan-legacy', port };
  return { kind: 'foreign', port, httpStatus: root.status || idn.status || 0 };
}

export function startBridge({ studioUrl, sijFile, log = (...a) => console.error(...a), serverVersion = null, getWorld = () => null }) {
  const instanceId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const origins = allowedOrigins(studioUrl);
  // HTTP: non-browser local tools may omit Origin. WebSocket: the Studio is a browser page and always
  // sends Origin, so an upgrade without an allowed Origin is refused.
  const originOk = (origin) => !origin || origins.has(origin);
  const wsOriginOk = (origin) => !!origin && origins.has(origin);
  const pending = new Map();
  const conns = new Map();
  let counter = 1;
  let connCounter = 0;
  let state = 'starting';
  let owner = null;
  let primaryClientId = null;
  const studioBase = String(studioUrl || 'http://127.0.0.1:5173/').split('?')[0];

  const pinnedStudioUrl = (port = WS_PORT) => `${studioBase}?mcpPort=${port}&mcpInstance=${instanceId}`;
  function worldSummary() {
    let w = null;
    try { w = getWorld(); } catch (_) {}
    if (!w) return null;
    let sceneReference = null;
    try { sceneReference = validateSceneReference(w.sceneReference); } catch (_) {}
    return {
      worldId: str(w.worldId),
      version: int(w.version),
      sceneIdentity: str(w.sceneIdentity, 96),
      sceneReference,
      rendererHash: str(w.rendererHash, 80),
      entityCount: int(w.entityCount)
    };
  }
  function describeOwner(o = owner) {
    if (!o) return 'nobody';
    if (o.kind === 'artisan') return `Artisan MCP instance ${o.instanceId} (pid ${o.pid ?? '?'}${o.world?.worldId ? `, world ${o.world.worldId} v${o.world.version}` : ''})`;
    if (o.kind === 'artisan-legacy') return 'a pre-v2 Artisan MCP bridge that reports no instance identity';
    return 'a non-Artisan process';
  }
  function remediation() {
    return {
      stopOwner: owner?.kind === 'artisan' ? `stop MCP instance ${owner.instanceId} (pid ${owner.pid ?? '?'})` : `stop the process that owns the port (find it with: netstat -ano | findstr :${WS_PORT})`,
      relaunch: `relaunch this MCP with MCP_WS_PORT=<free port> and open ${studioBase}?mcpPort=<that port>&mcpInstance=${instanceId}`
    };
  }
  function conflictMessage() {
    const fix = remediation();
    return `Live bridge 127.0.0.1:${WS_PORT} is owned by ${describeOwner()}; this MCP instance ${instanceId} has no live preview. Fix: ${fix.stopOwner}, or ${fix.relaunch}.`;
  }

  const httpServer = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (!hostAllowed(req.headers.host) || !originOk(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden origin or host' }));
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://${BRIDGE_HOST}:${WS_PORT}`);
    if (url.pathname === '/api/bridge/identity' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ service: 'artisan-mcp-bridge', protocol: BRIDGE_PROTOCOL, instanceId, pid: process.pid, startedAt, port: WS_PORT, serverVersion, verifiedClients: verifiedConns().length, world: worldSummary() }));
      return;
    }
    if (url.pathname === '/api/vault/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(fs.existsSync(sijFile) ? fs.readFileSync(sijFile, 'utf8') : JSON.stringify({ error: 'HARNESS-SIJ.json not found' }));
      return;
    }
    if (url.pathname === '/api/vault/update' && req.method === 'POST') {
      let size = 0;
      const chunks = [];
      let aborted = false;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_HTTP_BODY && !aborted) {
          aborted = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `body exceeds ${MAX_HTTP_BODY} bytes` }));
          req.destroy();
          return;
        }
        if (!aborted) chunks.push(chunk);
      });
      req.on('end', () => {
        if (aborted) return;
        try {
          const clean = sanitizeVaultUpdate(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          broadcast(clean);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err.message).slice(0, 200) }));
        }
      });
      return;
    }
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Artisan 3D Preview Bridge</title></head>
<body style="font-family:system-ui;background:#0e1117;color:#e6edf3;padding:40px">
<h2>Artisan 3D Studio — local preview bridge</h2>
<p>Loopback WebSocket <code>ws://${BRIDGE_HOST}:${WS_PORT}</code> used by the MCP server (stdio) to push manifests to the Studio.</p>
<p>MCP instance <code>${instanceId}</code> (protocol ${BRIDGE_PROTOCOL}).</p>
<p><a style="color:#ffbe76" href="${pinnedStudioUrl()}">Open Artisan 3D Studio pinned to this instance</a></p></body></html>`);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: MAX_WS_PAYLOAD,
    verifyClient: (info) => hostAllowed(info.req.headers.host) && wsOriginOk(info.origin || info.req.headers.origin)
  });

  httpServer.on('error', (err) => {
    if (state === 'listening') log('[bridge] HTTP error:', err.message);
  });
  wss.on('error', () => { /* surfaced through httpServer */ });

  /** One bind attempt: true when bound, false on EADDRINUSE, the error code otherwise. */
  function tryListen() {
    return new Promise((resolve) => {
      const onError = (err) => { httpServer.off('listening', onListening); resolve(err.code === 'EADDRINUSE' ? false : String(err.code || err.message)); };
      const onListening = () => { httpServer.off('error', onError); resolve(true); };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(WS_PORT, BRIDGE_HOST);
    });
  }

  let attempts = 0;
  async function acquire() {
    attempts++;
    const bound = await tryListen();
    if (bound === true) {
      state = 'listening';
      owner = null;
      log(`[bridge] preview bridge on ${BRIDGE_HOST}:${WS_PORT} (instance ${instanceId}, protocol ${BRIDGE_PROTOCOL})`);
      return state;
    }
    owner = bound === false ? await probeBridgeOwner(WS_PORT) : { kind: 'foreign', port: WS_PORT, bindError: bound };
    state = 'conflict';
    if (attempts === 1) {
      log([
        '[bridge] ================= CONFLICT =================',
        `[bridge] ${BRIDGE_HOST}:${WS_PORT} is already owned by ${describeOwner()}.`,
        `[bridge] This MCP instance ${instanceId} (pid ${process.pid}) has NO live preview; compile_preview fails with BRIDGE_CONFLICT.`,
        '[bridge] Authoring, validation and headless evidence keep working over stdio.',
        `[bridge] Fix: ${remediation().stopOwner}`,
        `[bridge]  or: ${remediation().relaunch}`,
        '[bridge] ============================================'
      ].join('\n'));
    } else log(`[bridge] re-acquire of ${BRIDGE_HOST}:${WS_PORT} failed; still owned by ${describeOwner()}`);
    return state;
  }
  const readyPromise = acquire();

  /** Lazy re-acquire (no timers): in conflict, retry the bind once; if the owner exited this instance becomes the owner. */
  async function reacquire() {
    await readyPromise;
    if (state !== 'conflict') return state;
    return acquire();
  }

  function openConns() {
    return [...conns.entries()].filter(([ws]) => ws.readyState === 1);
  }
  function verifiedConns() {
    return openConns().filter(([, c]) => c.verified);
  }
  function send(ws, obj) {
    try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) {}
  }

  /** Vault / cabinet messages go to every open socket, verified or not (they carry no commands). */
  function broadcast(payload) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    let n = 0;
    for (const [ws] of openConns()) { ws.send(data); n++; }
    return n;
  }

  function sendToAll(message) {
    return broadcast(message);
  }

  /** Passive world update (no reply) to verified Studio clients only. */
  function publishWorld(manifest) {
    let n = 0;
    for (const [ws] of verifiedConns()) { send(ws, { type: BRIDGE_MESSAGES.WORLD_UPDATE, instanceId, manifest }); n++; }
    return n;
  }

  function primaryClient() {
    const verified = verifiedConns();
    return verified.find(([, c]) => c.clientId === primaryClientId) || verified[0] || null;
  }

  /**
   * Sends a command to verified Studio client(s) and resolves with { msg, clientId, connectionId } for the first
   * reply that arrives on the same socket with the same id and the expected reply type. By default a reply whose
   * instanceId/clientId differ from this instance/that client is ignored; the compile passes verifyIdentity:false
   * so index.js can report a wrong identity as ACK_MISMATCH instead of a silent timeout.
   * MANIFEST without clientId goes to every verified client; everything else goes to one (clientId, else primary).
   */
  function request(type, payload = {}, timeoutMs = 45000, { clientId = null, verifyIdentity = true } = {}) {
    return new Promise((resolve, reject) => {
      const expectedType = REPLY_TYPES[type];
      if (!expectedType) return reject(new Error(`BRIDGE_UNKNOWN_REQUEST: '${type}'`));
      if (state !== 'listening') return reject(new Error(`BRIDGE_NOT_LISTENING: bridge state is '${state}'`));
      const verified = verifiedConns();
      if (verified.length === 0) return reject(new Error(openConns().length ? 'STUDIO_UNVERIFIED: connected Studio tab(s) never completed the v2 handshake; reload the tab' : 'NO_CLIENT_CONNECTED'));
      let targets;
      if (clientId) targets = verified.filter(([, c]) => c.clientId === clientId);
      else if (type === 'MANIFEST') targets = verified;
      else targets = [primaryClient()].filter(Boolean);
      if (targets.length === 0) return reject(new Error(`NO_CLIENT_CONNECTED: Studio client ${String(clientId).slice(0, 40)} is not connected`));
      const ids = [];
      let done = false;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const i of ids) pending.delete(i);
        fn(value);
      };
      const timer = setTimeout(() => finish(reject, new Error(`BRIDGE_TIMEOUT: '${type}' got no reply within ${timeoutMs}ms`)), timeoutMs);
      for (const [ws, c] of targets) {
        const id = `req_${Date.now()}_${counter++}`;
        ids.push(id);
        pending.set(id, { ws, connectionId: c.connectionId, clientId: c.clientId, expectedType, verifyIdentity, resolve: (v) => finish(resolve, v), reject: (e) => finish(reject, e) });
        send(ws, { ...payload, type, id, instanceId });
      }
    });
  }

  wss.on('connection', (ws) => {
    const conn = { connectionId: `conn-${++connCounter}`, clientId: null, verified: false, pinnedInstance: null, connectedAt: Date.now(), render: null };
    conns.set(ws, conn);
    log(`[bridge] Studio connected (${conn.connectionId}); awaiting ${BRIDGE_MESSAGES.HELLO_ACK}`);
    send(ws, { type: BRIDGE_MESSAGES.HELLO, protocol: BRIDGE_PROTOCOL, instanceId, connectionId: conn.connectionId, pid: process.pid, port: WS_PORT, startedAt, serverVersion });
    if (fs.existsSync(sijFile)) {
      try { ws.send(JSON.stringify({ type: 'cabinet_init', vault: JSON.parse(fs.readFileSync(sijFile, 'utf8')) })); } catch (_) {}
    }
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg?.type === BRIDGE_MESSAGES.HELLO_ACK) {
        const okAck = msg.protocol === BRIDGE_PROTOCOL && msg.instanceId === instanceId && msg.connectionId === conn.connectionId
          && typeof msg.clientId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(msg.clientId);
        if (okAck && !conn.verified) {
          conn.verified = true;
          conn.clientId = msg.clientId;
          conn.pinnedInstance = str(msg.pinnedInstance, 64);
          conn.render = sanitizeRender(msg.render);
          log(`[bridge] Studio ${conn.connectionId} verified (client ${conn.clientId})`);
        } else if (!okAck) log(`[bridge] ignored ${BRIDGE_MESSAGES.HELLO_ACK} on ${conn.connectionId}: protocol/instance/connection mismatch`);
        return;
      }
      if (msg?.type === 'get_vault_status' && fs.existsSync(sijFile)) {
        try { ws.send(JSON.stringify({ type: 'cabinet_status', vault: JSON.parse(fs.readFileSync(sijFile, 'utf8')) })); } catch (_) {}
        return;
      }
      if (!msg?.id || !pending.has(msg.id)) return;
      const p = pending.get(msg.id);
      if (p.ws !== ws) { log(`[bridge] ignored reply for ${msg.id}: arrived on ${conn.connectionId}, was sent to ${p.connectionId}`); return; }
      if (msg.type !== p.expectedType) { log(`[bridge] ignored reply for ${msg.id}: type '${String(msg.type).slice(0, 40)}' != '${p.expectedType}'`); return; }
      if (p.verifyIdentity && (msg.instanceId !== instanceId || msg.clientId !== p.clientId)) { log(`[bridge] ignored reply for ${msg.id}: foreign instanceId/clientId`); return; }
      if (msg.render) conn.render = sanitizeRender(msg.render);
      p.resolve({ msg, clientId: conn.clientId, connectionId: conn.connectionId });
    });
    ws.on('close', () => {
      conns.delete(ws);
      if (conn.clientId && conn.clientId === primaryClientId) primaryClientId = null;
      for (const p of [...pending.values()]) if (p.ws === ws) p.reject(new Error(`STUDIO_DISCONNECTED: ${conn.connectionId} closed before replying`));
      log(`[bridge] Studio disconnected (${conn.connectionId})`);
    });
  });

  const clientList = () => openConns().map(([, c]) => ({ connectionId: c.connectionId, clientId: c.clientId, verified: c.verified, pinnedInstance: c.pinnedInstance, connectedAt: new Date(c.connectedAt).toISOString(), sceneIdentity: c.render?.sceneIdentity ?? null }));

  return {
    host: BRIDGE_HOST,
    port: WS_PORT,
    instanceId,
    pid: process.pid,
    startedAt,
    protocol: BRIDGE_PROTOCOL,
    ready: () => readyPromise,
    state: () => state,
    owner: () => owner,
    reacquire,
    remediation,
    conflictMessage,
    describeOwner,
    pinnedStudioUrl,
    isListening: () => state === 'listening',
    clientCount: () => verifiedConns().length,
    unverifiedCount: () => openConns().filter(([, c]) => !c.verified).length,
    /** Unverified sockets still inside the handshake grace window (a tab that is just connecting). */
    handshakesInFlight: () => openConns().filter(([, c]) => !c.verified && Date.now() - c.connectedAt < HANDSHAKE_GRACE_MS).length,
    clients: clientList,
    primaryClientId: () => primaryClient()?.[1].clientId ?? null,
    setPrimary: (id) => { if (verifiedConns().some(([, c]) => c.clientId === id)) primaryClientId = id; },
    broadcast,
    sendToAll,
    publishWorld,
    request,
    close: () => new Promise(r => {
      for (const p of [...pending.values()]) p.reject(new Error('BRIDGE_CLOSED'));
      for (const [ws] of conns) { try { ws.terminate(); } catch (_) {} }
      wss.close();
      if (state === 'listening') httpServer.close(() => r()); else r();
    })
  };
}
