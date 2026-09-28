// Claude Code SessionStart hook. Records where the session began (for the Stop gate) and puts
// Macrofy's mission back into context after compaction/resume, when the session is working on it.
import { readInput, readSession, writeSession, journalLength, fullHead, changedPaths, transcriptMentionsMacrofy } from './common.mjs';
import { loadSnapshot } from '../lib/state.mjs';
import { runGates } from '../lib/gates.mjs';
import { renderBrief } from '../lib/render.mjs';

const POINTER = 'Macrofy (separate project in macrofy/, unrelated to Artisan Studio): before working on it, run `node macrofy/harness/mc.mjs brief` and follow macrofy/AGENTS.md.';

try {
  const input = await readInput();
  const sid = input.session_id || 'unknown';
  const source = input.source || 'startup';
  let session = readSession(sid);
  if (!session || source === 'startup' || source === 'clear') {
    session = { start_head: fullHead(), journal_len: journalLength(), started_at: new Date().toISOString() };
    writeSession(sid, session);
  }
  let context = POINTER;
  if ((source === 'compact' || source === 'resume') && (changedPaths(session).length || transcriptMentionsMacrofy(input.transcript_path))) {
    const snap = loadSnapshot();
    context = `${renderBrief(snap, runGates(snap, { fast: true }))}\n(Re-injected after ${source}: this session is working on Macrofy. Commands run from macrofy/.)`;
  }
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
} catch {
  process.exit(0);
}
