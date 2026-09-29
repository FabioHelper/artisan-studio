// Macrofy capture app: hash-routed screens, no framework. Pure logic is in lib.mjs, storage in db.mjs.
import * as db from './db.mjs';
import { createEstimate } from './estimate.mjs';
import {
  ANGLES, LIGHTINGS, STATES, METHODS, KINDS, SPLIT_LABEL, MIN_PHOTOS_RECOMMENDED,
  sha256Hex, dHashFromRGBA, isoWithOffset, splitForCapture, plateFromForm, checkMealDraft, mealFromDraft, newMealId,
  buildManifest, exportProblems, searchVocab, itemFromClass,
} from './lib.mjs';

const root = document.getElementById('app');
let shown = []; // object URLs of the current screen
let building = []; // object URLs created while the next screen is being built
let vocab = { classes: [] };
let persisted = null;
let saveTimer;

// ---------------------------------------------------------------- tiny DOM helpers
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'value') continue;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  if ('value' in props) e.value = props.value ?? '';
  return e;
}
const svg = (markup) => { const d = document.createElement('div'); d.innerHTML = markup; return d.firstElementChild; };
const objUrl = (blob) => { const u = URL.createObjectURL(blob); building.push(u); return u; };
function toast(msg) { const t = h('div', { class: 'toast', role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); }
function show(...nodes) { shown.forEach((u) => URL.revokeObjectURL(u)); shown = building; building = []; root.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false)); }
const back = (to = '#/', label = 'Início') => h('a', { class: 'back', href: to }, `‹ ${label}`);
const errorBox = (msgs, cls = 'errors') => msgs.length ? h('div', { class: cls, role: 'alert' }, h('ul', {}, msgs.map(m => h('li', {}, m)))) : null;
const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function seg(name, options, current, onChange) {
  return h('div', { class: 'seg', role: 'radiogroup' }, options.map(o => h('label', {},
    h('input', { type: 'radio', name, value: o.id, checked: o.id === current, onchange: () => onChange(o.id) }), h('span', {}, o.label))));
}
function field(label, control, hint) { return h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('span', { class: 'muted' }, hint) : null); }
function select(options, current, onChange) {
  return h('select', { onchange: (e) => onChange(e.target.value), value: current }, options.map(o => h('option', { value: o.id }, o.label)));
}

// ---------------------------------------------------------------- photos: sha256 and dHash in the browser
async function bitmapOf(blob) {
  try { return await createImageBitmap(blob); } catch {
    const img = new Image(); const u = URL.createObjectURL(blob);
    try { img.src = u; await img.decode(); return img; } finally { URL.revokeObjectURL(u); }
  }
}
/** Perceptual hash: halve the picture until it is close to 72x64 (keeps the box filter honest), then dHash. */
async function phashOfBlob(blob) {
  const bmp = await bitmapOf(blob);
  let src = bmp; let w = bmp.width; let hh = bmp.height;
  while (w >= 288 && hh >= 256) {
    const c = document.createElement('canvas'); c.width = w >> 1; c.height = hh >> 1;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
    src = c; w = c.width; hh = c.height;
  }
  const c = document.createElement('canvas'); c.width = 72; c.height = 64;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, 72, 64);
  bmp.close?.();
  return dHashFromRGBA(g.getImageData(0, 0, 72, 64).data, 72, 64);
}

// ---------------------------------------------------------------- shared data
const loadScale = async () => (await db.getSetting('scale')) ?? { model: '', resolution_g: 1 };
async function snapshot() {
  const [plates, meals, scale] = await Promise.all([db.getAll('plates'), db.getAll('meals'), loadScale()]);
  return { plates, meals, scale };
}

// ---------------------------------------------------------------- home
async function screenHome() {
  const { plates, meals } = await snapshot();
  const estimates = await db.getAll('estimates');
  const lastExport = await db.getSetting('last_export');
  const cal = meals.filter(m => m.split === 'calibration').length;
  const draft = await db.getSetting('draft');
  const nodes = [h('h1', {}, 'Macrofy')];
  if (!standalone() && !sessionStorage.getItem('macrofy-a2hs-dismissed')) {
    nodes.push(h('div', { class: 'banner', role: 'note' },
      h('strong', {}, 'Adicione à Tela de Início'),
      'No iPhone o Safari pode apagar os dados de sites que não estão instalados. Toque em Compartilhar (quadrado com seta), depois em "Adicionar à Tela de Início" e abra o Macrofy pelo novo ícone.',
      h('button', { class: 'secondary small', style: 'margin-top:8px', onclick: (e) => { try { sessionStorage.setItem('macrofy-a2hs-dismissed', '1'); } catch { /* private mode */ } e.target.closest('.banner').remove(); } }, 'Entendi')));
  }
  nodes.push(
    h('div', { class: 'stack' },
      h('a', { class: 'btn', href: '#/meal' }, draft ? 'Continuar refeição em andamento' : 'Pesar refeição'),
      draft ? h('a', { class: 'btn secondary', href: '#/meal/new' }, 'Começar uma refeição nova') : null,
      h('a', { class: 'btn secondary', href: '#/estimate/new' }, 'Estimar'),
      h('a', { class: 'btn secondary', href: '#/estimates' }, `Estimativas salvas (${estimates.length})`),
      h('a', { class: 'btn secondary', href: '#/meals' }, `Refeições salvas (${meals.length})`),
      h('a', { class: 'btn secondary', href: '#/plates' }, `Pratos e balança (${plates.length})`),
      h('a', { class: 'btn secondary', href: '#/export' }, 'Exportar manifesto')),
    h('div', { class: 'card muted' },
      `${meals.length} refeições: ${cal} de calibração, ${meals.length - cal} de teste.`, h('br'),
      lastExport ? `Último export: ${fmtDate(lastExport)}.` : 'Ainda não exportou. Exporte de vez em quando: é a sua cópia de segurança.', h('br'),
      persisted === true ? 'Armazenamento protegido pelo navegador.' : persisted === false ? 'O navegador não garantiu o armazenamento permanente: instale na Tela de Início e exporte com frequência.' : 'Armazenamento permanente indisponível neste navegador.'));
  show(...nodes);
}

// ---------------------------------------------------------------- plates and scale
const PLATE_HINT = `<svg viewBox="0 0 320 170" role="img" aria-label="Como medir o diâmetro externo da borda do prato">
<g fill="none" stroke="currentColor" stroke-width="3">
<circle cx="90" cy="85" r="66" /><circle cx="90" cy="85" r="44" stroke-width="2" opacity=".5"/>
<line x1="24" y1="85" x2="156" y2="85" stroke="#d9822b" stroke-width="3"/>
<path d="M24 75v20M156 75v20" stroke="#d9822b"/>
<path d="M200 118h100M200 118c0-30 10-46 22-46h56c12 0 22 16 22 46z" stroke-width="3"/>
<path d="M312 128v-46" stroke="#d9822b" stroke-dasharray="4 3"/>
</g>
<text x="90" y="80" text-anchor="middle" font-size="12" fill="#d9822b">diâmetro externo</text>
<text x="90" y="160" text-anchor="middle" font-size="12" fill="currentColor">vista de cima</text>
<text x="250" y="145" text-anchor="middle" font-size="12" fill="currentColor">tigela de lado</text>
</svg>`;

async function screenPlates() {
  const { plates, scale } = await snapshot();
  const model = h('input', { type: 'text', value: scale.model, placeholder: 'Ex.: Camry EK3131', autocomplete: 'off' });
  const res = select([{ id: '0.1', label: '0,1 g' }, { id: '0.5', label: '0,5 g' }, { id: '1', label: '1 g' }, { id: '2', label: '2 g' }], String(scale.resolution_g ?? 1), () => {});
  const msg = h('div');
  const save = h('button', { class: 'secondary', onclick: async () => {
    if (!model.value.trim()) { msg.replaceChildren(errorBox(['Informe marca e modelo da balança.'])); return; }
    await db.setSetting('scale', { model: model.value.trim(), resolution_g: Number(res.value) });
    msg.replaceChildren(h('div', { class: 'good' }, 'Balança salva.'));
  } }, 'Salvar balança');
  show(back(), h('h1', {}, 'Pratos e balança'),
    h('h2', {}, 'Balança'), h('div', { class: 'card' }, field('Marca e modelo', model), field('Resolução (menor divisão)', res), save, msg),
    h('h2', {}, 'Pratos e tigelas'),
    plates.length ? plates.map(p => h('a', { class: 'card', style: 'display:block;color:inherit;text-decoration:none', href: `#/plates/${encodeURIComponent(p.id)}` },
      h('strong', {}, p.name), h('br'), `${KINDS.find(k => k.id === p.kind)?.label}, ${p.diameter_mm} mm${p.depth_mm ? `, ${p.depth_mm} mm de fundo` : ''}`)) : h('p', { class: 'muted' }, 'Nenhum prato ainda. Cadastre cada prato e tigela uma vez.'),
    h('a', { class: 'btn', href: '#/plates/new' }, 'Adicionar prato ou tigela'));
}

async function screenPlateForm(id) {
  const plates = await db.getAll('plates');
  const meals = await db.getAll('meals');
  const cur = id === 'new' ? null : plates.find(p => p.id === id);
  if (id !== 'new' && !cur) { location.hash = '#/plates'; return; }
  const f = { name: cur?.name ?? '', kind: cur?.kind ?? 'plate', diameter: cur?.diameter_mm ?? '', depth: cur?.depth_mm ?? '' };
  const msg = h('div');
  const depthBox = h('div');
  const paintDepth = () => depthBox.replaceChildren(f.kind === 'bowl' ? field('Profundidade em mm (opcional)', h('input', { type: 'text', inputmode: 'decimal', value: f.depth, oninput: (e) => { f.depth = e.target.value; } }), 'Do fundo interno até a borda.') : '');
  paintDepth();
  const used = cur && meals.some(m => m.plate_id === cur.id);
  show(back('#/plates', 'Pratos'), h('h1', {}, cur ? 'Editar prato' : 'Novo prato'),
    h('div', { class: 'card hint' }, svg(PLATE_HINT),
      h('p', {}, 'Meça o diâmetro externo da borda: apoie a régua sobre o prato, de uma borda externa à outra passando pelo centro. Meça uma vez e não mude depois: as refeições apontam para este cadastro.')),
    h('div', { class: 'card' },
      field('Nome', h('input', { type: 'text', value: f.name, placeholder: 'Ex.: Prato raso branco', autocomplete: 'off', oninput: (e) => { f.name = e.target.value; } })),
      h('div', { class: 'field' }, h('span', {}, 'Tipo'), seg('kind', KINDS, f.kind, (v) => { f.kind = v; paintDepth(); })),
      field('Diâmetro externo em mm', h('input', { type: 'text', inputmode: 'decimal', value: f.diameter, placeholder: 'Ex.: 260', oninput: (e) => { f.diameter = e.target.value; } })),
      depthBox,
      h('button', { style: 'margin-top:14px', onclick: async () => {
        const r = plateFromForm({ id: cur?.id, ...f }, plates.map(p => p.id));
        if (r.errors) { msg.replaceChildren(errorBox(r.errors)); return; }
        await db.put('plates', r.plate); toast('Prato salvo.'); location.hash = '#/plates';
      } }, 'Salvar prato'), msg),
    cur && !used ? h('button', { class: 'danger', onclick: async () => { if (confirm('Excluir este prato?')) { await db.del('plates', cur.id); location.hash = '#/plates'; } } }, 'Excluir prato') : null,
    cur && used ? h('p', { class: 'muted' }, 'Este prato já tem refeições, então não pode ser excluído. Pode editar o nome (não mude as medidas).') : null);
}

// ---------------------------------------------------------------- new weighed meal
const newDraft = (plates, last = {}) => ({
  captured_at: isoWithOffset(), plate_id: plates.some(p => p.id === last.plate) ? last.plate : (plates.length === 1 ? plates[0].id : ''),
  photos: [], items: [], leftovers_g: '', notes: '', lighting: last.lighting ?? 'daylight',
});
function persistDraft(draft) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => db.setSetting('draft', { ...draft, photos: draft.photos.filter(p => !p.pending) }).catch(() => {}), 300);
}

async function screenMeal(fresh) {
  const plates = await db.getAll('plates');
  if (!plates.length) {
    show(back(), h('h1', {}, 'Pesar refeição'), h('div', { class: 'banner' }, 'Primeiro cadastre o prato ou a tigela em que vai pesar.'), h('a', { class: 'btn', href: '#/plates/new' }, 'Cadastrar prato'));
    return;
  }
  const last = (await db.getSetting('last_used')) ?? {};
  const existing = await db.getSetting('draft');
  if (fresh) {
    if (existing && !confirm('Descartar a refeição em andamento e começar outra?')) { location.hash = '#/meal'; return; }
    await db.setSetting('draft', newDraft(plates, last)); location.hash = '#/meal'; return;
  }
  let draft = existing;
  if (!draft) { draft = newDraft(plates, last); await db.setSetting('draft', draft); }
  const ui = { errors: [], warnings: [], saving: false, query: '' };
  const change = () => persistDraft(draft);
  const vscroll = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };

  async function addFiles(files) {
    for (const file of files) {
      const used = new Set(draft.photos.map(p => p.angle));
      const p = { pending: true, blob: file, angle: ANGLES.find(a => !used.has(a.id))?.id ?? 'natural', lighting: draft.lighting, sha256: '', phash: '' };
      draft.photos.push(p);
      vscroll();
      try {
        p.sha256 = await sha256Hex(await file.arrayBuffer());
        p.phash = await phashOfBlob(file);
        const dupe = draft.photos.some(q => q !== p && q.sha256 === p.sha256) || await db.hasPhoto(p.sha256);
        if (dupe) { draft.photos.splice(draft.photos.indexOf(p), 1); alert('Essa foto já foi adicionada (mesmo arquivo).'); }
        else delete p.pending;
      } catch (err) {
        draft.photos.splice(draft.photos.indexOf(p), 1);
        alert(`Não consegui processar a foto: ${err.message}`);
      }
      change(); vscroll();
    }
  }
  const picker = (label, capture, cls) => {
    const input = h('input', { type: 'file', accept: 'image/*', ...(capture ? { capture: 'environment' } : { multiple: true }), onchange: (e) => { const fs = [...e.target.files]; e.target.value = ''; addFiles(fs); } });
    return h('label', { class: `btn ${cls}` }, label, input);
  };

  function render() {
    const results = h('div', { class: 'results', hidden: true });
    const paintResults = () => {
      const hits = searchVocab(vocab.classes, ui.query, 25);
      results.hidden = ui.query.trim() === '' ? true : false;
      results.replaceChildren(...(hits.length ? hits.map(c => h('button', { type: 'button', onclick: () => { draft.items.push(itemFromClass(c)); ui.query = ''; change(); vscroll(); } }, c.pt)) : [h('p', { class: 'muted', style: 'padding:8px 12px' }, 'Nada encontrado. Tente outra palavra.')]));
    };
    const search = h('input', { type: 'search', placeholder: 'Buscar alimento (ex.: arroz, frango)…', value: ui.query, autocomplete: 'off', oninput: (e) => { ui.query = e.target.value; paintResults(); } });
    paintResults();

    const photoCards = draft.photos.map((p, i) => h('div', { class: 'card photo' },
      p.blob ? h('img', { src: objUrl(p.blob), alt: `Foto ${i + 1}` }) : null,
      h('div', { class: 'fields' },
        p.pending ? h('p', { class: 'muted' }, 'Calculando hashes…') : h('p', { class: 'muted' }, `sha256 ${p.sha256.slice(0, 8)}… · phash ${p.phash}`),
        seg(`angle-${i}`, ANGLES, p.angle, (v) => { p.angle = v; change(); }),
        field('Iluminação', select(LIGHTINGS, p.lighting, (v) => { p.lighting = v; draft.lighting = v; change(); })),
        h('button', { class: 'danger small', style: 'margin-top:8px', onclick: () => { draft.photos.splice(i, 1); change(); vscroll(); } }, 'Remover foto'))));

    const itemCards = draft.items.map((it, i) => h('div', { class: 'card item' },
      h('h3', {}, it.label),
      h('div', { class: 'two' },
        field('Estado', select(STATES, it.state, (v) => { it.state = v; change(); })),
        field('Método', select(METHODS, it.method, (v) => { it.method = v; change(); }))),
      h('div', { class: 'two' },
        field('Gramas (inteiro)', h('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', value: it.grams, oninput: (e) => { it.grams = e.target.value; change(); } })),
        field('Óleo em g (opcional)', h('input', { type: 'text', inputmode: 'decimal', value: it.oil_g, oninput: (e) => { it.oil_g = e.target.value; change(); } }))),
      h('button', { class: 'danger small', style: 'margin-top:8px', onclick: () => { draft.items.splice(i, 1); change(); vscroll(); } }, 'Remover item')));

    const split = splitForCapture(draft.captured_at);
    show(back(), h('h1', {}, 'Pesar refeição'),
      h('div', { class: 'card' },
        h('div', { class: 'row' }, h('span', {}, `Data e hora: ${fmtDate(draft.captured_at)}`), h('span', { class: `badge ${split}` }, SPLIT_LABEL[split])),
        h('p', { class: 'muted' }, 'A divisão é automática: semana ISO ímpar é calibração, par é teste. Não dá para mudar.')),
      h('h2', {}, '1. Prato'),
      select([{ id: '', label: 'Escolha o prato…' }, ...plates.map(p => ({ id: p.id, label: `${p.name} (${p.diameter_mm} mm)` }))], draft.plate_id, (v) => { draft.plate_id = v; change(); }),
      h('h2', {}, `2. Fotos (${draft.photos.length})`),
      h('p', { class: 'muted' }, `Pelo menos ${MIN_PHOTOS_RECOMMENDED}: de cima (~90°), a 45° e uma natural. Sem zoom, prato inteiro no quadro, antes de comer.`),
      photoCards,
      picker('Tirar foto', true, ''), h('div', { style: 'height:8px' }), picker('Escolher da galeria', false, 'secondary small'),
      h('h2', {}, `3. Itens (${draft.items.length})`),
      itemCards, search, results,
      h('h2', {}, '4. Sobras e notas'),
      field('Sobras no prato em g (opcional)', h('input', { type: 'text', inputmode: 'decimal', value: draft.leftovers_g, oninput: (e) => { draft.leftovers_g = e.target.value; change(); } })),
      field('Notas (opcional)', h('textarea', { value: draft.notes, oninput: (e) => { draft.notes = e.target.value; change(); } })),
      errorBox(ui.errors), errorBox(ui.warnings, 'banner'),
      h('button', { style: 'margin-top:14px', disabled: ui.saving, onclick: save }, ui.warnings.length ? 'Salvar mesmo assim' : 'Salvar refeição'),
      h('button', { class: 'danger', style: 'margin-top:10px', onclick: async () => { if (confirm('Descartar esta refeição em andamento?')) { clearTimeout(saveTimer); await db.del('kv', 'draft'); location.hash = '#/'; } } }, 'Descartar rascunho'));
  }

  async function save() {
    const { errors, warnings } = checkMealDraft(draft, plates);
    const firstTry = ui.warnings.length === 0;
    ui.errors = errors; ui.warnings = errors.length ? [] : warnings;
    if (errors.length || (warnings.length && firstTry)) { vscroll(); return; }
    ui.saving = true;
    try {
      const existing = new Set((await db.getAll('meals')).map(m => m.id));
      let id = newMealId(draft.captured_at); while (existing.has(id)) id = newMealId(draft.captured_at);
      const meal = mealFromDraft(draft, id);
      await db.saveMeal(meal, draft.photos.map(p => ({ sha256: p.sha256, blob: p.blob })));
      await db.setSetting('last_used', { plate: draft.plate_id, lighting: draft.lighting });
      clearTimeout(saveTimer); // a pending autosave must not resurrect the draft
      await db.del('kv', 'draft');
      toast('Refeição salva.'); location.hash = '#/meals';
    } catch (err) { ui.saving = false; ui.errors = [`Não foi possível salvar: ${err.message}`]; vscroll(); }
  }
  render();
}

// ---------------------------------------------------------------- saved meals
async function screenMeals() {
  const { plates, meals } = await snapshot();
  const sorted = [...meals].sort((a, b) => (a.captured_at < b.captured_at ? 1 : -1));
  show(back(), h('h1', {}, 'Refeições salvas'), sorted.length ? sorted.map(m => {
    const total = m.items.reduce((s, it) => s + it.grams, 0);
    return h('a', { class: 'card', style: 'display:block;color:inherit;text-decoration:none', href: `#/meals/${encodeURIComponent(m.id)}` },
      h('div', { class: 'row' }, h('strong', {}, fmtDate(m.captured_at)), h('span', { class: `badge ${m.split}` }, SPLIT_LABEL[m.split])),
      h('div', { class: 'muted' }, `${plates.find(p => p.id === m.plate_id)?.name ?? m.plate_id} · ${m.photos.length} fotos · ${m.items.length} itens · ${total} g`));
  }) : h('p', { class: 'muted' }, 'Nenhuma refeição ainda.'));
}

async function screenMealDetail(id) {
  const { plates, meals } = await snapshot();
  const m = meals.find(x => x.id === id);
  if (!m) { location.hash = '#/meals'; return; }
  const blobs = await Promise.all(m.photos.map(p => db.get('photos', p.sha256)));
  show(back('#/meals', 'Refeições'), h('h1', {}, fmtDate(m.captured_at)),
    h('div', { class: 'row' }, h('span', { class: `badge ${m.split}` }, SPLIT_LABEL[m.split]), h('span', { class: 'muted' }, plates.find(p => p.id === m.plate_id)?.name ?? m.plate_id)),
    h('div', { class: 'thumbs', style: 'margin:10px 0' }, blobs.map((b, i) => b ? h('figure', { style: 'margin:0;flex:none' }, h('img', { src: objUrl(b.blob), alt: `Foto ${i + 1}`, style: 'width:110px;height:110px;object-fit:cover;border-radius:10px' }),
      h('figcaption', { class: 'muted' }, `${m.photos[i].angle_deg}° · ${LIGHTINGS.find(l => l.id === m.photos[i].lighting)?.label}`)) : null)),
    m.items.map(it => h('div', { class: 'card' }, h('strong', {}, it.label), h('br'),
      `${it.grams} g · ${STATES.find(s => s.id === it.state)?.label} · ${METHODS.find(x => x.id === it.method)?.label ?? it.method}${it.oil_g !== undefined ? ` · óleo ${it.oil_g} g` : ''}`)),
    m.leftovers_g !== undefined ? h('p', {}, `Sobras: ${m.leftovers_g} g`) : null, m.notes ? h('p', {}, `Notas: ${m.notes}`) : null,
    h('p', { class: 'muted' }, 'Para corrigir algo, exclua a refeição e lance de novo. Refeições do conjunto de teste não devem ser excluídas só porque ficaram feias: o protocolo pede todas.'),
    h('button', { class: 'danger', onclick: async () => { if (confirm('Excluir esta refeição e suas fotos deste aparelho?')) { await db.deleteMeal(m); location.hash = '#/meals'; } } }, 'Excluir refeição'));
}

// ---------------------------------------------------------------- export
async function screenExport() {
  const snap = await snapshot();
  const manifest = buildManifest(snap);
  const problems = exportProblems(manifest);
  const text = JSON.stringify(manifest, null, 2);
  const file = new File([text], 'manifest.json', { type: 'application/json' }); // built now so the tap can share at once (iOS needs a fresh tap)
  const msg = h('div');
  const markDone = () => db.setSetting('last_export', isoWithOffset());
  const download = () => { const a = h('a', { href: objUrl(file), download: 'manifest.json' }); document.body.append(a); a.click(); a.remove(); };
  const doExport = async () => {
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Macrofy manifest' }); await markDone(); msg.replaceChildren(h('div', { class: 'good' }, 'Manifesto compartilhado.')); return; }
    } catch (err) { if (err.name === 'AbortError') return; }
    download(); await markDone(); msg.replaceChildren(h('div', { class: 'good' }, 'Arquivo manifest.json baixado.'));
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); await markDone(); msg.replaceChildren(h('div', { class: 'good' }, 'Copiado. Cole no chat.')); }
    catch { msg.replaceChildren(errorBox(['Não consegui copiar. Use "Compartilhar ou baixar".'])); }
  };
  show(back(), h('h1', {}, 'Exportar manifesto'),
    h('p', {}, `${snap.plates.length} pratos, ${snap.meals.length} refeições, ${snap.meals.reduce((s, m) => s + m.photos.length, 0)} fotos (só o sha256 e o hash de cada foto entram no arquivo; as fotos ficam neste aparelho).`),
    problems.length
      ? h('div', { class: 'errors', role: 'alert' }, h('strong', {}, `${problems.length} problema(s) impedem a exportação:`),
        h('ul', {}, problems.map(p => h('li', {}, p.texto, p.correcao ? ` ${p.correcao}` : '', h('br'), h('small', { class: 'muted' }, p.detalhe)))))
      : h('div', { class: 'good' }, 'O manifesto passou em todas as regras do benchmark.'),
    snap.scale.model ? null : h('a', { class: 'btn secondary', href: '#/plates' }, 'Informar a balança'),
    h('div', { class: 'stack', style: 'margin-top:12px' },
      h('button', { disabled: problems.length > 0, onclick: doExport }, 'Exportar manifesto (compartilhar ou baixar)'),
      h('button', { class: 'secondary', disabled: problems.length > 0, onclick: copy }, 'Copiar texto para colar no chat')),
    msg,
    h('p', { class: 'muted' }, 'Depois de exportar: envie o arquivo pelo GitHub (bench/manifest.json) ou cole o texto no chat. Detalhes no protocolo de pesagem.'));
}

// ---------------------------------------------------------------- estimation (T-013): screens live in estimate.mjs
const estimate = createEstimate({ h, show, back, errorBox, toast, db, objUrl, fmtDate, bitmapOf, searchVocab, isoWithOffset, getVocab: () => vocab });

// ---------------------------------------------------------------- router and start
const ROUTES = [
  [/^#\/estimate\/new$/, estimate.screenEstimateNew], [/^#\/estimate$/, estimate.screenEstimate], [/^#\/estimates$/, estimate.screenEstimates],
  [/^#\/?$/, screenHome], [/^#\/meal$/, () => screenMeal(false)], [/^#\/meal\/new$/, () => screenMeal(true)],
  [/^#\/meals$/, screenMeals], [/^#\/meals\/(.+)$/, (m) => screenMealDetail(decodeURIComponent(m[1]))],
  [/^#\/plates$/, screenPlates], [/^#\/plates\/(.+)$/, (m) => screenPlateForm(decodeURIComponent(m[1]))], [/^#\/export$/, screenExport],
];
async function route() {
  const hash = location.hash || '#/';
  for (const [re, fn] of ROUTES) { const m = re.exec(hash); if (m) { try { await fn(m); } catch (err) { show(back(), h('div', { class: 'errors' }, `Erro: ${err.message}`)); console.error(err); } window.scrollTo(0, 0); return; } }
  location.hash = '#/';
}

async function start() {
  try { vocab = await (await fetch('data/vocab.json')).json(); } catch (err) { console.error('vocab', err); }
  try { persisted = (await navigator.storage?.persist?.()) ?? null; } catch { persisted = null; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((err) => console.warn('sw', err));
  addEventListener('hashchange', route);
  await route();
}
start().catch((err) => { root.textContent = `Não foi possível iniciar: ${err.message}`; });
