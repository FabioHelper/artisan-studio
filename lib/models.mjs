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
export const SEGMENT_CANDIDATES = [
  { id: 'Xenova/slimsam-77-uniform', sam: 'SamModel', backends: [['webgpu', 'q8'], ['wasm', 'q8']] },
  { id: 'onnx-community/sam2.1-hiera-tiny-ONNX', sam: 'Sam2Model', backends: [['webgpu', 'q8'], ['webgpu', 'fp16'], ['wasm', 'q8']] },
];
export const NAMING_CANDIDATES = [
  { id: 'onnx-community/siglip2-base-patch16-224-ONNX', task: 'zero-shot-image-classification' },
  { id: 'Xenova/siglip-base-patch16-224', task: 'zero-shot-image-classification' },
];
/** Tried in order per candidate; WebGPU entries are skipped when the browser has no WebGPU adapter. Never fp32 (memory on iOS). */
export const BACKENDS = [['webgpu', 'fp16'], ['webgpu', 'q8'], ['wasm', 'q8']];

export const isIOS = () => /iP(hone|ad|od)/.test(globalThis.navigator?.userAgent ?? '');
export const backendsOf = (candidate) => candidate.backends ?? BACKENDS;

const msg = (e) => String(e?.message || e).slice(0, 200);

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

/** First candidate/backend combination that loads and survives `warm` (WebGPU shader errors surface at the first inference). */
async function loadFirst(T, candidates, { hasGpu, warm, progress }) {
  const errors = [];
  for (const c of candidates) for (const [device, dtype] of backendsOf(c)) {
    if (device === 'webgpu' && !hasGpu) continue;
    let h = null;
    try {
      h = await loadCandidate(T, c, { device, dtype, progress_callback: progress });
      await warm?.(h);
      return { handle: h, candidate: c, device, dtype, errors };
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
 * only one of the two models is resident at a time: SAM loads first, and SigLIP loads on the first classify() after freeing SAM;
 * a later segment() frees SigLIP, reloads SAM from the browser cache and encodes the photo again. Otherwise both stay loaded.
 *   load(onProgress)            -> { version, backend, segmenter, namer, sequential, warnings }   loads SAM (and SigLIP unless sequential); progress { stage, label, fraction }
 *   setImage(blob)              -> { encoder_ms }                           the working photo the taps refer to; the image encoder runs once here
 *   segment(x, y)               -> [{ width, height, data, score }]         SAM masks for a point tap (image px), best score first
 *   segmentPoints(points, opts) -> { masks, decodes, done, total, ms, timed_out }   T-014: one prompt per point {x, y}, decoded in batches on the
 *                                  cached embedding; opts { batch, budgetMs, perPoint, onProgress({done, total}), now }; masks carry score and point
 *   classify(blob, prompts)     -> [{ label, score }]                       SigLIP zero-shot: one score per prompt
 */
export function createModels({ importer, versions, sequential = isIOS() } = {}) {
  let T = null; let seg = null; let name = null; let embeddings = null; let image = null; let info = null;
  let segP = null; let nameP = null; let hasGpu = false; let progressCb = () => {}; let encoderMs = null;

  async function load(onProgress = () => {}) {
    if (info) return info;
    progressCb = onProgress;
    onProgress({ stage: 'lib', label: 'Biblioteca de modelos', fraction: null });
    const lib = await importTransformers({ importer, versions });
    T = lib.T;
    hasGpu = await detectWebGpu();
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
      const r = await loadFirst(T, SEGMENT_CANDIDATES, {
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
      const r = await loadFirst(T, NAMING_CANDIDATES, {
        hasGpu, progress: progressTracker((e) => progressCb(e), 'naming', 'Modelo de nomes (SigLIP)'),
        warm: (h) => h.p(probe, ['uma foto de teste'], { hypothesis_template: '{}' }),
      });
      name = r; info.namer = r.candidate.id; info.namer_backend = `${r.device}/${r.dtype}`; info.warnings.push(...r.errors);
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
      const out = await n.handle.p(img, prompts, { hypothesis_template: '{}' });
      return out.map((o) => ({ label: o.label, score: o.score }));
    },
    /** Frees both models (the estimate screens call this when leaving the flow). */
    async dispose() { await releaseSeg(); await releaseName(); },
  };
  return api;
}
