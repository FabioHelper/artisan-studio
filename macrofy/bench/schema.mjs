// Benchmark manifest format (schema id macrofy.bench/1) and its pure validator. Node built-ins only.
// Photos are never in git: a manifest references each by sha256 and a 64-bit perceptual hash.
import { createHash } from 'node:crypto';

export const SCHEMA_ID = 'macrofy.bench/1';
export const HAMMING_LIMIT = 6; // photos in different splits this close (or closer) count as the same shot
export const MAX_ITEM_G = 3000;
const WEEK_MS = 7 * 24 * 3600 * 1000;

export const RULES = [
  { id: 'schema-types', title: 'fields exist with the right types, formats and enum values; no unknown fields' },
  { id: 'unique-ids', title: 'plate ids and meal ids unique; item ids unique within a meal' },
  { id: 'unique-photos', title: 'every photo sha256 appears once in the whole manifest' },
  { id: 'plate-ref', title: 'every meal plate_id names a registered plate' },
  { id: 'plausible-grams', title: 'item grams > 0 and <= 3000; oil_g and leftovers_g >= 0' },
  { id: 'split-by-date', title: 'no calendar date (as written in captured_at) has meals in both splits' },
  { id: 'near-duplicate-leakage', title: 'no photos in different splits within phash Hamming distance 6' },
  { id: 'frozen-test-set', title: 'canonical hash of the test meals equals the lock (when a lock is given)' },
  { id: 'completeness', title: 'enough meals over enough weeks (only when required)' },
];

// ---------------------------------------------------------------- hashing
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** The test meals, sorted by id: exactly what the lock freezes. */
export function testMeals(manifest) {
  return arr(manifest?.meals).filter(m => isObj(m) && m.split === 'test').sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
}
export const testSetHash = (manifest) => sha(canonicalJson(testMeals(manifest)));

const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
/** Hamming distance between two 16-hex-char perceptual hashes. */
export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < 16; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

// ---------------------------------------------------------------- field checks
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** ISO datetime with a UTC offset -> { date: 'YYYY-MM-DD' as written, ms } or null. */
export function parseCapture(s) {
  const m = typeof s === 'string' ? ISO.exec(s) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi, se = '0', tz] = m;
  const day = new Date(Date.UTC(+y, +mo - 1, +d));
  if (day.getUTCFullYear() !== +y || day.getUTCMonth() !== +mo - 1 || day.getUTCDate() !== +d) return null;
  if (+h > 23 || +mi > 59 || +se > 59) return null;
  if (tz !== 'Z' && (+tz.slice(1, 3) > 14 || +tz.slice(4) > 59)) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : { date: `${y}-${mo}-${d}`, ms };
}

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPos = (v) => isNum(v) && v > 0;
const isHex = (n) => (v) => typeof v === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(v);
const oneOf = (...xs) => (v) => xs.includes(v);
const show = (v) => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 40 ? `${s.slice(0, 37)}...` : s; };

// field -> [test, human description, optional?]
const SPECS = {
  root: { schema: [v => v === SCHEMA_ID, `the string "${SCHEMA_ID}"`], scale: [isObj, 'an object'], plates: [Array.isArray, 'an array'], meals: [Array.isArray, 'an array'] },
  scale: { model: [isStr, 'a non-empty string, e.g. "Brand Model"'], resolution_g: [isPos, 'a positive number of grams, e.g. 1'] },
  plate: { id: [isStr, 'a non-empty string'], diameter_mm: [isPos, 'a positive number of millimetres'], depth_mm: [isPos, 'a positive number of millimetres', true], kind: [oneOf('plate', 'bowl'), '"plate" or "bowl"'] },
  meal: { id: [isStr, 'a non-empty string'], captured_at: [v => parseCapture(v) !== null, 'a real ISO datetime with UTC offset, e.g. 2026-10-03T19:42:00-03:00'], split: [oneOf('calibration', 'test'), '"calibration" or "test"'], plate_id: [isStr, 'the id of a registered plate'], photos: [v => Array.isArray(v) && v.length > 0, 'a non-empty array'], items: [v => Array.isArray(v) && v.length > 0, 'a non-empty array'], leftovers_g: [isNum, 'a number of grams', true], notes: [v => typeof v === 'string', 'a string', true] },
  photo: { sha256: [isHex(64), '64 lowercase hex characters'], phash: [isHex(16), '16 lowercase hex characters (64-bit perceptual hash)'], angle_deg: [v => isNum(v) && v >= 0 && v <= 90, 'degrees above the horizontal, 0 to 90 (90 = overhead)'], distance_cm: [isPos, 'a positive number of centimetres', true], lighting: [oneOf('daylight', 'warm', 'dim', 'flash'), '"daylight", "warm", "dim" or "flash"'] },
  item: { id: [isStr, 'a non-empty string'], label: [isStr, 'a non-empty food name'], grams: [isNum, 'a number of grams (net, no plate)'], state: [oneOf('raw', 'cooked'), '"raw" or "cooked"'], method: [isStr, 'a non-empty string, e.g. "boiled", "pan-fried", "raw"'], oil_g: [isNum, 'a number of grams', true] },
};

function checkObject(o, path, kind, T) {
  if (!isObj(o)) { T(`${path} must be an object (got ${show(o)})`, `Replace it with an object with fields: ${Object.keys(SPECS[kind]).join(', ')}.`); return; }
  const spec = SPECS[kind];
  for (const k of Object.keys(o)) if (!(k in spec)) T(`${path}.${k} is not a known field`, `Remove it or fix the spelling (known: ${Object.keys(spec).join(', ')}).`);
  for (const [k, [test, expect, optional]] of Object.entries(spec)) {
    if (o[k] === undefined) { if (!optional) T(`${path}.${k} is missing`, `Add ${k}: ${expect}.`); continue; }
    if (!test(o[k])) T(`${path}.${k} must be ${expect} (got ${show(o[k])})`, `Set ${k} to ${expect}.`);
  }
}

function checkTypes(m, T) {
  checkObject(m, 'manifest', 'root', T);
  if (!isObj(m)) return;
  if (isObj(m.scale)) checkObject(m.scale, 'scale', 'scale', T);
  arr(m.plates).forEach((p, i) => checkObject(p, `plates[${i}]`, 'plate', T));
  arr(m.meals).forEach((meal, i) => {
    const at = `meals[${i}]`;
    checkObject(meal, at, 'meal', T);
    if (!isObj(meal)) return;
    arr(meal.photos).forEach((p, j) => checkObject(p, `${at}.photos[${j}]`, 'photo', T));
    arr(meal.items).forEach((it, j) => checkObject(it, `${at}.items[${j}]`, 'item', T));
  });
}

// ---------------------------------------------------------------- the validator
/**
 * Pure. Returns [{rule, msg, fix}]; empty means valid.
 * opts: { lock: {sha256, meals, locked_at} | null, requireMeals: N | null, minWeeks: W | null }
 */
export function validateManifest(manifest, { lock = null, requireMeals = null, minWeeks = null } = {}) {
  const out = [];
  const add = (rule) => (msg, fix) => out.push({ rule, msg, fix });
  checkTypes(manifest, add('schema-types'));
  if (!isObj(manifest)) return out;

  const meals = arr(manifest.meals).filter(isObj);
  const plates = arr(manifest.plates).filter(isObj);
  const label = (m) => `meal ${show(m.id)}`;

  // unique ids
  const dup = add('unique-ids');
  const seenPlate = new Set(); const seenMeal = new Set();
  for (const p of plates) {
    if (typeof p.id === 'string' && seenPlate.has(p.id)) dup(`plate id ${show(p.id)} appears more than once`, 'Give every plate its own id; register each physical plate once.');
    seenPlate.add(p.id);
  }
  for (const m of meals) {
    if (typeof m.id === 'string' && seenMeal.has(m.id)) dup(`meal id ${show(m.id)} appears more than once`, 'Meal ids must be unique; a meal belongs to exactly one split, so it cannot be repeated.');
    seenMeal.add(m.id);
    const seenItem = new Set();
    for (const it of arr(m.items).filter(isObj)) {
      if (typeof it.id === 'string' && seenItem.has(it.id)) dup(`${label(m)} has item id ${show(it.id)} more than once`, 'Item ids must be unique within a meal (e.g. i1, i2, ...).');
      seenItem.add(it.id);
    }
  }

  // unique photos
  const dupPhoto = add('unique-photos');
  const photoAt = new Map();
  for (const m of meals) for (const p of arr(m.photos).filter(isObj)) {
    if (typeof p.sha256 !== 'string') continue;
    if (photoAt.has(p.sha256)) dupPhoto(`photo ${p.sha256.slice(0, 12)}... is in ${label(m)} and ${photoAt.get(p.sha256)}`, 'Each photo file belongs to exactly one meal; remove the duplicate entry or re-export the manifest.');
    else photoAt.set(p.sha256, label(m));
  }

  // plate references
  const noPlate = add('plate-ref');
  for (const m of meals) if (typeof m.plate_id === 'string' && !seenPlate.has(m.plate_id)) noPlate(`${label(m)} uses plate_id ${show(m.plate_id)} which is not in plates`, 'Register the plate once in plates (id, diameter_mm measured with a ruler, kind) or correct the id.');

  // plausible grams
  const gram = add('plausible-grams');
  for (const m of meals) {
    for (const it of arr(m.items).filter(isObj)) {
      const at = `${label(m)} item ${show(it.id)}`;
      if (isNum(it.grams) && !(it.grams > 0 && it.grams <= MAX_ITEM_G)) gram(`${at} has grams ${it.grams}; must be > 0 and <= ${MAX_ITEM_G}`, 'Re-check the weighing: grams is the net weight of that one item on the scale, in grams (not kg, not including the plate).');
      if (isNum(it.oil_g) && it.oil_g < 0) gram(`${at} has oil_g ${it.oil_g}; must be >= 0`, 'oil_g is the cooking oil apportioned to the item; use 0 or omit it.');
    }
    if (isNum(m.leftovers_g) && m.leftovers_g < 0) gram(`${label(m)} has leftovers_g ${m.leftovers_g}; must be >= 0`, 'leftovers_g is the weight left on the plate after eating; use 0 or omit it.');
  }

  // split by capture date (the ISO date exactly as written, i.e. the capture's own local date)
  const byDate = new Map();
  for (const m of meals) {
    const c = parseCapture(m.captured_at);
    if (!c || (m.split !== 'calibration' && m.split !== 'test')) continue;
    const e = byDate.get(c.date) ?? { calibration: [], test: [] };
    e[m.split].push(String(m.id)); byDate.set(c.date, e);
  }
  const dateRule = add('split-by-date');
  for (const [date, e] of [...byDate].sort()) {
    if (e.calibration.length && e.test.length) dateRule(`${date} has calibration meals (${e.calibration.slice(0, 3).join(', ')}) and test meals (${e.test.slice(0, 3).join(', ')})`, 'Splits are by capture date: assign a whole day to one split. Move that day\'s meals to a single split (before locking) or drop the extras from the benchmark.');
  }

  // near-duplicate leakage across splits
  const shots = [];
  for (const m of meals) if (m.split === 'calibration' || m.split === 'test') for (const p of arr(m.photos).filter(isObj)) if (isHex(16)(p.phash)) shots.push({ split: m.split, phash: p.phash, meal: String(m.id) });
  const leak = add('near-duplicate-leakage');
  const cal = shots.filter(s => s.split === 'calibration'); const tst = shots.filter(s => s.split === 'test');
  for (const a of cal) for (const b of tst) {
    const d = hamming(a.phash, b.phash);
    if (d <= HAMMING_LIMIT) leak(`calibration meal ${show(a.meal)} and test meal ${show(b.meal)} have near-identical photos (phash distance ${d} <= ${HAMMING_LIMIT})`, 'The same scene or a retake sits in both splits, so test accuracy would be inflated. Keep the whole scene (all retakes) in one split, or delete the near-duplicate photo from the manifest.');
  }

  // frozen test set
  if (lock !== null && lock !== undefined) {
    const frozen = add('frozen-test-set');
    if (!isObj(lock) || !isHex(64)(lock.sha256)) frozen('lock is malformed; expected {sha256 (64 hex), meals, locked_at}', 'Do not hand-edit the lock; restore it from git or recreate it with node bench/lock.mjs.');
    else {
      const actual = testSetHash(manifest);
      const n = testMeals(manifest).length;
      if (actual !== lock.sha256) frozen(`test meals changed since the lock (hash ${actual.slice(0, 12)}..., locked ${lock.sha256.slice(0, 12)}...; ${n} test meals now, ${lock.meals} locked)`, 'Revert edits to test-split meals (git diff shows them). A deliberate correction needs: node bench/lock.mjs --relock --reason "<why>" and a matching mc note.');
    }
  }

  // completeness
  const complete = add('completeness');
  if (requireMeals !== null && requireMeals !== undefined && meals.length < requireMeals) complete(`${meals.length} meals, need >= ${requireMeals}`, `Keep capturing: ${requireMeals - meals.length} more meals to go (one weighed meal at a time, per the weighing protocol).`);
  if (minWeeks !== null && minWeeks !== undefined) {
    const t = meals.map(m => parseCapture(m.captured_at)).filter(Boolean).map(c => c.ms);
    if (!t.length) complete(`no valid capture times to measure a span of ${minWeeks} weeks`, 'Add meals with a valid captured_at.');
    else {
      const weeks = (Math.max(...t) - Math.min(...t)) / WEEK_MS;
      if (weeks < minWeeks) complete(`captures span ${weeks.toFixed(1)} weeks, need >= ${minWeeks}`, 'Keep capturing across more weeks so lighting, plates and eating habits vary; do not backfill dates.');
    }
  }
  return out;
}
