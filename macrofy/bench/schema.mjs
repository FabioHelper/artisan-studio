// Benchmark manifest format (schema id macrofy.bench/1) and its validator for Node.
// All rules live in schema-core.mjs, which has no imports so the capture app can run the same code in
// the browser (web/sync-data.mjs copies it). This file adds only the Node sha256 for the frozen-test-set lock.
import { createHash } from 'node:crypto';
import * as core from './schema-core.mjs';

export * from './schema-core.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

export const testSetHash = (manifest) => core.testSetHash(manifest, sha);
/** Pure apart from hashing. Returns [{rule, msg, fix}]; empty means valid. Same options as the core. */
export const validateManifest = (manifest, opts = {}) => core.validateManifest(manifest, { ...opts, sha256: sha });
