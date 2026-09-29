// Check `capture-selftest`: node capture/selftest.mjs (run from macrofy/).
// A1: a sample export produced by the capture app's pure module passes the benchmark validator.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateManifest, RULES } from '../bench/schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = await import(pathToFileURL(join(root, 'web/app/lib.mjs')));
const vocab = JSON.parse(readFileSync(join(root, 'web/app/data/vocab.json'), 'utf8'));
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log(`ok  ${name}`); };

// ---------------------------------------------------------------- dHash
const gray = (f) => Array.from({ length: 72 }, (_, i) => f(i % 9, Math.floor(i / 9)));
await t('dHash: brighter-than-right gives 1 bits, MSB first, 16 hex chars', () => {
  assert.equal(app.dHashFromGray(gray((x) => 100 - x)), 'ffffffffffffffff');
  assert.equal(app.dHashFromGray(gray((x) => x)), '0000000000000000');
  assert.equal(app.dHashFromGray(gray(() => 5)), '0000000000000000'); // equal is not brighter
  // only the very first comparison (row 0, x 0 > x 1) is set: MSB of the first byte
  assert.equal(app.dHashFromGray(gray((x, y) => (y === 0 && x === 0 ? 9 : 1))), '8000000000000000');
  // only the last comparison (row 7, x 7 > x 8): LSB of the last byte
  assert.equal(app.dHashFromGray(gray((x, y) => (y === 7 && x === 7 ? 9 : 1))), '0000000000000001');
  assert.match(app.dHashFromGray(gray((x, y) => (x * 7 + y * 13) % 11)), /^[0-9a-f]{16}$/);
  assert.throws(() => app.dHashFromGray([1, 2, 3]));
});
await t('dHash from RGBA: any size, luminance weights, resize invariant', () => {
  const small = gray((x, y) => (x * 31 + y * 17) % 200 + 20);
  const rgba = (w, h, at) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const v = at(i % w, Math.floor(i / w)); d.set([v, v, v, 255], i * 4); } return d; };
  const expected = app.dHashFromGray(small);
  assert.equal(app.dHashFromRGBA(rgba(9, 8, (x, y) => small[y * 9 + x]), 9, 8), expected);
  assert.equal(app.dHashFromRGBA(rgba(72, 64, (x, y) => small[Math.floor(y / 8) * 9 + Math.floor(x / 8)]), 72, 64), expected); // 8x upscale
  const red = new Uint8ClampedArray([255, 0, 0, 255]); const green = new Uint8ClampedArray([0, 255, 0, 255]);
  const g = app.grayGrid(new Uint8ClampedArray([...red, ...green]), 2, 1, 2, 1);
  assert.ok(g[1] > g[0], 'green is brighter than red'); // 0.587*255 > 0.299*255
});
await t('hamming distance between similar images is small, between different ones large', async () => {
  const { hamming } = await import(pathToFileURL(join(root, 'bench/schema.mjs')));
  const a = app.dHashFromGray(gray((x, y) => (x * 31 + y * 17) % 200));
  const b = app.dHashFromGray(gray((x, y) => (x * 31 + y * 17) % 200 + 3)); // exposure shift
  const c = app.dHashFromGray(gray((x, y) => (x * 53 + y * 7 + x * y) % 197));
  assert.equal(hamming(a, b), 0); assert.ok(hamming(a, c) > 6);
});

// ---------------------------------------------------------------- sha256
await t('sha256Hex matches the standard vector and node:crypto', async () => {
  assert.equal(await app.sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const buf = randomBytes(5000);
  assert.equal(await app.sha256Hex(buf), createHash('sha256').update(buf).digest('hex'));
  assert.equal(app.bytesToHex(new Uint8Array([0, 15, 255])), '000fff');
});

// ---------------------------------------------------------------- dates and split
await t('isoWithOffset writes the local UTC offset', () => {
  const at = (off) => ({ getFullYear: () => 2026, getMonth: () => 9, getDate: () => 3, getHours: () => 19, getMinutes: () => 42, getSeconds: () => 5, getTimezoneOffset: () => off });
  assert.equal(app.isoWithOffset(at(180)), '2026-10-03T19:42:05-03:00');
  assert.equal(app.isoWithOffset(at(-330)), '2026-10-03T19:42:05+05:30');
  assert.equal(app.isoWithOffset(at(0)), '2026-10-03T19:42:05+00:00');
  assert.match(app.isoWithOffset(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});
await t('ISO week numbers, including year boundaries', () => {
  const w = (s) => app.isoWeek(...s.split('-').map(Number));
  assert.equal(w('2026-01-01'), 1); assert.equal(w('2026-12-31'), 53); assert.equal(w('2027-01-03'), 53);
  assert.equal(w('2024-12-30'), 1); assert.equal(w('2026-10-04'), 40); assert.equal(w('2026-10-05'), 41);
});
await t('split: odd ISO week is calibration, even is test; the whole date shares one split', () => {
  const s = (d, time = '12:00:00') => app.splitForCapture(`${d}T${time}-03:00`);
  assert.equal(s('2026-10-05'), 'calibration'); // week 41
  assert.equal(s('2026-10-12'), 'test'); // week 42
  assert.equal(s('2026-10-11', '23:59:59'), 'calibration'); // Sunday closes week 41
  assert.equal(s('2026-10-12', '00:00:00'), 'test'); // Monday opens week 42
  // no calendar date can be in both splits, whatever the time of day or offset written
  for (let day = 0; day < 400; day++) {
    const d = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
    assert.equal(s(d, '00:00:00'), s(d, '23:59:59'), d);
  }
  assert.throws(() => app.splitForCapture('nope'));
});

// ---------------------------------------------------------------- input parsing
await t('grams are positive integers; oil and leftovers are optional decimals', () => {
  assert.equal(app.parseGrams('180'), 180); assert.equal(app.parseGrams(' 45 '), 45);
  for (const bad of ['', '0', '12.5', '12,5', '-3', 'abc', '3001', '1e3']) assert.equal(app.parseGrams(bad), null, bad);
  assert.deepEqual(app.parseOptionalGrams(''), { value: undefined });
  assert.deepEqual(app.parseOptionalGrams('6,5'), { value: 6.5 });
  assert.deepEqual(app.parseOptionalGrams('0'), { value: 0 });
  assert.ok(app.parseOptionalGrams('x').error && app.parseOptionalGrams('-1').error);
});
await t('plate form: pt-BR errors, unique ids, bowl depth optional', () => {
  assert.ok(app.plateFromForm({ name: '', kind: 'plate', diameter: '260' }).errors.length === 1);
  assert.ok(app.plateFromForm({ name: 'x', kind: 'pot', diameter: '10' }).errors.length === 2);
  assert.ok(app.plateFromForm({ name: 'x', kind: 'bowl', diameter: '180', depth: '2' }).errors.length === 1);
  const a = app.plateFromForm({ name: 'Prato Raso Cerâmica', kind: 'plate', diameter: '260,5' }, []).plate;
  assert.deepEqual(a, { id: 'prato-raso-ceramica', name: 'Prato Raso Cerâmica', kind: 'plate', diameter_mm: 260.5 });
  const b = app.plateFromForm({ name: 'Prato raso ceramica', kind: 'bowl', diameter: '180', depth: '55' }, [a.id]).plate;
  assert.equal(b.id, 'prato-raso-ceramica-2'); assert.equal(b.depth_mm, 55);
  assert.equal(app.plateFromForm({ id: a.id, name: 'Renamed', kind: 'plate', diameter: '260' }, [a.id]).plate.id, a.id, 'editing keeps the id');
});
await t('vocab: accent-insensitive search; item defaults come from the facets', () => {
  const hit = app.searchVocab(vocab.classes, 'feijao carioca');
  assert.ok(hit.length && hit[0].id === 'feijao-carioca-cozido', hit[0]?.id);
  assert.ok(app.searchVocab(vocab.classes, 'MACARRÃO').every((c) => /macarr/.test(app.norm(c.pt))));
  assert.equal(app.searchVocab(vocab.classes, 'zzzz').length, 0);
  assert.ok(app.searchVocab(vocab.classes, '').length > 0);
  for (const c of vocab.classes) {
    const it = app.itemFromClass(c);
    assert.ok(['raw', 'cooked'].includes(it.state) && app.METHODS.some((m) => m.id === it.method), c.id);
    assert.equal(it.label, c.pt);
  }
  const rice = app.itemFromClass(vocab.classes.find((c) => c.id === 'arroz-branco-cozido'));
  assert.deepEqual([rice.state, rice.method], ['cooked', 'boiled']);
});

// ---------------------------------------------------------------- A1: a sample export passes the benchmark validator
const sha = (s) => createHash('sha256').update(s).digest('hex');
const plates = [
  app.plateFromForm({ name: 'Prato raso', kind: 'plate', diameter: '260' }, []).plate,
  app.plateFromForm({ name: 'Tigela', kind: 'bowl', diameter: '180', depth: '55' }, ['prato-raso']).plate,
];
/** Meal built through the app's own draft -> record path, on a given local date. */
function sampleMeal(date, plate_id, tag, extra = {}) {
  const captured_at = `${date}T12:30:00-03:00`;
  const draft = {
    captured_at, plate_id, leftovers_g: '', notes: '', lighting: 'daylight',
    photos: app.ANGLES.map((a, i) => ({ sha256: sha(`photo:${tag}:${i}`), phash: sha(`phash:${tag}:${i}`).slice(0, 16), angle: a.id, lighting: i ? 'warm' : 'daylight' })),
    items: ['arroz-branco-cozido', 'feijao-carioca-cozido', 'frango-grelhado'].map((id, i) => ({ ...app.itemFromClass(vocab.classes.find((c) => c.id === id)), grams: String(120 + 30 * i), oil_g: i === 0 ? '2,5' : '' })),
    ...extra,
  };
  assert.deepEqual(app.checkMealDraft(draft, plates), { errors: [], warnings: [] });
  return app.mealFromDraft(draft, app.newMealId(captured_at, () => Number(`0.${tag.length}${tag.charCodeAt(0)}`)));
}
const meals = [
  sampleMeal('2026-10-05', 'prato-raso', 'a'), sampleMeal('2026-10-06', 'tigela', 'b', { leftovers_g: '15', notes: 'sem sal' }),
  sampleMeal('2026-10-13', 'prato-raso', 'c'), sampleMeal('2026-10-20', 'tigela', 'd'), sampleMeal('2026-10-27', 'prato-raso', 'e'),
];
const scale = { model: 'Camry EK3131', resolution_g: 1 };
const manifest = app.buildManifest({ scale, plates, meals });

await t('A1: the sample export has both splits and passes the benchmark validator', () => {
  assert.deepEqual(new Set(manifest.meals.map((m) => m.split)), new Set(['calibration', 'test']));
  assert.deepEqual(validateManifest(manifest), []);
  assert.deepEqual(app.exportProblems(manifest), []);
  assert.equal(manifest.schema, 'macrofy.bench/1');
});
await t('A1: export drops app-only fields and keeps optional ones only when set', () => {
  assert.ok(manifest.plates.every((p) => !('name' in p)));
  assert.ok(manifest.meals.every((m) => m.photos.every((p) => !('angle' in p) && [90, 45, 30].includes(p.angle_deg))));
  assert.equal(manifest.meals[0].items[0].oil_g, 2.5); assert.ok(!('oil_g' in manifest.meals[0].items[1]));
  const withNotes = manifest.meals.find((m) => m.notes); assert.equal(withNotes.notes, 'sem sal'); assert.equal(withNotes.leftovers_g, 15);
  assert.ok(!('notes' in manifest.meals[0]) && !('leftovers_g' in manifest.meals[0]));
  assert.deepEqual(manifest.meals.map((m) => m.captured_at), [...manifest.meals.map((m) => m.captured_at)].sort());
});
await t('A1: the exported file (JSON text) passes the real bench CLI, and validates with the vendored core copy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-'));
  try {
    const file = join(dir, 'manifest.json'); writeFileSync(file, JSON.stringify(manifest, null, 2));
    const r = spawnSync(process.execPath, [join(root, 'bench/validate.mjs'), '--manifest', file, '--lock', join(dir, 'none.json')], { encoding: 'utf8', cwd: root });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /bench validation OK/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const vendored = await import(pathToFileURL(join(root, 'web/app/vendor/schema-core.mjs')));
  assert.deepEqual(vendored.validateManifest(JSON.parse(JSON.stringify(manifest))), []);
  assert.throws(() => vendored.validateManifest(manifest, { lock: { sha256: 'a'.repeat(64), meals: 1, locked_at: 'x' } }), /sha256 is required/);
});

// ---------------------------------------------------------------- draft checks and pt-BR problems
await t('meal draft errors and warnings are in pt-BR', () => {
  const ok = { plate_id: 'tigela', photos: [{ sha256: 'a', phash: 'b' }], items: [{ label: 'arroz', grams: '100', oil_g: '' }], leftovers_g: '', notes: '' };
  const c = (d) => app.checkMealDraft({ ...ok, ...d }, plates);
  assert.deepEqual(c({}).errors, []); assert.equal(c({}).warnings.length, 1); assert.match(c({}).warnings[0], /pelo menos 3 fotos/);
  assert.match(c({ plate_id: '' }).errors[0], /Escolha o prato/);
  assert.match(c({ photos: [] }).errors[0], /pelo menos uma foto/);
  assert.match(c({ photos: [{ sha256: '', phash: '' }] }).errors[0], /cálculo/);
  assert.match(c({ items: [] }).errors[0], /pelo menos um item/);
  assert.match(c({ items: [{ label: 'arroz', grams: '12,5', oil_g: '' }] }).errors[0], /Item 1 \(arroz\).*inteiro/);
  assert.match(c({ items: [{ label: 'arroz', grams: '5', oil_g: 'x' }] }).errors[0], /óleo/);
  assert.match(c({ leftovers_g: 'muito' }).errors[0], /Sobras/);
});
await t('validator problems reach the owner in pt-BR with the technical detail kept', () => {
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.meals[0].items[0].grams = 5000; delete bad.scale.model; bad.meals[1].plate_id = 'nao-existe'; bad.meals[2].photos[0].lighting = 'sol';
  const ps = app.problemsPt(bad);
  const rules = new Set(ps.map((p) => p.rule));
  assert.ok(['plausible-grams', 'plate-ref', 'schema-types'].every((r) => rules.has(r)), [...rules].join());
  assert.ok(ps.every((p) => /[a-zà-ú]/i.test(p.texto) && !/\b(is|must be|missing)\b/.test(p.texto)), JSON.stringify(ps.map((p) => p.texto)));
  assert.ok(ps.some((p) => /Falta preencher: balança, modelo da balança/.test(p.texto)), JSON.stringify(ps.map((p) => p.texto)));
  assert.ok(ps.some((p) => /Valor inválido em refeição de \d\d\/\d\d [\d:]+, foto 1, iluminação/.test(p.texto)), JSON.stringify(ps.map((p) => p.texto)));
  assert.ok(ps.every((p) => p.detalhe.length > 10));
  for (const r of RULES.filter((x) => x.id !== 'schema-types')) assert.ok(app.RULE_PT[r.id], `no pt-BR text for rule ${r.id}`);
  const empty = app.exportProblems(app.buildManifest({ scale, plates, meals: [] }));
  assert.match(empty[0].texto, /Ainda não há refeições/);
  const noScale = app.exportProblems(app.buildManifest({ scale: null, plates, meals }));
  assert.ok(noScale.length > 0 && noScale.every((p) => !/ is | must /.test(p.texto)));
});
await t('leakage across splits is reported in pt-BR (retake of the same scene in another week)', () => {
  const m = JSON.parse(JSON.stringify(manifest));
  const cal = m.meals.find((x) => x.split === 'calibration'); const tst = m.meals.find((x) => x.split === 'test');
  tst.photos[0].phash = cal.photos[0].phash;
  const p = app.problemsPt(m).find((x) => x.rule === 'near-duplicate-leakage');
  assert.ok(p && /quase idênticas/.test(p.texto));
});

console.log(`capture selftest: ${n} checks passed`);
