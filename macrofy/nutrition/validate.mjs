// The check `nutrition-map-validate` (T-005). Node built-ins only.
//   node nutrition/validate.mjs
// 1. selftest: a known-good fixture must pass every rule, and each negative fixture must fail its named rule
//    (a rule that has never been seen failing fails the run, as in harness/selftest.mjs);
// 2. lookup arithmetic against hand-computed values;
// 3. the real vocab.json + sources.json against the bundled extracts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLookup, UnknownFoodError, FacetMismatchError } from './lookup.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SCHEMA_ID = 'macrofy.vocab/1';
export const STATES = ['raw', 'cooked'];
export const METHODS = ['boiled', 'grilled', 'fried', 'baked', 'raw', 'stewed', 'mixed'];
export const ATWATER_TOLERANCE = 0.25; // |kcal - (4P + 4C + 9F)| may be at most 25% of the larger of the two ...
export const ATWATER_FLOOR_KCAL = 5; // ... unless the gap is under 5 kcal per 100 g (lettuce is 11 kcal: a 3 kcal gap is rounding, not an error)
export const MAX_DENSITY = 1.5; // g/mL; nothing on a plate is denser than this
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NUTS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'];
const TACO_FIELD = { kcal: 'energia_kcal', protein_g: 'proteina_g', carbs_g: 'carboidrato_g', fat_g: 'lipideos_g' };
const ZERO_QUALIFIERS = new Set(['TRACO', 'NAO_APLICAVEL']);

export const RULES = [
  { id: 'schema', title: 'schema id, oil entry, unique kebab-case class ids, non-empty pt/en names unique across classes, no class id also listed as missing' },
  { id: 'facets', title: 'every class has state (raw|cooked), method (boiled|grilled|fried|baked|raw|stewed|mixed) and default_oil_g_per_100g >= 0' },
  { id: 'source-resolves', title: 'every non-recipe class names a source (db, id, name) that exists in the bundled extract' },
  { id: 'nutrients-match-source', title: 'the four nutrients equal the source row (TACO Tr and NA read as 0)' },
  { id: 'atwater', title: 'kcal is within 25% of 4 protein + 4 carbs + 9 fat (floor 5 kcal per 100 g)' },
  { id: 'density', title: 'density_g_per_ml exists, is in (0, 1.5] and equals the recorded FNDDS portion grams / cup_ml; density_source names a real FNDDS food and portion' },
  { id: 'recipes', title: 'recipe ingredients are known classes with grams > 0, no cycles, and the nutrients equal the computed weighted sum' },
  { id: 'oil-basis', title: 'a default oil above 0 is a flagged assumption whose FNDDS with-oil / no-added-fat pair reproduces the number' },
  { id: 'sources-recorded', title: 'sources.json records name, version, url, retrieval date, license, attribution and a matching file hash for every bundled source, and every class db is one of them' },
  { id: 'commercial-use', title: 'every bundled source has commercial_use true or "with-citation"' },
];

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const close = (a, b, tol) => isNum(a) && isNum(b) && Math.abs(a - b) <= tol;
const r2 = (x) => Math.round(x * 100) / 100;

/** Expected value of a TACO nutrient, or undefined when the row has no usable value. */
function tacoValue(row, k) {
  const f = TACO_FIELD[k];
  if (isNum(row[f])) return row[f];
  if (row[f] === null && ZERO_QUALIFIERS.has(row.qualificadores?.[f])) return 0;
  return undefined;
}

/**
 * Validate a vocab against its sources and the bundled extracts.
 * data = { taco: { [id]: row }, fndds: { [food_code]: row } }.  Returns [{ rule, msg }].
 */
export function validateVocab(vocab, sources, data, { checkFiles = null } = {}) {
  const out = []; const P = (rule, msg) => out.push({ rule, msg });
  const classes = Array.isArray(vocab?.classes) ? vocab.classes : [];
  const byId = new Map(); const names = new Map();

  // ---- schema
  if (vocab?.schema !== SCHEMA_ID) P('schema', `schema must be "${SCHEMA_ID}" (got ${JSON.stringify(vocab?.schema)})`);
  if (!classes.length) P('schema', 'classes must be a non-empty array');
  if (!isNum(vocab?.cup_ml) || vocab.cup_ml <= 0) P('schema', 'cup_ml must be a positive number');
  const oil = vocab?.oil;
  if (!oil || !isStr(oil.id) || oil.source?.db !== 'TACO' || !data.taco?.[oil.source?.id]) P('schema', 'oil must name a TACO source row that exists in the extract');
  else {
    const fat = tacoValue(data.taco[oil.source.id], 'fat_g');
    if (!close(oil.fat_g_per_g, fat / 100, 1e-6)) P('schema', `oil.fat_g_per_g ${oil.fat_g_per_g} does not equal the TACO fat ${fat} g per 100 g / 100`);
    if (oil.kcal_per_g !== 9) P('schema', 'oil.kcal_per_g must be 9 (Atwater)');
  }
  for (const c of classes) {
    const at = `class ${JSON.stringify(c?.id)}`;
    if (!isStr(c?.id) || !KEBAB.test(c.id)) { P('schema', `${at}: id must be kebab-case`); continue; }
    if (byId.has(c.id)) P('schema', `${at}: duplicate id`);
    byId.set(c.id, c);
    for (const k of ['pt', 'en']) {
      if (!isStr(c[k])) { P('schema', `${at}: ${k} name is required`); continue; }
      const key = c[k].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (names.has(key) && names.get(key) !== c.id) P('schema', `${at}: ${k} name "${c[k]}" collides with class ${names.get(key)}`);
      names.set(key, c.id);
    }
  }
  for (const m of Array.isArray(vocab?.missing) ? vocab.missing : []) if (byId.has(m?.id)) P('schema', `${m.id} is both a class and listed as missing`);

  // ---- per class
  const computed = new Map(); // recipe nutrients, memoised; null = cycle
  const state = new Set();
  function recipeNutrients(c, trail) {
    if (computed.has(c.id)) return computed.get(c.id);
    if (state.has(c.id)) { P('recipes', `recipe cycle: ${[...trail, c.id].join(' -> ')}`); return null; }
    state.add(c.id);
    const total = c.recipe.ingredients.reduce((s, i) => s + (isNum(i?.grams) ? i.grams : 0), 0);
    const n = Object.fromEntries(NUTS.map(k => [k, 0])); let ok = total > 0; let oilSum = 0;
    for (const i of c.recipe.ingredients) {
      const ing = byId.get(i?.class);
      if (!ing) { P('recipes', `${c.id}: unknown ingredient class ${JSON.stringify(i?.class)}`); ok = false; continue; }
      if (!isNum(i.grams) || i.grams <= 0) { P('recipes', `${c.id}: ingredient ${i.class} needs grams > 0`); ok = false; continue; }
      const sub = ing.recipe ? recipeNutrients(ing, [...trail, c.id]) : ing.nutrients_per_100g;
      if (!sub) { ok = false; continue; }
      for (const k of NUTS) n[k] += sub[k] * i.grams / total;
      oilSum += (ing.default_oil_g_per_100g || 0) * i.grams / total;
    }
    state.delete(c.id);
    const res = ok ? { ...n, _oil: oilSum } : null;
    computed.set(c.id, res);
    return res;
  }

  for (const c of classes) {
    if (!isStr(c?.id)) continue;
    const at = `class ${c.id}`;
    // facets
    if (!STATES.includes(c.state)) P('facets', `${at}: state must be one of ${STATES.join('|')} (got ${JSON.stringify(c.state)})`);
    if (!METHODS.includes(c.method)) P('facets', `${at}: method must be one of ${METHODS.join('|')} (got ${JSON.stringify(c.method)})`);
    if (!isNum(c.default_oil_g_per_100g) || c.default_oil_g_per_100g < 0) P('facets', `${at}: default_oil_g_per_100g must be a number >= 0`);

    // nutrients present
    const n = c.nutrients_per_100g;
    const nutrientsOk = n && NUTS.every(k => isNum(n[k]) && n[k] >= 0);
    if (!nutrientsOk) P('nutrients-match-source', `${at}: nutrients_per_100g needs kcal, protein_g, carbs_g, fat_g as numbers >= 0`);

    // source
    if (c.recipe) {
      if (c.source) P('recipes', `${at}: a recipe class must not also name a source row`);
      if (!Array.isArray(c.recipe.ingredients) || !c.recipe.ingredients.length) P('recipes', `${at}: recipe.ingredients must be a non-empty array`);
      else {
        if (c.recipe.assumption !== true) P('recipes', `${at}: the ingredient proportions are an assumption and must be flagged recipe.assumption: true`);
        const res = recipeNutrients(c, []);
        if (res && nutrientsOk) {
          for (const k of NUTS) if (!close(n[k], r2(res[k]), 0.006)) P('recipes', `${at}: ${k} ${n[k]} is not the computed value ${r2(res[k])} (nutrients of a recipe are computed from its ingredients, never typed)`);
          if (isNum(c.default_oil_g_per_100g) && !close(c.default_oil_g_per_100g, r2(res._oil), 0.006)) P('oil-basis', `${at}: recipe default oil ${c.default_oil_g_per_100g} is not the weighted ingredient value ${r2(res._oil)}`);
        }
      }
    } else {
      const s = c.source; const db = s?.db;
      const table = db === 'TACO' ? data.taco : db === 'FNDDS' ? data.fndds : null;
      const row = table && s ? table[s.id] : undefined;
      if (!table) P('source-resolves', `${at}: source.db must be TACO or FNDDS (got ${JSON.stringify(db)})`);
      else if (!row) P('source-resolves', `${at}: source ${db} ${JSON.stringify(s?.id)} is not in the bundled extract`);
      else {
        const rowName = db === 'TACO' ? row.descricao : row.description;
        if (s.name !== rowName) P('source-resolves', `${at}: source.name ${JSON.stringify(s.name)} is not the row name ${JSON.stringify(rowName)}`);
        if (nutrientsOk) for (const k of NUTS) {
          const want = db === 'TACO' ? tacoValue(row, k) : row.nutrients?.[k];
          if (want === undefined) P('nutrients-match-source', `${at}: ${db} ${s.id} has no usable ${k} value`);
          else if (!close(n[k], want, 0.005)) P('nutrients-match-source', `${at}: ${k} ${n[k]} differs from ${db} ${s.id} value ${want}`);
        }
      }
    }

    // atwater
    if (nutrientsOk) {
      const at4 = 4 * n.protein_g + 4 * n.carbs_g + 9 * n.fat_g; const gap = Math.abs(n.kcal - at4);
      if (gap > ATWATER_FLOOR_KCAL && gap > ATWATER_TOLERANCE * Math.max(n.kcal, at4)) P('atwater', `${at}: kcal ${n.kcal} vs Atwater 4/4/9 ${at4.toFixed(1)} differ by more than ${ATWATER_TOLERANCE * 100}%`);
    }

    // density
    const d = c.density_g_per_ml; const ds = c.density_source;
    if (!isNum(d)) P('density', `${at}: density_g_per_ml is missing`);
    else if (d <= 0 || d > MAX_DENSITY) P('density', `${at}: density_g_per_ml ${d} is outside (0, ${MAX_DENSITY}]`);
    if (!ds || ds.db !== 'FNDDS') P('density', `${at}: density_source must name an FNDDS food and portion`);
    else {
      const f = data.fndds?.[ds.food_code];
      const p = f?.portions?.find(x => String(x.portion_id) === String(ds.portion_id));
      if (!f) P('density', `${at}: density_source food ${JSON.stringify(ds.food_code)} is not in the FNDDS extract`);
      else if (!p) P('density', `${at}: density_source portion ${JSON.stringify(ds.portion_id)} is not a portion of FNDDS ${ds.food_code}`);
      else {
        if (p.description !== ds.portion || p.gram_weight !== ds.grams) P('density', `${at}: density_source portion "${ds.portion}" ${ds.grams} g differs from the FNDDS row "${p.description}" ${p.gram_weight} g`);
        if (ds.ml !== vocab.cup_ml) P('density', `${at}: density_source.ml ${ds.ml} must equal cup_ml ${vocab.cup_ml}`);
        if (!/^1 cup/.test(p.description)) P('density', `${at}: density is derived from a cup portion; "${p.description}" is not one`);
        if (isNum(d) && !close(d, p.gram_weight / vocab.cup_ml, 5e-4)) P('density', `${at}: density ${d} is not ${p.gram_weight} g / ${vocab.cup_ml} mL = ${(p.gram_weight / vocab.cup_ml).toFixed(4)}`);
        if (!['exact', 'analog'].includes(ds.match)) P('density', `${at}: density_source.match must be "exact" or "analog"`);
      }
    }

    // oil
    if (isNum(c.default_oil_g_per_100g) && c.default_oil_g_per_100g > 0 && !c.recipe) {
      const b = c.oil_basis; const w = data.fndds?.[b?.with_oil?.food_code]; const wo = data.fndds?.[b?.without_oil?.food_code];
      if (!b || b.assumption !== true) P('oil-basis', `${at}: a default oil of ${c.default_oil_g_per_100g} g per 100 g must carry oil_basis with assumption: true`);
      else if (!w || !wo) P('oil-basis', `${at}: oil_basis must name FNDDS with-oil and no-added-fat foods that exist in the extract`);
      else if (!close(c.default_oil_g_per_100g, r2(w.nutrients.fat_g - wo.nutrients.fat_g), 0.006)) P('oil-basis', `${at}: default oil ${c.default_oil_g_per_100g} is not the FNDDS fat difference ${r2(w.nutrients.fat_g - wo.nutrients.fat_g)}`);
    }
  }

  // ---- sources
  const list = Array.isArray(sources?.sources) ? sources.sources : [];
  if (!list.length) P('sources-recorded', 'sources.json needs a non-empty sources array');
  const ids = new Set();
  for (const s of list) {
    const at = `source ${JSON.stringify(s?.id)}`;
    ids.add(s?.id);
    for (const k of ['id', 'name', 'version', 'url', 'retrieval_date', 'license', 'attribution']) if (!isStr(s?.[k])) P('sources-recorded', `${at}: ${k} is required`);
    if (isStr(s?.retrieval_date) && !/^\d{4}-\d{2}-\d{2}$/.test(s.retrieval_date)) P('sources-recorded', `${at}: retrieval_date must be YYYY-MM-DD`);
    if (!(s?.commercial_use === true || s?.commercial_use === 'with-citation')) P('commercial-use', `${at}: commercial_use must be true or "with-citation" (got ${JSON.stringify(s?.commercial_use)}); Macrofy is commercially usable only`);
    if (checkFiles) {
      const f = path.join(checkFiles, String(s?.bundled_file || ''));
      if (!isStr(s?.bundled_file) || !fs.existsSync(f)) P('sources-recorded', `${at}: bundled_file ${JSON.stringify(s?.bundled_file)} does not exist`);
      else if (crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') !== s.bundled_file_sha256) P('sources-recorded', `${at}: ${s.bundled_file} does not match bundled_file_sha256; regenerate with build_vocab.mjs`);
    }
  }
  for (const c of classes) if (!c.recipe && c.source?.db && !ids.has(c.source.db)) P('sources-recorded', `class ${c.id}: source db ${c.source.db} is not recorded in sources.json`);
  for (const c of classes) if (c.density_source?.db && !ids.has(c.density_source.db)) P('sources-recorded', `class ${c.id}: density source db ${c.density_source.db} is not recorded in sources.json`);
  if (oil?.source?.db && !ids.has(oil.source.db)) P('sources-recorded', `oil source db ${oil.source.db} is not recorded in sources.json`);
  return out;
}

// ---------------------------------------------------------------- fixtures (synthetic; never bundled or shipped)
const clone = (x) => JSON.parse(JSON.stringify(x));

function goodFixture() {
  const data = {
    taco: {
      1: { id: 1, descricao: 'FIXTURE rice, cooked', energia_kcal: 128, proteina_g: 2.5, lipideos_g: 0.2, carboidrato_g: 28.1, qualificadores: {} },
      2: { id: 2, descricao: 'FIXTURE tomato', energia_kcal: 21, proteina_g: 0.8, lipideos_g: null, carboidrato_g: 5.1, qualificadores: { lipideos_g: 'TRACO' } },
      4: { id: 4, descricao: 'FIXTURE beans, cooked', energia_kcal: 77, proteina_g: 4.5, lipideos_g: 0.5, carboidrato_g: 14, qualificadores: {} },
      3: { id: 3, descricao: 'FIXTURE soybean oil', energia_kcal: 884, proteina_g: null, lipideos_g: 100, carboidrato_g: null, qualificadores: { proteina_g: 'NAO_APLICAVEL', carboidrato_g: 'NAO_APLICAVEL' } },
    },
    fndds: {
      100: { food_code: '100', fdc_id: 1, description: 'FIXTURE rice, no added fat', nutrients: { kcal: 129, protein_g: 2.67, fat_g: 0.28, carbs_g: 27.99 }, portions: [{ portion_id: '7', seq_num: 1, description: '1 cup, cooked', gram_weight: 158 }] },
      101: { food_code: '101', fdc_id: 2, description: 'FIXTURE rice, made with oil', nutrients: { kcal: 151, protein_g: 2.6, fat_g: 3.12, carbs_g: 27.19 }, portions: [{ portion_id: '8', seq_num: 1, description: '1 cup, cooked', gram_weight: 163 }] },
      102: { food_code: '102', fdc_id: 3, description: 'FIXTURE tomatoes', nutrients: { kcal: 20, protein_g: 0.82, fat_g: 0.31, carbs_g: 4.04 }, portions: [{ portion_id: '9', seq_num: 1, description: '1 cup', gram_weight: 180 }] },
    },
  };
  const dens = (code, pid, portion, grams, match = 'exact') => ({ density_g_per_ml: Math.round(grams / 236.6 * 1e4) / 1e4, density_source: { db: 'FNDDS', food_code: code, fdc_id: 0, name: data.fndds[code].description, portion_id: Number(pid), portion, grams, ml: 236.6, match, kind: 'served' } });
  const vocab = {
    schema: SCHEMA_ID, version: '0-fixture', cup_ml: 236.6,
    oil: { id: 'fixture-oil', pt: 'óleo', en: 'oil', source: { db: 'TACO', id: 3, name: 'FIXTURE soybean oil' }, fat_g_per_g: 1, kcal_per_g: 9 },
    classes: [
      { id: 'fixture-rice', pt: 'arroz de teste', en: 'test rice', state: 'cooked', method: 'boiled', default_oil_g_per_100g: 2.84,
        oil_basis: { assumption: true, with_oil: { db: 'FNDDS', food_code: '101', fat_g: 3.12 }, without_oil: { db: 'FNDDS', food_code: '100', fat_g: 0.28 } },
        nutrients_per_100g: { kcal: 128, protein_g: 2.5, carbs_g: 28.1, fat_g: 0.2 }, source: { db: 'TACO', id: 1, name: 'FIXTURE rice, cooked' }, ...dens('100', 7, '1 cup, cooked', 158) },
      { id: 'fixture-tomato', pt: 'tomate de teste', en: 'test tomato', state: 'raw', method: 'raw', default_oil_g_per_100g: 0,
        nutrients_per_100g: { kcal: 21, protein_g: 0.8, carbs_g: 5.1, fat_g: 0 }, source: { db: 'TACO', id: 2, name: 'FIXTURE tomato' }, trace: [{ field: 'fat_g', taco_qualifier: 'TRACO' }], ...dens('102', 9, '1 cup', 180) },
      { id: 'fixture-mix', pt: 'mistura de teste', en: 'test mix', state: 'cooked', method: 'mixed', default_oil_g_per_100g: 1.42,
        recipe: { ingredients: [{ class: 'fixture-rice', grams: 50 }, { class: 'fixture-tomato', grams: 50 }], assumption: true },
        nutrients_per_100g: { kcal: 74.5, protein_g: 1.65, carbs_g: 16.6, fat_g: 0.1 }, ...dens('102', 9, '1 cup', 180, 'analog') },
      { id: 'fixture-beans', pt: 'feijão de teste', en: 'test beans', state: 'cooked', method: 'boiled', default_oil_g_per_100g: 0,
        nutrients_per_100g: { kcal: 77, protein_g: 4.5, carbs_g: 14, fat_g: 0.5 }, source: { db: 'TACO', id: 4, name: 'FIXTURE beans, cooked' }, ...dens('100', 7, '1 cup, cooked', 158) },
    ],
    missing: [{ id: 'fixture-missing', pt: 'ausente', taco_id: null, reason: 'fixture' }],
  };
  const sources = { schema: 'macrofy.sources/1', sources: [
    { id: 'TACO', name: 'FIXTURE TACO', version: '4', url: 'https://example.invalid/taco', retrieval_date: '2026-01-01', license: 'citation required', attribution: 'FIXTURE', commercial_use: 'with-citation' },
    { id: 'FNDDS', name: 'FIXTURE FNDDS', version: '1', url: 'https://example.invalid/fndds', retrieval_date: '2026-01-01', license: 'CC0', attribution: 'FIXTURE', commercial_use: true },
  ] };
  return { vocab, sources, data };
}

const NEGATIVES = [
  ['missing facet: state', 'facets', (f) => { delete f.vocab.classes[0].state; }],
  ['unknown method', 'facets', (f) => { f.vocab.classes[0].method = 'microwaved'; }],
  ['missing default oil facet', 'facets', (f) => { delete f.vocab.classes[1].default_oil_g_per_100g; }],
  ['unresolved source id', 'source-resolves', (f) => { f.vocab.classes[0].source.id = 999; }],
  ['nutrient typed differently from its source row', 'nutrients-match-source', (f) => { f.vocab.classes[3].nutrients_per_100g.protein_g = 7.5; }],
  ['kcal inconsistent with Atwater 4/4/9 by more than 25%', 'atwater', (f) => { f.data.taco[4].energia_kcal = 250; f.vocab.classes[3].nutrients_per_100g.kcal = 250; }],
  ['missing density', 'density', (f) => { delete f.vocab.classes[0].density_g_per_ml; }],
  ['density not derived from the FNDDS portion', 'density', (f) => { f.vocab.classes[0].density_g_per_ml = 0.9; }],
  ['density source portion does not exist', 'density', (f) => { f.vocab.classes[0].density_source.portion_id = 4242; }],
  ['density above any plausible food', 'density', (f) => { f.vocab.classes[0].density_g_per_ml = 2.4; }],
  ['non-commercial source bundled', 'commercial-use', (f) => { f.sources.sources[0].commercial_use = false; }],
  ['license not recorded', 'sources-recorded', (f) => { delete f.sources.sources[1].license; }],
  ['class source db not recorded in sources', 'sources-recorded', (f) => { f.sources.sources = f.sources.sources.filter(s => s.id !== 'TACO'); }],
  ['recipe cycle', 'recipes', (f) => { f.vocab.classes[2].recipe.ingredients[0].class = 'fixture-mix'; }],
  ['recipe with an unknown ingredient', 'recipes', (f) => { f.vocab.classes[2].recipe.ingredients[1].class = 'fixture-nothing'; }],
  ['recipe nutrients typed instead of computed', 'recipes', (f) => { f.vocab.classes[2].nutrients_per_100g.kcal = 90; }],
  ['default oil without a sourced basis', 'oil-basis', (f) => { delete f.vocab.classes[0].oil_basis; }],
  ['default oil that the FNDDS pair does not give', 'oil-basis', (f) => { f.vocab.classes[0].default_oil_g_per_100g = 5; }],
  ['duplicate class id', 'schema', (f) => { f.vocab.classes.push(clone(f.vocab.classes[3])); }],
  ['pt name collision', 'schema', (f) => { f.vocab.classes[3].pt = 'Arroz de teste!'; }],
  ['wrong schema id', 'schema', (f) => { f.vocab.schema = 'macrofy.vocab/0'; }],
];

function selftest() {
  const problems = [];
  const good = goodFixture(); const gp = validateVocab(good.vocab, good.sources, good.data);
  if (gp.length) problems.push(`known-good fixture must pass but failed: ${gp.slice(0, 3).map(p => `${p.rule}: ${p.msg}`).join(' | ')}`);
  const seen = new Set();
  for (const [name, rule, mutate] of NEGATIVES) {
    const f = goodFixture(); mutate(f);
    const p = validateVocab(f.vocab, f.sources, f.data);
    if (!p.some(x => x.rule === rule)) problems.push(`negative fixture "${name}" did not trip rule ${rule} (got: ${p.map(x => x.rule).join(', ') || 'no problems'})`);
    else seen.add(rule);
    const extra = p.filter(x => x.rule !== rule);
    if (extra.length) problems.push(`negative fixture "${name}" tripped unrelated rule(s): ${[...new Set(extra.map(x => x.rule))].join(', ')} (${extra[0].msg}); fixtures must isolate one rule`);
  }
  for (const r of RULES) if (!seen.has(r.id)) problems.push(`rule ${r.id} was never observed failing: add a negative fixture`);
  return { problems, fixtures: NEGATIVES.length };
}

// ---------------------------------------------------------------- lookup arithmetic (hand-computed)
function lookupTests(vocab) {
  const problems = []; const L = createLookup(vocab);
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`lookup: ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
  // TACO 4th ed. row 3, "Arroz, tipo 1, cozido": 128 kcal, 2.5 g protein, 28.1 g carbohydrate, 0.2 g lipids per 100 g
  eq('200 g rice, explicit oil_g 0', L.nutrientsFor({ label: 'arroz branco cozido', grams: 200, oil_g: 0 }), { kcal: 256, protein_g: 5, carbs_g: 56.2, fat_g: 0.4 });
  eq('label by id and en name resolve alike', L.nutrientsFor({ label: 'cooked white rice', grams: 200, oil_g: 0 }), L.nutrientsFor({ label: 'ARROZ-BRANCO-COZIDO', grams: 200, oil_g: 0 }));
  eq('10 g oil adds 90 kcal and 10 g fat', L.nutrientsFor({ label: 'arroz-branco-cozido', grams: 200, oil_g: 10 }), { kcal: 346, protein_g: 5, carbs_g: 56.2, fat_g: 10.4 });
  const c = L.findClass('arroz-branco-cozido'); const def = c.default_oil_g_per_100g * 2;
  eq('default oil applies when oil_g is omitted', L.nutrientsFor({ label: 'arroz-branco-cozido', grams: 200 }).fat_g, Math.round((0.4 + def) * 100) / 100);
  eq('zero grams', L.nutrientsFor({ label: 'arroz-branco-cozido', grams: 0 }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  eq('volume to mass: one cup of rice is the FNDDS 158 g', L.massFromVolume('arroz-branco-cozido', 236.6), 158);
  for (const [name, fn, E] of [
    ['unknown label throws', () => L.nutrientsFor({ label: 'unicorn stew', grams: 10 }), UnknownFoodError],
    ['raw state on a cooked class throws', () => L.nutrientsFor({ label: 'arroz-branco-cozido', grams: 10, state: 'raw' }), FacetMismatchError],
    ['negative grams throws', () => L.nutrientsFor({ label: 'arroz-branco-cozido', grams: -1 }), TypeError],
    ['negative oil_g throws', () => L.nutrientsFor({ label: 'arroz-branco-cozido', grams: 1, oil_g: -1 }), TypeError],
    ['negative ml throws', () => L.massFromVolume('arroz-branco-cozido', -5), TypeError],
  ]) { try { fn(); problems.push(`lookup: ${name}: did not throw`); } catch (e) { if (!(e instanceof E)) problems.push(`lookup: ${name}: threw ${e.name}, want ${E.name}`); } }
  eq('truthNutrients: unknown label is null (no truth), not a throw', L.truthNutrients({ label: 'unicorn stew', grams: 10 }), null);
  eq('truthNutrients: facet mismatch is null', L.truthNutrients({ label: 'arroz-branco-cozido', grams: 10, state: 'raw' }), null);
  eq('truthNutrients matches nutrientsFor', L.truthNutrients({ label: 'arroz-branco-cozido', grams: 200, state: 'cooked', method: 'boiled', oil_g: 0 }, {}), L.nutrientsFor({ label: 'arroz-branco-cozido', grams: 200, oil_g: 0 }));
  // every class resolves through every one of its names
  for (const k of vocab.classes) for (const n of [k.id, k.pt, k.en]) if (L.findClass(n)?.id !== k.id) problems.push(`lookup: ${n} does not resolve to ${k.id}`);
  return problems;
}

// ---------------------------------------------------------------- main
function main() {
  let failed = false; const fail = (m) => { failed = true; console.error(`  FAIL ${m}`); };
  const st = selftest();
  console.log(`selftest: 1 known-good + ${st.fixtures} negative fixtures over ${RULES.length} rules`);
  st.problems.forEach(fail);

  const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
  const vocab = read('vocab.json'); const sources = read('sources.json');
  const data = { taco: read('data/taco4_extract.json').foods, fndds: read('data/fndds_extract.json').foods };
  lookupTests(vocab).forEach(fail);
  console.log('lookup: hand-computed arithmetic, facet and error cases, name resolution for every class');

  const problems = validateVocab(vocab, sources, data, { checkFiles: HERE });
  problems.forEach(p => fail(`${p.rule}: ${p.msg}`));
  const cls = vocab.classes;
  console.log(`vocab.json: ${cls.length} classes, ${cls.filter(c => c.recipe).length} recipes, ${cls.filter(c => c.density_source?.match === 'analog').length} analog densities; `
    + `${sources.sources.length} sources: ${sources.sources.map(s => `${s.id} (${s.commercial_use === true ? 'commercial' : s.commercial_use})`).join(', ')}`);
  if (failed) { console.error('nutrition-map-validate: FAILED'); process.exit(1); }
  console.log('nutrition-map-validate: ok');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
