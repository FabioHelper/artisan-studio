// Fixtures for the benchmark validator: one known-good manifest, plus broken and edge variants.
// Each case names the rule it must trip (`rule`) or must NOT trip (`pass: true`). Reused by validate.mjs.
import { createHash } from 'node:crypto';
import { SCHEMA_ID, testSetHash, testMeals } from './schema.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
/** Flip k bits of a 16-hex phash, giving a hash at Hamming distance exactly k. */
export const flipBits = (hex, k) => {
  const n = [...hex].map(c => parseInt(c, 16));
  for (let i = 0; i < k; i++) n[Math.floor(i / 4)] ^= 1 << (i % 4);
  return n.map(x => x.toString(16)).join('');
};

function meal(id, captured_at, split, plate_id, items, extra = {}) {
  const shot = (tag, angle_deg, distance_cm, lighting) => ({ sha256: sha(`photo:${id}:${tag}`), phash: sha(`phash:${id}:${tag}`).slice(0, 16), angle_deg, distance_cm, lighting });
  return {
    id, captured_at, split, plate_id,
    photos: [shot('top', 90, 40, 'daylight'), shot('diag', 45, 35, 'daylight'), shot('hand', 30, 30, 'warm')],
    items, ...extra,
  };
}

/** Fresh known-good manifest: meals[0..1] calibration (Sep 1-2), meals[2..3] test (Sep 8-9). */
export function goodManifest() {
  return {
    schema: SCHEMA_ID,
    scale: { model: 'Fixture Kitchen Scale', resolution_g: 1 },
    plates: [{ id: 'p1', diameter_mm: 260, kind: 'plate' }, { id: 'p2', diameter_mm: 180, depth_mm: 55, kind: 'bowl' }],
    meals: [
      meal('c1', '2026-09-01T12:30:00-03:00', 'calibration', 'p1', [
        { id: 'i1', label: 'arroz branco', grams: 180, state: 'cooked', method: 'boiled' },
        { id: 'i2', label: 'feijao carioca', grams: 120, state: 'cooked', method: 'boiled' },
        { id: 'i3', label: 'frango', grams: 110, state: 'cooked', method: 'pan-fried', oil_g: 6.5 },
      ], { leftovers_g: 20 }),
      meal('c2', '2026-09-02T19:45:00-03:00', 'calibration', 'p2', [
        { id: 'i1', label: 'banana', grams: 95, state: 'raw', method: 'raw' },
        { id: 'i2', label: 'aveia', grams: 40, state: 'cooked', method: 'boiled' },
      ]),
      meal('t1', '2026-09-08T12:10:00-03:00', 'test', 'p1', [
        { id: 'i1', label: 'macarrao', grams: 210, state: 'cooked', method: 'boiled' },
        { id: 'i2', label: 'carne moida', grams: 90, state: 'cooked', method: 'pan-fried', oil_g: 4 },
      ]),
      meal('t2', '2026-09-09T20:05:00-03:00', 'test', 'p2', [
        { id: 'i1', label: 'omelete', grams: 130, state: 'cooked', method: 'pan-fried', oil_g: 5 },
      ], { notes: 'no salt' }),
    ],
  };
}

export const lockFor = (m) => ({ sha256: testSetHash(m), meals: testMeals(m).length, locked_at: '2026-01-01T00:00:00.000Z' });

const [C1, C2, T1, T2] = [0, 1, 2, 3];
const fail = (rule, name, fn, opts = {}) => ({ rule, name, fn, opts });
const pass = (name, fn, opts = {}) => ({ pass: true, name, fn, opts });
const isoWithoutOffset = '2026-09-01T12:30:00';

// fn(m) mutates the fresh good manifest; returning a value replaces the manifest itself.
export const CASES = [
  pass('the known-good manifest', () => {}),
  pass('the known-good manifest with a lock', () => {}, { lock: true }),
  pass('complete enough: 4 meals over more than one week', () => {}, { requireMeals: 4, minWeeks: 1 }),

  // schema-types
  fail('schema-types', 'manifest is null', () => null),
  fail('schema-types', 'wrong schema id', m => { m.schema = 'macrofy.bench/2'; }),
  fail('schema-types', 'meals is not an array', m => { m.meals = {}; }),
  fail('schema-types', 'missing scale', m => { delete m.scale; }),
  fail('schema-types', 'unknown field on a meal (typo guard)', m => { m.meals[C1].weight_g = 3; }),
  fail('schema-types', 'captured_at is not ISO', m => { m.meals[C1].captured_at = '01/09/2026 12:30'; }),
  fail('schema-types', 'captured_at is an impossible date', m => { m.meals[C1].captured_at = '2026-02-30T12:30:00-03:00'; }),
  fail('schema-types', 'captured_at has no UTC offset', m => { m.meals[C1].captured_at = isoWithoutOffset; }),
  fail('schema-types', 'grams is a string ("150g")', m => { m.meals[C1].items[0].grams = '150g'; }),
  fail('schema-types', 'oil_g is a string', m => { m.meals[C1].items[2].oil_g = 'a little'; }),
  fail('schema-types', 'photo sha256 has the wrong length', m => { m.meals[C1].photos[0].sha256 = 'abc123'; }),
  fail('schema-types', 'photo phash is not 16 hex chars', m => { m.meals[C1].photos[0].phash = 'abcdef012345678'; }),
  fail('schema-types', 'unknown lighting', m => { m.meals[C1].photos[0].lighting = 'sunny'; }),
  fail('schema-types', 'angle above 90 degrees', m => { m.meals[C1].photos[0].angle_deg = 120; }),
  fail('schema-types', 'unknown split', m => { m.meals[C1].split = 'validation'; }),
  fail('schema-types', 'unknown item state', m => { m.meals[C1].items[0].state = 'fried'; }),
  fail('schema-types', 'unknown plate kind', m => { m.plates[0].kind = 'tray'; }),
  fail('schema-types', 'scale resolution is zero', m => { m.scale.resolution_g = 0; }),
  fail('schema-types', 'meal without photos', m => { m.meals[C1].photos = []; }),
  fail('schema-types', 'meal without items', m => { m.meals[C1].items = []; }),

  // unique-ids
  fail('unique-ids', 'duplicate meal id', m => { m.meals[C2].id = 'c1'; }),
  fail('unique-ids', 'duplicate item id within a meal', m => { m.meals[C1].items[1].id = 'i1'; }),
  fail('unique-ids', 'duplicate plate id', m => { m.plates.push({ ...m.plates[0] }); }),
  pass('the same item id in different meals is fine (good fixture reuses i1)', () => {}),

  // unique-photos
  fail('unique-photos', 'same photo in two meals', m => { m.meals[C2].photos[0].sha256 = m.meals[C1].photos[0].sha256; }),
  fail('unique-photos', 'same photo twice in one meal', m => { m.meals[C1].photos[1].sha256 = m.meals[C1].photos[0].sha256; }),

  // plate-ref
  fail('plate-ref', 'plate_id is not registered', m => { m.meals[C1].plate_id = 'ghost'; }),

  // plausible-grams
  fail('plausible-grams', 'item grams is zero', m => { m.meals[C1].items[0].grams = 0; }),
  fail('plausible-grams', 'item grams is negative', m => { m.meals[C1].items[0].grams = -5; }),
  fail('plausible-grams', 'item grams above 3000 (kg typed as g)', m => { m.meals[C1].items[0].grams = 3001; }),
  fail('plausible-grams', 'oil_g is negative', m => { m.meals[C1].items[2].oil_g = -1; }),
  fail('plausible-grams', 'leftovers_g is negative', m => { m.meals[C1].leftovers_g = -20; }),
  pass('item grams exactly 3000 is allowed', m => { m.meals[C1].items[0].grams = 3000; }),

  // split-by-date
  fail('split-by-date', 'test meal on the same date as a calibration meal', m => { m.meals[T1].captured_at = '2026-09-01T18:00:00-03:00'; }),
  fail('split-by-date', 'same date at opposite ends of the day', m => { m.meals[C1].captured_at = '2026-09-05T00:10:00-03:00'; m.meals[T1].captured_at = '2026-09-05T23:50:00-03:00'; }),
  pass('adjacent dates in different splits are allowed', m => { m.meals[C1].captured_at = '2026-09-05T23:59:00-03:00'; m.meals[T1].captured_at = '2026-09-06T00:01:00-03:00'; }),
  pass('two calibration meals on one date are allowed', m => { m.meals[C2].captured_at = '2026-09-01T20:00:00-03:00'; }),

  // near-duplicate-leakage
  fail('near-duplicate-leakage', 'identical phash across splits (a retake)', m => { m.meals[T1].photos[0].phash = m.meals[C1].photos[0].phash; }),
  fail('near-duplicate-leakage', 'phash distance 1 across splits', m => { m.meals[T1].photos[0].phash = flipBits(m.meals[C1].photos[0].phash, 1); }),
  fail('near-duplicate-leakage', 'phash distance exactly 6 across splits', m => { m.meals[T1].photos[0].phash = flipBits(m.meals[C1].photos[0].phash, 6); }),
  pass('phash distance 7 across splits is allowed', m => { m.meals[T1].photos[0].phash = flipBits(m.meals[C1].photos[0].phash, 7); }),
  pass('near-duplicates inside one split are allowed', m => { m.meals[C2].photos[0].phash = flipBits(m.meals[C1].photos[0].phash, 1); }),

  // frozen-test-set (each case runs with a lock made from the untouched good manifest)
  fail('frozen-test-set', 'test item grams edited after the lock', m => { m.meals[T1].items[0].grams += 10; }, { lock: true }),
  fail('frozen-test-set', 'test meal removed after the lock', m => { m.meals.splice(T2, 1); }, { lock: true }),
  fail('frozen-test-set', 'calibration meal promoted into the test split', m => { m.meals[C2].split = 'test'; }, { lock: true }),
  fail('frozen-test-set', 'test photo replaced', m => { m.meals[T1].photos[0].sha256 = sha('another photo'); }, { lock: true }),
  fail('frozen-test-set', 'test notes edited', m => { m.meals[T2].notes = 'edited'; }, { lock: true }),
  fail('frozen-test-set', 'malformed lock', () => {}, { lock: { sha256: 'nothex', meals: 2, locked_at: 'x' } }),
  pass('calibration meals may still change after the lock', m => { m.meals[C1].items[0].grams += 5; }, { lock: true }),
  pass('meal order does not matter to the lock', m => { m.meals.reverse(); }, { lock: true }),
  pass('key order does not matter to the lock', m => { m.meals[T1] = Object.fromEntries(Object.entries(m.meals[T1]).reverse()); }, { lock: true }),

  // completeness (only when required)
  fail('completeness', 'fewer meals than required', () => {}, { requireMeals: 5 }),
  fail('completeness', 'captured over too few weeks', () => {}, { minWeeks: 2 }),
  fail('completeness', 'no meals at all', m => { m.meals = []; }, { requireMeals: 1, minWeeks: 1 }),
  pass('an incomplete manifest is fine when completeness is not required', m => { m.meals.pop(); }),
];
