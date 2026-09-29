// Shared browser model layer (T-013): used by the estimate screens and the feasibility page.
// transformers.js comes from jsdelivr, pinned to an exact version (4.3.0 first, 3.8.1 if that import fails). Models are
// cached by the library's browser cache (Cache Storage), so only the first run downloads. Candidate model ids are unverified
// in the build sandbox (no CDN access): loading tries them in order and reports why the others failed.
// The app never imports this file directly for tests: it takes an injected model object (see createModels for the shape).
export const TRANSFORMERS_VERSIONS = ['4.3.0', '3.8.1'];
export const transformersUrl = (version) => `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${version}`;

export const SEGMENT_CANDIDATES = [
  { id: 'onnx-community/sam2.1-hiera-tiny-ONNX', sam: 'Sam2Model' },
  { id: 'Xenova/slimsam-77-uniform', sam: 'SamModel' },
];
export const NAMING_CANDIDATES = [
  { id: 'onnx-community/siglip2-base-patch16-224-ONNX', task: 'zero-shot-image-classification' },
  { id: 'Xenova/siglip-base-patch16-224', task: 'zero-shot-image-classification' },
];
/** Tried in order per candidate; WebGPU entries are skipped when the browser has no WebGPU adapter. */
export const BACKENDS = [['webgpu', 'fp16'], ['webgpu', 'q8'], ['wasm', 'q8']];

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
  for (const c of candidates) for (const [device, dtype] of BACKENDS) {
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
 * The model object the estimate screens use (tests inject a mock with the same four methods):
 *   load(onProgress)            -> { version, backend, segmenter, namer }   loads both models; progress { stage, label, fraction }
 *   setImage(blob)              -> void                                     the working photo the taps refer to
 *   segment(x, y)               -> [{ width, height, data, score }]         SAM masks for a point tap (image px), best score first
 *   classify(blob, prompts)     -> [{ label, score }]                       SigLIP zero-shot: one score per prompt
 */
export function createModels({ importer, versions } = {}) {
  let T = null; let seg = null; let name = null; let embeddings = null; let image = null; let info = null;

  async function load(onProgress = () => {}) {
    if (info) return info;
    onProgress({ stage: 'lib', label: 'Biblioteca de modelos', fraction: null });
    const lib = await importTransformers({ importer, versions });
    T = lib.T;
    const hasGpu = await detectWebGpu();
    const probe = await makeProbeImage();
    seg = await loadFirst(T, SEGMENT_CANDIDATES, {
      hasGpu, progress: progressTracker(onProgress, 'segmentation', 'Modelo de contorno (SAM)'),
      warm: (h) => samRun(h, probe, { x: probe.width / 2, y: probe.height / 2 }).then(() => undefined),
    });
    name = await loadFirst(T, NAMING_CANDIDATES, {
      hasGpu, progress: progressTracker(onProgress, 'naming', 'Modelo de nomes (SigLIP)'),
      warm: (h) => h.p(probe, ['uma foto de teste'], { hypothesis_template: '{}' }),
    });
    info = { version: lib.version, backend: `${seg.device}/${seg.dtype}`, segmenter: seg.candidate.id, namer: name.candidate.id, warnings: [...lib.errors, ...seg.errors, ...name.errors] };
    return info;
  }

  async function makeProbeImage() { return new T.RawImage(new Uint8ClampedArray(64 * 64 * 3).fill(127), 64, 64, 3); }

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

  return {
    load,
    get info() { return info; },
    async setImage(blob) {
      if (!info) throw new Error('modelos ainda não carregados');
      image = await T.RawImage.fromBlob(blob); embeddings = null;
      if (typeof seg.handle.model.get_image_embeddings === 'function') {
        try { embeddings = await seg.handle.model.get_image_embeddings(await seg.handle.proc(image)); } catch { embeddings = null; } // fall back to a full run per tap
      }
    },
    async segment(x, y) {
      if (!image) throw new Error('nenhuma foto carregada');
      try { return await samRun(seg.handle, image, { x, y }, embeddings); } catch (e) {
        if (!embeddings) throw e;
        embeddings = null; return samRun(seg.handle, image, { x, y }, null); // cached embeddings not accepted by this model: recompute
      }
    },
    async classify(blob, prompts) {
      const img = await T.RawImage.fromBlob(blob);
      const out = await name.handle.p(img, prompts, { hypothesis_template: '{}' });
      return out.map((o) => ({ label: o.label, score: o.score }));
    },
  };
}
