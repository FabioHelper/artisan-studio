// CI helper (T-017): installs transformers.js into a temp dir (never into the repo) and imports it in Node, the way the workflows need it.
//   const { T, dir } = await installTransformers();   // T = the library module, dir = the temp dir (holds node_modules/onnxruntime-node)
// Runs only on a machine with npm and internet (the CI runner). Nothing here is loaded by the app.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TRANSFORMERS_VERSION = '4.3.0';

export async function installTransformers({ version = TRANSFORMERS_VERSION, extra = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'macrofy-tjs-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"macrofy-tjs-tmp","private":true,"type":"module"}\n');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', `@huggingface/transformers@${version}`, ...extra], { cwd: dir, stdio: 'inherit' });
  writeFileSync(join(dir, 'loader.mjs'), "export * from '@huggingface/transformers';\n"); // resolves the package from the temp dir with import conditions
  const T = await import(pathToFileURL(join(dir, 'loader.mjs')).href);
  T.env.cacheDir = join(dir, 'cache'); T.env.allowLocalModels = false;
  return { T, dir };
}

/** Imports a package that was installed into `dir` (for example onnxruntime-node, a dependency of transformers.js). */
export async function importFrom(dir, pkg) {
  const file = join(dir, `load-${pkg.replace(/\W/g, '_')}.mjs`);
  writeFileSync(file, `import * as m from '${pkg}';\nexport default m.default ?? m;\n`); // CommonJS packages expose their exports as the default
  return (await import(pathToFileURL(file).href)).default;
}
