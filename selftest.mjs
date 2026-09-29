// Check `web-selftest`: node web/selftest.mjs (built-ins only; run from macrofy/).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = dirname(fileURLToPath(import.meta.url));
const f = (p) => join(web, p);
const text = (p) => readFileSync(f(p), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

const files = ['index.html', 'feasibility/index.html', 'feasibility/run.mjs', 'feasibility/candidates.mjs', 'feasibility/verdict.mjs'];
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

t('transformers.js URL is pinned to an exact 3.x version', () =>
  assert.match(cand.TRANSFORMERS_URL, /^https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@3\.\d+\.\d+$/));
t('no unpinned CDN import anywhere in the page code', () => files.forEach((p) => {
  for (const m of text(p).matchAll(/@huggingface\/transformers(?!@3\.\d+\.\d+)/g)) assert.fail(`unpinned reference in web/${p} at ${m.index}`);
}));
t('run.mjs imports the pinned URL from candidates.mjs', () => assert.match(text('feasibility/run.mjs'), /import\(TRANSFORMERS_URL\)/));
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

console.log(`web selftest: ${n} checks passed`);
