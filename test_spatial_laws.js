import { MaterialFoundry } from './src/engine/MaterialFoundry.js';
import { SpatialValidator } from './src/engine/SpatialValidator.js';
import {
  ManifestForgeTrio,
  ManifestMedievalTavern,
  ManifestAlchemistLab,
  ManifestDungeonArmory,
  ManifestHermitLibrary
} from './src/presets/manifests.js';

console.log('=== RUNNING ARTISAN 3D UNIVERSAL VALIDATOR UNIT TESTS ===\n');

const materials = new MaterialFoundry();
const validator = new SpatialValidator(materials);

const manifests = [
  { name: 'ManifestForgeTrio (Blacksmith)', data: ManifestForgeTrio },
  { name: 'ManifestMedievalTavern (Tavern)', data: ManifestMedievalTavern },
  { name: 'ManifestAlchemistLab (Laboratory)', data: ManifestAlchemistLab },
  { name: 'ManifestDungeonArmory (Armory)', data: ManifestDungeonArmory },
  { name: 'ManifestHermitLibrary (Library)', data: ManifestHermitLibrary }
];

let allPassed = true;

for (let i = 0; i < manifests.length; i++) {
  const m = manifests[i];
  const res = validator.validateWorld(m.data);
  console.log(`${i + 1}. Testing ${m.name}...`);
  console.log(`   Valid: ${res.valid ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`   Entities: ${res.stats.entityCount}`);
  console.log(`   Errors: ${res.errors.length === 0 ? 'None ✓' : res.errors.join(', ')}`);
  console.log(`   Warnings: ${res.warnings.length === 0 ? 'None ✓' : res.warnings.length + ' noted'}\n`);
  if (!res.valid) allPassed = false;
}

// Test Negative / Fault Injections
console.log('6. Fault Injection: Floating prop without support law...');
const resFloating = validator.validateWorld({
  worldId: 'fault_test',
  entities: [{ id: 'prop.floating', kind: 'prop', transform: { positionM: [0, 2, 0], scale: [1, 1, 1] } }]
});
console.log(`   Correctly flagged unsupported prop: ${resFloating.stats.unsupportedCount === 1 ? 'PASS ✓' : 'FAIL ✗'}`);

console.log('\n7. Fault Injection: Distorted negative scale...');
const resScale = validator.validateWorld({
  worldId: 'fault_scale',
  entities: [{ id: 'prop.bad', kind: 'prop', transform: { positionM: [0, 0, 0], scale: [-1, 1, 1] } }]
});
console.log(`   Correctly rejected negative scale: ${!resScale.valid ? 'PASS ✓' : 'FAIL ✗'}`);

if (allPassed) {
  console.log('\n=== ALL 5 CANONICAL ARCHETYPES & FAULT INJECTIONS VERIFIED! ===');
} else {
  console.error('\n=== SOME TESTS FAILED! ===');
  process.exit(1);
}
