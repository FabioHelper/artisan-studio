import { TRANSFORMERS_URL, LABELS, STAGES, BACKENDS } from './candidates.mjs';
import { median, buildResults } from './verdict.mjs';

const KEY = 'macrofy.feasibility.v1';
const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
let T, photo = null, state = { stages: [], running: null, finished: false };

function syntheticPlate() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'), blob = (x, y, rx, ry, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); };
  g.fillStyle = '#8b6b4a'; g.fillRect(0, 0, 512, 512);
  blob(256, 256, 230, 215, '#e8e8e8'); blob(256, 256, 190, 178, '#fafafa');
  blob(200, 250, 85, 70, '#f4f1e6'); blob(330, 230, 60, 50, '#4a2a1a'); blob(300, 330, 70, 40, '#c98a3a'); blob(180, 340, 40, 30, '#3f8a3a');
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
}

async function loadModel(c, opts) {
  if (c.task) { const p = await T.pipeline(c.task, c.id, opts); return { task: c.task, p, dispose: () => p.dispose() }; }
  const M = T[c.sam];
  if (!M) throw new Error(`${c.sam} indisponível nesta versão da biblioteca`);
  const [model, proc] = await Promise.all([M.from_pretrained(c.id, opts), T.AutoProcessor.from_pretrained(c.id)]);
  return { task: 'sam', model, proc, dispose: () => model.dispose() };
}

const INFER = {
  'depth-estimation': (h, img) => h.p(img),
  'zero-shot-image-classification': (h, img) => h.p(img, LABELS),
  sam: async (h, img) => { // one point prompt at the image center
    const inputs = await h.proc(img, { input_points: [[[img.width / 2, img.height / 2]]] });
    const out = await h.model(inputs);
    await h.proc.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  },
};

async function attempt(c, device, dtype, img) {
  const files = new Map();
  const progress = (e) => { if (e.status === 'progress' && e.file) files.set(e.file, e.loaded || 0); };
  let t = now(), h = await loadModel(c, { device, dtype, progress_callback: progress });
  const load_ms = now() - t;
  await INFER[h.task](h, img); // warm-up: WebGPU shader errors show up here, so fall back before timing
  await h.dispose();
  t = now(); h = await loadModel(c, { device, dtype });
  const cached_load_ms = now() - t, runs = [];
  for (let i = 0; i < 3; i++) { t = now(); await INFER[h.task](h, img); runs.push(now() - t); }
  await h.dispose();
  return { model: c.id, backend: device, dtype, bytes: [...files.values()].reduce((a, b) => a + b, 0),
    load_ms: Math.round(load_ms), cached_load_ms: Math.round(cached_load_ms),
    infer_ms_median: Math.round(median(runs)), ok: true };
}

async function runStage(def, img, hasGpu, log) {
  const errors = [];
  for (const c of def.candidates) for (const [device, dtype] of BACKENDS) {
    if (device === 'webgpu' && !hasGpu) continue;
    log(`${def.title}: tentando ${c.id} (${device}/${dtype})…`);
    try { return { stage: def.stage, ...(await attempt(c, device, dtype, img)), ...(errors.length ? { failed_attempts: errors } : {}) }; }
    catch (e) { errors.push(`${c.id} ${device}/${dtype}: ${String(e?.message || e).slice(0, 160)}`); }
  }
  return failed(def.stage, 'nenhum candidato carregou', errors);
}

const failed = (stage, error, failed_attempts) => ({ stage, model: null, backend: null, bytes: 0, load_ms: null,
  cached_load_ms: null, infer_ms_median: null, ok: false, error, ...(failed_attempts ? { failed_attempts } : {}) });

function render(extra = '') {
  const res = buildResults({ ua: navigator.userAgent, webgpu: !!navigator.gpu, stages: state.stages, crashedStage: state.crashed || null });
  $('rows').innerHTML = state.stages.map((s) => `<tr><td>${s.stage}</td><td>${s.ok ? 'OK' : 'FALHOU'}</td><td>${s.backend || '-'}</td>
    <td>${s.infer_ms_median ?? '-'} ms</td><td>${(s.bytes / 1e6).toFixed(0)} MB</td></tr>`).join('');
  $('verdict').textContent = state.finished ? (res.verdict === 'go' ? 'Resultado: VIÁVEL (go)' : 'Resultado: NÃO VIÁVEL (no-go)') : extra;
  $('out').value = JSON.stringify(res, null, 2);
  $('results').hidden = state.stages.length === 0;
}

async function start() {
  $('go').disabled = true;
  try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
  const log = (m) => { $('status').textContent = m; };
  try {
    log('Carregando a biblioteca…');
    T = await import(TRANSFORMERS_URL);
    T.env.allowLocalModels = false;
    const hasGpu = !!(navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null));
    const img = await T.RawImage.fromBlob(photo || await syntheticPlate());
    if (state.finished) state = { stages: [], running: null, finished: false };
    for (const def of STAGES) {
      if (state.stages.some((s) => s.stage === def.stage)) continue; // resume after a killed tab
      state.running = def.stage; save(state);
      state.stages.push(await runStage(def, img, hasGpu, log));
      state.running = null; save(state); render(`Concluído: ${def.title}`);
    }
    state.finished = true; save(state); log('Pronto! Toque em "Copiar resultados".');
  } catch (e) { log(`Erro: ${e?.message || e}`); }
  $('go').disabled = false; $('go').textContent = 'Refazer o teste'; render();
}

function init() {
  state = load() || state;
  if (state.running) { // the previous tab died mid-stage: record it and resume with the next stage
    state.crashed = state.running;
    state.stages.push(failed(state.running, 'aba encerrada pelo Safari (tab survived: false)'));
    state.running = null; save(state);
    $('status').textContent = `A aba foi encerrada na etapa "${state.crashed}". Toque em "Continuar" para testar as demais.`;
    $('go').textContent = 'Continuar o teste';
  }
  if (state.stages.length) render();
  $('go').onclick = start;
  $('photo').onchange = (e) => { photo = e.target.files[0] || null; };
  $('copy').onclick = async () => {
    $('out').select();
    try { await navigator.clipboard.writeText($('out').value); $('copy').textContent = 'Copiado!'; }
    catch { document.execCommand('copy'); $('copy').textContent = 'Se não copiou, copie o texto acima'; }
  };
  $('reset').onclick = () => { try { localStorage.removeItem(KEY); } catch {} location.reload(); };
}
init();
