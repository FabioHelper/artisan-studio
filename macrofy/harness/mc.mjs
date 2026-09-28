#!/usr/bin/env node
// Macrofy mission control. Usage: node harness/mc.mjs <command> [args]  (run `help` for the list)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT, PATHS, loadSnapshot, deriveStatuses, tasksById, hashAcceptance, needsReview, doneEvidence,
  appendJournal, writeJson, git,
} from './lib/state.mjs';
import { runGates, formatFailures, runCheck } from './lib/gates.mjs';
import { renderStatus, renderBrief } from './lib/render.mjs';

const HELP = `mc — Macrofy mission control (run from anywhere; paths are relative to macrofy/)
  brief                         session-start briefing: mission, state, blockers, NEXT action
  check [--fast] [--base SHA] [--json]   run gates (--fast skips executing checks)
  start <T>                     begin a task (locks its acceptance criteria; WIP limit 1)
  verify <T>                    run the task's acceptance checks and record the result
  review <T> --verdict accept|reject --notes "..."   record an independent review
  done <T>                      close a task (requires passing verify [+ accepting review])
  block <T> --reason "..." [--owner-question "..."]
  unblock <T> --reason "..."    (e.g. the owner's answer)
  reopen <T> --reason "..."     done → todo (regression or changed requirement)
  drop <T> --reason "..."       abandon a task that is not done
  amend <T> --reason "..."      re-lock edited acceptance criteria (shown to the owner)
  note "<done / next / gotchas>"   append a handoff note
  render                        regenerate docs/STATUS.md
  selftest                      prove every gate fails on a broken fixture`;

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {}; const pos = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; flags[k] = v; } else pos.push(argv[i]);
}
const die = (msg) => { console.error(`mc: ${msg}`); process.exit(1); };
const need = (k) => (typeof flags[k] === 'string' && flags[k].trim() ? flags[k].trim() : die(`--${k} "<text>" is required`));

function context() {
  const snap = loadSnapshot();
  const pre = runGates(snap, { fast: true, only: ['S1-schema', 'J1-journal-integrity'] }).filter(r => !r.ok);
  if (pre.length) die(`control state is corrupt; fix before mutating:\n${formatFailures(pre)}`);
  return { snap, derived: deriveStatuses(snap.plan, snap.journal), byId: tasksById(snap.plan) };
}

function taskArg(ctx, allowed) {
  const id = pos[0] || die('task id required (e.g. T-001)');
  const task = ctx.byId.get(id) || die(`unknown task ${id}`);
  const st = ctx.derived.get(id);
  if (allowed && !allowed.includes(st)) die(`${id} is ${st}; this command needs it to be ${allowed.join(' or ')}`);
  return task;
}

function commit(ctx, entry, newStatus) {
  const e = appendJournal(entry);
  if (newStatus) {
    const plan = JSON.parse(fs.readFileSync(path.join(ROOT, PATHS.plan), 'utf8'));
    plan.tasks.find(t => t.id === entry.task).status = newStatus;
    writeJson(PATHS.plan, plan);
  }
  fs.writeFileSync(path.join(ROOT, PATHS.status), renderStatus(loadSnapshot()));
  console.log(`journal #${e.seq} ${e.type}${e.task ? ' ' + e.task : ''}${newStatus ? ` → ${newStatus}` : ''}`);
  return e;
}

const commands = {
  help: () => console.log(HELP),

  brief() {
    const snap = loadSnapshot();
    console.log(renderBrief(snap, runGates(snap, { fast: true })));
  },

  check() {
    const snap = loadSnapshot({ base: typeof flags.base === 'string' ? flags.base : null });
    if (flags.base && !snap.baseRead) console.log(`note: base ${flags.base} not available; base comparisons skipped`);
    const results = runGates(snap, { fast: !!flags.fast || !!process.env.MC_NESTED });
    if (flags.json) console.log(JSON.stringify({ ok: results.every(r => r.ok), results }, null, 2));
    else {
      for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.title}`);
      const f = formatFailures(results);
      if (f) console.log(`\n${f}`);
    }
    process.exit(results.every(r => r.ok) ? 0 : 1);
  },

  start() {
    const ctx = context(); const t = taskArg(ctx, ['todo']);
    const active = [...ctx.derived].find(([, s]) => s === 'active');
    if (active) die(`${active[0]} is already active — finish, block or reopen it first (WIP limit 1)`);
    const undone = (t.depends_on || []).filter(d => ctx.derived.get(d) !== 'done');
    if (undone.length) die(`dependencies not done: ${undone.join(', ')}`);
    const structural = runGates(ctx.snap, { fast: true, only: ['S1-schema', 'S2-references'] }).filter(r => !r.ok);
    if (structural.length) die(`fix the plan first:\n${formatFailures(structural)}`);
    commit(ctx, { type: 'start', task: t.id, acceptance_hash: hashAcceptance(t.acceptance) }, 'active');
    console.log(`Acceptance for ${t.id} is now locked:\n${t.acceptance.map(a => `  ${a.id} ${a.criterion} [${a.check || 'manual → review'}]`).join('\n')}`);
  },

  verify() {
    const ctx = context(); const t = taskArg(ctx, ['active']);
    const checks = new Map((ctx.snap.checks.checks || []).map(c => [c.id, c]));
    const ran = new Map(); const results = [];
    for (const a of t.acceptance) {
      if (a.manual) { results.push({ a: a.id, manual: true }); continue; }
      if (!ran.has(a.check)) { process.stdout.write(`running ${a.check} … `); const r = runCheck(checks.get(a.check), ROOT); ran.set(a.check, r); console.log(r.pass ? `pass (${r.ms}ms)` : `FAIL\n${r.tail}`); }
      results.push({ a: a.id, check: a.check, pass: ran.get(a.check).pass });
    }
    const pass = results.every(r => r.manual || r.pass);
    const dirty = (git(['status', '--porcelain', '--', '.', ':(exclude).mc-cache']) || '').trim().length > 0;
    commit(ctx, { type: 'verify', task: t.id, pass, acceptance_hash: hashAcceptance(t.acceptance), dirty, results });
    if (results.some(r => r.manual)) console.log('Manual criteria need an independent review: docs/runbooks/review.md');
    process.exit(pass ? 0 : 1);
  },

  review() {
    const ctx = context(); const t = taskArg(ctx, ['active']);
    const verdict = need('verdict'); if (!['accept', 'reject'].includes(verdict)) die('--verdict must be accept or reject');
    const lastVerify = ctx.snap.journal.filter(e => e.task === t.id && e.type === 'verify').pop();
    if (!lastVerify) die(`run \`mc verify ${t.id}\` before review`);
    commit(ctx, { type: 'review', task: t.id, verdict, notes: need('notes'), of_verify: lastVerify.seq });
  },

  done() {
    const ctx = context(); const t = taskArg(ctx, ['active']);
    const ev = doneEvidence(t, ctx.snap.journal);
    if (!ev.ok) die(ev.why);
    commit(ctx, { type: 'done', task: t.id, verify_seq: ev.verify.seq }, 'done');
    console.log('Now: commit, then `mc note` a handoff if the session is ending.');
  },

  block() {
    const ctx = context(); const t = taskArg(ctx, ['todo', 'active']);
    const e = { type: 'block', task: t.id, reason: need('reason') };
    if (flags['owner-question']) e.owner_question = need('owner-question');
    commit(ctx, e, 'blocked');
  },
  unblock() { const ctx = context(); const t = taskArg(ctx, ['blocked']); commit(ctx, { type: 'unblock', task: t.id, reason: need('reason') }, 'todo'); },
  reopen() { const ctx = context(); const t = taskArg(ctx, ['done']); commit(ctx, { type: 'reopen', task: t.id, reason: need('reason') }, 'todo'); },
  drop() { const ctx = context(); const t = taskArg(ctx, ['todo', 'blocked']); commit(ctx, { type: 'drop', task: t.id, reason: need('reason') }, 'dropped'); },

  amend() {
    const ctx = context(); const t = taskArg(ctx, ['active']);
    commit(ctx, { type: 'amend', task: t.id, reason: need('reason'), acceptance_hash: hashAcceptance(t.acceptance) });
    console.log('Criteria re-locked. Re-run verify; the amendment is listed for the owner in docs/STATUS.md.');
  },

  note() {
    const ctx = context();
    const text = pos.join(' ').trim() || die('note text required: "done: … / next: … / gotchas: …"');
    commit(ctx, { type: 'note', text });
  },

  render() { fs.writeFileSync(path.join(ROOT, PATHS.status), renderStatus(loadSnapshot())); console.log(`wrote ${PATHS.status}`); },

  selftest() {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'harness', 'selftest.mjs')], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  },
};

(commands[cmd] || (() => { console.log(HELP); process.exit(cmd ? 1 : 0); }))();
