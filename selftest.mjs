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
const verdict = await import(pathToFileURL(f('feasibility/verdict.mjs')));
const { computeVerdict, buildResults, median } = verdict;

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
  assert.deepEqual(models.SEGMENT_CANDIDATES.map((c) => c.id), ['Xenova/slimsam-77-uniform', 'onnx-community/sam2.1-hiera-tiny-ONNX']); // smallest first (F-005)
  assert.deepEqual(models.NAMING_CANDIDATES.map((c) => c.id), ['onnx-community/siglip2-base-patch16-224-ONNX', 'Xenova/siglip-base-patch16-224']);
  assert.deepEqual(models.BACKENDS[0], ['webgpu', 'fp16']); assert.deepEqual(models.BACKENDS.at(-1), ['wasm', 'q8']);
});
t('memory discipline for iOS (F-005): SlimSAM q8 first, then SAM 2.1 tiny q8/fp16, never fp32 anywhere', () => {
  assert.deepEqual(models.SEGMENT_CANDIDATES[0].backends, [['webgpu', 'q8'], ['wasm', 'q8']]);
  assert.deepEqual(models.SEGMENT_CANDIDATES[1].backends.map((b) => b[1]).sort(), ['fp16', 'q8', 'q8']);
  for (const c of [...models.SEGMENT_CANDIDATES, ...models.NAMING_CANDIDATES]) for (const [, dtype] of models.backendsOf(c)) assert.ok(['q8', 'fp16'].includes(dtype), `${c.id}: ${dtype}`);
  assert.equal(models.backendsOf(models.NAMING_CANDIDATES[0]), models.BACKENDS);
  assert.doesNotMatch(text('lib/models.mjs') + text('feasibility/run.mjs'), /['"]fp32['"]/);
});
t('every stage has a non-empty candidate list, with a fallback; the estimator stages run first, depth last', () => {
  assert.deepEqual(cand.STAGES.map((s) => s.stage), ['segmentation', 'naming', 'depth']);
  for (const s of cand.STAGES) { assert.ok(s.candidates.length >= 2, s.stage); s.candidates.forEach((c) => assert.ok(c.id && (c.task || c.sam))); }
  assert.ok(cand.LABELS.length >= 10 && cand.BACKENDS.length > 0);
});

const ok = (ms, stage = 'x') => ({ stage, ok: true, infer_ms_median: ms });
const seg = (ms) => ok(ms, 'segmentation'); const nam = (ms) => ok(ms, 'naming'); const dep = (ms) => ok(ms, 'depth');
const bad = (stage) => ({ stage, ok: false, infer_ms_median: null });
t('median', () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null); });
t('verdict: go when segmentation and naming loaded and their total <= 2000 (boundary inclusive)', () => {
  assert.deepEqual(computeVerdict([seg(800), nam(1200)]), { total_infer_ms: 2000, verdict: 'go' });
  assert.equal(computeVerdict([seg(100), nam(100)]).verdict, 'go');
});
t('verdict: depth is informational only: reported, never counted, never blocking', () => {
  const r = computeVerdict([dep(926), seg(800), nam(1200)]);
  assert.equal(r.verdict, 'go'); assert.equal(r.total_infer_ms, 2000); assert.deepEqual(r.depth_informational, { ok: true, infer_ms_median: 926 });
  assert.equal(computeVerdict([bad('depth'), seg(1), nam(1)]).verdict, 'go');
  assert.equal(computeVerdict([dep(1), seg(1000), nam(1001)]).verdict, 'no-go');
  assert.equal(computeVerdict([seg(1), nam(1)]).depth_informational, undefined);
});
t('verdict: no-go when too slow, segmentation or naming failed or is missing', () => {
  assert.equal(computeVerdict([seg(900), nam(1101)]).verdict, 'no-go');
  assert.equal(computeVerdict([seg(1), bad('naming')]).verdict, 'no-go');
  assert.equal(computeVerdict([bad('segmentation'), nam(1)]).verdict, 'no-go');
  assert.equal(computeVerdict([seg(1)]).verdict, 'no-go');
  assert.equal(computeVerdict([dep(1), seg(1)]).verdict, 'no-go');
  assert.equal(computeVerdict([]).verdict, 'no-go');
});
t('results object carries schema, verdict, tab survival and the crashed candidates', () => {
  const r = buildResults({ ua: 'x', webgpu: true, stages: [seg(1), nam(1), dep(1)] });
  assert.equal(r.schema, 'macrofy.feasibility/1'); assert.equal(r.verdict, 'go'); assert.equal(r.tab_survived, true); assert.equal(r.crashed_candidates, undefined);
  const c = buildResults({ ua: 'x', webgpu: false, stages: [seg(1)], crashedStage: 'segmentation' });
  assert.equal(c.tab_survived, false); assert.equal(c.crashed_stage, 'segmentation'); assert.equal(c.verdict, 'no-go');
  const k = buildResults({ ua: 'x', webgpu: true, stages: [seg(1), nam(1)], crashes: [{ stage: 'segmentation', candidate: 'onnx-community/sam2.1-hiera-tiny-ONNX', device: 'webgpu', dtype: 'fp16' }] });
  assert.equal(k.tab_survived, false); assert.deepEqual(k.crashed_candidates, [{ stage: 'segmentation', model: 'onnx-community/sam2.1-hiera-tiny-ONNX', backend: 'webgpu', dtype: 'fp16' }]); assert.equal(k.verdict, 'go');
});
t('crash recovery: the killed CANDIDATE is recorded and the same stage resumes with the next candidate', () => {
  const { STAGES } = cand; const segDef = STAGES[0];
  let st = verdict.freshState();
  assert.equal(verdict.nextStage(st, STAGES).stage, 'segmentation'); assert.equal(verdict.candidatesLeft(st, segDef).length, 2);
  st = { ...st, running: { stage: 'segmentation', candidate: 'Xenova/slimsam-77-uniform', device: 'webgpu', dtype: 'q8' } };
  const after = verdict.recordCrash(st);
  assert.equal(after.running, null); assert.equal(after.crashes.length, 1); assert.match(after.attempts.segmentation[0], /slimsam.*aba encerrada/);
  assert.equal(verdict.nextStage(after, STAGES).stage, 'segmentation'); // not the next stage
  assert.deepEqual(verdict.candidatesLeft(after, segDef).map((c) => c.id), ['onnx-community/sam2.1-hiera-tiny-ONNX']); // the crashed candidate is skipped on every backend
  assert.equal(verdict.candidatesLeft(after, STAGES[1]).length, 2); // other stages keep all their candidates
  assert.equal(verdict.recordCrash(verdict.freshState()).crashes.length, 0); assert.equal(st.crashes.length, 0); // pure
  const done = { ...after, stages: [seg(1)] };
  assert.equal(verdict.nextStage(done, STAGES).stage, 'naming');
  assert.equal(verdict.nextStage({ ...done, stages: [seg(1), nam(1), dep(1)] }, STAGES), null);
  const f = verdict.failedStage('segmentation', 'nenhum candidato carregou', after.attempts.segmentation);
  assert.equal(f.ok, false); assert.equal(f.failed_attempts.length, 1);
});
t('run.mjs runs one stage per page load: saves before each attempt, reloads between stages, resumes after a crash', () => {
  const js = text('feasibility/run.mjs');
  assert.match(js, /location\.reload\(\)/); assert.match(js, /state\.running = \{ stage/); assert.match(js, /recordCrash\(state\)/); assert.match(js, /candidatesLeft\(state, def\)/); assert.match(js, /nextStage\(state, STAGES\)/);
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
await t('createModels: loads SAM (SlimSAM first, SAM 2.1 when SamModel is missing) then SigLIP, reports progress, segments best-score first, ranks prompts', async () => {
  const { T, calls } = fakeLib(); const events = [];
  const m = models.createModels({ importer: async () => ({ ...T, pipeline: async (task, id, opts) => { opts.progress_callback({ status: 'progress', file: 'a.onnx', loaded: 50, total: 100 }); return T.pipeline(task, id); } }) });
  const info = await m.load((e) => events.push(e));
  assert.equal(info.version, '4.3.0'); assert.equal(info.segmenter, 'onnx-community/sam2.1-hiera-tiny-ONNX'); assert.equal(info.namer, 'onnx-community/siglip2-base-patch16-224-ONNX'); // the fake has no SlimSAM class
  assert.equal(info.backend, 'wasm/q8'); // Node has no WebGPU
  assert.ok(events.some((e) => e.stage === 'naming' && e.fraction === 0.5));
  await m.setImage(new Blob(['x']));
  const masks = await m.segment(1, 1);
  assert.deepEqual(masks.map((x) => x.score), [0.9, 0.5, 0.2]); assert.deepEqual([...masks[0].data], [1, 1, 0, 0]); assert.equal(masks[0].width, 2);
  const ranked = await m.classify(new Blob(['x']), ['uma foto de a', 'uma foto de b']);
  assert.deepEqual(ranked, [{ label: 'uma foto de a', score: 1 }, { label: 'uma foto de b', score: 0.5 }]);
  assert.ok(calls.sam.length >= 2);
});
await t('createModels: SlimSAM loads first when available, SAM 2.1 is the fallback, and the failures are reported when nothing loads', async () => {
  const { T } = fakeLib();
  const info = await models.createModels({ importer: async () => ({ ...T, Sam2Model: undefined, SamModel: T.Sam2Model }) }).load();
  assert.equal(info.segmenter, 'Xenova/slimsam-77-uniform'); assert.deepEqual(info.warnings, []); assert.equal(info.backend, 'wasm/q8');
  const both = await models.createModels({ importer: async () => ({ ...T, SamModel: T.Sam2Model }) }).load();
  assert.equal(both.segmenter, 'Xenova/slimsam-77-uniform'); // smallest first even when both exist
  const fb = await models.createModels({ importer: async () => T }).load();
  assert.equal(fb.segmenter, 'onnx-community/sam2.1-hiera-tiny-ONNX'); assert.ok(fb.warnings.some((w) => /SamModel indisponível/.test(w)));
  await assert.rejects(models.createModels({ importer: async () => ({ ...T, Sam2Model: undefined }) }).load(), /nenhum modelo carregou/);
});

// ---------------------------------------------------------------- one model resident at a time (sequential mode, the iOS default)
await t('sequential mode: SAM loads at load(), SigLIP on the first classify() after SAM is freed, and SAM comes back for a later tap', async () => {
  const log = []; const { T } = fakeLib();
  const proc = async () => ({ original_sizes: [[2, 2]], reshaped_input_sizes: [[2, 2]] });
  proc.post_process_masks = async () => [{ dims: [1, 3, 2, 2], data: new Uint8Array([1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0]) }];
  let loads = 0;
  const makeModel = () => { const id = ++loads; log.push(`load sam${id}`); const m = async () => ({ pred_masks: {}, iou_scores: { data: [0.2, 0.9, 0.5] } }); m.get_image_embeddings = async () => { log.push(`encode sam${id}`); return { e: 1 }; }; m.dispose = async () => { log.push(`dispose sam${id}`); }; return m; };
  const lib = { ...T, Sam2Model: { from_pretrained: async () => makeModel() }, AutoProcessor: { from_pretrained: async () => proc },
    pipeline: async () => { log.push('load siglip'); const p = async (img, labels) => labels.map((label, i) => ({ label, score: 1 / (i + 1) })); p.dispose = async () => { log.push('dispose siglip'); }; return p; } };
  const m = models.createModels({ importer: async () => lib, sequential: true });
  const info = await m.load(); log.length = 0;
  assert.equal(info.sequential, true); assert.equal(info.namer, null); // SigLIP is not loaded yet
  await m.setImage(new Blob(['x'])); await m.segmentPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }], { batch: 2 });
  assert.deepEqual(log, ['encode sam1']);
  await m.classify(new Blob(['x']), ['uma foto de a']);
  assert.deepEqual(log, ['encode sam1', 'dispose sam1', 'load siglip']); assert.equal(m.info.namer, 'onnx-community/siglip2-base-patch16-224-ONNX');
  await m.classify(new Blob(['x']), ['uma foto de b']); // SigLIP stays for the next items
  assert.equal(log.length, 3);
  const masks = await m.segment(1, 1); // a correction tap: SigLIP is freed, SAM reloads from the cache and the photo is encoded again
  assert.equal(masks.length, 3); assert.deepEqual(log.slice(3), ['dispose siglip', 'load sam2', 'encode sam2']);
  await m.dispose(); assert.deepEqual(log.slice(-1), ['dispose sam2']);
});
await t('parallel mode (desktop): both models load at load() and stay', async () => {
  const { T } = fakeLib(); const m = models.createModels({ importer: async () => T, sequential: false });
  const info = await m.load(); assert.equal(info.sequential, false); assert.ok(info.segmenter && info.namer);
});

// ---------------------------------------------------------------- batched multi-point SAM decode (T-014)
const batchLib = ({ refuseBatches = false } = {}) => {
  const { T } = fakeLib(); const calls = { batches: [], prompts: [] };
  let k = 1;
  const proc = async (img, o) => { k = o?.input_points?.[0]?.length ?? 1; calls.batches.push(k); calls.prompts.push(o?.input_points); return { original_sizes: [[2, 2]], reshaped_input_sizes: [[2, 2]], k }; };
  // mask i of point p is all (p + 1) when i is 1 (the best-scoring one) and empty otherwise, so the output says which point it answers
  proc.post_process_masks = async () => [{ dims: [k, 3, 2, 2], data: Uint8Array.from({ length: k * 12 }, (_, j) => (Math.floor(j / 4) % 3 === 1 ? Math.floor(j / 12) + 1 : 0)) }];
  const model = async (inputs) => { if (refuseBatches && inputs.k > 1) throw new Error('batched prompts refused'); return { pred_masks: {}, iou_scores: { data: Array.from({ length: inputs.k * 3 }, (_, j) => [0.2, 0.9, 0.5][j % 3]) } }; };
  model.get_image_embeddings = async () => ({ image_embeddings: 'e' }); model.dispose = async () => {};
  return { T: { ...T, Sam2Model: { from_pretrained: async () => model }, AutoProcessor: { from_pretrained: async () => proc } }, calls };
};
const pts = (n) => Array.from({ length: n }, (_, i) => ({ x: i, y: 2 * i }));
await t('splitBatchMasks: the best-scoring mask of each point, tagged with its point; a wrong batch size is an error', () => {
  const out = models.splitBatchMasks({ dims: [2, 3, 1, 2], data: Uint8Array.from([0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1]) }, [0.1, 0.9, 0.3, 0.6, 0.2, 0.7], pts(2), 1);
  assert.deepEqual(out.map((m) => [m.score, [...m.data]]), [[0.9, [1, 1]], [0.7, [1, 1]]]); // the non-best masks are empty, so picking the wrong one would show assert.deepEqual(out.map((m) => m.point), pts(2));
  assert.equal(models.splitBatchMasks({ dims: [1, 3, 1, 2], data: Uint8Array.from([1, 1, 1, 1, 1, 1]) }, [0.1, 0.9, 0.3], pts(1), 2).length, 2);
  assert.throws(() => models.splitBatchMasks({ dims: [2, 3, 1, 2], data: new Uint8Array(12) }, [], pts(3), 1), /3 pontos/);
});
await t('segmentPoints: one prompt per point in batches, on the cached embedding; masks + predicted IoU; progress and timings', async () => {
  const { T, calls } = batchLib(); const m = models.createModels({ importer: async () => T }); await m.load();
  const enc = await m.setImage(new Blob(['x'])); assert.equal(typeof enc.encoder_ms, 'number'); assert.equal(enc.cached, true);
  calls.batches.length = 0; calls.prompts.length = 0; const prog = [];
  const r = await m.segmentPoints(pts(10), { batch: 4, onProgress: (e) => prog.push(`${e.done}/${e.total}`) });
  assert.deepEqual(calls.batches, [4, 4, 2]); assert.equal(r.decodes, 3); assert.equal(r.done, 10); assert.equal(r.timed_out, false); assert.equal(r.masks.length, 10);
  assert.deepEqual(calls.prompts[0], [[[[0, 0]], [[1, 2]], [[2, 4]], [[3, 6]]]]); // [image][point][1 point][x, y]
  assert.ok(r.masks.every((x) => x.score === 0.9 && x.width === 2 && x.data[0] === 1)); assert.deepEqual(r.masks.map((x) => x.point.x), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); assert.deepEqual(r.masks[5].point, { x: 5, y: 10 });
  assert.deepEqual(prog, ['0/10', '4/10', '8/10', '10/10']); assert.equal(typeof r.ms, 'number');
});
await t('segmentPoints: the time budget stops the grid early and says so', async () => {
  const { T } = batchLib(); const m = models.createModels({ importer: async () => T }); await m.load(); await m.setImage(new Blob(['x']));
  let clock = 0; const r = await m.segmentPoints(pts(12), { batch: 4, budgetMs: 250, now: () => (clock += 100) });
  assert.equal(r.timed_out, true); assert.equal(r.done, 8); assert.equal(r.masks.length, 8); assert.equal(r.total, 12);
});
await t('segmentPoints: falls back to one prompt per decode when batched prompts are refused, with the same masks', async () => {
  const { T, calls } = batchLib({ refuseBatches: true }); const m = models.createModels({ importer: async () => T }); await m.load(); await m.setImage(new Blob(['x']));
  calls.batches.length = 0; const r = await m.segmentPoints(pts(5), { batch: 4 });
  assert.equal(r.masks.length, 5); assert.equal(r.batched, false); assert.ok(r.decodes >= 5); assert.ok(r.masks.every((x, i) => x.score === 0.9 && x.point.x === i));
  await assert.rejects(models.createModels({ importer: async () => T }).segmentPoints(pts(1)), /nenhuma foto/);
});
await t('the 4.3.0 to 3.8.1 fallback and the injectable model layer are unchanged by the batched decode', async () => {
  const { T } = batchLib(); const seen = [];
  const m = models.createModels({ importer: async (u) => { seen.push(u.split('@').pop()); if (u.endsWith('@4.3.0')) throw new Error('404'); return T; } });
  assert.equal((await m.load()).version, '3.8.1'); assert.deepEqual(seen, ['4.3.0', '3.8.1']);
  for (const fn of ['load', 'setImage', 'segment', 'segmentPoints', 'classify']) assert.equal(typeof m[fn], 'function', fn);
});

// ---------------------------------------------------------------- capture app (web/app)
const { staleCopies, COPIES } = await import(pathToFileURL(f('sync-data.mjs')));
const appFiles = ['index.html', 'app.css', 'app.mjs', 'lib.mjs', 'db.mjs', 'estimate.mjs', 'sw.js', 'manifest.webmanifest', 'vendor/schema-core.mjs', 'vendor/lookup-core.mjs', 'vendor/estimate-core.mjs', 'vendor/models.mjs', 'vendor/autoseg.mjs', 'data/vocab.json', 'data/priors.json', 'data/calibration.json', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
t('capture app files exist', () => appFiles.forEach((p) => assert.ok(existsSync(f(`app/${p}`)), `missing web/app/${p}`)));
t('DRIFT: web/app copies equal their sources (else run node web/sync-data.mjs)', () => {
  const stale = staleCopies();
  assert.deepEqual(stale.map((c) => c.to), [], `stale copies: ${stale.map((c) => c.to).join(', ')}. Run: node web/sync-data.mjs`);
  for (const to of ['web/app/vendor/lookup-core.mjs', 'web/app/vendor/estimate-core.mjs', 'web/app/vendor/models.mjs', 'web/app/vendor/autoseg.mjs', 'web/app/data/priors.json', 'web/app/data/calibration.json']) assert.ok(COPIES.some((c) => c.to === to), `sync-data.mjs does not copy ${to}`);
});
t('the drift check really fails on a stale copy', () => {
  const copy = COPIES.find((c) => c.to.endsWith('vocab.json')); const p = f(copy.to.replace(/^web\//, ''));
  const good = readFileSync(p);
  try { writeFileSync(p, Buffer.concat([good, Buffer.from(' ')])); assert.deepEqual(staleCopies().map((c) => c.to), [copy.to]); }
  finally { writeFileSync(p, good); }
  assert.deepEqual(staleCopies(), []);
});
t('the drift check also catches a stale estimation core, the automatic-mode module and priors', () => {
  for (const to of ['web/app/vendor/estimate-core.mjs', 'web/app/vendor/autoseg.mjs', 'web/app/data/priors.json']) {
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
  for (const re of [/Toque uma vez na borda do prato/, /Toque em cada alimento/, /outro…/, /oil_levels/, /Não calibrado — estimativa inicial/, /Exportar previsões/, /Salvar estimativa/, /__macrofyModels/, /namePrompts/, /toPredictions/, /Esta refeição também foi pesada\?/, /Encontrando o prato…/, /Encontrando os alimentos…/, /Modo manual/, /detectAuto/, /segmentPoints/, /plateSetup/, /timings/, /estimate_draft/, /Adicionar alimento/, /Juntar com…/, /Dividir/, /Remover/, /Trocar nome/]) assert.match(js, re);
});
t('estimation files exist and the estimate selftest is registered', () => {
  for (const p of ['estimate/core.mjs', 'estimate/priors.json', 'estimate/calibration.json', 'estimate/selftest.mjs']) assert.ok(existsSync(f(p)), `missing web/${p}`);
  const checks = JSON.parse(readFileSync(join(web, '..', 'control', 'checks.json'), 'utf8')).checks;
  assert.deepEqual(checks.find((c) => c.id === 'estimator-selftest')?.cmd, ['node', 'web/estimate/selftest.mjs']);
});
t('landing page links to the capture app', () => assert.match(text('index.html'), /href="app\/"/));

console.log(`web selftest: ${n} checks passed`);
