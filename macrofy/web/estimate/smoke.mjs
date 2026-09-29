// Headless smoke of the estimate flows with a MOCKED model layer (no CDN or Hugging Face access needed).
//   node web/estimate/smoke.mjs            (run from macrofy/; needs the global playwright and python3)
// Serves web/ with python3 -m http.server and walks three scenarios, each in a fresh browser context:
//   ZERO (T-016, the default flow): NO plate registered, no taps. Home "Apontar para o prato" -> photo -> automatic analysis -> result (typical-plate prior, model ranges,
//     "Não calibrado") -> "Conferir com balança" (item grams + other-app kcal) changes the calibration state -> the next estimate shows the learned factor ->
//     a plate-total check -> "Precisão" (evaluate over the checks, other-app table, "precisa de mais conferências" under 5) -> export -> conformal ranges after 10 checks.
//   AUTO (T-014, corrections under "Ajustes / Corrigir"): photo -> progress ("Encontrando o prato…", "Encontrando os alimentos…") -> ONE confirmation screen with names, grams,
//     ranges and macros and zero taps -> corrections (rename, add by tap, remove, merge, separate, split) -> oil -> unknown-plate prior widens the range
//     -> save with timings -> export; then a reload mid-flow resumes from IndexedDB; then "no plate found" still gives a result (no tap, honest note);
//     then a tab killed mid-analysis is not re-run by the resume (crash guard) and the lighter retry works.
//   MANUAL (T-013, "Modo manual" under Ajustes / Corrigir): photo -> plate -> rim tap -> three food taps -> names (top-3 and "outro…") -> oil -> result -> link -> save -> export.
// The numbers on screen are compared with the pure core fed the same masks; the exports are checked by the eval validator.
// Not a registered check (it needs a browser); the registered ones are estimator-selftest, autoseg-selftest and web-selftest. Set SMOKE_SHOTS=<dir> for screenshots.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from './core.mjs';
import * as auto from './autoseg.mjs';
import { createLookup } from '../../nutrition/lookup-core.mjs';
import { VOCAB } from '../../nutrition/lookup.mjs';
import { createHash } from 'node:crypto';
import * as cal from './calibration.mjs';
import { validatePredictions, evaluate } from '../../eval/metrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const { chromium } = createRequire(import.meta.url)(`${execSync('npm root -g').toString().trim()}/playwright`);
const PORT = 8700 + Math.floor(Math.random() * 200);
const SHOTS = process.env.SMOKE_SHOTS;
const W = 800; const H = 600;
const [priors, calibrationJson] = ['priors.json', 'calibration.json'].map((f) => JSON.parse(fs.readFileSync(join(HERE, f), 'utf8')));
const calibration = core.loadCalibration(calibrationJson); const lookup = createLookup(VOCAB);
const cls = (id) => VOCAB.classes.find((c) => c.id === id);
const sha = (x) => createHash('sha256').update(x).digest('hex');

// ---- the scene the mock model layer returns (specs are drawn in the browser; the same specs are drawn here to predict the numbers)
const draw = (fn) => { const d = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fn(x, y)) d[y * W + x] = 1; return { width: W, height: H, data: d }; };
const shape = (s) => draw(s.kind === 'disc' ? (x, y) => (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r : s.kind === 'ell' ? (x, y) => ((x - s.cx) / s.a) ** 2 + ((y - s.cy) / s.b) ** 2 <= 1 : (x, y) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1);
// T-017: auto mode works on masks of the mask_side working size (the models return them from SAM's low-res logits) and resizes the result to the
// photo. The mock draws its shapes at the size the app asks for (sampling pixel centres), and the expected masks here are drawn the same way.
const inShape = (s) => (s.kind === 'disc' ? (x, y) => (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r : s.kind === 'ell' ? (x, y) => ((x - s.cx) / s.a) ** 2 + ((y - s.cy) / s.b) ** 2 <= 1 : (x, y) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1);
const autoShape = (s) => {
  const side = JSON.parse(fs.readFileSync(join(HERE, 'priors.json'), 'utf8')).autoseg.mask_side.value; const k = Math.min(1, side / Math.max(W, H)); const w = Math.round(W * k); const h = Math.round(H * k);
  const d = new Uint8Array(w * h); const f = inShape(s); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f((x + 0.5) * W / w - 0.5, (y + 0.5) * H / h - 0.5)) d[y * w + x] = 1;
  return auto.resizeMask({ width: w, height: h, data: d }, W, H);
};
const SC = {
  table: { kind: 'rect', x0: 0, y0: 0, x1: W - 1, y1: H - 1, score: 0.99 }, // best score: the plate must not be picked by score
  plate: { kind: 'ell', cx: 400, cy: 300, a: 330, b: 250, score: 0.93 },
  speck: { kind: 'rect', x0: 20, y0: 20, x1: 24, y1: 24, score: 0.9 },
  rice: { kind: 'disc', cx: 300, cy: 300, r: 70, score: 0.95 },
  meat: { kind: 'disc', cx: 500, cy: 320, r: 55, score: 0.92 },
  salad: { kind: 'disc', cx: 400, cy: 430, r: 45, score: 0.9 },
  fork: { kind: 'rect', x0: 460, y0: 400, x1: 660, y1: 410, score: 0.9 }, // cutlery on the plate: SigLIP calls it "talher"
  unstable: { kind: 'disc', cx: 600, cy: 200, r: 30, score: 0.5 },
};
const PLAN_AUTO = [ // classify() answers in call order: the crops come biggest first (rice, meat, salad, fork), then the corrections
  ['arroz branco cozido', 'feijão carioca cozido', 'macarrão cozido'], ['bife grelhado', 'frango grelhado', 'hambúrguer grelhado'],
  ['salada mista crua (alface, tomate, cenoura)', 'salada de alface e tomate', 'batata cozida'], ['talher'],
  ['batata cozida', 'purê de batata', 'mandioca cozida'], ['banana prata', 'maçã fuji', 'uva'],
];
const PLAN_MANUAL = [['arroz branco cozido', 'feijão carioca cozido', 'macarrão cozido'], ['bife grelhado', 'frango grelhado', 'hambúrguer grelhado'], ['batata cozida', 'purê de batata', 'mandioca cozida']];

// ---- mock model layer, installed before the app loads
function installMock({ W, H, SC, plan }) {
  const mk = (s, low = null) => { // low = { w, h }: drawn at that size, sampling the photo at pixel centres (as smoke's autoShape)
    const w = low ? low.w : W; const hh = low ? low.h : H; const d = new Uint8Array(w * hh);
    const inside = s.kind === 'disc' ? (x, y) => (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r : s.kind === 'ell' ? (x, y) => ((x - s.cx) / s.a) ** 2 + ((y - s.cy) / s.b) ** 2 <= 1 : (x, y) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (low ? inside((x + 0.5) * W / w - 0.5, (y + 0.5) * H / hh - 0.5) : inside(x, y)) d[y * w + x] = 1;
    return { width: w, height: hh, data: d, score: s.score };
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let grid = 0;
  window.__classifyLog = [];
  // iPhone mode (localStorage __mockSequential = '1'): info.sequential, so auto mode splits into a SAM page and a naming page. The model calls of
  // every page of the tab go to sessionStorage __mockLog ('page' marks each page load), so a test can see what each page loaded.
  const mlog = (e) => { try { const a = JSON.parse(sessionStorage.getItem('__mockLog') ?? '[]'); a.push(e); sessionStorage.setItem('__mockLog', JSON.stringify(a)); } catch { /* no storage */ } };
  mlog('page');
  const seq = () => { try { return localStorage.getItem('__mockSequential') === '1'; } catch { return false; } };
  window.__macrofyModels = {
    async load(onProgress) {
      mlog('load');
      for (const f of [0.2, 0.6, 1]) { onProgress({ stage: 'segmentation', label: 'Modelo de contorno (SAM)', fraction: f }); await sleep(30); }
      return { version: 'mock', backend: 'mock/none', segmenter: 'mock-sam', namer: 'mock-siglip', sequential: seq(), warnings: [] };
    },
    async loadNaming(onProgress, opts = {}) {
      mlog('loadNaming'); mlog(`backends ${JSON.stringify(opts.backends ?? null)}`);
      const hang = Number(localStorage.getItem('__mockHangNaming') ?? 0); // the next N naming pages "die" while loading the namer
      if (hang > 0) { localStorage.setItem('__mockHangNaming', String(hang - 1)); return new Promise(() => {}); }
      await sleep(30); return { version: 'mock', backend: null, segmenter: null, namer: 'mock-siglip', namer_backend: 'mock/none', sequential: seq(), warnings: [] };
    },
    async releaseAll() { mlog('releaseAll'); return true; },
    async setImage(blob) { mlog('setImage'); if (!blob || !blob.size) throw new Error('mock: empty image'); grid = 0; return { encoder_ms: 42, cached: true }; },
    async segmentPoints(points, opts = {}) {
      mlog('segmentPoints');
      const call = ++grid; window.__grids = (window.__grids ?? []).concat([{ n: points.length, batch: opts.batch, budgetMs: opts.budgetMs, lowRes: opts.lowRes ?? null }]);
      if (window.__crashAt === call) { window.__crashAt = 0; return new Promise(() => {}); } // the tab "dies" here: the analysis never finishes
      for (let i = 0; i < points.length; i += opts.batch || 4) { await sleep(120); opts.onProgress?.({ done: Math.min(points.length, i + (opts.batch || 4)), total: points.length }); }
      const names = call === 1 ? (window.__noPlate ? ['table', 'rice', 'meat', 'fork', 'speck'] : ['table', 'plate', 'speck', 'rice']) : ['plate', 'rice', 'meat', 'salad', 'fork', 'unstable', 'table'];
      return { masks: names.map((n) => mk(SC[n], opts.lowRes)), decodes: Math.ceil(points.length / (opts.batch || 4)), done: points.length, ms: 300, timed_out: false };
    },
    async segment(x, y) {
      x = Math.round(x); y = Math.round(y); (window.__taps ??= []).push([x, y]); // the smoke rebuilds the expected masks from the taps it really made
      if (Math.hypot(x - 400, y - 300) > 250) { // a tap on the rim: the plate, and a worse alternative
        return [mk({ ...SC.plate, score: 0.95 }), { ...mk({ kind: 'ell', cx: 400, cy: 300, a: 200, b: 150 }), score: 0.6 }];
      }
      return [mk({ kind: 'disc', cx: x, cy: y, r: 60, score: 0.9 }), mk({ kind: 'disc', cx: x, cy: y, r: 30, score: 0.5 })];
    },
    async classify(blob, prompts) {
      mlog('classify');
      const idx = window.__classifyIdx ?? 0; window.__classifyIdx = idx + 1; const want = plan[idx % plan.length];
      return prompts.map((p) => { const i = want.findIndex((n) => p === `uma foto de ${n}`); return { label: p, score: i < 0 ? 0.001 : 0.9 - i * 0.2 }; });
    },
  };
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/app/`)).ok) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('http.server did not start');
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', WEB], { stdio: 'ignore' });
const base = () => `http://localhost:${PORT}/app/`;
let browser; let failed = false;
const step = (name) => console.log(`step ${name}`);

async function newPage(plan) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true, locale: 'pt-BR' });
  const page = await ctx.newPage(); const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(installMock, { W, H, SC, plan });
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
  return { page, problems, shot };
}
/** One plate through the UI and one weighed meal straight into IndexedDB. */
async function seed(page) {
  await page.goto(`${base()}#/plates/new`);
  await page.getByPlaceholder('Ex.: Prato raso branco').fill('Prato raso branco');
  await page.getByPlaceholder('Ex.: 260').fill('260');
  await page.getByRole('button', { name: 'Salvar prato' }).click();
  await page.waitForSelector('text=Prato raso branco');
  await page.evaluate(async () => {
    const db = await import('./db.mjs');
    await db.put('meals', { id: 'm20260908121000-abcd', captured_at: '2026-09-08T12:10:00-03:00', split: 'test', plate_id: 'prato-raso-branco', photos: [], items: [{ id: 'i1', label: 'arroz branco cozido', grams: 150, state: 'cooked', method: 'boiled' }] });
  });
}
const photoPng = (page, variant = 0) => page.evaluate(({ W, H, variant }) => {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#8b6b4a'; g.fillRect(0, 0, W, H); g.fillStyle = '#f4f4f4'; g.beginPath(); g.ellipse(400, 300, 330, 250, 0, 0, 7); g.fill();
  g.fillStyle = '#f4f1e6'; g.beginPath(); g.arc(300, 300, 70, 0, 7); g.fill(); g.fillStyle = '#4a2a1a'; g.beginPath(); g.arc(500, 320, 55, 0, 7); g.fill(); g.fillStyle = '#3f8a3a'; g.beginPath(); g.arc(400, 430, 45, 0, 7); g.fill();
  g.fillStyle = `rgb(${variant % 256},0,${255 - (variant % 256)})`; g.fillRect(2, 2, 6, 6); // a different file (sha256) per variant
  return c.toDataURL('image/png').split(',')[1];
}, { W, H, variant });
const upload = async (page, variant = 0) => page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'prato.png', mimeType: 'image/png', buffer: Buffer.from(await photoPng(page, variant), 'base64') });
/** The home screen's camera button ("Apontar para o prato"). */
const shoot = async (page, variant = 0) => page.locator('input[type=file][capture]').setInputFiles({ name: 'prato.png', mimeType: 'image/png', buffer: Buffer.from(await photoPng(page, variant), 'base64') });
const openFix = async (page, i) => { const d = page.locator(`[data-item="${i}"] details.fix`); if (!(await d.evaluate((e) => e.open))) await d.locator('summary').click(); };
const openAdjust = async (page) => { const d = page.locator('#adjust'); if (!(await d.evaluate((e) => e.open))) await d.locator('summary').click(); };
const pct = (x) => (x === null || x === undefined ? 'n/d' : `${(x * 100).toFixed(1).replace('.', ',')} %`);
const dbAll = (page, store) => page.evaluate(async (st) => (await (await import('./db.mjs')).getAll(st)), store);
const tapAt = async (page, x, y) => { const box = await page.locator('#stage').boundingBox(); await page.locator('#stage').click({ position: { x: x * box.width / W, y: y * box.height / H } }); };
const n0 = (x) => Math.round(x);

/** Waits until the card of item i shows the numbers of e (a plate, name or calibration change recomputes asynchronously). */
const seesItemOn = (page) => async (i, e) => {
  const want = [`${n0(e.grams)} g`, `Faixa de 80%: ${n0(e.lo80)} a ${n0(e.hi80)} g`, `${n0(e.kcal)} kcal`];
  try { await page.waitForFunction(([idx, parts]) => { const t = document.querySelector(`[data-item="${idx}"]`)?.innerText ?? ''; return parts.every((x) => t.includes(x)); }, [i, want], { timeout: 4000 }); }
  catch { assert.fail(`item ${i}: expected ${want.join(' | ')}, got: ${(await page.locator(`[data-item="${i}"]`).innerText()).replace(/\n+/g, ' ')}`); }
};
/** The text of the result outside every <details> (the default path): no plate, ruler, registration or tap words may be there. */
const defaultPathText = (page) => page.evaluate(() => { const m = document.querySelector('main').cloneNode(true); m.querySelectorAll('details').forEach((d) => d.remove()); return m.textContent; });

// ================================================================ ZERO
async function zeroScenario() {
  const { page, problems, shot } = await newPage(PLAN_AUTO);
  const plateMask = autoShape(SC.plate); const foodMasks = [SC.rice, SC.meat, SC.salad].map(autoShape);
  const typical = auto.plateSetup(priors, null); const scaleTyp = core.scaleFromPlateMask(plateMask, priors.typical_plate.diameter_mm);
  const counts = core.exclusiveCounts(foodMasks); const ids = ['arroz-branco-cozido', 'bife-grelhado', 'salada-mista-crua'];
  const estimateWith = (calibration) => ids.map((id, i) => core.estimateItem({ cls: cls(id), pixels: counts[i], scale: scaleTyp, oil: 'normal', priors: auto.priorsForPlate(priors, typical), calibration, lookup }));
  const seesItem = seesItemOn(page);
  const params = cal.paramsFrom(priors);
  const learnedFrom = (checks) => { const state = cal.learn(checks, params); return { state, calibration: core.loadCalibration(cal.toCalibration(state)) }; };
  const nextEstimate = async (variant) => { // back to the home screen, reset the mock's naming plan and point the camera again
    await page.goto(`${base()}#/`); await page.getByText('Apontar para o prato').waitFor();
    await page.evaluate(() => { window.__classifyIdx = 0; window.__grids = []; });
    await shoot(page, variant); await page.waitForSelector('h2:text-is("Resultado")'); await page.waitForSelector('[data-item="2"]');
  };

  step('zero: home opens on "Apontar para o prato"; no plate, ruler, registration or weighing words on it');
  await page.goto(`${base()}#/`); await page.getByText('Apontar para o prato').waitFor();
  const homeText = await page.locator('main').innerText();
  assert.doesNotMatch(homeText, /régua|cadastr|registr|Pesar refeição|Nenhum prato/i, homeText);
  assert.equal(await page.locator('main a[href="#/plates"], main a[href="#/plates/new"], main a[href="#/meal"], main a[href="#/estimate/new"]').count(), 0, 'no plate, weighing or estimate-setup link on the home screen');
  assert.equal((await page.locator('#settings-link').innerText()).trim(), 'Ajustes / Corrigir');
  assert.match(await page.locator('#home-state').innerText(), /Não calibrado/);
  assert.equal(await page.locator('input[type=file][capture=environment]').count(), 1, 'the camera button');
  await shot('z01-home');

  step('zero: photo -> automatic analysis -> result with NO plate registered and NO taps (typical-plate prior, model ranges)');
  await shoot(page, 0);
  await page.waitForSelector('h2:text-is("Resultado")'); await page.waitForSelector('text=Etapa 3 de 3: Resultado');
  assert.equal(await page.evaluate(() => (window.__taps ?? []).length), 0, 'no tap');
  assert.equal((await dbAll(page, 'plates')).length, 0, 'no plate was ever registered');
  assert.equal(await page.locator('[data-item]').count(), 3);
  const est0 = estimateWith(core.loadCalibration(calibrationJson)); const tot0 = core.totals(est0);
  for (let i = 0; i < 3; i++) await seesItem(i, est0[i]);
  assert.match(await page.locator('#totals').innerText(), new RegExp(`Total do prato: ${n0(tot0.grams)} g`));
  assert.equal((await page.locator('#calstate').innerText()).trim(), 'Não calibrado');
  assert.match(await page.locator('#range-basis').innerText(), /Faixas do modelo.*Escala pelo prato típico \(26 cm\): faixa mais larga/);
  assert.ok(Math.abs(est0[0].sigma_scale - core.scaleSigma(priors.typical_plate_scale_uncertainty.value)) < 1e-4, 'the wider typical-plate scale uncertainty flows into the ranges');
  assert.doesNotMatch(await defaultPathText(page), /régua|cadastr|registr|Pesar refeição|toque/i, 'the default path has no plate, ruler or tap prompt');
  assert.equal(await page.locator('#plate-select').isVisible(), false, 'the plate picker is hidden under Ajustes / Corrigir');
  assert.equal(await page.locator('#add-item').isVisible(), false, 'manual taps are hidden under Ajustes / Corrigir');
  await shot('z02-result');

  step('zero: "Conferir com balança" is optional; empty is an error; item grams + other-app kcal are stored and change the state');
  await page.locator('#check summary').click();
  await page.locator('#check-save').click(); await page.waitForSelector('text=Digite os gramas de pelo menos um item');
  assert.equal((await dbAll(page, 'checks')).length, 0);
  await page.locator('[data-check-item="0"]').fill('150,5'); await page.locator('[data-check-item="1"]').fill('100'); await page.locator('#check-other-kcal').fill('520');
  await shot('z03-check-form');
  await page.locator('#check-save').click(); await page.waitForSelector('#check-done');
  assert.match(await page.locator('#calstate-now').innerText(), /Agora: Calibrado com 1 conferência\./);
  assert.equal((await page.locator('#calstate').innerText()).trim(), 'Não calibrado', 'this estimate keeps the state it was made with');
  await seesItem(0, est0[0]);
  let recs = { checks: await dbAll(page, 'checks'), estimates: await dbAll(page, 'estimates') };
  assert.equal(recs.checks.length, 1); assert.equal(recs.estimates.length, 1, 'the check saved its estimate');
  const c1 = recs.checks[0];
  assert.equal(c1.id, `chk-${recs.estimates[0].id}`); assert.equal(c1.estimate_id, recs.estimates[0].id); assert.equal(c1.truth_kind, 'items'); assert.deepEqual(c1.items.map((i) => i.truth_g), [150.5, 100, null]);
  assert.equal(c1.other_app_kcal, 520); assert.equal(c1.plate.typical, true); assert.equal(c1.plate.diameter_mm, priors.typical_plate.diameter_mm); assert.match(c1.photo_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(c1.items.map((i) => [i.raw_g, i.grams, i.lo80, i.hi80]), est0.map((e) => [e.raw_grams, e.grams, e.lo80, e.hi80]));
  assert.equal(c1.calibration.label, 'Não calibrado'); assert.equal(recs.estimates[0].calibration.label, 'Não calibrado'); assert.equal(recs.estimates[0].plate_typical, true);
  await shot('z04-check-saved');

  step('zero: the next estimate is "Calibrado com 1 conferência" and the grams carry the learned factor (a plate total is a second check)');
  await page.getByRole('link', { name: 'Apontar para outro prato' }).click(); await page.getByText('Apontar para o prato').waitFor();
  assert.match(await page.locator('#home-state').innerText(), /Calibrado com 1 conferência/);
  await page.evaluate(() => { window.__classifyIdx = 0; window.__grids = []; }); await shoot(page, 1);
  await page.waitForSelector('h2:text-is("Resultado")'); await page.waitForSelector('[data-item="2"]');
  const L1 = learnedFrom(recs.checks); const est1 = estimateWith(L1.calibration);
  assert.ok(L1.state.global.factor !== 1 && est1[0].grams !== est0[0].grams && near(est1[0].grams, est1[0].raw_grams * L1.state.global.factor, 0.06), 'a learned global factor moved the grams');
  for (let i = 0; i < 3; i++) await seesItem(i, est1[i]);
  assert.equal((await page.locator('#calstate').innerText()).trim(), 'Calibrado com 1 conferência');
  assert.match(await page.locator('#range-basis').innerText(), /Faixas do modelo/);
  assert.equal(await page.evaluate(() => (window.__taps ?? []).length), 0, 'still no tap');
  await page.locator('#check summary').click(); await page.locator('#check-total').fill('310'); await page.locator('#check-save').click(); await page.waitForSelector('#check-done');
  assert.match(await page.locator('#calstate-now').innerText(), /Agora: Calibrado com 2 conferências\./);
  recs = { checks: await dbAll(page, 'checks'), estimates: await dbAll(page, 'estimates') };
  const c2 = recs.checks.find((c) => c.truth_kind === 'total');
  assert.equal(recs.checks.length, 2); assert.equal(c2.truth_total_g, 310); assert.equal(c2.other_app_kcal, null); assert.equal(c2.calibration.label, 'Calibrado com 1 conferência');
  assert.notEqual(c2.photo_sha256, c1.photo_sha256);

  step('zero: "Precisão" scores the checks with the evaluation engine: needs more checks under 5, other-app table, CIs');
  const cs = (checks) => cal.accuracy(checks, { evaluate, truthNutrients: lookup.truthNutrients });
  await page.goto(`${base()}#/accuracy`); await page.waitForSelector('#acc-n');
  let acc = cs(recs.checks);
  assert.match(await page.locator('#acc-more').innerText(), /precisa de mais conferências/);
  assert.match(await page.locator('#acc-n').innerText(), /2 conferências/);
  assert.match(await page.locator('#acc-kcal').innerText(), new RegExp(`${pct(acc.meal_kcal.mape)}[\\s\\S]*intervalo de 95%: ${pct(acc.meal_kcal.ci95.mape.lo)} a ${pct(acc.meal_kcal.ci95.mape.hi)}`));
  assert.match(await page.locator('#acc-mass').innerText(), new RegExp(`${pct(acc.item_mass.mape)}[\\s\\S]*intervalo de 95%: ${pct(acc.item_mass.ci95.mape.lo)} a ${pct(acc.item_mass.ci95.mape.hi)}`));
  assert.match(await page.locator('#acc-bias').innerText(), /intervalo de 95%/);
  assert.equal(await page.locator('[data-other-row]').count(), 1); assert.match(await page.locator('[data-other-row]').innerText(), /520 kcal/);
  assert.equal(acc.other_app.n, 1); assert.equal(acc.other_app.rows[0].theirs, 520);
  await shot('z05-accuracy-few');
  // three more item checks and (below) more, written straight to IndexedDB in the stored shape, so the screen has 5 and later 10 checks
  const synth = (n, day, mul) => {
    const items = estimateWith(core.loadCalibration(calibrationJson));
    return cal.buildCheck({ estimate: { id: `syn${n}`, items, totals: core.totals(items), plate_typical: true, diameter_mm: 260, oil: 'normal', pipeline: core.PIPELINE }, truth_items: items.map((it, i) => String(Math.round(it.grams * mul[i % mul.length]))), photo_sha256: sha(`synth${n}`), created_at: `2026-09-${day}T12:00:00-03:00`, stateOf: (id) => cls(id).state, state: { label: 'Não calibrado', n_checks: 0 } }).check;
  };
  const putChecks = (cs2) => page.evaluate(async (list) => { const db = await import('./db.mjs'); for (const c of list) await db.put('checks', c); }, cs2);
  await putChecks([synth(1, '10', [1.1, 0.9, 1.2]), synth(2, '11', [1.3, 1.0, 0.8]), synth(3, '12', [0.7, 1.1, 1.0])]);
  await page.reload(); await page.waitForSelector('#acc-n');
  recs.checks = await dbAll(page, 'checks'); acc = cs(recs.checks);
  assert.equal(await page.locator('#acc-more').count(), 0, '5 or more checks: no "precisa de mais conferências"');
  assert.match(await page.locator('#acc-n').innerText(), /5 conferências em \d+ dias/);
  assert.match(await page.locator('#acc-kcal').innerText(), new RegExp(`${pct(acc.meal_kcal.mape)}[\\s\\S]*intervalo de 95%: ${pct(acc.meal_kcal.ci95.mape.lo)} a ${pct(acc.meal_kcal.ci95.mape.hi)}`));
  assert.match(await page.locator('#acc-mass').innerText(), new RegExp(`${pct(acc.item_mass.mape)}`));
  await shot('z06-accuracy');

  step('zero: export the checks as JSON (share sheet or download); the repo scores it with the engine');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-checks').click()]);
  const exp = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.equal(download.suggestedFilename(), 'checks.json'); assert.equal(exp.schema, 'macrofy.checks/1'); assert.equal(exp.checks.length, 5);
  assert.deepEqual(validatePredictions(exp.bench.predictions), []);
  const rescored = evaluate(exp.bench.manifest, exp.bench.predictions, { truthNutrients: lookup.truthNutrients });
  assert.equal(rescored.meal_kcal.mape, acc.meal_kcal.mape); assert.deepEqual(exp.checks.map((c) => c.truth_kind).sort(), ['items', 'items', 'items', 'items', 'total']);

  step('zero: ten checks -> conformal ranges replace the model ranges on the next result');
  await putChecks([synth(4, '13', [1.2, 1.1, 0.9]), synth(5, '14', [0.8, 1.0, 1.3]), synth(6, '15', [1.05, 0.95, 1.15]), synth(7, '16', [1.4, 0.9, 1.0]), synth(8, '17', [0.9, 1.2, 1.1]), synth(9, '18', [1.1, 1.0, 0.75])]);
  recs.checks = await dbAll(page, 'checks');
  await nextEstimate(2);
  const L2 = learnedFrom(recs.checks); assert.ok(L2.state.ranges.item && L2.state.ranges.meal, 'the fixture reaches M checks');
  const est2 = estimateWith(L2.calibration); const conf = cal.applyRanges(est2, core.totals(est2), L2.state);
  for (let i = 0; i < 3; i++) await seesItem(i, conf.items[i]);
  assert.match(await page.locator('#range-basis').innerText(), /Faixas calibradas pelas suas conferências/);
  assert.match(await page.locator('#totals').innerText(), new RegExp(`Faixa de 80%: ${n0(conf.totals.lo80)} a ${n0(conf.totals.hi80)} g`));
  assert.equal((await page.locator('#calstate').innerText()).trim(), `Calibrado com ${recs.checks.length} conferências`);
  await shot('z07-conformal');

  assert.deepEqual(problems, [], `page problems:\n${problems.join('\n')}`);
  await page.context().close();
  console.log('zero-setup smoke: OK');
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ================================================================ AUTO
async function autoScenario() {
  const { page, problems, shot } = await newPage(PLAN_AUTO);
  await seed(page);
  const plateMask = autoShape(SC.plate); const foodMasks = [SC.rice, SC.meat, SC.salad].map(autoShape);
  const scale260 = core.scaleFromPlateMask(plateMask, 260);
  const counts = core.exclusiveCounts(foodMasks);
  const expect = (ids, { oil = 'normal', setup = auto.plateSetup(priors, { diameter_mm: 260 }), scale = scale260 } = {}) => {
    const est = ids.map((id, i) => core.estimateItem({ cls: cls(id), pixels: counts[i], scale, oil, priors: auto.priorsForPlate(priors, setup), calibration, lookup }));
    return { est, tot: core.totals(est) };
  };
  const seesItem = seesItemOn(page);

  step('auto: home camera button (with a registered plate seeded) -> automatic flow');
  await page.goto(`${base()}#/`); await page.getByText('Apontar para o prato').waitFor(); await shot('a01-home');

  step('auto: photo -> progress ("Encontrando o prato…", "Encontrando os alimentos…") -> result with zero taps');
  await shoot(page);
  await page.waitForFunction(() => /Encontrando o prato/.test(document.getElementById('auto-label')?.textContent ?? ''));
  await page.waitForFunction(() => /Encontrando os alimentos/.test(document.getElementById('auto-label')?.textContent ?? ''));
  await shot('a02-progress');
  await page.waitForSelector('h2:text-is("Resultado")');
  await page.waitForSelector('text=Etapa 3 de 3: Resultado');
  assert.equal(await page.evaluate(() => (window.__taps ?? []).length), 0, 'auto mode must not need a tap');
  assert.equal(await page.locator('[data-item]').count(), 3, 'rice, steak, salad; the fork is rejected as non-food');
  const grids = await page.evaluate(() => window.__grids);
  assert.equal(grids.length, 2); assert.equal(grids[0].n, priors.autoseg.plate_grid_n.value ** 2); assert.equal(grids[0].batch, priors.autoseg.decode_batch.value); assert.ok(grids[0].budgetMs <= priors.autoseg.time_budget_ms.value);
  assert.ok(grids[1].n > 0 && grids[1].n < priors.autoseg.food_grid_n.value ** 2, 'the foods grid is only inside the plate ellipse');
  const ids0 = ['arroz-branco-cozido', 'bife-grelhado', 'salada-mista-crua'];
  const base0 = expect(ids0);
  for (let i = 0; i < 3; i++) { assert.match(await page.locator(`[data-item="${i}"] h3`).innerText(), new RegExp(`^${VOCAB.classes.find((c) => c.id === ids0[i]).pt.slice(0, 6)}`, 'i')); await seesItem(i, base0.est[i]); }
  assert.match(await page.locator('#totals').innerText(), new RegExp(`Total do prato: ${n0(base0.tot.grams)} g`));
  assert.equal((await page.locator('#calstate').innerText()).trim(), 'Não calibrado');
  assert.equal(await page.locator('#plate-select').inputValue(), 'prato-raso-branco', 'the only registered plate is the default');
  await shot('a03-confirm');

  step('auto: reload mid-flow -> the estimate resumes from IndexedDB');
  await page.reload(); await page.waitForSelector('#resume'); await shot('a04-resume');
  await page.locator('#resume').click(); await page.waitForSelector('h2:text-is("Resultado")');
  assert.equal(await page.locator('[data-item]').count(), 3); await seesItem(0, base0.est[0]);
  assert.match(await page.locator('#notice').innerText(), /Retomei/);
  await page.evaluate(() => { window.__classifyIdx = 4; }); // the mock restarted with the page: continue its answers after the four crops

  step('auto: an unknown plate uses the "prato típico" prior and a wider range');
  await openAdjust(page); await page.selectOption('#plate-select', '__typical__');
  await page.waitForSelector('text=Escala pelo prato típico');
  const typ = expect(ids0, { setup: auto.plateSetup(priors, null), scale: core.scaleFromPlateMask(plateMask, priors.typical_plate.diameter_mm) });
  await seesItem(0, typ.est[0]);
  assert.ok(typ.est[0].hi80 - typ.est[0].lo80 > base0.est[0].hi80 - base0.est[0].lo80 || typ.est[0].sigma_scale > base0.est[0].sigma_scale);
  assert.ok(typ.est[0].sigma_scale > base0.est[0].sigma_scale, 'wider scale uncertainty');
  await openAdjust(page); await page.selectOption('#plate-select', 'prato-raso-branco'); await seesItem(0, base0.est[0]);

  step('auto: correct a name (rice -> beans)');
  await openFix(page, 0); await page.locator('[data-item="0"] [data-action="rename"]').click();
  await page.locator('[data-item="0"] [data-name="feijao-carioca-cozido"]').click();
  const ids1 = ['feijao-carioca-cozido', 'bife-grelhado', 'salada-mista-crua'];
  await seesItem(0, expect(ids1).est[0]);

  step('auto: add a missed item by tap, then remove it');
  await openAdjust(page); await page.locator('#add-item').click(); await page.waitForSelector('#tap-hint');
  await tapAt(page, 600, 200);
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 4);
  assert.match(await page.locator('[data-item="3"] h3').innerText(), /Batata cozida/i);
  await openFix(page, 3); await page.locator('[data-item="3"] [data-action="remove"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 3);

  step('auto: merge two items, then separate them again');
  await openFix(page, 1); await page.locator('[data-item="1"] select[data-action="merge"]').selectOption('2');
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 2);
  await openFix(page, 1); await page.locator('[data-item="1"] [data-action="separate"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 3);
  assert.match(await page.locator('[data-item="1"] h3').innerText(), /Bife/i);
  await seesItem(1, expect(ids1).est[1]);

  step('auto: split an item with one tap (carve a part out of the beans), then remove the part');
  await openFix(page, 0); await page.locator('[data-item="0"] [data-action="split"]').click(); await page.waitForSelector('#tap-hint');
  await tapAt(page, 280, 300);
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 4);
  await openFix(page, 3); await page.locator('[data-item="3"] [data-action="remove"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 3);
  const taps = await page.evaluate(() => window.__taps); assert.equal(taps.length, 2, 'only the two correction taps');

  step('auto: oil answer, totals, save with timings and corrections');
  await openAdjust(page); await page.getByText('Pouco', { exact: true }).click();
  // items were carved: recompute the expected pixel counts of the beans (rice disc minus the carved tap disc)
  const riceAuto = autoShape(SC.rice); const carved = draw((x, y) => riceAuto.data[y * W + x] && !((x - taps[1][0]) ** 2 + (y - taps[1][1]) ** 2 <= 3600));
  const counts2 = core.exclusiveCounts([carved, ...foodMasks.slice(1)]);
  const est2 = ids1.map((id, i) => core.estimateItem({ cls: cls(id), pixels: counts2[i], scale: scale260, oil: 'little', priors, calibration, lookup }));
  const tot2 = core.totals(est2);
  await page.waitForFunction((g) => document.getElementById('totals')?.innerText.includes(`Total do prato: ${g} g`), n0(tot2.grams));
  for (let i = 0; i < 3; i++) await seesItem(i, est2[i]);
  await shot('a05-corrected');
  await openAdjust(page); await page.selectOption('#meal-link', 'm20260908121000-abcd');
  await page.locator('#save').click(); await page.waitForSelector('text=Estimativa salva.');
  const rec = await page.evaluate(async () => { const db = await import('./db.mjs'); const e = (await db.getAll('estimates'))[0]; return { meal_id: e.meal_id, n: e.items.length, oil: e.oil, mode: e.mode, typical: e.plate_typical, plate_id: e.plate_id, timings: e.timings, corrections: e.corrections, photo: e.photo instanceof Blob, unc: e.scale.uncertainty, models: e.models?.segmenter }; });
  assert.equal(rec.meal_id, 'm20260908121000-abcd'); assert.equal(rec.n, 3); assert.equal(rec.oil, 'little'); assert.equal(rec.mode, 'auto'); assert.equal(rec.typical, false); assert.equal(rec.plate_id, 'prato-raso-branco');
  assert.equal(rec.timings.encoder_ms, 42); assert.ok(rec.timings.decodes > 0 && rec.timings.prompts > 0 && rec.timings.total_ms > 0 && rec.timings.detect_ms >= 0 && typeof rec.timings.decode_ms === 'number' && typeof rec.timings.classify_ms === 'number', JSON.stringify(rec.timings));
  assert.equal(rec.timings.status, 'ok'); assert.equal(rec.timings.timed_out, false);
  assert.ok(rec.corrections.rename >= 1 && rec.corrections.add === 1 && rec.corrections.remove >= 1 && rec.corrections.merge === 1 && rec.corrections.split >= 1, JSON.stringify(rec.corrections));
  assert.equal(rec.photo, true); assert.equal(rec.unc, priors.scale_uncertainty.value);
  assert.equal((await dbAll(page, 'estimates'))[0].calibration.label, 'Não calibrado'); assert.equal((await dbAll(page, 'checks')).length, 0, 'saving an estimate is not a scale check');
  assert.equal(await page.evaluate(async () => (await (await import('./db.mjs')).getSetting('estimate_draft')) ?? null), null, 'the draft is cleared after saving');

  step('auto: export predictions');
  await page.getByRole('link', { name: 'Estimativas salvas e exportar previsões' }).click();
  await page.waitForSelector('#export-preds');
  assert.match(await page.locator('[data-estimate]').innerText(), /Automático: .* s no total \(codificador 0,0 s, \d+ decodificações, \d+ correções\)/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-preds').click()]);
  const preds = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.deepEqual(validatePredictions(preds), []);
  assert.deepEqual(preds.meals[0].items.map((i) => i.label), ids1.map((id) => cls(id).pt)); assert.deepEqual(preds.meals[0].items.map((i) => i.grams), est2.map((e) => e.grams));

  step('auto: no plate found -> still no tap: a result with the honest note (typical-plate scale), foods found on the centre grid');
  await page.evaluate(() => { window.__noPlate = true; });
  await page.goto(`${base()}#/estimate/new`); await page.waitForSelector('text=Etapa 1 de 3: Foto');
  await page.evaluate(() => { window.__noPlate = true; window.__grids = []; });
  await upload(page, 3);
  await page.waitForSelector('h2:text-is("Resultado")');
  assert.match(await page.locator('#notice').innerText(), /Prato não detectado — escala aproximada/);
  assert.equal(await page.locator('text=Toque uma vez na borda do prato').count(), 0, 'never the rim tap');
  assert.equal(await page.locator('[data-item]').count(), 3, 'rice, meat and salad; not the table, the plate-sized mask, the fork or the unstable mask');
  const npGrids = await page.evaluate(() => window.__grids);
  assert.ok(npGrids.length === 2 && npGrids.every((g) => g.lowRes && g.lowRes.w === 384 && g.lowRes.h === 288), `masks asked at the mask_side size: ${JSON.stringify(npGrids)}`);
  await page.locator('#diag summary').click(); assert.match(await page.locator('#diag-text').innerText(), /"detected": false[\s\S]*"via": "synthetic"/);
  await shot('a06-no-plate-result');

  step('auto: the tab dies during the analysis -> the resume does NOT run it again (no crash loop): it offers a lighter retry, which works');
  await page.goto(`${base()}#/estimate/new`); await page.waitForSelector('text=Etapa 1 de 3: Foto');
  await page.evaluate(() => { window.__noPlate = false; window.__crashAt = 1; });
  await upload(page, 2);
  await page.waitForFunction(() => /Encontrando o prato/.test(document.getElementById('auto-label')?.textContent ?? ''));
  const mark = await page.evaluate(() => JSON.parse(localStorage.getItem('macrofy_run')));
  assert.equal(mark.stage, 'plate', 'the stage is written down before the heavy work');
  await page.goto('about:blank'); await page.goto(`${base()}#/estimate/resume`); // the tab dies; Safari reopens the page straight on the resume URL
  await page.waitForSelector('#crash'); await shot('a07-crash-guard');
  assert.equal(await page.evaluate(() => location.hash), '#/estimate', 'the resume URL is left before anything heavy runs');
  assert.match(await page.locator('#crash').innerText(), /procurando o prato/);
  assert.equal(await page.evaluate(() => (window.__grids ?? []).length), 0, 'nothing was decoded by the resume itself');
  assert.match(await page.locator('#diag-text').textContent(), /"last_crash": \{[\s\S]*"stage": "plate"/);
  await page.evaluate(() => { window.__grids = []; });
  await page.locator('#retry-lite').click(); await page.waitForSelector('h2:text-is("Resultado")');
  const lite = await page.evaluate(() => window.__grids);
  assert.ok(lite[0].n === 16 && lite.every((g) => g.lowRes.w === 256 && g.lowRes.h === 192), `lighter retry: 4x4 plate grid, 256 px masks: ${JSON.stringify(lite)}`);
  assert.equal(await page.evaluate(() => localStorage.getItem('macrofy_run')), null, 'a finished analysis leaves no crash mark');

  step('auto on the iPhone (sequential models): the SAM page ends, the page reloads, the naming page loads ONLY the naming model -> the result');
  await page.evaluate(() => { localStorage.setItem('__mockSequential', '1'); sessionStorage.setItem('__mockLog', '[]'); });
  await page.goto('about:blank'); await page.goto(`${base()}#/estimate/new`); await page.waitForSelector('text=Etapa 1 de 3: Foto');
  await upload(page, 2);
  await page.waitForSelector('h2:text-is("Resultado")'); await shot('a08-split-result');
  const pages = (await page.evaluate(() => sessionStorage.getItem('__mockLog'))).split('"page"');
  const log = JSON.parse(await page.evaluate(() => sessionStorage.getItem('__mockLog'))); const cut = log.lastIndexOf('page');
  const before = log.slice(0, cut); const after = log.slice(cut + 1);
  assert.ok(before.includes('load') && before.filter((e) => e === 'segmentPoints').length === 2 && !before.includes('classify') && !before.includes('loadNaming'), `SAM page: SAM and both grids, no naming: ${JSON.stringify(log)}`);
  assert.ok(before.at(-1) === 'releaseAll', `the SAM page frees the models and the GPU device just before the reload: ${JSON.stringify(before)}`);
  assert.ok(after[0] === 'loadNaming' && after[1] === 'backends [["webgpu","q4f16"]]' && !after.includes('load') && !after.includes('setImage') && !after.includes('segmentPoints') && after.filter((e) => e === 'classify').length === 4, `naming page: only the namer, 4 crops named: ${JSON.stringify(log)}`);
  assert.ok(pages.length >= 3, 'the page really reloaded between the halves');
  assert.equal(await page.evaluate(() => location.hash), '#/estimate', 'the naming URL is left before the naming model loads');
  assert.equal(await page.locator('[data-item]').count(), 3, 'rice, steak, salad; the fork rejected, as in one page');
  assert.match(await page.locator('[data-item="0"] h3').innerText(), /^Arroz/);
  assert.match(await page.locator('#totals').innerText(), /Total do prato: \d+ g/);
  assert.equal(await page.locator('#model-progress').count(), 0, 'no model card on the result: SAM is not loading in the naming page');
  assert.match(await page.locator('#diag-text').textContent(), /"split": true/);
  const dtext = await page.locator('#diag-text').textContent();
  assert.match(dtext, /"food_rows": \[[\s\S]*"kept 0"/, 'the Diagnóstico lists every food-grid mask with its verdict'); assert.match(dtext, /"naming_rows": \[/, 'and what the naming model said');
  assert.match(dtext, /"gpu_destroyed": true/, 'the SAM page released the GPU before the reload');
  assert.equal(await page.evaluate(() => localStorage.getItem('macrofy_run')), null, 'no crash mark left');

  step('auto on the iPhone: the naming page dies -> Safari reopens it and it goes straight on with the next backend plan (no tap, no SAM re-run)');
  await page.evaluate(() => { localStorage.setItem('__mockHangNaming', '1'); sessionStorage.setItem('__mockLog', '[]'); });
  await page.goto('about:blank'); await page.goto(`${base()}#/estimate/new`); await page.waitForSelector('text=Etapa 1 de 3: Foto');
  await upload(page, 2);
  await page.waitForFunction(() => /Carregando o modelo de nomes/.test(document.getElementById('auto-label')?.textContent ?? ''));
  assert.equal(await page.evaluate(() => location.hash), '#/estimate/name', 'the naming URL is kept while the namer loads (so a Safari reload comes back here)');
  const nmark = JSON.parse(await page.evaluate(() => localStorage.getItem('macrofy_run')));
  assert.ok(nmark.page === 'naming' && nmark.naming_plan === 0 && nmark.backends === 'webgpu/q4f16', JSON.stringify(nmark));
  await page.evaluate(() => sessionStorage.setItem('__mockLog', '[]'));
  await page.goto('about:blank'); await page.goto(`${base()}#/estimate/name`); // the tab dies; Safari reloads the same URL
  await page.waitForSelector('h2:text-is("Resultado")'); await shot('a09-naming-recovered');
  const log2 = JSON.parse(await page.evaluate(() => sessionStorage.getItem('__mockLog')));
  assert.ok(!log2.includes('segmentPoints') && !log2.includes('load') && log2.includes('backends [["wasm","q8"]]'), `next plan (the CPU), naming only: ${JSON.stringify(log2)}`);
  assert.equal(await page.evaluate(() => location.hash), '#/estimate');
  assert.match(await page.locator('#diag-text').textContent(), /"last_crash": \{[\s\S]*"backends": "webgpu\/q4f16"/);
  assert.equal(await page.locator('[data-item]').count(), 3);

  step('auto on the iPhone: every naming plan dies -> the crash card (bounded, no loop); its retry names again in a fresh page');
  await page.evaluate(() => { localStorage.setItem('__mockHangNaming', '2'); });
  await page.goto('about:blank'); await page.goto(`${base()}#/estimate/new`); await page.waitForSelector('text=Etapa 1 de 3: Foto');
  await upload(page, 2);
  await page.waitForFunction(() => /Carregando o modelo de nomes/.test(document.getElementById('auto-label')?.textContent ?? ''));
  await page.goto('about:blank'); await page.goto(`${base()}#/estimate/name`); // plan 0 died: Safari reloads, plan 1 starts and dies too
  await page.waitForFunction(() => /Carregando o modelo de nomes/.test(document.getElementById('auto-label')?.textContent ?? ''));
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('macrofy_run'))).naming_plan, 1);
  await page.goto('about:blank'); await page.goto(`${base()}#/estimate/name`);
  await page.waitForSelector('#crash'); await shot('a10-naming-crash-card');
  assert.match(await page.locator('#crash').innerText(), /carregando o modelo de nomes \(0\/4\) \(wasm\/q8\)/, 'the crash names the backends that died');
  assert.equal(await page.evaluate(() => location.hash), '#/estimate', 'the crash card leaves the naming URL (no reload loop)');
  await page.evaluate(() => sessionStorage.setItem('__mockLog', '[]'));
  await page.locator('#retry-naming').click(); await page.waitForSelector('h2:text-is("Resultado")');
  const log3 = JSON.parse(await page.evaluate(() => sessionStorage.getItem('__mockLog')));
  assert.ok(log3[0] === 'page' && !log3.includes('segmentPoints') && log3.includes('loadNaming'), `the retry reloads into a fresh naming page and names only: ${JSON.stringify(log3)}`);

  step('auto on the iPhone: a correction tap loads SAM then (and only then)');
  await openAdjust(page); await page.locator('#add-item').click();
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('__mockLog')).includes('load'));
  await page.evaluate(() => localStorage.removeItem('__mockSequential'));

  assert.deepEqual(problems, [], `page problems:\n${problems.join('\n')}`);
  await page.context().close();
  console.log('auto smoke: OK');
}

// ================================================================ MANUAL
async function manualScenario() {
  const { page, problems, shot } = await newPage(PLAN_MANUAL);
  await seed(page);
  const plate = shape(SC.plate); const TAPS = [[300, 300], [500, 320], [400, 430]];
  const expectedIds = ['arroz-branco-cozido', 'bife-grelhado', 'salada-mista-crua'];
  const disk = (cx, cy, r) => draw((x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);

  step('manual: home -> Ajustes / Corrigir -> Modo manual (Etapa 1 de 7)');
  await page.goto(`${base()}#/`);
  await page.locator('#settings-link').click(); await page.waitForSelector('text=Nada daqui é necessário'); await shot('m01-settings');
  await page.getByRole('link', { name: 'Modo manual (marcar com toques)' }).click();
  await page.waitForSelector('text=Etapa 1 de 7: Foto');
  await shot('m02-photo');
  await upload(page);
  await page.waitForSelector('text=Etapa 2 de 7: Prato');

  step('manual: plate (registered plate or the typical plate)');
  assert.deepEqual(await page.locator('#plate-select option').allInnerTexts(), ['Prato raso branco (260 mm)', 'Prato típico (26 cm, faixa mais larga)']);
  await page.selectOption('#plate-select', 'prato-raso-branco');
  await page.getByRole('button', { name: 'Próximo' }).click();
  await page.waitForSelector('text=Toque uma vez na borda do prato');

  step('manual: rim tap -> ellipse scale');
  await page.waitForFunction(() => !document.getElementById('model-progress'), null, { timeout: 5000 }); // models ready
  await tapAt(page, 400 + 320, 300);
  await page.waitForSelector('text=Escala:');
  const ell = core.scaleFromPlateMask(plate, 260);
  const rimText = await page.locator('.card', { hasText: 'Escala:' }).innerText();
  assert.match(rimText, new RegExp(`Escala: ${ell.mm_per_px.toFixed(2).replace('.', ',')} mm por pixel`), rimText);
  assert.match(rimText, new RegExp(`${Math.round(Math.acos(ell.cos_tilt) * 180 / Math.PI)}°`), rimText);
  await shot('m03-rim');
  await page.getByRole('button', { name: 'Confirmar o prato' }).click();

  step('manual: three food taps');
  await page.waitForSelector('text=Toque em cada alimento');
  for (let i = 0; i < TAPS.length; i++) {
    await tapAt(page, ...TAPS[i]);
    await page.waitForFunction((n) => [...document.querySelectorAll('strong')].filter((s) => /^Item \d/.test(s.textContent)).length === n, i + 1);
  }
  await shot('m04-foods');
  await page.getByRole('button', { name: 'Nomear os alimentos' }).click();

  step('manual: names: top-3, then "outro…"');
  await page.waitForSelector('[data-name="arroz-branco-cozido"]'); await page.waitForSelector('[data-name="bife-grelhado"]'); await page.waitForSelector('[data-name="batata-cozida"]');
  assert.equal(await page.locator('button[data-name]:not([data-name=other])').count(), 9, 'top-3 for each of the 3 items');
  await page.locator('[data-name="arroz-branco-cozido"]').click();
  await page.locator('[data-name="bife-grelhado"]').click();
  await page.locator('button[data-name="other"]').last().click();
  await page.getByPlaceholder('Buscar alimento (ex.: arroz, frango)…').fill('salada mista');
  await page.locator('.results button[data-name="salada-mista-crua"]').click();
  await shot('m05-names');
  await page.getByRole('button', { name: 'Próximo' }).click();

  step('manual: oil (levels come from priors.oil_levels)');
  await page.waitForSelector('text=Quanto óleo foi usado no preparo?');
  assert.deepEqual(await page.locator('.seg span').allInnerTexts(), priors.oil_levels.map((o) => o.label));
  await page.getByText('Pouco', { exact: true }).click();
  await page.getByRole('button', { name: 'Ver o resultado' }).click();

  step('manual: result matches the pure core on the same masks');
  await page.waitForSelector('#calstate');
  assert.equal((await page.locator('#calstate').innerText()).trim(), 'Não calibrado');
  const taps = (await page.evaluate(() => window.__taps)).slice(-3); // [rim tap, food, food, food] -> the last three are the foods
  const counts = core.exclusiveCounts(taps.map(([x, y]) => disk(x, y, 60)));
  const est = expectedIds.map((id, i) => core.estimateItem({ cls: cls(id), pixels: counts[i], scale: ell, oil: 'little', priors, calibration, lookup }));
  const tot = core.totals(est);
  const body = await page.locator('main').innerText();
  for (const e of est) { assert.match(body, new RegExp(`${Math.round(e.grams)} g`)); assert.match(body, new RegExp(`Faixa de 80%: ${Math.round(e.lo80)} a ${Math.round(e.hi80)} g`)); assert.match(body, new RegExp(`${Math.round(e.kcal)} kcal`)); }
  assert.match(await page.locator('#totals').innerText(), new RegExp(`Total do prato: ${Math.round(tot.grams)} g`));
  assert.ok(est[1].density_basis === 'solid_prior' && est[0].density_basis === 'served' && est[2].density_basis === 'pieces');
  console.log(`  items: ${est.map((e) => `${e.label} ${e.grams} g [${e.lo80}-${e.hi80}]`).join(' | ')}; total ${tot.grams} g ${tot.kcal} kcal`);
  await shot('m06-result');

  step('manual: link to the weighed meal, save');
  await page.locator('summary', { hasText: 'Ajustes / Corrigir' }).click(); await page.selectOption('#meal-link', 'm20260908121000-abcd');
  await page.locator('#save').click();
  await page.waitForSelector('text=Estimativa salva.');
  const rec = await page.evaluate(async () => { const db = await import('./db.mjs'); return (await db.getAll('estimates')).map((e) => ({ meal_id: e.meal_id, n: e.items.length, oil: e.oil, cal: e.items.every((i) => i.calibrated === false), photo: e.photo instanceof Blob, mode: e.mode, timings: e.timings })); });
  assert.deepEqual(rec, [{ meal_id: 'm20260908121000-abcd', n: 3, oil: 'little', cal: true, photo: true, mode: 'manual', timings: null }]);

  step('manual: export predictions');
  await page.getByRole('link', { name: 'Estimativas salvas e exportar previsões' }).click();
  await page.waitForSelector('#export-preds'); await shot('m07-estimates');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-preds').click()]);
  const preds = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.deepEqual(validatePredictions(preds), []);
  assert.equal(preds.schema, 'macrofy.predictions/1'); assert.equal(preds.meals[0].meal_id, 'm20260908121000-abcd');
  assert.deepEqual(preds.meals[0].items.map((i) => i.label), expectedIds.map((id) => cls(id).pt));
  assert.deepEqual(preds.meals[0].items.map((i) => i.grams), est.map((e) => e.grams));
  assert.equal(download.suggestedFilename(), 'predictions.json');

  step('manual: home lists the saved estimate');
  await page.goto(`${base()}#/`);
  await page.waitForSelector('text=Estimativas salvas (1)');

  assert.deepEqual(problems, [], `page problems:\n${problems.join('\n')}`);
  await page.context().close();
  console.log('manual smoke: OK');
}

try {
  await waitForServer();
  browser = await chromium.launch();
  await zeroScenario();
  await autoScenario();
  await manualScenario();
  console.log('estimate smoke: OK (zero setup, auto corrections and manual, no page errors)');
} catch (e) {
  failed = true; console.error(`estimate smoke: FAILED\n${e.stack || e}`);
  try { for (const c of browser?.contexts() ?? []) for (const p of c.pages()) { console.error(`page text:\n${(await p.locator('main').innerText()).slice(0, 900)}`); if (SHOTS) await p.screenshot({ path: join(SHOTS, 'failure.png'), fullPage: true }); } } catch { /* ignore */ }
} finally {
  await browser?.close(); server.kill();
}
process.exit(failed ? 1 : 0);
