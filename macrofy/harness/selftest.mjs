// Negative fixtures: every gate must pass on a known-good project and fail on a known-bad one.
// A gate that has never been observed failing is unverified, so uncovered gates fail this suite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { memoryFiles, snapshotFrom, hashAcceptance } from './lib/state.mjs';
import { GATES, runGates, formatFailures } from './lib/gates.mjs';
import { renderStatus } from './lib/render.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-selftest-'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const ok = ['node', '-e', 'process.exit(0)'];
const bad = ['node', '-e', 'process.exit(1)'];

function baseline() {
  const acc1 = [{ id: 'A1', criterion: 'c1 passes', check: 'c1' }];
  const acc2 = [{ id: 'A1', criterion: 'owner confirms', manual: true }];
  const h1 = hashAcceptance(acc1);
  const at = '2026-01-01T00:00:00.000Z';
  return {
    mission: { schema: 'macrofy.mission/1', status: 'draft', statement: 'fixture mission', goals: [{ id: 'G-1', title: 'goal', measure: 'measured' }], non_goals: [], constraints: [] },
    plan: {
      schema: 'macrofy.plan/1', milestones: [{ id: 'M0', title: 'm0' }],
      tasks: [
        { id: 'T-001', milestone: 'M0', title: 'first', goals: ['G-1'], status: 'done', review: 'optional', depends_on: [], spec: 'docs/specs/SPEC-T-001.md', acceptance: acc1 },
        { id: 'T-002', milestone: 'M0', title: 'second', goals: ['G-1'], status: 'todo', review: 'required', depends_on: ['T-001'], spec: null, acceptance: acc2 },
        { id: 'T-003', milestone: 'M0', title: 'third', goals: ['G-1'], status: 'todo', review: 'optional', depends_on: [], spec: null, acceptance: acc1 },
      ],
    },
    checks: { schema: 'macrofy.checks/1', checks: [{ id: 'c1', cmd: ok, description: 'ok' }, { id: 'c2', cmd: ok, description: 'ok too' }] },
    findings: { schema: 'macrofy.findings/1', findings: [] },
    journal: [
      { seq: 1, at, by: 't', type: 'start', task: 'T-001', acceptance_hash: h1 },
      { seq: 2, at, by: 't', type: 'verify', task: 'T-001', pass: true, acceptance_hash: h1, results: [] },
      { seq: 3, at, by: 't', type: 'done', task: 'T-001', verify_seq: 2 },
      { seq: 4, at, by: 't', type: 'note', text: 'handoff' },
    ],
    docs: {
      'AGENTS.md': 'Start at [docs](docs/README.md). Run `harness/mc.mjs`.\n',
      'CLAUDE.md': '@AGENTS.md\n',
      'README.md': 'Human readme.\n',
      'harness/mc.mjs': '// fixture\n',
      'docs/README.md': '- [status](STATUS.md)\n- [adr](decisions/0001-first.md)\n- [spec](specs/SPEC-T-001.md)\n',
      'docs/decisions/0001-first.md': '# ADR 1\n\nStatus: Accepted\n\nBody.\n',
      'docs/specs/SPEC-T-001.md': '# Spec\n',
      'docs/specs/_TEMPLATE.md': '# Template\n',
    },
    head: {},
    statusOverride: null,
  };
}

function build(state) {
  const map = new Map(Object.entries(state.docs));
  const raw = (x) => (typeof x === 'string' ? x : JSON.stringify(x));
  map.set('control/mission.json', raw(state.mission));
  map.set('control/plan.json', raw(state.plan));
  map.set('control/checks.json', raw(state.checks));
  map.set('control/findings.json', raw(state.findings));
  map.set('control/journal.jsonl', state.journal.map(e => JSON.stringify(e)).join('\n') + '\n');
  const opts = { root: tmp, headRead: (rel) => state.head[rel] ?? null };
  map.set('docs/STATUS.md', state.statusOverride ?? renderStatus(snapshotFrom(memoryFiles(map), opts)));
  return snapshotFrom(memoryFiles(map), opts);
}

const task = (s, id) => s.plan.tasks.find(t => t.id === id);
const push = (s, e) => s.journal.push({ seq: s.journal.length + 1, at: '2026-01-02T00:00:00.000Z', by: 't', ...e });

const CASES = [
  ['S1-schema', 'goal list empty', s => { s.mission.goals = []; }],
  ['S1-schema', 'criterion has both check and manual', s => { task(s, 'T-003').acceptance[0].manual = true; }],
  ['S1-schema', 'plan.json unparsable', s => { s.plan = '{'; }],
  ['S2-references', 'unknown dependency', s => { task(s, 'T-003').depends_on = ['T-999']; }],
  ['S2-references', 'phantom check', s => { task(s, 'T-003').acceptance[0].check = 'ghost'; }],
  ['S2-references', 'missing spec file', s => { task(s, 'T-003').spec = 'docs/specs/none.md'; }],
  ['S3-acyclic', 'cycle', s => { task(s, 'T-003').depends_on = ['T-002']; task(s, 'T-002').depends_on = ['T-003']; }],
  ['S4-mission-coverage', 'goal without work', s => { s.mission.goals.push({ id: 'G-2', title: 'orphan goal', measure: 'm' }); }],
  ['S4-mission-coverage', 'task without goal', s => { task(s, 'T-003').goals = []; }],
  ['J1-journal-integrity', 'seq rewritten', s => { s.journal[1].seq = 9; }],
  ['J1-journal-integrity', 'history removed vs HEAD', s => { s.head['control/journal.jsonl'] = s.journal.map(e => JSON.stringify(e)).join('\n') + '\n'; s.journal.pop(); }],
  ['J1-journal-integrity', 'block without reason', s => { push(s, { type: 'block', task: 'T-003' }); task(s, 'T-003').status = 'blocked'; }],
  ['J2-status-proven', 'status hand-edited to done', s => { task(s, 'T-003').status = 'done'; }],
  ['J3-wip-and-order', 'two active tasks', s => { push(s, { type: 'start', task: 'T-002', acceptance_hash: hashAcceptance(task(s, 'T-002').acceptance) }); push(s, { type: 'start', task: 'T-003', acceptance_hash: hashAcceptance(task(s, 'T-003').acceptance) }); task(s, 'T-002').status = 'active'; task(s, 'T-003').status = 'active'; }],
  ['J3-wip-and-order', 'active before dependency done', s => { push(s, { type: 'reopen', task: 'T-001', reason: 'r' }); task(s, 'T-001').status = 'todo'; push(s, { type: 'start', task: 'T-002', acceptance_hash: hashAcceptance(task(s, 'T-002').acceptance) }); task(s, 'T-002').status = 'active'; }],
  ['J4-acceptance-locked', 'criteria weakened after lock', s => { task(s, 'T-001').acceptance[0].criterion = 'weaker'; }],
  ['J5-done-evidence', 'done after failing verify', s => { s.journal[1].pass = false; }],
  ['J5-done-evidence', 'done without required review', s => { const h = hashAcceptance(task(s, 'T-002').acceptance); push(s, { type: 'start', task: 'T-002', acceptance_hash: h }); push(s, { type: 'verify', task: 'T-002', pass: true, acceptance_hash: h, results: [] }); push(s, { type: 'done', task: 'T-002' }); task(s, 'T-002').status = 'done'; }],
  ['D1-doc-links', 'dead link', s => { s.docs['docs/README.md'] += '- [gone](gone.md)\n'; }],
  ['D1-doc-links', 'orphan doc', s => { s.docs['docs/runbooks/lost.md'] = '# lost\n'; }],
  ['D2-doc-paths', 'doc names a missing path', s => { s.docs['AGENTS.md'] += 'See `harness/removed.mjs`.\n'; }],
  ['D3-generated', 'STATUS.md hand-edited', s => { s.statusOverride = '# edited by hand\n'; }],
  ['D4-instruction-budget', 'AGENTS.md bloated', s => { s.docs['AGENTS.md'] += 'rule\n'.repeat(150); }],
  ['D5-decisions', 'accepted ADR rewritten', s => { s.head['docs/decisions/0001-first.md'] = s.docs['docs/decisions/0001-first.md']; s.docs['docs/decisions/0001-first.md'] = '# ADR 1\n\nStatus: Accepted\n\nRewritten.\n'; }],
  ['D5-decisions', 'ADR without status', s => { s.docs['docs/decisions/0002-second.md'] = '# ADR 2\n'; s.docs['docs/README.md'] += '- [adr2](decisions/0002-second.md)\n'; }],
  ['D6-specs-owned', 'spec owned by no task', s => { s.docs['docs/specs/SPEC-stray.md'] = '# stray\n'; s.docs['docs/README.md'] += '- [stray](specs/SPEC-stray.md)\n'; }],
  ['R1-regressions', 'done work now fails', s => { s.checks.checks[0].cmd = bad; }],
  ['R1-regressions', 'finding expects a passing check to fail', s => { s.findings.findings.push({ id: 'F-001', title: 'stale', severity: 'low', status: 'open', evidence: 'e', expected_failing: ['c2'] }); }],
];

let failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL ${msg}`); };

const good = runGates(build(baseline()));
if (good.every(r => r.ok)) console.log(`PASS baseline — all ${good.length} gates pass on the known-good fixture`);
else fail(`baseline should pass:\n${formatFailures(good)}`);

const exercised = new Set();
for (const [gate, name, mutate] of CASES) {
  const s = clone(baseline()); mutate(s);
  const r = runGates(build(s), { only: [gate] })[0];
  if (r.ok) fail(`${gate} did not catch: ${name}`);
  else if (r.problems.some(p => p.msg.startsWith('gate crashed'))) fail(`${gate} crashed instead of catching: ${name}\n${formatFailures([r])}`);
  else { exercised.add(gate); console.log(`PASS ${gate} catches: ${name}`); }
}
for (const g of GATES) if (!exercised.has(g.id)) fail(`${g.id} has no negative fixture — it is unverified`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} selftest failure(s)` : `\nselftest OK — ${CASES.length} negative fixtures, ${GATES.length}/${GATES.length} gates proven able to fail`);
process.exit(failures ? 1 : 0);
