// Check `web-selftest`: node web/selftest.mjs (built-ins only; run from macrofy/).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  assert.deepEqual(models.NAMING_CANDIDATES.map((c) => c.id), ['Xenova/clip-vit-base-patch32', 'Xenova/siglip-base-patch16-224', 'onnx-community/siglip2-base-patch16-224-ONNX']); // vision files, smallest first (T-015)
  assert.deepEqual(models.BACKENDS.slice(0, 2), [['webgpu', 'q4f16'], ['wasm', 'q4']]); assert.deepEqual(models.BACKENDS.at(-1), ['wasm', 'q8']); // 4-bit image towers (53-58 MB) first, per the CI model probe
});
t('the app tries the combinations proven on the owner iPhone 16e first (run 3), then everything else once, in candidate order', () => {
  const seg = models.provenFirst(models.SEGMENT_CANDIDATES).map(([c, d, t]) => `${c.id} ${d}/${t}`);
  assert.equal(seg[0], 'onnx-community/sam2.1-hiera-tiny-ONNX webgpu/q4f16');
  assert.equal(seg.length, models.SEGMENT_CANDIDATES.reduce((n, c) => n + models.backendsOf(c).length, 0));
  assert.equal(new Set(seg).size, seg.length);
  assert.deepEqual(seg.slice(1), models.SEGMENT_CANDIDATES.flatMap((c) => models.backendsOf(c).map(([d, t]) => `${c.id} ${d}/${t}`)).filter((s) => s !== seg[0]));
  assert.equal(models.provenFirst(models.NAMING_CANDIDATES).map(([c, d, t]) => `${c.id} ${d}/${t}`)[0], 'Xenova/clip-vit-base-patch32 webgpu/q4f16');
  assert.equal(models.provenFirst([{ id: 'x/unknown', backends: [['wasm', 'q8']] }])[0][0].id, 'x/unknown'); // nothing proven: plain order
});
t('memory discipline for iOS (F-005): SlimSAM first, SAM on WASM before WebGPU (WebGPU crashed even at 9 MB), never fp32 anywhere', () => {
  assert.deepEqual(models.SEGMENT_CANDIDATES[0].backends, [['wasm', 'q8'], ['webgpu', 'q8']]);
  for (const c of models.SEGMENT_CANDIDATES) assert.equal(c.backends[0][0], 'wasm');
  for (const c of [...models.SEGMENT_CANDIDATES, ...models.NAMING_CANDIDATES]) for (const [, dtype] of models.backendsOf(c)) assert.ok(['q8', 'fp16', 'q4', 'q4f16'].includes(dtype), `${c.id}: ${dtype}`);
  assert.equal(models.backendsOf(models.NAMING_CANDIDATES[0]), models.BACKENDS);
  assert.doesNotMatch(text('lib/models.mjs') + text('feasibility/run.mjs'), /['"]fp32['"]/);
});
t('every stage has a non-empty candidate list, with a fallback; the estimator stages run first, depth last', () => {
  assert.deepEqual(cand.STAGES.map((s) => s.stage), ['segmentation', 'naming', 'depth']);
  for (const s of cand.STAGES) { assert.ok(s.candidates.length >= 2, s.stage); s.candidates.forEach((c) => assert.ok(c.id && (c.task || c.sam || c.vision))); }
  assert.ok(cand.BACKENDS.length > 0);
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
t('results object carries schema, verdict, tab survival, the crashed attempts and the T-015 diagnostics', () => {
  const r = buildResults({ ua: 'x', webgpu: true, stages: [seg(1), nam(1), dep(1)] });
  assert.equal(r.schema, 'macrofy.feasibility/1'); assert.equal(r.verdict, 'go'); assert.equal(r.tab_survived, true); assert.equal(r.crashed_candidates, undefined);
  assert.equal(r.storage, undefined); assert.equal(r.failures, undefined);
  const c = buildResults({ ua: 'x', webgpu: false, stages: [seg(1)], crashedStage: 'segmentation' });
  assert.equal(c.tab_survived, false); assert.equal(c.crashed_stage, 'segmentation'); assert.equal(c.verdict, 'no-go');
  const url = 'https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/resolve/main/onnx/vision_encoder_fp16.onnx';
  const k = buildResults({ ua: 'x', webgpu: true, stages: [seg(1), nam(1)], crashes: [{ stage: 'segmentation', candidate: 'onnx-community/sam2.1-hiera-tiny-ONNX', device: 'webgpu', dtype: 'fp16', file: 'onnx/vision_encoder_fp16.onnx', url }],
    storage: { segmentation: verdict.storageRecord({ quota: 2e9, usage: 5e8 }, false) },
    failures: [verdict.failureRecord('naming', { candidate: 'Xenova/clip-vit-base-patch32', device: 'wasm', dtype: 'q8' }, new TypeError('Load failed'), { file: 'onnx/vision_model_quantized.onnx', url: 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx' })] });
  assert.equal(k.tab_survived, false); assert.equal(k.verdict, 'go');
  assert.deepEqual(k.crashed_candidates, [{ stage: 'segmentation', model: 'onnx-community/sam2.1-hiera-tiny-ONNX', backend: 'webgpu', dtype: 'fp16', file: 'onnx/vision_encoder_fp16.onnx', url }]);
  assert.deepEqual(k.storage, { segmentation: { quota_mb: 2000, usage_mb: 500, persisted: false } });
  assert.deepEqual(k.failures[0], { stage: 'naming', model: 'Xenova/clip-vit-base-patch32', backend: 'wasm', dtype: 'q8', error_name: 'TypeError', error_message: 'Load failed',
    file: 'onnx/vision_model_quantized.onnx', url: 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx' });
  assert.deepEqual(verdict.storageRecord(undefined, undefined), { quota_mb: null, usage_mb: null, persisted: null });
  assert.equal(verdict.storageRecord(undefined, null, 'x').error, 'x');
});

// ---- A1: per-attempt crash resume. The unit is (model, device, dtype); a simulated sequence of page loads must run each attempt once.
const attemptName = (a) => `${a.candidate} ${a.device}/${a.dtype}`;
const SEG = cand.STAGES[0]; const NAM = cand.STAGES[1];
/** Page loads as run.mjs does them: the state round-trips through JSON (localStorage), init() records a killed tab, then the attempts run. */
function simulate(def, hasGpu, behaviour, maxLoads = 100) {
  let st = verdict.freshState(); const ran = []; let loads = 0; let result = null;
  while (result === null) {
    assert.ok(++loads <= maxLoads, 'infinite resume loop');
    st = verdict.recordCrash(verdict.migrateState(JSON.parse(JSON.stringify(st))));
    for (let a = verdict.nextAttempt(st, def, hasGpu); a; a = verdict.nextAttempt(st, def, hasGpu)) {
      st = verdict.beginAttempt(st, def.stage, a); ran.push(a.key); // saved before the attempt runs
      const b = behaviour(a.key, ran.length);
      if (b === 'crash') break; // the tab dies here: `running` stays set in the saved state
      if (b === 'ok') { st = verdict.endAttempt(st); result = { ok: true, key: a.key }; break; }
      st = verdict.recordFailure(st, def.stage, a, new TypeError('Load failed'), { file: 'onnx/x.onnx', url: 'https://huggingface.co/m/resolve/main/onnx/x.onnx' });
    }
    if (result === null && !st.running) result = { ok: false }; // every attempt tried, none worked: the stage ends
  }
  return { ran, loads, st, result };
}
t('the attempt plan of a stage is every (model, device, dtype), once each, in candidate order; no GPU drops the WebGPU ones', () => {
  const plan = verdict.plannedAttempts(SEG, true);
  assert.deepEqual(plan.map(attemptName), ['Xenova/slimsam-77-uniform wasm/q8', 'Xenova/slimsam-77-uniform webgpu/q8', 'onnx-community/sam2.1-hiera-tiny-ONNX wasm/q8',
    'onnx-community/sam2.1-hiera-tiny-ONNX webgpu/q4f16', 'onnx-community/sam2.1-hiera-tiny-ONNX webgpu/fp16']);
  assert.equal(new Set(plan.map((a) => a.key)).size, plan.length);
  assert.deepEqual(verdict.plannedAttempts(SEG, false).map(attemptName), ['Xenova/slimsam-77-uniform wasm/q8', 'onnx-community/sam2.1-hiera-tiny-ONNX wasm/q8']);
  assert.equal(verdict.plannedAttempts(NAM, true).length, NAM.candidates.length * models.BACKENDS.length);
});
t('F-006 (the owner run): every WebGPU SAM attempt kills the tab, WASM fails, and every attempt of the stage still runs, once', () => {
  const plan = verdict.plannedAttempts(SEG, true).map((a) => a.key);
  const r = simulate(SEG, true, (key) => (key.includes('|webgpu|') ? 'crash' : 'fail'));
  assert.deepEqual(r.ran, plan); // every attempt exactly once, in order: no backend is skipped after a crash
  assert.equal(r.loads, 4); assert.equal(r.result.ok, false);
  assert.equal(r.st.crashes.length, 3); assert.equal(r.st.failures.length, 2); assert.equal(r.st.attempts.segmentation.length, 5);
  assert.match(r.st.attempts.segmentation[0], /TypeError: Load failed \[https:\/\/huggingface\.co\/m\/resolve\/main\/onnx\/x\.onnx\]/);
  assert.match(r.st.attempts.segmentation[1], /slimsam-77-uniform webgpu\/q8: aba encerrada pelo Safari/);
});
t('a crash skips only THAT attempt: the same model on another backend and the same stage go on', () => {
  const r = simulate(SEG, true, (key) => (key === 'Xenova/slimsam-77-uniform|wasm|q8' ? 'crash' : 'ok'));
  assert.deepEqual(r.ran, ['Xenova/slimsam-77-uniform|wasm|q8', 'Xenova/slimsam-77-uniform|webgpu|q8']); assert.deepEqual(r.result, { ok: true, key: 'Xenova/slimsam-77-uniform|webgpu|q8' });
  assert.equal(r.loads, 2); assert.equal(r.st.crashes.length, 1);
  assert.equal(verdict.nextStage(r.st, cand.STAGES).stage, 'segmentation'); // the stage is not abandoned; only run.mjs, on success, moves to the next
});
t('worst case: every attempt kills the tab; the resume still ends, after exactly one page load per attempt', () => {
  for (const [def, gpu] of [[SEG, true], [SEG, false], [NAM, true], [cand.STAGES[2], true]]) {
    const plan = verdict.plannedAttempts(def, gpu).map((a) => a.key);
    const r = simulate(def, gpu, () => 'crash');
    assert.deepEqual(r.ran, plan); assert.equal(r.loads, plan.length + 1); assert.equal(r.st.crashes.length, plan.length); assert.equal(r.result.ok, false);
  }
});
t('random crash, failure and success sequences: no attempt ever runs twice, none is skipped before a success, and the run always ends', () => {
  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let trial = 0; trial < 300; trial++) {
    const def = [SEG, NAM][trial % 2]; const gpu = trial % 3 !== 0; const plan = verdict.plannedAttempts(def, gpu).map((a) => a.key);
    const script = new Map(plan.map((k) => [k, ['crash', 'fail', 'fail', 'ok'][Math.floor(rnd() * 4)]]));
    const r = simulate(def, gpu, (key) => script.get(key));
    assert.equal(new Set(r.ran).size, r.ran.length, 'an attempt ran twice');
    assert.deepEqual(r.ran, plan.slice(0, r.ran.length)); // in order, never skipping one
    if (r.result.ok) assert.equal(script.get(r.ran.at(-1)), 'ok'); else assert.equal(r.ran.length, plan.length);
    assert.equal(r.st.crashes.length, r.ran.filter((k) => script.get(k) === 'crash').length);
  }
});
t('crash state details: the attempt in flight is saved with its file, the crash record is pure, old saved states are discarded, other stages are untouched', () => {
  let st = verdict.freshState(); const a = verdict.nextAttempt(st, SEG, true);
  st = verdict.beginAttempt(st, 'segmentation', a); assert.deepEqual(st.running, { stage: 'segmentation', candidate: 'Xenova/slimsam-77-uniform', device: 'wasm', dtype: 'q8' });
  st = verdict.noteFetching(st, { file: 'onnx/vision_encoder_q8.onnx', url: 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/onnx/vision_encoder_q8.onnx' });
  const before = JSON.stringify(st); const after = verdict.recordCrash(st);
  assert.equal(JSON.stringify(st), before); assert.equal(after.running, null); assert.match(after.attempts.segmentation[0], /vision_encoder_q8\.onnx/);
  assert.equal(after.crashes[0].file, 'onnx/vision_encoder_q8.onnx');
  assert.equal(verdict.nextAttempt(after, SEG, true).key, 'Xenova/slimsam-77-uniform|webgpu|q8');
  assert.equal(verdict.nextAttempt(after, NAM, true).key, `${NAM.candidates[0].id}|webgpu|q4f16`); // naming keeps its full plan
  assert.equal(verdict.recordCrash(verdict.freshState()).crashes.length, 0);
  assert.deepEqual(verdict.migrateState({ stages: [seg(1)], crashes: [1], finished: true }), verdict.freshState()); // a v2 page state: start over
  assert.equal(verdict.migrateState(JSON.parse(JSON.stringify(after))).crashes.length, 1);
  const done = { ...after, stages: [seg(1)] };
  assert.equal(verdict.nextStage(done, cand.STAGES).stage, 'naming');
  assert.equal(verdict.nextStage({ ...done, stages: [seg(1), nam(1), dep(1)] }, cand.STAGES), null);
  const f = verdict.failedStage('segmentation', 'nenhuma tentativa carregou', after.attempts.segmentation);
  assert.equal(f.ok, false); assert.equal(f.failed_attempts.length, 1);
});
t('run.mjs: one stage per page load, one attempt marked and saved before it starts, a killed tab recorded per attempt, diagnostics wired', () => {
  const js = text('feasibility/run.mjs');
  assert.match(js, /location\.reload\(\)/); assert.match(js, /state = beginAttempt\(state, def\.stage, a\); save\(state\)/); assert.match(js, /recordCrash\(state\)/);
  assert.match(js, /nextAttempt\(state, def, hasGpu\)/); assert.match(js, /nextStage\(state, stages\)/); assert.match(js, /migrateState\(load\(\)\)/);
  assert.doesNotMatch(js, /candidatesLeft/);
  assert.match(js, /navigator\.storage/); assert.match(js, /estimate\?\.\(\)/); assert.match(js, /persisted\?\.\(\)/);
  assert.ok(js.indexOf('recordStorage(state, def.stage') > 0 && js.indexOf('recordStorage(state, def.stage') < js.indexOf('await runStage('), 'storage is recorded before the stage runs');
  assert.match(js, /fileTracker\(/); assert.match(js, /recordFailure\(state, def\.stage, a, e,/); assert.match(js, /noteFetching\(state, tracker\)/);
  assert.match(js, /prepareEmbeddings\(/); assert.match(js, /orderBySize\(/); assert.match(js, /loadProbe\(/);
});
t('fileTracker: names the file being fetched (initiated, not done) with its Hugging Face URL', () => {
  const seen = []; const tr = models.fileTracker('m/x', (e) => seen.push(e.status));
  tr.callback({ status: 'initiate', file: 'config.json', name: 'm/x' }); tr.callback({ status: 'done', file: 'config.json', name: 'm/x' });
  tr.callback({ status: 'initiate', file: 'onnx/vision_model.onnx', name: 'm/x' }); tr.callback({ status: 'progress', file: 'onnx/vision_model.onnx', name: 'm/x', loaded: 1, total: 9 });
  assert.equal(tr.file, 'onnx/vision_model.onnx'); assert.equal(tr.url, 'https://huggingface.co/m/x/resolve/main/onnx/vision_model.onnx'); assert.deepEqual(tr.inFlight, [tr.url]);
  tr.callback({ status: 'done', file: 'onnx/vision_model.onnx', name: 'm/x' }); assert.equal(tr.file, null); assert.equal(seen.length, 5);
});

// ---------------------------------------------------------------- shared model layer with a fake transformers.js (no network here)
const fakeEmb = async (modelId, labels = ['a', 'b'], over = {}) => ({ model_id: modelId, revision: `rev-${modelId}`, dim: 3, prompt_template: 'uma foto de {}', prompt_template_en: 'a photo of {}',
  labels_sha256: await models.labelsSha256(labels), labels, embeddings: [[1, 0, 0], [0, 1, 0]], extra_labels: ['talher'], extra_embeddings: [[0, 0, 1]], ...over });
// createModels with the vocab, the text-embedding file and the probe mocked: no network, no files
const mkModels = (o = {}) => models.createModels({ labels: ['a', 'b'], loadEmbeddings: (id) => fakeEmb(id), probe: { models: [] }, ...o });
const fakeLib = () => {
  const calls = { sam: [], vision: [], forbidden: [] };
  class RawImage { constructor(data, width, height, channels) { Object.assign(this, { data, width, height, channels }); } static async fromBlob() { return new RawImage(new Uint8ClampedArray(12), 2, 2, 3); } }
  const proc = async () => ({ original_sizes: [[2, 2]], reshaped_input_sizes: [[2, 2]] });
  proc.post_process_masks = async () => [{ dims: [1, 3, 2, 2], data: new Uint8Array([1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0]) }]; // three 2x2 masks
  const model = async (inputs) => { calls.sam.push(inputs); return { pred_masks: {}, iou_scores: { data: [0.2, 0.9, 0.5] } }; };
  model.dispose = async () => {};
  const visionModel = async () => ({ image_embeds: { data: Float32Array.from([0.8, 0.6, 0]), dims: [1, 3] } });
  visionModel.dispose = async () => {};
  const vision = { from_pretrained: async (id, o) => { calls.vision.push({ id, o }); o.progress_callback?.({ status: 'progress', file: 'onnx/vision_model_quantized.onnx', loaded: 50, total: 100 }); return visionModel; } };
  const forbid = (what) => ({ from_pretrained: async () => { calls.forbidden.push(what); throw new Error(`${what} must not be loaded by the naming stage`); } });
  class Tensor { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } }
  const T = { env: {}, RawImage, Tensor,
    async pipeline() { calls.forbidden.push('pipeline'); throw new Error('naming must not use a pipeline'); },
    AutoModel: forbid('AutoModel'), CLIPModel: forbid('CLIPModel'), SiglipModel: forbid('SiglipModel'), CLIPTextModelWithProjection: forbid('text tower'), SiglipTextModel: forbid('text tower'),
    CLIPVisionModelWithProjection: vision, SiglipVisionModel: vision, AutoImageProcessor: { from_pretrained: async () => async () => ({ pixel_values: {} }) },
    Sam2Model: { from_pretrained: async () => model }, AutoProcessor: { from_pretrained: async () => proc } };
  return { T, calls };
};
await t('importTransformers: 4.3.0 first; 3.8.1 only when that import fails; both failing is an error', async () => {
  const seen = []; const fake = fakeLib();
  let r = await models.importTransformers({ importer: async (u) => { seen.push(u); return fake.T; } });
  assert.equal(r.version, '4.3.0'); assert.equal(seen.length, 1); assert.equal(fake.T.env.allowLocalModels, false);
  assert.equal(fake.T.env.useBrowserCache, false); // Node has no Cache Storage (the CI real-pipeline run failed on this)
  globalThis.caches = {}; const fb = fakeLib();
  try { await models.importTransformers({ importer: async () => fb.T }); assert.equal(fb.T.env.useBrowserCache, true); } finally { delete globalThis.caches; } // browsers cache models
  seen.length = 0;
  r = await models.importTransformers({ importer: async (u) => { seen.push(u); if (u.endsWith('@4.3.0')) throw new Error('404'); return fake.T; } });
  assert.equal(r.version, '3.8.1'); assert.deepEqual(seen.map((u) => u.split('@').pop()), ['4.3.0', '3.8.1']); assert.match(r.errors[0], /^4\.3\.0: 404/);
  await assert.rejects(models.importTransformers({ importer: async () => { throw new Error('offline'); } }), /offline/);
});
await t('createModels: loads SAM then a VISION-ONLY namer, reports progress, segments best-score first, ranks prompts by cosine against the committed text embeddings', async () => {
  const { T, calls } = fakeLib(); const events = [];
  const m = mkModels({ importer: async () => T });
  const info = await m.load((e) => events.push(e));
  assert.equal(info.version, '4.3.0'); assert.equal(info.segmenter, 'onnx-community/sam2.1-hiera-tiny-ONNX'); assert.equal(info.namer, 'Xenova/clip-vit-base-patch32'); // the fake has no SlimSAM class; CLIP B/32 is the smallest namer
  assert.equal(info.backend, 'wasm/q8'); assert.equal(info.namer_backend, 'wasm/q4'); // Node has no WebGPU; the 4-bit image tower is the first WASM option
  assert.ok(events.some((e) => e.stage === 'naming' && e.fraction === 0.5));
  assert.equal(calls.vision.length, 1); assert.equal(calls.vision[0].id, 'Xenova/clip-vit-base-patch32');
  assert.equal(calls.vision[0].o.model_file_name, 'vision_model'); assert.equal(calls.vision[0].o.revision, 'rev-Xenova/clip-vit-base-patch32'); // pinned to the revision of the embeddings
  assert.equal(calls.vision[0].o.device, 'wasm'); assert.equal(calls.vision[0].o.dtype, 'q4');
  await m.setImage(new Blob(['x']));
  const masks = await m.segment(1, 1);
  assert.deepEqual(masks.map((x) => x.score), [0.9, 0.5, 0.2]); assert.deepEqual([...masks[0].data], [1, 1, 0, 0]); assert.equal(masks[0].width, 2);
  const ranked = await m.classify(new Blob(['x']), ['uma foto de a', 'uma foto de b', 'uma foto de talher']); // the image embedding [.8, .6, 0]: a .8, b .6, talher (non-food, extra) 0
  assert.deepEqual(ranked.map((r) => r.label), ['uma foto de a', 'uma foto de b', 'uma foto de talher']);
  assert.ok(ranked[0].score > 0.99 && ranked[0].score > ranked[1].score && ranked[1].score > ranked[2].score); assert.ok(Math.abs(ranked.reduce((s, r) => s + r.score, 0) - 1) < 1e-9);
  assert.ok(calls.sam.length >= 2); assert.deepEqual(calls.forbidden, []);
});
await t('A1: the naming stage loads ONLY a vision encoder: never a pipeline, a full model or a text tower', async () => {
  const { T, calls } = fakeLib(); await mkModels({ importer: async () => T }).load();
  assert.deepEqual(calls.forbidden, []); assert.ok(calls.vision.length >= 1);
  const src = text('lib/models.mjs');
  assert.doesNotMatch(src.slice(src.indexOf('export const NAMING_CANDIDATES'), src.indexOf('/** Tried in order per candidate')), /task:/); // no pipeline candidate for naming
  for (const c of models.NAMING_CANDIDATES) { assert.ok(c.vision?.every((n) => /Vision/.test(n)), c.id); assert.ok(!c.task); }
});
await t('A1: text-embedding provenance: missing or stale -> "embeddings missing/stale", nothing is downloaded, nothing is guessed', async () => {
  const { T, calls } = fakeLib(); const clip = 'Xenova/clip-vit-base-patch32';
  await assert.rejects(mkModels({ importer: async () => T, loadEmbeddings: async () => null }).load(), /embeddings missing\/stale.*file missing/);
  assert.equal(calls.vision.length, 0); // rejected before any model file is fetched
  const stale = await fakeEmb(clip, ['a', 'b'], { labels_sha256: await models.labelsSha256(['a', 'OLD']) }); // the vocab changed after the file was built
  await assert.rejects(mkModels({ importer: async () => T, loadEmbeddings: async (id) => (id === clip ? stale : null) }).load(), /labels hash differs/);
  await assert.rejects(mkModels({ importer: async () => T, labels: ['a', 'b', 'c'] }).load(), /labels hash differs/); // vocab grew: same file, new labels
  assert.equal(calls.vision.length, 0);
  const wrong = await fakeEmb(clip, ['a', 'b'], { model_id: 'other/model' });
  await assert.rejects(mkModels({ importer: async () => T, loadEmbeddings: async () => wrong }).load(), /file is for other\/model/);
  // a later candidate with a valid file is used; the failed one is reported
  const m = mkModels({ importer: async () => T, loadEmbeddings: async (id) => (id === 'Xenova/siglip-base-patch16-224' ? fakeEmb(id) : null) });
  const info = await m.load(); assert.equal(info.namer, 'Xenova/siglip-base-patch16-224'); assert.ok(info.warnings.some((w) => /clip-vit-base-patch32.*embeddings missing\/stale/.test(w)));
  await assert.rejects(m.classify(new Blob(['x']), ['uma foto de zzz']), /embeddings missing\/stale.*no text vector for "uma foto de zzz"/); // a prompt outside the file is not guessed
});
await t('createModels: SlimSAM loads first when available, SAM 2.1 is the fallback, and the failures are reported when nothing loads', async () => {
  const { T } = fakeLib();
  const info = await mkModels({ importer: async () => ({ ...T, Sam2Model: undefined, SamModel: T.Sam2Model }) }).load();
  assert.equal(info.segmenter, 'Xenova/slimsam-77-uniform'); assert.deepEqual(info.warnings, []); assert.equal(info.backend, 'wasm/q8');
  const both = await mkModels({ importer: async () => ({ ...T, SamModel: T.Sam2Model }) }).load();
  assert.equal(both.segmenter, 'Xenova/slimsam-77-uniform'); // smallest first even when both exist
  const fb = await mkModels({ importer: async () => T }).load();
  assert.equal(fb.segmenter, 'onnx-community/sam2.1-hiera-tiny-ONNX'); assert.ok(fb.warnings.some((w) => /SamModel indisponível/.test(w)));
  await assert.rejects(mkModels({ importer: async () => ({ ...T, Sam2Model: undefined }) }).load(), /nenhum modelo carregou/);
});

// ---------------------------------------------------------------- one model resident at a time (sequential mode, the iOS default)
await t('sequential mode: SAM loads at load(), the namer on the first classify() after SAM is freed, and SAM comes back for a later tap', async () => {
  const log = []; const { T } = fakeLib();
  const proc = async () => ({ original_sizes: [[2, 2]], reshaped_input_sizes: [[2, 2]] });
  proc.post_process_masks = async () => [{ dims: [1, 3, 2, 2], data: new Uint8Array([1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0]) }];
  let loads = 0;
  const makeModel = () => { const id = ++loads; log.push(`load sam${id}`); const m = async () => ({ pred_masks: {}, iou_scores: { data: [0.2, 0.9, 0.5] } }); m.get_image_embeddings = async () => { log.push(`encode sam${id}`); return { e: 1 }; }; m.dispose = async () => { log.push(`dispose sam${id}`); }; return m; };
  const lib = { ...T, Sam2Model: { from_pretrained: async () => makeModel() }, AutoProcessor: { from_pretrained: async () => proc },
    CLIPVisionModelWithProjection: { from_pretrained: async () => { log.push('load namer'); const v = async () => ({ image_embeds: { data: [1, 0, 0], dims: [1, 3] } }); v.dispose = async () => { log.push('dispose namer'); }; return v; } } };
  const m = mkModels({ importer: async () => lib, sequential: true });
  const info = await m.load(); log.length = 0;
  assert.equal(info.sequential, true); assert.equal(info.namer, null); // the namer is not loaded yet
  await m.setImage(new Blob(['x'])); await m.segmentPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }], { batch: 2 });
  assert.deepEqual(log, ['encode sam1']);
  await m.classify(new Blob(['x']), ['uma foto de a']);
  assert.deepEqual(log, ['encode sam1', 'dispose sam1', 'load namer']); assert.equal(m.info.namer, 'Xenova/clip-vit-base-patch32');
  await m.classify(new Blob(['x']), ['uma foto de b']); // the namer stays for the next items
  assert.equal(log.length, 3);
  const masks = await m.segment(1, 1); // a correction tap: the namer is freed, SAM reloads from the cache and the photo is encoded again
  assert.equal(masks.length, 3); assert.deepEqual(log.slice(3), ['dispose namer', 'load sam2', 'encode sam2']);
  await m.dispose(); assert.deepEqual(log.slice(-1), ['dispose sam2']);
});
await t('loadNaming (auto mode, second page on the iPhone): only the naming model loads; SAM loads only if a later correction needs it', async () => {
  const log = []; const { T } = fakeLib();
  const proc = async () => ({ original_sizes: [[2, 2]], reshaped_input_sizes: [[2, 2]] });
  proc.post_process_masks = async () => [{ dims: [1, 3, 2, 2], data: new Uint8Array(12).fill(1) }];
  const lib = { ...T, Sam2Model: { from_pretrained: async () => { log.push('load sam'); const x = async () => ({ pred_masks: {}, iou_scores: { data: [0.9, 0.5, 0.2] } }); x.get_image_embeddings = async () => ({}); x.dispose = async () => { log.push('dispose sam'); }; return x; } }, AutoProcessor: { from_pretrained: async () => proc },
    CLIPVisionModelWithProjection: { from_pretrained: async () => { log.push('load namer'); const v = async () => ({ image_embeds: { data: [1, 0, 0], dims: [1, 3] } }); v.dispose = async () => { log.push('dispose namer'); }; return v; } } };
  const m = mkModels({ importer: async () => lib, sequential: true });
  const info = await m.loadNaming();
  assert.deepEqual(log, ['load namer']); assert.equal(info.segmenter, null); assert.equal(info.namer, 'Xenova/clip-vit-base-patch32');
  await m.classify(new Blob(['x']), ['uma foto de a']); await m.loadNaming();
  assert.deepEqual(log, ['load namer'], 'classify and a second loadNaming reuse the loaded namer');
  await m.load(); assert.deepEqual(log, ['load namer', 'dispose namer', 'load sam'], 'a later load() frees the namer first (sequential)');
  const seen = []; const lib2 = { ...lib, CLIPVisionModelWithProjection: { from_pretrained: async (id, o) => { seen.push(`${o.device}/${o.dtype}`); if (o.dtype === 'q4') throw new Error('no q4 here'); const v = async () => ({ image_embeds: { data: [1, 0, 0], dims: [1, 3] } }); v.dispose = async () => {}; return v; } } };
  const m2 = mkModels({ importer: async () => lib2, sequential: true });
  const i2 = await m2.loadNaming(() => {}, { backends: [['wasm', 'q4'], ['wasm', 'q8']] });
  assert.deepEqual(seen, ['wasm/q4', 'wasm/q8'], 'the given backends replace the naming list, in order (the CPU first on the naming page)'); assert.equal(i2.namer_backend, 'wasm/q8');
});
await t('parallel mode (desktop): both models load at load() and stay', async () => {
  const { T } = fakeLib(); const m = mkModels({ importer: async () => T, sequential: false });
  const info = await m.load(); assert.equal(info.sequential, false); assert.ok(info.segmenter && info.namer);
});

// ---------------------------------------------------------------- SAM decode: one prompt group per run, checked against the recorded ONNX contract (T-017, F-008)
// The contract is web/lib/model-contracts.json, recorded from the real ONNX files in CI (tools/probe-contracts.mjs). Until that file exists the
// hand-written, clearly marked fixture (web/lib/model-contracts.fixture.json: SAM 2.1 tiny decoder, input_points with dimension 1 fixed to 1, as the
// owner's device error proves) stands in for the parts it covers. Once the real file exists it is used and any mismatch fails.
const realContracts = existsSync(f('lib/model-contracts.json'));
const contracts = JSON.parse(text(realContracts ? 'lib/model-contracts.json' : 'lib/model-contracts.fixture.json'));
const fixture = JSON.parse(text('lib/model-contracts.fixture.json'));
const partialC = !realContracts; const SAM2 = 'onnx-community/sam2.1-hiera-tiny-ONNX';
const { gridPoints } = await import(pathToFileURL(f('estimate/autoseg.mjs')));
const probeContracts = await import(pathToFileURL(join(web, '..', 'tools', 'probe-contracts.mjs'))); const itTool = await import(pathToFileURL(join(web, '..', 'tools', 'model-integration-test.mjs')));
const decoderFiles = (id) => models.contractFiles(contracts, id, models.SAM_DECODER);
const F008 = { name: 'input_points', type: 'float32', dims: [1, 4, 1, 2], data: Array(8).fill(0) }; // what the app sent: 4 prompt groups in one run
await t('contracts: the real recording is complete (every SAM and naming file of every candidate and dtype), or the fixture is marked as one', () => {
  assert.equal(contracts.schema, 'macrofy.model-contracts/1');
  if (!realContracts) { assert.equal(fixture.fixture, true); assert.equal(fixture.partial, true); assert.match(fixture.note, /HAND-WRITTEN FIXTURE/); console.log('note: web/lib/model-contracts.json does not exist yet (the macrofy-models workflow writes it): the tests below use the hand-written fixture for SAM 2.1 tiny only'); return; }
  assert.ok(!contracts.fixture && !contracts.partial, 'the real contracts file must not be a fixture');
  const probe = JSON.parse(text('lib/model-probe.json'));
  for (const m of probeContracts.contractModels()) {
    if (m.kind === 'depth' && !probe.models.some((x) => x.id === m.id && x.revision)) continue; // depth is informational and only probed by newer workflow runs
    const { paths } = probeContracts.contractPaths(m, probe.models.find((x) => x.id === m.id)); const rec = contracts.models.find((x) => x.id === m.id);
    assert.ok(rec, `no contracts recorded for ${m.id}: run the macrofy-models workflow`);
    for (const p of paths) { const file = rec.files.find((x) => x.path === p); assert.ok(file, `${m.id}: ${p} is not recorded`); assert.ok(!file.error && file.inputs.length && file.outputs.length, `${m.id}: ${p} has no usable recording (${file.error ?? 'empty'})`); }
  }
});
await t('single tap: input_points [1,1,1,2] float32 and input_labels [1,1,1] int64, matching the input names, ranks and fixed dimensions of every recorded SAM decoder', () => {
  const tap = models.samPromptTensors([[3, 4]], [1]);
  assert.deepEqual(tap, [{ name: 'input_points', type: 'float32', dims: [1, 1, 1, 2], data: [3, 4] }, { name: 'input_labels', type: 'int64', dims: [1, 1, 1], data: [1] }]);
  let seen = 0;
  for (const c of models.SEGMENT_CANDIDATES) {
    for (const file of decoderFiles(c.id)) {
      seen++; assert.deepEqual(models.checkTensorSpecs(tap, file, { partial: partialC }), { ok: true, errors: [] }, file.path);
      assert.deepEqual(models.samPromptTensors([[3, 4]], [1], file, { partial: partialC }), tap);
      const enc = models.contractFiles(contracts, c.id, models.SAM_ENCODER).find((e) => e.path === file.path.replace(models.SAM_DECODER, models.SAM_ENCODER));
      if (realContracts) assert.ok(enc, `${file.path}: the matching vision encoder is not recorded`);
      assert.deepEqual(models.checkSamDecoder(file, { encoder: enc ?? null, partial: partialC }), [], file.path);
    }
    if (realContracts) for (const [, dtype] of models.backendsOf(c)) for (const part of [models.SAM_ENCODER, models.SAM_DECODER]) assert.ok(models.contractFiles(contracts, c.id, part).some((x) => x.path === models.onnxFileName(part, dtype)), `${c.id}: no ${part} contract for dtype ${dtype}`);
  }
  assert.ok(seen >= 1 && decoderFiles(SAM2).length >= 1, 'no SAM 2.1 tiny decoder contract to check against');
});
await t('grid of N points: N separate decoder runs, each one prompt group of one point, each matching the contract', () => {
  const pts = gridPoints(640, 480, 8); assert.equal(pts.length, 64);
  for (const file of decoderFiles(SAM2)) {
    const runs = pts.map((p) => models.samPromptTensors([[p.x, p.y]], [1], file, { partial: partialC }));
    assert.equal(runs.length, 64); assert.ok(runs.every((r) => r[0].dims.join() === '1,1,1,2' && r[1].dims.join() === '1,1,1' && models.checkTensorSpecs(r, file, { partial: partialC }).ok));
    assert.deepEqual(runs.map((r) => r[0].data), pts.map((p) => [p.x, p.y]));
  }
});
await t('negative fixture: the F-008 shape (4 in the dimension fixed to 1) is rejected, and so are wrong ranks, types, names and sizes', () => {
  const fx = fixture.models[0].files[0];
  const r = models.checkTensorSpecs([F008], fx, { partial: true });
  assert.equal(r.ok, false); assert.match(r.errors[0], /input_points: dimension 1 is 4, the model fixes it to 1/);
  for (const file of realContracts ? decoderFiles(SAM2) : []) assert.equal(models.checkTensorSpecs([F008], file).ok, false, file.path);
  assert.match(models.checkTensorSpecs([{ ...F008, dims: [1, 1, 2], data: [0, 0] }], fx, { partial: true }).errors[0], /rank 3.*expects rank 4/);
  assert.match(models.checkTensorSpecs([{ ...F008, dims: [1, 1, 1, 2], type: 'int64', data: [0, 0] }], fx, { partial: true }).errors[0], /type int64, the model expects float32/);
  assert.match(models.checkTensorSpecs([{ ...F008, dims: [1, 1, 1, 2], data: [0] }], fx, { partial: true }).errors[0], /1 values for dims/);
  assert.match(models.checkTensorSpecs([{ name: 'points', type: 'float32', dims: [1], data: [0] }], fx).errors[0], /"points" is not an input/); // strict: a name the model does not have
  const groupsOfOne = { path: 'x', inputs: [{ name: 'input_points', type: 'float32', dims: ['b', 1, 1, 2] }] }; // a model that fixes points per group to 1 too
  assert.throws(() => models.samPromptTensors([[1, 2], [3, 4]], [1, 1], groupsOfOne), /do modelo.*dimension 2 is 2, the model fixes it to 1/);
  assert.throws(() => models.samPromptTensors([], [], null), /pelo menos um ponto/); assert.throws(() => models.samPromptTensors([[1, 2]], [], null), /um rótulo/); assert.throws(() => models.samPromptTensors([[NaN, 2]], [1], null), /inválidos/);
});
await t('the tensor rank follows the contract (rank 4 with a prompt group, rank 3 without) and the whole-decoder check names unknown inputs', () => {
  const v1 = { path: 'v1', inputs: [{ name: 'input_points', type: 'float32', dims: ['b', 'pb', 'n', 2] }, { name: 'input_labels', type: 'int64', dims: ['b', 'pb', 'n'] }, { name: 'image_embeddings', type: 'float32', dims: ['b', 256, 64, 64] }, { name: 'image_positional_embeddings', type: 'float32', dims: ['b', 256, 64, 64] }] };
  assert.deepEqual(models.samPromptTensors([[1, 2]], [1], v1).map((s) => s.dims), [[1, 1, 1, 2], [1, 1, 1]]);
  assert.deepEqual(models.samPromptTensors([[1, 2], [3, 4]], [1, 0], v1).map((s) => s.dims), [[1, 1, 2, 2], [1, 1, 2]]); // several points of ONE group are fine where the contract allows it
  const flat = { path: 'flat', inputs: [{ name: 'input_points', type: 'float32', dims: ['b', 'n', 2] }, { name: 'input_labels', type: 'int64', dims: ['b', 'n'] }] };
  assert.deepEqual(models.samPromptTensors([[1, 2]], [1], flat).map((s) => s.dims), [[1, 1, 2], [1, 1]]);
  const enc = { path: 'e', outputs: [{ name: 'image_embeddings' }, { name: 'image_positional_embeddings' }] };
  assert.deepEqual(models.checkSamDecoder(v1, { encoder: enc }), []);
  assert.match(models.checkSamDecoder({ ...v1, inputs: [...v1.inputs, { name: 'point_mask', type: 'float32', dims: [1] }] })[0], /"point_mask" is neither built by samPromptTensors nor provided/);
  assert.match(models.checkSamDecoder(v1, { encoder: { path: 'e', outputs: [{ name: 'image_embeddings' }] } })[0], /"image_positional_embeddings" is not an output of e/);
  assert.match(models.checkSamDecoder({ path: 'd', inputs: [v1.inputs[2]] }).join(), /no input "input_points"/);
  assert.equal(models.scaleSamPoint({ x: 10, y: 20 }, [480, 640], [768, 1024]).x, 16); assert.equal(models.scaleSamPoint({ x: 10, y: 20 }, [480, 640], [768, 1024]).y, 32);
  assert.equal(models.onnxFileName('vision_encoder', 'q8'), 'onnx/vision_encoder_quantized.onnx'); assert.equal(models.onnxFileName('vision_model', 'fp32'), 'onnx/vision_model.onnx'); assert.equal(models.onnxFileName('x', 'q4f16'), 'onnx/x_q4f16.onnx');
});
// a decoder that enforces the recorded contract exactly like OrtRun does: the layer under test must survive it
const strictLib = ({ file, partial }) => {
  const { T } = fakeLib(); const calls = { decodes: [], embeds: 0, pre: 0, fail: false };
  const proc = async () => { calls.pre++; return { pixel_values: { p: 1 }, original_sizes: [[2, 2]], reshaped_input_sizes: [[4, 4]] }; };
  proc.post_process_masks = async () => [{ dims: [1, 3, 2, 2], data: new Uint8Array([1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0]) }]; // three 2x2 masks
  const model = async (inputs) => {
    if (calls.fail) throw new Error('decoder boom');
    const specs = ['input_points', 'input_labels'].map((name) => ({ name, type: inputs[name].type, dims: inputs[name].dims, data: Array.from(inputs[name].data, Number) }));
    const r = models.checkTensorSpecs(specs, file, { partial }); if (!r.ok) throw new Error(`failed to call OrtRun(). Got invalid dimensions for input: ${r.errors.join('; ')}`);
    calls.decodes.push(Object.fromEntries(specs.map((s) => [s.name, s]))); return { pred_masks: {}, iou_scores: { data: [0.2, 0.9, 0.5] } };
  };
  model.get_image_embeddings = async () => { calls.embeds++; return { 'image_embeddings.0': 'e' }; }; model.dispose = async () => {};
  return { T: { ...T, Sam2Model: { from_pretrained: async () => model }, AutoProcessor: { from_pretrained: async () => proc } }, calls };
};
const pts = (n) => Array.from({ length: n }, (_, i) => ({ x: i, y: 2 * i }));
await t('createModels with a contract-enforcing decoder: a tap and a grid decode one prompt group per run on an embedding computed once', async () => {
  const { T, calls } = strictLib({ file: decoderFiles(SAM2)[0], partial: partialC }); const m = mkModels({ importer: async () => T }); await m.load();
  const enc = await m.setImage(new Blob(['x'])); assert.equal(enc.cached, true); const pre = calls.pre; calls.decodes.length = 0;
  const tap = await m.segment(1, 1);
  assert.deepEqual(tap.map((x) => x.score), [0.9, 0.5, 0.2]); assert.deepEqual([...tap[0].data], [1, 1, 0, 0]);
  assert.deepEqual(calls.decodes[0].input_points.dims, [1, 1, 1, 2]); assert.deepEqual(calls.decodes[0].input_points.data, [2, 2]); // scaled from 2x2 to the 4x4 model input
  assert.equal(calls.decodes[0].input_labels.type, 'int64'); assert.deepEqual(calls.decodes[0].input_labels.dims, [1, 1, 1]); assert.deepEqual(calls.decodes[0].input_labels.data, [1]);
  const prog = []; const r = await m.segmentPoints(pts(10), { batch: 4, onProgress: (e) => prog.push(`${e.done}/${e.total}`) });
  assert.equal(r.decodes, 10); assert.equal(r.done, 10); assert.equal(r.timed_out, false); assert.equal(r.masks.length, 10); assert.equal(calls.decodes.length, 11);
  assert.ok(calls.decodes.every((d) => d.input_points.dims.join() === '1,1,1,2' && d.input_labels.dims.join() === '1,1,1')); // never more than one prompt group per run
  assert.deepEqual(calls.decodes.slice(1).map((d) => d.input_points.data), pts(10).map((p) => [2 * p.x, 2 * p.y]));
  assert.ok(r.masks.every((x) => x.score === 0.9 && x.width === 2 && x.height === 2 && x.data[0] === 1)); assert.deepEqual(r.masks.map((x) => x.point), pts(10));
  assert.deepEqual(prog, ['0/10', '4/10', '8/10', '10/10']); assert.equal(typeof r.ms, 'number');
  assert.equal(calls.embeds, 1); assert.equal(calls.pre, pre); // the photo was encoded and preprocessed once, not per decode
});
await t('segmentPoints: the time budget stops the grid early and says so; a failing decode is an error, not a silent fallback', async () => {
  const { T, calls } = strictLib({ file: decoderFiles(SAM2)[0], partial: partialC }); const m = mkModels({ importer: async () => T }); await m.load(); await m.setImage(new Blob(['x']));
  let clock = 0; const r = await m.segmentPoints(pts(12), { batch: 4, budgetMs: 250, now: () => (clock += 100) });
  assert.equal(r.timed_out, true); assert.equal(r.done, 8); assert.equal(r.masks.length, 8); assert.equal(r.total, 12);
  calls.fail = true; await assert.rejects(m.segmentPoints(pts(3)), /decoder boom/); await assert.rejects(m.segment(1, 1), /decoder boom/);
  await assert.rejects(mkModels({ importer: async () => T }).segmentPoints(pts(1)), /nenhuma foto/);
});
await t('createModels REFUSES what the old code sent: a decoder whose contract fixes the prompt group to 1 rejects a 4-group tensor, and the layer never builds one', async () => {
  const fx = fixture.models[0].files[0]; assert.throws(() => { const r = models.checkTensorSpecs([F008], fx, { partial: true }); if (!r.ok) throw new Error(r.errors[0]); }, /fixes it to 1/);
  const { T, calls } = strictLib({ file: fx, partial: true }); const m = mkModels({ importer: async () => T }); await m.load(); await m.setImage(new Blob(['x']));
  await m.segmentPoints(pts(9), { batch: 4 }); assert.ok(calls.decodes.every((d) => d.input_points.dims[1] === 1));
});
await t('naming contract: the vision tower takes only pixel_values [batch, 3, H, W] and one of its outputs is the embedding the app reads', () => {
  const clipLike = { path: 'onnx/vision_model_q8.onnx', inputs: [{ name: 'pixel_values', type: 'float32', dims: ['batch_size', 'num_channels', 'height', 'width'] }], outputs: [{ name: 'last_hidden_state' }, { name: 'image_embeds' }] };
  assert.deepEqual(models.checkNamingVision(clipLike), []);
  assert.deepEqual(models.checkNamingVision({ ...clipLike, inputs: [{ ...clipLike.inputs[0], dims: ['b', 3, 224, 224] }], outputs: [{ name: 'pooler_output' }] }), []);
  assert.match(models.checkNamingVision({ ...clipLike, inputs: [...clipLike.inputs, { name: 'attention_mask', type: 'int64', dims: ['b', 'n'] }] })[0], /feeds only pixel_values/);
  assert.match(models.checkNamingVision({ ...clipLike, inputs: [{ ...clipLike.inputs[0], dims: ['b', 'h', 'w'] }] })[0], /expected \[batch, 3, H, W\]/);
  assert.match(models.checkNamingVision({ ...clipLike, inputs: [{ ...clipLike.inputs[0], dims: ['b', 1, 224, 224] }] })[0], /expected \[batch, 3, H, W\]/);
  assert.match(models.checkNamingVision({ ...clipLike, outputs: [{ name: 'logits' }] })[0], /none of image_embeds\/pooler_output\/embeds/);
  assert.equal(models.pickEmbedding({ pooler_output: 'p', embeds: 'e' }), 'p'); assert.equal(models.pickEmbedding({ image_embeds: 'i', pooler_output: 'p' }), 'i'); assert.equal(models.pickEmbedding({ other: 1 }), undefined);
  let checked = 0;
  for (const c of models.NAMING_CANDIDATES) for (const file of models.contractFiles(contracts, c.id, 'vision_model')) { checked++; assert.deepEqual(models.checkNamingVision(file), [], file.path); }
  if (realContracts) assert.ok(checked >= models.NAMING_CANDIDATES.length, 'a vision tower contract per naming candidate'); else console.log('note: naming contracts are checked once the real contracts file exists (the fixture covers only the SAM 2.1 decoder)');
});
await t('the contract probe: protobuf reader (graph inputs and outputs, initializers excluded, symbolic and unknown dimensions) and the files it records', () => {
  const varint = (n) => { const b = []; while (n >= 128) { b.push((n % 128) | 128); n = Math.floor(n / 128); } b.push(n); return b; };
  const v = (fld, n) => Buffer.from([...varint(fld * 8), ...varint(n)]); const b = (fld, buf) => Buffer.concat([Buffer.from(varint(fld * 8 + 2)), Buffer.from(varint(buf.length)), Buffer.from(buf)]); const s = (fld, str) => b(fld, Buffer.from(str));
  const dim = (d) => b(1, typeof d === 'number' ? v(1, d) : typeof d === 'string' ? s(2, d) : Buffer.alloc(0));
  const vi = (name, elem, dims) => Buffer.concat([s(1, name), b(2, b(1, Buffer.concat([v(1, elem), ...(dims ? [b(2, Buffer.concat(dims.map(dim)))] : [])])))]);
  const onnx = Buffer.concat([v(1, 8), b(7, Buffer.concat([s(2, 'g'), b(5, Buffer.concat([s(8, 'w'), b(9, Buffer.alloc(300, 7))])),
    b(11, vi('input_points', 1, ['batch_size', 1, 'num_points', 2])), b(11, vi('input_labels', 7, ['batch_size', 1, 'num_points'])), b(11, vi('mask', 9, ['b', null, 4])), b(11, vi('w', 1, [3])),
    b(12, vi('pred_masks', 1, ['batch_size', 1, 3, 256, 256])), b(12, vi('scalar', 10, [])), b(12, vi('noshape', 16, null))]))]);
  assert.deepEqual(probeContracts.parseOnnxIO(onnx), {
    inputs: [{ name: 'input_points', type: 'float32', dims: ['batch_size', 1, 'num_points', 2] }, { name: 'input_labels', type: 'int64', dims: ['batch_size', 1, 'num_points'] }, { name: 'mask', type: 'bool', dims: ['b', null, 4] }],
    outputs: [{ name: 'pred_masks', type: 'float32', dims: ['batch_size', 1, 3, 256, 256] }, { name: 'scalar', type: 'float16', dims: [] }, { name: 'noshape', type: 'bfloat16', dims: null }] });
  assert.throws(() => probeContracts.parseOnnxIO(onnx.subarray(0, onnx.length - 3)), /truncated/); assert.throws(() => probeContracts.parseOnnxIO(Buffer.alloc(0)), /no graph/);
  // the recorded input feeds the checker: a contract parsed from a graph rejects the F-008 tensor
  const file = { path: 'p', ...probeContracts.parseOnnxIO(onnx) }; assert.equal(models.checkTensorSpecs([F008], file).ok, false); assert.equal(models.checkTensorSpecs(models.samPromptTensors([[1, 2]], [1]), file).ok, true);
  const ms = probeContracts.contractModels(); const sam2 = ms.find((m) => m.id === SAM2);
  assert.deepEqual(ms.map((m) => m.kind), ['segmentation', 'segmentation', 'naming', 'naming', 'naming', 'depth', 'depth']); assert.deepEqual(sam2.parts, ['vision_encoder', 'prompt_encoder_mask_decoder']); assert.deepEqual([...sam2.dtypes].sort(), ['fp16', 'q4f16', 'q8']);
  const cp = probeContracts.contractPaths(sam2, { onnx: [{ path: 'onnx/vision_encoder_quantized.onnx' }, { path: 'onnx/prompt_encoder_mask_decoder_q4f16.onnx' }, { path: 'onnx/other.onnx' }] });
  assert.deepEqual(cp.paths, ['onnx/prompt_encoder_mask_decoder_q4f16.onnx', 'onnx/vision_encoder_quantized.onnx']); assert.equal(cp.missing.length, 4);
  const probe = JSON.parse(text('lib/model-probe.json'));
  for (const m of ms.filter((x) => x.kind !== 'depth')) assert.deepEqual(probeContracts.contractPaths(m, probe.models.find((x) => x.id === m.id)).missing, [], `${m.id}: a dtype the app loads has no file in the repository`);
});
await t('the CI integration test, dry run against a fake library: image, cpu mapping, single tap, grid, auto mode, naming, summary and failure reporting', async () => {
  const photo = itTool.makePlateImage(); assert.equal(photo.data.length, 640 * 480 * 4);
  const px = (x, y) => [...photo.data.subarray((y * 640 + x) * 4, (y * 640 + x) * 4 + 3)];
  const corner = px(2, 2); assert.ok(corner[0] > 100 && corner[0] < 135 && corner[2] === 58, "a wooden table corner");
  assert.deepEqual(px(Math.round(photo.blobs[0].cx), Math.round(photo.blobs[0].cy)), [200, 50, 40]); assert.ok(px(320, 100).every((c) => c > 190)); // the plate near its top edge
  const crop = itTool.cropRgba(photo, { width: 640, height: 480, data: (() => { const m = new Uint8Array(640 * 480); m[100 * 640 + 200] = 1; m[110 * 640 + 230] = 1; return m; })() }, 4);
  assert.equal(crop.width, 39); assert.equal(crop.height, 32); assert.equal(crop.data.length, 39 * 32 * 4); // 31 wide + 2 x 4 padding; the height is raised to the 32 minimum
  const seen = []; const raw = class { constructor(...a) { this.a = a; } static async fromBlob() { throw new Error('not unwrapped'); } };
  const lib = itTool.nodeLib({ env: {}, RawImage: raw, Sam2Model: { from_pretrained: async (id, o) => { seen.push(o.device); return {}; } }, AutoProcessor: { from_pretrained: async () => ({}) } });
  await lib.Sam2Model.from_pretrained('x', { device: 'wasm', dtype: 'q8' }); await lib.Sam2Model.from_pretrained('x', { device: 'webgpu' }); assert.deepEqual(seen, ['cpu', 'webgpu']);
  const wrapped = { raw: 1 }; assert.equal(await lib.RawImage.fromBlob(wrapped), 1); assert.equal(new lib.RawImage(1, 2, 3, 4).a.length, 4);
  assert.deepEqual(itTool.cpuCandidate(models.SEGMENT_CANDIDATES[1]).backends, [['wasm', 'q8']]);
  // a fake library that answers with image-sized masks: the whole script runs and reports
  const W = 640; const H = 480; const { T } = fakeLib();
  class Img { constructor(data, width, height, channels) { Object.assign(this, { data, width, height, channels }); } static async fromBlob() { throw new Error('unwrapped by nodeLib'); } }
  const PV = { dims: [1, 3, 1024, 1024] }; // the padded model input; the 640x480 photo is resized into its top-left 1024x768
  const proc = async () => ({ pixel_values: PV, original_sizes: [[H, W]], reshaped_input_sizes: [[768, 1024]] });
  // SAM's low-res logits (3 x 256 x 256 over the padded input): low-res pixel (x, y) is photo pixel (2.5 x, 2.5 y) (x4 to the input, /1.6 to the photo)
  const LR = 256; const logits = (shapes) => { const d = new Float32Array(3 * LR * LR).fill(-5); shapes.forEach((inside, k) => { if (inside) for (let y = 0; y < LR; y++) for (let x = 0; x < LR; x++) if (inside((x + 0.5) * 2.5, (y + 0.5) * 2.5)) d[k * LR * LR + y * LR + x] = 5; }); return { dims: [1, 1, 3, LR, LR], data: d }; };
  const inPlate = (x, y) => ((x - 320) / 240) ** 2 + ((y - 240) / 170) ** 2 <= 1;
  let last = [0, 0]; // the point of the latest decode, in photo pixels: mask 0 is a food-sized disc there, mask 1 the plate, mask 2 empty (three multimask outputs)
  const plateMask = Uint8Array.from({ length: H * W }, (_, q) => (((q % W - 320) / 240) ** 2 + ((Math.floor(q / W) - 240) / 170) ** 2 <= 1 ? 1 : 0));
  proc.post_process_masks = async () => { const data = new Uint8Array(3 * H * W); data.set(plateMask, H * W); for (let y = Math.max(0, Math.round(last[1]) - 30); y <= Math.min(H - 1, Math.round(last[1]) + 30); y++) for (let x = Math.max(0, Math.round(last[0]) - 30); x <= Math.min(W - 1, Math.round(last[0]) + 30); x++) if ((x - last[0]) ** 2 + (y - last[1]) ** 2 <= 900) data[y * W + x] = 1; return [{ dims: [1, 3, H, W], data }]; };
  const model = async (inputs) => { const p = [inputs.input_points.data[0] / 1.6, inputs.input_points.data[1] / 1.6]; last = p; return { pred_masks: logits([(x, y) => (x - p[0]) ** 2 + (y - p[1]) ** 2 <= 900, inPlate, null]), iou_scores: { data: [0.95, 0.9, 0.5] } }; }; model.get_image_embeddings = async () => ({ 'image_embeddings.0': 'e' }); model.dispose = async () => {};
  const vocab = JSON.parse(text('../nutrition/vocab.json')); const labels = vocab.classes.map((c) => c.pt); const dim = 4;
  const vision = async () => ({ image_embeds: { data: Float32Array.from([1, 0, 0, 0]), dims: [1, dim] } }); vision.dispose = async () => {};
  const emb = async (id) => ({ ...(await fakeEmb(id, labels)), dim, embeddings: labels.map((_, i) => { const v = [0, 0, 0, 0]; v[i % dim] = 1; return v; }), extra_labels: JSON.parse(text('estimate/priors.json')).autoseg.non_food_labels.value, extra_embeddings: JSON.parse(text('estimate/priors.json')).autoseg.non_food_labels.value.map(() => [0, 0, 0, 1]) });
  const fake = { ...T, RawImage: Img, Sam2Model: { from_pretrained: async () => model }, SamModel: { from_pretrained: async () => model }, AutoProcessor: { from_pretrained: async () => proc }, CLIPVisionModelWithProjection: { from_pretrained: async () => vision }, SiglipVisionModel: { from_pretrained: async () => vision } };
  const photoImg = itTool.makePlateImage(); const photoMeta = { title: 'File:Test plate.jpg', url: 'https://upload.example/x.jpg', license: 'CC BY-SA 4.0', author: 'A', sha256: 'a'.repeat(64), pinned: true, pin: {} };
  const run = await itTool.runIntegration({ T: fake, root: join(web, '..'), loadEmbeddings: emb, gridN: 3, loadPhoto: async () => ({ img: photoImg, meta: photoMeta }) });
  assert.equal(run.ok, true, JSON.stringify(run.summary.failures));
  assert.deepEqual(run.summary.sam.map((e) => e.id), models.SEGMENT_CANDIDATES.map((c) => c.id));
  for (const e of run.summary.sam) { assert.equal(e.single_tap.masks, 3); assert.equal(e.single_tap.best_iou, 0.95); assert.equal(e.grid.points, 9); assert.equal(e.grid.decodes, 9); assert.equal(e.auto.status, 'ok'); assert.ok(e.auto.items.length >= 1); assert.ok(e.auto.plate_rows.length >= 25 * 3 && e.auto.plate_rows.some((r) => r[8] === 'ok') && e.auto.plate_cols.length === e.auto.plate_rows[0].length); for (const k of ['encoder_ms', 'plate_decode_ms', 'food_decode_ms', 'naming_ms', 'total_ms']) assert.equal(typeof e.auto.timings[k], 'number', k); assert.equal(e.naming.top3.length, 3); assert.equal(e.load.backend, 'wasm/q8'); }
  const proven = run.summary.sam.find((e) => e.id === models.PROVEN_ATTEMPTS[0][0]); assert.equal(proven.photo.title, photoMeta.title); assert.equal(proven.photo.auto.ok, true); assert.equal(proven.photo.auto.status, 'ok'); assert.ok(!run.summary.sam.find((e) => e !== proven).photo); // the real photo runs on the proven segmenter only
  for (const e of run.summary.sam) assert.ok(e.lowres.ious[0] >= 0.9 && e.lowres.mask_size === '384x288', JSON.stringify(e.lowres)); // the low-res logits path matches the full-size masks
  assert.equal(run.summary.warnings.length, 0);
  assert.equal(run.summary.naming.length, 2); assert.ok(run.summary.naming.every((n) => n.ok)); JSON.parse(JSON.stringify(run.summary));
  // failures are reported per stage: a decoder that answers with masks of the wrong size fails the run
  const bad = { ...fake, Sam2Model: { from_pretrained: async () => Object.assign(async () => ({ pred_masks: {}, iou_scores: { data: [0.3, NaN, 0.5] } }), { get_image_embeddings: model.get_image_embeddings, dispose: model.dispose }) } };
  const worse = await itTool.runIntegration({ T: bad, root: join(web, '..'), loadEmbeddings: emb, gridN: 2 });
  const flat = { ...fake, Sam2Model: { from_pretrained: async () => Object.assign(async () => ({ pred_masks: logits([(x) => x < 40, null, null]), iou_scores: { data: [0.95, 0.9, 0.5] } }), { get_image_embeddings: model.get_image_embeddings, dispose: model.dispose }) }, AutoProcessor: { from_pretrained: async () => Object.assign(async () => ({ pixel_values: PV, original_sizes: [[H, W]], reshaped_input_sizes: [[768, 1024]] }), { post_process_masks: async () => [{ dims: [1, 3, H, W], data: Uint8Array.from({ length: 3 * H * W }, (_, i) => (i < H * W ? ((i % W) < 40 ? 1 : 0) : 0)) }] }) } }; // only a strip on the left: never a plate
  const noPlate = await itTool.runIntegration({ T: flat, root: join(web, '..'), loadEmbeddings: emb, gridN: 2, loadPhoto: async () => ({ img: photoImg, meta: photoMeta }) });
  assert.equal(noPlate.ok, false); const np = noPlate.summary.sam.find((e) => e.id === models.PROVEN_ATTEMPTS[0][0]);
  assert.equal(np.auto.ok, false); assert.match(np.auto.error, /found no plate.*plate_rows/); assert.equal(np.auto.status, 'empty_plate'); assert.equal(np.auto.plate_detected, false); // zero setup: the fallback ran, found nothing assert.ok(np.auto.plate_rows.length > 0 && np.auto.plate_rows.every((r) => r[8] === 'too_small' || r[8] === 'off_center' || r[8] === 'empty'), JSON.stringify(np.auto.plate_rows.slice(0, 2)));
  assert.match(noPlate.summary.failures.join('|'), /photo_auto: auto mode on File:Test plate.jpg found no food item/); // a real photo must give at least one food (plate detected or the stand-in); SlimSAM is not required
  // an unpinned photo only warns; a photo that cannot be loaded or whose hash changed: failure when pinned, warning when not
  const unpinned = await itTool.runIntegration({ T: flat, root: join(web, '..'), loadEmbeddings: emb, gridN: 2, loadPhoto: async () => ({ img: photoImg, meta: { ...photoMeta, pinned: false, pin: { title: photoMeta.title } } }) });
  assert.ok(unpinned.summary.warnings.some((x) => /unpinned test photo: paste this into tools\/it-photo.json/.test(x)) && unpinned.summary.warnings.some((x) => /unpinned photo: .*found no food item/.test(x)) && !unpinned.summary.failures.some((x) => /photo_auto/.test(x)));
  const changed = await itTool.runIntegration({ T: fake, root: join(web, '..'), loadEmbeddings: emb, gridN: 2, loadPhoto: async () => { throw Object.assign(new Error('the photo changed: sha256 is x'), { hashChanged: true }); } });
  assert.equal(changed.ok, false); assert.match(changed.summary.failures.join('|'), /photo: the photo changed/);
  const offline = await itTool.runIntegration({ T: fake, root: join(web, '..'), loadEmbeddings: emb, gridN: 2, loadPhoto: async () => { throw new Error('HTTP 503'); } });
  assert.equal(offline.ok, true); assert.match(offline.summary.warnings.join('|'), /photo not available \(unpinned\): HTTP 503/);
  assert.equal(worse.ok, false); assert.ok(worse.summary.failures.some((x) => /single_tap: .*predicted IoU NaN is not finite/.test(x)), worse.summary.failures.join('|'));
});
await t('the real test photo: open licences only, pinned by sha256, a changed file is a failure, an unpinned one is reported for pinning', async () => {
  const ph = await import(pathToFileURL(join(web, '..', 'tools', 'it-photo.mjs'))); const { createHash } = await import('node:crypto');
  for (const ok of ['CC0', 'Public domain', 'CC BY 2.0', 'CC BY-SA 4.0', 'PD-old']) assert.equal(ph.licenseAllowed(ok), true, ok);
  for (const no of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'CC BY-NC-SA 3.0', 'Fair use', '', undefined, 'All rights reserved']) assert.equal(ph.licenseAllowed(no), false, String(no));
  const info = (title, over = {}) => ({ title, imageinfo: [{ url: `https://upload.example/${title}`, mime: 'image/jpeg', width: 1200, height: 900, extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Ann</a>  Lee' } }, ...over }] });
  const json = { query: { pages: { 3: info('File:C.jpg'), 1: info('File:A.png', { mime: 'image/png' }), 2: info('File:B.jpg', { extmetadata: { LicenseShortName: { value: 'CC BY-NC 2.0' } } }), 4: info('File:A small.jpg', { width: 500 }), 5: info('File:D.jpg') } } };
  assert.deepEqual(ph.pickCommonsPhoto(json), { title: 'File:C.jpg', url: 'https://upload.example/File:C.jpg', license: 'CC BY-SA 4.0', author: 'Ann Lee', width: 1200, height: 900 }); // png, non-open licence and too small are skipped; the first by title wins
  assert.equal(ph.pickCommonsPhoto({ query: { pages: { 1: info('File:x.jpg', { mime: 'image/gif' }) } } }), null); assert.equal(ph.pickCommonsPhoto({}), null);
  assert.match(ph.commonsQuery({ search: 'plate of food' }), /generator=search.*gsrsearch=plate\+of\+food\+filetype%3Abitmap.*gsrnamespace=6/); assert.match(ph.commonsQuery({ title: 'File:A b.jpg' }), /titles=File%3AA\+b\.jpg/);
  const bytes = Buffer.from('jpeg bytes'); const sha = createHash('sha256').update(bytes).digest('hex'); const seen = [];
  const fetchImpl = async (url, o) => { seen.push([url, o.headers['User-Agent']]); return url.startsWith(ph.API) ? { ok: true, json: async () => json } : url.endsWith('C.jpg') ? { ok: true, arrayBuffer: async () => bytes } : { ok: false, status: 404 }; };
  const un = await ph.resolvePhoto({ search: 'plate' }, { fetchImpl }); assert.equal(un.pinned, false); assert.equal(un.sha256, sha); assert.deepEqual(un.pin, { title: 'File:C.jpg', url: 'https://upload.example/File:C.jpg', license: 'CC BY-SA 4.0', author: 'Ann Lee', sha256: sha });
  assert.ok(seen.length === 2 && seen.every(([, ua]) => /^macrofy-model-it\//.test(ua)));
  const pinned = await ph.resolvePhoto({ title: 'File:C.jpg', sha256: sha }, { fetchImpl }); assert.equal(pinned.pinned, true);
  await assert.rejects(ph.resolvePhoto({ title: 'File:C.jpg', sha256: 'f'.repeat(64) }, { fetchImpl }), (e) => e.hashChanged === true && /changed: sha256 is/.test(e.message));
  await assert.rejects(ph.resolvePhoto({ search: 'x' }, { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), /no open-licensed JPEG/);
  await assert.rejects(ph.resolvePhoto({ search: 'x' }, { fetchImpl: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  const cfg = JSON.parse(readFileSync(join(web, '..', 'tools', 'it-photo.json'), 'utf8')); assert.ok(cfg.sha256 === null || /^[0-9a-f]{64}$/.test(cfg.sha256)); assert.ok(cfg.title === null || /^File:/.test(cfg.title)); assert.ok(cfg.search);
  if (cfg.sha256) { assert.ok(cfg.title && ph.licenseAllowed(cfg.license), 'a pinned photo records its title and an open licence'); }
});
await t('the 4.3.0 to 3.8.1 fallback and the injectable model layer are unchanged by the per-point decode', async () => {
  const { T } = fakeLib(); const seen = [];
  const m = mkModels({ importer: async (u) => { seen.push(u.split('@').pop()); if (u.endsWith('@4.3.0')) throw new Error('404'); return T; } });
  assert.equal((await m.load()).version, '3.8.1'); assert.deepEqual(seen, ['4.3.0', '3.8.1']);
  for (const fn of ['load', 'setImage', 'segment', 'segmentPoints', 'classify']) assert.equal(typeof m[fn], 'function', fn);
});

// ---------------------------------------------------------------- capture app (web/app)
const { staleCopies, COPIES } = await import(pathToFileURL(f('sync-data.mjs')));
const appFiles = ['index.html', 'app.css', 'app.mjs', 'lib.mjs', 'db.mjs', 'estimate.mjs', 'accuracy.mjs', 'sw.js', 'manifest.webmanifest', 'vendor/calibration.mjs', 'vendor/metrics.mjs', 'vendor/schema-core.mjs', 'vendor/lookup-core.mjs', 'vendor/estimate-core.mjs', 'vendor/models.mjs', 'vendor/autoseg.mjs', 'data/vocab.json', 'data/priors.json', 'data/calibration.json', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
t('capture app files exist', () => appFiles.forEach((p) => assert.ok(existsSync(f(`app/${p}`)), `missing web/app/${p}`)));
t('DRIFT: web/app copies equal their sources (else run node web/sync-data.mjs)', () => {
  const stale = staleCopies();
  assert.deepEqual(stale.map((c) => c.to), [], `stale copies: ${stale.map((c) => c.to).join(', ')}. Run: node web/sync-data.mjs`);
  for (const to of ['web/app/vendor/lookup-core.mjs', 'web/app/vendor/estimate-core.mjs', 'web/app/vendor/models.mjs', 'web/app/vendor/autoseg.mjs', 'web/app/vendor/calibration.mjs', 'web/app/vendor/metrics.mjs', 'web/app/data/priors.json', 'web/app/data/calibration.json']) assert.ok(COPIES.some((c) => c.to === to), `sync-data.mjs does not copy ${to}`);
});
t('the drift check really fails on a stale copy', () => {
  const copy = COPIES.find((c) => c.to.endsWith('vocab.json')); const p = f(copy.to.replace(/^web\//, ''));
  const good = readFileSync(p);
  try { writeFileSync(p, Buffer.concat([good, Buffer.from(' ')])); assert.deepEqual(staleCopies().map((c) => c.to), [copy.to]); }
  finally { writeFileSync(p, good); }
  assert.deepEqual(staleCopies(), []);
});
t('the drift check also catches a stale estimation core, the automatic-mode module and priors', () => {
  for (const to of ['web/app/vendor/estimate-core.mjs', 'web/app/vendor/autoseg.mjs', 'web/app/vendor/calibration.mjs', 'web/app/vendor/metrics.mjs', 'web/app/data/priors.json']) {
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
  for (const p of ['app.mjs', 'lib.mjs', 'db.mjs', 'estimate.mjs', 'accuracy.mjs', 'sw.js', 'index.html', 'manifest.webmanifest']) {
    assert.doesNotMatch(text(`app/${p}`).replace(/xmlns="[^"]*"/g, ''), /(?:src|href|fetch\(|register\(|from )\s*=?\s*['"]\/[^/]/, `root-relative URL in web/app/${p}`);
  }
});
t('app has the home actions and the required file input', () => {
  const js = text('app/app.mjs');
  assert.match(js, /Pesar refeição/); assert.match(js, /Apontar para o prato/); assert.match(js, /Ajustes \/ Corrigir/); assert.match(js, /href: '#\/accuracy'/); assert.doesNotMatch(js, /Estimar \(em breve\)/); assert.match(js, /capture: 'environment'/); assert.match(js, /accept: 'image\/\*'/);
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
  for (const re of [/Toque uma vez na borda do prato/, /Toque em cada alimento/, /outro…/, /oil_levels/, /Não calibrado/, /Exportar previsões/, /Salvar estimativa/, /__macrofyModels/, /namePrompts/, /toPredictions/, /Esta refeição também foi pesada\?/, /Encontrando o prato…/, /Encontrando os alimentos…/, /Modo manual/, /detectAuto/, /segmentPoints/, /plateSetup/, /timings/, /estimate_draft/, /Adicionar alimento/, /Juntar com…/, /Dividir/, /Remover/, /Trocar nome/]) assert.match(js, re);
});
t('estimation files exist and the estimate selftest is registered', () => {
  for (const p of ['estimate/core.mjs', 'estimate/priors.json', 'estimate/calibration.json', 'estimate/calibration.mjs', 'estimate/selftest.mjs', 'estimate/calibration-selftest.mjs']) assert.ok(existsSync(f(p)), `missing web/${p}`);
  const checks = JSON.parse(readFileSync(join(web, '..', 'control', 'checks.json'), 'utf8')).checks;
  assert.deepEqual(checks.find((c) => c.id === 'estimator-selftest')?.cmd, ['node', 'web/estimate/selftest.mjs']);
});
t('landing page links to the capture app', () => assert.match(text('index.html'), /href="app\/"/));

// ---------------------------------------------------------------- T-015: probe order, text-embedding provenance, CI tool and workflow
const clipId = 'Xenova/clip-vit-base-patch32';
await t('checkEmbeddings: model id, revision, labels hash, label list, shape and unit norm are all checked against the current vocab', async () => {
  const labels = ['a', 'b']; const ok = await models.checkEmbeddings(await fakeEmb(clipId), { modelId: clipId, labels }); assert.deepEqual(ok, { ok: true });
  const bad = async (over, re, l = labels) => { const r = await models.checkEmbeddings(await fakeEmb(clipId, labels, over), { modelId: clipId, labels: l }); assert.equal(r.ok, false); assert.match(r.reason, re); };
  assert.deepEqual(await models.checkEmbeddings(null, { modelId: clipId, labels }), { ok: false, reason: 'file missing' });
  await bad({ model_id: 'x/y' }, /file is for x\/y/); await bad({ revision: '' }, /revision/); await bad({ prompt_template: 'sem marcador' }, /prompt_template/);
  await bad({ labels_sha256: 'abc' }, /labels hash differs/); await bad({ labels: ['a', 'c'] }, /label list differs|hash/);
  await bad({}, /labels hash differs/, ['a', 'b', 'c']); await bad({ dim: 4 }, /shape/); await bad({ embeddings: [[1, 0, 0]] }, /shape/);
  await bad({ embeddings: [[2, 0, 0], [0, 1, 0]] }, /not normalized/); await bad({ extra_embeddings: [] }, /extra/);
  assert.equal(models.safeModelId('onnx-community/siglip2-base-patch16-224-ONNX'), 'onnx-community__siglip2-base-patch16-224-ONNX');
  assert.equal(await models.labelsSha256(['a', 'b']), await models.labelsSha256(['a', 'b'])); assert.notEqual(await models.labelsSha256(['a', 'b']), await models.labelsSha256(['b', 'a']));
});
await t('orderBySize: smallest vision file first from the probe; unknown sizes keep the default order; loadProbe reads the file or gives null', async () => {
  const P = (id, sizes) => ({ id, revision: 'r', onnx: sizes.map(([path, size]) => ({ path, size })) });
  const probe = { models: [
    P(clipId, [['onnx/vision_model.onnx', 350e6], ['onnx/vision_model_quantized.onnx', 88e6], ['onnx/text_model.onnx', 250e6]]),
    P('Xenova/siglip-base-patch16-224', [['onnx/vision_model.onnx', 370e6], ['onnx/vision_model_quantized.onnx', 95e6]]),
    P('onnx-community/siglip2-base-patch16-224-ONNX', [['onnx/vision_model_q4.onnx', 60e6], ['onnx/text_model_q4.onnx', 300e6]])] };
  assert.equal(models.candidateBytes(models.NAMING_CANDIDATES[0], probe), 88e6); // the text tower does not count
  assert.deepEqual(models.orderBySize(models.NAMING_CANDIDATES, probe).map((c) => c.id), ['onnx-community/siglip2-base-patch16-224-ONNX', clipId, 'Xenova/siglip-base-patch16-224']);
  const partial = { models: probe.models.slice(0, 2) };
  assert.deepEqual(models.orderBySize(models.NAMING_CANDIDATES, partial).map((c) => c.id), models.NAMING_CANDIDATES.map((c) => c.id)); // one unknown: no guessing
  assert.deepEqual(models.orderBySize(models.NAMING_CANDIDATES, null).map((c) => c.id), models.NAMING_CANDIDATES.map((c) => c.id));
  assert.deepEqual(models.NAMING_CANDIDATES.map((c) => c.id), [clipId, 'Xenova/siglip-base-patch16-224', 'onnx-community/siglip2-base-patch16-224-ONNX']); // the arrays themselves are never reordered
  const { T, calls } = fakeLib(); const info = await mkModels({ importer: async () => T, probe }).load();
  assert.equal(info.namer, 'onnx-community/siglip2-base-patch16-224-ONNX'); assert.equal(calls.vision[0].o.revision, 'rev-onnx-community/siglip2-base-patch16-224-ONNX');
  const tmp = join(tmpdir(), `macrofy-probe-${process.pid}.json`); writeFileSync(tmp, JSON.stringify({ ...probe, schema: 'x' }));
  try { assert.equal((await models.loadProbe([pathToFileURL(tmp)])).models.length, 3); } finally { rmSync(tmp); }
  assert.equal(await models.loadProbe([pathToFileURL(join(tmpdir(), 'macrofy-no-such-probe.json'))]), null);
});
t('a committed model-probe file (once the workflow has run) is well formed and covers every candidate; the app copy is in sync', () => {
  const p = f('lib/model-probe.json'); if (!existsSync(p)) return; // written by the workflow, so it may not exist yet
  const probe = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(probe.schema, 'macrofy.model-probe/1');
  for (const c of [...models.SEGMENT_CANDIDATES, ...models.NAMING_CANDIDATES]) assert.ok(probe.models.some((m) => m.id === c.id), `probe lacks ${c.id}`);
  assert.deepEqual(staleCopies().map((c) => c.to), []);
});
await t('committed text-embedding files (once the workflow has run) match their model and pass the provenance check against their own labels', async () => {
  const dir = f('app/data/text-emb'); if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const file = JSON.parse(readFileSync(join(dir, name), 'utf8')); const c = models.NAMING_CANDIDATES.find((x) => models.safeModelId(x.id) === name.replace(/\.json$/, ''));
    assert.ok(c && file.model_id === c.id, `${name} is not a naming candidate's file`);
    assert.deepEqual(await models.checkEmbeddings(file, { modelId: c.id, labels: file.labels }), { ok: true }, name);
    const vocab = JSON.parse(readFileSync(join(web, '..', 'nutrition', 'vocab.json'), 'utf8')).classes.map((x) => x.pt);
    if (file.labels_sha256 !== await models.labelsSha256(vocab)) console.log(`note: ${name} is stale against the vocab; the app reports "embeddings missing/stale" until the macrofy-models workflow rebuilds it`);
  }
});

const tools = await import(pathToFileURL(join(web, '..', 'tools', 'build-text-embeddings.mjs')));
const coreMod = await import(pathToFileURL(f('estimate/core.mjs')));
await t('build-text-embeddings: a file over the REAL vocab passes the app provenance check, serializes losslessly and names the right label end to end', async () => {
  const vocab = JSON.parse(readFileSync(join(web, '..', 'nutrition', 'vocab.json'), 'utf8'));
  const extra = JSON.parse(readFileSync(f('estimate/priors.json'), 'utf8')).autoseg.non_food_labels.value;
  const vec = (s) => { const v = new Array(24).fill(0); for (let i = 0; i < s.length; i++) v[(s.charCodeAt(i) * 7 + i) % 24] += (s.charCodeAt(i) % 5) + 1; return v; }; // deterministic stand-in for a text tower
  const seen = []; const embed = async (texts) => { seen.push(...texts); return texts.map(vec); };
  const file = await tools.buildEmbeddingFile({ modelId: clipId, revision: 'abc123', classes: vocab.classes, extraLabels: extra, embed });
  assert.ok(seen.includes(coreMod.NAME_PROMPT(vocab.classes[0].pt))); assert.ok(seen.includes(`a photo of ${vocab.classes[0].en}`)); assert.ok(seen.includes(coreMod.NAME_PROMPT(extra[0])));
  assert.equal(file.prompt_template, coreMod.NAME_PROMPT('{}')); assert.equal(file.dim, 24); assert.equal(file.embeddings.length, vocab.classes.length); assert.deepEqual(file.extra_labels, extra);
  assert.deepEqual(await models.checkEmbeddings(file, { modelId: clipId, labels: vocab.classes.map((c) => c.pt) }), { ok: true });
  assert.deepEqual(JSON.parse(tools.serializeEmbeddingFile(file)), file);
  assert.deepEqual(tools.probeEntry('m/x', 'naming', { sha: 's', siblings: [{ rfilename: 'onnx/vision_model.onnx', size: 5 }, { rfilename: 'onnx/text_model.onnx', lfs: { size: 7 } }, { rfilename: 'README.md', size: 1 }] }),
    { id: 'm/x', kind: 'naming', revision: 's', onnx: [{ path: 'onnx/text_model.onnx', size: 7 }, { path: 'onnx/vision_model.onnx', size: 5 }], has_vision_model: true, has_text_model: true });
  const target = 10; const { T } = fakeLib(); // an image whose embedding equals the text embedding of class 10 is named class 10
  const view = { data: Float32Array.from(file.embeddings[target]), dims: [1, 24] }; const vm = async () => ({ image_embeds: view }); vm.dispose = async () => {};
  const m = mkModels({ importer: async () => ({ ...T, CLIPVisionModelWithProjection: { from_pretrained: async () => vm } }), labels: vocab.classes.map((c) => c.pt), loadEmbeddings: async () => file });
  await m.load(); const nfPrompts = extra.map((l) => coreMod.NAME_PROMPT(l));
  const scores = await m.classify(new Blob(['x']), [...coreMod.namePrompts(vocab.classes), ...nfPrompts]); // the app's prompts: vocab names plus the non-food labels
  assert.equal(coreMod.topNames(scores, vocab.classes, 3)[0].cls.id, vocab.classes[target].id);
  assert.equal(scores.length, vocab.classes.length + extra.length);
});
t('the CI workflow: dispatch and push triggers, contents write, runs the tool, commits exactly the outputs with the two trailers', () => {
  const wf = readFileSync(join(web, '..', '..', '.github', 'workflows', 'macrofy-models.yml'), 'utf8'); const tool = readFileSync(join(web, '..', 'tools', 'build-text-embeddings.mjs'), 'utf8');
  assert.match(wf, /workflow_dispatch:/); assert.match(wf, /branches: \[main\]/); assert.match(wf, /permissions:\n  contents: write/);
  for (const p of ['macrofy/nutrition/vocab.json', 'macrofy/web/lib/models.mjs', '.github/workflows/macrofy-models.yml']) assert.ok(wf.includes(`- '${p}'`), `push path ${p}`);
  assert.match(wf, /node macrofy\/tools\/build-text-embeddings\.mjs/); assert.match(wf, /git add -- "\$\{add\[@\]\}"/); assert.doesNotMatch(wf, /git add (-A|\.|--all)/);
  assert.ok(wf.includes('Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')); assert.ok(wf.includes('Claude-Session: https://claude.ai/code/session_01BeqUPRJeU2ToodBE3NbAEW'));
  assert.match(wf, /-m \$'Co-Authored-By: Claude Opus 5\.5 <noreply@anthropic\.com>\\nClaude-Session: https:\/\/claude\.ai\/code\/session_01BeqUPRJeU2ToodBE3NbAEW'/); // the trailers are the last paragraph of the commit message
  for (const out of ['macrofy/web/lib/model-probe.json', 'macrofy/web/app/data/model-probe.json', 'macrofy/web/app/data/text-emb/*.json']) assert.ok(wf.includes(out), `workflow adds ${out}`);
  for (const out of ['web/lib/model-probe.json', 'web/app/data/model-probe.json', 'web/app/data/text-emb']) assert.ok(tool.includes(out), `tool writes ${out}`);
  assert.equal(tools.TRANSFORMERS_VERSION, '4.3.0'); assert.match(tool, /npm.*install|'install'/); assert.match(tool, /api\/models\/\$\{id\}\?blobs=true/);
});
t('T-017 workflows: models records the contracts and is the ONLY committer; model-it is read-only, triggered by the model code paths, and runs the integration test', () => {
  const models = readFileSync(join(web, '..', '..', '.github', 'workflows', 'macrofy-models.yml'), 'utf8'); const it = readFileSync(join(web, '..', '..', '.github', 'workflows', 'macrofy-model-it.yml'), 'utf8');
  assert.match(models, /run: node macrofy\/tools\/probe-contracts\.mjs/); assert.ok(models.includes('macrofy/web/lib/model-contracts.json')); assert.match(models, /id: selftest\n\s+continue-on-error: true/);
  assert.match(models, /SELFTEST_OUTCOME/); assert.match(models, /if: steps\.selftest\.outcome == 'failure'/); // a red selftest still commits the evidence (probe, contracts), then fails the job
  assert.match(it, /workflow_dispatch:/); assert.match(it, /branches: \[main\]/); assert.match(it, /permissions:\n  contents: read/);
  for (const p of ['macrofy/web/lib/**', 'macrofy/web/estimate/**', 'macrofy/web/app/estimate.mjs', 'macrofy/tools/**']) assert.ok(it.includes(`- '${p}'`), `push path ${p}`);
  assert.match(it, /node macrofy\/tools\/model-integration-test\.mjs/); assert.doesNotMatch(it, /git (add|commit|push)|contents: write/); // never commits: no race with macrofy-models
  for (const p of ['tools/probe-contracts.mjs', 'tools/model-integration-test.mjs', 'tools/it-photo.mjs', 'tools/tjs-node.mjs']) { assert.ok(existsSync(join(web, '..', p))); execFileSync(process.execPath, ['--check', join(web, '..', p)], { stdio: 'pipe' }); }
  assert.match(readFileSync(join(web, '..', 'tools', 'tjs-node.mjs'), 'utf8'), /TRANSFORMERS_VERSION = '4\.3\.0'/); assert.match(readFileSync(join(web, '..', 'tools', 'tjs-node.mjs'), 'utf8'), /'install'/);
});
t('sync-data: the probe copy is optional (skipped while the workflow has not run) and checked for drift once it exists', () => {
  const src = f('lib/model-probe.json'); const dst = f('app/data/model-probe.json');
  assert.ok(COPIES.some((c) => c.from === 'web/lib/model-probe.json' && c.to === 'web/app/data/model-probe.json' && c.optional));
  if (existsSync(src) || existsSync(dst)) return; // real files: covered by the drift test
  assert.deepEqual(staleCopies(), []);
  try { writeFileSync(src, '{"models":[]}\n'); assert.deepEqual(staleCopies().map((c) => c.to), ['web/app/data/model-probe.json']); writeFileSync(dst, '{"models":[]}\n'); assert.deepEqual(staleCopies(), []); }
  finally { rmSync(src, { force: true }); rmSync(dst, { force: true }); }
  writeFileSync(dst, '{}\n'); try { assert.deepEqual(staleCopies().map((c) => c.to), ['web/app/data/model-probe.json']); } finally { rmSync(dst, { force: true }); } // an orphaned copy is stale too
  assert.deepEqual(staleCopies(), []);
});
t('tool and workflow files exist and parse', () => {
  for (const p of [join(web, '..', 'tools', 'build-text-embeddings.mjs')]) { assert.ok(existsSync(p)); execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); }
  assert.ok(existsSync(join(web, '..', '..', '.github', 'workflows', 'macrofy-models.yml')));
});

t('T-017 lowResMask: low-res logits over a padded input give the photo-shaped mask (valid region only, bilinear, threshold 0); float16 bits decode', () => {
  // model input 32x32 (padded), photo resized into its top-left 32x24; logits 16x16 -> valid region 16x12. Positive logits on columns 4..11, rows 2..9.
  const Lh = 16; const Lw = 16; const lg = new Float32Array(Lh * Lw).fill(-5);
  for (let y = 2; y <= 9; y++) for (let x = 4; x <= 11; x++) lg[y * Lw + x] = 5;
  lg.fill(9, 13 * Lw, 16 * Lw); // positive in the padding (rows 13-15): must never show
  const geo = { Lh, Lw, Hp: 32, Wp: 32, validH: 24, validW: 32, outW: 64, outH: 48 };
  const m = models.lowResMask(lg, geo); const at = (x, y) => m[y * 64 + x];
  assert.equal(m.length, 64 * 48);
  assert.equal(at(32, 24), 1); assert.equal(at(2, 2), 0); assert.equal(at(63, 47), 0, 'the padding rows are outside the photo');
  let n = 0; for (const v of m) n += v; assert.ok(Math.abs(n / (64 * 48) - (8 * 8) / (16 * 12)) < 0.03, `area share ${n / 3072}`);
  assert.equal(models.halfToFloat(0x3c00), 1); assert.equal(models.halfToFloat(0xc000), -2); assert.equal(models.halfToFloat(0), 0);
  const half = Uint16Array.from(lg, (v) => (v > 0 ? 0x4500 : 0xc500)); // +-5 in float16
  assert.deepEqual(models.lowResMask(half, geo), m);
  assert.deepEqual(models.maskSize(1024, 768, 384), { w: 384, h: 288 }); assert.deepEqual(models.maskSize(300, 200, 384), { w: 300, h: 200 });
});
t('T-017 segmentPoints passes lowRes to every decode (masks straight from the logits in auto mode)', () => {
  const src = text('lib/models.mjs');
  assert.match(src, /api\.segment\(pt\.x, pt\.y, lowRes\)/); assert.match(src, /if \(lowRes\) \{/);
});

console.log(`web selftest: ${n} checks passed`);
