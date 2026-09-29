// Food vocabulary lookup (T-005): weighed grams -> nutrients, and volume -> grams. Node built-ins only.
// The numbers all come from vocab.json, which is generated from bundled TACO / FNDDS rows (see sources.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export class UnknownFoodError extends Error { constructor(label) { super(`unknown food label ${JSON.stringify(label)}: not an id, pt or en name in vocab.json`); this.name = 'UnknownFoodError'; } }
export class FacetMismatchError extends Error { constructor(msg) { super(msg); this.name = 'FacetMismatchError'; } }

/** Lower-case, accent-free, punctuation-free form used to match labels ("Feijão-preto cozido" == "feijao preto cozido"). */
export const normalize = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const r2 = (x) => Math.round(x * 100) / 100;
const isAmount = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Build the lookup functions over a vocab object (the real one below; fixtures in validate.mjs). */
export function createLookup(vocab) {
  const byName = new Map();
  for (const c of vocab.classes) for (const name of [c.id, c.pt, c.en]) { const k = normalize(name); if (!byName.has(k)) byName.set(k, c); }
  const oil = vocab.oil;

  /** The class whose id, pt or en name matches the label, or null. */
  const findClass = (label) => (typeof label === 'string' ? byName.get(normalize(label)) ?? null : null);
  const need = (label) => { const c = findClass(label); if (!c) throw new UnknownFoodError(label); return c; };

  /**
   * Nutrients of `grams` of a food: { kcal, protein_g, carbs_g, fat_g }.
   * The class row is per 100 g as eaten. Oil: `oil_g` (grams of cooking oil the item absorbed, when given, even 0)
   * is added on top; if omitted, the class default_oil_g_per_100g x grams / 100 is added. 1 g oil = 1 g fat = oil.kcal_per_g kcal.
   * state, when given, must equal the class state (a raw entry for a cooked food is a ~3x kcal error, so it throws).
   * method is accepted for interface symmetry with bench items but only state can contradict the numbers.
   */
  function nutrientsFor({ label, grams, state, method, oil_g } = {}) {
    void method;
    if (!isAmount(grams)) throw new TypeError(`grams must be a finite number >= 0 (got ${grams})`);
    if (oil_g !== undefined && !isAmount(oil_g)) throw new TypeError(`oil_g must be a finite number >= 0 when given (got ${oil_g})`);
    const c = need(label);
    if (state !== undefined && state !== c.state) throw new FacetMismatchError(`${c.id} is a "${c.state}" entry but the item says state "${state}"; use the matching class`);
    const oilG = oil_g !== undefined ? oil_g : c.default_oil_g_per_100g * grams / 100;
    const n = c.nutrients_per_100g; const f = grams / 100;
    return {
      kcal: r2(n.kcal * f + oilG * oil.kcal_per_g),
      protein_g: r2(n.protein_g * f),
      carbs_g: r2(n.carbs_g * f),
      fat_g: r2(n.fat_g * f + oilG * oil.fat_g_per_g),
    };
  }

  /** Grams of `ml` millilitres of the food (bulk density from FNDDS; see density_source.kind in vocab.json). */
  function massFromVolume(label, ml) {
    if (!isAmount(ml)) throw new TypeError(`ml must be a finite number >= 0 (got ${ml})`);
    return r2(ml * need(label).density_g_per_ml);
  }

  /** Adapter for eval/metrics.mjs evaluate({ truthNutrients }): (item, meal) -> nutrients, or null when the item cannot be mapped. */
  function truthNutrients(item) {
    try { return nutrientsFor(item); } catch (e) { if (e instanceof UnknownFoodError || e instanceof FacetMismatchError) return null; throw e; }
  }

  return { findClass, nutrientsFor, massFromVolume, truthNutrients, classes: () => vocab.classes.slice() };
}

export const VOCAB = JSON.parse(fs.readFileSync(path.join(HERE, 'vocab.json'), 'utf8'));
export const { findClass, nutrientsFor, massFromVolume, truthNutrients, classes } = createLookup(VOCAB);
