#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  CONTRACT_VERSION,
  SCENE_IDENTITY_SCHEMA_VERSION,
  canonicalJson
} from '../src/contracts/artisanContract.js';
import {
  canonicalDependencies,
  identityHashDocument,
  runtimeSceneIdentity
} from '../src/contracts/sceneIdentityContract.js';

const ROOT = process.env.ARTISAN_IDENTITY_ROOT
  ? path.resolve(process.env.ARTISAN_IDENTITY_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = 'src/contracts/sceneIdentityManifest.generated.js';

// Exact, reviewed inputs. Globs and directory discovery are intentionally forbidden.
const WALKABLE = [
  'src/game/fantastic-world/audio/ambience.js',
  'src/game/fantastic-world/core/ctx.js',
  'src/game/fantastic-world/core/palette.js',
  'src/game/fantastic-world/fx/lighting.js',
  'src/game/fantastic-world/fx/particles.js',
  'src/game/fantastic-world/interaction/interaction.js',
  'src/game/fantastic-world/main.js',
  'src/game/fantastic-world/player/avatar.js',
  'src/game/fantastic-world/player/controls.js',
  'src/game/fantastic-world/ui/bridge.js',
  'src/game/fantastic-world/ui/hud.js',
  'src/game/fantastic-world/world/exterior.js',
  'src/game/fantastic-world/world/hall.js',
  'src/game/fantastic-world/world/props.js',
  'src/game/fantastic-world/world/sky.js'
];

const HALL_ZONE = [
  'src/game/fantastic-world/interaction/interaction.js',
  'src/game/fantastic-world/main.js',
  'src/game/fantastic-world/player/controls.js',
  'src/game/fantastic-world/ui/hud.js',
  'src/game/fantastic-world/world/exterior.js',
  'src/game/fantastic-world/world/hall.js'
];

const DIORAMA = [
  'src/contracts/artisanContract.js',
  'src/engine/LightingRig.js',
  'src/engine/MaterialFoundry.js',
  'src/foundry/FantasticWorldBuilder.js',
  'src/main.js'
];

const RENDERER = [
  'mcp-server/HeadlessRunner.js',
  'mcp-server/Validator.js',
  'mcp-server/WorldSession.js',
  'mcp-server/artifacts.js',
  'mcp-server/bridge.js',
  'mcp-server/index.js',
  'src/contracts/artisanContract.js',
  'src/contracts/sceneIdentityContract.js',
  'src/engine/ArtisanProfiler.js',
  'src/engine/LightingRig.js',
  'src/engine/MaterialFoundry.js',
  'src/engine/RivaTunerOSD.js',
  'src/engine/SingleInstanceGuard.js',
  'src/engine/SpatialValidator.js',
  'src/engine/UniversalFoundry.js',
  'src/engine/WorldCompiler.js',
  'src/main.js'
];

const sha256 = value => 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
const pathSorted = list => [...list].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

function dependencyRows(label, paths) {
  if (paths.some(value => /[*?[\]{}]/.test(value))) throw new Error('IDENTITY_UNRESOLVED: globs are forbidden in ' + label);
  const sorted = pathSorted(paths);
  if (JSON.stringify(sorted) !== JSON.stringify(paths)) throw new Error('IDENTITY_STALE: ' + label + ' dependency list must be path-sorted');
  if (new Set(paths).size !== paths.length) throw new Error('IDENTITY_UNRESOLVED: duplicate dependency in ' + label);
  return canonicalDependencies(paths.map(relativePath => {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) throw new Error('IDENTITY_UNRESOLVED: missing dependency ' + relativePath);
    return { path: relativePath, sha256: sha256(fs.readFileSync(absolutePath)) };
  }));
}

function generatedReference({ kind, logicalId, contentVersion, dependencies, rendererHash, parent = null, aliases = [] }) {
  const document = identityHashDocument({
    kind,
    logicalId,
    contentVersion,
    contractVersion: CONTRACT_VERSION,
    dependencies,
    parentContentHash: parent?.contentHash || null
  });
  const contentHash = sha256(canonicalJson(document));
  return {
    identitySchemaVersion: SCENE_IDENTITY_SCHEMA_VERSION,
    kind,
    logicalId,
    contentVersion,
    contractVersion: CONTRACT_VERSION,
    contentHash,
    sceneIdentity: runtimeSceneIdentity(kind, contentVersion, contentHash),
    parentSceneIdentity: parent?.sceneIdentity || null,
    sourceManifestHash: null,
    rendererHash,
    renderPlanHash: null,
    legacyAliases: aliases
  };
}

function moduleText() {
  const dependencySets = {
    walkableWorld: dependencyRows('walkableWorld', WALKABLE),
    fantasticHallZone: dependencyRows('fantasticHallZone', HALL_ZONE),
    dioramaAdaptation: dependencyRows('dioramaAdaptation', DIORAMA)
  };
  const rendererDependencies = dependencyRows('renderer', RENDERER);
  const rendererHash = sha256(canonicalJson({
    identitySchemaVersion: SCENE_IDENTITY_SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    dependencies: rendererDependencies
  }));
  const walkableWorld = generatedReference({
    kind: 'walkable-world',
    logicalId: 'fantastic-world.walkable',
    contentVersion: 1,
    dependencies: dependencySets.walkableWorld,
    rendererHash,
    aliases: ['mode:game']
  });
  const fantasticHallZone = generatedReference({
    kind: 'zone',
    logicalId: 'fantastic-world.fantastic-hall',
    contentVersion: 1,
    dependencies: dependencySets.fantasticHallZone,
    rendererHash,
    parent: walkableWorld
  });
  const dioramaAdaptation = generatedReference({
    kind: 'diorama-adaptation',
    logicalId: 'fantastic-hall.diorama-adaptation',
    contentVersion: 2,
    dependencies: dependencySets.dioramaAdaptation,
    rendererHash,
    aliases: ['preset:fantastic']
  });
  const data = {
    generatorVersion: 1,
    identitySchemaVersion: SCENE_IDENTITY_SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    outputPath: OUTPUT,
    names: {
      walkableWorld: 'The Fantastic World',
      fantasticHallZone: 'The Fantastic Hall',
      dioramaAdaptation: 'Fantastic Hall Diorama Adaptation v2'
    },
    aliases: {
      'mode:game': 'walkableWorld',
      'preset:fantastic': 'dioramaAdaptation'
    },
    dependencySets,
    rendererDependencies,
    rendererHash,
    identities: { walkableWorld, fantasticHallZone, dioramaAdaptation }
  };
  const json = JSON.stringify(data, null, 2);
  return [
    '// GENERATED by scripts/generate_scene_identities.mjs. Do not edit by hand.',
    '// The generator file lists every dependency explicitly; this file is excluded from its own inputs.',
    'const DATA = ' + json + ';',
    'const deepFreeze = value => {',
    "  if (value && typeof value === 'object' && !Object.isFrozen(value)) {",
    '    Object.freeze(value);',
    '    for (const child of Object.values(value)) deepFreeze(child);',
    '  }',
    '  return value;',
    '};',
    'deepFreeze(DATA);',
    'export const SCENE_IDENTITY_MANIFEST = DATA;',
    'export const SCENE_IDENTITIES = DATA.identities;',
    'export const SCENE_ALIASES = DATA.aliases;',
    'export const IDENTITY_DEPENDENCY_SETS = DATA.dependencySets;',
    'export const RENDERER_DEPENDENCIES = DATA.rendererDependencies;',
    'export const RENDERER_HASH = DATA.rendererHash;',
    ''
  ].join('\n');
}

const expected = moduleText();
const write = process.argv.includes('--write');
const check = process.argv.includes('--check') || !write;
if (write) {
  fs.writeFileSync(path.join(ROOT, OUTPUT), expected, 'utf8');
  console.log('WROTE ' + OUTPUT + ' ' + sha256(expected));
}
if (check) {
  const checkPath = process.env.ARTISAN_IDENTITY_CHECK_FILE
    ? path.resolve(process.env.ARTISAN_IDENTITY_CHECK_FILE)
    : path.join(ROOT, OUTPUT);
  const actual = fs.existsSync(checkPath) ? fs.readFileSync(checkPath, 'utf8').replace(/\r\n/g, '\n') : null;
  if (actual !== expected) {
    console.error('IDENTITY_STALE: generated scene identity module is missing or differs; run node scripts/generate_scene_identities.mjs --write during implementation');
    process.exit(1);
  }
  console.log('PASS scene identity manifest: dependency order, membership and hashes match (' + sha256(expected) + ')');
}
