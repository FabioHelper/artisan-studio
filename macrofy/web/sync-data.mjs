// Copies the shared sources the capture app needs into web/app (GitHub Pages serves only web/).
//   node web/sync-data.mjs           copy (run after nutrition/vocab.json or bench/schema-core.mjs change)
//   node web/sync-data.mjs --check   exit 1 if a copy is stale (web/selftest.mjs does the same)
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // macrofy/
export const COPIES = [
  { from: 'nutrition/vocab.json', to: 'web/app/data/vocab.json' },
  { from: 'bench/schema-core.mjs', to: 'web/app/vendor/schema-core.mjs' },
];

/** Returns the copies that are missing or differ from their source. */
export function staleCopies() {
  return COPIES.filter(({ from, to }) => !existsSync(join(root, to)) || !readFileSync(join(root, from)).equals(readFileSync(join(root, to))));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const stale = staleCopies();
    for (const c of stale) console.error(`stale: ${c.to} differs from ${c.from}`);
    if (stale.length) { console.error('Run: node web/sync-data.mjs'); process.exit(1); }
    console.log('capture app data copies are up to date');
  } else {
    for (const { from, to } of COPIES) {
      mkdirSync(dirname(join(root, to)), { recursive: true });
      copyFileSync(join(root, from), join(root, to));
      console.log(`${from} -> ${to}`);
    }
  }
}
