// Estimate screens. T-016 (ADR 0006): zero setup. The default flow is camera -> automatic analysis -> result, with no plate registration,
// ruler or tap; plate scale is the typical-plate prior. Plate choice, taps, oil and weighed-meal linking live under "Ajustes / Corrigir".
// On the result the owner may "Conferir com balança" (optional): each check is stored in the checks store and web/estimate/calibration.mjs
// learns a factor and conformal ranges from them.
// T-014 automatic mode (default): photo -> automatic plate and foods -> ONE confirmation screen (names, grams, macros,
// ranges) where taps only correct (rename, remove, merge, split, add a missed item). T-013 manual mode ("Modo manual"): photo -> plate
// -> rim tap -> food taps -> names -> oil -> result. Both end in save/export.
// The maths is in vendor/estimate-core.mjs and the mask post-processing in vendor/autoseg.mjs (pure, tested in Node); the models come
// from vendor/models.mjs or from an injected window.__macrofyModels (tests). Everything here is DOM and state; app.mjs wires it.
import * as core from './vendor/estimate-core.mjs';
import * as auto from './vendor/autoseg.mjs';
import { createLookup } from './vendor/lookup-core.mjs';
import * as cal from './vendor/calibration.mjs';
import { sha256Hex } from './lib.mjs';

const MAX_SIDE = 1024; // the working photo: SAM resizes to 1024 anyway, and masks come back in these pixels
const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080', '#9a6324', '#800000'];
const n0 = (x) => String(Math.round(x));
const n1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
const n2 = (x) => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const TYPICAL = '__typical__'; // plate id of the "prato típico" prior (a plate that is not registered)
const DRAFT = 'estimate_draft'; // IndexedDB kv key: the estimate in progress, so a reloaded tab can resume

export function createEstimate(ctx) {
  const { h, show, back, errorBox, toast, db, objUrl, fmtDate, bitmapOf, searchVocab, isoWithOffset, getVocab } = ctx;
  let st = fresh();
  let staticData = null; let modelsP = null; let lookup = null;

  function fresh() {
    return { mode: 'auto', notice: '', auto: null, tapMode: null, timings: null, encoder_ms: null, corrections: {}, step: 'photo', work: null, workBlob: null, imageSetFor: null, plateId: '', rim: null, items: [], oil: 'normal', mealId: '', saved: null, busy: '', error: '', model: { status: 'idle' }, query: {}, naming: false, namingRun: 0, snap: null, adjustOpen: false, checkOpen: false, checkForm: { items: {}, total: '', other: '' }, checkErrors: [], checkSaved: null };
  }
  const getModels = () => globalThis.__macrofyModels ?? (modelsP ??= import('./vendor/models.mjs').then((m) => m.createModels({ labels: () => getVocab().classes.map((c) => c.pt) })));
  async function loadStatic() {
    staticData ??= (async () => {
      const [priors, calRaw] = await Promise.all(['data/priors.json', 'data/calibration.json'].map(async (u) => (await fetch(u)).json()));
      return { priors, calibration: core.loadCalibration(calRaw) };
    })();
    return staticData;
  }
  const getLookup = () => (lookup ??= createLookup(getVocab()));

  // ---------------------------------------------------------------- models
  function paintProgress() {
    const bar = document.getElementById('model-progress'); const label = document.getElementById('model-label');
    if (!bar || !label) return;
    if (st.model.fraction == null) bar.removeAttribute('value'); else bar.value = Math.round(st.model.fraction * 100);
    label.textContent = `${st.model.label ?? 'Preparando…'}${st.model.fraction != null ? ` ${Math.round(st.model.fraction * 100)}%` : ''}`;
  }
  function ensureModels() {
    if (st.model.status === 'loading' || st.model.status === 'ready') return;
    const mine = st.model = { status: 'loading', fraction: null, label: 'Preparando…' };
    mine.done = (async () => {
      try {
        const m = await getModels();
        mine.info = await m.load((p) => { mine.fraction = p.fraction; mine.label = p.label; paintProgress(); });
        mine.status = 'ready';
        await syncImage();
      } catch (e) { mine.status = 'error'; mine.error = e.message; }
      if (st.model === mine && /^#\/estimate/.test(location.hash)) render(); // the home screen warms the models up: never paint over it
    })();
  }
  async function syncImage() {
    if (st.model.status !== 'ready' || !st.workBlob || st.imageSetFor === st.workBlob) return;
    const enc = await (await getModels()).setImage(st.workBlob);
    st.imageSetFor = st.workBlob; st.encoder_ms = enc?.encoder_ms ?? st.encoder_ms;
  }
  const modelBox = () => {
    if (st.model.status === 'ready') return null;
    if (st.model.status === 'error') return h('div', { class: 'errors', role: 'alert' }, h('strong', {}, 'Não consegui carregar os modelos.'), h('p', {}, st.model.error), h('button', { class: 'secondary small', onclick: () => { st.model = { status: 'idle' }; ensureModels(); render(); } }, 'Tentar de novo'));
    return h('div', { class: 'card' }, h('p', { id: 'model-label' }, st.model.label ?? 'Preparando…'), h('progress', { id: 'model-progress', max: 100 }),
      h('p', { class: 'muted' }, 'Na primeira vez baixa os modelos (várias centenas de MB): use o Wi-Fi. Depois ficam guardados no aparelho.'));
  };

  // ---------------------------------------------------------------- canvas
  function maskLayer(mask, color, alpha) {
    const c = document.createElement('canvas'); c.width = mask.width; c.height = mask.height;
    const g = c.getContext('2d'); const img = g.createImageData(mask.width, mask.height);
    const r = parseInt(color.slice(1, 3), 16); const gr = parseInt(color.slice(3, 5), 16); const b = parseInt(color.slice(5, 7), 16);
    for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) { img.data[i * 4] = r; img.data[i * 4 + 1] = gr; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = alpha; }
    g.putImageData(img, 0, 0); return c;
  }
  /** A canvas showing the working photo with the plate ellipse and the item masks; `onTap(x, y)` gets image pixels. */
  function stage({ plate = false, items = false, onTap }) {
    const cv = h('canvas', { id: 'stage', class: 'stage', width: st.work.width, height: st.work.height, role: 'img', 'aria-label': 'Foto do prato. Toque para marcar.' });
    const g = cv.getContext('2d'); g.drawImage(st.work, 0, 0);
    if (plate && st.rim) {
      g.drawImage(maskLayer(st.rim.masks[st.rim.idx], '#00a0ff', 70), 0, 0);
      const e = st.rim.scale.ellipse; g.strokeStyle = '#00a0ff'; g.lineWidth = 4; g.beginPath(); g.ellipse(e.cx, e.cy, e.a, e.b, e.angle_rad, 0, Math.PI * 2); g.stroke();
    }
    if (items) st.items.forEach((it, i) => g.drawImage(maskLayer(it.masks[it.idx], COLORS[i % COLORS.length], 110), 0, 0));
    if (onTap) cv.addEventListener('click', (ev) => {
      const r = cv.getBoundingClientRect();
      onTap((ev.clientX - r.left) * cv.width / r.width, (ev.clientY - r.top) * cv.height / r.height);
    });
    return cv;
  }

  // ---------------------------------------------------------------- flow control
  const VIEWS = { photo: viewPhoto, auto: viewAuto, confirm: viewConfirm, plate: viewPlate, rim: viewRim, foods: viewFoods, names: viewNames, oil: viewOil, result: viewResult };
  let renderSeq = 0; // a slower view that started earlier must not paint over a newer one
  function render(top = false) {
    const y = top ? 0 : window.scrollY; const mine = ++renderSeq;
    VIEWS[st.step]().then((nodes) => { if (mine !== renderSeq) return; show(back('#/', 'Início'), h('h1', {}, 'Estimar'), stepper(), st.notice ? h('div', { class: 'banner', role: 'status', id: 'notice' }, st.notice) : null, errorBox(st.error ? [st.error] : []), ...[nodes].flat(4)); window.scrollTo(0, y); })
      .catch((e) => { console.error(e); if (mine === renderSeq) show(back(), h('div', { class: 'errors', role: 'alert' }, `Erro: ${e.message}`)); });
  }
  const STEPS = [['photo', 'Foto'], ['plate', 'Prato'], ['rim', 'Borda'], ['foods', 'Alimentos'], ['names', 'Nomes'], ['oil', 'Óleo'], ['result', 'Resultado']];
  const STEPS_AUTO = [['photo', 'Foto'], ['auto', 'Análise'], ['confirm', 'Resultado']];
  const stepper = () => {
    const steps = st.mode === 'auto' ? STEPS_AUTO : STEPS; const i = steps.findIndex((x) => x[0] === st.step);
    return i < 0 ? null : h('p', { class: 'muted', 'aria-label': 'Etapa' }, `Etapa ${i + 1} de ${steps.length}: ${steps[i][1]}`);
  };
  const go = (step, notice = '') => { st.step = step; st.error = ''; st.busy = ''; st.notice = notice; render(true); };
  const nav = (prev, next, nextLabel, nextDisabled) => h('div', { class: 'stack', style: 'margin-top:14px' },
    next ? h('button', { id: 'next', disabled: nextDisabled, onclick: next }, nextLabel) : null, prev ? h('button', { class: 'secondary', onclick: prev }, '‹ Voltar') : null);
  const busyBox = () => (st.busy ? h('p', { class: 'card', role: 'status' }, st.busy) : null);

  // 1. photo
  async function useFile(file) {
    st.busy = 'Preparando a foto…'; st.error = ''; render();
    try {
      const bmp = await bitmapOf(file); const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
      st = { ...fresh(), mode: st.mode, model: st.model, plateId: st.plateId, work: c, workBlob: blob, step: 'plate' };
      ensureModels(); syncImage().catch(() => {});
      if (st.mode === 'auto') { saveDraft(); startAuto(); return; }
    } catch (e) { st.busy = ''; st.error = `Não consegui abrir a foto: ${e.message}`; }
    render();
  }
  async function viewPhoto() {
    const isAuto = st.mode === 'auto';
    const draft = st.work ? null : await db.getSetting(DRAFT).catch(() => null);
    const picker = (label, capture, cls) => h('label', { class: `btn ${cls}` }, label,
      h('input', { type: 'file', accept: 'image/*', ...(capture ? { capture: 'environment' } : {}), onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) useFile(f); } }));
    ensureModels();
    return [h('p', {}, isAuto ? 'Fotografe o prato de cima (ou o mais de cima que der), inteiro no quadro, com a borda visível. Sem zoom. O Macrofy acha o prato e os alimentos sozinho.'
        : 'Modo manual. Fotografe o prato de cima (ou o mais de cima que der), inteiro no quadro, com a borda visível. Sem zoom.'),
      draft?.photo ? h('div', { class: 'card', id: 'draft' }, h('p', {}, `Você tinha uma estimativa em andamento (${fmtDate(draft.savedAt)}).`),
        h('div', { class: 'row' }, h('button', { id: 'resume', class: 'small', onclick: resumeDraft }, 'Retomar'),
          h('button', { class: 'secondary small', onclick: async () => { await db.setSetting(DRAFT, null); render(); } }, 'Descartar'))) : null,
      st.work ? h('button', { class: 'secondary', onclick: () => (isAuto ? startAuto() : go('plate')) }, 'Continuar com a foto atual') : null,
      picker('Tirar foto', true, ''), h('div', { style: 'height:10px' }), picker('Escolher da galeria', false, 'secondary'), busyBox(), modelBox(),
      h('button', { id: 'mode-toggle', class: 'secondary', style: 'margin-top:14px', onclick: () => { st.mode = isAuto ? 'manual' : 'auto'; render(); } }, isAuto ? 'Modo manual (marcar com toques)' : 'Voltar ao modo automático')];
  }

  // plate scale: the last used registered plate, else the only registered one, else the "prato típico" prior
  async function defaultPlateId() {
    const plates = await db.getAll('plates'); const last = (await db.getSetting('last_used'))?.plate;
    return plates.some((p) => p.id === last) ? last : (plates.length === 1 ? plates[0].id : TYPICAL);
  }
  async function plateSetupNow() {
    const [plates, data] = await Promise.all([db.getAll('plates'), loadStatic()]);
    return auto.plateSetup(data.priors, plates.find((p) => p.id === st.plateId) ?? null);
  }
  const plateOptions = (plates, data) => [...plates.map((p) => ({ id: p.id, label: `${p.name} (${p.diameter_mm} mm)` })), { id: TYPICAL, label: `Prato típico (${n0(data.priors.typical_plate.diameter_mm / 10)} cm, faixa mais larga)` }];

  // 2. plate choice (manual mode)
  async function viewPlate() {
    const [plates, data] = await Promise.all([db.getAll('plates'), loadStatic()]);
    if (!st.plateId) st.plateId = await defaultPlateId();
    const sel = h('select', { id: 'plate-select', onchange: (e) => { st.plateId = e.target.value; render(); }, value: st.plateId },
      plateOptions(plates, data).map((o) => h('option', { value: o.id }, o.label)));
    return [h('h2', {}, 'Qual prato é este?'), h('p', { class: 'muted' }, 'O diâmetro externo cadastrado é a régua da foto. Sem prato cadastrado, use o prato típico: a faixa da estimativa fica mais larga.'), sel, nav(() => go('photo'), () => go('rim'), 'Próximo', !st.plateId)];
  }

  // ---------------------------------------------------------------- automatic mode (T-014)
  const AUTO_LABELS = { models: 'Preparando os modelos…', plate: 'Encontrando o prato…', foods: 'Encontrando os alimentos…', naming: 'Dando nome aos alimentos…' };
  function paintAuto() {
    const a = st.auto; const label = document.getElementById('auto-label'); const bar = document.getElementById('auto-progress');
    if (!a || !label || !bar) return;
    label.textContent = `${AUTO_LABELS[a.phase] ?? ''}${a.total ? ` ${a.done}/${a.total}` : ''}`;
    if (a.total) bar.value = Math.round(100 * a.done / a.total); else bar.removeAttribute('value');
  }
  const toItem = (it) => ({ masks: [it.mask], idx: 0, tap: null, cls: it.cls, top: it.top ?? null, cropBlob: it.blob ?? null, parts: it.parts?.map(toItem), auto: true });
  const fallbackManual = (me, message) => { me.mode = 'manual'; me.auto = null; me.step = 'rim'; me.error = ''; me.busy = ''; me.notice = message; render(true); };

  /** Photo -> plate + foods with no taps. No plate found (or a failure) switches to manual mode with a message. */
  async function startAuto() {
    const me = st; const t0 = performance.now(); const cold = me.model.status !== 'ready';
    Object.assign(me, { step: 'auto', error: '', notice: '', busy: '', items: [], rim: null, tapMode: null, auto: { phase: 'models', done: 0, total: 0 } });
    render(true);
    const live = () => st === me && me.step === 'auto';
    try {
      if (me.model.status === 'error') me.model = { status: 'idle' };
      ensureModels(); await me.model.done;
      if (me.model.status !== 'ready') throw new Error(me.model.error ?? 'modelos indisponíveis');
      await syncImage(); if (!live()) return;
      const data = await loadStatic(); const m = await getModels();
      if (typeof m.segmentPoints !== 'function') throw new Error('este conjunto de modelos não faz o modo automático');
      if (!me.plateId) me.plateId = await defaultPlateId();
      const res = await auto.detectAuto({
        models: m, params: auto.autosegParams(data.priors), classes: getVocab().classes, width: me.work.width, height: me.work.height, crop: cropBlob,
        onStage: (e) => { const changed = me.auto.phase !== e.stage; me.auto = { phase: e.stage, done: e.done ?? 0, total: e.total ?? 0 }; if (!live()) return; if (changed) render(); else paintAuto(); },
      });
      if (!live()) return;
      me.timings = { mode: 'auto', status: res.status, encoder_ms: me.encoder_ms, ...res.timings, detect_ms: res.timings.total_ms, total_ms: Math.round(performance.now() - t0), models_cold: cold };
      if (res.status === 'no_plate') return fallbackManual(me, 'Não encontrei o prato automaticamente. Vamos no modo manual: toque uma vez na borda do prato.');
      me.rim = { masks: [res.plate.mask], idx: 0, tap: null, scale: null, auto: true };
      await setRimScale();
      me.items = res.items.map(toItem);
      await saveDraft();
      go('confirm', res.status === 'empty_plate' ? 'Achei o prato, mas nenhum alimento. Toque em "Adicionar alimento" ou use o modo manual.' : '');
    } catch (e) { console.error(e); if (live()) fallbackManual(me, `O modo automático não funcionou (${e.message}). Vamos no modo manual: toque uma vez na borda do prato.`); }
  }
  async function viewAuto() {
    const a = st.auto ?? { phase: 'models', done: 0, total: 0 };
    return [h('h2', {}, 'Analisando a foto'), stage({}),
      h('div', { class: 'card', role: 'status' }, h('p', { id: 'auto-label' }, `${AUTO_LABELS[a.phase] ?? ''}${a.total ? ` ${a.done}/${a.total}` : ''}`), h('progress', { id: 'auto-progress', max: 100, ...(a.total ? { value: Math.round(100 * a.done / a.total) } : {}) })),
      a.phase === 'models' ? modelBox() : null,
      h('details', { class: 'fix' }, h('summary', {}, 'Ajustes / Corrigir'), h('button', { id: 'go-manual', class: 'secondary', onclick: () => { st.mode = 'manual'; go('plate'); } }, 'Modo manual (marcar com toques)'))];
  }

  // draft: the estimate in progress lives in IndexedDB, so a tab that Safari killed (or a reload) resumes instead of starting over
  async function saveDraft() {
    try {
      const m = (mask) => (mask ? { width: mask.width, height: mask.height, data: mask.data } : null);
      await db.setSetting(DRAFT, { savedAt: isoWithOffset(), mode: st.mode, plateId: st.plateId, oil: st.oil, photo: st.workBlob, timings: st.timings, encoder_ms: st.encoder_ms, corrections: st.corrections,
        plate: st.rim ? m(st.rim.masks[st.rim.idx]) : null,
        items: st.items.map((it) => ({ mask: m(it.masks[it.idx]), cls: it.cls?.id ?? null, top: it.top?.map((t) => ({ id: t.cls.id, score: t.score })) ?? null })) });
    } catch (e) { console.warn('draft not saved', e); }
  }
  async function resumeDraft() {
    const d = await db.getSetting(DRAFT); if (!d?.photo) return;
    try {
      const bmp = await bitmapOf(d.photo); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); bmp.close?.();
      const byId = new Map(getVocab().classes.map((x) => [x.id, x]));
      st = { ...fresh(), model: st.model, mode: d.mode ?? 'auto', plateId: d.plateId ?? '', oil: d.oil ?? 'normal', work: c, workBlob: d.photo, encoder_ms: d.encoder_ms ?? null, timings: d.timings ?? null, corrections: d.corrections ?? {} };
      ensureModels();
      if (!d.plate) return startAuto(); // the tab died during the analysis: run it again on the same photo
      st.rim = { masks: [d.plate], idx: 0, tap: null, scale: null, auto: true }; await setRimScale();
      st.items = d.items.filter((it) => it.mask).map((it) => ({ masks: [it.mask], idx: 0, tap: null, cls: byId.get(it.cls) ?? null, top: it.top?.map((t) => ({ cls: byId.get(t.id), score: t.score })).filter((t) => t.cls) ?? null, auto: true }));
      go('confirm', 'Retomei a estimativa que estava em andamento.');
    } catch (e) { st.error = `Não consegui retomar: ${e.message}`; render(); }
  }

  // 3. rim tap -> plate mask -> ellipse -> scale
  async function tapRim(x, y) {
    if (st.model.status !== 'ready' || st.busy) return;
    st.busy = 'Calculando o contorno do prato…'; st.error = ''; render();
    try {
      await syncImage();
      const masks = await (await getModels()).segment(x, y);
      st.rim = { masks, idx: 0, tap: { x, y }, scale: null };
      await setRimScale();
    } catch (e) { st.rim = null; st.error = `Não consegui contornar o prato: ${e.message}`; }
    st.busy = ''; render();
  }
  async function setRimScale() {
    const setup = await plateSetupNow();
    const mask = st.rim.masks[st.rim.idx];
    const frac = core.maskCount(mask) / (mask.width * mask.height);
    try { st.rim.scale = core.scaleFromPlateMask(mask, setup.diameter_mm); st.rim.diameter_mm = setup.diameter_mm; st.rim.setup = setup; }
    catch (e) { st.rim.scale = null; st.error = e.message; return; }
    st.rim.warn = frac < 0.05 ? 'O contorno ficou muito pequeno: provavelmente pegou só a borda ou o fundo. Toque de novo ou troque o contorno.' : frac > 0.9 ? 'O contorno cobre quase a foto inteira: toque de novo na borda do prato.' : '';
  }
  async function viewRim() {
    const tilt = st.rim?.scale ? Math.round(Math.acos(st.rim.scale.cos_tilt) * 180 / Math.PI) : null;
    return [h('h2', {}, 'Toque uma vez na borda do prato'), h('p', { class: 'muted' }, 'O contorno azul deve cercar o prato inteiro. A forma da elipse dá a escala (mm por pixel) e a inclinação da câmera.'),
      stage({ plate: true, onTap: tapRim }), busyBox(), modelBox(),
      st.rim?.scale ? h('div', { class: 'card' }, `Escala: ${n2(st.rim.scale.mm_per_px)} mm por pixel. Ângulo da câmera: ${tilt}° (0° = de cima).`,
        tilt > 65 ? h('p', { class: 'muted' }, 'Foto muito inclinada: a estimativa fica menos confiável. Prefira fotografar mais de cima.') : null) : null,
      st.rim?.warn ? h('div', { class: 'banner' }, st.rim.warn) : null,
      st.rim?.setup?.typical ? h('p', { class: 'muted' }, 'Prato típico: sem o diâmetro do seu prato a escala é aproximada e a faixa fica mais larga.') : null,
      st.rim && st.rim.masks.length > 1 ? h('button', { class: 'secondary', onclick: async () => { st.rim.idx = (st.rim.idx + 1) % st.rim.masks.length; await setRimScale(); render(); } }, 'Trocar contorno') : null,
      nav(() => go('plate'), () => go('foods'), 'Confirmar o prato', !st.rim?.scale)];
  }

  // 4. food taps -> one mask per item
  async function tapFood(x, y) {
    if (st.model.status !== 'ready' || st.busy) return;
    st.busy = 'Calculando o contorno do alimento…'; st.error = ''; render();
    try {
      await syncImage();
      const masks = await (await getModels()).segment(x, y);
      st.items.push({ masks, idx: 0, tap: { x, y }, cls: null, top: null }); st.namingRun++;
    } catch (e) { st.error = `Não consegui contornar o alimento: ${e.message}`; }
    st.busy = ''; render();
  }
  async function viewFoods() {
    return [h('h2', {}, 'Toque em cada alimento'), h('p', { class: 'muted' }, 'Um toque por alimento, no meio dele. Cada contorno colorido vira um item.'),
      stage({ plate: true, items: true, onTap: tapFood }), busyBox(), modelBox(),
      st.items.map((it, i) => h('div', { class: 'card row' }, h('span', { style: `width:18px;height:18px;border-radius:9px;background:${COLORS[i % COLORS.length]};flex:none` }), h('strong', { class: 'grow' }, `Item ${i + 1}`),
        it.masks.length > 1 ? h('button', { class: 'secondary small', onclick: () => { it.idx = (it.idx + 1) % it.masks.length; it.top = null; it.cls = null; it.cropBlob = null; st.namingRun++; render(); } }, 'Trocar contorno') : null,
        h('button', { class: 'danger small', onclick: () => { st.items.splice(i, 1); st.namingRun++; render(); } }, 'Remover'))),
      nav(() => go('rim'), () => { go('names'); }, 'Nomear os alimentos', st.items.length === 0)];
  }

  // 5. names: image embedding scored against the committed text embeddings of the vocab pt names (T-015; no guess when they are missing/stale)
  function cropBlob(mask) {
    const box = core.maskBBox(mask); if (!box) return null;
    const mx = Math.round((box.x1 - box.x0) * 0.1); const my = Math.round((box.y1 - box.y0) * 0.1);
    const x0 = Math.max(0, box.x0 - mx); const y0 = Math.max(0, box.y0 - my); const x1 = Math.min(mask.width - 1, box.x1 + mx); const y1 = Math.min(mask.height - 1, box.y1 + my);
    const w = x1 - x0 + 1; const hh = y1 - y0 + 1;
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(st.work, x0, y0, w, hh, 0, 0, w, hh);
    const img = g.getImageData(0, 0, w, hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (!mask.data[(y + y0) * mask.width + (x + x0)]) { const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 127; }
    g.putImageData(img, 0, 0);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
  }
  async function nameAll() {
    if (st.naming || st.model.status !== 'ready') return;
    const run = st.namingRun; const todo = st.items.filter((it) => !it.top);
    if (!todo.length) return;
    st.naming = true; render();
    try {
      const m = await getModels(); const classes = getVocab().classes; const prompts = core.namePrompts(classes);
      for (const it of todo) {
        it.cropBlob = await cropBlob(it.masks[it.idx]);
        it.top = core.topNames(await m.classify(it.cropBlob, prompts), classes, 3);
        if (run !== st.namingRun) break; // items changed meanwhile: the next render restarts
        render();
      }
    } catch (e) { st.error = `Não consegui sugerir nomes: ${e.message}`; todo.forEach((it) => { it.top ??= []; }); }
    st.naming = false; render();
  }
  /** The name choices of one item: its top-3, "outro…" and the vocabulary search. `onPick` runs after a name is chosen. */
  function namePicker(it, i, onPick = () => render()) {
    const classes = getVocab().classes; const q = st.query[i] ?? null;
    const results = q !== null ? searchVocab(classes, q, 12) : [];
    if (!it.top) return h('p', { class: 'muted', role: 'status' }, st.naming ? 'Pensando…' : 'Aguardando os modelos…');
    return h('div', { class: 'stack' },
      it.top.map((t) => h('button', { class: it.cls?.id === t.cls.id ? '' : 'secondary', 'data-name': t.cls.id, onclick: () => { it.cls = t.cls; onPick(); } }, cap(t.cls.pt))),
      h('button', { class: 'secondary', 'data-name': 'other', onclick: () => { st.query[i] = st.query[i] ?? ''; render(); } }, 'outro…'),
      q !== null ? h('div', {}, h('input', { type: 'search', placeholder: 'Buscar alimento (ex.: arroz, frango)…', value: q, autocomplete: 'off', id: `search-${i}`, oninput: (e) => { st.query[i] = e.target.value; const pos = e.target.selectionStart; render(); const el = document.getElementById(`search-${i}`); el?.focus(); el?.setSelectionRange(pos, pos); } }),
        q.trim() ? h('div', { class: 'results' }, results.length ? results.map((c) => h('button', { type: 'button', 'data-name': c.id, onclick: () => { it.cls = c; st.query[i] = null; onPick(); } }, c.pt)) : h('p', { class: 'muted', style: 'padding:8px 12px' }, 'Nada encontrado. Tente outra palavra.')) : null) : null);
  }
  async function viewNames() {
    setTimeout(nameAll, 0);
    const cards = st.items.map((it, i) => h('div', { class: 'card item' }, h('div', { class: 'row' }, h('span', { style: `width:18px;height:18px;border-radius:9px;background:${COLORS[i % COLORS.length]};flex:none` }), h('h3', {}, `Item ${i + 1}${it.cls ? `: ${it.cls.pt}` : ''}`)),
      it.cropBlob ? h('img', { src: objUrl(it.cropBlob), alt: `Recorte do item ${i + 1}`, style: 'max-width:100%;max-height:140px;border-radius:10px;margin:6px 0' }) : null, namePicker(it, i)));
    return [h('h2', {}, 'Que alimento é cada um?'), h('p', { class: 'muted' }, 'Toque no nome certo. Se nenhum servir, use "outro…".'), busyBox(), modelBox(), cards,
      nav(() => go('foods'), () => go('oil'), 'Próximo', st.items.some((it) => !it.cls))];
  }

  // 6. oil (multipliers are priors.oil_levels, assumptions)
  const oilPicker = (levels, onChange) => h('div', { class: 'seg', role: 'radiogroup' }, levels.map((o) => h('label', {}, h('input', { type: 'radio', name: 'oil', value: o.id, checked: st.oil === o.id, onchange: () => onChange(o.id) }), h('span', {}, o.label))));
  async function viewOil() {
    const data = await loadStatic();
    return [h('h2', {}, 'Quanto óleo foi usado no preparo?'), h('p', { class: 'muted' }, 'Uma resposta para o prato todo. "Normal" é o óleo usual de cada alimento (arroz e refogados levam; grelhados no geral não); "Pouco" é metade; "Muito" é o dobro.'),
      oilPicker(data.priors.oil_levels, (id) => { st.oil = id; }),
      nav(() => go('names'), () => go('result'), 'Ver o resultado')];
  }

  // 7. result
  /** Estimates of the named items; a wider scale uncertainty when the plate is the "prato típico" prior. */
  function compute(data) {
    const named = st.items.filter((it) => it.cls);
    const counts = core.exclusiveCounts(named.map((it) => it.masks[it.idx]));
    const priors = auto.priorsForPlate(data.priors, st.rim.setup ?? auto.plateSetup(data.priors, null));
    const raw = named.map((it, i) => core.estimateItem({ cls: it.cls, pixels: counts[i], scale: st.rim.scale, oil: st.oil, priors, calibration: st.snap.calibration, lookup: getLookup() }));
    const { items, totals } = cal.applyRanges(raw, core.totals(raw), st.snap.state); // conformal ranges once there are enough checks
    return { items, totals, byItem: new Map(named.map((it, i) => [it, items[i]])) };
  }
  /** What the checks taught so far, fixed for the estimate on screen (a check saved now applies from the next estimate). */
  async function ensureSnap() {
    if (st.snap) return st.snap;
    const data = await loadStatic(); const checks = await db.getAll('checks').catch(() => []);
    const state = cal.learn(checks, cal.paramsFrom(data.priors));
    return (st.snap = { state, calibration: state.n_obs > 0 ? core.loadCalibration(cal.toCalibration(state)) : data.calibration });
  }
  const macros = (x) => `${n0(x.kcal)} kcal · proteína ${n1(x.protein_g)} g · carboidrato ${n1(x.carbs_g)} g · gordura ${n1(x.fat_g)} g`;
  const howCalc = (it) => h('details', {}, h('summary', {}, 'Como calculamos'),
    h('p', { class: 'muted' }, `Área ${n0(it.area_mm2 / 100)} cm² × espessura assumida ${n0(it.thickness_mm)} mm = ${n0(it.volume_ml)} mL; densidade ${n2(it.density_g_per_ml)} g/mL (${{ served: 'porção medida', pieces: 'pedaços', solid_prior: 'suposição de sólido' }[it.density_basis]}); óleo ${n1(it.oil_g)} g.`));
  const calBanner = () => {
    const state = st.snap.state;
    return h('div', { class: 'banner', role: 'note' }, h('span', { class: `badge ${state.n_checks ? 'cal' : 'uncal'}`, id: 'calstate' }, state.label),
      h('p', {}, state.n_checks ? `Os gramas já levam o fator aprendido nas suas pesagens${state.ranges.item ? '; as faixas são calibradas.' : '; as faixas ainda são as do modelo.'}`
        : 'Espessuras e densidades são suposições e a escala vem de um prato típico: use como ordem de grandeza. Conferir com a balança (abaixo) calibra.'));
  };
  const totalsCard = (r) => h('div', { class: 'card', id: 'totals' }, h('strong', {}, `Total do prato: ${n0(r.totals.grams)} g`), h('br'), `Faixa de 80%: ${n0(r.totals.lo80)} a ${n0(r.totals.hi80)} g`, h('br'), macros(r.totals),
    h('p', { class: 'muted', id: 'range-basis' }, `${r.totals.range_basis === 'conformal' ? 'Faixas calibradas pelas suas conferências.' : 'Faixas do modelo, sem conferências suficientes.'}${st.rim?.setup?.typical ? ` Escala pelo prato típico (${n0(st.rim.setup.diameter_mm / 10)} cm): faixa mais larga.` : ''}`));
  const mealLink = async () => {
    const meals = [...(await db.getAll('meals'))].sort((a, b) => (a.captured_at < b.captured_at ? 1 : -1));
    return h('label', { class: 'field' }, h('span', {}, 'Esta refeição também foi pesada?'),
      h('select', { id: 'meal-link', onchange: (e) => { st.mealId = e.target.value; }, value: st.mealId }, [h('option', { value: '' }, 'Não pesei esta refeição'), ...meals.map((m) => h('option', { value: m.id }, `${fmtDate(m.captured_at)} · ${m.items.reduce((s, it) => s + it.grams, 0)} g pesados`))]),
      h('span', { class: 'muted' }, 'Ao vincular, o motor de avaliação compara esta estimativa com o peso real.'));
  };
  function saveBlock(r, prev) {
    return st.saved ? [h('div', { class: 'good', role: 'status' }, 'Estimativa salva.'), h('div', { class: 'stack' }, h('a', { class: 'btn', href: '#/' }, 'Apontar para outro prato'), h('a', { class: 'btn secondary', href: '#/estimates' }, 'Estimativas salvas e exportar previsões'))] : [
      h('button', { id: 'save', style: 'margin-top:12px', disabled: !r.items.length, onclick: () => save(r) }, 'Salvar estimativa'), prev ? nav(prev, null) : null];
  }

  // ---------------------------------------------------------------- "Conferir com balança" (optional): the owner's scale grams next to what was shown
  const checkInput = (label, attrs, get, set, hint) => h('label', { class: 'field' }, h('span', {}, label), h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: get(), oninput: (e) => set(e.target.value), ...attrs }), hint ? h('span', { class: 'muted' }, hint) : null);
  function checkSection(r) {
    if (!r.items.length) return null;
    if (st.checkSaved) {
      const { check, state } = st.checkSaved;
      const lines = check.truth_kind === 'items' ? check.items.filter((it) => it.truth_g).map((it) => h('p', {}, `${cap(it.label)}: balança ${n0(it.truth_g)} g, estimativa ${n0(it.grams)} g`))
        : [h('p', {}, `Total do prato: balança ${n0(check.truth_total_g)} g, estimativa ${n0(check.items.reduce((a, it) => a + it.grams, 0))} g`)];
      return h('div', { class: 'card', id: 'check-done' }, h('strong', {}, 'Conferência salva.'), lines,
        h('p', { id: 'calstate-now' }, `Agora: ${state.label}. Vale a partir da próxima estimativa.`), h('a', { href: '#/accuracy' }, 'Ver a precisão'));
    }
    const f = st.checkForm;
    return h('details', { id: 'check', class: 'card', open: st.checkOpen, ontoggle: (e) => { st.checkOpen = e.target.open; } }, h('summary', {}, h('strong', {}, 'Conferir com balança (opcional)')),
      h('p', { class: 'muted' }, 'Pese a comida depois da estimativa e digite os gramas: por item, ou só o total do prato. Cada conferência ajuda o Macrofy a acertar mais.'),
      r.items.map((e, i) => checkInput(`${cap(e.label)} (g)`, { 'data-check-item': String(i), placeholder: 'g' }, () => f.items[i] ?? '', (v) => { f.items[i] = v; })),
      checkInput('Ou o total do prato (g)', { id: 'check-total', placeholder: 'g' }, () => f.total, (v) => { f.total = v; }, 'Vale só se você não digitou os itens.'),
      checkInput('Calorias que outro app mostrou (opcional)', { id: 'check-other-kcal', placeholder: 'kcal' }, () => f.other, (v) => { f.other = v; }, 'Só para comparar: nunca é usado como verdade.'),
      errorBox(st.checkErrors), h('button', { id: 'check-save', style: 'margin-top:10px', onclick: () => saveCheck(r) }, 'Salvar conferência'));
  }
  async function saveCheck(r) {
    try {
      const data = await loadStatic(); const f = st.checkForm;
      const id = st.saved ?? await persistEstimate(r);
      const est = { id, items: r.items, totals: r.totals, plate_typical: st.rim.setup.typical, diameter_mm: st.rim.setup.diameter_mm, oil: st.oil, pipeline: core.PIPELINE };
      const built = cal.buildCheck({ estimate: est, truth_items: r.items.map((_, i) => f.items[i] ?? ''), truth_total: f.total, other_app_kcal: f.other, photo_sha256: await sha256Hex(await st.workBlob.arrayBuffer()), created_at: isoWithOffset(), state: st.snap.state, stateOf: (cid) => getLookup().findClass(cid)?.state ?? 'cooked' });
      st.checkOpen = true;
      if (built.errors) { st.checkErrors = built.errors; render(); return; }
      await db.put('checks', built.check);
      st.checkErrors = []; st.checkSaved = { check: built.check, state: cal.learn(await db.getAll('checks'), cal.paramsFrom(data.priors)) };
      toast('Conferência salva.');
    } catch (e) { st.error = `Não foi possível salvar a conferência: ${e.message}`; }
    render();
  }
  async function viewResult() {
    const data = await loadStatic(); await ensureSnap(); const r = compute(data);
    return [calBanner(),
      r.items.map((it) => h('div', { class: 'card item' }, h('h3', {}, `${cap(it.label)}`),
        h('p', { class: 'big' }, `${n0(it.grams)} g`), h('p', {}, `Faixa de 80%: ${n0(it.lo80)} a ${n0(it.hi80)} g`), h('p', {}, macros(it)), howCalc(it))),
      totalsCard(r), saveBlock(r, st.saved ? null : () => go('oil')), checkSection(r), st.saved ? null : h('details', { class: 'fix' }, h('summary', {}, 'Ajustes / Corrigir'), await mealLink())];
  }

  // ---------------------------------------------------------------- confirmation screen (automatic mode): the whole estimate, taps only to correct
  const corr = (kind) => { st.corrections[kind] = (st.corrections[kind] ?? 0) + 1; };
  const dot = (i) => h('span', { style: `width:18px;height:18px;border-radius:9px;background:${COLORS[i % COLORS.length]};flex:none` });
  function afterEdit(kind) { st.query = {}; st.error = ''; if (kind) corr(kind); saveDraft(); render(); }
  const union = (a, b) => { const d = new Uint8Array(a.data.length); for (let k = 0; k < d.length; k++) d[k] = a.data[k] || b.data[k] ? 1 : 0; return { ...a, data: d }; };
  const partOf = (it) => ({ ...it, parts: undefined, editing: false });

  function removeItem(i) { st.items.splice(i, 1); afterEdit('remove'); }
  function mergeItems(i, j) {
    const a = st.items[i]; const b = st.items[j]; if (!a || !b || i === j) return;
    a.parts = [...(a.parts ?? [partOf(a)]), ...(b.parts ?? [partOf(b)])];
    a.masks = [union(a.masks[a.idx], b.masks[b.idx])]; a.idx = 0; a.cropBlob = null; a.editing = false;
    st.items.splice(j, 1); afterEdit('merge');
  }
  function separateItem(i) { const it = st.items[i]; st.items.splice(i, 1, ...it.parts.map((p) => ({ ...p, parts: undefined }))); afterEdit('split'); }
  /** A tap on the photo while adding an item ("add") or carving one out of an item ("split"). */
  async function tapCorrect(x, y) {
    if (st.model.status !== 'ready' || st.busy || !st.tapMode) return;
    const mode = st.tapMode; st.tapMode = null; st.busy = 'Calculando o contorno…'; st.error = ''; render();
    try {
      await syncImage();
      const m = await getModels(); const best = (await m.segment(x, y))[0]; let item;
      if (mode.kind === 'add') item = { masks: [best], idx: 0, tap: { x, y }, cls: null, top: null };
      else {
        const src = mode.item; const sm = src.masks[src.idx]; const carve = new Uint8Array(sm.data.length); let n = 0; let left = 0;
        for (let k = 0; k < carve.length; k++) { if (sm.data[k] && best.data[k]) { carve[k] = 1; n++; } else if (sm.data[k]) left++; }
        if (n < 20 || left < 20) throw new Error('o toque não separou uma parte do item; toque bem no meio da parte que deve virar outro item');
        const rest = new Uint8Array(sm.data.length); for (let k = 0; k < rest.length; k++) rest[k] = sm.data[k] && !carve[k] ? 1 : 0;
        item = { masks: [{ ...sm, data: carve }], idx: 0, tap: { x, y }, cls: null, top: null };
        await nameOne(item); // named first: a failure leaves the original item as it was
        src.masks = [{ ...sm, data: rest }]; src.idx = 0; src.parts = undefined; src.cropBlob = null;
      }
      if (!item.top) await nameOne(item);
      st.items.push(item); corr(mode.kind === 'add' ? 'add' : 'split'); await saveDraft();
    } catch (e) { st.error = `Não consegui: ${e.message}`; }
    st.busy = ''; render();
  }
  /** The naming model names one item (its crop) and its top-1 becomes the name; the user can change it. */
  async function nameOne(it) {
    const m = await getModels(); const classes = getVocab().classes;
    it.cropBlob = await cropBlob(it.masks[it.idx]);
    it.top = core.topNames(await m.classify(it.cropBlob, core.namePrompts(classes)), classes, 3); it.cls = it.top[0]?.cls ?? null;
  }
  async function viewConfirm() {
    const [data, plates] = await Promise.all([loadStatic(), db.getAll('plates')]); await ensureSnap();
    if (!st.rim?.scale) return [h('div', { class: 'errors', role: 'alert' }, 'Não tenho a escala do prato.'), h('details', { class: 'fix' }, h('summary', {}, 'Ajustes / Corrigir'), h('button', { class: 'secondary', onclick: () => go('rim') }, 'Marcar o prato (modo manual)'))];
    const r = compute(data); const setup = st.rim.setup;
    const tapText = st.tapMode?.kind === 'add' ? 'Toque no alimento que faltou.' : st.tapMode?.kind === 'split' ? 'Toque no meio da parte que deve virar um item separado.' : null;
    const cards = st.items.map((it, i) => {
      const e = r.byItem.get(it);
      const others = st.items.map((o, j) => ({ o, j })).filter(({ j }) => j !== i);
      return h('div', { class: 'card item', 'data-item': String(i) },
        h('div', { class: 'row' }, dot(i), h('h3', { class: 'grow' }, it.cls ? cap(it.cls.pt) : `Item ${i + 1}: escolha o nome`)),
        e ? [h('p', { class: 'big' }, `${n0(e.grams)} g`), h('p', {}, `Faixa de 80%: ${n0(e.lo80)} a ${n0(e.hi80)} g`), h('p', {}, macros(e))] : null,
        e ? howCalc(e) : null,
        h('details', { class: 'fix', open: !!(it.fixOpen || it.editing || !it.cls), ontoggle: (ev) => { it.fixOpen = ev.target.open; } }, h('summary', {}, 'Corrigir'),
          it.editing || !it.cls ? namePicker(it, i, () => { it.editing = false; afterEdit('rename'); }) : null,
          h('div', { class: 'row', style: 'margin-top:8px' },
            h('button', { class: 'secondary small', 'data-action': 'rename', onclick: () => { it.editing = !it.editing; render(); } }, 'Trocar nome'),
            h('button', { class: 'danger small', 'data-action': 'remove', onclick: () => removeItem(i) }, 'Remover'),
            it.parts ? h('button', { class: 'secondary small', 'data-action': 'separate', onclick: () => separateItem(i) }, 'Separar') : h('button', { class: 'secondary small', 'data-action': 'split', onclick: () => { st.tapMode = { kind: 'split', item: it }; render(); } }, 'Dividir'),
            others.length ? h('select', { 'data-action': 'merge', 'aria-label': 'Juntar com outro item', onchange: (ev) => { const j = Number(ev.target.value); if (Number.isInteger(j)) mergeItems(i, j); }, value: '' },
              h('option', { value: '' }, 'Juntar com…'), others.map(({ o, j }) => h('option', { value: String(j) }, `Item ${j + 1}: ${o.cls ? o.cls.pt : 'sem nome'}`))) : null)));
    });
    const adjust = h('details', { id: 'adjust', class: 'fix', open: st.adjustOpen || !!st.tapMode, ontoggle: (ev) => { st.adjustOpen = ev.target.open; } }, h('summary', {}, 'Ajustes / Corrigir'),
      h('p', { class: 'muted' }, 'Nada aqui é necessário: o resultado acima já vale. Use só para corrigir.'),
      h('label', { class: 'field' }, h('span', {}, 'Prato usado'), h('select', { id: 'plate-select', onchange: async (e) => { st.plateId = e.target.value; await setRimScale(); saveDraft(); render(); }, value: st.plateId }, plateOptions(plates, data).map((o) => h('option', { value: o.id }, o.label))),
        h('span', { class: 'muted' }, setup?.typical ? 'Sem prato cadastrado a escala vem do prato típico. ' : '', h('a', { href: '#/plates/new' }, 'Cadastrar um prato'), ' mede melhor a escala.')),
      h('h3', {}, 'Quanto óleo foi usado no preparo?'), oilPicker(data.priors.oil_levels, (id) => { st.oil = id; saveDraft(); render(); }),
      h('button', { id: 'add-item', class: 'secondary', style: 'margin-top:10px', onclick: () => { st.tapMode = { kind: 'add' }; st.adjustOpen = true; render(); } }, 'Adicionar alimento (toque)'),
      st.saved ? null : await mealLink(),
      st.saved ? null : h('button', { id: 'go-manual', class: 'secondary', style: 'margin-top:14px', onclick: () => { st.mode = 'manual'; go('rim'); } }, 'Modo manual (refazer com toques)'));
    return [h('h2', {}, 'Resultado'), h('p', { class: 'muted' }, 'O Macrofy achou o prato e os alimentos sozinho. Se algo estiver errado, use "Corrigir" no item.'),
      stage({ plate: true, items: true, onTap: st.tapMode ? tapCorrect : null }), tapText ? h('div', { class: 'banner', role: 'status', id: 'tap-hint' }, tapText, h('button', { class: 'secondary small', style: 'margin-left:8px', onclick: () => { st.tapMode = null; render(); } }, 'Cancelar')) : null, busyBox(), modelBox(),
      calBanner(), cards,
      r.items.length ? totalsCard(r) : null, saveBlock(r, null), checkSection(r), adjust];
  }

  /** Stores the estimate (idempotent per screen: st.saved holds its id) so a scale check can point to it. */
  async function persistEstimate(r) {
    if (st.saved) return st.saved;
    const id = `e${Date.now().toString(36)}${Math.floor(Math.random() * 0x10000).toString(16)}`;
    const setup = st.rim.setup;
    await db.put('estimates', {
      id, created_at: isoWithOffset(), meal_id: st.mealId || null, plate_id: setup.typical ? null : st.plateId, plate_typical: setup.typical, diameter_mm: setup.diameter_mm,
      scale: { mm_per_px: st.rim.scale.mm_per_px, cos_tilt: st.rim.scale.cos_tilt, uncertainty: setup.scale_uncertainty }, oil: st.oil, items: r.items, totals: r.totals,
      calibration: { label: st.snap.state.label, n_checks: st.snap.state.n_checks, global_factor: st.snap.state.global.factor, range_basis: r.totals.range_basis },
      mode: st.mode, timings: st.mode === 'auto' ? st.timings : null, corrections: st.mode === 'auto' ? st.corrections : null,
      pipeline: core.PIPELINE, models: st.model.info ?? null, photo: st.workBlob,
    });
    if (!setup.typical) await db.setSetting('last_used', { ...((await db.getSetting('last_used')) ?? {}), plate: st.plateId });
    await db.setSetting(DRAFT, null);
    st.saved = id;
    return id;
  }
  async function save(r) {
    try { await persistEstimate(r); toast('Estimativa salva.'); } catch (e) { st.error = `Não foi possível salvar: ${e.message}`; }
    render();
  }

  // ---------------------------------------------------------------- saved estimates and export
  async function screenEstimates() {
    const [list, meals, checks] = await Promise.all([db.getAll('estimates'), db.getAll('meals'), db.getAll('checks')]);
    const checked = new Set(checks.map((c) => c.estimate_id));
    const sorted = [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const preds = core.toPredictions(sorted);
    const text = JSON.stringify(preds, null, 2);
    const file = new File([text], 'predictions.json', { type: 'application/json' });
    const msg = h('div');
    const download = () => { const a = h('a', { href: objUrl(file), download: 'predictions.json' }); document.body.append(a); a.click(); a.remove(); };
    const doExport = async () => {
      try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Macrofy previsões' }); msg.replaceChildren(h('div', { class: 'good' }, 'Previsões compartilhadas.')); return; } }
      catch (err) { if (err.name === 'AbortError') return; }
      download(); msg.replaceChildren(h('div', { class: 'good' }, 'Arquivo predictions.json baixado.'));
    };
    const copy = async () => {
      try { await navigator.clipboard.writeText(text); msg.replaceChildren(h('div', { class: 'good' }, 'Copiado. Cole no chat.')); } catch { msg.replaceChildren(errorBox(['Não consegui copiar. Use "Compartilhar ou baixar".'])); }
    };
    show(back(), h('h1', {}, 'Estimativas salvas'),
      sorted.length ? sorted.map((e) => h('div', { class: 'card', 'data-estimate': e.id },
        h('div', { class: 'row' }, h('strong', {}, fmtDate(e.created_at)), h('span', { class: `badge ${e.calibration?.n_checks ? 'cal' : 'uncal'}` }, e.calibration?.label ?? 'Não calibrado')),
        checked.has(e.id) ? h('div', { class: 'muted' }, 'Conferida com a balança.') : null,
        e.timings ? h('div', { class: 'muted' }, `Automático: ${n1((e.timings.total_ms ?? 0) / 1000)} s no total (codificador ${n1((e.timings.encoder_ms ?? 0) / 1000)} s, ${e.timings.decodes ?? 0} decodificações, ${Object.values(e.corrections ?? {}).reduce((a, b) => a + b, 0)} correções)`) : null,
        h('div', { class: 'muted' }, e.meal_id ? `Vinculada à refeição pesada de ${fmtDate(meals.find((m) => m.id === e.meal_id)?.captured_at ?? e.created_at)}.` : 'Sem refeição pesada vinculada.'),
        e.items.map((it) => h('p', {}, `${cap(it.label)}: ${n0(it.grams)} g (${n0(it.lo80)} a ${n0(it.hi80)}), ${n0(it.kcal)} kcal`)),
        h('strong', {}, `Total: ${n0(e.totals.grams)} g · ${n0(e.totals.kcal)} kcal`), h('br'),
        h('button', { class: 'danger small', style: 'margin-top:8px', onclick: async () => { if (confirm('Excluir esta estimativa?')) { await db.del('estimates', e.id); screenEstimates(); } } }, 'Excluir')))
        : h('p', { class: 'muted' }, 'Nenhuma estimativa ainda.'),
      h('div', { class: 'stack', style: 'margin-top:12px' },
        h('button', { id: 'export-preds', disabled: !sorted.length, onclick: doExport }, 'Exportar previsões (compartilhar ou baixar)'),
        h('button', { class: 'secondary', disabled: !sorted.length, onclick: copy }, 'Copiar texto para colar no chat')), msg,
      h('p', { class: 'muted' }, `Formato ${preds.schema}, ${preds.pipeline.name} ${preds.pipeline.version}. Estimativas da mesma refeição pesada: vale a mais recente.`));
  }

  /** Home: the camera picture goes straight to the automatic analysis and the result (zero setup, no plate, no taps). */
  async function beginWithFile(file) {
    st.mode = 'auto'; await useFile(file);
    if (location.hash !== '#/estimate') location.hash = '#/estimate';
  }
  return {
    screenEstimate: async () => { render(); },
    screenEstimateNew: async () => { st = { ...fresh(), model: st.model }; location.hash = '#/estimate'; },
    /** "Modo manual" under Ajustes / Corrigir: the T-013 tap flow. */
    screenEstimateManual: async () => { st = { ...fresh(), mode: 'manual', model: st.model }; location.hash = '#/estimate'; },
    screenEstimateResume: async () => { await resumeDraft(); location.hash = '#/estimate'; },
    screenEstimates,
    beginWithFile,
    /** The home screen starts loading the models in the background, so the analysis is faster after the photo. */
    prewarm: () => { ensureModels(); },
    draftInfo: async () => { const d = await db.getSetting(DRAFT).catch(() => null); return d?.photo ? d : null; },
    discardDraft: () => db.setSetting(DRAFT, null),
  };
}
