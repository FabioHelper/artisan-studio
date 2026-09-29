// Check `web-selftest`: node web/selftest.mjs (built-ins only; run from macrofy/).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = dirname(fileURLToPath(import.meta.url));
const f = (p) => join(web, p);
const text = (p) => readFileSync(f(p), 'utf8');
let n = 0;
const t = (name, fn) => { const done = () => { n++; console.log(`ok  ${name}`); }; const r = fn(); return r && typeof r.then === 'function' ? r.then(done) : done(); };

const files = ['index.html', 'feasibility/index.html', 'feasibility/run.mjs', 'feasibility/candidates.mjs', 'feasibility/verdict.mjs', 'lib/models.mjs'];
t('feasibility files exist', () => files.forEach((p) => assert.ok(existsSync(f(p)), `missing web/${p}`)));
t('landing page links to the feasibility page', () => assert.match(text('index.html'), /href="feasibility\/"/));
t('feasibility page loads run.mjs and is pt-BR', () => {
  const html = text('feasibility/index.html');
  assert.match(html, /<html lang="pt-BR">/); assert.match(html, /src="\.\/run\.mjs"/); assert.match(html, /Copiar resultados/);
});
t('JS modules parse (node --check)', () => files.filter((p) => p.endsWith('.mjs'))
  .forEach((p) => execFileSync(process.execPath, ['--check', f(p)], { stdio: 'pipe' })));

const cand = await import(pathToFileURL(f('feasibility/candidates.mjs')));
const { computeVerdict, buildResults, median } = await import(pathToFileURL(f('feasibility/verdict.mjs')));

const models = await import(pathToFileURL(f('lib/models.mjs')));
t('transformers.js versions are exact and ordered: 4.3.0 first, 3.8.1 as the fallback', () => {
  assert.deepEqual(models.TRANSFORMERS_VERSIONS, ['4.3.0', '3.8.1']);
  assert.equal(models.transformersUrl('4.3.0'), 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0');
  assert.deepEqual(cand.TRANSFORMERS_VERSIONS, models.TRANSFORMERS_VERSIONS);
});
t('no unpinned CDN import anywhere in the page code', () => files.forEach((p) => {
  for (const m of text(p).matchAll(/@huggingface\/transformers(?!@(\d+\.\d+\.\d+|\$\{version\}))/g)) assert.fail(`unpinned reference in web/${p} at ${m.index}`);
}));
t('run.mjs takes the library and the model loader from the shared lib/models.mjs', () => {
  const js = text('feasibility/run.mjs');
  assert.match(js, /from '\.\.\/lib\/models\.mjs'/); assert.match(js, /importTransformers\(\)/); assert.match(js, /loadCandidate\(/);
  assert.doesNotMatch(js, /import\(TRANSFORMERS_URL\)/);
});
t('the feasibility stages share the app candidates (segmentation and naming) and keep their results format', () => {
  assert.equal(cand.STAGES.find((s) => s.stage === 'segmentation').candidates, models.SEGMENT_CANDIDATES);
  assert.equal(cand.STAGES.find((s) => s.stage === 'naming').candidates, models.NAMING_CANDIDATES);
  assert.deepEqual(models.SEGMENT_CANDIDATES.map((c) => c.id), ['onnx-community/sam2.1-hiera-tiny-ONNX', 'Xenova/slimsam-77-uniform']);
  assert.deepEqual(models.NAMING_CANDIDATES.map((c) => c.id), ['onnx-community/siglip2-base-patch16-224-ONNX', 'Xenova/siglip-base-patch16-224']);
  assert.deepEqual(models.BACKENDS[0], ['webgpu', 'fp16']); assert.deepEqual(models.BACKENDS.at(-1), ['wasm', 'q8']);
});
t('every stage has a non-empty candidate list, with a fallback', () => {
  assert.deepEqual(cand.STAGES.map((s) => s.stage), ['depth', 'segmentation', 'naming']);
  for (const s of cand.STAGES) { assert.ok(s.candidates.length >= 2, s.stage); s.candidates.forEach((c) => assert.ok(c.id && (c.task || c.sam))); }
  assert.ok(cand.LABELS.length >= 10 && cand.BACKENDS.length > 0);
});

const ok = (ms) => ({ ok: true, infer_ms_median: ms });
t('median', () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null); });
t('verdict: go when all loaded and total <= 2000 (boundary inclusive)', () => {
  assert.deepEqual(computeVerdict([ok(500), ok(700), ok(800)]), { total_infer_ms: 2000, verdict: 'go' });
  assert.equal(computeVerdict([ok(100), ok(100), ok(100)]).verdict, 'go');
});
t('verdict: no-go when too slow, a stage failed, or stages are missing', () => {
  assert.equal(computeVerdict([ok(900), ok(900), ok(201)]).verdict, 'no-go');
  assert.equal(computeVerdict([ok(1), ok(1), { ok: false, infer_ms_median: null }]).verdict, 'no-go');
  assert.equal(computeVerdict([ok(1), ok(1)]).verdict, 'no-go');
  assert.equal(computeVerdict([]).verdict, 'no-go');
});
t('results object carries schema, verdict and tab survival', () => {
  const r = buildResults({ ua: 'x', webgpu: true, stages: [ok(1), ok(1), ok(1)] });
  assert.equal(r.schema, 'macrofy.feasibility/1'); assert.equal(r.verdict, 'go'); assert.equal(r.tab_survived, true);
  const c = buildResults({ ua: 'x', webgpu: false, stages: [ok(1)], crashedStage: 'segmentation' });
  assert.equal(c.tab_survived, false); assert.equal(c.crashed_stage, 'segmentation'); assert.equal(c.verdict, 'no-go');
});

// ---------------------------------------------------------------- shared model layer with a fake transformers.js (no network here)
const fakeLib = () => {
  const calls = { sam: [] };
  class RawImage { constructor(data, width, height, channels) { Object.assign(this, { data, width, height, channels }); } static async fromBlob() { return new RawImage(new Uint8ClampedArray(12), 2, 2, 3); } }
  const proc = async () => ({ original_sizes: [[2, 2]], reshaped_input_sizes: [[2, 2]] });
  proc.post_process_masks = async () => [{ dims: [1, 3, 2, 2], data: new Uint8Array([1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0]) }]; // three 2x2 masks
  const model = async (inputs) => { calls.sam.push(inputs); return { pred_masks: {}, iou_scores: { data: [0.2, 0.9, 0.5] } }; };
  model.dispose = async () => {};
  const T = { env: {}, RawImage,
    async pipeline() { const p = async (img, labels) => labels.map((label, i) => ({ label, score: 1 / (i + 1) })); p.dispose = async () => {}; return p; },
    Sam2Model: { from_pretrained: async () => model }, AutoProcessor: { from_pretrained: async () => proc } };
  return { T, calls };
};
await t('importTransformers: 4.3.0 first; 3.8.1 only when that import fails; both failing is an error', async () => {
  const seen = []; const fake = fakeLib();
  let r = await models.importTransformers({ importer: async (u) => { seen.push(u); return fake.T; } });
  assert.equal(r.version, '4.3.0'); assert.equal(seen.length, 1); assert.equal(fake.T.env.allowLocalModels, false); assert.equal(fake.T.env.useBrowserCache, true);
  seen.length = 0;
  r = await models.importTransformers({ importer: async (u) => { seen.push(u); if (u.endsWith('@4.3.0')) throw new Error('404'); return fake.T; } });
  assert.equal(r.version, '3.8.1'); assert.deepEqual(seen.map((u) => u.split('@').pop()), ['4.3.0', '3.8.1']); assert.match(r.errors[0], /^4\.3\.0: 404/);
  await assert.rejects(models.importTransformers({ importer: async () => { throw new Error('offline'); } }), /offline/);
});
await t('createModels: loads SAM2 then SigLIP, reports progress, segments best-score first, ranks prompts', async () => {
  const { T, calls } = fakeLib(); const events = [];
  const m = models.createModels({ importer: async () => ({ ...T, pipeline: async (task, id, opts) => { opts.progress_callback({ status: 'progress', file: 'a.onnx', loaded: 50, total: 100 }); return T.pipeline(task, id); } }) });
  const info = await m.load((e) => events.push(e));
  assert.equal(info.version, '4.3.0'); assert.equal(info.segmenter, 'onnx-community/sam2.1-hiera-tiny-ONNX'); assert.equal(info.namer, 'onnx-community/siglip2-base-patch16-224-ONNX');
  assert.equal(info.backend, 'wasm/q8'); // Node has no WebGPU
  assert.ok(events.some((e) => e.stage === 'naming' && e.fraction === 0.5));
  await m.setImage(new Blob(['x']));
  const masks = await m.segment(1, 1);
  assert.deepEqual(masks.map((x) => x.score), [0.9, 0.5, 0.2]); assert.deepEqual([...masks[0].data], [1, 1, 0, 0]); assert.equal(masks[0].width, 2);
  const ranked = await m.classify(new Blob(['x']), ['uma foto de a', 'uma foto de b']);
  assert.deepEqual(ranked, [{ label: 'uma foto de a', score: 1 }, { label: 'uma foto de b', score: 0.5 }]);
  assert.ok(calls.sam.length >= 2);
});
await t('createModels: falls back to SlimSAM when SAM2 is missing, and reports the failures when nothing loads', async () => {
  const { T } = fakeLib();
  const info = await models.createModels({ importer: async () => ({ ...T, Sam2Model: undefined, SamModel: T.Sam2Model }) }).load();
  assert.equal(info.segmenter, 'Xenova/slimsam-77-uniform'); assert.ok(info.warnings.some((w) => /Sam2Model indisponível/.test(w)));
  await assert.rejects(models.createModels({ importer: async () => ({ ...T, Sam2Model: undefined }) }).load(), /nenhum modelo carregou/);
});

// ---------------------------------------------------------------- capture app (web/app)
const { staleCopies, COPIES } = await import(pathToFileURL(f('sync-data.mjs')));
const appFiles = ['index.html', 'app.css', 'app.mjs', 'lib.mjs', 'db.mjs', 'estimate.mjs', 'sw.js', 'manifest.webmanifest', 'vendor/schema-core.mjs', 'vendor/lookup-core.mjs', 'vendor/estimate-core.mjs', 'vendor/models.mjs', 'data/vocab.json', 'data/priors.json', 'data/calibration.json', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
t('capture app files exist', () => appFiles.forEach((p) => assert.ok(existsSync(f(`app/${p}`)), `missing web/app/${p}`)));
t('DRIFT: web/app copies equal their sources (else run node web/sync-data.mjs)', () => {
  const stale = staleCopies();
  assert.deepEqual(stale.map((c) => c.to), [], `stale copies: ${stale.map((c) => c.to).join(', ')}. Run: node web/sync-data.mjs`);
  for (const to of ['web/app/vendor/lookup-core.mjs', 'web/app/vendor/estimate-core.mjs', 'web/app/vendor/models.mjs', 'web/app/data/priors.json', 'web/app/data/calibration.json']) assert.ok(COPIES.some((c) => c.to === to), `sync-data.mjs does not copy ${to}`);
});
t('the drift check really fails on a stale copy', () => {
  const copy = COPIES.find((c) => c.to.endsWith('vocab.json')); const p = f(copy.to.replace(/^web\//, ''));
  const good = readFileSync(p);
  try { writeFileSync(p, Buffer.concat([good, Buffer.from(' ')])); assert.deepEqual(staleCopies().map((c) => c.to), [copy.to]); }
  finally { writeFileSync(p, good); }
  assert.deepEqual(staleCopies(), []);
});
t('the drift check also catches a stale estimation core and priors', () => {
  for (const to of ['web/app/vendor/estimate-core.mjs', 'web/app/data/priors.json']) {
    const p = f(to.replace(/^web\//, '')); const good = readFileSync(p);
    try { writeFileSync(p, Buffer.concat([good, Buffer.from(' ')])); assert.deepEqual(staleCopies().map((c) => c.to), [to]); } finally { writeFileSync(p, good); }
  }
  assert.deepEqual(staleCopies(), []);
});
t('app JS modules parse (node --check)', () => appFiles.filter((p) => /\.(mjs|js)$/.test(p))
  .forEach((p) => execFileSync(process.execPath, ['--check', f(`app/${p}`)], { stdio: 'pipe' })));
t('app page is pt-BR, links the manifest, icon and module', () => {
  const html = text('app/index.html');
  assert.match(html, /<html lang="pt-BR">/); assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /apple-touch-icon/); assert.match(html, /src="app\.mjs"/);
});
t('web manifest: name Macrofy, standalone, relative scope, PNG icons that exist', () => {
  const m = JSON.parse(text('app/manifest.webmanifest'));
  assert.equal(m.name, 'Macrofy'); assert.equal(m.display, 'standalone'); assert.equal(m.start_url, './'); assert.equal(m.scope, './');
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  for (const i of m.icons) { assert.ok(existsSync(f(`app/${i.src}`)), i.src); assert.equal(readFileSync(f(`app/${i.src}`)).subarray(1, 4).toString(), 'PNG'); }
});
t('service worker shell lists every app file (except itself) so offline use is complete', () => {
  const sw = text('app/sw.js'); const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(shell.includes('./'));
  for (const p of appFiles.filter((x) => x !== 'sw.js')) assert.ok(shell.includes(p), `sw.js SHELL is missing ${p}`);
  for (const p of shell.filter((x) => x !== './')) assert.ok(existsSync(f(`app/${p}`)), `sw.js SHELL names missing ${p}`);
});
t('app code has no absolute URLs or root-relative paths (it is served under /artisan-studio/app/)', () => {
  for (const p of ['app.mjs', 'lib.mjs', 'db.mjs', 'estimate.mjs', 'sw.js', 'index.html', 'manifest.webmanifest']) {
    assert.doesNotMatch(text(`app/${p}`).replace(/xmlns="[^"]*"/g, ''), /(?:src|href|fetch\(|register\(|from )\s*=?\s*['"]\/[^/]/, `root-relative URL in web/app/${p}`);
  }
});
t('app has the home actions and the required file input', () => {
  const js = text('app/app.mjs');
  assert.match(js, /Pesar refeição/); assert.match(js, /href: '#\/estimate\/new'/); assert.doesNotMatch(js, /Estimar \(em breve\)/); assert.match(js, /capture: 'environment'/); assert.match(js, /accept: 'image\/\*'/);
  assert.match(js, /navigator\.storage\?\.persist/); assert.match(js, /Adicionar à Tela de Início/); assert.match(js, /navigator\.share/);
});
t('every relative import of the app modules resolves to a file that is also in the service worker shell', () => {
  const sw = text('app/sw.js');
  for (const p of appFiles.filter((x) => /^[\w-]+\.mjs$/.test(x))) {
    for (const m of text(`app/${p}`).matchAll(/(?:from |import\()\s*'(\.\/[^']+)'/g)) { const rel = m[1].slice(2); assert.ok(existsSync(f(`app/${rel}`)), `${p} imports missing ${rel}`); assert.ok(sw.includes(`'${rel}'`), `${rel} is not in the sw.js shell`); }
  }
});
t('estimate screens: pt-BR flow, uncalibrated badge, oil question, predictions export, injectable models', () => {
  const js = text('app/estimate.mjs');
  for (const re of [/Toque uma vez na borda do prato/, /Toque em cada alimento/, /outro…/, /OIL_LEVELS/, /Não calibrado — estimativa inicial/, /Exportar previsões/, /Salvar estimativa/, /__macrofyModels/, /namePrompts/, /toPredictions/, /Esta refeição também foi pesada\?/]) assert.match(js, re);
});
t('estimation files exist and the estimate selftest is registered', () => {
  for (const p of ['estimate/core.mjs', 'estimate/priors.json', 'estimate/calibration.json', 'estimate/selftest.mjs']) assert.ok(existsSync(f(p)), `missing web/${p}`);
  const checks = JSON.parse(readFileSync(join(web, '..', 'control', 'checks.json'), 'utf8')).checks;
  assert.deepEqual(checks.find((c) => c.id === 'estimator-selftest')?.cmd, ['node', 'web/estimate/selftest.mjs']);
});
t('landing page links to the capture app', () => assert.match(text('index.html'), /href="app\/"/));

console.log(`web selftest: ${n} checks passed`);
