// One-command verification for the Artisan Astra harness.
// Static gates → SDK/bridge/drift suites → live E2E (Vite + headless Studio + MCP) → preset budgets → privacy.
// Usage: node scripts/verify_astra_harness.mjs [--skip-e2e]
// Full report: .artisan-artifacts/verify/verify_report.json
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.artisan-artifacts', 'verify');
fs.mkdirSync(OUT, { recursive: true });
const gates = [];
const gate = (id, pass, evidence, extra = {}) => { gates.push({ id, status: pass ? 'pass' : 'fail', evidence: String(evidence).slice(0, 400), ...extra }); console.log(`${pass ? 'PASS' : extra.blocking === false ? 'WARN' : 'FAIL'} ${id} — ${String(evidence).slice(0, 160)}`); };
// Preset draw calls measured on the exact pre-session code (2026-09-21, Intel UHD, 1280x720, same method).
// Used as a no-regression floor; per-profile budget overages are reported as non-blocking findings.
const BASELINE_PRESET_DRAWS = { trio: 16, tavern: 17, alchemist: 25, armory: 22, library: 28, tokyo: 45, winterhold: 39, fantastic: 58 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const inside = (p, dir) => { const rel = path.relative(dir, path.resolve(p)); return !!p && !rel.startsWith('..') && !path.isAbsolute(rel); };

function run(cmd, args, { timeout = 180000, env = {}, cwd = ROOT } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout, shell: false, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? (r.error ? -1 : 0), stdout: r.stdout || '', stderr: r.stderr || '', error: r.error?.message };
}
const tail = (s, n = 3) => s.trim().split('\n').slice(-n).join(' | ');
const lastJson = (s) => { const line = s.trim().split('\n').reverse().find(l => l.startsWith('{')); return line ? JSON.parse(line) : null; };

function portFree(port) {
  return new Promise(res => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port, '127.0.0.1'); });
}
async function pickPort(candidates) { for (const p of candidates) if (await portFree(p)) return p; throw new Error('no free port'); }
async function waitHttp(url, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { const r = await fetch(url); if (r.ok) return true; } catch {} await sleep(300); }
  return false;
}
const BROWSER = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));

// SHA-256 of every project file outside .git, node_modules and the artifact root (OS temp is outside
// the project). Unlike a git-status diff this also catches writes to already-dirty and ignored files.
const ARTIFACT_ROOT = path.resolve(process.env.ARTISAN_ARTIFACTS_DIR || path.join(ROOT, '.artisan-artifacts'));
function hashTree(dir = ROOT, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.git' || e.name === 'node_modules' || path.resolve(p) === ARTIFACT_ROOT || path.resolve(p) === path.join(ROOT, '.artisan-artifacts')) continue;
      hashTree(p, out);
    } else if (e.isFile()) out[path.relative(ROOT, p).replace(/\\/g, '/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  return out;
}
const treeBefore = hashTree();
const t0 = Date.now();

// ---------------------------------------------------------------- 1. static gates
{
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(m?js)$/.test(e.name)) files.push(p); } };
  walk(path.join(ROOT, 'src')); walk(path.join(ROOT, 'mcp-server'));
  const bad = files.filter(f => run(process.execPath, ['--check', f], { timeout: 30000 }).code !== 0);
  gate('syntax', bad.length === 0, `${files.length} src+mcp JS files parsed${bad.length ? `; failed: ${bad.map(f => path.relative(ROOT, f)).join(',')}` : ''}`);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan_build_'));
  const b = run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--emptyOutDir']);
  const modules = (b.stdout.match(/(\d+) modules transformed/) || [])[1];
  fs.rmSync(outDir, { recursive: true, force: true });
  gate('vite-build', b.code === 0, `exit ${b.code}; ${modules || '?'} modules; temp outDir removed`);

  const sp = run(process.execPath, ['test_spatial_laws.js']);
  gate('spatial-laws', sp.code === 0 && /VERIFIED/.test(sp.stdout), tail(sp.stdout, 1));
  const g = run('python', ['scripts/gate.py']);
  gate('sart-gate-P1-P10', g.code === 0, tail(g.stdout, 1));
  const cab = run(process.execPath, ['scripts/gate_cabinet.js']);
  gate('cabinet-gate', cab.code === 0, tail(cab.stdout, 2));
}

// ---------------------------------------------------------------- 2. suites
const suites = {};
for (const [id, file, env] of [
  ['contract-drift', 'scripts/check_contract_drift.mjs', {}],
  ['mcp-stdio-sdk', 'mcp-server/test_stdio_client.js', {}],
  ['ws-bridge-privacy', 'mcp-server/test_ws_bridge.js', { TEST_WS_PORT: String(await pickPort([3456, 3496, 3497])) }],
  ['mcp-evidence-integrity-node', 'mcp-server/test_evidence_integrity.js', {}]
]) {
  const r = run(process.execPath, [file, '--json'], { env, timeout: 180000 });
  const j = lastJson(r.stdout);
  suites[id] = j?.summary || { error: tail(r.stderr || r.stdout) };
  gate(id, r.code === 0 && j?.summary?.failed === 0, j ? `${j.summary.passed} passed, ${j.summary.failed} failed${j.summary.failed ? ': ' + j.summary.failures.map(f => f.name).join(', ') : ''}${j.summary.toolSchemaTokens ? `; tool schema ≈${j.summary.toolSchemaTokens} tokens` : ''}${j.summary.port ? `; port ${j.summary.port}` : ''}` : `exit ${r.code}: ${tail(r.stderr || r.stdout)}`);
}

// ---------------------------------------------------------------- 2b. installed Codex plugin (skill discovery + MCP start from the cached copy)
{
  const cacheRoot = path.join(os.homedir(), '.codex', 'plugins', 'cache', 'artisan-local', 'artisan-3d-studio');
  const version = fs.existsSync(cacheRoot) ? fs.readdirSync(cacheRoot).sort().pop() : null;
  if (!version) gate('codex-plugin-installed', false, `not installed under ${cacheRoot}`);
  else {
    const root = path.join(cacheRoot, version);
    const skillOk = fs.existsSync(path.join(root, 'skills', 'artisan-3d-studio', 'SKILL.md'));
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8')).mcpServers['artisan-3d'];
    const sdk = path.join(ROOT, 'mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client');
    const { Client } = await import(new URL(`file:///${path.join(sdk, 'index.js').replace(/\\/g, '/')}`).href);
    const { StdioClientTransport } = await import(new URL(`file:///${path.join(sdk, 'stdio.js').replace(/\\/g, '/')}`).href);
    const c = new Client({ name: 'codex-install-probe', version: '1.0.0' });
    await c.connect(new StdioClientTransport({ command: cfg.command === 'node' ? process.execPath : cfg.command, args: cfg.args, cwd: cfg.cwd, env: { ...process.env, ...cfg.env, ARTISAN_BRIDGE: 'off' }, stderr: 'pipe' }));
    const tools = (await c.listTools()).tools.length;
    const essence = (await c.readResource({ uri: 'artisan://essence' })).contents[0].text.includes('5-Tier');
    await c.close();
    const cx = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
    const cxExe = fs.existsSync(cx) ? fs.readdirSync(cx).map(d => path.join(cx, d, 'codex.exe')).find(f => fs.existsSync(f)) : null;
    const listed = cxExe ? /artisan-3d\s+node.*enabled/.test(run(cxExe, ['mcp', 'list'], { timeout: 60000 }).stdout) : null;
    gate('codex-plugin-installed', skillOk && tools === 13 && essence && listed !== false, `v${version}; skill ${skillOk}; MCP from cached .mcp.json → ${tools} tools, essence ${essence}; codex mcp list: ${listed ?? 'codex CLI not found'}`);
  }
}

// ---------------------------------------------------------------- 3. compiler non-reduction (node)
{
  const { MaterialFoundry } = await import('../src/engine/MaterialFoundry.js');
  const { WorldCompiler } = await import('../src/engine/WorldCompiler.js');
  const compiler = new WorldCompiler(new MaterialFoundry());
  // Near-match ids are the dangerous ones: substring routing used to accept them on the direct path.
  const accepted = [];
  for (const bad of ['mystery.thing', 'primitive.box', 'unknown.table', 'unknown.lantern', 'totally.alchemist_shell.fake']) {
    try { compiler.compile({ worldId: 'probe', entities: [{ id: 'x.probe', kind: 'prop', assetRef: bad, transform: { positionM: [0, 0, 0] }, relationships: [{ type: 'supported_by', target: 'ground.stone' }] }] }); accepted.push(`compile:${bad}`); } catch {}
    try { compiler.compileEntity({ id: 'x.probe', assetRef: bad, transform: { positionM: [0, 0, 0] } }); accepted.push(`compileEntity:${bad}`); } catch {}
  }
  gate('unknown-archetype-never-primitive', accepted.length === 0, accepted.length ? `ACCEPTED: ${accepted.join(', ')}` : '5 unknown/near-match ids rejected by compile and compileEntity');
}

// ---------------------------------------------------------------- 4. live E2E
const e2e = {};
if (!process.argv.includes('--skip-e2e')) {
  const vitePort = await pickPort([5199, 5198, 5197]);
  const bridgePort = await pickPort([3498, 3499, 3495]);
  const studioUrl = `http://127.0.0.1:${vitePort}/`;
  const artifacts = path.join(OUT, 'artifacts');
  fs.rmSync(artifacts, { recursive: true, force: true });
  const vite = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(vitePort), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  let browser, client;
  try {
    gate('e2e-vite-up', await waitHttp(studioUrl, 30000), `${studioUrl}`);
    const { connect } = await import('../mcp-server/test_stdio_client.js');
    client = await connect({ ARTISAN_BRIDGE: 'on', MCP_WS_PORT: String(bridgePort), ARTISAN_STUDIO_URL: studioUrl, ARTISAN_ARTIFACTS_DIR: artifacts, ARTISAN_BROWSER_PATH: BROWSER || '' });
    const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 }); return r; };
    const caps = async () => JSON.parse((await client.readResource({ uri: 'artisan://capabilities' })).contents[0].text);

    browser = await puppeteer.launch({ executablePath: BROWSER, headless: 'new', args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1280,720'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    const consoleErrors = [];
    page.on('pageerror', e => consoleErrors.push(String(e.message).slice(0, 200)));
    // SPEC-08: pin the Studio page to this MCP instance (a different instance on the port is refused).
    const instanceId = (await caps()).previewBridge.instanceId;
    await page.goto(`${studioUrl}?mcpPort=${bridgePort}&mcpInstance=${instanceId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#webgl', { timeout: 30000 });
    let connected = false;
    for (let i = 0; i < 60 && !connected; i++) { connected = (await caps()).previewBridge.studioClients > 0; if (!connected) await sleep(250); }
    gate('e2e-studio-connected', connected, `headless Studio joined bridge 127.0.0.1:${bridgePort}`);

    // Compound scene authoring (architecture shell → furniture → anchored clutter)
    const steps = [
      ['create_world', { worldId: 'astra_alchemist_corner', roomSize: [4.8, 3.6, 4.8], lighting: 'hearth' }],
      ['add_entity', { entityId: 'arch.shell.alchemist.001', assetRef: 'arch.alchemist_shell', materialRefs: ['stone.rough_local', 'wood.dark_oak', 'glass.window', 'skyline.cobblestone_alley'], seed: 101 }],
      ['add_entity', { entityId: 'furn.table.oak.001', assetRef: 'furniture.table', position: [-0.6, 0, 0.4], rotation: [0, 8, 0], seed: 137 }],
      ['add_entity', { entityId: 'work.cauldron.001', assetRef: 'kitchen.cauldron', position: [1.1, 0, -0.9], seed: 211 }],
      ['add_entity', { entityId: 'furn.bookshelf.001', assetRef: 'furniture.bookshelf', position: [-1.7, 0, -1.9], seed: 404 }],
      ['add_entity', { entityId: 'store.barrel.001', assetRef: 'storage.barrel', position: [1.7, 0, 1.2], materialRefs: ['wood.weathered_oak', 'metal.forged_iron'] }],
      ['add_entity', { entityId: 'store.chest.001', assetRef: 'storage.chest', position: [0.6, 0, 1.6], rotation: [0, -20, 0] }],
      ['add_entity', { entityId: 'prop.lectern.001', assetRef: 'prop.spell_lectern', position: [1.5, 0, -0.1], rotation: [0, -35, 0] }],
      ['add_entity', { entityId: 'light.lantern.001', assetRef: 'lighting.lantern', position: [-0.6, 0.78, 0.4], parent: 'furn.table.oak.001', anchor: 'anchor.surface.top', seed: 7 }],
      ['add_entity', { entityId: 'decor.rug.001', assetRef: 'decor.woven_rug', position: [0, 0, 0.3] }]
    ];
    let authored = true;
    for (const [n, a] of steps) { const r = await call(n, a); if (!r.structuredContent?.ok) { authored = false; e2e.authoringError = r.content?.[0]?.text; break; } }
    gate('e2e-compound-authoring', authored, authored ? `${steps.length - 1} entities incl. anchored lantern` : e2e.authoringError);

    const v = await call('validate_scene');
    gate('e2e-validation', v.structuredContent?.valid === true && v.structuredContent.warnings.length === 0, v.content[0].text);

    let p = await call('compile_preview', { timeoutMs: 20000 });
    e2e.firstPreview = p.structuredContent;
    gate('e2e-live-preview', p.structuredContent?.livePreview === true && p.structuredContent.ack?.entityCount === 9 && p.structuredContent.ack?.sceneIdentity === p.structuredContent.sceneIdentity, p.content[0].text);
    // Budget-driven iteration, as an LLM would do: trim narrative clutter until within the diorama profile.
    const trimmed = [];
    for (const id of ['decor.rug.001', 'store.chest.001', 'prop.lectern.001']) {
      if (p.structuredContent?.budget?.withinBudget !== false) break;
      await call('remove_entity', { entityId: id });
      trimmed.push(id);
      p = await call('compile_preview', { timeoutMs: 20000 });
    }
    e2e.preview = p.structuredContent;
    e2e.trimmed = trimmed;
    gate('e2e-diorama-budget', p.structuredContent?.budget?.withinBudget === true, `first ${e2e.firstPreview?.budget?.drawCalls}/${e2e.firstPreview?.budget?.drawCallsMax}; after trimming [${trimmed.join(', ')}] → ${p.structuredContent?.budget?.drawCalls}/${p.structuredContent?.budget?.drawCallsMax}`);
    await sleep(1500);

    const t = await call('get_engine_telemetry', { profile: 'diorama' });
    e2e.telemetry = t.structuredContent;
    gate('e2e-telemetry', t.structuredContent?.source === 'live' && typeof t.structuredContent.telemetry.drawCalls === 'number' && t.structuredContent.evidence?.identityVerified === true, t.content[0].text);

    const s = await call('capture_viewport_screenshot', { filename: 'astra_e2e_alchemist_corner', angle: 'hero' });
    e2e.screenshot = s.structuredContent;
    gate('e2e-screenshot', s.structuredContent?.source === 'live' && s.structuredContent.bytes > 20000 && inside(s.structuredContent.path, artifacts) && s.structuredContent.evidence?.identityVerified === true, `${s.structuredContent?.bytes} bytes → ${s.structuredContent?.path}`, { artifact: s.structuredContent?.path });

    const a = await call('run_performance_audit');
    e2e.audit = a.structuredContent;
    gate('e2e-audit-bounded', a.structuredContent?.ok === true && JSON.stringify(a).length < 6000 && inside(a.structuredContent.artifacts?.json, artifacts), `${a.content[0].text.slice(0, 140)} (response ${JSON.stringify(a).length} chars)`);

    const l = await call('import_telemetry_logs');
    gate('e2e-telemetry-log', inside(l.structuredContent?.path, artifacts), l.structuredContent?.path);

    // Determinism of the authored world across a fresh MCP process
    const idA = e2e.preview?.sceneIdentity;
    const { connect: connect2 } = await import('../mcp-server/test_stdio_client.js');
    const c2 = await connect2({ ARTISAN_BRIDGE: 'off' });
    for (const [n, a2] of steps) await c2.callTool({ name: n, arguments: a2 });
    for (const id of e2e.trimmed) await c2.callTool({ name: 'remove_entity', arguments: { entityId: id } });
    const idB = (await c2.callTool({ name: 'get_telemetry', arguments: {} })).structuredContent.sceneIdentity;
    await c2.close();
    gate('e2e-deterministic-identity', idA && idA === idB, `${idA} vs ${idB}`);
    gate('e2e-no-page-errors', consoleErrors.length === 0, consoleErrors.join(' | ') || 'no uncaught page errors');

    // Headless fallback once the live Studio disconnects
    await page.close();
    for (let i = 0; i < 20 && (await caps()).previewBridge.studioClients > 0; i++) await sleep(250);
    const hs = await call('capture_viewport_screenshot', { filename: 'astra_e2e_headless_winterhold', scene: 'winterhold', angle: 'aurora' });
    gate('e2e-headless-fallback', hs.structuredContent?.source === 'headless' && hs.structuredContent.bytes > 20000 && inside(hs.structuredContent.path, artifacts) && hs.structuredContent.evidence?.sceneIdentity === 'preset:winterhold' && hs.structuredContent.evidence?.authored === false, hs.content[0].text);

    // Preset scenes: draw calls vs their profile budget + non-blank render
    const presetResults = {};
    const { PRESET_SCENES, PERFORMANCE_PROFILES } = await import('../src/contracts/artisanContract.js');
    const pp = await browser.newPage();
    await pp.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await pp.goto(`${studioUrl}?mcpBridge=off`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pp.waitForSelector('#webgl', { timeout: 30000 });
    await sleep(1500);
    for (const [scene, meta] of Object.entries(PRESET_SCENES)) {
      await pp.evaluate(s => window.__artisan.loadScene(s), scene);
      await sleep(scene === 'fantastic' ? 4000 : 1500);
      const tel = await pp.evaluate(() => window.__artisan?.rtss?.getTelemetry?.() || {});
      const shotPath = path.join(artifacts, `preset_${scene}.png`);
      await pp.screenshot({ path: shotPath });
      const prof = PERFORMANCE_PROFILES[meta.profile];
      const max = prof.drawCallsMax ?? prof.visibleDrawCallsMax;
      presetResults[scene] = { profile: meta.profile, drawCalls: tel.drawCalls, max, triangles: tel.triangles, fps: tel.fps, pngBytes: fs.statSync(shotPath).size, within: typeof tel.drawCalls === 'number' && tel.drawCalls <= max };
    }
    e2e.presets = presetResults;
    const regressions = Object.entries(presetResults).filter(([k, r]) => typeof r.drawCalls !== 'number' || r.drawCalls > (BASELINE_PRESET_DRAWS[k] ?? r.max));
    gate('preset-no-draw-call-regression', regressions.length === 0, Object.entries(presetResults).map(([k, r]) => `${k}:${r.drawCalls} (baseline ${BASELINE_PRESET_DRAWS[k]})`).join(' '));
    const over = Object.entries(presetResults).filter(([, r]) => !r.within);
    gate('preset-profile-budgets', over.length === 0, over.length ? `pre-existing overages: ${over.map(([k, r]) => `${k} ${r.drawCalls}/${r.max}`).join(', ')}` : 'all presets within profile', { blocking: false });
    const blank = Object.entries(presetResults).filter(([, r]) => r.pngBytes < 30000);
    gate('preset-visual-smoke', blank.length === 0, `min PNG ${Math.min(...Object.values(presetResults).map(r => r.pngBytes))} bytes${blank.length ? `; suspicious: ${blank.map(b => b[0]).join(',')}` : ''}`);
    const overTris = Object.entries(presetResults).filter(([, r]) => r.profile === 'diorama' && typeof r.triangles === 'number' && r.triangles > PERFORMANCE_PROFILES.diorama.trianglesTarget);
    gate('preset-triangle-target', overTris.length === 0, overTris.length ? overTris.map(([k, r]) => `${k} ${r.triangles}`).join(', ') : `all dioramas <= ${PERFORMANCE_PROFILES.diorama.trianglesTarget} triangles`);

    // Material contract in the real browser (textured materials included): construction == contract.
    const mat = await pp.evaluate(async () => {
      const [{ MaterialFoundry }, C] = await Promise.all([import('/src/engine/MaterialFoundry.js'), import('/src/contracts/artisanContract.js')]);
      const f = new MaterialFoundry();
      const hex = (c) => `#${c.getHexString().toUpperCase()}`;
      const mismatch = [...f.materials.entries()].filter(([id, m]) => { const s = C.MATERIAL_CATALOG[id]; return !s || hex(m.color) !== s.color || m.roughness !== s.roughness || m.metalness !== s.metalness || hex(m.emissive) !== (s.emissive || '#000000') || (s.emissive !== undefined && m.emissiveIntensity !== s.emissiveIntensity) || !!s.textured !== !!m.map; }).map(([id]) => id);
      return { total: f.materials.size, drift: f.contractDrift, mismatch };
    });
    e2e.materialContract = mat;
    gate('material-contract-browser', mat.drift.length === 0 && mat.mismatch.length === 0 && mat.total === 53, `${mat.total - mat.mismatch.length}/${mat.total} match; construction drift ${mat.drift.length}${mat.mismatch.length ? `; mismatched: ${mat.mismatch.join(',')}` : ''}`);
    e2e.gpu = e2e.telemetry?.telemetry?.gpu;
  } catch (err) {
    gate('e2e-exception', false, err.stack || err.message);
  } finally {
    try { await browser?.close(); } catch {}
    try { await client?.close(); } catch {}
    vite.kill();
  }
  // All MCP-written files must live inside the configured artifacts dir
  const produced = fs.existsSync(artifacts) ? fs.readdirSync(artifacts) : [];
  e2e.artifacts = produced;

  // Visibility: every diorama readable in Dusk / Hearth / Sol and responsive to each mode (SPEC-07).
  const bright = run(process.execPath, ['scripts/measure_brightness.mjs', '--tag', 'verify'], { timeout: 600000 });
  let brightReport = null;
  try { brightReport = JSON.parse(fs.readFileSync(path.join(ROOT, '.artisan-artifacts', 'brightness', 'verify', 'brightness_report.json'), 'utf8')); } catch {}
  e2e.brightness = brightReport ? { pass: brightReport.pass, failures: brightReport.failures, gpu: brightReport.renderer?.gpu, contactSheet: brightReport.contactSheet } : null;
  gate('visibility-brightness', bright.code === 0 && brightReport?.pass === true, brightReport ? (brightReport.pass ? `7 dioramas x 3 modes readable + mode-responsive (${brightReport.renderer?.gpu})` : brightReport.failures.slice(0, 4).join(' | ')) : `exit ${bright.code}: ${tail(bright.stderr || bright.stdout)}`);
}

// ---------------------------------------------------------------- 5. privacy / tree integrity
await sleep(500);
const treeAfter = hashTree();
const touched = [...new Set([...Object.keys(treeBefore), ...Object.keys(treeAfter)])].filter(k => treeBefore[k] !== treeAfter[k]);
gate('no-writes-outside-artifacts', touched.length === 0, touched.length ? `changed/added/removed: ${touched.slice(0, 6).join(' ; ')}` : `${Object.keys(treeAfter).length} project files byte-identical (SHA-256) before/after; artifact root and OS temp excluded`);

const failed = gates.filter(g => g.status === 'fail' && g.blocking !== false);
const warnings = gates.filter(g => g.status === 'fail' && g.blocking === false);
const report = { suite: 'artisan-astra-harness', timestamp: new Date().toISOString(), durationSec: Math.round((Date.now() - t0) / 1000), node: process.version, browser: BROWSER, passed: gates.filter(g => g.status === 'pass').length, failed: failed.length, warnings: warnings.map(w => w.id), gates, suites, e2e };
fs.writeFileSync(path.join(OUT, 'verify_report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.passed}/${gates.length} gates passed, ${failed.length} blocking failure(s), ${warnings.length} non-blocking finding(s) in ${report.durationSec}s — report: ${path.join(OUT, 'verify_report.json')}`);
process.exit(failed.length ? 1 : 0);
