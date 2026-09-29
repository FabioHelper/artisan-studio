// Copies the shared sources the app needs into web/app (GitHub Pages serves only web/, and the app is one folder for the service worker).
//   node web/sync-data.mjs           copy (run after any source in COPIES changes: vocab, schema, lookup, estimate core, priors, models)
//   node web/sync-data.mjs --check   exit 1 if a copy is stale (web/selftest.mjs does the same)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // macrofy/
export const COPIES = [
  { from: 'nutrition/vocab.json', to: 'web/app/data/vocab.json' },
  { from: 'bench/schema-core.mjs', to: 'web/app/vendor/schema-core.mjs' },
  // estimation (T-013): the nutrition lookup without Node imports, the pure core, its priors and calibration, the model loader
  { from: 'nutrition/lookup-core.mjs', to: 'web/app/vendor/lookup-core.mjs' },
  { from: 'web/estimate/core.mjs', to: 'web/app/vendor/estimate-core.mjs' },
  { from: 'web/estimate/priors.json', to: 'web/app/data/priors.json' },
  { from: 'web/estimate/calibration.json', to: 'web/app/data/calibration.json' },
  { from: 'web/lib/models.mjs', to: 'web/app/vendor/models.mjs' },
  // automatic mode (T-014): the pure mask post-processing; its import of the core is renamed to the vendored file name
  { from: 'web/estimate/autoseg.mjs', to: 'web/app/vendor/autoseg.mjs', replace: [["from './core.mjs'", "from './estimate-core.mjs'"]] },
];

/** The bytes a copy must have: the source, with the copy's textual replacements applied. */
export function expectedBytes({ from, replace = [] }) {
  const src = readFileSync(join(root, from));
  if (!replace.length) return src;
  let text = src.toString('utf8');
  for (const [a, b] of replace) { if (!text.includes(a)) throw new Error(`${from}: cannot rewrite, missing ${a}`); text = text.split(a).join(b); }
  return Buffer.from(text, 'utf8');
}

/** Returns the copies that are missing or differ from their source. */
export function staleCopies() {
  return COPIES.filter(({ from, to, replace }) => !existsSync(join(root, to)) || !expectedBytes({ from, replace }).equals(readFileSync(join(root, to))));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const stale = staleCopies();
    for (const c of stale) console.error(`stale: ${c.to} differs from ${c.from}`);
    if (stale.length) { console.error('Run: node web/sync-data.mjs'); process.exit(1); }
    console.log('capture app data copies are up to date');
  } else {
    for (const c of COPIES) {
      const { from, to } = c;
      mkdirSync(dirname(join(root, to)), { recursive: true });
      writeFileSync(join(root, to), expectedBytes(c));
      console.log(`${from} -> ${to}`);
    }
  }
}
