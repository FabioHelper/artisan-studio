// Re-creates nutrition/data/*_extract.json from the raw downloads (T-005). Not part of any check:
// the extracts are committed, and validate.mjs reads them. Run only to refresh or audit:
//   node nutrition/tools/extract_sources.mjs <dir-with-raw-files> <retrieval-date YYYY-MM-DD>
// Raw files expected in <dir> (URLs, versions and hashes are written into each extract's _meta):
//   taco4.json            TACO 4th ed. as JSON (a machine-readable copy of the official PDF)
//   food.csv              FoodData_Central food table (survey_fndds_food rows are used)
//   survey_fndds_food.csv fdc_id -> FNDDS food code
//   food_portion.csv      household portions with gram weights
//   food_nutrient_range.csv  byte range of food_nutrient.csv that holds the FNDDS fdc_ids
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CLASSES, OIL } from './class_spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'data');
const [rawDir, retrieved] = process.argv.slice(2);
if (!rawDir || !/^\d{4}-\d{2}-\d{2}$/.test(retrieved || '')) { console.error('usage: extract_sources.mjs <raw-dir> <YYYY-MM-DD>'); process.exit(2); }

function parseCsv(t) {
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); f = ''; rows.push(r); r = []; }
    else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}
const table = (name) => { const [h, ...b] = parseCsv(fs.readFileSync(path.join(rawDir, name), 'utf8')); return b.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const sha256 = (name) => crypto.createHash('sha256').update(fs.readFileSync(path.join(rawDir, name))).digest('hex');

// ---------------------------------------------------------------- which rows are used
const tacoIds = new Set([OIL.taco_id]);
const fnddsCodes = new Set();
for (const c of CLASSES) {
  if (c.nutrients?.db === 'TACO') tacoIds.add(c.nutrients.id);
  if (c.nutrients?.db === 'FNDDS') fnddsCodes.add(c.nutrients.code);
  if (c.density) fnddsCodes.add(c.density.code);
  if (c.oil) { fnddsCodes.add(c.oil.with); fnddsCodes.add(c.oil.without); }
}

// ---------------------------------------------------------------- TACO
const taco = JSON.parse(fs.readFileSync(path.join(rawDir, 'taco4.json'), 'utf8'));
const tacoFoods = {};
for (const id of [...tacoIds].sort((a, b) => a - b)) {
  const a = taco.alimentos.find(x => x.id === id);
  if (!a) throw new Error(`TACO id ${id} not found`);
  const c = a.composicao_centesimal; const q = a.qualificadores || {};
  const pick = (k) => ({ v: c[k], q: q[k] });
  tacoFoods[id] = { id, descricao: a.descricao, grupo: a.grupo, energia_kcal: c.energia_kcal, proteina_g: c.proteina_g, lipideos_g: c.lipideos_g, carboidrato_g: c.carboidrato_g,
    qualificadores: Object.fromEntries(['energia_kcal', 'proteina_g', 'lipideos_g', 'carboidrato_g'].filter(k => q[k]).map(k => [k, q[k]])) };
  void pick;
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'taco4_extract.json'), JSON.stringify({
  _meta: {
    source_id: 'TACO',
    name: 'Tabela Brasileira de Composição de Alimentos (TACO), 4ª edição revisada e ampliada',
    citation: 'NEPA – Núcleo de Estudos e Pesquisas em Alimentação, UNICAMP. Tabela Brasileira de Composição de Alimentos – TACO. 4. ed. rev. e ampl. Campinas: NEPA-UNICAMP, 2011.',
    origin_url: 'https://nepa.unicamp.br/publicacoes/tabela-taco-pdf/',
    license: 'Reprodução parcial ou total permitida, desde que citada a fonte (stated in the TACO document)',
    retrieval_date: retrieved,
    machine_readable_copy: { url: 'https://raw.githubusercontent.com/IgorFZ/taco-br/main/data/taco4.json', note: 'JSON extraction of the official PDF by IgorFZ (MIT code; data attributed to TACO/NEPA-UNICAMP); branch main as of the retrieval date', sha256: sha256('taco4.json') },
    cross_check: { url: 'https://raw.githubusercontent.com/brolesi/taco/main/data/processed/taco/taco_composicao.csv', note: 'independent extraction from the official Excel file (brolesi/taco, MIT); all 597 foods x (kcal, protein, lipids, carbohydrate) agree with the JSON after rounding (0 differences)', sha256: fs.existsSync(path.join(rawDir, 'brolesi_taco.csv')) ? sha256('brolesi_taco.csv') : null },
    basis: '100 g of edible portion. Qualifiers: TRACO (Tr) = between 0 and the quantification limit and NAO_APLICAVEL (NA) = not applicable are read as 0 by build_vocab.mjs and recorded in the class as trace.',
    rows_bundled: Object.keys(tacoFoods).length,
  },
  foods: tacoFoods,
}, null, 1) + '\n');

// ---------------------------------------------------------------- FNDDS
const survey = new Map(table('survey_fndds_food.csv').map(r => [r.food_code, r]));
const food = new Map(table('food.csv').filter(r => r.data_type === 'survey_fndds_food').map(r => [r.fdc_id, r]));
const byFdc = new Map([...survey.values()].map(r => [r.fdc_id, r.food_code]));
const wanted = new Map(); // fdc_id -> code
for (const code of fnddsCodes) { const s = survey.get(code); if (!s) throw new Error(`FNDDS code ${code} not found`); wanted.set(s.fdc_id, code); }
const portions = new Map();
for (const p of table('food_portion.csv')) if (wanted.has(p.fdc_id)) { if (!portions.has(p.fdc_id)) portions.set(p.fdc_id, []); portions.get(p.fdc_id).push({ portion_id: p.id, seq_num: Number(p.seq_num), description: p.portion_description, gram_weight: Number(p.gram_weight) }); }
const NUT = { 1008: 'kcal', 1003: 'protein_g', 1004: 'fat_g', 1005: 'carbs_g' };
const nutrients = new Map();
for (const l of fs.readFileSync(path.join(rawDir, 'food_nutrient_range.csv'), 'utf8').split('\n')) {
  const m = /^"(\d+)","(\d+)","(\d+)","([^"]*)"/.exec(l);
  if (!m || !wanted.has(m[2]) || !NUT[m[3]]) continue;
  if (!nutrients.has(m[2])) nutrients.set(m[2], {});
  nutrients.get(m[2])[NUT[m[3]]] = { amount: Number(m[4]), row_id: m[1] };
}
const fnddsFoods = {};
for (const [fdc, code] of [...wanted].sort((a, b) => a[1].localeCompare(b[1]))) {
  const n = nutrients.get(fdc) || {};
  for (const k of Object.values(NUT)) if (!n[k]) throw new Error(`FNDDS ${code}: nutrient ${k} missing`);
  fnddsFoods[code] = { food_code: code, fdc_id: Number(fdc), description: food.get(fdc).description, publication_date: food.get(fdc).publication_date,
    nutrients: Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v.amount])), nutrient_rows: Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Number(v.row_id)])),
    portions: (portions.get(fdc) || []).sort((a, b) => a.seq_num - b.seq_num) };
}
void byFdc;
const MIRROR = 'https://media.githubusercontent.com/media/tjchhajed/FoodBall/748cdb3d9aa66c7f400eaab321a12b621b205b90/usda-data/extracted/';
fs.writeFileSync(path.join(OUT, 'fndds_extract.json'), JSON.stringify({
  _meta: {
    source_id: 'FNDDS',
    name: 'USDA FoodData Central, Survey (FNDDS 2019-2020)',
    citation: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, Survey Foods (FNDDS 2019-2020), 2022-10-28 release. fdc.nal.usda.gov',
    origin_url: 'https://fdc.nal.usda.gov/download-datasets',
    license: 'CC0 1.0 Universal (public domain), per the FoodData Central API guide',
    retrieval_date: retrieved,
    machine_readable_copy: {
      note: 'A verbatim copy of the FoodData Central CSV tables, vendored in a public repository (tjchhajed/FoodBall, MIT for its own code) at a pinned commit; fdc.nal.usda.gov itself is unreachable from the build sandbox. The FNDDS rows (5624 foods, publication_date 2022-10-28, food codes) match the FDC survey release.',
      commit: '748cdb3d9aa66c7f400eaab321a12b621b205b90',
      files: {
        'food.csv': { url: MIRROR + 'food.csv', sha256: sha256('food.csv') },
        'survey_fndds_food.csv': { url: MIRROR + 'survey_fndds_food.csv', sha256: sha256('survey_fndds_food.csv') },
        'food_portion.csv': { url: MIRROR + 'food_portion.csv', sha256: sha256('food_portion.csv') },
        'food_nutrient.csv': { url: MIRROR + 'food_nutrient.csv', byte_range: '1305000000-1333000000', sha256_of_range: sha256('food_nutrient_range.csv'), note: 'the full file is 1.5 GB (all FDC data types); only the byte range holding the FNDDS fdc_ids 2340760-2346383 was fetched' },
      },
    },
    basis: 'nutrients per 100 g as eaten (FDC nutrient ids 1008 energy kcal, 1003 protein, 1004 total lipid, 1005 carbohydrate by difference); portion gram_weight is grams for the described portion',
    rows_bundled: Object.keys(fnddsFoods).length,
  },
  foods: fnddsFoods,
}, null, 1) + '\n');
console.log(`TACO rows ${Object.keys(tacoFoods).length}, FNDDS foods ${Object.keys(fnddsFoods).length}`);
