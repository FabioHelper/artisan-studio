#!/usr/bin/env node
// Freeze the test split: writes the lock {sha256, meals, locked_at} from manifest.json (in this folder).
// Usage: node bench/lock.mjs [--relock --reason "why"] [--manifest <file>] [--lock <file>]
// Refuses an invalid manifest, and refuses to replace an existing lock without --relock and a reason.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, testMeals, testSetHash } from './schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const die = (msg) => { console.error(`FAIL ${msg}`); process.exit(1); };

const manifestPath = value('--manifest') ?? path.join(HERE, 'manifest.json');
const lockPath = value('--lock') ?? path.join(HERE, 'test.lock.json');
const relock = flag('--relock');
const reason = value('--reason')?.trim() ?? '';

let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
catch (e) { die(`cannot read manifest ${manifestPath}: ${e.code === 'ENOENT' ? 'no such file' : e.message}\n     fix: create it first (the capture PWA exports it; see docs/runbooks/weighing-protocol.md).`); }

const problems = validateManifest(manifest);
if (problems.length) {
  for (const p of problems.slice(0, 10)) console.error(`FAIL ${p.rule}: ${p.msg}\n     fix: ${p.fix}`);
  die(`manifest has ${problems.length} problem(s); a lock on invalid data would freeze the errors. Fix them (node bench/validate.mjs) and retry.`);
}
const n = testMeals(manifest).length;
if (n === 0) die('the manifest has no test meals; nothing to lock.');

const existing = fs.existsSync(lockPath);
if (existing && !relock) die(`a lock already exists at ${lockPath}.\n     fix: the test set is frozen on purpose. If a correction is truly needed: node bench/lock.mjs --relock --reason "<why>".`);
if (existing && !reason) die('--relock needs --reason "<why the frozen test set is being changed>".\n     fix: pass the reason; it must also be recorded with mc note.');

let previous = null;
if (existing) { try { previous = JSON.parse(fs.readFileSync(lockPath, 'utf8')).sha256; } catch { /* unreadable old lock: nothing to compare */ } }
const lock = { sha256: testSetHash(manifest), meals: n, locked_at: new Date().toISOString() };
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`PASS locked ${n} test meals, sha256 ${lock.sha256.slice(0, 12)}... -> ${lockPath}`);
if (existing) {
  console.log(`REMINDER record why with: MC_AGENT=<you> node harness/mc.mjs note "relocked test set (${(previous ?? 'unknown').slice(0, 12)}... -> ${lock.sha256.slice(0, 12)}...): ${reason}"`);
  console.log('         Every accuracy number measured on the previous test set is void; re-run the evaluation.');
}
