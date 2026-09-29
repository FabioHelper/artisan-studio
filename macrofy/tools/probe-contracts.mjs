#!/usr/bin/env node
// CI tool (T-017), run by .github/workflows/macrofy-models.yml right after tools/build-text-embeddings.mjs, on a runner WITH internet access.
//   node tools/probe-contracts.mjs [--root <macrofy dir>] [--no-ort]
// Records the real ONNX input/output contract of every model file the app can load (F-008: SAM 2.1 refused a prompt shape that only mocked models
// had ever seen). For each candidate of web/lib/models.mjs (segmentation, naming) and the depth candidates of the feasibility page it takes the
// parts the app loads (SAM: vision_encoder and prompt_encoder_mask_decoder; naming: the image tower vision_model; depth: model) in every dtype the
// candidate's backends use, downloads the .onnx at the revision of web/lib/model-probe.json, reads the graph inputs and outputs and writes
// web/lib/model-contracts.json:  models[].files[] = { path, inputs: [{ name, type, dims }], outputs: [...] }.  Symbolic dimensions stay strings,
// fixed ones are numbers, an unknown dimension is null.
// The graph is read with a tiny protobuf reader (parseOnnxIO, below: no dependency, works on files whose weights sit in a separate .onnx_data
// file that we never download). Where the file is self-contained, onnxruntime-node (the runtime transformers.js uses in Node) also opens it and its
// input and output NAMES are compared with the graph: a mismatch is a CI warning. Output is deterministic (no timestamps).
// A failing file keeps its previous entry; the exit code is 1 only when nothing could be written.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEGMENT_CANDIDATES, NAMING_CANDIDATES, backendsOf, onnxFileName } from '../web/lib/models.mjs';
import { STAGES } from '../web/feasibility/candidates.mjs';
import { TRANSFORMERS_VERSION, installTransformers, importFrom } from './tjs-node.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MAX_BYTES = 400 * 2 ** 20; // a bigger file than this is skipped with a warning (the tower files we load are 5 to 200 MB)

// ---------------------------------------------------------------- pure: which files, and the ONNX protobuf reader (tested in web/selftest.mjs)
export const DEPTH_CANDIDATES = STAGES.find((s) => s.stage === 'depth').candidates.map((c) => ({ ...c, probeFiles: ['model'] }));
/** [{ id, kind, parts }] of every model the app or the feasibility page can load. */
export const contractModels = () => [
  ...SEGMENT_CANDIDATES.map((c) => ({ c, kind: 'segmentation' })), ...NAMING_CANDIDATES.map((c) => ({ c, kind: 'naming' })), ...DEPTH_CANDIDATES.map((c) => ({ c, kind: 'depth' })),
].map(({ c, kind }) => ({ id: c.id, kind, parts: c.probeFiles, dtypes: [...new Set(backendsOf(c).map(([, dtype]) => dtype))] }));
/** The .onnx paths of one model to record: every part in every dtype it is loaded with, only those that exist in the probe's file list. */
export function contractPaths(model, probeModel) {
  const have = new Set((probeModel?.onnx ?? []).map((f) => f.path));
  const want = model.parts.flatMap((part) => model.dtypes.map((dtype) => onnxFileName(part, dtype)));
  return { paths: [...new Set(want)].filter((p) => have.has(p)).sort(), missing: [...new Set(want)].filter((p) => !have.has(p)).sort() };
}

const ELEM_TYPES = { 1: 'float32', 2: 'uint8', 3: 'int8', 4: 'uint16', 5: 'int16', 6: 'int32', 7: 'int64', 8: 'string', 9: 'bool', 10: 'float16', 11: 'float64', 12: 'uint32', 13: 'uint64', 14: 'complex64', 15: 'complex128', 16: 'bfloat16' };
function varint(buf, pos) {
  let result = 0; let mul = 1;
  for (;;) { if (pos >= buf.length) throw new Error('truncated varint'); const b = buf[pos++]; result += (b & 0x7f) * mul; if (!(b & 0x80)) return [result, pos]; mul *= 128; if (mul > 2 ** 63) throw new Error('varint too long'); }
}
/** Fields of the protobuf message in buf[start, end): { field, wire, value } for varints, { field, wire, start, end } for length-delimited ones. */
function* fields(buf, start, end) {
  let pos = start;
  while (pos < end) {
    let tag; [tag, pos] = varint(buf, pos); const field = Math.floor(tag / 8); const wire = tag % 8;
    if (wire === 0) { let value; [value, pos] = varint(buf, pos); yield { field, wire, value }; }
    else if (wire === 2) { let len; [len, pos] = varint(buf, pos); if (pos + len > end) throw new Error('truncated field'); yield { field, wire, start: pos, end: pos + len }; pos += len; }
    else if (wire === 1) pos += 8; else if (wire === 5) pos += 4; else throw new Error(`unsupported wire type ${wire}`);
  }
  if (pos !== end) throw new Error('truncated message');
}
const str = (buf, f) => buf.toString('utf8', f.start, f.end);
function valueInfo(buf, f) {
  const out = { name: '', type: null, dims: null };
  for (const a of fields(buf, f.start, f.end)) {
    if (a.field === 1 && a.wire === 2) out.name = str(buf, a);
    else if (a.field === 2 && a.wire === 2) { // TypeProto
      out.type = 'other';
      for (const t of fields(buf, a.start, a.end)) {
        if (t.field !== 1 || t.wire !== 2) continue; // tensor_type; sequences, maps and optionals stay 'other'
        out.type = 'unknown';
        for (const x of fields(buf, t.start, t.end)) {
          if (x.field === 1 && x.wire === 0) out.type = ELEM_TYPES[x.value] ?? `elem_type_${x.value}`;
          else if (x.field === 2 && x.wire === 2) { // TensorShapeProto
            out.dims = [];
            for (const d of fields(buf, x.start, x.end)) {
              if (d.field !== 1 || d.wire !== 2) continue;
              let dim = null; for (const v of fields(buf, d.start, d.end)) { if (v.field === 1 && v.wire === 0) dim = v.value; else if (v.field === 2 && v.wire === 2) dim = str(buf, v); }
              out.dims.push(dim);
            }
          }
        }
      }
    }
  }
  return out;
}
/** The graph inputs (without initializers, i.e. the tensors a caller must feed) and outputs of an ONNX model file: { inputs, outputs } of { name, type, dims }. */
export function parseOnnxIO(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let graph = null;
  for (const f of fields(buf, 0, buf.length)) if (f.field === 7 && f.wire === 2) graph = f;
  if (!graph) throw new Error('not an ONNX model (no graph)');
  const inputs = []; const outputs = []; const initializers = new Set();
  for (const f of fields(buf, graph.start, graph.end)) {
    if (f.wire !== 2) continue;
    if (f.field === 11) inputs.push(valueInfo(buf, f));
    else if (f.field === 12) outputs.push(valueInfo(buf, f));
    else if (f.field === 5) for (const t of fields(buf, f.start, f.end)) if (t.field === 8 && t.wire === 2) initializers.add(str(buf, t)); // TensorProto.name
  }
  return { inputs: inputs.filter((i) => !initializers.has(i.name)), outputs };
}

// ---------------------------------------------------------------- impure steps (network, ONNX Runtime)
const hfUrl = (id, revision, path) => `https://huggingface.co/${id}/resolve/${revision}/${path}`;
async function download(url, attempts = 3) { // retried: one flaky download must not fail the whole job
  const headers = process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {};
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers }); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const len = Number(r.headers.get('content-length') ?? 0); if (len > MAX_BYTES) throw Object.assign(new Error(`${len} bytes is over the ${MAX_BYTES} limit`), { final: true });
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { if (e.final || i >= attempts) throw e; await new Promise((res) => setTimeout(res, 2000 * i)); }
  }
}
/** onnxruntime-node's own view of a self-contained file: { inputNames, outputNames }, or null when the runtime cannot open it. */
async function ortNames(ort, bytes) {
  let s = null;
  try { s = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['cpu'], graphOptimizationLevel: 'disabled' }); return { inputNames: [...s.inputNames], outputNames: [...s.outputNames] }; }
  catch { return null; } finally { try { await s?.release(); } catch { /* ignore */ } }
}

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

async function main() {
  const root = opt('--root') ?? join(here, '..');
  const probePath = join(root, 'web/lib/model-probe.json'); const outPath = join(root, 'web/lib/model-contracts.json');
  if (!existsSync(probePath)) { console.error('web/lib/model-probe.json is missing: run tools/build-text-embeddings.mjs first'); process.exit(1); }
  const probe = JSON.parse(readFileSync(probePath, 'utf8'));
  const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { models: [] };
  let ort = null;
  if (!args.includes('--no-ort')) {
    try { const { dir } = await installTransformers(); ort = await importFrom(dir, 'onnxruntime-node'); } catch (e) { console.log(`::warning::onnxruntime-node unavailable, the graphs are recorded without the runtime cross-check: ${e.message}`); }
  }
  const models = []; let files = 0;
  for (const m of contractModels()) {
    const pm = probe.models.find((x) => x.id === m.id); const prev = previous.models.find((x) => x.id === m.id);
    const entry = { id: m.id, kind: m.kind, revision: pm?.revision ?? null, files: [] };
    if (!pm?.revision) { console.log(`::warning::no revision in the probe for ${m.id}: kept the previous contracts`); models.push(prev ?? entry); continue; }
    const { paths, missing } = contractPaths(m, pm);
    for (const p of missing) console.log(`::warning::${m.id}: ${p} is not in the repository (the app would fail to load this dtype)`);
    for (const path of paths) {
      const old = prev?.revision === pm.revision ? prev.files.find((f) => f.path === path && !f.error) : null;
      if (old) { entry.files.push(old); files++; continue; } // same revision: nothing to download again
      try {
        const bytes = await download(hfUrl(m.id, pm.revision, path));
        const io = parseOnnxIO(bytes); const f = { path, inputs: io.inputs, outputs: io.outputs };
        const external = pm.onnx.some((x) => x.path === `${path}_data`);
        const rt = ort && !external ? await ortNames(ort, bytes) : null;
        if (rt && (rt.inputNames.join() !== io.inputs.map((i) => i.name).join() || rt.outputNames.join() !== io.outputs.map((o) => o.name).join())) {
          console.log(`::warning::${m.id} ${path}: onnxruntime reports inputs [${rt.inputNames}] outputs [${rt.outputNames}], the graph reader [${io.inputs.map((i) => i.name)}] [${io.outputs.map((o) => o.name)}]`);
        }
        entry.files.push(f); files++;
        console.log(`contract ${m.id} ${path}: ${io.inputs.map((i) => `${i.name}:${i.type}[${i.dims ?? '?'}]`).join(' ')}${rt ? ' (runtime agrees)' : ''}`);
      } catch (e) {
        console.log(`::warning::contract of ${m.id} ${path} failed: ${e.message}`);
        const kept = prev?.files.find((f) => f.path === path); entry.files.push(kept ?? { path, error: String(e.message).slice(0, 200), inputs: [], outputs: [] });
      }
    }
    models.push(entry);
  }
  if (!files) { console.error('no contract could be recorded'); process.exit(1); }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify({ schema: 'macrofy.model-contracts/1', transformers_js: TRANSFORMERS_VERSION, models }, null, 1)}\n`);
  console.log(`wrote ${outPath}: ${models.length} models, ${files} files`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
