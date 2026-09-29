#!/usr/bin/env node
// CI test (T-017), run by .github/workflows/macrofy-model-it.yml on a runner WITH internet access:
//   node macrofy/tools/model-integration-test.mjs        (from the repo root; also works from anywhere)
// Runs OUR web/lib/models.mjs (createModels) on the REAL models, because mocked models hid F-008 (SAM 2.1 refused a prompt shape the app built):
// transformers.js 4.3.0 is installed into a temp dir and imported in Node; the app's model layer gets it through the injectable `importer`.
// WebGPU does not exist here, so the candidates are narrowed to the CPU with the q8 dtype (the tensor shapes do not depend on the dtype) and the
// library's device 'wasm' is mapped to Node's 'cpu'. The test photo is built in code (a light ellipse plate on a dark table with three coloured
// blobs, RGBA pixels in a RawImage). For each SAM candidate (SlimSAM, SAM 2.1 tiny) with CLIP B/32 as the namer it runs
//   1. a single-tap decode on a blob,  2. a grid decode (one decoder run per point) on the embedding computed once,
//   3. the auto mode (web/estimate/autoseg.mjs detectAuto) over the same models,  4. naming of a crop against the committed text embeddings;
// and the other naming candidates that have committed text embeddings are loaded and asked once (a failure there is a warning: the app falls back).
// Asserts: masks come back with the image dimensions, predicted IoUs are finite, naming returns vocab labels, and for the PROVEN segmenter (SAM 2.1 tiny,
// the model the owner's iPhone runs) auto mode finds a plate and at least one food item on the synthetic photo AND on a real openly licensed photo of a plate
// of food from Wikimedia Commons (tools/it-photo.mjs; hard once tools/it-photo.json is pinned, a warning before). The auto stage reports why each plate
// candidate was kept or refused (plate_cols / plate_rows) and per-stage timings (encoder, plate decodes, food decodes, naming, total), so a missing plate is
// diagnosable from the summary alone. Prints one compact JSON summary and exits 1 when a required stage failed.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModels, SEGMENT_CANDIDATES, NAMING_CANDIDATES, PROVEN_ATTEMPTS, safeModelId } from '../web/lib/models.mjs';
import { resolvePhoto } from './it-photo.mjs';
import { autosegParams, detectAuto, gridPoints } from '../web/estimate/autoseg.mjs';
import { namePrompts, topNames, NAME_PROMPT } from '../web/estimate/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- pure helpers (exercised by web/selftest.mjs against a fake library)
/** The test photo: RGBA pixels of a light elliptical plate on a dark table with three coloured blobs. Deterministic. */
export function makePlateImage(width = 640, height = 480) {
  const cx = width / 2; const cy = height / 2; const plate = { cx, cy, a: width * 0.38, b: height * 0.36 };
  const blobs = [
    { name: 'tomato', cx: cx - 0.15 * width, cy: cy + 0.02 * height, r: 0.09 * width, rgb: [200, 50, 40] },
    { name: 'salad', cx: cx + 0.13 * width, cy: cy - 0.06 * height, r: 0.085 * width, rgb: [60, 150, 60] },
    { name: 'rice', cx: cx + 0.02 * width, cy: cy + 0.14 * height, r: 0.075 * width, rgb: [225, 200, 120] },
  ];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgb = [118 + (x * 12) / width, 82 + (y * 10) / height, 58]; // wooden table
    const e = ((x - plate.cx) / plate.a) ** 2 + ((y - plate.cy) / plate.b) ** 2;
    if (e <= 1) rgb = e > 0.85 ? [200, 200, 196] : [236, 236, 231]; // rim, then the plate
    for (const b of blobs) if ((x - b.cx) ** 2 + (y - b.cy) ** 2 <= b.r ** 2) rgb = b.rgb;
    const o = (y * width + x) * 4; data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
  }
  return { width, height, data, plate, blobs };
}
/** RGBA sub-image around the 1-pixels of a mask (bounding box grown by `pad`, at least 32 x 32). -> { width, height, data } */
export function cropRgba(img, mask, pad = 8) {
  let x0 = mask.width; let y0 = mask.height; let x1 = -1; let y1 = -1;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (mask.data[y * mask.width + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = img.width - 1; y1 = img.height - 1; }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(img.width - 1, x1 + pad); y1 = Math.min(img.height - 1, y1 + pad);
  const w = Math.max(32, x1 - x0 + 1); const h = Math.max(32, y1 - y0 + 1); const sx = Math.min(x0, img.width - w); const sy = Math.min(y0, img.height - h);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = ((sy + y) * img.width + (sx + x)) * 4; data.set(img.data.subarray(s, s + 4), (y * w + x) * 4); }
  return { width: w, height: h, data };
}
/**
 * The library as the app's model layer sees it, adapted to Node: the app's device 'wasm' becomes Node's 'cpu' (no WebAssembly backend in
 * onnxruntime-node) and RawImage.fromBlob unwraps the { raw } test blobs (Node has no image decoder for our in-memory pixels).
 */
export function nodeLib(T) {
  const lib = { ...T };
  for (const [k, v] of Object.entries(T)) {
    if (typeof v?.from_pretrained !== 'function') continue;
    lib[k] = { from_pretrained: (id, o = {}) => v.from_pretrained(id, o.device === 'wasm' ? { ...o, device: 'cpu' } : o) };
  }
  lib.RawImage = new Proxy(T.RawImage, { get: (target, key) => (key === 'fromBlob' ? async (blob) => blob.raw : target[key]) });
  return lib;
}
/** A candidate narrowed to the CPU with one dtype (q8 by default: the smallest that every model here ships, the shapes are dtype-independent). */
export const cpuCandidate = (c, dtype = 'q8') => ({ ...c, backends: [['wasm', dtype]] });

// ---------------------------------------------------------------- the test
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
function assertMasks(masks, { width, height }, what) {
  assert.ok(masks.length >= 1, `${what}: no masks`);
  for (const m of masks) {
    assert.equal(m.width, width, `${what}: mask width`); assert.equal(m.height, height, `${what}: mask height`); assert.equal(m.data.length, width * height, `${what}: mask size`);
    assert.ok(finite(m.score), `${what}: predicted IoU ${m.score} is not finite`);
  }
}
const ms = (t0) => Math.round(performance.now() - t0);

/** Runs the whole test on a transformers.js module `T`. -> { ok, summary } (never throws for a failing stage: the stage is listed in summary.failures) */
export async function runIntegration({ T, root = join(here, '..'), log = () => {}, gridN = null, loadEmbeddings: loadEmb = null, loadPhoto = null } = {}) {
  const vocab = JSON.parse(readFileSync(join(root, 'nutrition/vocab.json'), 'utf8'));
  const priors = JSON.parse(readFileSync(join(root, 'web/estimate/priors.json'), 'utf8'));
  const params = { ...autosegParams(priors), time_budget_ms: 20 * 60 * 1000 }; // CPU on a CI runner, not the phone budget
  const classes = vocab.classes; const labels = classes.map((c) => c.pt); const ids = new Set(classes.map((c) => c.id));
  const nfPrompts = params.non_food_labels.map((l) => NAME_PROMPT(l)); const prompts = [...namePrompts(classes), ...nfPrompts];
  const emb = (id) => join(root, 'web/app/data/text-emb', `${safeModelId(id)}.json`);
  const loadEmbeddings = loadEmb ?? (async (id) => (existsSync(emb(id)) ? JSON.parse(readFileSync(emb(id), 'utf8')) : null));
  const blobOf = ({ data, width, height }) => ({ raw: new T.RawImage(data, width, height, 4) }); // the test "blob": nodeLib's fromBlob unwraps it
  const photo = makePlateImage(); const blob = blobOf(photo);
  const size = { width: photo.width, height: photo.height };
  const lib = nodeLib(T);
  const summary = { transformers_js: '4.3.0', image: `${photo.width}x${photo.height}`, sam: [], naming: [], failures: [], warnings: [] };
  const stage = async (bucket, name, fn) => { const t0 = performance.now(); try { const r = await fn(); bucket[name] = { ok: true, ms: ms(t0), ...r }; log(`ok   ${name}`); return true; } catch (e) { bucket[name] = { ok: false, error: String(e.message).slice(0, 300), ...(e.details ?? {}) }; summary.failures.push(`${name}: ${String(e.message).slice(0, 300)}`); log(`FAIL ${name}: ${e.message}`); return false; } };
  const make = (extra) => createModels({ importer: async () => lib, labels, loadEmbeddings, probe: { models: [] }, ...extra });
  const clip = NAMING_CANDIDATES.find((c) => c.id === 'Xenova/clip-vit-base-patch32');
  const nameOf = async (models, maskOrBlob) => { // naming of one crop: scores over the app's prompts, ranked back to vocab classes
    const scores = await models.classify(maskOrBlob, prompts);
    assert.equal(scores.length, prompts.length, 'one score per prompt'); assert.ok(scores.every((s) => finite(s.score)), 'finite scores');
    assert.ok(Math.abs(scores.reduce((a, s) => a + s.score, 0) - 1) < 1e-6, 'scores sum to 1');
    const top = topNames(scores, classes, 3); assert.equal(top.length, 3, 'three names'); assert.ok(top.every((n) => ids.has(n.cls.id)), 'names are vocab classes');
    return top.map((n) => ({ id: n.cls.id, score: Number(n.score.toFixed(3)) }));
  };

  const PLATE_COLS = ['x', 'y', 'score', 'area_frac', 'area_raw', 'cover', 'residual', 'residual_raw', 'verdict'];
  /** Auto mode over one photo with per-stage timings and the plate candidate table. `require`: it must find a plate and at least one food. */
  const autoRun = async (models, img, encoderMs, label, require) => {
    const r = await detectAuto({ models, params, classes, width: img.width, height: img.height, crop: async (mask) => blobOf(cropRgba(img, mask)), diagnostics: true });
    const t = r.timings;
    const out = { status: r.status, items: r.items.map((i) => i.cls.id), rejected: r.rejected.length, prompts: t.prompts, decode_ms: t.decode_ms, classify_ms: t.classify_ms,
      timings: { encoder_ms: encoderMs, plate_decode_ms: t.plate_decode_ms, food_decode_ms: t.food_decode_ms, naming_ms: t.classify_ms, total_ms: encoderMs + t.total_ms },
      plate: r.plate ? { area_frac: Number(r.plate.area_frac.toFixed(3)), residual: Number(r.plate.residual.toFixed(3)), filled: r.plate.filled } : null,
      plate_cols: PLATE_COLS, plate_rows: (r.plate_candidates ?? []).map((c) => PLATE_COLS.map((k) => c[k])) };
    try {
      assert.ok(['ok', 'no_plate', 'empty_plate'].includes(r.status), `auto status ${r.status}`); assert.ok(t.prompts >= params.plate_grid_n ** 2, 'the plate grid was decoded');
      for (const it of r.items) { assert.ok(ids.has(it.cls.id), 'auto item is a vocab class'); assert.equal(it.mask.width, img.width); assert.ok(finite(it.score)); }
      if (require) { assert.ok(r.plate, `auto mode on ${label} found no plate (status ${r.status}): see plate_rows for the area, centre cover and ellipse residual of every candidate`); assert.ok(r.items.length >= 1, `auto mode on ${label} found a plate but no food item (status ${r.status})`); }
    } catch (e) { throw Object.assign(e, { details: out }); }
    return out;
  };
  let photoJob = null; // the real photo is fetched once, before the first model loads
  if (loadPhoto) photoJob = loadPhoto().then((v) => ({ v }), (e) => ({ e }));

  for (const sam of SEGMENT_CANDIDATES) {
    const proven = sam.id === PROVEN_ATTEMPTS[0][0];
    const entry = { id: sam.id }; summary.sam.push(entry);
    const models = make({ segmentCandidates: [cpuCandidate(sam)], namingCandidates: [cpuCandidate(clip)], sequential: false });
    let loaded = false;
    await stage(entry, 'load', async () => { const info = await models.load(); assert.equal(info.segmenter, sam.id); assert.equal(info.namer, clip.id); loaded = true; return { backend: info.backend, namer_backend: info.namer_backend }; });
    if (!loaded) continue;
    let ready = false; let encoderMs = 0;
    await stage(entry, 'set_image', async () => { const e = await models.setImage(blob); assert.equal(e.cached, true, 'the image embedding must be cached (computed once), not recomputed per decode'); ready = true; encoderMs = e.encoder_ms; return { encoder_ms: e.encoder_ms }; });
    if (ready) {
      const tap = photo.blobs[0];
      await stage(entry, 'single_tap', async () => { const m = await models.segment(tap.cx, tap.cy); assertMasks(m, size, 'single tap'); assert.ok(m.some((x) => x.data.some((v) => v)), 'single tap: every mask is empty'); return { masks: m.length, best_iou: Number(m[0].score.toFixed(3)) }; });
      await stage(entry, 'grid', async () => {
        const pts = gridPoints(photo.width, photo.height, gridN ?? params.plate_grid_n); const progress = [];
        const r = await models.segmentPoints(pts, { batch: params.decode_batch, budgetMs: Infinity, perPoint: 1, onProgress: (e) => progress.push(e.done) });
        assert.equal(r.masks.length, pts.length, 'one mask per point'); assert.equal(r.decodes, pts.length, 'one decoder run per point'); assert.equal(r.done, pts.length); assert.equal(r.timed_out, false);
        assertMasks(r.masks, size, 'grid'); assert.equal(progress.at(-1), pts.length);
        return { points: pts.length, decodes: r.decodes, decode_ms: r.ms };
      });
      await stage(entry, 'auto', () => autoRun(models, photo, encoderMs, 'the synthetic plate', proven)); // the proven segmenter MUST find plate and food
    }
    await stage(entry, 'naming', async () => ({ model: clip.id, top3: await nameOf(models, blobOf(cropRgba(photo, blobMask(photo, photo.blobs[0])))) }));
    if (proven && photoJob) {
      const pj = await photoJob;
      if (pj.e) { // the photo could not be fetched or its hash changed: a failure when it is pinned, a warning while it is not
        entry.photo = { ok: false, error: String(pj.e.message).slice(0, 300) };
        if (pj.e.hashChanged || pj.e.pinned) summary.failures.push(`photo: ${pj.e.message}`); else summary.warnings.push(`photo not available (unpinned): ${pj.e.message}`);
      } else {
        const { img, meta } = pj.v; entry.photo = { title: meta.title, url: meta.url, license: meta.license, author: meta.author, sha256: meta.sha256, pinned: meta.pinned, size: `${img.width}x${img.height}` };
        if (!meta.pinned) summary.warnings.push(`unpinned test photo: paste this into tools/it-photo.json after looking at it: ${JSON.stringify(meta.pin)}`);
        const bucket = {};
        const ok = await stage(bucket, 'photo_auto', async () => { const e = await models.setImage(blobOf(img)); return autoRun(models, img, e.encoder_ms, meta.title, true); });
        Object.assign(entry.photo, { auto: bucket.photo_auto });
        if (!ok && !meta.pinned) { summary.failures.pop(); summary.warnings.push(`unpinned photo: ${bucket.photo_auto.error}`); }
      }
    }
    await models.dispose();
  }

  for (const c of NAMING_CANDIDATES.filter((x) => x.id !== clip.id)) { // the fallbacks: reported, not required
    const entry = { id: c.id }; summary.naming.push(entry);
    if (!(await loadEmbeddings(c.id))) { entry.skipped = 'no committed text embeddings'; continue; }
    const models = make({ segmentCandidates: [cpuCandidate(SEGMENT_CANDIDATES[0])], namingCandidates: [cpuCandidate(c)], sequential: true });
    const crop = blobOf(cropRgba(photo, blobMask(photo, photo.blobs[1])));
    const bucket = {}; const ok = await stage(bucket, 'naming', async () => { await models.load(); return { top3: await nameOf(models, crop) }; });
    Object.assign(entry, bucket.naming);
    if (!ok) { summary.failures.pop(); summary.warnings.push(`${c.id}: ${bucket.naming.error}`); }
    try { await models.dispose(); } catch { /* ignore */ }
  }
  return { ok: summary.failures.length === 0, summary };
}
/** A full-photo 0/1 mask of one blob. */
function blobMask(photo, b) { const data = new Uint8Array(photo.width * photo.height); for (let y = 0; y < photo.height; y++) for (let x = 0; x < photo.width; x++) if ((x - b.cx) ** 2 + (y - b.cy) ** 2 <= b.r ** 2) data[y * photo.width + x] = 1; return { width: photo.width, height: photo.height, data }; }

/** The pinned real photo, downloaded and decoded (RGBA, at most 640 px wide), with its metadata. */
export async function defaultLoadPhoto(T, { root = join(here, '..'), fetchImpl = fetch } = {}) {
  const cfg = JSON.parse(readFileSync(join(root, 'tools/it-photo.json'), 'utf8'));
  let meta; try { meta = await resolvePhoto(cfg, { fetchImpl }); } catch (e) { throw Object.assign(e, { pinned: typeof cfg.sha256 === 'string' && cfg.sha256.length === 64 }); }
  const raw = await T.RawImage.fromBlob(new Blob([meta.bytes])); const k = Math.min(1, 640 / raw.width);
  const rgba = (k < 1 ? await raw.resize(Math.round(raw.width * k), Math.round(raw.height * k)) : raw).rgba();
  const { bytes, ...rest } = meta; // the summary never carries the bytes
  return { img: { width: rgba.width, height: rgba.height, data: rgba.data }, meta: rest };
}

async function main() {
  const { installTransformers } = await import('./tjs-node.mjs');
  const { T } = await installTransformers();
  const { ok, summary } = await runIntegration({ T, log: (s) => console.log(s), loadPhoto: () => defaultLoadPhoto(T) });
  for (const w of summary.warnings) console.log(`::warning::${w}`);
  console.log(JSON.stringify(summary));
  if (!ok) { for (const f of summary.failures) console.log(`::error::${f}`); process.exit(1); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
