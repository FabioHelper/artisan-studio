// P0.5 MCP evidence-integrity verification (SPEC-08) — the single acceptance command.
// S0 preflight → S1 static → S2 node suites → S3 browser units → S4 replay LIVE → S5 replay CONFLICT
// → S6 acceptance (A-1..A-12) → S7 P0 regression (verify_astra_harness) → S8 tree integrity.
// Usage: node scripts/verify_mcp_evidence_integrity.mjs            (acceptance run: no flags)
//        node scripts/verify_mcp_evidence_integrity.mjs --skip-p0  (inner dev loop only; overall can never PASS)
// Report: .artisan-artifacts/verify-evidence/latest/evidence_integrity_report.json
// Hermetic: own Vite and bridge ports (never 3456/9900/5173), own headless browser, writes only under the
// artifact root, refuses to run rather than kill anything when no candidate port is free.
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.artisan-artifacts', 'verify-evidence', 'latest');
const SKIP_P0 = process.argv.includes('--skip-p0');
const FIXTURE = path.join(ROOT, '.artisan-artifacts', 'dogfood', 'p1-current-harness');
const F4BB = 'sha256:f4bb39db91d785d657fb56059e7222f4';
const VITE_PORTS = [5189, 5188, 5187];
const BRIDGE_PORTS = [3481, 3482, 3483, 3484, 3485, 3486, 3487, 3488, 3489];
const PROTECTED_PORTS = new Set([3456, 9900, 5173]);
const VIEW = { width: 1280, height: 720, deviceScaleFactor: 1 };
const HARNESS_PRESET_DRAWS = { trio: 16, tavern: 17, alchemist: 25, armory: 22, library: 28, tokyo: 45, winterhold: 39, fantastic: 58 };
const BASELINE_FILE = path.join(ROOT, '.bridge', 'ARTISAN-MCP-EVIDENCE-INTEGRITY-BASELINE.json');
const CLAIM_TOKENS = ['actionTaken', "'MITIGATED'", "'RESOLVED'", 'ZERO GUESSWORK', 'LOCKED 60 FPS'];
const BROWSER = [process.env.ARTISAN_BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(p => fs.existsSync(p));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- bookkeeping
const gates = [];
const t0 = Date.now();
const report = { suite: 'artisan-mcp-evidence-integrity', startedAt: new Date().toISOString(), flags: { skipP0: SKIP_P0 }, node: process.version, browser: BROWSER || null, ports: {}, stages: {}, identityTable: [], measurements: {}, pngs: [], nodeSuites: {}, transcript: [], pageErrors: [] };
function gate(id, stage, group, pass, evidence, { blocking = true } = {}) {
  const g = { id, stage, group, status: pass ? 'pass' : 'fail', blocking, evidence: String(evidence).slice(0, 500) };
  gates.push(g);
  console.log(`${pass ? 'PASS' : blocking ? 'FAIL' : 'WARN'} [${stage}] ${id} — ${String(evidence).slice(0, 170)}`);
  return pass;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const setEq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && new Set(a).size === a.length && b.every(x => a.includes(x));
const codeOf = (r) => r?.structuredContent?.error?.code ?? (r?.structuredContent?.ok ? 'OK' : 'NONE');
const textOf = (r) => r?.content?.[0]?.text || '';
const tail = (s, n = 3) => String(s || '').trim().split('\n').slice(-n).join(' | ');
const lastJson = (s) => { const line = String(s || '').trim().split('\n').reverse().find(l => l.startsWith('{')); try { return line ? JSON.parse(line) : null; } catch { return null; } };
const inside = (p, dir) => { if (!p) return false; const rel = path.relative(dir, path.resolve(p)); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
function run(cmd, args, { timeout = 600000, env = {} } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout, shell: false, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? (r.error ? -1 : 0), stdout: r.stdout || '', stderr: r.stderr || '', error: r.error?.message };
}
async function waitFor(pred, ms = 5000, step = 100) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if (await pred()) return true; } catch {} await sleep(step); }
  return false;
}
function listFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) listFiles(p, out); else out.push(p); }
  return out;
}
function portFree(port) {
  return new Promise(res => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port, '127.0.0.1'); });
}
async function waitHttp(url, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { const r = await fetch(url); if (r.ok) return true; } catch {} await sleep(300); }
  return false;
}
function httpJson(port, pathName) {
  return fetch(`http://127.0.0.1:${port}${pathName}`).then(async r => ({ status: r.status, json: await r.json().catch(() => null) })).catch(() => ({ status: 0, json: null }));
}
// SHA-256 of every project file outside .git, node_modules and the artifact root (same exclusions as the harness).
const ARTIFACT_ROOT = path.resolve(process.env.ARTISAN_ARTIFACTS_DIR || path.join(ROOT, '.artisan-artifacts'));
function hashTree(dir = ROOT, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.git' || e.name === 'node_modules' || path.resolve(p) === ARTIFACT_ROOT || path.resolve(p) === path.join(ROOT, '.artisan-artifacts')) continue;
      hashTree(p, out);
    } else if (e.isFile()) out[path.relative(ROOT, p).replace(/\\/g, '/')] = sha256(fs.readFileSync(p));
  }
  return out;
}

// ---------------------------------------------------------------- fixture
const AUTHORED = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'authored-world.json'), 'utf8'));
const AUTHORED_IDS = AUTHORED.entities.map(e => e.id);
const MUTATING = new Set([...Array.from({ length: 14 }, (_, i) => i + 1), 22]);
const REPLAY = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'tool-call-log.json'), 'utf8')).mcpCalls.filter(c => MUTATING.has(c.step)).map(c => [c.name, c.args]);
const CONTROL_IDS = ['study-shell', 'worktable', 'water-barrel'];
const C = await import(pathToFileURL(path.join(ROOT, 'src', 'contracts', 'artisanContract.js')).href);
const fullIdentityHashOf = (m) => sha256(C.canonicalJson(m));
const identityOf = (m) => 'sha256:' + fullIdentityHashOf(m).slice(0, 32);
const AUTHORED_EVIDENCE_NAMESPACE = path.join('evidence', 'authored-world', encodeURIComponent(AUTHORED.worldId), `v${AUTHORED.version}`, fullIdentityHashOf(AUTHORED));
const DIORAMA = C.PERFORMANCE_PROFILES.diorama;

// ---------------------------------------------------------------- shared runtime
const { connect } = await import(pathToFileURL(path.join(ROOT, 'mcp-server', 'test_stdio_client.js')).href);
let vite = null, browser = null, helper = null, studioUrl = null;
const mcps = [];
const ports = {};
async function startMcp(tag, env) {
  const artifacts = path.join(OUT, `mcp-${tag}`);
  fs.mkdirSync(artifacts, { recursive: true });
  const client = await connect({ ARTISAN_STUDIO_URL: studioUrl, ARTISAN_ARTIFACTS_DIR: artifacts, ARTISAN_BROWSER_PATH: BROWSER || '', ...env });
  const m = {
    tag, artifacts, client,
    caps: async () => JSON.parse((await client.readResource({ uri: 'artisan://capabilities' })).contents[0].text),
    call: async (name, args = {}) => {
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 240000 });
      report.transcript.push({ mcp: tag, name, args: name === 'add_entity' ? { entityId: args.entityId } : args, code: codeOf(r), text: textOf(r).slice(0, 160) });
      return r;
    }
  };
  mcps.push(m);
  return m;
}
async function settledBridge(m, ms = 6000) {
  let c = null;
  await waitFor(async () => { c = await m.caps(); const b = c.previewBridge || {}; return (b.state && b.state !== 'starting') || b.listening === true; }, ms, 100);
  return c;
}
async function replay(m) {
  const failed = [];
  for (const [name, args] of REPLAY) { const r = await m.call(name, args); if (!r.structuredContent?.ok) failed.push(`${name}:${codeOf(r)}`); }
  return failed;
}
async function openStudio(query) {
  const page = await browser.newPage();
  await page.setViewport(VIEW);
  page.on('pageerror', e => report.pageErrors.push(String(e.message).slice(0, 200)));
  await page.goto(`${studioUrl}${query}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#webgl', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__artisan, { timeout: 30000 });
  return page;
}
/** Decodes a PNG in the browser: size, fraction of pure-magenta pixels, luma mean and std-dev. */
async function analyzePng(b64) {
  return helper.evaluate(async (data) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + data;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let mag = 0, sum = 0, sum2 = 0;
    const n = c.width * c.height;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (r > 240 && gg < 16 && b > 240) mag++;
      const y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      sum += y; sum2 += y * y;
    }
    const mean = sum / n;
    return { width: c.width, height: c.height, magentaFrac: mag / n, lumaMean: mean, lumaStd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
  }, b64);
}
async function pngFileStats(file) {
  if (!file || !fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  return { ...(await analyzePng(buf.toString('base64'))), bytes: buf.length, sha256: sha256(buf) };
}
const ev = (r) => r?.structuredContent?.evidence || {};
function identityRow(kind, r, extra = {}) {
  const sc = r?.structuredContent || {};
  const e = sc.evidence || {};
  const row = { kind, code: codeOf(r), sceneIdentity: e.sceneIdentity ?? sc.sceneIdentity ?? null, identityVerified: e.identityVerified ?? null, authored: e.authored ?? null, source: e.source ?? sc.source ?? null, instanceId: e.renderer?.instanceId ?? null, clientId: e.renderer?.clientId ?? null, path: sc.path ?? sc.artifacts?.json ?? null, ...extra };
  if (row.path && fs.existsSync(row.path)) row.sha256 = sha256(fs.readFileSync(row.path));
  report.identityTable.push(row);
  return row;
}
/** A verified authored evidence envelope from the expected renderer. */
function authoredVerified(r, { source, instanceId, clientId }) {
  const sc = r?.structuredContent || {};
  const e = sc.evidence || {};
  return sc.ok === true && sc.sceneIdentity === F4BB && e.sceneIdentity === F4BB && e.identityVerified === true && e.authored === true
    && e.source === source && typeof instanceId === 'string' && e.renderer?.instanceId === instanceId && (clientId === undefined || e.renderer?.clientId === clientId)
    && e.worldId === AUTHORED.worldId && e.version === AUTHORED.version && e.entityCount === AUTHORED.entities.length;
}
const summarizeEnv = (r) => { const e = ev(r); return `code=${codeOf(r)} id=${e.sceneIdentity ?? r?.structuredContent?.sceneIdentity} verified=${e.identityVerified} src=${e.source ?? r?.structuredContent?.source} inst=${e.renderer?.instanceId?.slice?.(0, 8)} client=${e.renderer?.clientId?.slice?.(0, 8)}`; };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

async function stage(id, title, fn) {
  const t = Date.now();
  console.log(`\n=== ${id} ${title}`);
  try { await fn(); } catch (err) { gate(`${id}-exception`, id, 'integrity', false, err.stack || err.message); }
  report.stages[id] = { title, seconds: Math.round((Date.now() - t) / 100) / 10 };
}

// Collected results shared by the acceptance stage.
const R = { units: {}, live: {}, conflict: {}, control: {}, static: {}, harness: null, nodeSuites: {} };
let treeBefore = null;

// ---------------------------------------------------------------- S0 preflight
let preflightOk = true;
await stage('S0', 'preflight', async () => {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  preflightOk &= gate('S0-node', 'S0', 'integrity', major >= 22, `node ${process.version}`);
  preflightOk &= gate('S0-browser', 'S0', 'integrity', !!BROWSER, BROWSER || 'no Chromium-based browser found');
  const freeVite = [];
  for (const p of VITE_PORTS) if (!PROTECTED_PORTS.has(p) && await portFree(p)) freeVite.push(p);
  const freeBridge = [];
  for (const p of BRIDGE_PORTS) if (!PROTECTED_PORTS.has(p) && await portFree(p)) freeBridge.push(p);
  Object.assign(ports, { vite: freeVite[0], units: freeBridge[0], live: freeBridge[1], decoy: freeBridge[2], wsTest: freeBridge[3] });
  report.ports = ports;
  preflightOk &= gate('S0-ports', 'S0', 'integrity', !!ports.vite && freeBridge.length >= 4, `vite ${ports.vite ?? 'NONE'} of ${VITE_PORTS}; bridges ${freeBridge.slice(0, 4).join(',') || 'NONE'} of ${BRIDGE_PORTS[0]}-${BRIDGE_PORTS.at(-1)} (never 3456/9900/5173; nothing is killed)`);
  const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'evidence-files.json'), 'utf8'));
  const bad = manifest.filter(f => sha256(fs.readFileSync(path.join(FIXTURE, f.name))).toUpperCase() !== f.sha256);
  preflightOk &= gate('S0-fixture-sha256', 'S0', 'integrity', bad.length === 0, bad.length ? `MISMATCH: ${bad.map(f => f.name).join(',')}` : `${manifest.length}/${manifest.length} dogfood fixture files match evidence-files.json`);
  treeBefore = hashTree();
  report.treeFilesBefore = Object.keys(treeBefore).length;
});

if (!preflightOk) {
  console.log('\nS-5: preflight failed — refusing to run (nothing started, nothing killed).');
} else {
  // ---------------------------------------------------------------- S1 static
  await stage('S1', 'static gates', async () => {
    const d = run(process.execPath, ['scripts/check_contract_drift.mjs', '--json'], { timeout: 180000 });
    const dj = lastJson(d.stdout);
    gate('S1-contract-drift', 'S1', 'p0', d.code === 0 && dj?.summary?.failed === 0, dj ? `${dj.summary.passed} passed, ${dj.summary.failed} failed${dj.summary.failed ? ': ' + dj.summary.failures.map(f => f.name).join(' | ').slice(0, 300) : ''}` : `exit ${d.code}: ${tail(d.stderr || d.stdout)}`);
    const identities = run(process.execPath, ['scripts/generate_scene_identities.mjs', '--check'], { timeout: 120000 });
    gate('S1-scene-identities-generated', 'S1', 'integrity', identities.code === 0, tail(identities.stderr || identities.stdout, 1));
    const g = run('python', ['scripts/gate.py'], { timeout: 120000 });
    gate('S1-sart-gate-P1-P10', 'S1', 'p0', g.code === 0, tail(g.stdout, 1));
    const hr = fs.readFileSync(path.join(ROOT, 'mcp-server', 'HeadlessRunner.js'), 'utf8');
    gate('S1-headless-no-page-screenshot', 'S1', 'integrity', !/page\.screenshot\(/.test(hr), /page\.screenshot\(/.test(hr) ? 'HeadlessRunner.js still calls page.screenshot( (DOM overlays reach the evidence)' : 'HeadlessRunner.js has no page.screenshot( call');
    const claimHits = [];
    for (const rel of ['src/engine/ArtisanProfiler.js', 'scripts/run_perf_audit.js']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const tok of CLAIM_TOKENS) if (src.includes(tok)) claimHits.push(`${rel}:${tok}`);
    }
    gate('S1-audit-no-claim-tokens', 'S1', 'integrity', claimHits.length === 0, claimHits.length ? `claim tokens present: ${claimHits.join(', ')}` : 'no canned repair/verdict claim tokens in the audit sources');
  });

  // ---------------------------------------------------------------- S2 node suites
  await stage('S2', 'node suites', async () => {
    for (const [id, file, env, group] of [
      ['S2-mcp-stdio-sdk', 'mcp-server/test_stdio_client.js', {}, 'p0'],
      ['S2-ws-bridge-privacy', 'mcp-server/test_ws_bridge.js', { TEST_WS_PORT: String(ports.wsTest) }, 'p0'],
      ['S2-scene-identity', 'mcp-server/test_scene_identity.js', {}, 'integrity'],
      ['S2-mcp-evidence-integrity-node', 'mcp-server/test_evidence_integrity.js', {}, 'integrity']
    ]) {
      const r = run(process.execPath, [file, '--json'], { env, timeout: 400000 });
      const j = lastJson(r.stdout);
      R.nodeSuites[id] = j || { error: tail(r.stderr || r.stdout) };
      report.nodeSuites[id] = j ? { summary: j.summary, results: j.results?.map(x => ({ name: x.name, pass: x.pass, detail: x.detail })) } : R.nodeSuites[id];
      gate(id, 'S2', group, r.code === 0 && j?.summary?.failed === 0, j ? `${j.summary.passed} passed, ${j.summary.failed} failed${j.summary.failed ? ': ' + j.summary.failures.map(f => f.name).join(' | ').slice(0, 300) : ''}${j.summary.toolSchemaChars ? `; tool schema ${j.summary.toolSchemaChars} chars` : ''}` : `exit ${r.code}: ${tail(r.stderr || r.stdout)}`);
    }
    const stdio = R.nodeSuites['S2-mcp-stdio-sdk']?.summary;
    gate('S2-tool-schema-cap', 'S2', 'p0', typeof stdio?.toolSchemaChars === 'number' && stdio.toolSchemaChars <= 7960 && stdio.toolSchemaTokens <= 2000, `${stdio?.toolSchemaChars ?? '?'} chars (cap 7,960) ≈ ${stdio?.toolSchemaTokens ?? '?'} tokens (gate 2,000)`);
    const tools13 = R.nodeSuites['S2-mcp-stdio-sdk']?.results?.find(x => x.name === 'tools/list count == 13');
    gate('S2-tools-13', 'S2', 'p0', tools13?.pass === true, tools13 ? `tools/list count: ${tools13.detail}` : 'stdio suite did not report the tool count');
  });

  // ---------------------------------------------------------------- shared browser + Vite
  studioUrl = `http://127.0.0.1:${ports.vite}/`;
  vite = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(ports.vite), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  try {
    const viteUp = await waitHttp(studioUrl, 40000);
    gate('S3-vite-up', 'S3', 'integrity', viteUp, studioUrl);
    browser = await puppeteer.launch({ executablePath: BROWSER, headless: 'new', args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1280,720'] });
    helper = await browser.newPage();

    // ---------------------------------------------------------------- S3 browser units
    await stage('S3', 'browser units (T-BRW, T-AUD, T-EVD-6..8)', async () => {
      fs.mkdirSync(path.join(OUT, 'units'), { recursive: true });
      const page0 = await openStudio('?mcpBridge=off');
      await sleep(1500);
      await page0.evaluate(() => window.__artisan.applyDPRPreset?.('balanced'));
      const id1 = await page0.evaluate(async (m) => { const f = window.__artisan?.computeSceneIdentity; try { return f ? await f(m) : 'ABSENT'; } catch (e) { return `ERR ${e.message}`; } }, AUTHORED);
      gate('T-BRW-1', 'S3', 'integrity', id1 === F4BB, `browser computeSceneIdentity(authored-world.json) = ${id1}`);

      const applied = await page0.evaluate(async (m) => {
        const a = window.__artisan;
        if (!a?.applyAuthoredManifest) return { absent: true };
        try { const r = await a.applyAuthoredManifest(m); return { r, state: a.getRenderState?.() ?? null }; } catch (e) { return { error: e.message }; }
      }, AUTHORED);
      R.units.applied = applied;
      gate('T-BRW-2', 'S3', 'integrity', !applied.absent && setEq(applied.r?.renderedEntityIds, AUTHORED_IDS) && applied.r?.sceneIdentity === F4BB && applied.state?.sceneIdentity === F4BB,
        applied.absent ? 'applyAuthoredManifest ABSENT' : `rendered ${applied.r?.renderedEntityIds?.length}/13 set-equal=${setEq(applied.r?.renderedEntityIds, AUTHORED_IDS)} state=${applied.state?.sceneIdentity} ${applied.error || ''}`);

      await page0.evaluate(() => { window.__artisan.setCameraAngle?.('hero'); const d = document.createElement('div'); d.id = 'evi-magenta'; d.style.cssText = 'position:fixed;inset:0;background:#FF00FF;z-index:2147483647;pointer-events:none'; document.body.appendChild(d); });
      await sleep(300);
      const cap = await page0.evaluate(async () => { const a = window.__artisan; if (!a?.captureCanvas) return { absent: true }; try { return await a.captureCanvas({ angle: 'hero' }); } catch (e) { return { error: e.message }; } });
      const neg = await page0.screenshot({ type: 'png', encoding: 'base64' });
      await page0.evaluate(() => document.getElementById('evi-magenta')?.remove());
      const capB64 = typeof cap.dataUrl === 'string' ? cap.dataUrl.split(',')[1] : null;
      const capStats = capB64 ? await analyzePng(capB64) : null;
      const negStats = await analyzePng(neg);
      if (capB64) { const f = path.join(OUT, 'units', 'brw3-canvas.png'); fs.writeFileSync(f, Buffer.from(capB64, 'base64')); report.pngs.push({ kind: 'T-BRW-3 canvas', path: f, sha256: sha256(fs.readFileSync(f)), ...capStats }); }
      R.units.brw3 = { capStats, negStats };
      gate('T-BRW-3', 'S3', 'integrity', !!capStats && capStats.magentaFrac <= 0.001 && capStats.width === 1280 && capStats.height === 720 && negStats.magentaFrac >= 0.99,
        cap.absent ? `captureCanvas ABSENT; negative control page.screenshot magenta ${(negStats.magentaFrac * 100).toFixed(1)}%` : `canvas magenta ${capStats ? (capStats.magentaFrac * 100).toFixed(3) : '?'}% ${capStats?.width}x${capStats?.height}; page.screenshot control ${(negStats.magentaFrac * 100).toFixed(1)}% ${cap.error || ''}`);

      // T-AUD-1..4 on the authored world with a fixed DPR preset and a non-default pixel ratio
      const aud = await page0.evaluate(async () => {
        const a = window.__artisan;
        a.applyDPRPreset?.('balanced');
        a.renderer.setPixelRatio(1.5);
        const before = a.renderer.getPixelRatio();
        let report = null, error = null;
        try { report = await a.profiler.runAudit(); } catch (e) { error = e.message; }
        const after = a.renderer.getPixelRatio();
        a.applyDPRPreset?.('balanced');
        return { before, after, report, error };
      });
      R.units.audit = { before: aud.before, after: aud.after, verdict: aud.report?.verdict, scene: aud.report?.scene, restoredState: aud.report?.restoredState, device: aud.report?.device };
      fs.writeFileSync(path.join(OUT, 'units', 'aud-page-report.json'), JSON.stringify(aud.report, null, 2));
      const rep = aud.report || {};
      gate('T-AUD-1', 'S3', 'integrity', aud.before === 1.5 && aud.after === 1.5 && rep.restoredState?.ok === true, `pixel ratio before ${aud.before} after ${aud.after}; restoredState ${JSON.stringify(rep.restoredState ?? null)} ${aud.error || ''}`);
      const guns = Array.isArray(rep.smokingGuns) ? rep.smokingGuns : [];
      const verdict = String(rep.verdict ?? '');
      gate('T-AUD-2', 'S3', 'integrity', !!aud.report && guns.every(g => !('actionTaken' in g) && g.status === 'OBSERVED' && g.repairApplied === false) && !/ZERO GUESSWORK|LOCKED 60 FPS/.test(verdict) && !JSON.stringify(rep).includes('actionTaken'),
        `verdict "${verdict}"; ${guns.length} gun(s): ${guns.map(g => `${g.status}/${g.repairApplied}`).join(',') || 'none'}`);
      const deltas = rep.telemetry?.entityDeltas || [];
      gate('T-AUD-3', 'S3', 'integrity', rep.scene?.sceneIdentity === F4BB && rep.scene?.epochStart === rep.scene?.epochEnd && typeof rep.scene?.epochStart === 'number' && deltas.length > 0 && deltas.every(d => AUTHORED_IDS.includes(d.name)),
        `scene ${JSON.stringify(rep.scene ?? null)?.slice(0, 120)}; entityDeltas ${deltas.map(d => d.name).join(',')}`);
      gate('T-AUD-4', 'S3', 'integrity', typeof rep.device?.gpu === 'string' && rep.device.gpu.length > 3 && !/^WebGL [12]\.0$/.test(rep.device.gpu), `device.gpu=${rep.device?.gpu ?? 'ABSENT'} gpuRenderer=${rep.device?.gpuRenderer}`);
      await page0.close();

      // MCP U: bridge listening, authored replay world, no verified client
      const U = await startMcp('units', { ARTISAN_BRIDGE: 'on', MCP_WS_PORT: String(ports.units) });
      const cu0 = await settledBridge(U);
      const uId = cu0.previewBridge?.instanceId;
      R.units.instanceId = uId;
      const uFailed = await replay(U);
      if (uFailed.length) gate('S3-units-replay', 'S3', 'integrity', false, uFailed.join(','));

      const page1 = await openStudio(`?mcpPort=${ports.units}&mcpInstance=00000000-0000-0000-0000-000000000000`);
      await sleep(3500);
      const label1 = await page1.evaluate(() => document.getElementById('mcp-label')?.textContent || '');
      const cu1 = await U.caps();
      gate('T-BRW-4', 'S3', 'integrity', label1.includes('MCP: WRONG INSTANCE') && cu1.previewBridge?.studioClients === 0, `label "${label1}"; studioClients ${cu1.previewBridge?.studioClients}`);
      await page1.close();
      await waitFor(async () => { const b = (await U.caps()).previewBridge || {}; return b.studioClients === 0 && !(b.unverifiedClients > 0); }, 6000);

      const s6 = await U.call('capture_viewport_screenshot', { filename: 'units/authored-headless.png' });
      identityRow('T-EVD-6 capture (headless, no scene)', s6);
      const s6file = path.join(U.artifacts, AUTHORED_EVIDENCE_NAMESPACE, 'units', 'authored-headless.png');
      gate('T-EVD-6', 'S3', 'integrity', s6.structuredContent?.source === 'headless' && authoredVerified(s6, { source: 'headless', instanceId: uId }) && path.resolve(s6.structuredContent?.path || '') === path.resolve(s6file) && inside(s6file, U.artifacts) && fs.existsSync(s6file), `${summarizeEnv(s6)} expectedPath=${s6file} actualPath=${s6.structuredContent?.path}`);

      const t7 = await U.call('get_engine_telemetry', {});
      identityRow('T-EVD-7 engine telemetry (headless)', t7);
      const a7 = await U.call('run_performance_audit', {});
      identityRow('T-EVD-7 audit (headless, no scene)', a7);
      const a7rep = readJson(a7.structuredContent?.artifacts?.json);
      const a7names = (a7rep?.telemetry?.entityDeltas || []).map(d => d.name);
      gate('T-EVD-7', 'S3', 'integrity', authoredVerified(t7, { source: 'headless', instanceId: uId }) && authoredVerified(a7, { source: 'headless', instanceId: uId }) && setEq(a7rep?.scene?.entityIds, AUTHORED_IDS) && a7names.length > 0 && a7names.every(n => AUTHORED_IDS.includes(n)),
        `telemetry ${summarizeEnv(t7)}; audit ${summarizeEnv(a7)} entityDeltas=${a7names.join(',') || 'none'}`);

      const s8 = await U.call('capture_viewport_screenshot', { scene: 'alchemist', filename: 'units/preset-alchemist.png' });
      identityRow('T-EVD-8 capture preset alchemist', s8);
      const e8 = ev(s8);
      gate('T-EVD-8', 'S3', 'integrity', s8.structuredContent?.ok === true && e8.sceneIdentity === 'preset:alchemist' && s8.structuredContent?.sceneIdentity === 'preset:alchemist' && e8.authored === false && !JSON.stringify(s8.structuredContent).includes(F4BB) && !('manifest' in (s8.structuredContent || {})),
        `${summarizeEnv(s8)} authored=${e8.authored} carriesAuthoredIdentity=${JSON.stringify(s8.structuredContent || {}).includes(F4BB)}`);
      R.units.headlessCapture = { stats: await pngFileStats(s6file), response: s6.structuredContent };
    });

    // ---------------------------------------------------------------- S4 replay LIVE
    await stage('S4', 'R-LIVE: pinned Studio, 15-call replay, verified evidence', async () => {
      const A = await startMcp('live', { ARTISAN_BRIDGE: 'on', MCP_WS_PORT: String(ports.live) });
      const ca = await settledBridge(A);
      const aId = ca.previewBridge?.instanceId;
      R.live.instanceId = aId;
      const pageA = await openStudio(`?mcpPort=${ports.live}&mcpInstance=${aId}`);
      R.live.page = pageA;
      await pageA.evaluate(() => { window.__artisan.applyDPRPreset?.('balanced'); window.__artisan.setCameraAngle('hero'); });
      const joined = await waitFor(async () => (await A.caps()).previewBridge?.studioClients === 1, 20000, 250);
      const capsA = await A.caps();
      R.live.caps = capsA.previewBridge;
      gate('R-LIVE-studio-verified', 'S4', 'integrity', joined && (capsA.previewBridge?.state === 'listening'), `studioClients ${capsA.previewBridge?.studioClients}; state ${capsA.previewBridge?.state}; instance ${aId}`);
      await sleep(500);
      R.live.pageClientId = await pageA.evaluate(() => window.__artisan.getRenderState?.()?.clientId ?? null);

      R.live.replayFailed = await replay(A);
      R.live.validate = (await A.call('validate_scene')).structuredContent;
      R.live.compile = await A.call('compile_preview', { timeoutMs: 20000 });
      R.live.telemetry = await A.call('get_engine_telemetry', { profile: 'diorama' });
      identityRow('R-LIVE engine telemetry', R.live.telemetry);
      R.live.capture = await A.call('capture_viewport_screenshot', { filename: 'replay/live/authored-hero.png', angle: 'hero' });
      identityRow('R-LIVE capture authored hero', R.live.capture);
      R.live.import = await A.call('import_telemetry_logs');
      identityRow('R-LIVE telemetry export (import_telemetry_logs)', R.live.import);
      R.live.importFile = readJson(R.live.import.structuredContent?.path);
      R.live.export = await A.call('get_telemetry', { includeManifest: true });
      R.live.audit = await A.call('run_performance_audit');
      identityRow('R-LIVE audit (no scene)', R.live.audit);
      R.live.auditFile = readJson(R.live.audit.structuredContent?.artifacts?.json);
      R.live.identityEndpoint = await httpJson(ports.live, '/api/bridge/identity');
      R.live.label = await pageA.evaluate(() => document.getElementById('mcp-label')?.textContent || '');
      R.live.captureStats = await pngFileStats(R.live.capture.structuredContent?.path);
      identityRow('R-LIVE compile ack', R.live.compile, { sceneIdentity: R.live.compile.structuredContent?.ack?.sceneIdentity ?? null, instanceId: R.live.compile.structuredContent?.ack?.instanceId ?? null, clientId: R.live.compile.structuredContent?.ack?.clientId ?? null, source: 'live' });
      const exp = R.live.export.structuredContent || {};
      identityRow('R-LIVE manifest export (get_telemetry)', R.live.export, { sceneIdentity: exp.sceneIdentity ?? null, source: exp.lastVerifiedRender?.source ?? null, instanceId: exp.lastVerifiedRender?.instanceId ?? null, clientId: exp.lastVerifiedRender?.clientId ?? null, identityVerified: exp.lastVerifiedRender?.sceneIdentity === exp.sceneIdentity });

      // Negative leg 1: the same resolvable authored identity changes epoch during capture.
      const staleBefore = new Set(listFiles(A.artifacts));
      await pageA.evaluate((manifest) => {
        let remaining = 6;
        const timer = setInterval(() => {
          window.__artisan.applyAuthoredManifest(manifest);
          remaining--;
          if (remaining <= 0) clearInterval(timer);
        }, 75);
      }, AUTHORED);
      R.live.staleResolvable = await A.call('capture_viewport_screenshot', { filename: 'replay/live/rejected-stale-resolvable.png' });
      R.live.staleResolvableNewFiles = listFiles(A.artifacts).filter(f => !staleBefore.has(f)).map(f => path.relative(A.artifacts, f));
      await sleep(700);

      // Negative leg 2: a legacy preset has no resolvable structured authored identity.
      await pageA.evaluate(() => window.__artisan.loadScene('alchemist'));
      await sleep(800);
      const before = new Set(listFiles(A.artifacts));
      R.live.unresolved = {};
      for (const [name, args] of [['get_engine_telemetry', {}], ['import_telemetry_logs', {}], ['run_performance_audit', {}]]) R.live.unresolved[name] = await A.call(name, args);
      R.live.unresolvedNewFiles = listFiles(A.artifacts).filter(f => !before.has(f)).map(f => path.relative(A.artifacts, f));
      R.live.presetCapture = await A.call('capture_viewport_screenshot', { scene: 'alchemist', filename: 'replay/live/preset-alchemist.png' });
      identityRow('R-LIVE capture preset alchemist', R.live.presetCapture);
      await pageA.close();
    });

    // ---------------------------------------------------------------- S5 replay CONFLICT
    await stage('S5', 'R-CONFLICT: second MCP on an owned port, headless verified evidence', async () => {
      const D = await startMcp('decoy', { ARTISAN_BRIDGE: 'on', MCP_WS_PORT: String(ports.decoy) });
      const cd = await settledBridge(D);
      const dId = cd.previewBridge?.instanceId;
      R.conflict.decoyInstanceId = dId;
      await D.call('create_world', { worldId: 'decoy_world' });
      await D.call('add_entity', { entityId: 'decoy.barrel.001', assetRef: 'storage.barrel', position: [0, 0, 0], seed: 3 });
      const pageD = await openStudio(`?mcpPort=${ports.decoy}&mcpInstance=${dId}`);
      await pageD.evaluate(() => { window.__artisan.applyDPRPreset?.('balanced'); });
      const joined = await waitFor(async () => (await D.caps()).previewBridge?.studioClients === 1, 20000, 250);
      const dc = await D.call('compile_preview', { timeoutMs: 20000 });
      gate('R-CONFLICT-decoy-live', 'S5', 'integrity', joined && dc.structuredContent?.livePreview === true, `decoy ${dId} studioClients joined=${joined}; compile ${codeOf(dc)} livePreview=${dc.structuredContent?.livePreview}`);

      const B = await startMcp('conflict', { ARTISAN_BRIDGE: 'on', MCP_WS_PORT: String(ports.decoy) });
      const cb = await settledBridge(B);
      const bId = cb.previewBridge?.instanceId;
      R.conflict.instanceId = bId;
      R.conflict.caps = cb.previewBridge;
      R.conflict.replayFailed = await replay(B);
      R.conflict.compile = await B.call('compile_preview', { timeoutMs: 5000 });
      R.conflict.capture = await B.call('capture_viewport_screenshot', { filename: 'replay/headless/authored-hero.png', angle: 'hero' });
      identityRow('R-CONFLICT capture authored hero (headless)', R.conflict.capture);
      const conflictExportResult = await B.call('get_telemetry', { includeManifest: true });
      R.conflict.export = conflictExportResult.structuredContent;
      R.conflict.exportVerified = authoredVerified(R.conflict.capture, { source: 'headless', instanceId: bId })
        && conflictExportResult.isError !== true
        && R.conflict.export?.lastVerifiedRender?.sceneIdentity === F4BB
        && R.conflict.export?.lastVerifiedRender?.source === 'headless'
        && R.conflict.export?.lastVerifiedRender?.renderer?.kind === 'headless-studio'
        && typeof R.conflict.export?.lastVerifiedRender?.renderer?.instanceId === 'string'
        && R.conflict.export?.lastVerifiedRender?.renderer?.instanceId === bId
        && R.conflict.export?.lastVerifiedRender?.renderer?.clientId === null
        && typeof R.conflict.export?.lastVerifiedRender?.renderer?.headlessRunId === 'string'
        && identityOf(R.conflict.export?.manifest || {}) === F4BB;
      R.conflict.telemetry = await B.call('get_engine_telemetry', { profile: 'diorama' });
      identityRow('R-CONFLICT engine telemetry (headless)', R.conflict.telemetry);
      R.conflict.import = await B.call('import_telemetry_logs');
      identityRow('R-CONFLICT telemetry export (headless)', R.conflict.import);
      R.conflict.importFile = readJson(R.conflict.import.structuredContent?.path);
      R.conflict.audit = await B.call('run_performance_audit');
      identityRow('R-CONFLICT audit (headless)', R.conflict.audit);
      R.conflict.auditFile = readJson(R.conflict.audit.structuredContent?.artifacts?.json);
      R.conflict.captureStats = await pngFileStats(R.conflict.capture.structuredContent?.path);
      R.conflict.decoyPageState = await pageD.evaluate(() => window.__artisan.getRenderState?.() ?? { sceneIdentity: 'getRenderState ABSENT' });
      await pageD.close();
    });

    // ---------------------------------------------------------------- S6 acceptance
    await stage('S6', 'acceptance measurements + A-1..A-12', async () => {
      // Control world: the three named replay entities, rendered headless by a bridge-disabled MCP.
      const Cm = await startMcp('control', { ARTISAN_BRIDGE: 'off' });
      R.control.capabilities = (await Cm.caps()).previewBridge || {};
      R.control.bridgeDisabled = R.control.capabilities.state === 'disabled'
        && R.control.capabilities.listening === false
        && R.control.capabilities.studioClients === 0
        && R.control.capabilities.unverifiedClients === 0
        && R.control.capabilities.instanceId === null;
      await Cm.call(REPLAY[0][0], REPLAY[0][1]);
      for (const [name, args] of REPLAY) if (name === 'add_entity' && CONTROL_IDS.includes(args.entityId)) await Cm.call(name, args);
      R.control.telemetry = await Cm.call('get_engine_telemetry', { profile: 'diorama' });
      const controlExportResult = await Cm.call('get_telemetry', { includeManifest: true });
      R.control.export = controlExportResult.structuredContent;
      const controlTelemetry = R.control.telemetry?.structuredContent || {};
      const controlEvidence = ev(R.control.telemetry);
      const controlRenderer = controlEvidence.renderer || {};
      R.control.telemetryRendererVerified = controlRenderer.kind === 'headless-studio'
        && typeof controlRenderer.instanceId === 'string' && controlRenderer.instanceId.length > 0
        && controlRenderer.clientId === null
        && typeof controlRenderer.headlessRunId === 'string' && controlRenderer.headlessRunId.length > 0;
      R.control.exportVerified = controlTelemetry.ok === true
        && typeof controlTelemetry.sceneIdentity === 'string' && controlTelemetry.sceneIdentity.length > 0
        && controlEvidence.identityVerified === true
        && controlEvidence.authored === true
        && controlEvidence.source === 'headless'
        && controlEvidence.sceneIdentity === controlTelemetry.sceneIdentity
        && R.control.telemetryRendererVerified === true
        && controlExportResult.isError !== true
        && R.control.export?.lastVerifiedRender?.sceneIdentity === controlTelemetry.sceneIdentity
        && R.control.export?.lastVerifiedRender?.source === 'headless'
        && R.control.export?.lastVerifiedRender?.renderer?.kind === 'headless-studio'
        && typeof R.control.export?.lastVerifiedRender?.renderer?.instanceId === 'string'
        && R.control.export?.lastVerifiedRender?.renderer?.instanceId === controlRenderer.instanceId
        && R.control.export?.lastVerifiedRender?.renderer?.clientId === null
        && typeof R.control.export?.lastVerifiedRender?.renderer?.headlessRunId === 'string'
        && R.control.export.lastVerifiedRender.renderer.headlessRunId.length > 0
        && setEq(R.control.export?.lastVerifiedRender?.renderedEntityIds, (R.control.export?.manifest?.entities || []).map(entity => entity.id))
        && identityOf(R.control.export?.manifest || {}) === controlTelemetry.sceneIdentity;
      const controlManifest = R.control.exportVerified ? R.control.export.manifest : null;

      // Static in-memory estimator (§0 method): visible mesh draw groups + indexed triangles of the compiled world.
      const { MaterialFoundry } = await import(pathToFileURL(path.join(ROOT, 'src', 'engine', 'MaterialFoundry.js')).href);
      const { WorldCompiler } = await import(pathToFileURL(path.join(ROOT, 'src', 'engine', 'WorldCompiler.js')).href);
      const Presets = await import(pathToFileURL(path.join(ROOT, 'src', 'presets', 'manifests.js')).href);
      const estimate = (manifest) => {
        const { group } = new WorldCompiler(new MaterialFoundry()).compile(JSON.parse(JSON.stringify(manifest)));
        let draws = 0, tris = 0;
        const perEntity = {};
        const visible = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
        group.traverse(o => {
          if (!(o.isMesh || o.isLine || o.isPoints) || !o.geometry || !visible(o)) return;
          const geo = o.geometry;
          const count = geo.index ? geo.index.count : (geo.attributes.position?.count || 0);
          let d = 0, t = 0;
          if (Array.isArray(o.material) && geo.groups.length) {
            for (const gr of geo.groups) { const m = o.material[gr.materialIndex]; if (m && m.visible !== false) { d++; t += Math.max(0, Math.min(gr.count, count - gr.start)) / 3; } }
          } else if (o.material && o.material.visible !== false) { d = 1; t = o.isMesh ? Math.min(count, geo.drawRange?.count ?? Infinity) / 3 : 0; }
          if (o.isInstancedMesh) t *= o.count;
          draws += d; tris += t;
          let e = o;
          while (e.parent && e.parent !== group) e = e.parent;
          const key = e.isMesh && e.parent === group && !e.name ? 'shadow-catcher-ground' : (e.name || 'unnamed');
          perEntity[key] = (perEntity[key] || 0) + d;
        });
        return { draws, triangles: Math.round(tris), perEntity };
      };
      R.static.authored = estimate(AUTHORED);
      R.static.control = controlManifest ? estimate(controlManifest) : null;
      R.static.trio = estimate(Presets.ManifestForgeTrio);
      R.static.alchemist = estimate(Presets.ManifestAlchemistLab);
      gate('S6-estimator-calibration', 'S6', 'info', R.static.trio.draws === HARNESS_PRESET_DRAWS.trio && R.static.alchemist.draws === HARNESS_PRESET_DRAWS.alchemist,
        `static trio ${R.static.trio.draws}/${R.static.trio.triangles} (browser 16/1,616); alchemist ${R.static.alchemist.draws}/${R.static.alchemist.triangles} (browser 25/4,814); authored ${R.static.authored.draws}/${R.static.authored.triangles}`, { blocking: false });

      const L = R.live, K = R.conflict;
      const lsc = L.compile?.structuredContent || {};
      const ack = lsc.ack || {};
      const lExp = L.export?.structuredContent || {};

      // A-1 replay fidelity (both replays)
      const fidelity = (exp) => exp && C.canonicalJson(exp.manifest) === C.canonicalJson(AUTHORED) && exp.sceneIdentity === F4BB && exp.version === 15 && exp.entityCount === 13;
      gate('A-1', 'S6', 'integrity', L.replayFailed?.length === 0 && K.replayFailed?.length === 0 && fidelity(lExp) && K.exportVerified === true && fidelity(K.export) && L.validate?.valid === true && L.validate?.errors?.length === 0 && L.validate?.warnings?.length === 0,
        `live replay failed=[${L.replayFailed}] conflict replay failed=[${K.replayFailed}]; live export ${lExp.sceneIdentity} v${lExp.version} n=${lExp.entityCount} deepEqual=${lExp.manifest ? C.canonicalJson(lExp.manifest) === C.canonicalJson(AUTHORED) : false}; conflict export ${K.export?.sceneIdentity} verified=${K.exportVerified}; validate ${L.validate?.errors?.length}/${L.validate?.warnings?.length}`);

      // A-2 verified compile ack
      gate('A-2', 'S6', 'integrity', lsc.ok === true && lsc.livePreview === true && ack.sceneIdentity === F4BB && ack.worldId === AUTHORED.worldId && ack.version === 15 && ack.entityCount === 13 && setEq(ack.renderedEntityIds, AUTHORED_IDS) && ack.instanceId === L.instanceId && typeof L.pageClientId === 'string' && ack.clientId === L.pageClientId && ack.settled === true,
        `code=${codeOf(L.compile)} ack ${ack.sceneIdentity} ${ack.worldId} v${ack.version} n=${ack.entityCount} ids=${ack.renderedEntityIds?.length} inst=${ack.instanceId === L.instanceId} client=${ack.clientId === L.pageClientId && !!L.pageClientId} settled=${ack.settled}`);

      // A-3 one identity across every live evidence kind, same instance + client
      const who = { source: 'live', instanceId: L.instanceId, clientId: L.pageClientId };
      const imp = L.importFile || {};
      const aud = L.auditFile || {};
      const a3 = {
        ack: ack.sceneIdentity === F4BB && ack.instanceId === L.instanceId && ack.clientId === L.pageClientId,
        screenshot: authoredVerified(L.capture, who),
        telemetry: authoredVerified(L.telemetry, who),
        importTool: authoredVerified(L.import, who),
        importFile: imp.evidence?.sceneIdentity === F4BB && imp.evidence?.identityVerified === true && imp.evidence?.renderer?.instanceId === L.instanceId && imp.evidence?.renderer?.clientId === L.pageClientId && !!imp.manifest && identityOf(imp.manifest) === F4BB,
        manifestExport: lExp.sceneIdentity === F4BB && lExp.lastVerifiedRender?.sceneIdentity === F4BB
          && lExp.lastVerifiedRender?.renderer?.kind === 'live-studio'
          && typeof lExp.lastVerifiedRender?.renderer?.instanceId === 'string' && lExp.lastVerifiedRender.renderer.instanceId === L.instanceId
          && typeof lExp.lastVerifiedRender?.renderer?.clientId === 'string' && lExp.lastVerifiedRender.renderer.clientId === L.pageClientId
          && typeof lExp.lastVerifiedRender?.renderer?.connectionId === 'string'
          && identityOf(lExp.manifest || {}) === F4BB,
        audit: authoredVerified(L.audit, who) && aud.scene?.sceneIdentity === F4BB && aud.scene?.epochStart === aud.scene?.epochEnd && aud.evidence?.identityVerified === true
      };
      gate('A-3', 'S6', 'integrity', Object.values(a3).every(Boolean), Object.entries(a3).map(([k, v]) => `${k}:${v ? 'ok' : 'FAIL'}`).join(' '));

      // A-4 conflict: owner identified, compile refused, four evidence kinds headless-verified by B, no cross labels
      const bWho = { source: 'headless', instanceId: K.instanceId };
      const bNotice = (r) => ev(r).bridge?.state === 'conflict' && textOf(r).startsWith('[headless; live bridge owned by');
      const conflictText = textOf(K.compile);
      const cross = crossLabelScan();
      const a4 = {
        state: K.caps?.state === 'conflict' && K.caps?.owner?.kind === 'artisan' && typeof K.decoyInstanceId === 'string' && K.caps?.owner?.instanceId === K.decoyInstanceId,
        compile: codeOf(K.compile) === 'BRIDGE_CONFLICT' && conflictText.includes(String(ports.decoy)) && !!K.instanceId && conflictText.includes(K.instanceId) && conflictText.includes('MCP_WS_PORT') && conflictText.includes('mcpInstance='),
        screenshot: authoredVerified(K.capture, bWho) && bNotice(K.capture),
        telemetry: authoredVerified(K.telemetry, bWho) && bNotice(K.telemetry),
        importTool: authoredVerified(K.import, bWho) && bNotice(K.import) && K.importFile?.evidence?.identityVerified === true,
        audit: authoredVerified(K.audit, bWho) && bNotice(K.audit),
        decoyPageNotAuthored: !!K.decoyPageState?.sceneIdentity && K.decoyPageState.sceneIdentity !== F4BB && K.decoyPageState.sceneIdentity !== 'getRenderState ABSENT',
        noCrossLabel: cross.violations.length === 0 && cross.labeled > 0
      };
      gate('A-4', 'S6', 'integrity', Object.values(a4).every(Boolean), `${Object.entries(a4).map(([k, v]) => `${k}:${v ? 'ok' : 'FAIL'}`).join(' ')}; F4BB-labeled artifacts ${cross.labeled}${cross.violations.length ? ` violations: ${cross.violations.join(' | ')}` : ''}`);

      // A-5 distinguishes a resolvable epoch change from an identity-unresolved legacy preset.
      const staleResolvableOk = L.staleResolvable?.isError === true && codeOf(L.staleResolvable) === 'PREVIEW_STALE' && (L.staleResolvableNewFiles || []).length === 0;
      const unresolvedOk = Object.entries(L.unresolved || {}).map(([n, r]) => [n, r.isError === true && codeOf(r) === 'IDENTITY_UNRESOLVED']);
      const pc = L.presetCapture?.structuredContent || {};
      const a5 = staleResolvableOk && unresolvedOk.length === 3 && unresolvedOk.every(s => s[1]) && (L.unresolvedNewFiles || []).length === 0 && pc.ok === true && ev(L.presetCapture).sceneIdentity === 'preset:alchemist' && ev(L.presetCapture).authored === false && !JSON.stringify(pc).includes(F4BB) && !('manifest' in pc) && gates.find(g => g.id === 'T-EVD-8')?.status === 'pass';
      gate('A-5', 'S6', 'integrity', a5, `staleResolvable:${staleResolvableOk ? 'PREVIEW_STALE' : codeOf(L.staleResolvable)} staleFiles=[${L.staleResolvableNewFiles}] unresolved=${unresolvedOk.map(([n, ok]) => `${n}:${ok ? 'IDENTITY_UNRESOLVED' : codeOf(L.unresolved[n])}`).join(' ')} unresolvedFiles=[${L.unresolvedNewFiles}] presetCapture ${summarizeEnv(L.presetCapture)}`);

      // A-6 instrument: settled measurements, live == headless, control PASS, verdict correct, measured <= static
      const lt = L.telemetry?.structuredContent?.telemetry || {};
      const ht = K.telemetry?.structuredContent?.telemetry || {};
      const hb = K.telemetry?.structuredContent?.budget || {};
      const ct = R.control.telemetry?.structuredContent || {};
      const finite = (x) => typeof x === 'number' && Number.isFinite(x);
      R.measurements = {
        headless: pickM(ht), live: pickM(lt), liveAck: { drawCalls: ack.drawCalls, triangles: ack.triangles, settled: ack.settled },
        control: { ...pickM(ct.telemetry || {}), withinBudget: ct.budget?.withinBudget ?? null, staticDraws: R.static.control?.draws ?? null },
        static: { authored: R.static.authored, trio: { draws: R.static.trio.draws, triangles: R.static.trio.triangles }, alchemist: { draws: R.static.alchemist.draws, triangles: R.static.alchemist.triangles } },
        budget: { profile: 'diorama', drawCallsMax: DIORAMA.drawCallsMax, trianglesTarget: DIORAMA.trianglesTarget, headlessBudget: hb }
      };
      report.measurements = R.measurements;
      const a6 = {
        settledMeasured: ht.settled === true && lt.settled === true && finite(ht.drawCalls) && finite(ht.triangles) && finite(ht.frametimeMs) && finite(ht.frametimeP95Ms) && typeof ht.gpu === 'string' && typeof ht.isSoftwareRasterizer === 'boolean',
        fpsFinite: finite(ht.fps) && ht.fps > 0 && finite(lt.fps) && lt.fps > 0,
        liveEqualsHeadless: finite(ht.drawCalls) && ht.drawCalls === lt.drawCalls && ht.triangles === lt.triangles && ack.drawCalls === ht.drawCalls && ack.triangles === ht.triangles,
        controlWithin: R.control.bridgeDisabled === true && ct.budget?.withinBudget === true && ct.telemetry?.settled === true && R.control.exportVerified === true,
        replayVerdictCorrect: finite(ht.drawCalls) && hb.withinBudget === (ht.drawCalls <= DIORAMA.drawCallsMax && ht.triangles <= DIORAMA.trianglesTarget),
        measuredLeStatic: finite(ht.drawCalls) && ht.drawCalls <= R.static.authored.draws && (!finite(ct.telemetry?.drawCalls) || !R.static.control || ct.telemetry.drawCalls <= R.static.control.draws)
      };
      gate('A-6', 'S6', 'instrument', Object.values(a6).every(Boolean), `${Object.entries(a6).map(([k, v]) => `${k}:${v ? 'ok' : 'FAIL'}`).join(' ')}; headless ${ht.drawCalls}/${ht.triangles} ${ht.fps} FPS p95 ${ht.frametimeP95Ms}ms; live ${lt.drawCalls}/${lt.triangles}; ack ${ack.drawCalls}/${ack.triangles}; control ${ct.telemetry?.drawCalls}/${ct.telemetry?.triangles} within=${ct.budget?.withinBudget}; static ${R.static.authored.draws}/${R.static.authored.triangles}`);

      // A-7 clean screenshots of the authored 13-entity world (live + headless)
      const shot = (r, stats, requestedRel, dir) => {
        const sc = r?.structuredContent || {};
        const e = ev(r);
        const normalizedPath = String(sc.path || '').replace(/\\/g, '/');
        const insideRun = path.relative(dir, path.resolve(sc.path || '')).startsWith('..') === false;
        return !!stats && sc.ok === true && insideRun && normalizedPath.includes('/evidence/authored-world/') && normalizedPath.endsWith('/' + requestedRel) && sc.pngSha256 === stats.sha256 && sc.bytes === stats.bytes && stats.width === 1280 && stats.height === 720 && sc.width === 1280 && sc.height === 720
          && stats.lumaStd >= 10 && stats.lumaMean >= 20 && stats.lumaMean <= 235 && setEq(e.inFrustum, AUTHORED_IDS);
      };
      const liveDir = mcps.find(m => m.tag === 'live')?.artifacts, conflictDir = mcps.find(m => m.tag === 'conflict')?.artifacts;
      const a7 = { live: shot(L.capture, L.captureStats, 'replay/live/authored-hero.png', liveDir), headless: shot(K.capture, K.captureStats, 'replay/headless/authored-hero.png', conflictDir), magentaTest: gates.find(g => g.id === 'T-BRW-3')?.status === 'pass' };
      for (const [kind, r, stats] of [['R-LIVE authored hero', L.capture, L.captureStats], ['R-CONFLICT authored hero (headless)', K.capture, K.captureStats]]) if (stats) report.pngs.push({ kind, path: r.structuredContent?.path, responseSha256: r.structuredContent?.pngSha256, ...stats, inFrustum: ev(r).inFrustum?.length ?? null });
      gate('A-7', 'S6', 'integrity', Object.values(a7).every(Boolean), `${Object.entries(a7).map(([k, v]) => `${k}:${v ? 'ok' : 'FAIL'}`).join(' ')}; live luma ${fmt(L.captureStats?.lumaMean)}±${fmt(L.captureStats?.lumaStd)} inFrustum ${ev(L.capture).inFrustum?.length ?? '?'}/13; headless luma ${fmt(K.captureStats?.lumaMean)}±${fmt(K.captureStats?.lumaStd)} inFrustum ${ev(K.capture).inFrustum?.length ?? '?'}/13`);

      // A-8 confinement: T-ART-1..5 from the node suite (+ harness no-writes gate in S7, + S8 tree hash)
      const nodeRes = R.nodeSuites['S2-mcp-evidence-integrity-node']?.results || [];
      const art = ['T-ART-1', 'T-ART-2', 'T-ART-3', 'T-ART-4', 'T-ART-5'].map(id => [id, nodeRes.find(x => x.name.startsWith(id + ' '))?.pass === true]);
      gate('A-8', 'S6', 'integrity', art.every(a => a[1]), art.map(([id, ok]) => `${id}:${ok ? 'ok' : 'FAIL'}`).join(' '));

      // A-9 audit semantics: T-AUD-1..4 + the R-LIVE and R-CONFLICT audit reports carry no canned claims
      const cleanReport = (rep) => !!rep && !JSON.stringify(rep).includes('actionTaken') && (rep.smokingGuns || []).every(g => g.status === 'OBSERVED' && g.repairApplied === false) && !/ZERO GUESSWORK|LOCKED 60 FPS/.test(String(rep.verdict));
      const aud4 = ['T-AUD-1', 'T-AUD-2', 'T-AUD-3', 'T-AUD-4'].map(id => [id, gates.find(g => g.id === id)?.status === 'pass']);
      gate('A-9', 'S6', 'integrity', aud4.every(a => a[1]) && cleanReport(L.auditFile) && cleanReport(K.auditFile), `${aud4.map(([id, ok]) => `${id}:${ok ? 'ok' : 'FAIL'}`).join(' ')} liveReport:${cleanReport(L.auditFile) ? 'ok' : 'FAIL'} headlessReport:${cleanReport(K.auditFile) ? 'ok' : 'FAIL'}`);

      // A-11 identity surfaces agree
      const idn = L.identityEndpoint?.json || {};
      const a11 = {
        capabilities: typeof L.instanceId === 'string' && L.caps?.instanceId === L.instanceId,
        identityEndpoint: idn.service === 'artisan-mcp-bridge' && idn.instanceId === L.instanceId && idn.protocol === 2 && idn.world?.sceneIdentity === F4BB && !('manifest' in idn) && !('entities' in (idn.world || {})),
        studioIndicator: typeof L.instanceId === 'string' && String(L.label).includes(L.instanceId.slice(0, 8)) && String(L.label).includes(String(ports.live)),
        envelopes: [L.capture, L.telemetry, L.import, L.audit].every(r => ev(r).renderer?.instanceId === L.instanceId && ev(r).renderer?.clientId === L.pageClientId)
      };
      gate('A-11', 'S6', 'integrity', Object.values(a11).every(Boolean), `${Object.entries(a11).map(([k, v]) => `${k}:${v ? 'ok' : 'FAIL'}`).join(' ')}; label "${L.label}"`);

      gate('S6-no-page-errors', 'S6', 'integrity', report.pageErrors.length === 0, report.pageErrors.slice(0, 4).join(' | ') || 'no uncaught page errors on any verification page');

      // A-12 authored-world budget conformance (reported; owned by P0.6)
      R.authoredBudget = finite(ht.drawCalls) && finite(ht.triangles) && ht.settled === true ? (ht.drawCalls <= DIORAMA.drawCallsMax && ht.triangles <= DIORAMA.trianglesTarget ? 'PASS' : 'FAIL') : 'UNMEASURED';
      gate('A-12', 'S6', 'budget', R.authoredBudget === 'PASS', `authored replay ${ht.drawCalls ?? '?'}/${DIORAMA.drawCallsMax} draws, ${ht.triangles ?? '?'}/${DIORAMA.trianglesTarget} tris, ${ht.fps ?? '?'} FPS (owned by BUILD-AUTHORED-BUDGET, P0.6)`, { blocking: false });
    });
  } catch (err) {
    gate('runtime-exception', 'S3', 'integrity', false, err.stack || err.message);
  } finally {
    try { await browser?.close(); } catch {}
    for (const m of mcps) { try { await m.client.close(); } catch {} }
    try { vite?.kill(); } catch {}
  }

  // ---------------------------------------------------------------- S7 P0 regression
  await stage('S7', 'P0 regression (verify_astra_harness)', async () => {
    if (SKIP_P0) { gate('S7-p0-harness', 'S7', 'p0', false, 'SKIPPED (--skip-p0): overall cannot PASS'); return; }
    await sleep(1000);
    const h = run(process.execPath, ['scripts/verify_astra_harness.mjs'], { timeout: 1500000 });
    const hr = readJson(path.join(ROOT, '.artisan-artifacts', 'verify', 'verify_report.json'));
    R.harness = hr ? { passed: hr.passed, failed: hr.failed, warnings: hr.warnings, presets: Object.fromEntries(Object.entries(hr.e2e?.presets || {}).map(([k, v]) => [k, v.drawCalls])) } : null;
    report.p0Harness = R.harness;
    const baseline = readJson(BASELINE_FILE)?.p0HarnessBaseline;
    const wantDraws = baseline?.presetDraws || HARNESS_PRESET_DRAWS;
    const drawDiff = Object.entries(wantDraws).filter(([k, v]) => R.harness?.presets?.[k] !== v).map(([k, v]) => `${k} ${R.harness?.presets?.[k]} (baseline ${v})`);
    gate('S7-p0-harness', 'S7', 'p0', h.code === 0 && hr?.failed === 0 && JSON.stringify(hr?.warnings) === JSON.stringify(['preset-profile-budgets']), hr ? `${hr.passed} passed, ${hr.failed} blocking failure(s), non-blocking [${hr.warnings}]${hr.failed ? ': ' + hr.gates.filter(g => g.status === 'fail' && g.blocking !== false).map(g => g.id).join(',') : ''}` : `exit ${h.code}: ${tail(h.stderr || h.stdout)}`);
    gate('S7-preset-draws-unchanged', 'S7', 'p0', !!R.harness && drawDiff.length === 0, drawDiff.length ? drawDiff.join(', ') : Object.entries(R.harness?.presets || {}).map(([k, v]) => `${k}:${v}`).join(' '));
    const noWrites = hr?.gates?.find(g => g.id === 'no-writes-outside-artifacts');
    gate('S7-harness-no-writes-outside-artifacts', 'S7', 'integrity', noWrites?.status === 'pass', noWrites?.evidence || 'gate missing');
  });

  // A-10 P0 preservation (S1, S2, S7)
  const p0Gates = gates.filter(g => g.group === 'p0');
  gate('A-10', 'S7', 'p0', p0Gates.length > 0 && p0Gates.every(g => g.status === 'pass'), p0Gates.map(g => `${g.id}:${g.status}`).join(' '));
}

// ---------------------------------------------------------------- S8 tree integrity
await stage('S8', 'tree integrity', async () => {
  if (!treeBefore) { gate('S8-tree-unchanged', 'S8', 'integrity', false, 'no before-hash (preflight did not run)'); return; }
  await sleep(500);
  const after = hashTree();
  const touched = [...new Set([...Object.keys(treeBefore), ...Object.keys(after)])].filter(k => treeBefore[k] !== after[k]);
  gate('S8-tree-unchanged', 'S8', 'integrity', touched.length === 0, touched.length ? `changed/added/removed outside the artifact root: ${touched.slice(0, 8).join(' ; ')}` : `${Object.keys(after).length} project files byte-identical before/after (artifact root excluded)`);
});

// ---------------------------------------------------------------- verdict
function pickM(t) { return { drawCalls: t.drawCalls ?? null, triangles: t.triangles ?? null, fps: t.fps ?? null, frametimeMs: t.frametimeMs ?? null, frametimeP95Ms: t.frametimeP95Ms ?? null, gpu: t.gpu ?? null, isSoftwareRasterizer: t.isSoftwareRasterizer ?? null, settled: t.settled ?? null, pixelRatio: t.pixelRatio ?? null, viewport: t.viewport ?? null, frames: t.frames ?? null }; }
function fmt(n) { return typeof n === 'number' ? n.toFixed(1) : '?'; }
/** Every JSON artifact labeled with the authored identity must come from A's verified client or a headless run of B/U. */
function crossLabelScan() {
  const allowed = [
    (r) => r?.instanceId === R.live.instanceId && r?.clientId === R.live.pageClientId && r?.kind === 'live-studio',
    (r) => (r?.instanceId === R.conflict.instanceId || r?.instanceId === R.units.instanceId) && r?.kind === 'headless-studio'
  ];
  const violations = [];
  let labeled = 0;
  for (const f of listFiles(OUT).filter(f => f.endsWith('.json') && /[\\/]mcp-/.test(f))) {
    const j = readJson(f);
    if (!j) continue;
    const text = JSON.stringify(j);
    if (!text.includes(F4BB)) continue;
    labeled++;
    const e = j.evidence;
    if (!e || e.sceneIdentity !== F4BB || e.identityVerified !== true || !allowed.some(fn => fn(e.renderer))) violations.push(`${path.relative(OUT, f)}: renderer ${JSON.stringify(e?.renderer ?? null).slice(0, 80)}`);
  }
  return { labeled, violations };
}

const blockingFails = (group) => gates.filter(g => g.group === group && g.blocking && g.status !== 'pass');
const integrity = blockingFails('integrity').length === 0 ? 'PASS' : 'FAIL';
const budgetInstrument = gates.some(g => g.group === 'instrument') && blockingFails('instrument').length === 0 ? 'PASS' : 'FAIL';
const p0 = SKIP_P0 ? 'SKIPPED' : (gates.some(g => g.group === 'p0') && blockingFails('p0').length === 0 ? 'PASS' : 'FAIL');
const overall = integrity === 'PASS' && budgetInstrument === 'PASS' && p0 === 'PASS' ? 'PASS' : 'FAIL';
const authoredBudget = R.authoredBudget || 'UNMEASURED';
report.verdict = { integrity, budgetInstrument, p0, overall, authoredBudget };
report.durationSec = Math.round((Date.now() - t0) / 1000);
report.gates = gates;
report.failedGates = gates.filter(g => g.status !== 'pass').map(g => `${g.id}${g.blocking ? '' : ' (non-blocking)'}`);
delete R.live.page;
const reportPath = path.join(OUT, 'evidence_integrity_report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const reportSha = sha256(fs.readFileSync(reportPath));
const hm = report.measurements?.headless || {};
console.log(`\n${gates.filter(g => g.status === 'pass').length}/${gates.length} gates passed in ${report.durationSec}s`);
console.log(`INTEGRITY: ${integrity}${integrity === 'PASS' ? '' : ` (${blockingFails('integrity').map(g => g.id).join(', ')})`}`);
console.log(`BUDGET INSTRUMENT: ${budgetInstrument}${budgetInstrument === 'PASS' ? '' : ` (${blockingFails('instrument').map(g => g.id).join(', ') || 'not measured'})`}`);
console.log(`P0 PRESERVATION: ${p0}${p0 === 'FAIL' ? ` (${blockingFails('p0').map(g => g.id).join(', ')})` : ''}`);
console.log(`OVERALL (P0.5): ${overall}`);
console.log(`AUTHORED BUDGET: ${authoredBudget} ${hm.drawCalls ?? '?'}/${DIORAMA.drawCallsMax} draws, ${typeof hm.triangles === 'number' ? hm.triangles.toLocaleString('en-US') : '?'}/${DIORAMA.trianglesTarget.toLocaleString('en-US')} tris, ${hm.fps ?? '?'} FPS — owned by BUILD-AUTHORED-BUDGET (P0.6), blocks P1`);
console.log(`Report: ${reportPath} (sha256 ${reportSha})`);
process.exit(overall === 'PASS' ? 0 : 1);
