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
  const T = { env: {}, RawImage,
    async pipeline() { calls.forbidden.push('pipeline'); throw new Error('naming must not use a pipeline'); },
    AutoModel: forbid('AutoModel'), CLIPModel: forbid('CLIPModel'), SiglipModel: forbid('SiglipModel'), CLIPTextModelWithProjection: forbid('text tower'), SiglipTextModel: forbid('text tower'),
    CLIPVisionModelWithProjection: vision, SiglipVisionModel: vision, AutoImageProcessor: { from_pretrained: async () => async () => ({ pixel_values: {} }) },
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
await t('parallel mode (desktop): both models load at load() and stay', async () => {
  const { T } = fakeLib(); const m = mkModels({ importer: async () => T, sequential: false });
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
  const { T, calls } = batchLib(); const m = mkModels({ importer: async () => T }); await m.load();
  const enc = await m.setImage(new Blob(['x'])); assert.equal(typeof enc.encoder_ms, 'number'); assert.equal(enc.cached, true);
  calls.batches.length = 0; calls.prompts.length = 0; const prog = [];
  const r = await m.segmentPoints(pts(10), { batch: 4, onProgress: (e) => prog.push(`${e.done}/${e.total}`) });
  assert.deepEqual(calls.batches, [4, 4, 2]); assert.equal(r.decodes, 3); assert.equal(r.done, 10); assert.equal(r.timed_out, false); assert.equal(r.masks.length, 10);
  assert.deepEqual(calls.prompts[0], [[[[0, 0]], [[1, 2]], [[2, 4]], [[3, 6]]]]); // [image][point][1 point][x, y]
  assert.ok(r.masks.every((x) => x.score === 0.9 && x.width === 2 && x.data[0] === 1)); assert.deepEqual(r.masks.map((x) => x.point.x), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); assert.deepEqual(r.masks[5].point, { x: 5, y: 10 });
  assert.deepEqual(prog, ['0/10', '4/10', '8/10', '10/10']); assert.equal(typeof r.ms, 'number');
});
await t('segmentPoints: the time budget stops the grid early and says so', async () => {
  const { T } = batchLib(); const m = mkModels({ importer: async () => T }); await m.load(); await m.setImage(new Blob(['x']));
  let clock = 0; const r = await m.segmentPoints(pts(12), { batch: 4, budgetMs: 250, now: () => (clock += 100) });
  assert.equal(r.timed_out, true); assert.equal(r.done, 8); assert.equal(r.masks.length, 8); assert.equal(r.total, 12);
});
await t('segmentPoints: falls back to one prompt per decode when batched prompts are refused, with the same masks', async () => {
  const { T, calls } = batchLib({ refuseBatches: true }); const m = mkModels({ importer: async () => T }); await m.load(); await m.setImage(new Blob(['x']));
  calls.batches.length = 0; const r = await m.segmentPoints(pts(5), { batch: 4 });
  assert.equal(r.masks.length, 5); assert.equal(r.batched, false); assert.ok(r.decodes >= 5); assert.ok(r.masks.every((x, i) => x.score === 0.9 && x.point.x === i));
  await assert.rejects(mkModels({ importer: async () => T }).segmentPoints(pts(1)), /nenhuma foto/);
});
await t('the 4.3.0 to 3.8.1 fallback and the injectable model layer are unchanged by the batched decode', async () => {
  const { T } = batchLib(); const seen = [];
  const m = mkModels({ importer: async (u) => { seen.push(u.split('@').pop()); if (u.endsWith('@4.3.0')) throw new Error('404'); return T; } });
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

console.log(`web selftest: ${n} checks passed`);
