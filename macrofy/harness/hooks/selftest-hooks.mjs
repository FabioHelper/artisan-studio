// Drives the Claude Code hook scripts against a throwaway git repo holding a copy of macrofy/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-hooks-'));
const M = path.join(repo, 'macrofy');
fs.cpSync(SRC, M, { recursive: true, filter: (p) => !/[\\/](\.mc-cache|node_modules)([\\/]|$)/.test(p) });
// Docs may name any repo-level harness file, so copy those folders whole rather than a list that rots.
for (const dir of ['.claude', '.github']) {
  const from = path.resolve(SRC, '..', dir);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(repo, dir), { recursive: true, filter: (p) => !/(^|[\\/])worktrees([\\/]|$)/.test(path.relative(from, p)) });
}

const env = { ...process.env, MC_ROOT: M, MC_AGENT: 'hooks-selftest' };
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: repo, encoding: 'utf8', env, ...opts });
const gitc = (...args) => sh('git', ['-c', 'user.email=selftest@example.invalid', '-c', 'user.name=selftest', '-c', 'commit.gpgsign=false', ...args]);
const hook = (name, input) => sh(process.execPath, [path.join(HERE, `${name}.mjs`)], { input: JSON.stringify(input) });
const mc = (...args) => sh(process.execPath, [path.join(SRC, 'harness', 'mc.mjs'), ...args]);
const touch = (rel, text = '\nedit\n') => fs.appendFileSync(path.join(repo, rel), text);

gitc('init', '-q'); gitc('add', '-A'); gitc('commit', '-q', '-m', 'fixture');

let failures = 0;
const expect = (name, cond, detail = '') => { if (cond) console.log(`PASS ${name}`); else { failures++; console.log(`FAIL ${name}\n${detail}`); } };
const show = (r) => `exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`;
const ctx = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; } };

let r = hook('session-start', { session_id: 's1', source: 'startup' });
expect('startup injects only the one-line pointer', r.status === 0 && ctx(r).startsWith('Macrofy (separate project') && !ctx(r).includes('MISSION CONTROL'), show(r));
expect('startup records the session baseline', fs.existsSync(path.join(M, '.mc-cache', 'sessions', 's1.json')));

r = hook('stop', { session_id: 's1' });
expect('stop is silent when macrofy is untouched', r.status === 0 && !r.stdout && !r.stderr, show(r));

touch('artisan-only.txt');
r = hook('stop', { session_id: 's1' });
expect('stop ignores changes outside macrofy/', r.status === 0 && !r.stderr, show(r));

touch('macrofy/README.md');
r = hook('stop', { session_id: 's1' });
expect('stop blocks when macrofy changed without a handoff', r.status === 2 && r.stderr.includes('handoff'), show(r));

r = mc('note', 'done: fixture edit / next: nothing / gotchas: none');
expect('mc note appends a handoff', r.status === 0, show(r));
r = hook('stop', { session_id: 's1' });
expect('stop passes once the handoff is newer than the change', r.status === 0 && !r.stderr, show(r));

const planPath = path.join(M, 'control', 'plan.json');
const planGood = fs.readFileSync(planPath, 'utf8');
const plan = JSON.parse(planGood); plan.tasks.at(-1).status = 'done';
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
r = hook('stop', { session_id: 's1' });
expect('stop blocks on a failing gate and prints the fix', r.status === 2 && r.stderr.includes('J2-status-proven') && r.stderr.includes('fix:'), show(r));
r = hook('stop', { session_id: 's1', stop_hook_active: true });
expect('stop releases a stuck agent loudly instead of looping', r.status === 0 && JSON.parse(r.stdout || '{}').systemMessage?.includes('needs a human'), show(r));

r = hook('session-start', { session_id: 's1', source: 'compact' });
expect('compaction re-injects the full brief when macrofy is in play', ctx(r).includes('MACROFY MISSION CONTROL') && ctx(r).includes('NEXT:'), show(r));

fs.writeFileSync(planPath, planGood);
gitc('add', '-A'); gitc('commit', '-q', '-m', 'settle');
hook('session-start', { session_id: 's2', source: 'startup' });
const transcript = path.join(repo, 't.jsonl');
fs.writeFileSync(transcript, '{"text":"working on artisan scenes"}\n');
r = hook('session-start', { session_id: 's2', source: 'compact', transcript_path: transcript });
expect('compaction in an unrelated session injects only the pointer', !ctx(r).includes('MISSION CONTROL'), show(r));
fs.appendFileSync(transcript, '{"text":"open macrofy/control/plan.json"}\n');
r = hook('session-start', { session_id: 's2', source: 'compact', transcript_path: transcript });
expect('compaction re-injects the brief when the transcript involved macrofy/', ctx(r).includes('MACROFY MISSION CONTROL'), show(r));

touch('macrofy/docs/architecture.md');
gitc('add', '-A'); gitc('commit', '-q', '-m', 'committed change');
r = hook('stop', { session_id: 's2' });
expect('stop sees committed macrofy changes since session start', r.status === 2 && r.stderr.includes('handoff'), show(r));

r = mc('note', 'done: committed change / next: none');
gitc('add', '-A'); gitc('commit', '-q', '-m', 'note after change');
const later = new Date(Date.now() + 5000);
fs.utimesSync(path.join(M, 'docs', 'architecture.md'), later, later);
r = hook('stop', { session_id: 's2' });
expect('a merge/checkout rewriting mtimes does not re-trigger a committed handoff', r.status === 0 && !r.stderr, show(r));

fs.rmSync(repo, { recursive: true, force: true });
console.log(failures ? `\n${failures} hook selftest failure(s)` : '\nhooks selftest OK');
process.exit(failures ? 1 : 0);
