import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PATHS, git, headSha, parseJournal } from '../lib/state.mjs';

export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

const sessionFile = (sid) => path.join(ROOT, PATHS.cache, 'sessions', `${String(sid).replace(/[^\w.-]/g, '_')}.json`);

export function readSession(sid) {
  try { return JSON.parse(fs.readFileSync(sessionFile(sid), 'utf8')); } catch { return null; }
}

export function writeSession(sid, data) {
  fs.mkdirSync(path.dirname(sessionFile(sid)), { recursive: true });
  fs.writeFileSync(sessionFile(sid), JSON.stringify(data, null, 2));
}

export function journalLength() {
  try { return parseJournal(fs.readFileSync(path.join(ROOT, PATHS.journal), 'utf8')).entries.length; } catch { return 0; }
}

export const fullHead = () => (git(['rev-parse', 'HEAD']) || '').trim() || null;

// macrofy/ paths changed in this session, split into uncommitted work and commits since the session began.
export function changedSets(session) {
  const dirty = new Set(); const committed = new Set();
  const prefix = (git(['rev-parse', '--show-prefix']) || '').trim();
  for (const line of (git(['status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude).mc-cache']) || '').split('\n')) {
    if (line.trim()) dirty.add(line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '').slice(prefix.length));
  }
  if (session?.start_head && session.start_head !== fullHead()) {
    for (const f of (git(['diff', '--name-only', '--relative', `${session.start_head}`, 'HEAD', '--', '.']) || '').split('\n')) if (f.trim() && !dirty.has(f.trim())) committed.add(f.trim());
  }
  return { dirty: [...dirty], committed: [...committed] };
}

export function changedPaths(session) {
  const { dirty, committed } = changedSets(session);
  return [...dirty, ...committed];
}

// A committed change is handed off when a commit adding a journal note contains it
// (file mtimes are useless here: checkouts and merges rewrite them).
export function committedChangeHandedOff(paths) {
  if (!paths.length) return true;
  const lastChange = (git(['log', '-1', '--format=%H', '--', ...paths]) || '').trim();
  const noteCommit = (git(['log', '-1', '--format=%H', '-G', '"type":"note"', '--', PATHS.journal]) || '').trim();
  if (!lastChange) return true;
  if (!noteCommit) return false;
  return noteCommit === lastChange || git(['merge-base', '--is-ancestor', lastChange, noteCommit]) !== null;
}

export function transcriptMentionsMacrofy(transcriptPath) {
  try {
    const st = fs.statSync(transcriptPath);
    const fd = fs.openSync(transcriptPath, 'r');
    const len = Math.min(st.size, 8 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf.toString('utf8').includes('macrofy/');
  } catch { return false; }
}

export { ROOT, PATHS, headSha };
