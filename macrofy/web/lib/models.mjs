// Shared browser model layer (T-013): used by the estimate screens and the feasibility page.
// transformers.js comes from jsdelivr, pinned to an exact version (4.3.0 first, 3.8.1 if that import fails). Models are
// cached by the library's browser cache (Cache Storage), so only the first run downloads. Candidate model ids are unverified
// in the build sandbox (no CDN access): loading tries them in order and reports why the others failed.
// The app never imports this file directly for tests: it takes an injected model object (see createModels for the shape).
export const TRANSFORMERS_VERSIONS = ['4.3.0', '3.8.1'];
export const transformersUrl = (version) => `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${version}`;

// Smallest first, never fp32: the owner's iPhone 16e killed the Safari tab while loading the largest SAM candidate with the
// depth model still resident (F-005). SlimSAM q8 is tried first, then SAM 2.1 tiny in q8 or fp16. Each candidate may list its own
// backends; without `backends` the shared BACKENDS apply.
// `probeFiles`: name fragments of the ONNX files a candidate needs; the size estimate (orderBySize) sums, per fragment, the smallest
// matching file of the probe (tools/build-text-embeddings.mjs writes it in CI).
export const SEGMENT_CANDIDATES = [
  { id: 'Xenova/slimsam-77-uniform', sam: 'SamModel', backends: [['wasm', 'q8'], ['webgpu', 'q8']], probeFiles: ['vision_encoder', 'prompt_encoder_mask_decoder'] },
  { id: 'onnx-community/sam2.1-hiera-tiny-ONNX', sam: 'Sam2Model', backends: [['wasm', 'q8'], ['webgpu', 'q4f16'], ['webgpu', 'fp16']], probeFiles: ['vision_encoder', 'prompt_encoder_mask_decoder'] },
];
// T-015: naming loads ONLY the image tower (the full SigLIP files, text tower included, failed with "Load failed" on the iPhone 16e) and
// scores it against text embeddings committed in the app data folder, built in CI from the text tower (see checkEmbeddings). `vision` and
// `text` list transformers.js class names, the first one present in the library wins. Default order: smallest vision file first (a guess
// until the probe file exists; orderBySize then uses real sizes).
export const NAMING_CANDIDATES = [
  { id: 'Xenova/clip-vit-base-patch32', vision: ['CLIPVisionModelWithProjection'], text: ['CLIPTextModelWithProjection'], pad: 'longest', probeFiles: ['vision_model'] },
  { id: 'Xenova/siglip-base-patch16-224', vision: ['SiglipVisionModel'], text: ['SiglipTextModel'], pad: 'max_length', maxLength: 64, probeFiles: ['vision_model'] },
  { id: 'onnx-community/siglip2-base-patch16-224-ONNX', vision: ['Siglip2VisionModel', 'SiglipVisionModel'], text: ['Siglip2TextModel', 'SiglipTextModel'], pad: 'max_length', maxLength: 64, probeFiles: ['vision_model'] },
];
/** Tried in order per candidate; WebGPU entries are skipped when the browser has no WebGPU adapter. Never fp32 (memory on iOS). */
// Model probe (CI, 2026-09-29): the 4-bit image towers are 53-58 MB, near the 50 MB depth model that runs on the 16e; the q8/fp16
// ones are 89-186 MB. SAM crashed the tab on WebGPU even at 9 MB (activation memory, not file size), so SAM tries WASM first.
export const BACKENDS = [['webgpu', 'q4f16'], ['wasm', 'q4'], ['webgpu', 'fp16'], ['webgpu', 'q8'], ['wasm', 'q8']];

// Combinations that loaded and ran on the owner's iPhone 16e (research/device-runs/2026-09-29-iphone16e-feasibility.json, run 3:
// SAM 2.1 tiny 1.6 s, CLIP B/32 0.12 s). The app tries these first so it never crash-tests on the user's phone; the others
// (which killed the tab there: SAM on WASM, depth on WebGPU) stay as fallbacks for other devices.
export const PROVEN_ATTEMPTS = [
  ['onnx-community/sam2.1-hiera-tiny-ONNX', 'webgpu', 'q4f16'],
  ['Xenova/clip-vit-base-patch32', 'webgpu', 'q4f16'],
];
const provenRank = (id, device, dtype) => {
  const i = PROVEN_ATTEMPTS.findIndex(([pid, pd, pt]) => pid === id && pd === device && pt === dtype);
  return i < 0 ? Infinity : i;
};
/** Every (candidate, device, dtype) of `candidates`, proven combinations first, then candidate order. */
export function provenFirst(candidates) {
  const all = candidates.flatMap((c) => backendsOf(c).map(([device, dtype]) => [c, device, dtype]));
  return all.map((a, i) => [a, i]).sort((x, y) => (provenRank(x[0][0].id, x[0][1], x[0][2]) - provenRank(y[0][0].id, y[0][1], y[0][2])) || (x[1] - y[1])).map(([a]) => a);
}

export const isIOS = () => /iP(hone|ad|od)/.test(globalThis.navigator?.userAgent ?? '');
export const backendsOf = (candidate) => candidate.backends ?? BACKENDS;

const msg = (e) => String(e?.message || e).slice(0, 200);

// ---------------------------------------------------------------- probe file (real sizes) and candidate order
const PROBE_URLS = [new URL('./model-probe.json', import.meta.url), new URL('../data/model-probe.json', import.meta.url)]; // lib/ (feasibility) or vendor/ (app)
async function readJson(url) {
  const u = new URL(url, globalThis.location?.href);
  if (u.protocol === 'file:') return JSON.parse(await (await import('node:fs/promises')).readFile(u, 'utf8'));
  const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
}
/** The CI probe file { models: [{ id, revision, onnx: [{ path, size }] }] }, or null when it does not exist (yet). */
export async function loadProbe(urls = PROBE_URLS) {
  for (const u of urls) { try { const p = await readJson(u); if (Array.isArray(p?.models)) return p; } catch { /* absent: try the next place */ } }
  return null;
}
/** Estimated download bytes of a candidate from the probe (sum of the smallest matching ONNX file per fragment), or null when unknown. */
export function candidateBytes(c, probe) {
  const m = probe?.models?.find((x) => x.id === c.id); if (!m?.onnx?.length || !c.probeFiles?.length) return null;
  let total = 0;
  for (const frag of c.probeFiles) {
    const sizes = m.onnx.filter((f) => f.path.includes(frag) && f.path.endsWith('.onnx') && Number.isFinite(f.size)).map((f) => f.size);
    if (!sizes.length) return null;
    total += Math.min(...sizes);
  }
  return total;
}
/** A copy of `candidates`, smallest first by probe size. Unchanged order unless EVERY candidate has a known size (no guessing). Stable. */
export function orderBySize(candidates, probe) {
  const sized = candidates.map((c, i) => ({ c, i, bytes: candidateBytes(c, probe) }));
  if (sized.some((x) => x.bytes === null)) return [...candidates];
  return sized.sort((a, b) => a.bytes - b.bytes || a.i - b.i).map((x) => x.c);
}

// ---------------------------------------------------------------- text embeddings (naming stage) and their provenance
export const safeModelId = (id) => id.replace(/[^A-Za-z0-9._-]+/g, '__');
export async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Hash of the vocab label list (the `pt` names in vocab order): the provenance key shared with tools/build-text-embeddings.mjs. */
export const labelsSha256 = (labels) => sha256Hex(JSON.stringify(labels));
export const fillTemplate = (template, label) => template.replace('{}', label);
export class EmbeddingsError extends Error {
  constructor(modelId, reason) { super(`embeddings missing/stale (${modelId}): ${reason}`); this.name = 'EmbeddingsError'; }
}
/** Provenance check of a text-embedding file: model id, revision, labels hash against the CURRENT vocab, shape, unit norm. -> { ok, reason } */
export async function checkEmbeddings(file, { modelId, labels }) {
  const bad = (reason) => ({ ok: false, reason });
  if (!file || typeof file !== 'object') return bad('file missing');
  if (file.model_id !== modelId) return bad(`file is for ${file.model_id}`);
  if (!file.revision || typeof file.revision !== 'string') return bad('no revision recorded');
  if (typeof file.prompt_template !== 'string' || !file.prompt_template.includes('{}')) return bad('no prompt_template');
  if (file.labels_sha256 !== await labelsSha256(labels)) return bad('vocab labels changed since the file was built (labels hash differs)');
  if (JSON.stringify(file.labels) !== JSON.stringify(labels)) return bad('label list differs from the vocab');
  if (!Number.isInteger(file.dim) || file.dim < 1) return bad('bad dim');
  const shapeOk = (rows, n) => Array.isArray(rows) && rows.length === n && rows.every((r) => Array.isArray(r) && r.length === file.dim);
  if (!shapeOk(file.embeddings, labels.length)) return bad('embeddings shape does not match labels and dim');
  if (!shapeOk(file.extra_embeddings ?? [], (file.extra_labels ?? []).length)) return bad('extra embeddings shape does not match extra_labels');
  for (const row of [...file.embeddings, ...(file.extra_embeddings ?? [])]) { let n = 0; for (const x of row) n += x * x; if (!(Math.abs(Math.sqrt(n) - 1) < 0.02)) return bad('embeddings are not normalized'); }
  return { ok: true };
}
/** prompt -> vector, for the vocab labels and the extra (non-food) labels of a checked file. */
export function buildTable(file) {
  const table = new Map();
  file.labels.forEach((l, i) => table.set(fillTemplate(file.prompt_template, l), Float32Array.from(file.embeddings[i])));
  (file.extra_labels ?? []).forEach((l, i) => table.set(fillTemplate(file.prompt_template, l), Float32Array.from(file.extra_embeddings[i])));
  return table;
}
const unit = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); };
/** Image embedding from a vision-only handle (CLIP: image_embeds; SigLIP has no projection: pooler_output). Normalized. */
export async function embedImage(h, img) {
  const out = await h.model(await h.proc(img));
  const t = out.image_embeds ?? out.pooler_output ?? out.embeds;
  if (!t?.data) throw new Error(`o codificador de imagem não devolveu embedding (saídas: ${Object.keys(out ?? {}).join(', ')})`);
  return unit(t.data);
}
/** Scores an image embedding against the prompts: softmax over 100 x cosine, so scores sum to 1 and rank like the cosine. */
export function scoreImage(vec, table, modelId, prompts) {
  const logits = prompts.map((p) => {
    const v = table.get(p); if (!v || v.length !== vec.length) throw new EmbeddingsError(modelId, `no text vector for "${p}"`);
    let d = 0; for (let i = 0; i < v.length; i++) d += v[i] * vec[i]; return 100 * d;
  });
  const mx = Math.max(...logits); const e = logits.map((x) => Math.exp(x - mx)); const z = e.reduce((a, b) => a + b, 0);
  return prompts.map((label, i) => ({ label, score: e[i] / z }));
}

/** The vocab pt names in vocab order (what the embeddings are built over), from a vocab.json URL. */
export async function vocabLabels(url = new URL('../data/vocab.json', import.meta.url)) { return (await readJson(url)).classes.map((c) => c.pt); }
export const defaultEmbeddingsBase = () => new URL('../data/text-emb/', import.meta.url).href;
/** Fetches the text-embedding file of a model from `base` (null when it does not exist). */
export async function fetchEmbeddings(modelId, base = defaultEmbeddingsBase()) {
  try { const r = await fetch(new URL(`${safeModelId(modelId)}.json`, new URL(base, globalThis.location?.href))); return r.ok ? await r.json() : null; } catch { return null; }
}
/** Loads and CHECKS the text embeddings of a naming candidate against the vocab labels. Throws EmbeddingsError (missing/stale); never guesses. */
export async function prepareEmbeddings(modelId, { labels, base, loadEmbeddings } = {}) {
  const file = await (loadEmbeddings ?? ((id) => fetchEmbeddings(id, base)))(modelId);
  const chk = await checkEmbeddings(file, { modelId, labels: typeof labels === 'function' ? await labels() : (labels ?? await vocabLabels()) });
  if (!chk.ok) throw new EmbeddingsError(modelId, chk.reason);
  return { revision: file.revision, file, table: buildTable(file) };
}

// ---------------------------------------------------------------- which file is being fetched (diagnostics for "Load failed")
export const hfFileUrl = (model, file, revision = 'main') => `https://huggingface.co/${model}/resolve/${revision}/${file}`;
/** Wraps a transformers.js progress callback: remembers the files initiated and not yet done. `file`/`url` = the latest of them. */
export function fileTracker(model, inner) {
  const open = new Map();
  const callback = (e) => {
    if (e?.file) {
      const url = hfFileUrl(e.name ?? model, e.file);
      if (e.status === 'done') open.delete(url); else if (['initiate', 'download', 'progress'].includes(e.status)) { open.delete(url); open.set(url, e.file); }
    }
    inner?.(e);
  };
  return { callback, get url() { return [...open.keys()].at(-1) ?? null; }, get file() { return [...open.values()].at(-1) ?? null; }, get inFlight() { return [...open.keys()]; } };
}

/** Imports transformers.js, trying each pinned version until one loads. `importer` is injectable for tests. */
export async function importTransformers({ versions = TRANSFORMERS_VERSIONS, importer = (url) => import(url) } = {}) {
  const errors = [];
  for (const version of versions) {
    try {
      const T = await importer(transformersUrl(version));
      if (T?.env) { T.env.allowLocalModels = false; T.env.useBrowserCache = true; }
      return { T, version, errors };
    } catch (e) { errors.push(`${version}: ${msg(e)}`); }
  }
  throw Object.assign(new Error(`não consegui carregar a biblioteca de modelos (${errors.join('; ')})`), { errors });
}

export async function detectWebGpu() {
  try { return !!(globalThis.navigator?.gpu && await navigator.gpu.requestAdapter().catch(() => null)); } catch { return false; }
}

/** One candidate -> a handle { task, ..., dispose }. A `task` candidate is a pipeline; a `sam` one is a model class plus its processor. */
export async function loadCandidate(T, c, opts) {
  if (c.task) { const p = await T.pipeline(c.task, c.id, opts); return { task: c.task, p, dispose: () => p.dispose?.() }; }
  if (c.vision) { // vision-only naming: the image tower and its image processor, never the text tower
    const names = [].concat(c.vision); const M = names.map((n) => T[n]).find(Boolean);
    if (!M) throw new Error(`${names.join(' / ')} indisponível nesta versão da biblioteca`);
    const P = T.AutoImageProcessor ?? T.AutoProcessor;
    const popts = { ...(opts.revision ? { revision: opts.revision } : {}), ...(opts.progress_callback ? { progress_callback: opts.progress_callback } : {}) };
    const [model, proc] = await Promise.all([M.from_pretrained(c.id, { model_file_name: 'vision_model', ...opts }), P.from_pretrained(c.id, popts)]);
    return { task: 'vision', model, proc, dispose: () => model.dispose?.() };
  }
  const M = T[c.sam];
  if (!M) throw new Error(`${c.sam} indisponível nesta versão da biblioteca`);
  const [model, proc] = await Promise.all([M.from_pretrained(c.id, opts), T.AutoProcessor.from_pretrained(c.id)]);
  return { task: 'sam', model, proc, dispose: () => model.dispose?.() };
}

/** Aggregates transformers.js progress events (per file) into one { fraction, loaded, total } callback. */
export function progressTracker(onProgress, stage, label) {
  const files = new Map();
  return (e) => {
    if (!e || !onProgress) return;
    if (e.file && (e.status === 'progress' || e.status === 'done')) files.set(e.file, { loaded: e.status === 'done' ? (e.total ?? e.loaded ?? 0) : (e.loaded ?? 0), total: e.total ?? 0 });
    let loaded = 0; let total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    onProgress({ stage, label, loaded, total, fraction: total ? Math.min(loaded / total, 1) : null });
  };
}

/**
 * First candidate/backend combination that loads and survives `warm` (WebGPU shader errors surface at the first inference). `prepare(c)`
 * runs once per candidate BEFORE any download (naming: checks the text-embedding file); its result comes back as `prep`, and a `revision`
 * in it pins the model files to the revision the embeddings were built from.
 */
async function loadFirst(T, candidates, { hasGpu, warm, progress, prepare }) {
  const errors = []; const preps = new Map();
  for (const [c, device, dtype] of provenFirst(candidates)) {
    if (device === 'webgpu' && !hasGpu) continue;
    let h = null;
    try {
      let prep = null;
      if (prepare) { if (!preps.has(c.id)) preps.set(c.id, prepare(c)); prep = await preps.get(c.id); }
      h = await loadCandidate(T, c, { device, dtype, progress_callback: progress, ...(prep?.revision ? { revision: prep.revision } : {}) });
      await warm?.(h);
      return { handle: h, candidate: c, device, dtype, errors, prep };
    } catch (e) { errors.push(`${c.id} ${device}/${dtype}: ${msg(e)}`); try { await h?.dispose(); } catch { /* ignore */ } }
  }
  throw Object.assign(new Error(`nenhum modelo carregou (${errors.join('; ')})`), { errors });
}

/** One SAM output slice (any nonzero value) -> a 0/1 mask with its predicted IoU score. */
const toMask = (data, width, height, score) => { const m = new Uint8Array(width * height); for (let i = 0; i < m.length; i++) m[i] = data[i] ? 1 : 0; return { width, height, data: m, score }; };

/**
 * Splits a post-processed batched SAM output into masks. `masks` is { dims: [pointBatch, nMasks, H, W], data }, `scores` the flat predicted
 * IoUs (pointBatch x nMasks). Keeps the perPoint best-scoring masks of each point, tagged with that point. Pure, so Node tests it.
 */
export function splitBatchMasks(masks, scores, points, perPoint = 1) {
  const dims = masks.dims; const H = dims[dims.length - 2]; const W = dims[dims.length - 1]; const n = dims[dims.length - 3]; const pb = dims.length >= 4 ? dims[dims.length - 4] : 1;
  if (pb !== points.length) throw new Error(`a decodificação em lote devolveu ${pb} conjuntos de máscaras para ${points.length} pontos`);
  const out = [];
  for (let p = 0; p < pb; p++) {
    const cand = [];
    for (let i = 0; i < n; i++) {
      const o = (p * n + i) * H * W;
      cand.push(toMask(masks.data.subarray ? masks.data.subarray(o, o + H * W) : masks.data.slice(o, o + H * W), W, H, scores?.[p * n + i] ?? 0));
    }
    cand.sort((a, b) => b.score - a.score).slice(0, perPoint).forEach((m) => out.push({ ...m, point: points[p] }));
  }
  return out;
}

/**
 * The model object the estimate screens use (tests inject a mock with the same methods). Memory: with `sequential` (default on iOS)
 * only one of the two models is resident at a time: SAM loads first, and the naming vision encoder loads on the first classify() after
 * freeing SAM; a later segment() frees it, reloads SAM from the browser cache and encodes the photo again. Otherwise both stay loaded.
 * Naming (T-015) loads only an image tower and scores its embedding against the committed text-embedding file of that model, whose
 * provenance is checked against the vocab labels first (no download otherwise): options `labels` (array or function returning the vocab
 * pt names; default: the vocab.json next to the data folder), `embeddingsBase` (URL of the text-emb folder), `loadEmbeddings(modelId)`
 * (tests), `probe` (the CI probe object; default: loadProbe()) which orders the candidates by real size.
 *   load(onProgress)            -> { version, backend, segmenter, namer, sequential, warnings }   loads SAM (and the namer unless sequential); progress { stage, label, fraction }
 *   setImage(blob)              -> { encoder_ms }                           the working photo the taps refer to; the image encoder runs once here
 *   segment(x, y)               -> [{ width, height, data, score }]         SAM masks for a point tap (image px), best score first
 *   segmentPoints(points, opts) -> { masks, decodes, done, total, ms, timed_out }   T-014: one prompt per point {x, y}, decoded in batches on the
 *                                  cached embedding; opts { batch, budgetMs, perPoint, onProgress({done, total}), now }; masks carry score and point
 *   classify(blob, prompts)     -> [{ label, score }]                       image embedding vs text embeddings: one score per prompt (softmax); throws EmbeddingsError when the file is missing or stale
 */
export function createModels({ importer, versions, sequential = isIOS(), labels, embeddingsBase, loadEmbeddings, probe } = {}) {
  let segCands = SEGMENT_CANDIDATES; let nameCands = NAMING_CANDIDATES;
  const prepare = (c) => prepareEmbeddings(c.id, { labels, base: embeddingsBase, loadEmbeddings });
  let T = null; let seg = null; let name = null; let embeddings = null; let image = null; let info = null;
  let segP = null; let nameP = null; let hasGpu = false; let progressCb = () => {}; let encoderMs = null;

  async function load(onProgress = () => {}) {
    if (info) return info;
    progressCb = onProgress;
    onProgress({ stage: 'lib', label: 'Biblioteca de modelos', fraction: null });
    const lib = await importTransformers({ importer, versions });
    T = lib.T;
    hasGpu = await detectWebGpu();
    const pr = probe ?? await loadProbe();
    segCands = orderBySize(SEGMENT_CANDIDATES, pr); nameCands = orderBySize(NAMING_CANDIDATES, pr);
    info = { version: lib.version, backend: null, segmenter: null, namer: null, sequential, warnings: [...lib.errors] };
    await ensureSeg();
    if (!sequential) await ensureNaming(); // on the phone the naming model loads on first use, after the segmentation model is freed
    return info;
  }

  async function makeProbeImage() { return new T.RawImage(new Uint8ClampedArray(64 * 64 * 3).fill(127), 64, 64, 3); }

  /** Loads SAM (once). In sequential mode the naming model is freed first: only one of the two is resident at a time. */
  function ensureSeg() {
    if (seg) return Promise.resolve(seg);
    return (segP ??= (async () => {
      if (sequential) await releaseName();
      const probe = await makeProbeImage();
      const r = await loadFirst(T, segCands, {
        hasGpu, progress: progressTracker((e) => progressCb(e), 'segmentation', 'Modelo de contorno (SAM)'),
        warm: (h) => samRun(h, probe, { x: probe.width / 2, y: probe.height / 2 }).then(() => undefined),
      });
      seg = r; info.segmenter = r.candidate.id; info.backend = `${r.device}/${r.dtype}`; info.warnings.push(...r.errors);
      if (image) await encode(); // reloaded after being freed: the photo is encoded again
      return seg;
    })().finally(() => { segP = null; }));
  }
  function ensureNaming() {
    if (name) return Promise.resolve(name);
    return (nameP ??= (async () => {
      if (sequential) await releaseSeg();
      const probe = await makeProbeImage();
      const r = await loadFirst(T, nameCands, {
        hasGpu, progress: progressTracker((e) => progressCb(e), 'naming', 'Modelo de nomes (codificador de imagem)'), prepare,
        warm: (h) => embedImage(h, probe),
      });
      name = { ...r, table: r.prep.table }; info.namer = r.candidate.id; info.namer_backend = `${r.device}/${r.dtype}`; info.warnings.push(...r.errors);
      return name;
    })().finally(() => { nameP = null; }));
  }
  async function releaseSeg() { const s = seg; seg = null; embeddings = null; try { await s?.handle.dispose(); } catch { /* ignore */ } }
  async function releaseName() { const n = name; name = null; try { await n?.handle.dispose(); } catch { /* ignore */ } }

  /** One SAM decode of several points at once: one prompt per point, [image][point][1 point][x, y]; the cached embedding is reused. */
  async function samBatch(h, img, points, cache, perPoint) {
    const inputs = await h.proc(img, { input_points: [points.map((p) => [[p.x, p.y]])] });
    const out = cache && typeof h.model.get_image_embeddings === 'function' ? await h.model({ ...inputs, ...cache }) : await h.model(inputs);
    const masks = await h.proc.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    return splitBatchMasks(masks[0], out.iou_scores ? Array.from(out.iou_scores.data) : null, points, perPoint);
  }

  async function samRun(h, img, point, cache) {
    const input_points = [[[point.x, point.y]]];
    const inputs = await h.proc(img, { input_points });
    let out;
    if (cache && typeof h.model.get_image_embeddings === 'function') {
      out = await h.model({ ...inputs, ...cache });
    } else out = await h.model(inputs);
    const masks = await h.proc.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const t = masks[0]; const dims = t.dims; const H = dims[dims.length - 2]; const W = dims[dims.length - 1]; const n = dims[dims.length - 3];
    const scores = out.iou_scores ? Array.from(out.iou_scores.data).slice(0, n) : new Array(n).fill(0);
    return scores.map((score, i) => toMask(t.data.subarray ? t.data.subarray(i * H * W, (i + 1) * H * W) : t.data.slice(i * H * W, (i + 1) * H * W), W, H, score)).sort((a, b) => b.score - a.score);
  }

  /** The image encoder runs once per photo; every later prompt only pays for the decoder. */
  async function encode() {
    embeddings = null; const t0 = performance.now();
    if (typeof seg.handle.model.get_image_embeddings === 'function') {
      try { embeddings = await seg.handle.model.get_image_embeddings(await seg.handle.proc(image)); } catch { embeddings = null; } // fall back to a full run per tap
    }
    encoderMs = Math.round(performance.now() - t0);
    return { encoder_ms: encoderMs, cached: !!embeddings };
  }

  const api = {
    load,
    get info() { return info; },
    async setImage(blob) {
      if (!info) throw new Error('modelos ainda não carregados');
      image = await T.RawImage.fromBlob(blob); embeddings = null;
      await ensureSeg();
      return encode();
    },
    async segment(x, y) {
      if (!image) throw new Error('nenhuma foto carregada');
      const s = await ensureSeg();
      try { return await samRun(s.handle, image, { x, y }, embeddings); } catch (e) {
        if (!embeddings) throw e;
        embeddings = null; return samRun(s.handle, image, { x, y }, null); // cached embeddings not accepted by this model: recompute
      }
    },
    async segmentPoints(points, { batch = 4, budgetMs = Infinity, perPoint = 1, onProgress = () => {}, now = () => performance.now() } = {}) {
      if (!image) throw new Error('nenhuma foto carregada');
      const s = await ensureSeg();
      const t0 = now(); const masks = []; let done = 0; let decodes = 0; let timed_out = false; let batched = true;
      onProgress({ done: 0, total: points.length });
      for (let i = 0; i < points.length; i += batch) {
        if (now() - t0 > budgetMs) { timed_out = true; break; }
        const chunk = points.slice(i, i + batch); let got;
        try { if (!batched) throw new Error('batched prompts refused earlier'); got = await samBatch(s.handle, image, chunk, embeddings, perPoint); decodes++; }
        catch { // batched point prompts not accepted by this model build: one prompt per decode (slower, same masks)
          batched = false; got = [];
          for (const pt of chunk) { const r = await api.segment(pt.x, pt.y); decodes++; got.push(...r.slice(0, perPoint).map((m) => ({ ...m, point: pt }))); }
        }
        masks.push(...got); done += chunk.length; onProgress({ done, total: points.length });
      }
      return { masks, decodes, done, total: points.length, ms: Math.round(now() - t0), timed_out, batched };
    },
    async classify(blob, prompts) {
      const img = await T.RawImage.fromBlob(blob);
      const n = await ensureNaming();
      return scoreImage(await embedImage(n.handle, img), n.table, n.candidate.id, prompts);
    },
    /** Frees both models (the estimate screens call this when leaving the flow). */
    async dispose() { await releaseSeg(); await releaseName(); },
  };
  return api;
}
