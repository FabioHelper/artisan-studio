// Food vocabulary lookup (T-005): weighed grams -> nutrients, and volume -> grams. Node built-ins only.
// The numbers all come from vocab.json, which is generated from bundled TACO / FNDDS rows (see sources.json).
// The pure functions live in lookup-core.mjs (browser-safe); this file loads the real vocab for Node callers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLookup, normalize, UnknownFoodError, FacetMismatchError } from './lookup-core.mjs';

export { createLookup, normalize, UnknownFoodError, FacetMismatchError };

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const VOCAB = JSON.parse(fs.readFileSync(path.join(HERE, 'vocab.json'), 'utf8'));
export const { findClass, nutrientsFor, massFromVolume, truthNutrients, classes } = createLookup(VOCAB);
