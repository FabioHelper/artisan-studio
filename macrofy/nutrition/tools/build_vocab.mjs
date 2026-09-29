// Generates nutrition/vocab.json (schema macrofy.vocab/1) from class_spec.mjs and the vendored extracts.
// Every nutrient and density number is COPIED or DERIVED here from a bundled source row; none is typed.
//   node nutrition/tools/build_vocab.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSES, OIL, MISSING, CUP_ML } from './class_spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NUT = path.join(HERE, '..');
const taco = JSON.parse(fs.readFileSync(path.join(NUT, 'data', 'taco4_extract.json'), 'utf8')).foods;
const fndds = JSON.parse(fs.readFileSync(path.join(NUT, 'data', 'fndds_extract.json'), 'utf8')).foods;
const r = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const USABLE_QUALIFIERS = new Set(['TRACO', 'NAO_APLICAVEL']);

// TACO field -> Macrofy nutrient name
const TACO_FIELDS = { kcal: 'energia_kcal', protein_g: 'proteina_g', carbs_g: 'carboidrato_g', fat_g: 'lipideos_g' };

function tacoNutrients(id) {
  const row = taco[id]; if (!row) throw new Error(`TACO ${id} missing from the extract`);
  const n = {}; const trace = [];
  for (const [k, f] of Object.entries(TACO_FIELDS)) {
    if (typeof row[f] === 'number') n[k] = row[f];
    else if (USABLE_QUALIFIERS.has(row.qualificadores?.[f])) { n[k] = 0; trace.push({ field: k, taco_qualifier: row.qualificadores[f] }); }
    else throw new Error(`TACO ${id} ${f} has no usable value (${row.qualificadores?.[f]})`);
  }
  return { n, trace, source: { db: 'TACO', id, name: row.descricao } };
}
function fnddsNutrients(code) {
  const row = fndds[code]; if (!row) throw new Error(`FNDDS ${code} missing from the extract`);
  const n = { kcal: row.nutrients.kcal, protein_g: row.nutrients.protein_g, carbs_g: row.nutrients.carbs_g, fat_g: row.nutrients.fat_g };
  return { n, trace: [], source: { db: 'FNDDS', id: code, name: row.description } };
}
function density(d) {
  const f = fndds[d.code]; if (!f) throw new Error(`FNDDS ${d.code} missing`);
  const p = f.portions.find(x => x.description === d.portion);
  if (!p) throw new Error(`FNDDS ${d.code} has no portion "${d.portion}" (has: ${f.portions.map(x => x.description).join(' | ')})`);
  // 'pieces': a cup of loose pieces (chopped, diced, sliced, shredded); the value is a packing density and is
  // LOWER than the density of a solid piece of the same food. 'served': grains, pulses, mashed foods, stews and
  // sauces measured as served, where the cup value is the bulk density of the food itself.
  // FNDDS food codes start with the food group: 14 cheese, 2 meat/poultry/fish (27 = mixed dishes), 25 cold cuts,
  // 3 eggs, 6 fruit, 72/73/75 vegetables, 7110-7140 potatoes.
  const solid = /^(14|2[1-6]|3[1-3]|6[1-4]|7[2-5]|711|714|719)/.test(d.code) || /diced|sliced|chopped|cubed|shredded|crumbled|pieces|NFS/.test(d.portion);
  const kind = /mashed/.test(d.portion) || /^7150/.test(d.code) ? 'served' : solid ? 'pieces' : 'served';
  return {
    density_g_per_ml: r(p.gram_weight / CUP_ML, 4),
    density_source: { db: 'FNDDS', food_code: d.code, fdc_id: f.fdc_id, name: f.description, portion_id: Number(p.portion_id), portion: p.description, grams: p.gram_weight, ml: CUP_ML, match: d.match, kind },
  };
}

const classes = []; const byId = new Map();
for (const c of CLASSES) {
  const out = { id: c.id, pt: c.pt, en: c.en, state: c.state, method: c.method };
  let oil = 0; let oilBasis;
  if (c.oil) {
    const w = fndds[c.oil.with], wo = fndds[c.oil.without];
    if (!w || !wo) throw new Error(`${c.id}: FNDDS oil pair missing`);
    oil = r(w.nutrients.fat_g - wo.nutrients.fat_g, 2);
    oilBasis = { assumption: true, rule: 'fat added by cooking with oil = fat(FNDDS made with oil) - fat(FNDDS no added fat), g per 100 g of the cooked food',
      with_oil: { db: 'FNDDS', food_code: c.oil.with, name: w.description, fat_g: w.nutrients.fat_g }, without_oil: { db: 'FNDDS', food_code: c.oil.without, name: wo.description, fat_g: wo.nutrients.fat_g }, why: c.oil.why };
  }
  out.default_oil_g_per_100g = oil;
  if (oilBasis) out.oil_basis = oilBasis;
  else if (c.method === 'fried') out.oil_note = 'the source row is a fried or sauteed preparation: its fat already includes the cooking oil';

  if (c.recipe) {
    const total = c.recipe.ingredients.reduce((s, i) => s + i.grams, 0);
    const n = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    for (const i of c.recipe.ingredients) {
      const ing = byId.get(i.class); if (!ing) throw new Error(`${c.id}: ingredient ${i.class} must be defined before the recipe`);
      for (const k of Object.keys(n)) n[k] += ing.nutrients_per_100g[k] * i.grams / total;
    }
    for (const k of Object.keys(n)) n[k] = r(n[k], 2);
    out.nutrients_per_100g = n;
    out.recipe = { ingredients: c.recipe.ingredients.map(i => ({ class: i.class, grams: i.grams })), assumption: true, note: c.recipe.note };
  } else {
    const t = c.nutrients.db === 'TACO' ? tacoNutrients(c.nutrients.id) : fnddsNutrients(c.nutrients.code);
    out.nutrients_per_100g = t.n; out.source = t.source;
    if (t.trace.length) out.trace = t.trace;
  }
  Object.assign(out, density(c.density));
  classes.push(out); byId.set(c.id, out);
}

const oilRow = tacoNutrients(OIL.taco_id);
const vocab = {
  schema: 'macrofy.vocab/1',
  version: '0.1.0',
  note: 'Generated by nutrition/tools/build_vocab.mjs from nutrition/tools/class_spec.mjs and the extracts in nutrition/data; do not edit by hand. Nutrients per 100 g as eaten; density in g per mL = FNDDS portion grams / cup_ml.',
  cup_ml: CUP_ML,
  oil: { id: OIL.id, pt: OIL.pt, en: OIL.en, source: oilRow.source, fat_g_per_g: r(oilRow.n.fat_g / 100, 4), kcal_per_g: 9,
    note: 'oil_g adds oil_g grams of fat and 9 kcal per gram (Atwater); the TACO row lists 884 kcal per 100 g, 1.8% lower' },
  classes,
  missing: MISSING,
};
fs.writeFileSync(path.join(NUT, 'vocab.json'), JSON.stringify(vocab, null, 1) + '\n');

// ---------------------------------------------------------------- sources.json (from the extracts' _meta)
const meta = (f) => JSON.parse(fs.readFileSync(path.join(NUT, 'data', f), 'utf8'))._meta;
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(NUT, 'data', f))).digest('hex');
const tm = meta('taco4_extract.json'), fm = meta('fndds_extract.json');
const sources = {
  schema: 'macrofy.sources/1',
  note: 'Every bundled data source. Macrofy is commercially usable only: commercial_use must be true or "with-citation" for each. Generated by nutrition/tools/build_vocab.mjs from the _meta block of each extract.',
  sources: [
    { id: 'TACO', name: tm.name, version: '4th edition, revised and expanded, 2011', url: tm.origin_url, retrieval_date: tm.retrieval_date,
      license: tm.license, commercial_use: 'with-citation',
      attribution: tm.citation,
      license_verification: 'The permission text is the sentence printed in the TACO document, carried in the metadata of the JSON copy and repeated by the NEPA-UNICAMP page (per the project research notes); nepa.unicamp.br is unreachable from the build sandbox, so the page was not read first-hand.',
      obtained_via: tm.machine_readable_copy.url, cross_checked_against: tm.cross_check.url,
      bundled_file: 'data/taco4_extract.json', bundled_file_sha256: sha('taco4_extract.json'), rows_bundled: tm.rows_bundled },
    { id: 'FNDDS', name: fm.name, version: 'FNDDS 2019-2020, FoodData Central release 2022-10-28', url: fm.origin_url, retrieval_date: fm.retrieval_date,
      license: fm.license, commercial_use: true,
      attribution: fm.citation + ' (CC0 1.0: attribution is not required; given here as a courtesy.)',
      license_verification: 'CC0 status is as stated by the FoodData Central API guide, quoted in the project research notes; fdc.nal.usda.gov is unreachable from the build sandbox, so the page was not read first-hand. The data itself is a verbatim copy of the FDC CSV tables.',
      obtained_via: fm.machine_readable_copy.files['food.csv'].url.replace(/food\.csv$/, ''), obtained_via_commit: fm.machine_readable_copy.commit,
      bundled_file: 'data/fndds_extract.json', bundled_file_sha256: sha('fndds_extract.json'), rows_bundled: fm.rows_bundled },
  ],
};
fs.writeFileSync(path.join(NUT, 'sources.json'), JSON.stringify(sources, null, 1) + '\n');
const a = classes.filter(c => c.density_source.match === 'analog').length;
console.log(`vocab.json: ${classes.length} classes (${classes.filter(c => c.recipe).length} recipes), ${a} analog densities, ${classes.filter(c => c.oil_basis).length} with sourced default oil, ${MISSING.length} missing`);
