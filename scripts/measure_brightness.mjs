// Brightness / mode-response harness for the diorama lighting profiles (SPEC-07 §Visibility).
// Renders every diorama preset under Dusk / Hearth / Sol in a fixed headless browser and gates
// luma readability, highlight clipping and real response to the lighting modes.
//
// Usage: node scripts/measure_brightness.mjs [--tag NAME] [--scenes a,b] [--compare-to DIR] [--no-gate] [--url URL]
//   --tag         output folder name under <ARTISAN_ARTIFACTS_DIR>/brightness/ (default: timestamp)
//   --compare-to  a previous run folder; writes before_after.png (rows = scenes, before | after)
//   --no-gate     always exit 0 (baseline capture)
//   --url         use an already-running Studio instead of spawning Vite
// Method: 1280x720 viewport, deviceScaleFactor 1, renderer canvas only (UI hidden), 3 settled samples
// per scene/mode (median by mean luma), Rec.709 luma on 8-bit sRGB, near-black Y<24, clipped Y>245.
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import { LIGHTING_PRESETS, VISIBILITY_THRESHOLDS, MODE_RESPONSE, PERFORMANCE_PROFILES } from '../src/contracts/artisanContract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.resolve(process.env.ARTISAN_ARTIFACTS_DIR || path.join(ROOT, '.artisan-artifacts'));
const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const TAG = (arg('--tag') || new Date().toISOString().replace(/[:.]/g, '-')).replace(/[^A-Za-z0-9._-]/g, '_');
const OUT = path.join(ARTIFACTS, 'brightness', TAG);
const SCENES = (arg('--scenes') || 'trio,tavern,alchemist,armory,library,tokyo,winterhold').split(',');
const MODES = LIGHTING_PRESETS; // dusk, hearth, day ("Sol" in the UI)
const MODE_LABEL = { dusk: 'Dusk', hearth: 'Hearth', day: 'Sol' };
const SAMPLES = 3;
const VIEW = { width: 1280, height: 720 };
const BROWSER = process.env.ARTISAN_BROWSER_PATH || ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(p => fs.existsSync(p));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function portFree(port) {
  return new Promise(res => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port, '127.0.0.1'); });
}
async function waitHttp(url, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if ((await fetch(url)).ok) return true; } catch {} await sleep(300); }
  return false;
}

/** Luma statistics for an 8-bit luma buffer. */
function stats(luma) {
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < luma.length; i++) { hist[luma[i]]++; sum += luma[i]; }
  const pct = (q) => { const target = q * luma.length; let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; } return 255; };
  let dark = 0, clip = 0;
  for (let v = 0; v < 24; v++) dark += hist[v];
  for (let v = 246; v < 256; v++) clip += hist[v];
  const r2 = (x) => Math.round(x * 100) / 100;
  return { meanY: r2(sum / luma.length), p10: pct(0.10), p50: pct(0.50), p90: pct(0.90), nearBlackPct: r2(100 * dark / luma.length), clippedPct: r2(100 * clip / luma.length) };
}
const rms = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.round(Math.sqrt(s / a.length) * 100) / 100; };

async function main() {
  if (!BROWSER) throw new Error('No Edge/Chrome executable found (set ARTISAN_BROWSER_PATH).');
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  let vite = null;
  let url = arg('--url');
  if (!url) {
    let port = null;
    for (const p of [5189, 5188, 5187]) if (await portFree(p)) { port = p; break; }
    if (!port) throw new Error('no free Vite port');
    vite = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    url = `http://127.0.0.1:${port}/`;
    if (!await waitHttp(url, 30000)) throw new Error(`Vite did not start on ${url}`);
  }
  const browser = await puppeteer.launch({ executablePath: BROWSER, headless: 'new', args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', `--window-size=${VIEW.width},${VIEW.height}`] });
  const report = { suite: 'measure-brightness', tag: TAG, timestamp: new Date().toISOString(), method: { viewport: `${VIEW.width}x${VIEW.height}`, deviceScaleFactor: 1, capture: 'renderer canvas only (all UI hidden)', samples: SAMPLES, aggregate: 'median sample by mean luma', luma: 'Rec.709 on 8-bit sRGB', nearBlack: 'Y < 24', clipped: 'Y > 245' }, browser: { executable: BROWSER, version: await browser.version() }, thresholds: VISIBILITY_THRESHOLDS, modeResponse: MODE_RESPONSE, scenes: {}, failures: [] };
  try {
    const page = await browser.newPage();
    await page.setViewport({ ...VIEW, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 200)));
    await page.goto(`${url}?mcpBridge=off`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#webgl', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__artisan?.renderer, { timeout: 30000 });
    await page.addStyleTag({ content: 'body * { visibility: hidden !important; } #webgl { visibility: visible !important; }' });
    report.renderer = await page.evaluate(() => {
      const gl = window.__artisan.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), pixelRatio: window.__artisan.renderer.getPixelRatio() };
    });
    const analyzer = await browser.newPage(); // decodes PNGs off the Studio page
    const decode = (b64) => analyzer.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      const y = new Uint8Array(c.width * c.height);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) y[j] = Math.min(255, Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]));
      let s = '';
      for (let i = 0; i < y.length; i += 0x8000) s += String.fromCharCode.apply(null, y.subarray(i, i + 0x8000));
      return btoa(s);
    }, b64).then(s => Buffer.from(s, 'base64'));

    const setMode = (mode) => page.evaluate((m) => {
      if (typeof window.__artisan.setLighting === 'function') window.__artisan.setLighting(m);
      else document.getElementById(`btn-lighting-${m}`)?.click();
    }, mode);

    for (const scene of SCENES) {
      await page.evaluate(s => window.__artisan.loadScene(s), scene);
      await sleep(2000); // 90 warm-up frames + shadow bake
      const entry = { modes: {} };
      const lumaByMode = {};
      for (const mode of MODES) {
        await setMode(mode);
        await sleep(900);
        const samples = [];
        for (let i = 0; i < SAMPLES; i++) {
          if (i) await sleep(300);
          const b64 = await page.screenshot({ encoding: 'base64', clip: { x: 0, y: 0, ...VIEW } });
          const luma = await decode(b64);
          samples.push({ b64, luma, ...stats(luma) });
        }
        samples.sort((a, b) => a.meanY - b.meanY);
        const med = samples[Math.floor(SAMPLES / 2)];
        const png = Buffer.from(med.b64, 'base64');
        const shot = path.join(OUT, 'shots', `${scene}_${mode}.png`);
        fs.writeFileSync(shot, png);
        const tel = await page.evaluate(() => {
          const t = window.__artisan.rtss?.getTelemetry?.() || {};
          return { drawCalls: t.drawCalls ?? window.__artisan.renderer.info.render.calls, triangles: t.triangles ?? window.__artisan.renderer.info.render.triangles, lighting: window.__artisan.getLightingTelemetry?.() ?? null };
        });
        lumaByMode[mode] = med.luma;
        const { b64: _b, luma: _l, ...st } = med;
        entry.modes[mode] = { ...st, sampleMeans: samples.map(s => s.meanY), drawCalls: tel.drawCalls, triangles: tel.triangles, screenshot: path.relative(ARTIFACTS, shot).replace(/\\/g, '/'), screenshotSha256: crypto.createHash('sha256').update(png).digest('hex'), lighting: tel.lighting };
        const th = VISIBILITY_THRESHOLDS[mode];
        const m = entry.modes[mode];
        const fails = [];
        if (m.meanY < th.meanYMin) fails.push(`mean ${m.meanY} < ${th.meanYMin}`);
        if (m.p50 < th.medianYMin) fails.push(`median ${m.p50} < ${th.medianYMin}`);
        if (m.nearBlackPct > th.nearBlackPctMax) fails.push(`near-black ${m.nearBlackPct}% > ${th.nearBlackPctMax}%`);
        if (m.clippedPct > th.clippedPctMax) fails.push(`clipped ${m.clippedPct}% > ${th.clippedPctMax}%`);
        m.pass = fails.length === 0;
        m.failures = fails;
        for (const f of fails) report.failures.push(`${scene}/${MODE_LABEL[mode]}: ${f}`);
        console.log(`${m.pass ? 'PASS' : 'FAIL'} ${scene.padEnd(10)} ${MODE_LABEL[mode].padEnd(6)} meanY ${String(m.meanY).padStart(6)} p50 ${String(m.p50).padStart(3)} dark ${String(m.nearBlackPct).padStart(5)}% clip ${m.clippedPct}% draws ${m.drawCalls} tris ${m.triangles}${fails.length ? ' — ' + fails.join('; ') : ''}`);
      }
      // Mode response: spread, Sol-vs-Hearth separation, light-field changes, fixed-frame RMS
      const means = MODES.map(md => entry.modes[md].meanY);
      const resp = { spread: Math.round((Math.max(...means) - Math.min(...means)) * 100) / 100, solMinusHearth: Math.round((entry.modes.day.meanY - entry.modes.hearth.meanY) * 100) / 100, pairs: {} };
      const fails = [];
      if (resp.spread < MODE_RESPONSE.meanSpreadMin) fails.push(`mean spread ${resp.spread} < ${MODE_RESPONSE.meanSpreadMin}`);
      if (resp.solMinusHearth < MODE_RESPONSE.solOverHearthMin) fails.push(`Sol-Hearth ${resp.solMinusHearth} < ${MODE_RESPONSE.solOverHearthMin}`);
      for (let i = 0; i < MODES.length; i++) for (let j = i + 1; j < MODES.length; j++) {
        const a = MODES[i], b = MODES[j];
        const la = entry.modes[a].lighting?.fields, lb = entry.modes[b].lighting?.fields;
        const changed = la && lb ? Object.keys(la).filter(k => JSON.stringify(la[k]) !== JSON.stringify(lb[k])) : null;
        const pair = { rms: rms(lumaByMode[a], lumaByMode[b]), changedFields: changed };
        resp.pairs[`${a}/${b}`] = pair;
        if (pair.rms < MODE_RESPONSE.pairRmsMin) fails.push(`${a}/${b} RMS ${pair.rms} < ${MODE_RESPONSE.pairRmsMin}`);
        if (!changed) fails.push(`${a}/${b} lighting telemetry unavailable`);
        else if (changed.length < MODE_RESPONSE.changedFieldsMin) fails.push(`${a}/${b} only ${changed.length} light fields change`);
      }
      resp.pass = fails.length === 0;
      resp.failures = fails;
      entry.modeResponse = resp;
      for (const f of fails) report.failures.push(`${scene}/mode-response: ${f}`);
      const trisMax = PERFORMANCE_PROFILES.diorama.trianglesTarget;
      entry.maxTriangles = Math.max(...MODES.map(md => entry.modes[md].triangles || 0));
      entry.withinTriangleTarget = entry.maxTriangles <= trisMax;
      entry.maxDrawCalls = Math.max(...MODES.map(md => entry.modes[md].drawCalls || 0));
      console.log(`${resp.pass ? 'PASS' : 'FAIL'} ${scene.padEnd(10)} response spread ${resp.spread} Sol-Hearth ${resp.solMinusHearth} RMS ${Object.values(resp.pairs).map(p => p.rms).join('/')}${fails.length ? ' — ' + fails.join('; ') : ''}`);
      report.scenes[scene] = entry;
    }
    report.pageErrors = pageErrors;

    // Contact sheet: rows = scenes, columns = modes (optionally before | after)
    const prevDir = arg('--compare-to');
    const cells = [];
    const rows = SCENES.map(scene => {
      const r = [];
      if (prevDir) for (const mode of MODES) { const f = path.join(path.resolve(prevDir), 'shots', `${scene}_${mode}.png`); r.push(fs.existsSync(f) ? { label: `BEFORE ${MODE_LABEL[mode]}`, file: f } : null); }
      for (const mode of MODES) r.push({ label: `${prevDir ? 'AFTER ' : ''}${MODE_LABEL[mode]} · Y ${report.scenes[scene].modes[mode].meanY}`, file: path.join(OUT, 'shots', `${scene}_${mode}.png`) });
      return { scene, cells: r };
    });
    for (const row of rows) for (const c of row.cells) if (c) cells.push(fs.readFileSync(c.file).toString('base64'));
    let k = 0;
    const layout = rows.map(row => ({ scene: row.scene, cells: row.cells.map(c => c ? { label: c.label, idx: k++ } : null) }));
    const sheet = await analyzer.evaluate(async (layout, images) => {
      const W = 384, H = 216, PAD = 6, LEFT = 110, TOP = 4;
      const cols = Math.max(...layout.map(r => r.cells.length));
      const c = document.createElement('canvas');
      c.width = LEFT + cols * (W + PAD); c.height = TOP + layout.length * (H + PAD);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0b0d11'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.font = '13px sans-serif';
      for (let r = 0; r < layout.length; r++) {
        const y = TOP + r * (H + PAD);
        ctx.fillStyle = '#e6edf3'; ctx.fillText(layout[r].scene, 8, y + H / 2);
        for (let i = 0; i < layout[r].cells.length; i++) {
          const cell = layout[r].cells[i];
          if (!cell) continue;
          const img = new Image(); img.src = `data:image/png;base64,${images[cell.idx]}`; await img.decode();
          const x = LEFT + i * (W + PAD);
          ctx.drawImage(img, x, y, W, H);
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, y, W, 20);
          ctx.fillStyle = '#ffd89b'; ctx.fillText(cell.label, x + 6, y + 14);
        }
      }
      return c.toDataURL('image/png').split(',')[1];
    }, layout, cells);
    const sheetPath = path.join(OUT, prevDir ? 'before_after.png' : 'contact_sheet.png');
    fs.writeFileSync(sheetPath, Buffer.from(sheet, 'base64'));
    report.contactSheet = sheetPath;
  } finally {
    await browser.close();
    if (vite) vite.kill();
  }
  report.pass = report.failures.length === 0;
  const reportPath = path.join(OUT, 'brightness_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n${report.pass ? 'ALL GATES PASS' : `${report.failures.length} gate failure(s)`} — report: ${reportPath}\ncontact sheet: ${report.contactSheet}`);
  process.exit(report.pass || process.argv.includes('--no-gate') ? 0 : 1);
}

main().catch(err => { console.error('FATAL', err); process.exit(2); });
