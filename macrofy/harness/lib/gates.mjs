import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PATHS, TASK_STATUSES, JOURNAL_TYPES, tasksById, deriveStatuses, doneEvidence, hashAcceptance, needsReview,
} from './state.mjs';
import { renderStatus } from './render.mjs';

const P = (msg, fix) => ({ msg, fix });
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const arr = (v) => (Array.isArray(v) ? v : []);
const parseErrors = (snap) => ['mission', 'plan', 'findings', 'checks'].map(k => snap[k]?.__error).filter(Boolean);

// ---------------------------------------------------------------- structure
function schema(snap) {
  const out = parseErrors(snap).map(e => P(e, 'Restore the file from git (`git checkout -- <file>`) or fix the JSON syntax.'));
  if (out.length) return out;
  const { mission, plan, findings, checks } = snap;
  const need = (cond, msg, fix) => { if (!cond) out.push(P(msg, fix)); };

  need(mission.schema === 'macrofy.mission/1', 'mission.json: schema must be "macrofy.mission/1"', 'Set "schema": "macrofy.mission/1".');
  need(['draft', 'approved'].includes(mission.status), 'mission.json: status must be draft|approved', 'Only the owner moves the mission to "approved".');
  need(isStr(mission.statement), 'mission.json: statement is empty', 'Write the one-paragraph mission statement.');
  need(Array.isArray(mission.goals) && mission.goals.length > 0, 'mission.json: goals must be a non-empty array', 'Add at least one goal {id:"G-n", title, measure}.');
  for (const g of arr(mission.goals)) need(/^G-\d+$/.test(g.id ?? '') && isStr(g.title) && isStr(g.measure), `mission.json: goal ${g.id ?? '?'} needs id G-n, title and measure`, 'Every goal states how success is measured.');
  if (mission.status === 'approved') need(arr(mission.non_goals).length > 0, 'mission.json: an approved mission must list non_goals', 'Record what Macrofy deliberately will not do.');

  need(plan.schema === 'macrofy.plan/1', 'plan.json: schema must be "macrofy.plan/1"', 'Set "schema": "macrofy.plan/1".');
  for (const m of arr(plan.milestones)) need(/^M\d+$/.test(m.id ?? '') && isStr(m.title), `plan.json: milestone ${m.id ?? '?'} needs id Mn and title`, 'Fix the milestone entry.');
  for (const t of arr(plan.tasks)) {
    const id = t.id ?? '?';
    need(/^T-\d{3}$/.test(id), `plan.json: task id "${id}" must match T-nnn`, 'Use the next free T-nnn id.');
    need(isStr(t.title), `plan.json: ${id} has no title`, 'Add a title.');
    need(TASK_STATUSES.includes(t.status), `plan.json: ${id} status "${t.status}" invalid`, `Use one of ${TASK_STATUSES.join('|')} (the mc CLI sets it).`);
    need(['required', 'optional'].includes(t.review), `plan.json: ${id} review must be required|optional`, 'Default to "required" for product work.');
    need(Array.isArray(t.acceptance) && t.acceptance.length > 0, `plan.json: ${id} has no acceptance criteria`, 'Every task needs observable acceptance criteria.');
    for (const a of arr(t.acceptance)) {
      need(/^A\d+$/.test(a.id ?? '') && isStr(a.criterion), `plan.json: ${id} criterion ${a.id ?? '?'} needs id An and text`, 'Fix the criterion.');
      need(isStr(a.check) !== (a.manual === true), `plan.json: ${id}/${a.id} must have exactly one of "check" or "manual": true`, 'Back every criterion by a registered check; use manual only when no automated check is possible (forces review).');
    }
  }

  need(checks.schema === 'macrofy.checks/1', 'checks.json: schema must be "macrofy.checks/1"', 'Set "schema": "macrofy.checks/1".');
  for (const c of arr(checks.checks)) need(/^[a-z0-9-]+$/.test(c.id ?? '') && Array.isArray(c.cmd) && c.cmd.length > 0 && isStr(c.description), `checks.json: check ${c.id ?? '?'} needs kebab id, argv cmd array and description`, 'cmd is an argv array run without a shell, cwd = macrofy/.');

  need(findings.schema === 'macrofy.findings/1', 'findings.json: schema must be "macrofy.findings/1"', 'Set "schema": "macrofy.findings/1".');
  for (const f of arr(findings.findings)) {
    need(/^F-\d{3}$/.test(f.id ?? '') && isStr(f.title) && ['low', 'medium', 'high', 'critical'].includes(f.severity) && ['open', 'closed'].includes(f.status) && isStr(f.evidence), `findings.json: finding ${f.id ?? '?'} needs id F-nnn, title, severity, status open|closed, evidence`, 'Fix the finding entry.');
    if (f.status === 'closed') need(isStr(f.resolution), `findings.json: closed ${f.id} has no resolution`, 'State how it was resolved and where the proof is.');
  }
  return out;
}

function references(snap) {
  if (parseErrors(snap).length) return [];
  const out = [];
  const { mission, plan, findings, checks, files } = snap;
  const ids = (xs) => arr(xs).map(x => x.id);
  for (const [name, xs] of [['goal', mission.goals], ['milestone', plan.milestones], ['task', plan.tasks], ['check', checks.checks], ['finding', findings.findings]]) {
    const seen = new Set();
    for (const id of ids(xs)) { if (seen.has(id)) out.push(P(`duplicate ${name} id ${id}`, 'Ids are never reused; pick the next free one.')); seen.add(id); }
  }
  const goals = new Set(ids(mission.goals)); const ms = new Set(ids(plan.milestones)); const tasks = new Set(ids(plan.tasks)); const chk = new Set(ids(checks.checks));
  for (const t of arr(plan.tasks)) {
    if (!ms.has(t.milestone)) out.push(P(`${t.id} milestone "${t.milestone}" does not exist`, 'Point it at an existing milestone.'));
    for (const g of arr(t.goals)) if (!goals.has(g)) out.push(P(`${t.id} serves unknown goal ${g}`, 'Reference a goal from mission.json.'));
    for (const d of arr(t.depends_on)) if (!tasks.has(d)) out.push(P(`${t.id} depends on unknown task ${d}`, 'Fix or remove the dependency.'));
    for (const a of arr(t.acceptance)) if (a.check && !chk.has(a.check)) out.push(P(`${t.id}/${a.id} uses unregistered check "${a.check}"`, 'Register it in control/checks.json first — no phantom checks.'));
    if (t.spec && !files.exists(t.spec)) out.push(P(`${t.id} spec ${t.spec} does not exist`, 'Write the spec (docs/specs/_TEMPLATE.md) or fix the path.'));
  }
  for (const f of arr(findings.findings)) {
    if (f.task && !tasks.has(f.task)) out.push(P(`${f.id} references unknown task ${f.task}`, 'Fix the task id.'));
    for (const c of arr(f.expected_failing)) if (!chk.has(c)) out.push(P(`${f.id} expects unknown check "${c}" to fail`, 'Use a registered check id.'));
  }
  return out;
}

function acyclic(snap) {
  if (parseErrors(snap).length) return [];
  const byId = tasksById(snap.plan); const state = new Map(); const out = [];
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { out.push(P(`dependency cycle: ${[...trail, id].join(' -> ')}`, 'Break the cycle; split a task if two really need each other.')); return; }
    state.set(id, 1);
    for (const d of arr(byId.get(id)?.depends_on)) if (byId.has(d)) visit(d, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id, []);
  return out;
}

function coverage(snap) {
  if (parseErrors(snap).length) return [];
  const out = []; const { mission, plan } = snap;
  const live = arr(plan.tasks).filter(t => t.status !== 'dropped');
  for (const g of arr(mission.goals)) if (!live.some(t => arr(t.goals).includes(g.id))) out.push(P(`goal ${g.id} "${g.title}" has no live task — the mission would silently lose it`, 'Plan a task that serves it, or have the owner remove the goal.'));
  for (const t of live) if (arr(t.goals).length === 0) out.push(P(`${t.id} serves no goal (scope creep)`, 'Link it to a mission goal or drop it.'));
  for (const m of arr(plan.milestones)) if (!arr(plan.tasks).some(t => t.milestone === m.id)) out.push(P(`milestone ${m.id} has no tasks`, 'Plan its tasks or remove it.'));
  return out;
}

// ---------------------------------------------------------------- journal = source of truth for status
function journalIntegrity(snap) {
  const out = snap.journalErrors.map(e => P(e, 'The journal is append-only: restore it with `git checkout -- control/journal.jsonl` and re-run the mc command.'));
  const tasks = tasksById(snap.plan);
  const needs = { block: 'reason', unblock: 'reason', reopen: 'reason', drop: 'reason', amend: 'reason', note: 'text', review: 'verdict' };
  snap.journal.forEach((e, i) => {
    if (e.seq !== i + 1) out.push(P(`journal entry ${i + 1} has seq ${e.seq}`, 'Never edit or reorder journal lines; append through the mc CLI.'));
    if (!JOURNAL_TYPES.includes(e.type) || !isStr(e.at) || !isStr(e.by)) out.push(P(`journal seq ${e.seq} lacks a valid type/at/by`, 'Append entries only through the mc CLI.'));
    if (e.type !== 'note' && !tasks.has(e.task)) out.push(P(`journal seq ${e.seq} references unknown task ${e.task}`, 'Tasks are never deleted from plan.json — drop them instead.'));
    if (needs[e.type] && !isStr(e[needs[e.type]])) out.push(P(`journal seq ${e.seq} (${e.type}) has no ${needs[e.type]}`, 'Append through the mc CLI.'));
    if (e.type === 'review' && !['accept', 'reject'].includes(e.verdict)) out.push(P(`journal seq ${e.seq} review verdict must be accept|reject`, 'Append through the mc CLI.'));
  });
  for (const [label, read] of [['HEAD', snap.headRead], ['base', snap.baseRead]]) {
    if (!read) continue;
    const prior = read(PATHS.journal);
    if (prior && !snap.journalRaw.startsWith(prior)) out.push(P(`journal is not an append-only extension of ${label}: history was edited or removed`, `Restore the ${label} content and append new entries instead.`));
  }
  return out;
}

function statusMatchesJournal(snap) {
  if (parseErrors(snap).length) return [];
  const derived = deriveStatuses(snap.plan, snap.journal); const out = [];
  for (const t of arr(snap.plan.tasks)) {
    const d = derived.get(t.id);
    if (t.status !== d) out.push(P(`${t.id} says "${t.status}" but the journal proves "${d}"`, `Status only changes through the mc CLI (start/verify/review/done/block/unblock/reopen/drop). Set it back to "${d}" and run the proper command.`));
  }
  return out;
}

function wipAndOrder(snap) {
  if (parseErrors(snap).length) return [];
  const derived = deriveStatuses(snap.plan, snap.journal); const out = [];
  const active = [...derived].filter(([, s]) => s === 'active').map(([id]) => id);
  if (active.length > 1) out.push(P(`${active.length} tasks active at once (${active.join(', ')}); WIP limit is 1`, 'Finish, block or reopen all but one — one task at a time prevents half-done work.'));
  for (const t of arr(snap.plan.tasks)) {
    if (!['active', 'done'].includes(derived.get(t.id))) continue;
    for (const d of arr(t.depends_on)) if (derived.get(d) !== 'done') out.push(P(`${t.id} is ${derived.get(t.id)} but its dependency ${d} is ${derived.get(d)}`, `Complete ${d} first, or reopen ${t.id}.`));
  }
  return out;
}

function acceptanceLocked(snap) {
  if (parseErrors(snap).length) return [];
  const out = []; const derived = deriveStatuses(snap.plan, snap.journal);
  for (const t of arr(snap.plan.tasks)) {
    if (!['active', 'done'].includes(derived.get(t.id))) continue;
    const mine = snap.journal.filter(e => e.task === t.id);
    const lastStart = mine.filter(e => e.type === 'start').pop();
    const lock = mine.filter(e => (e.type === 'start' || e.type === 'amend') && e.seq >= (lastStart?.seq ?? Infinity)).pop();
    if (lock && lock.acceptance_hash !== hashAcceptance(t.acceptance)) out.push(P(`${t.id} acceptance criteria were edited after being locked at journal seq ${lock.seq}`, `If intentional: \`node harness/mc.mjs amend ${t.id} --reason "why"\` (visible to the owner). Otherwise restore the criteria.`));
  }
  return out;
}

function doneHasEvidence(snap) {
  if (parseErrors(snap).length) return [];
  const out = []; const derived = deriveStatuses(snap.plan, snap.journal);
  for (const t of arr(snap.plan.tasks)) {
    if (derived.get(t.id) !== 'done') continue;
    const doneEntry = snap.journal.filter(e => e.task === t.id && e.type === 'done').pop();
    const ev = doneEvidence(t, snap.journal, doneEntry.seq);
    if (!ev.ok) out.push(P(`${t.id} is done without valid evidence: ${ev.why}`, `Reopen it (\`mc reopen ${t.id} --reason ...\`) and complete verify${needsReview(t) ? ' + review' : ''}.`));
  }
  return out;
}

// ---------------------------------------------------------------- documentation
const mdFiles = (files) => ['AGENTS.md', 'CLAUDE.md', 'README.md', ...files.list('docs')].filter(f => f.endsWith('.md') && files.exists(f));
// Decision records are historical snapshots: their paths are true as of their date, so they are
// exempt from link/path freshness (a rename must not force superseding an ADR).
const isRecord = (f) => f.startsWith('docs/decisions/');
const stripFences = (s) => s.replace(/```[\s\S]*?```/g, '');
const mdLinks = (s) => [...stripFences(s).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map(m => m[1]).filter(l => !/^(https?:|mailto:|#)/.test(l)).map(l => l.split('#')[0]);
const resolveRel = (from, link) => path.posix.normalize(path.posix.join(path.posix.dirname(from), link));

function docLinksAndReachability(snap) {
  const { files } = snap; const out = []; const docs = mdFiles(files);
  for (const f of docs.filter(d => !isRecord(d))) for (const l of mdLinks(files.read(f))) {
    const target = resolveRel(f, l);
    if (!target.startsWith('..') && !files.exists(target)) out.push(P(`${f} links to missing ${target}`, 'Fix or remove the link — dead links are stale docs.'));
  }
  const reached = new Set(); const queue = ['AGENTS.md', 'docs/README.md'];
  while (queue.length) {
    const f = queue.shift(); if (reached.has(f) || !files.exists(f)) continue; reached.add(f);
    if (f.endsWith('.md')) for (const l of mdLinks(files.read(f))) queue.push(resolveRel(f, l));
  }
  for (const f of docs) if (f.startsWith('docs/') && !reached.has(f) && !path.posix.basename(f).startsWith('_')) out.push(P(`${f} is an orphan (not reachable from AGENTS.md or docs/README.md)`, 'Link it from the docs index, or delete it if no longer useful.'));
  return out;
}

function docPathReferences(snap) {
  const { files } = snap; const out = [];
  for (const f of mdFiles(files)) {
    if (f === PATHS.status || isRecord(f)) continue;
    for (const m of stripFences(files.read(f)).matchAll(/`([^`\n]+)`/g)) {
      for (const tok of m[1].split(/\s+/)) {
        if (!/^[\w.-]+(\/[\w.-]+)+\/?$/.test(tok) || /^(https?|node_modules)/.test(tok)) continue;
        const rel = tok.replace(/^macrofy\//, '').replace(/\/$/, '');
        const repoLevel = snap.root ? fs.existsSync(path.resolve(snap.root, '..', tok)) : false;
        if (!files.exists(rel) && !repoLevel) out.push(P(`${f} mentions \`${tok}\` which does not exist`, 'Update the doc to the current path (or remove the reference). Use <placeholders> for examples.'));
      }
    }
  }
  return out;
}

function generatedUpToDate(snap) {
  if (parseErrors(snap).length) return [];
  const expected = renderStatus(snap);
  return snap.files.read(PATHS.status) === expected ? [] : [P(`${PATHS.status} is out of date with control/`, 'Run `node harness/mc.mjs render` (never edit it by hand).')];
}

function instructionBudgets(snap) {
  const out = [];
  for (const [f, max] of [['AGENTS.md', 120], ['CLAUDE.md', 30]]) {
    const text = snap.files.read(f);
    if (text == null) { out.push(P(`${f} is missing`, 'Restore it; it is the agent entry point.')); continue; }
    const n = text.split('\n').length;
    if (n > max) out.push(P(`${f} has ${n} lines (budget ${max})`, 'Move detail into docs/ or a runbook and link it; a long instruction file gets ignored.'));
  }
  return out;
}

function decisionRecords(snap) {
  const { files } = snap; const out = []; const nums = new Set();
  for (const f of files.list('docs/decisions').filter(f => f.endsWith('.md') && !path.posix.basename(f).startsWith('_') && path.posix.basename(f) !== 'README.md')) {
    const name = path.posix.basename(f); const m = name.match(/^(\d{4})-[a-z0-9-]+\.md$/);
    if (!m) { out.push(P(`${f} must be named NNNN-kebab-title.md`, 'Rename it.')); continue; }
    if (nums.has(m[1])) out.push(P(`duplicate ADR number ${m[1]}`, 'Use the next free number.')); nums.add(m[1]);
    const text = files.read(f); const st = text.match(/^Status:\s*(.+)$/m)?.[1]?.trim();
    if (!st || !/^(Proposed|Accepted|Deprecated|Superseded by \d{4})$/.test(st)) out.push(P(`${f} needs a line "Status: Proposed|Accepted|Deprecated|Superseded by NNNN"`, 'Add the status line.'));
    for (const [label, read] of [['HEAD', snap.headRead], ['base', snap.baseRead]]) {
      const prior = read?.(f);
      if (prior && /^Status:\s*Accepted\s*$/m.test(prior)) {
        const body = (s) => s.replace(/^Status:.*$/m, '');
        if (body(prior) !== body(text)) out.push(P(`${f} was Accepted at ${label} and its body changed`, 'Accepted ADRs are immutable: write a new ADR that supersedes it and only change this Status line.'));
      }
    }
  }
  return out;
}

function specsLinked(snap) {
  if (parseErrors(snap).length) return [];
  const used = new Set(arr(snap.plan.tasks).map(t => t.spec).filter(Boolean));
  return snap.files.list('docs/specs').filter(f => f.endsWith('.md') && !path.posix.basename(f).startsWith('_') && path.posix.basename(f) !== 'README.md' && !used.has(f))
    .map(f => P(`${f} is not the spec of any task`, 'Link it from a task in plan.json, or delete it — unowned specs rot.'));
}

// ---------------------------------------------------------------- regression (slow: executes checks)
export function runCheck(check, root) {
  const [cmd, ...args] = check.cmd;
  const t0 = Date.now();
  const r = spawnSync(cmd === 'node' ? process.execPath : cmd, args, { cwd: path.join(root, check.cwd || '.'), encoding: 'utf8', timeout: (check.timeout_s || 300) * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MC_NESTED: '1' } });
  const tail = `${r.stdout || ''}${r.stderr || ''}${r.error ? r.error.message : ''}`.trim().split('\n').slice(-15).join('\n');
  return { id: check.id, pass: r.status === 0, ms: Date.now() - t0, tail };
}

function regressions(snap) {
  if (parseErrors(snap).length || !snap.root) return [];
  const out = []; const derived = deriveStatuses(snap.plan, snap.journal);
  const byId = new Map(arr(snap.checks.checks).map(c => [c.id, c]));
  const expected = new Map();
  for (const f of arr(snap.findings.findings)) if (f.status === 'open') for (const c of arr(f.expected_failing)) expected.set(c, f.id);
  const ids = new Set(expected.keys());
  for (const t of arr(snap.plan.tasks)) if (derived.get(t.id) === 'done') for (const a of arr(t.acceptance)) if (a.check) ids.add(a.check);
  for (const id of ids) {
    const r = runCheck(byId.get(id), snap.root);
    if (!r.pass && !expected.has(id)) out.push(P(`check ${id} fails but guards done work (regression)\n${r.tail}`, `Fix the regression, or register it in findings.json with expected_failing ["${id}"] and reopen the affected task.`));
    if (r.pass && expected.has(id)) out.push(P(`check ${id} passes but finding ${expected.get(id)} still expects it to fail`, `Close ${expected.get(id)} with a resolution — the register must not lie in either direction.`));
  }
  return out;
}

export const GATES = [
  { id: 'S1-schema', title: 'control files are well-formed', fn: schema },
  { id: 'S2-references', title: 'every id reference resolves', fn: references },
  { id: 'S3-acyclic', title: 'dependency graph is acyclic', fn: acyclic },
  { id: 'S4-mission-coverage', title: 'every goal has work; all work serves a goal', fn: coverage },
  { id: 'J1-journal-integrity', title: 'journal is valid and append-only', fn: journalIntegrity },
  { id: 'J2-status-proven', title: 'plan status equals journal-derived status', fn: statusMatchesJournal },
  { id: 'J3-wip-and-order', title: 'one active task; dependencies first', fn: wipAndOrder },
  { id: 'J4-acceptance-locked', title: 'criteria not weakened silently', fn: acceptanceLocked },
  { id: 'J5-done-evidence', title: 'done tasks carry verify/review evidence', fn: doneHasEvidence },
  { id: 'D1-doc-links', title: 'doc links resolve; no orphan docs', fn: docLinksAndReachability },
  { id: 'D2-doc-paths', title: 'paths named in docs exist', fn: docPathReferences },
  { id: 'D3-generated', title: 'generated docs match their source', fn: generatedUpToDate },
  { id: 'D4-instruction-budget', title: 'agent instruction files stay small', fn: instructionBudgets },
  { id: 'D5-decisions', title: 'ADRs well-formed and immutable once accepted', fn: decisionRecords },
  { id: 'D6-specs-owned', title: 'every spec belongs to a task', fn: specsLinked },
  { id: 'R1-regressions', title: 'done work still passes; findings honest', fn: regressions, slow: true },
];

export function runGates(snap, { fast = false, only = null } = {}) {
  return GATES.filter(g => (!fast || !g.slow) && (!only || only.includes(g.id))).map(g => {
    let problems;
    try { problems = g.fn(snap); } catch (e) { problems = [P(`gate crashed: ${e.stack || e.message}`, 'Fix the harness or the malformed input it choked on.')]; }
    return { id: g.id, title: g.title, ok: problems.length === 0, problems };
  });
}

export function formatFailures(results) {
  return results.filter(r => !r.ok).flatMap(r => r.problems.map(p => `✗ ${r.id}: ${p.msg}\n    fix: ${p.fix}`)).join('\n');
}
