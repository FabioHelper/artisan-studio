// Pure logic of the capture app: no DOM, no IndexedDB, so Node can test it (capture/selftest.mjs).
import { SCHEMA_ID, validateManifest } from './vendor/schema-core.mjs';

export { SCHEMA_ID };

// ---------------------------------------------------------------- constants shown in the UI
/** Photo angle tags -> angle_deg in the manifest (degrees above the horizontal). */
export const ANGLES = [
  { id: 'top', label: 'Topo (~90°)', deg: 90 },
  { id: 'diag', label: '45°', deg: 45 },
  { id: 'natural', label: 'Natural', deg: 30 },
];
export const LIGHTINGS = [
  { id: 'daylight', label: 'Luz do dia' },
  { id: 'warm', label: 'Lâmpada quente' },
  { id: 'dim', label: 'Pouca luz' },
  { id: 'flash', label: 'Flash' },
];
export const STATES = [{ id: 'raw', label: 'Cru' }, { id: 'cooked', label: 'Cozido' }];
export const METHODS = [
  { id: 'raw', label: 'Cru' }, { id: 'boiled', label: 'Cozido na água' }, { id: 'fried', label: 'Frito ou refogado' },
  { id: 'grilled', label: 'Grelhado' }, { id: 'baked', label: 'Assado' }, { id: 'stewed', label: 'Ensopado' }, { id: 'mixed', label: 'Prato misto' },
];
export const KINDS = [{ id: 'plate', label: 'Prato' }, { id: 'bowl', label: 'Tigela' }];
export const MIN_PHOTOS_RECOMMENDED = 3;

// ---------------------------------------------------------------- hashes
const HEX = '0123456789abcdef';
export function bytesToHex(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += HEX[b >> 4] + HEX[b & 15];
  return s;
}
/** sha256 of an ArrayBuffer/Uint8Array as 64 lowercase hex chars. `subtle` defaults to crypto.subtle (browser and Node). */
export async function sha256Hex(bytes, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('crypto.subtle indisponível (o app precisa de https)');
  return bytesToHex(await subtle.digest('SHA-256', bytes));
}

export const DHASH_COLS = 9;
export const DHASH_ROWS = 8;
/** Average luminance (BT.601) of an RGBA image on a cols x rows grid (box filter). Returns Float64Array(cols*rows). */
export function grayGrid(rgba, w, h, cols = DHASH_COLS, rows = DHASH_ROWS) {
  const sum = new Float64Array(cols * rows); const cnt = new Float64Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const r = Math.min(rows - 1, Math.floor((y * rows) / h));
    for (let x = 0; x < w; x++) {
      const c = Math.min(cols - 1, Math.floor((x * cols) / w));
      const i = (y * w + x) * 4;
      sum[r * cols + c] += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      cnt[r * cols + c]++;
    }
  }
  return sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
}
/**
 * dHash core: `gray` is 9x8 luminance values, row-major. Bit k (row-major, 8 per row, most significant first)
 * is 1 when the pixel is brighter than its right neighbour. Returns 16 lowercase hex chars.
 */
export function dHashFromGray(gray) {
  if (gray.length !== DHASH_COLS * DHASH_ROWS) throw new Error('dHash needs 9x8 = 72 gray values');
  let hex = '';
  for (let y = 0; y < DHASH_ROWS; y++) {
    let byte = 0;
    for (let x = 0; x < DHASH_COLS - 1; x++) byte = (byte << 1) | (gray[y * DHASH_COLS + x] > gray[y * DHASH_COLS + x + 1] ? 1 : 0);
    hex += HEX[byte >> 4] + HEX[byte & 15];
  }
  return hex;
}
/** dHash of an RGBA pixel array of any size (the browser passes a small canvas readback). */
export const dHashFromRGBA = (rgba, w, h) => dHashFromGray(grayGrid(rgba, w, h));

// ---------------------------------------------------------------- dates and split
const p2 = (n) => String(n).padStart(2, '0');
/** ISO datetime with the local UTC offset, e.g. 2026-10-03T19:42:10-03:00. */
export function isoWithOffset(d = new Date()) {
  const off = -d.getTimezoneOffset(); const a = Math.abs(off);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}${off < 0 ? '-' : '+'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}
/** ISO 8601 week number (1..53) of a calendar date. */
export function isoWeek(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); // the Thursday of this week decides the week
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t - jan1) / 86400000 + 1) / 7);
}
/** Split from the calendar date as written in captured_at: odd ISO week = calibration, even = test. */
export function splitForCapture(capturedAt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(capturedAt);
  if (!m) throw new Error(`captured_at inválido: ${capturedAt}`);
  return isoWeek(+m[1], +m[2], +m[3]) % 2 === 1 ? 'calibration' : 'test';
}
export const SPLIT_LABEL = { calibration: 'Calibração', test: 'Teste' };

// ---------------------------------------------------------------- input parsing
const clean = (s) => String(s ?? '').trim().replace(',', '.');
/** Grams as a positive integer <= 3000, or null. */
export function parseGrams(s) {
  const v = clean(s);
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && n <= 3000 ? n : null;
}
/** Optional non-negative decimal (oil, leftovers). '' -> {value: undefined}; junk -> {error: true}. */
export function parseOptionalGrams(s) {
  const v = clean(s);
  if (v === '') return { value: undefined };
  if (!/^\d+(\.\d+)?$/.test(v)) return { error: true };
  const n = Number(v);
  return n <= 3000 ? { value: n } : { error: true };
}
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'prato';

/** Validates the plate form. Returns { plate } or { errors: [pt-BR] }. `existingIds` are used to derive a unique id for a new plate. */
export function plateFromForm({ id, name, kind, diameter, depth }, existingIds = []) {
  const errors = [];
  if (!String(name ?? '').trim()) errors.push('Dê um nome ao prato (ex.: "Prato raso branco").');
  if (!KINDS.some(k => k.id === kind)) errors.push('Escolha se é prato ou tigela.');
  const d = clean(diameter);
  const dia = /^\d+(\.\d+)?$/.test(d) ? Number(d) : NaN;
  if (!(dia >= 50 && dia <= 500)) errors.push('Diâmetro externo em mm, entre 50 e 500 (meça com a régua).');
  let dep;
  if (clean(depth) !== '') {
    const p = clean(depth); dep = /^\d+(\.\d+)?$/.test(p) ? Number(p) : NaN;
    if (!(dep >= 5 && dep <= 300)) errors.push('Profundidade em mm, entre 5 e 300 (ou deixe em branco).');
  }
  if (errors.length) return { errors };
  let pid = id;
  if (!pid) { const base = slug(name); pid = base; for (let i = 2; existingIds.includes(pid); i++) pid = `${base}-${i}`; }
  const plate = { id: pid, name: String(name).trim(), kind, diameter_mm: dia };
  if (dep !== undefined) plate.depth_mm = dep;
  return { plate };
}

/** Validates the meal form draft. Returns { errors: [pt-BR], warnings: [pt-BR] }. */
export function checkMealDraft(draft, plates) {
  const errors = []; const warnings = [];
  if (!draft.plate_id || !plates.some(p => p.id === draft.plate_id)) errors.push('Escolha o prato.');
  if (!draft.photos?.length) errors.push('Adicione pelo menos uma foto.');
  else if (draft.photos.length < MIN_PHOTOS_RECOMMENDED) warnings.push(`O protocolo pede pelo menos ${MIN_PHOTOS_RECOMMENDED} fotos (topo, 45° e natural).`);
  if (draft.photos?.some(p => !p.sha256 || !p.phash)) errors.push('Aguarde o cálculo das fotos terminar.');
  if (!draft.items?.length) errors.push('Adicione pelo menos um item.');
  (draft.items ?? []).forEach((it, i) => {
    if (parseGrams(it.grams) === null) errors.push(`Item ${i + 1} (${it.label}): informe as gramas como número inteiro, de 1 a 3000.`);
    if (parseOptionalGrams(it.oil_g).error) errors.push(`Item ${i + 1} (${it.label}): óleo deve ser um número em gramas (ou em branco).`);
  });
  if (parseOptionalGrams(draft.leftovers_g).error) errors.push('Sobras deve ser um número em gramas (ou em branco).');
  return { errors, warnings };
}

/** Draft (form strings) -> stored meal record. `id` must be unique. */
export function mealFromDraft(draft, id) {
  const meal = {
    id, captured_at: draft.captured_at, split: splitForCapture(draft.captured_at), plate_id: draft.plate_id,
    photos: draft.photos.map(p => ({ sha256: p.sha256, phash: p.phash, angle: p.angle, angle_deg: ANGLES.find(a => a.id === p.angle).deg, lighting: p.lighting })),
    items: draft.items.map((it, i) => {
      const o = { id: `i${i + 1}`, label: it.label, grams: parseGrams(it.grams), state: it.state, method: it.method };
      const oil = parseOptionalGrams(it.oil_g).value; if (oil !== undefined) o.oil_g = oil;
      return o;
    }),
  };
  const left = parseOptionalGrams(draft.leftovers_g).value; if (left !== undefined) meal.leftovers_g = left;
  if (String(draft.notes ?? '').trim()) meal.notes = String(draft.notes).trim();
  return meal;
}
export const newMealId = (capturedAt, rand = Math.random) => `m${capturedAt.slice(0, 19).replace(/\D/g, '')}-${Math.floor(rand() * 0x10000).toString(16).padStart(4, '0')}`;

// ---------------------------------------------------------------- the manifest
/** Stored plates/meals + scale -> the macrofy.bench/1 manifest (drops app-only fields such as name and angle). */
export function buildManifest({ scale, plates, meals }) {
  return {
    schema: SCHEMA_ID,
    scale: { model: scale?.model ?? '', resolution_g: scale?.resolution_g },
    plates: [...plates].sort((a, b) => (a.id < b.id ? -1 : 1)).map(p => ({ id: p.id, diameter_mm: p.diameter_mm, ...(p.depth_mm !== undefined ? { depth_mm: p.depth_mm } : {}), kind: p.kind })),
    meals: [...meals].sort((a, b) => (a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : a.id < b.id ? -1 : 1)).map(m => ({
      id: m.id, captured_at: m.captured_at, split: m.split, plate_id: m.plate_id,
      photos: m.photos.map(p => ({ sha256: p.sha256, phash: p.phash, angle_deg: p.angle_deg, lighting: p.lighting })),
      items: m.items.map(it => ({ id: it.id, label: it.label, grams: it.grams, state: it.state, method: it.method, ...(it.oil_g !== undefined ? { oil_g: it.oil_g } : {}) })),
      ...(m.leftovers_g !== undefined ? { leftovers_g: m.leftovers_g } : {}),
      ...(m.notes ? { notes: m.notes } : {}),
    })),
  };
}

// ---------------------------------------------------------------- validation messages in pt-BR
const FIELD_PT = {
  id: 'identificador', diameter_mm: 'diâmetro (mm)', depth_mm: 'profundidade (mm)', kind: 'tipo', captured_at: 'data e hora', split: 'divisão',
  plate_id: 'prato', photos: 'fotos', items: 'itens', leftovers_g: 'sobras (g)', notes: 'observações', sha256: 'sha256 da foto', phash: 'hash perceptual da foto',
  angle_deg: 'ângulo da foto', distance_cm: 'distância (cm)', lighting: 'iluminação', label: 'alimento', grams: 'gramas', state: 'estado', method: 'método',
  oil_g: 'óleo (g)', model: 'modelo da balança', resolution_g: 'resolução da balança (g)', scale: 'balança', plates: 'pratos', meals: 'refeições', schema: 'versão do formato',
};
export const RULE_PT = {
  'unique-ids': 'Há identificadores repetidos (prato, refeição ou item). Isso não deveria acontecer pelo app: exporte de novo depois de recarregar a página e avise no chat.',
  'unique-photos': 'A mesma foto aparece em duas refeições. Cada foto pertence a uma única refeição: apague a refeição duplicada.',
  'plate-ref': 'Uma refeição aponta para um prato que não está cadastrado.',
  'plausible-grams': 'Peso fora do plausível (deve ser maior que 0 e até 3000 g; óleo e sobras não podem ser negativos). Confira a pesagem: gramas são o peso líquido do alimento, sem o prato.',
  'split-by-date': 'Um mesmo dia tem refeições nas duas divisões (calibração e teste). O app decide a divisão pela semana ISO da data, então isso indica dados fora do app: avise no chat.',
  'near-duplicate-leakage': 'Fotos quase idênticas caíram em divisões diferentes (calibração e teste), o que inflaria a precisão. Provavelmente a mesma cena foi fotografada em semanas diferentes: avise no chat antes de continuar.',
  'frozen-test-set': 'O conjunto de teste congelado foi alterado.',
  completeness: 'O benchmark ainda não está completo (poucas refeições ou poucas semanas).',
};
/** 'meals[0].items[1].grams' -> 'refeição 19/10 12:30, item 2, gramas' (uses the manifest to name the meal). */
export function humanizePath(path, manifest) {
  const parts = [];
  for (const seg of path.split('.')) {
    const m = /^(\w+)(?:\[(\d+)\])?$/.exec(seg);
    if (!m) { parts.push(seg); continue; }
    const [, key, idx] = m;
    if (key === 'manifest') continue;
    const n = idx === undefined ? null : Number(idx);
    if (key === 'meals' && n !== null) { const c = manifest?.meals?.[n]?.captured_at; parts.push(c ? `refeição de ${c.slice(8, 10)}/${c.slice(5, 7)} ${c.slice(11, 16)}` : `refeição ${n + 1}`); }
    else if (key === 'plates' && n !== null) parts.push(`prato ${manifest?.plates?.[n]?.id ?? n + 1}`);
    else if (key === 'photos' && n !== null) parts.push(`foto ${n + 1}`);
    else if (key === 'items' && n !== null) parts.push(`item ${n + 1}`);
    else parts.push(FIELD_PT[key] ?? key);
  }
  return parts.join(', ');
}
/**
 * Runs the benchmark rules on a manifest and returns problems in pt-BR:
 * [{ rule, texto, correcao, detalhe }] (detalhe = the validator's own English message, for support).
 * Empty array = the export is valid.
 */
export function problemsPt(manifest, opts = {}) {
  return validateManifest(manifest, opts).map(({ rule, msg, fix }) => {
    let texto = RULE_PT[rule] ?? 'Problema de validação.';
    if (rule === 'schema-types') {
      const m = /^(\S+?) (is missing|must be|is not a known field)/.exec(msg);
      const where = m ? humanizePath(m[1], manifest) : msg;
      texto = !m ? `Formato inválido: ${msg}` : m[2] === 'is missing' ? `Falta preencher: ${where}.` : m[2] === 'must be' ? `Valor inválido em ${where}.` : `Campo desconhecido: ${where}.`;
    }
    return { rule, texto, correcao: rule === 'schema-types' ? 'Corrija o valor (prato, balança, item ou foto) e exporte de novo.' : undefined, detalhe: `${msg} — ${fix}` };
  });
}
/** Export gate: the app's own requirements (scale, at least one meal) plus every benchmark rule. */
export function exportProblems(manifest) {
  const out = [];
  if (!manifest.meals.length) out.push({ rule: 'app', texto: 'Ainda não há refeições para exportar.', detalhe: 'meals is empty' });
  return [...out, ...problemsPt(manifest)];
}

// ---------------------------------------------------------------- food search (vocab pt names)
export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** Classes whose pt or en name matches every word of the query; prefix matches first. */
export function searchVocab(classes, query, limit = 30) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const scored = [];
  for (const c of classes) {
    const pt = norm(c.pt); const hay = `${pt} ${norm(c.en ?? '')}`;
    if (!words.every(w => hay.includes(w))) continue;
    scored.push({ c, s: (pt.startsWith(words[0] ?? '') ? 0 : pt.split(/[\s(,]+/).some(t => t.startsWith(words[0] ?? '')) ? 1 : 2) });
  }
  if (!words.length) return [...classes].sort((a, b) => a.pt.localeCompare(b.pt, 'pt')).slice(0, limit);
  return scored.sort((a, b) => a.s - b.s || a.c.pt.localeCompare(b.c.pt, 'pt')).slice(0, limit).map(x => x.c);
}
/** New item defaults come from the vocab facets; the owner can change them. */
export const itemFromClass = (c) => ({ label: c.pt, class_id: c.id, state: c.state === 'raw' ? 'raw' : 'cooked', method: METHODS.some(m => m.id === c.method) ? c.method : 'boiled', grams: '', oil_g: '' });
