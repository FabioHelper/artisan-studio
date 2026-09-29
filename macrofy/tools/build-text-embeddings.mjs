#!/usr/bin/env node
// CI tool (T-015), run by .github/workflows/macrofy-models.yml on a runner WITH internet access. Run from anywhere.
//   node tools/build-text-embeddings.mjs [--probe-only] [--embeddings-only] [--root <macrofy dir>]
// (a) PROBE: for every candidate of web/lib/models.mjs asks the Hugging Face API for the repo's commit sha and its ONNX files with sizes,
//     and writes web/lib/model-probe.json (plus the copy web/app/data/model-probe.json that the app serves). The order of the naming and
//     segmentation candidates in the browser comes from these real sizes (orderBySize in models.mjs).
// (b) EMBEDDINGS: for each naming candidate loads the TEXT tower here in Node (transformers.js 4.3.0, installed into a temp dir), embeds
//     the prompt template over the vocab `pt` names (and an English prompt over `en`, averaged), plus the non-food labels of the priors,
//     normalizes, and writes web/app/data/text-emb/<safe-model-id>.json with its provenance (model id, revision, labels hash).
// The browser loads only the image tower and scores against these files (checkEmbeddings refuses a file that does not match the vocab).
// Output is deterministic (no timestamps) so the workflow commits only when something changed. A failure of one model is reported and
// skipped; the exit code is 1 only when nothing at all could be written.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SEGMENT_CANDIDATES, NAMING_CANDIDATES, safeModelId, labelsSha256, fillTemplate, checkEmbeddings } from '../web/lib/models.mjs';
import { NAME_PROMPT } from '../web/estimate/core.mjs';

export const TRANSFORMERS_VERSION = '4.3.0';
export const PROMPT_EN = 'a photo of {}';
const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- pure helpers (tested in web/selftest.mjs)
/** One probe entry from the HF model API JSON (`?blobs=true`): commit sha and the ONNX files with sizes, sorted by path. */
export function probeEntry(id, kind, api) {
  const onnx = (api.siblings ?? []).filter((s) => /\.onnx(_data(_\d+)?)?$/.test(s.rfilename))
    .map((s) => ({ path: s.rfilename, size: s.size ?? s.lfs?.size ?? null })).sort((a, b) => a.path.localeCompare(b.path));
  return { id, kind, revision: api.sha, onnx, has_vision_model: onnx.some((f) => /(^|\/)vision_model/.test(f.path)), has_text_model: onnx.some((f) => /(^|\/)text_model/.test(f.path)) };
}
const unit = (v) => { const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1; return v.map((x) => x / n); };
const round5 = (v) => v.map((x) => Math.round(x * 1e5) / 1e5);
/** Mean of the normalized vectors, normalized again. */
export const meanUnit = (vs) => unit(vs[0].map((_, i) => vs.reduce((a, v) => a + v[i], 0) / vs.length));

/**
 * The text-embedding file of one model. `embed(texts) -> number[][]` is the model's text tower (any scale; normalized here).
 * vocab classes give `pt` (+ `en`, averaged as a second prompt); `extraLabels` (non-food, Portuguese only) are embedded with the pt prompt.
 */
export async function buildEmbeddingFile({ modelId, revision, classes, extraLabels = [], embed, template = NAME_PROMPT('{}'), templateEn = PROMPT_EN }) {
  const labels = classes.map((c) => c.pt);
  const pt = (await embed(labels.map((l) => fillTemplate(template, l)))).map(unit);
  const enIdx = classes.flatMap((c, i) => (c.en ? [i] : []));
  const en = (await embed(enIdx.map((i) => fillTemplate(templateEn, classes[i].en)))).map(unit);
  const embeddings = pt.map((v, i) => { const k = enIdx.indexOf(i); return round5(k >= 0 ? meanUnit([v, en[k]]) : v); });
  const extra = extraLabels.length ? (await embed(extraLabels.map((l) => fillTemplate(template, l)))).map((v) => round5(unit(v))) : [];
  return { model_id: modelId, revision, dim: embeddings[0].length, prompt_template: template, prompt_template_en: templateEn, transformers_js: TRANSFORMERS_VERSION,
    labels_sha256: await labelsSha256(labels), labels, embeddings, extra_labels: extraLabels, extra_embeddings: extra };
}

/** JSON with one embedding row per line: readable diffs, compact files. */
export function serializeEmbeddingFile(f) {
  const rows = (rs) => `[\n${rs.map((r) => `    [${r.join(',')}]`).join(',\n')}\n  ]`;
  const { embeddings, extra_embeddings: extra, ...head } = f;
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  lines.push(`  "embeddings": ${rows(embeddings)}`, `  "extra_embeddings": ${extra.length ? rows(extra) : '[]'}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

// ---------------------------------------------------------------- impure steps (network, npm, ONNX)
async function hfProbe(id, kind, previous) {
  const headers = process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {};
  try {
    const r = await fetch(`https://huggingface.co/api/models/${id}?blobs=true`, { headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const api = await r.json(); if (!api.sha) throw new Error('no sha in the response');
    return probeEntry(id, kind, api);
  } catch (e) {
    console.log(`::warning::probe of ${id} failed: ${e.message}${previous ? ' (kept the previous entry)' : ''}`);
    return previous ?? { id, kind, revision: null, onnx: [], error: String(e.message) };
  }
}

async function loadTransformers() {
  const dir = mkdtempSync(join(tmpdir(), 'macrofy-tjs-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"macrofy-tjs-tmp","private":true,"type":"module"}\n');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', `@huggingface/transformers@${TRANSFORMERS_VERSION}`], { cwd: dir, stdio: 'inherit' });
  writeFileSync(join(dir, 'loader.mjs'), "export * from '@huggingface/transformers';\n"); // resolves the package from the temp dir with import conditions
  const T = await import(pathToFileURL(join(dir, 'loader.mjs')).href);
  T.env.cacheDir = join(dir, 'cache'); T.env.allowLocalModels = false;
  return T;
}

/** The candidate's text tower and tokenizer -> embed(texts) (fp32 on the CPU; pooled text embedding, batched). */
async function textEmbedder(T, c, revision) {
  const names = [].concat(c.text); const M = names.map((n) => T[n]).find(Boolean);
  if (!M) throw new Error(`${names.join(' / ')} not present in transformers.js ${TRANSFORMERS_VERSION}`);
  const tokenizer = await T.AutoTokenizer.from_pretrained(c.id, { revision });
  const model = await M.from_pretrained(c.id, { revision, model_file_name: 'text_model', dtype: 'fp32' });
  return async (texts) => {
    const out = [];
    for (let i = 0; i < texts.length; i += 16) {
      const inputs = tokenizer(texts.slice(i, i + 16), { padding: c.pad === 'max_length' ? 'max_length' : true, truncation: true, ...(c.maxLength ? { max_length: c.maxLength } : {}) });
      const o = await model(inputs); const t = o.text_embeds ?? o.pooler_output ?? o.embeds;
      if (!t?.data) throw new Error(`the text tower returned no embedding (outputs: ${Object.keys(o).join(', ')})`);
      const dim = t.dims.at(-1);
      for (let r = 0; r < t.dims[0]; r++) out.push(Array.from(t.data.slice(r * dim, (r + 1) * dim)));
    }
    return out;
  };
}

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

async function main() {
  const root = opt('--root') ?? join(here, '..');
  const probeOnly = args.includes('--probe-only'); const embOnly = args.includes('--embeddings-only');
  const vocab = JSON.parse(readFileSync(join(root, 'nutrition/vocab.json'), 'utf8'));
  const priors = JSON.parse(readFileSync(join(root, 'web/estimate/priors.json'), 'utf8'));
  const extraLabels = priors.autoseg?.non_food_labels?.value ?? [];
  const probePath = join(root, 'web/lib/model-probe.json'); const probeCopy = join(root, 'web/app/data/model-probe.json');
  let wrote = 0;

  // (a) probe
  let probe = existsSync(probePath) ? JSON.parse(readFileSync(probePath, 'utf8')) : { models: [] };
  if (!embOnly) {
    const all = [...SEGMENT_CANDIDATES.map((c) => [c, 'segmentation']), ...NAMING_CANDIDATES.map((c) => [c, 'naming'])];
    const models = [];
    for (const [c, kind] of all) models.push(await hfProbe(c.id, kind, probe.models.find((m) => m.id === c.id && m.revision)));
    probe = { schema: 'macrofy.model-probe/1', transformers_js: TRANSFORMERS_VERSION, models };
    const text = `${JSON.stringify(probe, null, 1)}\n`;
    for (const p of [probePath, probeCopy]) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); wrote++; }
    for (const m of models) console.log(`probe ${m.id} @ ${String(m.revision).slice(0, 8)}: ${m.onnx.length} onnx files, vision_model=${m.has_vision_model ?? '-'}, text_model=${m.has_text_model ?? '-'}`);
  }

  // (b) text embeddings of every naming candidate
  if (!probeOnly) {
    const T = await loadTransformers(); const labels = vocab.classes.map((c) => c.pt);
    for (const c of NAMING_CANDIDATES) {
      const revision = probe.models.find((m) => m.id === c.id)?.revision;
      try {
        if (!revision) throw new Error('no revision in the probe (the probe of this model failed)');
        const file = await buildEmbeddingFile({ modelId: c.id, revision, classes: vocab.classes, extraLabels, embed: await textEmbedder(T, c, revision) });
        const chk = await checkEmbeddings(file, { modelId: c.id, labels });
        if (!chk.ok) throw new Error(`the built file fails its own provenance check: ${chk.reason}`);
        const out = join(root, 'web/app/data/text-emb', `${safeModelId(c.id)}.json`);
        mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, serializeEmbeddingFile(file)); wrote++;
        console.log(`embeddings ${c.id} @ ${revision.slice(0, 8)}: ${file.labels.length}+${file.extra_labels.length} labels, dim ${file.dim} -> ${out}`);
      } catch (e) { console.log(`::warning::text embeddings of ${c.id} failed: ${e.message}`); }
    }
  }
  if (!wrote) { console.error('nothing was written'); process.exit(1); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
