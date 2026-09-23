import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');

// All MCP file output is confined to this directory (override with ARTISAN_ARTIFACTS_DIR).
export const ARTIFACTS_DIR = path.resolve(process.env.ARTISAN_ARTIFACTS_DIR || path.join(PROJECT_ROOT, '.artisan-artifacts'));

export function ensureArtifactsDir() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  return ARTIFACTS_DIR;
}

/**
 * Resolve a caller-supplied filename to a path strictly inside ARTIFACTS_DIR.
 * Strips directories, replaces unsafe characters, forces the expected extension.
 */
export function safeArtifactPath(requested, ext, fallbackStem = 'artifact') {
  const base = path.basename(String(requested || ''));
  let stem = base.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._]+/, '').slice(0, 80);
  if (!stem) stem = `${fallbackStem}_${Date.now()}`;
  const target = path.resolve(ARTIFACTS_DIR, `${stem}${ext}`);
  const rel = path.relative(ARTIFACTS_DIR, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('ARTIFACT_PATH_ESCAPE');
  }
  ensureArtifactsDir();
  return target;
}

// Caller-supplied artifact paths with subdirectories (SPEC-08 §7). Rejected, never silently rewritten.
const MAX_SEGMENTS = 4;
const MAX_SEGMENT_CHARS = 64;
const MAX_TOTAL_CHARS = 120;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const invalidName = (why) => new Error(`INVALID_FILENAME: ${why}`);

/** Deepest existing ancestor of `p` (p itself when it exists). */
function deepestExisting(p) {
  let cur = path.resolve(p);
  while (!fs.existsSync(cur)) {
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
  return cur;
}

/** Throws ARTIFACT_PATH_ESCAPE unless `p` (or its deepest existing ancestor) really resolves inside ARTIFACTS_DIR. Defeats junctions and symlinks. */
function assertRealInside(p) {
  const rootReal = fs.realpathSync.native(ensureArtifactsDir());
  const anchor = deepestExisting(p);
  let real = null;
  try { real = anchor ? fs.realpathSync.native(anchor) : null; } catch { real = null; }
  const rel = real === null ? '..' : path.relative(rootReal, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('ARTIFACT_PATH_ESCAPE');
}

/**
 * Resolve a caller-supplied relative artifact path ("dir/sub/name.png") inside ARTIFACTS_DIR, keeping its
 * subdirectories. At most 4 segments split on / or \; each segment is sanitized like safeArtifactPath stems
 * (plus trailing-dot stripping). Absolute paths, drive letters, UNC paths, '.'/'..' and empty segments, Windows
 * reserved names, segments over 64 chars and totals over 120 chars are rejected with INVALID_FILENAME.
 * Missing directories are created here (mkdir: false defers that to writeArtifactAt). Returns
 * { path, relative, normalized } where normalized is true when characters were substituted.
 */
export function safeArtifactRelPath(requested, ext, fallbackStem = 'artifact', { mkdir = true } = {}) {
  const raw = requested === undefined || requested === null ? '' : String(requested);
  if (!raw) {
    const target = path.resolve(ARTIFACTS_DIR, `${fallbackStem}_${Date.now()}${ext}`);
    if (mkdir) ensureArtifactsDir();
    return { path: target, relative: path.basename(target), normalized: false };
  }
  if (raw.length > MAX_TOTAL_CHARS) throw invalidName(`at most ${MAX_TOTAL_CHARS} characters`);
  if (/^[A-Za-z]:/.test(raw)) throw invalidName('drive letters are not allowed');
  if (/^[\\/]/.test(raw)) throw invalidName('absolute and UNC paths are not allowed');
  const segments = raw.split(/[\\/]/);
  if (segments.length > MAX_SEGMENTS) throw invalidName(`at most ${MAX_SEGMENTS} path segments`);
  let normalized = false;
  const clean = segments.map((seg, i) => {
    if (seg === '') throw invalidName('empty path segment');
    if (seg === '.' || seg === '..') throw invalidName(`'${seg}' segments are not allowed`);
    if (seg.length > MAX_SEGMENT_CHARS) throw invalidName(`segment longer than ${MAX_SEGMENT_CHARS} characters`);
    const stem = i === segments.length - 1 ? seg.replace(/\.[^.]*$/, '') : seg;
    const safe = stem.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._]+/, '').replace(/\.+$/, '');
    if (!safe) throw invalidName(`segment '${seg.slice(0, 40)}' is empty after sanitizing`);
    if (RESERVED_NAMES.test(safe.split('.')[0])) throw invalidName(`'${seg.slice(0, 40)}' is a reserved device name`);
    if (safe !== stem) normalized = true;
    return safe;
  });
  const relative = [...clean.slice(0, -1), `${clean[clean.length - 1]}${ext}`].join('/');
  const target = path.resolve(ARTIFACTS_DIR, ...relative.split('/'));
  if (!isInsideArtifacts(target)) throw new Error('ARTIFACT_PATH_ESCAPE');
  const dir = path.dirname(target);
  assertRealInside(dir);
  if (mkdir) {
    fs.mkdirSync(dir, { recursive: true });
    assertRealInside(dir);
  }
  return { path: target, relative, normalized };
}

/** True when `target` resolves strictly inside ARTIFACTS_DIR (never the root itself, never outside). */
export function isInsideArtifacts(target) {
  const rel = path.relative(ARTIFACTS_DIR, path.resolve(String(target || '')));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Throws ARTIFACT_PATH_ESCAPE unless `target` is inside ARTIFACTS_DIR. */
export function assertInsideArtifacts(target) {
  if (!isInsideArtifacts(target)) throw new Error('ARTIFACT_PATH_ESCAPE');
  return path.resolve(target);
}

export function writeArtifact(requested, ext, data, fallbackStem) {
  const target = assertInsideArtifacts(safeArtifactPath(requested, ext, fallbackStem));
  fs.writeFileSync(target, data);
  return target;
}

/**
 * Writes to a path previously produced by safeArtifactPath()/safeArtifactRelPath(), re-checking confinement at
 * write time: lexically, and by realpath of the parent directory and of any existing target (junction/symlink safe).
 */
export function writeArtifactAt(target, data) {
  const resolved = assertInsideArtifacts(target);
  ensureArtifactsDir();
  const dir = path.dirname(resolved);
  assertRealInside(dir);
  fs.mkdirSync(dir, { recursive: true });
  assertRealInside(dir);
  if (fs.existsSync(resolved)) assertRealInside(resolved);
  fs.writeFileSync(resolved, data);
  return resolved;
}

// This module is the ONLY mcp-server module allowed to mutate the filesystem (SOL-FIX-2);
// scripts/check_contract_drift.mjs parses every other non-test module and fails on any fs write API,
// fs alias, child_process import, or page.screenshot/pdf call that could take a `path`.
const BROWSER_PROFILE_PREFIX = 'artisan_mcp_';

function isBrowserProfileDir(dir) {
  const resolved = path.resolve(String(dir || ''));
  return path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith(BROWSER_PROFILE_PREFIX);
}

/** Creates a throwaway browser profile directory directly under the OS temp dir. */
export function createBrowserProfileDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), BROWSER_PROFILE_PREFIX));
}

/** Removes a directory created by createBrowserProfileDir(); refuses anything else. */
export function removeBrowserProfileDir(dir, callback = () => {}) {
  if (!isBrowserProfileDir(dir)) throw new Error('BROWSER_PROFILE_ESCAPE');
  fs.rm(path.resolve(dir), { recursive: true, force: true }, callback);
}
