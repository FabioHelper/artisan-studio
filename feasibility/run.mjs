import { STAGES } from './candidates.mjs';
import { importTransformers, loadCandidate, detectWebGpu, loadProbe, orderBySize, prepareEmbeddings, vocabLabels, embedImage, scoreImage, fileTracker } from '../lib/models.mjs';
import { median, buildResults, migrateState, recordCrash, nextStage, nextAttempt, beginAttempt, endAttempt, noteFetching, recordFailure, recordStorage, storageRecord, failedStage } from './verdict.mjs';

// Each stage runs in its own page load: after a stage the page reloads, so the models of earlier stages are freed (the iPhone 16e
// killed the tab when SAM loaded on top of the depth model, F-005). The unit is ONE ATTEMPT (model, device, dtype): it is marked tried and
// the state is saved before it starts; a tab that died is recorded as ONE crashed attempt on the next load, and the run continues with the
// next untried attempt of the SAME stage (F-006). See verdict.mjs.
const KEY = 'macrofy.feasibility.v2'; // the saved state carries its own version (migrateState): a state of an older page is discarded
const PHOTO_KEY = `${KEY}.photo`;
const $ = (id) => document.getElementById(id);
const now = () => performance.now();
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
let T, state = migrateState(null);
const EMB_BASE = new URL('../app/data/text-emb/', location.href).href; // the same committed files the app scores against
const VOCAB_URL = new URL('../app/data/vocab.json', location.href);
const PROBE_URLS = [new URL('../lib/model-probe.json', location.href), new URL('../app/data/model-probe.json', location.href)];

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

/** navigator.storage.estimate() and persisted(), recorded before each stage (Safari's "Load failed" may be a storage quota problem). */
async function storageDiag() {
  try {
    const st = navigator.storage;
    const [est, per] = await Promise.all([st?.estimate?.().catch(() => null), st?.persisted?.().catch(() => null)]);
    return storageRecord(est, per, st ? null : 'navigator.storage indisponível');
  } catch (e) { return storageRecord(null, null, String(e?.message || e)); }
}

// prepared[model id] = { revision, table } for vision-only naming candidates: the checked text embeddings (fails before any download)
const prepared = new Map();
const prepare = (c) => { if (!prepared.has(c.id)) prepared.set(c.id, prepareEmbeddings(c.id, { labels: () => vocabLabels(VOCAB_URL), base: EMB_BASE })); return prepared.get(c.id); };

const INFER = {
  'depth-estimation': (h, img) => h.p(img),
  vision: (h, img, prep) => embedImage(h, img).then((v) => scoreImage(v, prep.table, prep.id, [...prep.table.keys()])),
  sam: async (h, img) => { // one point prompt at the image center
    const inputs = await h.proc(img, { input_points: [[[img.width / 2, img.height / 2]]] });
    const out = await h.model(inputs);
    await h.proc.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  },
};

async function attempt(a, img, tracker) {
  const c = a.c, { device, dtype } = a;
  const files = new Map();
  const progress = tracker.callback;
  const prep = c.vision ? { ...(await prepare(c)), id: c.id } : null; // throws "embeddings missing/stale" before anything is downloaded
  const rev = prep ? { revision: prep.revision } : {};
  const track = (e) => { if (e.status === 'progress' && e.file) files.set(e.file, e.loaded || 0); };
  let t = now(), h = await loadCandidate(T, c, { device, dtype, ...rev, progress_callback: (e) => { track(e); progress(e); } });
  const load_ms = now() - t;
  await INFER[h.task](h, img, prep); // warm-up: WebGPU shader errors show up here, so fall back before timing
  await h.dispose();
  t = now(); h = await loadCandidate(T, c, { device, dtype, ...rev });
  const cached_load_ms = now() - t, runs = [];
  for (let i = 0; i < 3; i++) { t = now(); await INFER[h.task](h, img, prep); runs.push(now() - t); }
  await h.dispose();
  return { model: c.id, backend: device, dtype, bytes: [...files.values()].reduce((x, y) => x + y, 0),
    load_ms: Math.round(load_ms), cached_load_ms: Math.round(cached_load_ms),
    infer_ms_median: Math.round(median(runs)), ok: true };
}

/** One stage: every attempt (model, device, dtype) not tried yet, in order, until one works or none is left. */
async function runStage(def, img, hasGpu, log) {
  for (let a = nextAttempt(state, def, hasGpu); a; a = nextAttempt(state, def, hasGpu)) {
    log(`${def.title}: tentando ${a.candidate} (${a.device}/${a.dtype})…`);
    state = beginAttempt(state, def.stage, a); save(state); // marked tried and still `running` if the tab dies during this attempt
    let lastUrl = null;
    const tracker = fileTracker(a.candidate, () => { // remember the file being fetched: a killed tab then says where it died
      if (tracker.url !== lastUrl) { lastUrl = tracker.url; state = noteFetching(state, tracker); save(state); }
    });
    try {
      const r = await attempt(a, img, tracker);
      state = endAttempt(state); save(state);
      const failed = state.attempts[def.stage] ?? [];
      return { stage: def.stage, ...r, ...(failed.length ? { failed_attempts: failed } : {}) };
    } catch (e) {
      state = recordFailure(state, def.stage, a, e, { file: tracker.file, url: tracker.url, inFlight: tracker.inFlight }); save(state);
    }
  }
  return failedStage(def.stage, 'nenhuma tentativa carregou', state.attempts[def.stage]);
}

function render(extra = '') {
  const res = buildResults({ ua: navigator.userAgent, webgpu: !!navigator.gpu, stages: state.stages, crashes: state.crashes, storage: state.storage, failures: state.failures });
  $('rows').innerHTML = state.stages.map((s) => `<tr><td>${s.stage}</td><td>${s.ok ? 'OK' : 'FALHOU'}</td><td>${s.backend || '-'}${s.dtype ? `/${s.dtype}` : ''}</td>
    <td>${s.infer_ms_median ?? '-'} ms</td><td>${(s.bytes / 1e6).toFixed(0)} MB</td></tr>`).join('');
  $('verdict').textContent = state.finished ? (res.verdict === 'go' ? 'Resultado: VIÁVEL (go)' : 'Resultado: NÃO VIÁVEL (no-go)') : extra;
  $('out').value = JSON.stringify(res, null, 2);
  $('results').hidden = state.stages.length === 0 && state.crashes.length === 0 && state.failures.length === 0;
}

/** The stage list with segmentation and naming candidates ordered by real size when the CI probe file exists (smallest first). */
async function stagesBySize() {
  const probe = await loadProbe(PROBE_URLS);
  return STAGES.map((d) => (d.stage === 'depth' ? d : { ...d, candidates: orderBySize(d.candidates, probe) }));
}

/** Runs the next stage of the plan in this page load, then reloads for the one after (or finishes). */
async function runNext() {
  $('go').disabled = true;
  try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
  const log = (m) => { $('status').textContent = m; };
  try {
    const stages = await stagesBySize();
    const def = nextStage(state, stages);
    if (!def) { state.finished = true; state.auto = false; save(state); log('Pronto! Toque em "Copiar resultados".'); }
    else {
      log('Carregando a biblioteca…');
      const lib = await importTransformers(); // 4.3.0 first, 3.8.1 if the import fails
      T = lib.T;
      log(`Biblioteca ${lib.version} carregada${lib.errors.length ? ` (falhou: ${lib.errors.join('; ')})` : ''}.`);
      const hasGpu = await detectWebGpu();
      state = recordStorage(state, def.stage, await storageDiag()); save(state); // before the stage: quota, usage, persisted
      const img = await T.RawImage.fromBlob(await testImage());
      state.stages.push(await runStage(def, img, hasGpu, log));
      state.running = null; save(state); render(`Concluído: ${def.title}`);
      if (nextStage(state, stages)) { log(`Etapa "${def.title}" concluída. Recarregando a página para liberar memória…`); setTimeout(() => location.reload(), 400); return; }
      state.finished = true; state.auto = false; save(state); log('Pronto! Toque em "Copiar resultados".');
    }
  } catch (e) { state.auto = false; save(state); log(`Erro: ${e?.name || 'Error'}: ${e?.message || e}`); }
  $('go').disabled = false; $('go').textContent = 'Refazer o teste'; render();
}

function start() {
  const keep = state.finished ? migrateState(null) : state; // "Refazer" starts over; "Continuar" keeps what is done
  state = { ...keep, auto: true }; save(state); runNext();
}

function init() {
  state = migrateState(load());
  if (state.running) { // the previous tab died mid-attempt: record that attempt as crashed; the same stage continues with its next attempt
    const r = state.running; state = recordCrash(state); save(state);
    $('status').textContent = `A aba foi encerrada ao testar ${r.candidate} ${r.device}/${r.dtype} (${r.stage}). ${state.auto ? 'Continuando com a próxima tentativa…' : 'Toque em "Continuar o teste".'}`;
    $('go').textContent = 'Continuar o teste';
  }
  if (state.stages.length || state.crashes.length || state.failures.length) render();
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
