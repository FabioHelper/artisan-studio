// Claude Code Stop hook. When this session changed macrofy/, a turn may not end while fast gates
// fail or while the latest change is newer than the latest handoff note. Silent when all is well.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readInput, readSession, writeSession, changedPaths, changedSets, committedChangeHandedOff, ROOT } from './common.mjs';
import { loadSnapshot, PATHS } from '../lib/state.mjs';
import { runGates, formatFailures } from '../lib/gates.mjs';

const MC_WRITTEN = new Set(['control/journal.jsonl', 'control/plan.json', 'docs/STATUS.md']);

let input = {};
try {
  input = await readInput();
  const sid = input.session_id || 'unknown';
  const session = readSession(sid);
  const changed = changedPaths(session);
  if (!changed.length) process.exit(0);

  const snap = loadSnapshot();
  const problems = [];
  const failures = formatFailures(runGates(snap, { fast: true }));
  if (failures) problems.push(failures);

  const { dirty, committed } = changedSets(session);
  const mtimes = dirty.filter(f => !MC_WRITTEN.has(f)).map(f => { try { return fs.statSync(path.join(ROOT, f)).mtimeMs; } catch { return 0; } });
  const latestChange = Math.max(0, ...mtimes);
  const lastNote = snap.journal.filter(e => e.type === 'note').pop();
  const noteUncommitted = lastNote && !(snap.headRead(PATHS.journal) || '').includes(`"seq":${lastNote.seq},`);
  const dirtyStale = latestChange && (!lastNote || Date.parse(lastNote.at) < latestChange);
  const committedStale = !noteUncommitted && !committedChangeHandedOff(committed.filter(f => !MC_WRITTEN.has(f)));
  if (dirtyStale || committedStale) {
    problems.push('✗ handoff: macrofy/ changed after the latest handoff note.\n    fix: node macrofy/harness/mc.mjs note "done: … / next: … / gotchas: …"  (what the next session must know)');
  }
  if (!problems.length) process.exit(0);

  const text = problems.join('\n');
  const fp = crypto.createHash('sha256').update(text).digest('hex');
  if (input.stop_hook_active && session?.last_block === fp) {
    // Same failure right after a block: the agent is stuck. Release the turn but make it loud.
    console.log(JSON.stringify({ systemMessage: `Macrofy mission control: gates still failing and no progress was made — needs a human.\n${text}` }));
    process.exit(0);
  }
  writeSession(sid, { ...(session || {}), last_block: fp });
  console.error(`Macrofy mission control blocked the end of this turn (macrofy/ changed this session):\n${text}`);
  process.exit(2);
} catch (e) {
  console.error(`macrofy stop hook error (not blocking): ${e.message}`);
  process.exit(0);
}
