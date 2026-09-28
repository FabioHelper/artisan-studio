import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.MC_ROOT
  ? path.resolve(process.env.MC_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  mission: 'control/mission.json',
  plan: 'control/plan.json',
  findings: 'control/findings.json',
  checks: 'control/checks.json',
  journal: 'control/journal.jsonl',
  status: 'docs/STATUS.md',
  cache: '.mc-cache',
};

export const TASK_STATUSES = ['todo', 'active', 'blocked', 'done', 'dropped'];
export const JOURNAL_TYPES = ['start', 'verify', 'review', 'done', 'block', 'unblock', 'reopen', 'drop', 'amend', 'note'];

export function git(args, cwd = ROOT) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

export const headSha = (cwd = ROOT) => (git(['rev-parse', '--short=12', 'HEAD'], cwd) || '').trim() || null;

export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

export const hashAcceptance = (acceptance) =>
  crypto.createHash('sha256').update(canonical(acceptance ?? [])).digest('hex').slice(0, 16);

function parseJson(text, rel) {
  if (text == null) return { __error: `${rel} is missing` };
  try { return JSON.parse(text); } catch (e) { return { __error: `${rel} is not valid JSON: ${e.message}` }; }
}

export function parseJournal(raw) {
  const entries = [];
  const errors = [];
  (raw || '').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try { entries.push(JSON.parse(line)); } catch { errors.push(`journal line ${i + 1} is not valid JSON`); }
  });
  return { entries, errors };
}

// A virtual view over the project so gates run identically on disk and on in-memory fixtures.
export function diskFiles(root = ROOT) {
  const abs = (rel) => path.join(root, rel);
  return {
    exists: (rel) => fs.existsSync(abs(rel)),
    read: (rel) => (fs.existsSync(abs(rel)) && fs.statSync(abs(rel)).isFile() ? fs.readFileSync(abs(rel), 'utf8') : null),
    list(dirRel) {
      const out = [];
      const walk = (d) => {
        if (!fs.existsSync(abs(d))) return;
        for (const e of fs.readdirSync(abs(d), { withFileTypes: true })) {
          const rel = path.posix.join(d, e.name);
          if (e.isDirectory()) walk(rel); else out.push(rel);
        }
      };
      walk(dirRel);
      return out.sort();
    },
  };
}

export function memoryFiles(map) {
  const norm = (p) => p.replace(/\/+$/, '');
  return {
    exists: (rel) => map.has(norm(rel)) || [...map.keys()].some(k => k.startsWith(norm(rel) + '/')),
    read: (rel) => (map.has(rel) ? map.get(rel) : null),
    list: (dirRel) => [...map.keys()].filter(k => k.startsWith(norm(dirRel) + '/')).sort(),
  };
}

export function gitRead(ref, rel, root = ROOT) {
  if (!ref) return null;
  return git(['show', `${ref}:./${rel}`], root);
}

export function snapshotFrom(files, { headRead = () => null, baseRead = null, root = null } = {}) {
  const journalRaw = files.read(PATHS.journal) ?? '';
  const journal = parseJournal(journalRaw);
  return {
    root,
    files,
    mission: parseJson(files.read(PATHS.mission), PATHS.mission),
    plan: parseJson(files.read(PATHS.plan), PATHS.plan),
    findings: parseJson(files.read(PATHS.findings), PATHS.findings),
    checks: parseJson(files.read(PATHS.checks), PATHS.checks),
    journalRaw,
    journal: journal.entries,
    journalErrors: journal.errors,
    headRead,
    baseRead,
  };
}

export function loadSnapshot({ root = ROOT, base = null } = {}) {
  const inRepo = git(['rev-parse', '--is-inside-work-tree'], root) !== null;
  const hasHead = inRepo && headSha(root) !== null;
  const baseOk = base && !/^0+$/.test(base) && inRepo && git(['cat-file', '-e', `${base}^{commit}`], root) !== null;
  return snapshotFrom(diskFiles(root), {
    root,
    headRead: (rel) => (hasHead ? gitRead('HEAD', rel, root) : null),
    baseRead: baseOk ? (rel) => gitRead(base, rel, root) : null,
  });
}

export const tasksById = (plan) => new Map((plan?.tasks || []).map(t => [t.id, t]));

export function deriveStatuses(plan, journal) {
  const status = new Map((plan?.tasks || []).map(t => [t.id, 'todo']));
  const next = { start: 'active', block: 'blocked', unblock: 'todo', done: 'done', reopen: 'todo', drop: 'dropped' };
  for (const e of journal) if (e.task && next[e.type] && status.has(e.task)) status.set(e.task, next[e.type]);
  return status;
}

export const needsReview = (task) =>
  task.review === 'required' || (task.acceptance || []).some(a => a.manual === true);

// The evidence a task must carry to be done: a passing verify of the currently locked criteria
// (after the latest start/amend), then an accepting review when required.
export function doneEvidence(task, journal, uptoSeq = Infinity) {
  const mine = journal.filter(e => e.task === task.id && e.seq <= uptoSeq);
  const lastStart = mine.filter(e => e.type === 'start').pop();
  if (!lastStart) return { ok: false, why: `${task.id} was never started` };
  const lock = mine.filter(e => (e.type === 'start' || e.type === 'amend') && e.seq >= lastStart.seq).pop();
  const current = hashAcceptance(task.acceptance);
  if (lock.acceptance_hash !== current) return { ok: false, why: `${task.id} acceptance criteria changed since they were locked (seq ${lock.seq}); run \`mc amend ${task.id} --reason "..."\` if intentional` };
  const verify = mine.filter(e => e.type === 'verify' && e.seq > lock.seq).pop();
  if (!verify) return { ok: false, why: `${task.id} has no verify after its criteria were locked; run \`mc verify ${task.id}\`` };
  if (!verify.pass) return { ok: false, why: `${task.id} latest verify (seq ${verify.seq}) failed; fix and re-run \`mc verify ${task.id}\`` };
  if (verify.acceptance_hash !== current) return { ok: false, why: `${task.id} latest verify checked different criteria` };
  if (needsReview(task)) {
    const review = mine.filter(e => e.type === 'review' && e.seq > verify.seq).pop();
    if (!review) return { ok: false, why: `${task.id} requires an independent review after verify (seq ${verify.seq}); see docs/runbooks/review.md` };
    if (review.verdict !== 'accept') return { ok: false, why: `${task.id} latest review rejected: ${review.notes || 'no notes'}` };
  }
  return { ok: true, verify };
}

export function writeJson(rel, obj, root = ROOT) {
  fs.writeFileSync(path.join(root, rel), JSON.stringify(obj, null, 2) + '\n');
}

export function appendJournal(entry, root = ROOT) {
  const p = path.join(root, PATHS.journal);
  const { entries } = parseJournal(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
  const full = { seq: entries.length + 1, at: new Date().toISOString(), by: agentName(), head: headSha(root), ...entry };
  fs.appendFileSync(p, JSON.stringify(full) + '\n');
  return full;
}

export function agentName() {
  if (process.env.MC_AGENT) return process.env.MC_AGENT;
  if (process.env.CLAUDECODE) return 'claude-code';
  return 'unknown';
}
