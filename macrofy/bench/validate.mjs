#!/usr/bin/env node
// Registered check `bench-validate` (and, with --require-meals/--min-weeks, `bench-complete`).
//   1. Negative fixtures: the good manifest passes, every rule is observed failing, the lock CLI works.
//   2. The real manifest.json (with test.lock.json when present) is validated.
// Usage: node bench/validate.mjs [--require-meals N] [--min-weeks W] [--manifest <file>] [--lock <file>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RULES, validateManifest, testSetHash } from './schema.mjs';
import { CASES, goodManifest, lockFor } from './fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const numArg = (name) => {
  const v = value(name);
  if (v === undefined) return argv.includes(name) ? NaN : null;
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
};
const requireMeals = numArg('--require-meals');
const minWeeks = numArg('--min-weeks');
const manifestPath = value('--manifest') ?? path.join(HERE, 'manifest.json');
const lockPath = value('--lock') ?? path.join(HERE, 'test.lock.json');

let failures = 0;
const fail = (msg, fix) => { failures++; console.log(`FAIL ${msg}${fix ? `\n     fix: ${fix}` : ''}`); };
const clone = (x) => JSON.parse(JSON.stringify(x));

if (Number.isNaN(requireMeals) || Number.isNaN(minWeeks)) {
  fail('--require-meals and --min-weeks need a number', 'e.g. node bench/validate.mjs --require-meals 300 --min-weeks 8');
  process.exit(1);
}

// ---------------------------------------------------------------- 1. negative fixtures
const seen = new Map(); // rule -> case names observed failing
for (const c of CASES) {
  const good = goodManifest();
  const opts = { ...c.opts, lock: c.opts.lock === true ? lockFor(good) : c.opts.lock ?? null };
  let problems;
  try {
    const m = goodManifest();
    const replaced = c.fn(m);
    problems = validateManifest(replaced === undefined ? m : replaced, opts);
  } catch (e) { fail(`validator crashed on fixture "${c.name}": ${e.message}`, 'validateManifest must return problems for malformed input, never throw.'); continue; }
  const rules = new Set(problems.map(p => p.rule));
  if (c.pass) {
    if (problems.length) fail(`fixture "${c.name}" should pass but got: ${problems.slice(0, 3).map(p => `${p.rule}: ${p.msg}`).join(' | ')}`, 'Fix the validator or the fixture.');
  } else if (!rules.has(c.rule)) fail(`rule ${c.rule} did not catch fixture "${c.name}" (got: ${[...rules].join(', ') || 'no problems'})`, 'Fix the rule; a rule that cannot fail protects nothing.');
  else if (problems.some(p => !p.msg || !p.fix)) fail(`fixture "${c.name}" produced a problem without msg or fix`, 'Every problem needs a message and a fix hint.');
  else { if (!seen.has(c.rule)) seen.set(c.rule, []); seen.get(c.rule).push(c.name); }
}
for (const r of RULES) {
  const names = seen.get(r.id);
  if (names) console.log(`PASS ${r.id} — observed failing on ${names.length} broken fixture(s)`);
  else fail(`rule ${r.id} was never observed failing`, 'Add a broken fixture for it to bench/fixtures.mjs.');
}
for (const id of seen.keys()) if (!RULES.some(r => r.id === id)) fail(`fixtures name unknown rule ${id}`, 'Register it in RULES in bench/schema.mjs.');
if (!failures) console.log(`PASS fixtures — good manifest passes; ${CASES.length} cases behave as declared`);

// lock CLI, end to end in a throwaway directory
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-lock-'));
try {
  const mp = path.join(tmp, 'manifest.json'); const lp = path.join(tmp, 'test.lock.json');
  const lock = (...args) => spawnSync(process.execPath, [path.join(HERE, 'lock.mjs'), '--manifest', mp, '--lock', lp, ...args], { encoding: 'utf8' });
  const write = (m) => fs.writeFileSync(mp, JSON.stringify(m));
  const expect = (name, ok) => (ok ? console.log(`PASS lock CLI ${name}`) : fail(`lock CLI ${name}`, 'Fix bench/lock.mjs.'));
  const good = goodManifest();

  const broken = clone(good); broken.meals[0].items[0].grams = -1; write(broken);
  expect('refuses an invalid manifest and writes no lock', lock().status === 1 && !fs.existsSync(lp));
  write(good);
  expect('writes the lock for a valid manifest', lock().status === 0 && JSON.parse(fs.readFileSync(lp, 'utf8')).sha256 === testSetHash(good));
  const first = fs.readFileSync(lp, 'utf8');
  const edited = clone(good); edited.meals[2].items[0].grams += 1; write(edited);
  expect('refuses to overwrite an existing lock', lock().status === 1 && fs.readFileSync(lp, 'utf8') === first);
  expect('refuses --relock without a reason', lock('--relock').status === 1 && fs.readFileSync(lp, 'utf8') === first);
  const r = lock('--relock', '--reason', 'fixture correction');
  expect('relocks with a reason and reminds about mc note', r.status === 0 && /mc\.mjs note/.test(r.stdout) && JSON.parse(fs.readFileSync(lp, 'utf8')).sha256 === testSetHash(edited));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

// ---------------------------------------------------------------- 2. the real manifest
const complete = requireMeals !== null || minWeeks !== null;
const show = (problems) => {
  const byRule = new Map();
  for (const p of problems) { if (!byRule.has(p.rule)) byRule.set(p.rule, []); byRule.get(p.rule).push(p); }
  for (const [rule, ps] of byRule) {
    for (const p of ps.slice(0, 8)) fail(`${rule}: ${p.msg}`, p.fix);
    if (ps.length > 8) console.log(`     ... and ${ps.length - 8} more ${rule} problem(s)`);
  }
};

if (!fs.existsSync(manifestPath)) {
  if (fs.existsSync(lockPath)) fail(`frozen-test-set: a lock exists but ${manifestPath} does not`, 'Restore the manifest from git; never delete it after locking.');
  else if (requireMeals !== null) fail(`completeness: no manifest yet (need >= ${requireMeals} meals)`, 'Collect meals with the capture app or by hand and save them as manifest.json in the bench folder; see docs/runbooks/weighing-protocol.md.');
  else console.log('PASS no manifest yet — nothing more to validate (create manifest.json in the bench folder to start)');
} else {
  let manifest = null; let lock = null; let readable = true;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { readable = false; fail(`manifest ${manifestPath} is not valid JSON: ${e.message}`, 'Fix the JSON syntax (git diff shows the last edit).'); }
  if (fs.existsSync(lockPath)) { try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (e) { readable = false; fail(`lock ${lockPath} is not valid JSON: ${e.message}`, 'Restore it from git; never hand-edit the lock.'); } }
  if (readable) {
    const problems = validateManifest(manifest, { lock, requireMeals, minWeeks });
    if (problems.length) show(problems);
    else {
      const n = Array.isArray(manifest.meals) ? manifest.meals.length : 0;
      console.log(`PASS manifest — ${n} meals, all ${RULES.length} rules hold${lock ? ', test set matches the lock' : ''}${complete ? ', completeness met' : ''}`);
    }
    if (!lock && !complete && Array.isArray(manifest?.meals) && manifest.meals.some(m => m?.split === 'test')) console.log('WARN no lock yet — the test split is not frozen; run node bench/lock.mjs once all test meals are in');
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nbench validation OK');
process.exit(failures ? 1 : 0);
