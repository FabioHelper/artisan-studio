import { LABELS, STAGES, backendsOf } from './candidates.mjs';
import { importTransformers, loadCandidate, detectWebGpu } from '../lib/models.mjs';
import { median, buildResults, freshState, recordCrash, nextStage, candidatesLeft, failedStage } from './verdict.mjs';

// Each stage runs in its own page load: after a stage the page reloads, so the models of earlier stages are freed (the iPhone 16e
// killed the tab when SAM loaded on top of the depth model, F-005). The state is saved before every attempt; a tab that died is
// recorded as a crashed CANDIDATE on the next load, and the run resumes with the next candidate of the same stage.
const KEY = 'macrofy.feasibility.v2';
const PHOTO_KEY = `${KEY}.photo`;
const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
let T, state = freshState();

function syntheticPlate() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'), blob = (x, y, rx, ry, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); };
  g.fillStyle = '#8b6b4a'; g.fillRect(0, 0, 512, 512);
  blob(256, 256, 230, 215, '#e8e8e8'); blob(256, 256, 190, 178, '#fafafa');
  blob(200, 250, 85, 70, '#f4f1e6'); blob(330, 230, 60, 50, '#4a2a1a'); blob(300, 330, 70, 40, '#c98a3a'); blob(180, 340, 40, 30, '#3f8a3a');
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
}
/** The chosen photo survives the page reloads between stages as a small data URL; otherwise the synthetic plate. */
async function testImage() {
  try { const u = localStorage.getItem(PHOTO_KEY); if (u) return await (await fetch(u)).blob(); } catch {}
  return syntheticPlate();
}
async function rememberPhoto(file) {
  try {
    const bmp = await createImageBitmap(file); const s = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); localStorage.setItem(PHOTO_KEY, c.toDataURL('image/jpeg', 0.85));
  } catch { try { localStorage.removeItem(PHOTO_KEY); } catch {} }
}

const loadModel = (c, opts) => loadCandidate(T, c, opts); // shared loader: the same code path the estimate screens use

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

/** One stage: candidates in order (skipping ones that crashed the tab), each on its own backends. */
async function runStage(def, img, hasGpu, log) {
  const attempts = [...(state.attempts[def.stage] ?? [])];
  for (const c of candidatesLeft(state, def)) for (const [device, dtype] of backendsOf(c)) {
    if (device === 'webgpu' && !hasGpu) continue;
    log(`${def.title}: tentando ${c.id} (${device}/${dtype})…`);
    state.running = { stage: def.stage, candidate: c.id, device, dtype }; save(state); // still set if the tab dies during this attempt
    try {
      const r = await attempt(c, device, dtype, img);
      state.running = null;
      return { stage: def.stage, ...r, ...(attempts.length ? { failed_attempts: attempts } : {}) };
    } catch (e) {
      state.running = null; attempts.push(`${c.id} ${device}/${dtype}: ${String(e?.message || e).slice(0, 160)}`);
      state.attempts = { ...state.attempts, [def.stage]: attempts }; save(state);
    }
  }
  return failedStage(def.stage, 'nenhum candidato carregou', attempts);
}

function render(extra = '') {
  const res = buildResults({ ua: navigator.userAgent, webgpu: !!navigator.gpu, stages: state.stages, crashes: state.crashes });
  $('rows').innerHTML = state.stages.map((s) => `<tr><td>${s.stage}</td><td>${s.ok ? 'OK' : 'FALHOU'}</td><td>${s.backend || '-'}${s.dtype ? `/${s.dtype}` : ''}</td>
    <td>${s.infer_ms_median ?? '-'} ms</td><td>${(s.bytes / 1e6).toFixed(0)} MB</td></tr>`).join('');
  $('verdict').textContent = state.finished ? (res.verdict === 'go' ? 'Resultado: VIÁVEL (go)' : 'Resultado: NÃO VIÁVEL (no-go)') : extra;
  $('out').value = JSON.stringify(res, null, 2);
  $('results').hidden = state.stages.length === 0 && state.crashes.length === 0;
}

/** Runs the next stage of the plan in this page load, then reloads for the one after (or finishes). */
async function runNext() {
  $('go').disabled = true;
  try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
  const log = (m) => { $('status').textContent = m; };
  try {
    const def = nextStage(state, STAGES);
    if (!def) { state.finished = true; state.auto = false; save(state); log('Pronto! Toque em "Copiar resultados".'); }
    else {
      log('Carregando a biblioteca…');
      const lib = await importTransformers(); // 4.3.0 first, 3.8.1 if the import fails
      T = lib.T;
      log(`Biblioteca ${lib.version} carregada${lib.errors.length ? ` (falhou: ${lib.errors.join('; ')})` : ''}.`);
      const hasGpu = await detectWebGpu();
      const img = await T.RawImage.fromBlob(await testImage());
      state.stages.push(await runStage(def, img, hasGpu, log));
      state.running = null; save(state); render(`Concluído: ${def.title}`);
      if (nextStage(state, STAGES)) { log(`Etapa "${def.title}" concluída. Recarregando a página para liberar memória…`); setTimeout(() => location.reload(), 400); return; }
      state.finished = true; state.auto = false; save(state); log('Pronto! Toque em "Copiar resultados".');
    }
  } catch (e) { state.auto = false; save(state); log(`Erro: ${e?.message || e}`); }
  $('go').disabled = false; $('go').textContent = 'Refazer o teste'; render();
}

function start() {
  const keep = state.finished ? freshState() : state; // "Refazer" starts over; "Continuar" keeps what is done
  state = { ...keep, auto: true }; save(state); runNext();
}

function init() {
  state = { ...freshState(), ...(load() || {}) };
  if (state.running) { // the previous tab died mid-attempt: record the crashed candidate; the same stage resumes with the next one
    const r = state.running; state = recordCrash(state); save(state);
    $('status').textContent = `A aba foi encerrada ao testar ${r.candidate} (${r.stage}). ${state.auto ? 'Continuando com o próximo candidato…' : 'Toque em "Continuar o teste".'}`;
    $('go').textContent = 'Continuar o teste';
  }
  if (state.stages.length || state.crashes.length) render();
  $('go').onclick = start;
  $('photo').onchange = async (e) => { const f = e.target.files[0]; if (f) await rememberPhoto(f); };
  $('copy').onclick = async () => {
    $('out').select();
    try { await navigator.clipboard.writeText($('out').value); $('copy').textContent = 'Copiado!'; }
    catch { document.execCommand('copy'); $('copy').textContent = 'Se não copiou, copie o texto acima'; }
  };
  $('reset').onclick = () => { try { localStorage.removeItem(KEY); localStorage.removeItem(PHOTO_KEY); } catch {} location.reload(); };
  if (state.auto && !state.finished) runNext(); // the page reloaded between stages (or after a killed tab): carry on
}
init();
