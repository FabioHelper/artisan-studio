// Headless smoke of the estimate flow with a MOCKED model layer (no CDN or Hugging Face access needed).
//   node web/estimate/smoke.mjs            (run from macrofy/; needs the global playwright and python3)
// Serves web/ with python3 -m http.server, seeds a plate and a weighed meal, then walks: photo -> plate -> rim tap -> three
// food taps -> names (top-3 and "outro…") -> oil -> result -> link to the weighed meal -> save -> export predictions.
// The numbers on screen are compared with the pure core fed the same masks; the export is checked by the eval validator.
// Not a registered check (it needs a browser); the registered one is estimator-selftest. Set SMOKE_SHOTS=<dir> for screenshots.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from './core.mjs';
import { createLookup } from '../../nutrition/lookup-core.mjs';
import { VOCAB } from '../../nutrition/lookup.mjs';
import { validatePredictions } from '../../eval/metrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const { chromium } = createRequire(import.meta.url)(`${execSync('npm root -g').toString().trim()}/playwright`);
const PORT = 8700 + Math.floor(Math.random() * 200);
const SHOTS = process.env.SMOKE_SHOTS;
const W = 800; const H = 600;

// ---- the same masks the mock model layer returns, computed here to predict the numbers
const disk = (cx, cy, r) => { const d = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) d[y * W + x] = 1; return { width: W, height: H, data: d }; };
const plate = (() => { const d = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x - 400) / 330) ** 2 + ((y - 300) / 250) ** 2 <= 1) d[y * W + x] = 1; return { width: W, height: H, data: d }; })();
const TAPS = [[300, 300], [500, 320], [400, 430]];
const expectedIds = ['arroz-branco-cozido', 'bife-grelhado', 'salada-mista-crua'];

// ---- mock model layer, installed before the app loads
function installMock({ W, H }) {
  const mk = (fn) => { const d = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fn(x, y)) d[y * W + x] = 1; return d; };
  let classifyCalls = 0;
  const top = [['arroz branco cozido', 'feijão carioca cozido', 'macarrão cozido'], ['bife grelhado', 'frango grelhado', 'hambúrguer grelhado'], ['batata cozida', 'purê de batata', 'mandioca cozida']];
  window.__macrofyModels = {
    async load(onProgress) {
      for (const f of [0.2, 0.6, 1]) { onProgress({ stage: 'segmentation', label: 'Modelo de contorno (SAM)', fraction: f }); await new Promise((r) => setTimeout(r, 30)); }
      return { version: 'mock', backend: 'mock/none', segmenter: 'mock-sam', namer: 'mock-siglip', warnings: [] };
    },
    async setImage(blob) { if (!blob || !blob.size) throw new Error('mock: empty image'); },
    async segment(x, y) {
      x = Math.round(x); y = Math.round(y); (window.__taps ??= []).push([x, y]); // the smoke rebuilds the expected masks from the taps it really made
      if (Math.hypot(x - 400, y - 300) > 250) { // a tap on the rim: the plate, and a worse alternative
        return [{ width: W, height: H, data: mk((px, py) => ((px - 400) / 330) ** 2 + ((py - 300) / 250) ** 2 <= 1), score: 0.95 }, { width: W, height: H, data: mk((px, py) => ((px - 400) / 200) ** 2 + ((py - 300) / 150) ** 2 <= 1), score: 0.6 }];
      }
      return [{ width: W, height: H, data: mk((px, py) => (px - x) ** 2 + (py - y) ** 2 <= 3600), score: 0.9 }, { width: W, height: H, data: mk((px, py) => (px - x) ** 2 + (py - y) ** 2 <= 900), score: 0.5 }];
    },
    async classify(blob, prompts) {
      const want = top[classifyCalls++ % top.length];
      return prompts.map((p) => { const i = want.findIndex((n) => p === `uma foto de ${n}`); return { label: p, score: i < 0 ? 0.001 : 0.9 - i * 0.2 }; });
    },
  };
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}/app/`)).ok) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('http.server did not start');
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', WEB], { stdio: 'ignore' });
let browser; let failed = false;
try {
  await waitForServer();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(installMock, { W, H });
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };
  const step = (name) => console.log(`step ${name}`);

  // ---- seed: one plate (through the UI) and one weighed meal (straight into IndexedDB)
  await page.goto(`http://localhost:${PORT}/app/#/plates/new`);
  await page.getByPlaceholder('Ex.: Prato raso branco').fill('Prato raso branco');
  await page.getByPlaceholder('Ex.: 260').fill('260');
  await page.getByRole('button', { name: 'Salvar prato' }).click();
  await page.waitForSelector('text=Prato raso branco');
  await page.evaluate(async () => {
    const db = await import('./db.mjs');
    await db.put('meals', { id: 'm20260908121000-abcd', captured_at: '2026-09-08T12:10:00-03:00', split: 'test', plate_id: 'prato-raso-branco', photos: [], items: [{ id: 'i1', label: 'arroz branco cozido', grams: 150, state: 'cooked', method: 'boiled' }] });
  });

  // ---- home -> estimate
  step('home has an enabled Estimar');
  await page.goto(`http://localhost:${PORT}/app/#/`);
  const estimar = page.getByRole('link', { name: 'Estimar', exact: true });
  await estimar.waitFor(); await shot('01-home');
  await estimar.click();
  await page.waitForSelector('text=Etapa 1 de 7: Foto');

  step('photo');
  const png = await page.evaluate(({ W, H }) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#8b6b4a'; g.fillRect(0, 0, W, H); g.fillStyle = '#f4f4f4'; g.beginPath(); g.ellipse(400, 300, 330, 250, 0, 0, 7); g.fill();
    g.fillStyle = '#f4f1e6'; g.beginPath(); g.arc(300, 300, 60, 0, 7); g.fill(); g.fillStyle = '#4a2a1a'; g.beginPath(); g.arc(500, 320, 60, 0, 7); g.fill(); g.fillStyle = '#3f8a3a'; g.beginPath(); g.arc(400, 430, 60, 0, 7); g.fill();
    return c.toDataURL('image/png').split(',')[1];
  }, { W, H });
  await shot('02-photo');
  await page.locator('input[type=file]:not([capture])').setInputFiles({ name: 'prato.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForSelector('text=Etapa 2 de 7: Prato');

  step('plate');
  await page.selectOption('#plate-select', 'prato-raso-branco');
  await page.getByRole('button', { name: 'Próximo' }).click();
  await page.waitForSelector('text=Toque uma vez na borda do prato');

  const tapAt = async (x, y) => { const box = await page.locator('#stage').boundingBox(); await page.locator('#stage').click({ position: { x: x * box.width / W, y: y * box.height / H } }); };

  step('rim tap -> ellipse scale');
  await page.waitForFunction(() => !document.getElementById('model-progress'), null, { timeout: 5000 }); // models ready
  await tapAt(400 + 320, 300);
  await page.waitForSelector('text=Escala:');
  const ell = core.scaleFromPlateMask(plate, 260);
  const rimText = await page.locator('.card', { hasText: 'Escala:' }).innerText();
  assert.match(rimText, new RegExp(`Escala: ${ell.mm_per_px.toFixed(2).replace('.', ',')} mm por pixel`), rimText);
  assert.match(rimText, new RegExp(`${Math.round(Math.acos(ell.cos_tilt) * 180 / Math.PI)}°`), rimText);
  await shot('03-rim');
  await page.getByRole('button', { name: 'Confirmar o prato' }).click();

  step('three food taps');
  await page.waitForSelector('text=Toque em cada alimento');
  for (let i = 0; i < TAPS.length; i++) {
    await tapAt(...TAPS[i]);
    await page.waitForFunction((n) => [...document.querySelectorAll('strong')].filter((s) => /^Item \d/.test(s.textContent)).length === n, i + 1);
  }
  await shot('04-foods');
  await page.getByRole('button', { name: 'Nomear os alimentos' }).click();

  step('names: top-3, then "outro…"');
  await page.waitForSelector('[data-name="arroz-branco-cozido"]');
  await page.waitForSelector('[data-name="bife-grelhado"]');
  await page.waitForSelector('[data-name="batata-cozida"]');
  assert.equal(await page.locator('button[data-name]:not([data-name=other])').count(), 9, 'top-3 for each of the 3 items');
  await page.locator('[data-name="arroz-branco-cozido"]').click();
  await page.locator('[data-name="bife-grelhado"]').click();
  // third item: none of the 3 fits -> search
  await page.locator('button[data-name="other"]').last().click();
  await page.getByPlaceholder('Buscar alimento (ex.: arroz, frango)…').fill('salada mista');
  await page.locator('.results button[data-name="salada-mista-crua"]').click();
  await shot('05-names');
  await page.getByRole('button', { name: 'Próximo' }).click();

  step('oil');
  await page.waitForSelector('text=Quanto óleo foi usado no preparo?');
  await page.getByText('Pouco', { exact: true }).click();
  await page.getByRole('button', { name: 'Ver o resultado' }).click();

  step('result matches the pure core on the same masks');
  await page.waitForSelector('#uncal');
  assert.equal((await page.locator('#uncal').innerText()).trim(), 'Não calibrado — estimativa inicial');
  const [priors, calibration] = ['priors.json', 'calibration.json'].map((f) => JSON.parse(fs.readFileSync(join(HERE, f), 'utf8')));
  const taps = (await page.evaluate(() => window.__taps)).slice(-3); // [rim tap, food, food, food] -> the last three are the foods
  const lookup = createLookup(VOCAB); const counts = core.exclusiveCounts(taps.map(([x, y]) => disk(x, y, 60)));
  const est = expectedIds.map((id, i) => core.estimateItem({ cls: VOCAB.classes.find((c) => c.id === id), pixels: counts[i], scale: ell, oil: 'little', priors, calibration: core.loadCalibration(calibration), lookup }));
  const tot = core.totals(est);
  const body = await page.locator('main').innerText();
  for (const e of est) { assert.match(body, new RegExp(`${Math.round(e.grams)} g`)); assert.match(body, new RegExp(`Faixa de 80%: ${Math.round(e.lo80)} a ${Math.round(e.hi80)} g`)); assert.match(body, new RegExp(`${Math.round(e.kcal)} kcal`)); }
  assert.match(await page.locator('#totals').innerText(), new RegExp(`Total do prato: ${Math.round(tot.grams)} g`));
  assert.ok(est[1].density_basis === 'solid_prior' && est[0].density_basis === 'served' && est[2].density_basis === 'pieces');
  console.log(`  items: ${est.map((e) => `${e.label} ${e.grams} g [${e.lo80}-${e.hi80}]`).join(' | ')}; total ${tot.grams} g ${tot.kcal} kcal`);
  await shot('06-result');

  step('link to the weighed meal, save');
  await page.selectOption('#meal-link', 'm20260908121000-abcd');
  await page.locator('#save').click();
  await page.waitForSelector('text=Estimativa salva.');
  const rec = await page.evaluate(async () => { const db = await import('./db.mjs'); return (await db.getAll('estimates')).map((e) => ({ meal_id: e.meal_id, n: e.items.length, oil: e.oil, cal: e.items.every((i) => i.calibrated === false), photo: e.photo instanceof Blob })); });
  assert.deepEqual(rec, [{ meal_id: 'm20260908121000-abcd', n: 3, oil: 'little', cal: true, photo: true }]);

  step('export predictions');
  await page.getByRole('link', { name: 'Estimativas salvas e exportar previsões' }).click();
  await page.waitForSelector('#export-preds');
  await shot('07-estimates');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-preds').click()]);
  const preds = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.deepEqual(validatePredictions(preds), []);
  assert.equal(preds.schema, 'macrofy.predictions/1'); assert.equal(preds.meals[0].meal_id, 'm20260908121000-abcd');
  assert.deepEqual(preds.meals[0].items.map((i) => i.label), expectedIds.map((id) => VOCAB.classes.find((c) => c.id === id).pt));
  assert.deepEqual(preds.meals[0].items.map((i) => i.grams), est.map((e) => e.grams));
  assert.equal(download.suggestedFilename(), 'predictions.json');

  step('home lists the saved estimate');
  await page.goto(`http://localhost:${PORT}/app/#/`);
  await page.waitForSelector('text=Estimativas salvas (1)');

  assert.deepEqual(problems, [], `page problems:\n${problems.join('\n')}`);
  console.log('estimate smoke: OK (no page errors)');
} catch (e) {
  failed = true; console.error(`estimate smoke: FAILED\n${e.stack || e}`);
  try { const p = browser?.contexts()[0]?.pages()[0]; if (p) { console.error(`page text:\n${(await p.locator('main').innerText()).slice(0, 800)}`); if (SHOTS) await p.screenshot({ path: join(SHOTS, 'failure.png'), fullPage: true }); } } catch { /* ignore */ }
} finally {
  await browser?.close(); server.kill();
}
process.exit(failed ? 1 : 0);
