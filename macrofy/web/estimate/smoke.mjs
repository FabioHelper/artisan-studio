// Headless smoke of the estimate flows with a MOCKED model layer (no CDN or Hugging Face access needed).
//   node web/estimate/smoke.mjs            (run from macrofy/; needs the global playwright and python3)
// Serves web/ with python3 -m http.server and walks two scenarios, each in a fresh browser context:
//   AUTO (T-014, the default): photo -> progress ("Encontrando o prato…", "Encontrando os alimentos…") -> ONE confirmation screen with names, grams,
//     ranges and macros and zero taps -> corrections (rename, add by tap, remove, merge, separate, split) -> oil -> unknown-plate prior widens the range
//     -> save with timings -> export; then a reload mid-flow resumes from IndexedDB; then "no plate found" falls back to manual mode.
//   MANUAL (T-013, "Modo manual"): photo -> plate -> rim tap -> three food taps -> names (top-3 and "outro…") -> oil -> result -> link -> save -> export.
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
import { validatePredictions } from '../../eval/metrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const { chromium } = createRequire(import.meta.url)(`${execSync('npm root -g').toString().trim()}/playwright`);
const PORT = 8700 + Math.floor(Math.random() * 200);
const SHOTS = process.env.SMOKE_SHOTS;
const W = 800; const H = 600;
const [priors, calibrationJson] = ['priors.json', 'calibration.json'].map((f) => JSON.parse(fs.readFileSync(join(HERE, f), 'utf8')));
const calibration = core.loadCalibration(calibrationJson); const lookup = createLookup(VOCAB);
const cls = (id) => VOCAB.classes.find((c) => c.id === id);

// ---- the scene the mock model layer returns (specs are drawn in the browser; the same specs are drawn here to predict the numbers)
const draw = (fn) => { const d = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fn(x, y)) d[y * W + x] = 1; return { width: W, height: H, data: d }; };
const shape = (s) => draw(s.kind === 'disc' ? (x, y) => (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r : s.kind === 'ell' ? (x, y) => ((x - s.cx) / s.a) ** 2 + ((y - s.cy) / s.b) ** 2 <= 1 : (x, y) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1);
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
  const mk = (s) => {
    const d = new Uint8Array(W * H);
    const inside = s.kind === 'disc' ? (x, y) => (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r : s.kind === 'ell' ? (x, y) => ((x - s.cx) / s.a) ** 2 + ((y - s.cy) / s.b) ** 2 <= 1 : (x, y) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) d[y * W + x] = 1;
    return { width: W, height: H, data: d, score: s.score };
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let grid = 0;
  window.__classifyLog = [];
  window.__macrofyModels = {
    async load(onProgress) {
      for (const f of [0.2, 0.6, 1]) { onProgress({ stage: 'segmentation', label: 'Modelo de contorno (SAM)', fraction: f }); await sleep(30); }
      return { version: 'mock', backend: 'mock/none', segmenter: 'mock-sam', namer: 'mock-siglip', sequential: true, warnings: [] };
    },
    async setImage(blob) { if (!blob || !blob.size) throw new Error('mock: empty image'); grid = 0; return { encoder_ms: 42, cached: true }; },
    async segmentPoints(points, opts = {}) {
      const call = ++grid; window.__grids = (window.__grids ?? []).concat([{ n: points.length, batch: opts.batch, budgetMs: opts.budgetMs }]);
      for (let i = 0; i < points.length; i += opts.batch || 4) { await sleep(120); opts.onProgress?.({ done: Math.min(points.length, i + (opts.batch || 4)), total: points.length }); }
      const names = call === 1 ? (window.__noPlate ? ['table', 'rice', 'meat', 'fork', 'speck'] : ['table', 'plate', 'speck', 'rice']) : ['plate', 'rice', 'meat', 'salad', 'fork', 'unstable', 'table'];
      return { masks: names.map((n) => mk(SC[n])), decodes: Math.ceil(points.length / (opts.batch || 4)), done: points.length, ms: 300, timed_out: false };
    },
    async segment(x, y) {
      x = Math.round(x); y = Math.round(y); (window.__taps ??= []).push([x, y]); // the smoke rebuilds the expected masks from the taps it really made
      if (Math.hypot(x - 400, y - 300) > 250) { // a tap on the rim: the plate, and a worse alternative
        return [mk({ ...SC.plate, score: 0.95 }), { ...mk({ kind: 'ell', cx: 400, cy: 300, a: 200, b: 150 }), score: 0.6 }];
      }
      return [mk({ kind: 'disc', cx: x, cy: y, r: 60, score: 0.9 }), mk({ kind: 'disc', cx: x, cy: y, r: 30, score: 0.5 })];
    },
    async classify(blob, prompts) {
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
const photoPng = (page) => page.evaluate(({ W, H }) => {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#8b6b4a'; g.fillRect(0, 0, W, H); g.fillStyle = '#f4f4f4'; g.beginPath(); g.ellipse(400, 300, 330, 250, 0, 0, 7); g.fill();
  g.fillStyle = '#f4f1e6'; g.beginPath(); g.arc(300, 300, 70, 0, 7); g.fill(); g.fillStyle = '#4a2a1a'; g.beginPath(); g.arc(500, 320, 55, 0, 7); g.fill(); g.fillStyle = '#3f8a3a'; g.beginPath(); g.arc(400, 430, 45, 0, 7); g.fill();
  return c.toDataURL('image/png').split(',')[1];
}, { W, H });
const upload = async (page) => page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'prato.png', mimeType: 'image/png', buffer: Buffer.from(await photoPng(page), 'base64') });
const tapAt = async (page, x, y) => { const box = await page.locator('#stage').boundingBox(); await page.locator('#stage').click({ position: { x: x * box.width / W, y: y * box.height / H } }); };
const n0 = (x) => Math.round(x);

// ================================================================ AUTO
async function autoScenario() {
  const { page, problems, shot } = await newPage(PLAN_AUTO);
  await seed(page);
  const plateMask = shape(SC.plate); const foodMasks = [SC.rice, SC.meat, SC.salad].map(shape);
  const scale260 = core.scaleFromPlateMask(plateMask, 260);
  const counts = core.exclusiveCounts(foodMasks);
  const expect = (ids, { oil = 'normal', setup = auto.plateSetup(priors, { diameter_mm: 260 }), scale = scale260 } = {}) => {
    const est = ids.map((id, i) => core.estimateItem({ cls: cls(id), pixels: counts[i], scale, oil, priors: auto.priorsForPlate(priors, setup), calibration, lookup }));
    return { est, tot: core.totals(est) };
  };
  const seesItem = async (i, e) => { // waits: a plate or name change recomputes asynchronously
    const want = [`${n0(e.grams)} g`, `Faixa de 80%: ${n0(e.lo80)} a ${n0(e.hi80)} g`, `${n0(e.kcal)} kcal`];
    try { await page.waitForFunction(([idx, parts]) => { const t = document.querySelector(`[data-item="${idx}"]`)?.innerText ?? ''; return parts.every((x) => t.includes(x)); }, [i, want], { timeout: 4000 }); }
    catch { assert.fail(`item ${i}: expected ${want.join(' | ')}, got: ${(await page.locator(`[data-item="${i}"]`).innerText()).replace(/\n+/g, ' ')}`); }
  };

  step('auto: home -> Estimar opens the automatic flow (Etapa 1 de 3) with a Modo manual button');
  await page.goto(`${base()}#/`);
  const estimar = page.getByRole('link', { name: 'Estimar', exact: true }); await estimar.waitFor(); await estimar.click();
  await page.waitForSelector('text=Etapa 1 de 3: Foto');
  await page.locator('#mode-toggle', { hasText: 'Modo manual' }).waitFor();
  await shot('a01-photo');

  step('auto: photo -> progress ("Encontrando o prato…", "Encontrando os alimentos…") -> confirmation with zero taps');
  await upload(page);
  await page.waitForFunction(() => /Encontrando o prato/.test(document.getElementById('auto-label')?.textContent ?? ''));
  await page.waitForFunction(() => /Encontrando os alimentos/.test(document.getElementById('auto-label')?.textContent ?? ''));
  await shot('a02-progress');
  await page.waitForSelector('text=Confira o prato');
  await page.waitForSelector('text=Etapa 3 de 3: Conferir');
  assert.equal(await page.evaluate(() => (window.__taps ?? []).length), 0, 'auto mode must not need a tap');
  assert.equal(await page.locator('[data-item]').count(), 3, 'rice, steak, salad; the fork is rejected as non-food');
  const grids = await page.evaluate(() => window.__grids);
  assert.equal(grids.length, 2); assert.equal(grids[0].n, priors.autoseg.plate_grid_n.value ** 2); assert.equal(grids[0].batch, priors.autoseg.decode_batch.value); assert.ok(grids[0].budgetMs <= priors.autoseg.time_budget_ms.value);
  assert.ok(grids[1].n > 0 && grids[1].n < priors.autoseg.food_grid_n.value ** 2, 'the foods grid is only inside the plate ellipse');
  const ids0 = ['arroz-branco-cozido', 'bife-grelhado', 'salada-mista-crua'];
  const base0 = expect(ids0);
  for (let i = 0; i < 3; i++) { assert.match(await page.locator(`[data-item="${i}"] h3`).innerText(), new RegExp(`^${VOCAB.classes.find((c) => c.id === ids0[i]).pt.slice(0, 6)}`, 'i')); await seesItem(i, base0.est[i]); }
  assert.match(await page.locator('#totals').innerText(), new RegExp(`Total do prato: ${n0(base0.tot.grams)} g`));
  assert.equal((await page.locator('#uncal').innerText()).trim(), 'Não calibrado — estimativa inicial');
  assert.equal(await page.locator('#plate-select').inputValue(), 'prato-raso-branco', 'the only registered plate is the default');
  await shot('a03-confirm');

  step('auto: reload mid-flow -> the estimate resumes from IndexedDB');
  await page.reload(); await page.waitForSelector('#resume'); await shot('a04-resume');
  await page.locator('#resume').click(); await page.waitForSelector('text=Confira o prato');
  assert.equal(await page.locator('[data-item]').count(), 3); await seesItem(0, base0.est[0]);
  assert.match(await page.locator('#notice').innerText(), /Retomei/);
  await page.evaluate(() => { window.__classifyIdx = 4; }); // the mock restarted with the page: continue its answers after the four crops

  step('auto: an unknown plate uses the "prato típico" prior and a wider range');
  await page.selectOption('#plate-select', '__typical__');
  await page.waitForSelector('text=Prato típico: escala aproximada');
  const typ = expect(ids0, { setup: auto.plateSetup(priors, null), scale: core.scaleFromPlateMask(plateMask, priors.typical_plate.diameter_mm) });
  await seesItem(0, typ.est[0]);
  assert.ok(typ.est[0].hi80 - typ.est[0].lo80 > base0.est[0].hi80 - base0.est[0].lo80 || typ.est[0].sigma_scale > base0.est[0].sigma_scale);
  assert.ok(typ.est[0].sigma_scale > base0.est[0].sigma_scale, 'wider scale uncertainty');
  await page.selectOption('#plate-select', 'prato-raso-branco'); await seesItem(0, base0.est[0]);

  step('auto: correct a name (rice -> beans)');
  await page.locator('[data-item="0"] [data-action="rename"]').click();
  await page.locator('[data-item="0"] [data-name="feijao-carioca-cozido"]').click();
  const ids1 = ['feijao-carioca-cozido', 'bife-grelhado', 'salada-mista-crua'];
  await seesItem(0, expect(ids1).est[0]);

  step('auto: add a missed item by tap, then remove it');
  await page.locator('#add-item').click(); await page.waitForSelector('#tap-hint');
  await tapAt(page, 600, 200);
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 4);
  assert.match(await page.locator('[data-item="3"] h3').innerText(), /Batata cozida/i);
  await page.locator('[data-item="3"] [data-action="remove"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 3);

  step('auto: merge two items, then separate them again');
  await page.locator('[data-item="1"] select[data-action="merge"]').selectOption('2');
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 2);
  await page.locator('[data-item="1"] [data-action="separate"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 3);
  assert.match(await page.locator('[data-item="1"] h3').innerText(), /Bife/i);
  await seesItem(1, expect(ids1).est[1]);

  step('auto: split an item with one tap (carve a part out of the beans), then remove the part');
  await page.locator('[data-item="0"] [data-action="split"]').click(); await page.waitForSelector('#tap-hint');
  await tapAt(page, 280, 300);
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 4);
  await page.locator('[data-item="3"] [data-action="remove"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-item]').length === 3);
  const taps = await page.evaluate(() => window.__taps); assert.equal(taps.length, 2, 'only the two correction taps');

  step('auto: oil answer, totals, save with timings and corrections');
  await page.getByText('Pouco', { exact: true }).click();
  // items were carved: recompute the expected pixel counts of the beans (rice disc minus the carved tap disc)
  const carved = draw((x, y) => ((x - 300) ** 2 + (y - 300) ** 2 <= 4900) && !((x - taps[1][0]) ** 2 + (y - taps[1][1]) ** 2 <= 3600));
  const counts2 = core.exclusiveCounts([carved, ...foodMasks.slice(1)]);
  const est2 = ids1.map((id, i) => core.estimateItem({ cls: cls(id), pixels: counts2[i], scale: scale260, oil: 'little', priors, calibration, lookup }));
  const tot2 = core.totals(est2);
  await page.waitForFunction((g) => document.getElementById('totals')?.innerText.includes(`Total do prato: ${g} g`), n0(tot2.grams));
  for (let i = 0; i < 3; i++) await seesItem(i, est2[i]);
  await shot('a05-corrected');
  await page.selectOption('#meal-link', 'm20260908121000-abcd');
  await page.locator('#save').click(); await page.waitForSelector('text=Estimativa salva.');
  const rec = await page.evaluate(async () => { const db = await import('./db.mjs'); const e = (await db.getAll('estimates'))[0]; return { meal_id: e.meal_id, n: e.items.length, oil: e.oil, mode: e.mode, typical: e.plate_typical, plate_id: e.plate_id, timings: e.timings, corrections: e.corrections, photo: e.photo instanceof Blob, unc: e.scale.uncertainty, models: e.models?.segmenter }; });
  assert.equal(rec.meal_id, 'm20260908121000-abcd'); assert.equal(rec.n, 3); assert.equal(rec.oil, 'little'); assert.equal(rec.mode, 'auto'); assert.equal(rec.typical, false); assert.equal(rec.plate_id, 'prato-raso-branco');
  assert.equal(rec.timings.encoder_ms, 42); assert.ok(rec.timings.decodes > 0 && rec.timings.prompts > 0 && rec.timings.total_ms > 0 && rec.timings.detect_ms >= 0 && typeof rec.timings.decode_ms === 'number' && typeof rec.timings.classify_ms === 'number', JSON.stringify(rec.timings));
  assert.equal(rec.timings.status, 'ok'); assert.equal(rec.timings.timed_out, false);
  assert.ok(rec.corrections.rename >= 1 && rec.corrections.add === 1 && rec.corrections.remove >= 1 && rec.corrections.merge === 1 && rec.corrections.split >= 1, JSON.stringify(rec.corrections));
  assert.equal(rec.photo, true); assert.equal(rec.unc, priors.scale_uncertainty.value);
  assert.equal(await page.evaluate(async () => (await (await import('./db.mjs')).getSetting('estimate_draft')) ?? null), null, 'the draft is cleared after saving');

  step('auto: export predictions');
  await page.getByRole('link', { name: 'Estimativas salvas e exportar previsões' }).click();
  await page.waitForSelector('#export-preds');
  assert.match(await page.locator('[data-estimate]').innerText(), /Automático: .* s no total \(codificador 0,0 s, \d+ decodificações, \d+ correções\)/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-preds').click()]);
  const preds = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.deepEqual(validatePredictions(preds), []);
  assert.deepEqual(preds.meals[0].items.map((i) => i.label), ids1.map((id) => cls(id).pt)); assert.deepEqual(preds.meals[0].items.map((i) => i.grams), est2.map((e) => e.grams));

  step('auto: no plate found -> message and the manual flow (rim tap)');
  await page.evaluate(() => { window.__noPlate = true; });
  await page.goto(`${base()}#/estimate/new`); await page.waitForSelector('text=Etapa 1 de 3: Foto');
  await page.evaluate(() => { window.__noPlate = true; });
  await upload(page);
  await page.waitForSelector('#notice');
  assert.match(await page.locator('#notice').innerText(), /Não encontrei o prato automaticamente/);
  await page.waitForSelector('text=Toque uma vez na borda do prato'); await page.waitForSelector('text=Etapa 3 de 7: Borda');
  await page.waitForFunction(() => !document.getElementById('model-progress'), null, { timeout: 5000 });
  await tapAt(page, 400 + 320, 300); await page.waitForSelector('text=Escala:'); await shot('a06-fallback-manual');

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

  step('manual: home -> Estimar -> Modo manual (Etapa 1 de 7)');
  await page.goto(`${base()}#/`);
  const estimar = page.getByRole('link', { name: 'Estimar', exact: true }); await estimar.waitFor(); await shot('m01-home'); await estimar.click();
  await page.waitForSelector('text=Etapa 1 de 3: Foto');
  await page.locator('#mode-toggle').click();
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
  await page.waitForSelector('#uncal');
  assert.equal((await page.locator('#uncal').innerText()).trim(), 'Não calibrado — estimativa inicial');
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
  await page.selectOption('#meal-link', 'm20260908121000-abcd');
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
  await autoScenario();
  await manualScenario();
  console.log('estimate smoke: OK (auto and manual, no page errors)');
} catch (e) {
  failed = true; console.error(`estimate smoke: FAILED\n${e.stack || e}`);
  try { for (const c of browser?.contexts() ?? []) for (const p of c.pages()) { console.error(`page text:\n${(await p.locator('main').innerText()).slice(0, 900)}`); if (SHOTS) await p.screenshot({ path: join(SHOTS, 'failure.png'), fullPage: true }); } } catch { /* ignore */ }
} finally {
  await browser?.close(); server.kill();
}
process.exit(failed ? 1 : 0);
