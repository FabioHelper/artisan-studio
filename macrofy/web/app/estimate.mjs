// Estimate screens (T-013): photo -> plate -> rim tap -> food taps -> names -> oil -> result -> save/export.
// The maths is in vendor/estimate-core.mjs (pure, tested in Node); the models come from vendor/models.mjs or from an injected
// window.__macrofyModels (tests). Everything here is DOM and state; app.mjs wires it (createEstimate) and the routes.
import * as core from './vendor/estimate-core.mjs';
import { createLookup } from './vendor/lookup-core.mjs';

const MAX_SIDE = 1024; // the working photo: SAM resizes to 1024 anyway, and masks come back in these pixels
const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080', '#9a6324', '#800000'];
const n0 = (x) => String(Math.round(x));
const n1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
const n2 = (x) => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function createEstimate(ctx) {
  const { h, show, back, errorBox, toast, db, objUrl, fmtDate, bitmapOf, searchVocab, isoWithOffset, getVocab } = ctx;
  let st = fresh();
  let staticData = null; let modelsP = null; let lookup = null;

  function fresh() {
    return { step: 'photo', work: null, workBlob: null, imageSetFor: null, plateId: '', rim: null, items: [], oil: 'normal', mealId: '', saved: null, busy: '', error: '', model: { status: 'idle' }, query: {}, naming: false, namingRun: 0 };
  }
  const getModels = () => globalThis.__macrofyModels ?? (modelsP ??= import('./vendor/models.mjs').then((m) => m.createModels()));
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
    (async () => {
      try {
        const m = await getModels();
        mine.info = await m.load((p) => { mine.fraction = p.fraction; mine.label = p.label; paintProgress(); });
        mine.status = 'ready';
        await syncImage();
      } catch (e) { mine.status = 'error'; mine.error = e.message; }
      if (st.model === mine) render();
    })();
  }
  async function syncImage() {
    if (st.model.status !== 'ready' || !st.workBlob || st.imageSetFor === st.workBlob) return;
    await (await getModels()).setImage(st.workBlob);
    st.imageSetFor = st.workBlob;
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
  function render(top = false) {
    const y = top ? 0 : window.scrollY;
    const fn = { photo: viewPhoto, plate: viewPlate, rim: viewRim, foods: viewFoods, names: viewNames, oil: viewOil, result: viewResult }[st.step];
    fn().then((nodes) => { show(back('#/', 'Início'), h('h1', {}, 'Estimar'), stepper(), errorBox(st.error ? [st.error] : []), ...[nodes].flat(4)); window.scrollTo(0, y); })
      .catch((e) => { console.error(e); show(back(), h('div', { class: 'errors', role: 'alert' }, `Erro: ${e.message}`)); });
  }
  const STEPS = [['photo', 'Foto'], ['plate', 'Prato'], ['rim', 'Borda'], ['foods', 'Alimentos'], ['names', 'Nomes'], ['oil', 'Óleo'], ['result', 'Resultado']];
  const stepper = () => h('p', { class: 'muted', 'aria-label': 'Etapa' }, `Etapa ${STEPS.findIndex((s) => s[0] === st.step) + 1} de ${STEPS.length}: ${STEPS.find((s) => s[0] === st.step)[1]}`);
  const go = (step) => { st.step = step; st.error = ''; st.busy = ''; render(true); };
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
      st = { ...fresh(), model: st.model, plateId: st.plateId, work: c, workBlob: blob, step: 'plate' };
      ensureModels(); syncImage().catch(() => {});
    } catch (e) { st.busy = ''; st.error = `Não consegui abrir a foto: ${e.message}`; }
    render();
  }
  async function viewPhoto() {
    const plates = await db.getAll('plates');
    if (!plates.length) return [h('div', { class: 'banner' }, 'Primeiro cadastre o prato ou a tigela: a borda dele dá a escala da foto.'), h('a', { class: 'btn', href: '#/plates/new' }, 'Cadastrar prato')];
    const picker = (label, capture, cls) => h('label', { class: `btn ${cls}` }, label,
      h('input', { type: 'file', accept: 'image/*', ...(capture ? { capture: 'environment' } : {}), onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) useFile(f); } }));
    ensureModels();
    return [h('p', {}, 'Fotografe o prato de cima (ou o mais de cima que der), inteiro no quadro, com a borda visível. Sem zoom.'),
      st.work ? h('button', { class: 'secondary', onclick: () => go('plate') }, 'Continuar com a foto atual') : null,
      picker('Tirar foto', true, ''), h('div', { style: 'height:10px' }), picker('Escolher da galeria', false, 'secondary'), busyBox(), modelBox()];
  }

  // 2. plate choice
  async function viewPlate() {
    const plates = await db.getAll('plates');
    if (!st.plateId) { const last = (await db.getSetting('last_used'))?.plate; st.plateId = plates.some((p) => p.id === last) ? last : (plates.length === 1 ? plates[0].id : ''); }
    const sel = h('select', { id: 'plate-select', onchange: (e) => { st.plateId = e.target.value; render(); }, value: st.plateId },
      [{ id: '', label: 'Escolha o prato…' }, ...plates.map((p) => ({ id: p.id, label: `${p.name} (${p.diameter_mm} mm)` }))].map((o) => h('option', { value: o.id }, o.label)));
    return [h('h2', {}, 'Qual prato é este?'), h('p', { class: 'muted' }, 'O diâmetro externo cadastrado é a régua da foto.'), sel, nav(() => go('photo'), () => go('rim'), 'Próximo', !st.plateId)];
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
    const plate = (await db.getAll('plates')).find((p) => p.id === st.plateId);
    const mask = st.rim.masks[st.rim.idx];
    const frac = core.maskCount(mask) / (mask.width * mask.height);
    try { st.rim.scale = core.scaleFromPlateMask(mask, plate.diameter_mm); st.rim.diameter_mm = plate.diameter_mm; }
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

  // 5. names: SigLIP zero-shot over the vocab pt names
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
  async function viewNames() {
    const classes = getVocab().classes;
    setTimeout(nameAll, 0);
    const cards = st.items.map((it, i) => {
      const q = st.query[i] ?? null;
      const results = q !== null ? searchVocab(classes, q, 12) : [];
      return h('div', { class: 'card item' }, h('div', { class: 'row' }, h('span', { style: `width:18px;height:18px;border-radius:9px;background:${COLORS[i % COLORS.length]};flex:none` }), h('h3', {}, `Item ${i + 1}${it.cls ? `: ${it.cls.pt}` : ''}`)),
        it.cropBlob ? h('img', { src: objUrl(it.cropBlob), alt: `Recorte do item ${i + 1}`, style: 'max-width:100%;max-height:140px;border-radius:10px;margin:6px 0' }) : null,
        !it.top ? h('p', { class: 'muted', role: 'status' }, st.naming ? 'Pensando…' : 'Aguardando os modelos…') : h('div', { class: 'stack' },
          it.top.map((t) => h('button', { class: it.cls?.id === t.cls.id ? '' : 'secondary', 'data-name': t.cls.id, onclick: () => { it.cls = t.cls; render(); } }, cap(t.cls.pt))),
          h('button', { class: 'secondary', 'data-name': 'other', onclick: () => { st.query[i] = st.query[i] ?? ''; render(); } }, 'outro…'),
          q !== null ? h('div', {}, h('input', { type: 'search', placeholder: 'Buscar alimento (ex.: arroz, frango)…', value: q, autocomplete: 'off', id: `search-${i}`, oninput: (e) => { st.query[i] = e.target.value; const pos = e.target.selectionStart; render(); const el = document.getElementById(`search-${i}`); el?.focus(); el?.setSelectionRange(pos, pos); } }),
            q.trim() ? h('div', { class: 'results' }, results.length ? results.map((c) => h('button', { type: 'button', 'data-name': c.id, onclick: () => { it.cls = c; st.query[i] = null; render(); } }, c.pt)) : h('p', { class: 'muted', style: 'padding:8px 12px' }, 'Nada encontrado. Tente outra palavra.')) : null) : null));
    });
    return [h('h2', {}, 'Que alimento é cada um?'), h('p', { class: 'muted' }, 'Toque no nome certo. Se nenhum servir, use "outro…".'), busyBox(), modelBox(), cards,
      nav(() => go('foods'), () => go('oil'), 'Próximo', st.items.some((it) => !it.cls))];
  }

  // 6. oil
  async function viewOil() {
    return [h('h2', {}, 'Quanto óleo foi usado no preparo?'), h('p', { class: 'muted' }, 'Uma resposta para o prato todo. "Normal" é o óleo usual de cada alimento (arroz e refogados levam; grelhados no geral não); "Pouco" é metade; "Muito" é o dobro.'),
      h('div', { class: 'seg', role: 'radiogroup' }, core.OIL_LEVELS.map((o) => h('label', {}, h('input', { type: 'radio', name: 'oil', value: o.id, checked: st.oil === o.id, onchange: () => { st.oil = o.id; } }), h('span', {}, o.label)))),
      nav(() => go('names'), () => go('result'), 'Ver o resultado')];
  }

  // 7. result
  function compute(data) {
    const counts = core.exclusiveCounts(st.items.map((it) => it.masks[it.idx]));
    const items = st.items.map((it, i) => core.estimateItem({ cls: it.cls, pixels: counts[i], scale: st.rim.scale, oil: st.oil, priors: data.priors, calibration: data.calibration, lookup: getLookup() }));
    return { items, totals: core.totals(items) };
  }
  const macros = (x) => `${n0(x.kcal)} kcal · proteína ${n1(x.protein_g)} g · carboidrato ${n1(x.carbs_g)} g · gordura ${n1(x.fat_g)} g`;
  async function viewResult() {
    const data = await loadStatic(); const r = compute(data);
    const meals = [...(await db.getAll('meals'))].sort((a, b) => (a.captured_at < b.captured_at ? 1 : -1));
    const saved = st.saved;
    return [h('div', { class: 'banner', role: 'note' }, h('span', { class: 'badge uncal', id: 'uncal' }, 'Não calibrado — estimativa inicial'),
      h('p', {}, 'Espessuras e densidades são suposições, ainda não ajustadas com refeições pesadas. Use como ordem de grandeza.')),
    r.items.map((it, i) => h('div', { class: 'card item' }, h('h3', {}, `${cap(it.label)}`),
      h('p', { class: 'big' }, `${n0(it.grams)} g`), h('p', {}, `Faixa de 80%: ${n0(it.lo80)} a ${n0(it.hi80)} g`), h('p', {}, macros(it)),
      h('details', {}, h('summary', {}, 'Como calculamos'),
        h('p', { class: 'muted' }, `Área ${n0(it.area_mm2 / 100)} cm² × espessura assumida ${n0(it.thickness_mm)} mm = ${n0(it.volume_ml)} mL; densidade ${n2(it.density_g_per_ml)} g/mL (${{ served: 'porção medida', pieces: 'pedaços', solid_prior: 'suposição de sólido' }[it.density_basis]}); óleo ${n1(it.oil_g)} g.`)))),
    h('div', { class: 'card', id: 'totals' }, h('strong', {}, `Total do prato: ${n0(r.totals.grams)} g`), h('br'), `Faixa de 80%: ${n0(r.totals.lo80)} a ${n0(r.totals.hi80)} g`, h('br'), macros(r.totals)),
    saved ? h('div', { class: 'good', role: 'status' }, 'Estimativa salva.') : [
      h('label', { class: 'field' }, h('span', {}, 'Esta refeição também foi pesada?'),
        h('select', { id: 'meal-link', onchange: (e) => { st.mealId = e.target.value; }, value: st.mealId }, [h('option', { value: '' }, 'Não pesei esta refeição'), ...meals.map((m) => h('option', { value: m.id }, `${fmtDate(m.captured_at)} · ${m.items.reduce((s, it) => s + it.grams, 0)} g pesados`))]),
        h('span', { class: 'muted' }, 'Ao vincular, o motor de avaliação compara esta estimativa com o peso real.')),
      h('button', { id: 'save', style: 'margin-top:12px', onclick: () => save(r) }, 'Salvar estimativa')],
    saved ? h('div', { class: 'stack' }, h('a', { class: 'btn', href: '#/estimates' }, 'Estimativas salvas e exportar previsões'), h('a', { class: 'btn secondary', href: '#/estimate/new' }, 'Estimar outro prato')) : null,
    saved ? null : nav(() => go('oil'), null)];
  }
  async function save(r) {
    try {
      const id = `e${Date.now().toString(36)}${Math.floor(Math.random() * 0x10000).toString(16)}`;
      const plate = (await db.getAll('plates')).find((p) => p.id === st.plateId);
      await db.put('estimates', {
        id, created_at: isoWithOffset(), meal_id: st.mealId || null, plate_id: st.plateId, diameter_mm: plate?.diameter_mm ?? null,
        scale: { mm_per_px: st.rim.scale.mm_per_px, cos_tilt: st.rim.scale.cos_tilt }, oil: st.oil, items: r.items, totals: r.totals,
        pipeline: core.PIPELINE, models: st.model.info ?? null, photo: st.workBlob,
      });
      await db.setSetting('last_used', { ...((await db.getSetting('last_used')) ?? {}), plate: st.plateId });
      st.saved = id; toast('Estimativa salva.');
    } catch (e) { st.error = `Não foi possível salvar: ${e.message}`; }
    render();
  }

  // ---------------------------------------------------------------- saved estimates and export
  async function screenEstimates() {
    const [list, meals] = await Promise.all([db.getAll('estimates'), db.getAll('meals')]);
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
        h('div', { class: 'row' }, h('strong', {}, fmtDate(e.created_at)), h('span', { class: 'badge uncal' }, 'Não calibrado')),
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

  return {
    screenEstimate: async () => { render(); },
    screenEstimateNew: async () => { st = { ...fresh(), model: st.model }; location.hash = '#/estimate'; },
    screenEstimates,
  };
}
