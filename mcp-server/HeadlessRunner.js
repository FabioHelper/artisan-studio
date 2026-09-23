import puppeteer from 'puppeteer-core';
import fs from 'fs';
import crypto from 'crypto';
import { ARTIFACTS_DIR, safeArtifactPath, writeArtifactAt, createBrowserProfileDir, removeBrowserProfileDir } from './artifacts.js';
import { resolveSceneAlias, verifyEvidenceWindow, verifySceneReference } from '../src/contracts/sceneIdentityContract.js';
import { SCENE_ALIASES, SCENE_IDENTITIES } from '../src/contracts/sceneIdentityManifest.generated.js';

export { ARTIFACTS_DIR };

// Local Studio (Vite) URL; override with ARTISAN_STUDIO_URL. Loopback only.
export const STUDIO_URL = process.env.ARTISAN_STUDIO_URL || 'http://127.0.0.1:5173/';

const BROWSER_CANDIDATES = [
  process.env.ARTISAN_BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

function findBrowser() {
  const found = BROWSER_CANDIDATES.find(p => fs.existsSync(p));
  if (!found) throw new Error('NO_LOCAL_BROWSER: set ARTISAN_BROWSER_PATH to a Chromium-based browser');
  return found;
}

/** Launch an isolated Chromium instance with ANGLE D3D11 hardware acceleration. */
export async function launchBrowser(width = 1280, height = 720) {
  const userDataDir = createBrowserProfileDir();
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    userDataDir,
    args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', `--window-size=${width},${height}`]
  });
  browser.once('disconnected', () => removeBrowserProfileDir(userDataDir));
  return browser;
}

async function openStudio(browser, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  // Keep the headless page off the live preview bridge so it never answers MCP commands.
  const url = new URL(STUDIO_URL);
  url.searchParams.set('mcpBridge', 'off');
  try {
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (err) {
    if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_ADDRESS_UNREACHABLE|ERR_NAME_NOT_RESOLVED/.test(String(err.message))) {
      throw new Error(`STUDIO_UNREACHABLE: no Studio answers at ${STUDIO_URL} (start it with npm run dev, or set ARTISAN_STUDIO_URL)`);
    }
    throw err;
  }
  await page.waitForSelector('#webgl', { timeout: 15000 });
  await page.waitForFunction(() => !!window.__artisan?.getRenderState, { timeout: 15000 });
  return page;
}

const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && new Set(a).size === a.length && b.every(x => a.includes(x));

function fantasticRoute(scene) {
  if (scene === SCENE_IDENTITIES.fantasticHallZone.sceneIdentity) {
    return { studioScene: scene, sceneReference: SCENE_IDENTITIES.walkableWorld, zoneReference: SCENE_IDENTITIES.fantasticHallZone };
  }
  if (scene === 'mode:game' || scene === SCENE_IDENTITIES.walkableWorld.sceneIdentity) {
    return { studioScene: scene, sceneReference: SCENE_IDENTITIES.walkableWorld, zoneReference: null };
  }
  if (scene === 'fantastic' || scene === 'preset:fantastic' || scene === SCENE_IDENTITIES.dioramaAdaptation.sceneIdentity) {
    return {
      studioScene: scene,
      sceneReference: resolveSceneAlias(scene === 'fantastic' ? 'preset:fantastic' : scene, { identities: SCENE_IDENTITIES, aliases: SCENE_ALIASES }).sceneReference,
      zoneReference: null
    };
  }
  return { studioScene: scene, sceneReference: null, zoneReference: null };
}

function verifyZoneRender(render, expectedScene, expectedZone) {
  if (!expectedZone) {
    if (render?.zoneReference != null) throw new Error('HEADLESS_IDENTITY_MISMATCH: unexpected zone scope on world evidence. Nothing was written.');
    return;
  }
  verifySceneReference(render?.zoneReference, expectedZone, { expectedParent: expectedScene });
  const proof = render?.zoneEvidence;
  if (!proof || proof.parentSceneIdentity !== expectedScene.sceneIdentity || proof.zoneSceneIdentity !== expectedZone.sceneIdentity
    || proof.cameraInZone !== true || !Array.isArray(proof.inFrustum) || !proof.inFrustum.includes(proof.zoneObjectId)) {
    throw new Error('HEADLESS_IDENTITY_MISMATCH: Hall zone camera/frustum proof is missing or stale. Nothing was written.');
  }
}

/**
 * Headless evidence render (SPEC-08 §3.5): a throwaway browser renders the authored session manifest (passed as a
 * page.evaluate ARGUMENT: never a URL or a temp file) or a preset `scene`. The browser recomputes the identity; the
 * render is refused with HEADLESS_IDENTITY_MISMATCH (nothing written) unless it equals `expectedIdentity` with the
 * exact manifest entity set, and stays unchanged until the end. Captures are canvas-only (no DOM overlays).
 * want: any of 'telemetry' | 'capture' | 'audit'. targets: { png, json, md } confined paths, written only after the
 * identity is proven; `envelope(result)` returns the evidence object embedded in the JSON/Markdown artifacts.
 */
export async function renderEvidence({ manifest = null, scene = null, expectedIdentity = null, expectedSceneReference = null, expectedZoneReference = null, angle = null, want = [], targets = {}, envelope = null, frames = 120, width = 1280, height = 720 } = {}) {
  if (!manifest && !scene) throw new Error('RENDER_TARGET_MISSING: renderEvidence needs a manifest or a preset scene');
  const headlessRunId = crypto.randomUUID();
  const browser = await launchBrowser(width, height);
  try {
    const page = await openStudio(browser, width, height);
    await page.evaluate(() => window.__artisan.applyDPRPreset('balanced')); // fixed DPR: no dynamic resolution scaler
    const ids = manifest ? manifest.entities.map(e => e.id) : null;
    if (manifest) {
      const applied = await page.evaluate(async (m) => {
        try { return await window.__artisan.applyAuthoredManifest(m); } catch (e) { return { error: String(e.message).slice(0, 300) }; }
      }, manifest);
      if (applied.error) throw new Error(`COMPILE_FAILED: the headless Studio rejected the manifest: ${applied.error}`);
    } else {
      const route = fantasticRoute(scene);
      if (route.sceneReference?.kind === 'walkable-world') {
        await page.evaluate(async (zone) => window.__artisan.switchToGameMode({ zone }), route.zoneReference?.sceneIdentity ?? null);
      } else {
        await page.evaluate((s) => window.__artisan.loadScene(s), scene);
      }
    }
    const route = manifest ? null : fantasticRoute(scene);
    const canonicalExpected = expectedSceneReference ?? (manifest ? null : route.sceneReference);
    const canonicalZone = expectedZoneReference ?? (manifest ? null : route.zoneReference);
    const expected = manifest ? expectedIdentity : (canonicalExpected?.sceneIdentity || `preset:${scene}`);
    const start = await page.evaluate(() => window.__artisan.getRenderState());
    if (!expected || start.sceneIdentity !== expected || (ids && !sameIds(start.renderedEntityIds, ids))) {
      throw new Error(`HEADLESS_IDENTITY_MISMATCH: the headless Studio rendered ${start.sceneIdentity ?? start.identityError ?? 'nothing'} with ${start.renderedEntityIds.length} entities; expected ${expected}${ids ? ` with ${ids.length}` : ''}. Nothing was written.`);
    }
    if (canonicalExpected) verifySceneReference(start.sceneReference, canonicalExpected);
    verifyZoneRender(start, canonicalExpected, canonicalZone);
    const cameraAngle = angle || (manifest ? 'hero' : null); // authored worlds get a deterministic camera; presets keep theirs
    if (cameraAngle) await page.evaluate((a) => window.__artisan.setCameraAngle(a), cameraAngle);
    const settle = await page.evaluate(() => window.__artisan.waitForSettled({ timeoutMs: 10000 }));

    const result = { headlessRunId, settled: settle.settled, angle: cameraAngle };
    if (want.includes('telemetry')) {
      const m = await page.evaluate((f) => window.__artisan.measureRender({ frames: f }), frames);
      const osd = await page.evaluate(() => window.__artisan.rtss?.getTelemetry?.() || {});
      result.telemetry = { ...osd, ...m, settled: settle.settled && m.complete };
      result.camera = m.camera;
    }
    if (want.includes('capture')) {
      const cap = await page.evaluate(async () => {
        try { return await window.__artisan.captureCanvas({}); } catch (e) { return { error: String(e.message).slice(0, 200) }; }
      });
      if (cap.error) throw new Error(`HEADLESS_IDENTITY_MISMATCH: ${cap.error}. Nothing was written.`);
      result.capture = { png: Buffer.from(String(cap.dataUrl).split(',')[1] || '', 'base64'), width: cap.width, height: cap.height, settled: cap.settled, camera: cap.camera, inFrustum: cap.inFrustum };
      result.camera = cap.camera;
    }
    if (want.includes('audit')) {
      const report = await page.evaluate(async () => (window.__artisan?.profiler ? await window.__artisan.profiler.runAudit() : null));
      if (!report) throw new Error('PROFILER_UNAVAILABLE: profiler was not initialized on page');
      result.audit = { report, md: await page.evaluate(() => window.__artisan?.profiler?.formatAuditMarkdown?.() || '') };
    }
    const end = await page.evaluate(() => window.__artisan.getRenderState());
    if (end.epoch !== start.epoch || end.sceneIdentity !== expected) {
      throw new Error(`HEADLESS_IDENTITY_MISMATCH: the headless scene changed during the evidence render (epoch ${start.epoch} -> ${end.epoch}). Nothing was written.`);
    }
    if (canonicalExpected) verifyEvidenceWindow(start, end, canonicalExpected, ids);
    verifyZoneRender(end, canonicalExpected, canonicalZone);
    result.render = end;
    if (!result.camera && end.zoneEvidence?.camera) result.camera = end.zoneEvidence.camera;
    if (!result.inFrustum && end.zoneEvidence?.inFrustum) result.inFrustum = end.zoneEvidence.inFrustum;

    // Identity proven: only now may artifacts be written.
    const evidence = envelope ? envelope(result) : null;
    result.evidence = evidence;
    result.paths = {};
    if (targets.png && result.capture) result.paths.png = writeArtifactAt(targets.png, result.capture.png);
    if (targets.json && result.audit) result.paths.json = writeArtifactAt(targets.json, JSON.stringify({ ...result.audit.report, evidence }, null, 2));
    if (targets.md && result.audit) result.paths.md = writeArtifactAt(targets.md, `${result.audit.md}\n\n<!-- evidence: ${JSON.stringify(evidence)} -->\n`);
    return result;
  } finally {
    await browser.close();
  }
}

/** Legacy wrapper: headless audit of a preset scene (files at the artifact root). */
export async function runHeadlessAudit(scene = 'tokyo') {
  const r = await renderEvidence({ scene, want: ['audit'], targets: { json: safeArtifactPath('perf_audit_report', '.json'), md: safeArtifactPath('perf_audit_report', '.md') } });
  return { report: r.audit.report, md: r.audit.md, jsonPath: r.paths.json, mdPath: r.paths.md };
}

/** Legacy wrapper: canvas capture of a preset scene. */
export async function captureHeadlessScreenshot({ filename, target = null, angle = null, scene = 'trio', width = 1280, height = 720 }) {
  const r = await renderEvidence({ scene: scene || 'trio', angle, want: ['capture'], targets: { png: target || safeArtifactPath(filename, '.png', 'artisan_capture') }, width, height });
  return { filePath: r.paths.png, telemetry: {} };
}

/** Legacy wrapper: measured telemetry of a preset scene (defaults to the Studio's start page, trio). */
export async function getHeadlessTelemetry(scene = 'trio') {
  return (await renderEvidence({ scene, want: ['telemetry'] })).telemetry;
}
