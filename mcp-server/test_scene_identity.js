// P0.6-A identity, alias, namespace and cross-label adversarial suite.
// Usage: node mcp-server/test_scene_identity.js [--json]
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { WorldSession } from './WorldSession.js';
import { sanitizeRender } from './bridge.js';
import { renderEvidence } from './HeadlessRunner.js';
import {
  SceneIdentityError,
  bindEvidenceRecord,
  canonicalDependencies,
  canonicalIdentityJson,
  evidenceNamespace,
  identityHashDocument,
  resolveSceneAlias,
  runtimeSceneIdentity,
  validateSceneReference,
  verifyEvidenceWindow,
  verifySceneReference
} from '../src/contracts/sceneIdentityContract.js';
import {
  IDENTITY_DEPENDENCY_SETS,
  RENDERER_DEPENDENCIES,
  RENDERER_HASH,
  SCENE_ALIASES,
  SCENE_IDENTITIES
} from '../src/contracts/sceneIdentityManifest.generated.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, '.artisan-artifacts');
const FIXTURE = path.join(ARTIFACTS, 'dogfood', 'p1-current-harness', 'authored-world.json');
const EXPECTED_AUTHORED = 'sha256:f4bb39db91d785d657fb56059e7222f4';
const results = [];
const check = (id, name, pass, detail = '') => results.push({ id, name, pass: !!pass, detail: String(detail).slice(0, 500) });
const hash = value => 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');

function expectCode(id, name, code, fn) {
  try {
    fn();
    check(id, name, false, 'accepted unexpectedly');
  } catch (error) {
    check(id, name, error instanceof SceneIdentityError && error.code === code, error.code || error.message);
  }
}

function treeHash(root) {
  if (!fs.existsSync(root)) return hash('');
  const rows = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) rows.push([path.relative(root, absolute).replace(/\\/g, '/'), hash(fs.readFileSync(absolute))]);
    }
  };
  walk(root);
  rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return hash(rows.map(row => row[0] + String.fromCharCode(0) + row[1]).join('\n'));
}

const manifest = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const session = new WorldSession();
const authored = session.sceneReference(manifest);
const walkable = SCENE_IDENTITIES.walkableWorld;
const zone = SCENE_IDENTITIES.fantasticHallZone;
const diorama = SCENE_IDENTITIES.dioramaAdaptation;
const authoredIds = manifest.entities.map(entity => entity.id);
const render = (sceneReference, extra = {}) => ({
  sceneIdentity: sceneReference.sceneIdentity,
  sceneReference,
  zoneReference: null,
  rendererHash: sceneReference.rendererHash,
  renderPlanHash: sceneReference.renderPlanHash,
  epoch: 7,
  renderedEntityIds: extra.renderedEntityIds || ['one'],
  worldId: sceneReference.kind === 'authored-world' ? sceneReference.logicalId : null,
  version: sceneReference.contentVersion,
  ...extra
});

// Positive model and compatibility checks.
const identities = [walkable, zone, diorama, authored];
check('T-ID-1', 'four canonical identities are valid and distinct', identities.every(value => validateSceneReference(value)) && new Set(identities.map(value => value.sceneIdentity)).size === 4);
check('T-ID-2', 'ordinary authored compact identity is byte-compatible', authored.sceneIdentity === EXPECTED_AUTHORED && authored.sourceManifestHash === authored.contentHash, authored.sceneIdentity);
const deps = IDENTITY_DEPENDENCY_SETS.walkableWorld;
const reordered = [...deps].reverse();
const docA = identityHashDocument({ kind: 'walkable-world', logicalId: 'fantastic-world.walkable', contentVersion: 1, dependencies: deps });
const docB = identityHashDocument({ kind: 'walkable-world', logicalId: 'fantastic-world.walkable', contentVersion: 1, dependencies: reordered });
check('T-ID-3', 'dependency reorder is hash-neutral', canonicalIdentityJson(docA) === canonicalIdentityJson(docB));
const changed = deps.map((entry, index) => index ? entry : { ...entry, sha256: 'sha256:' + 'f'.repeat(64) });
const changedDoc = identityHashDocument({ kind: 'walkable-world', logicalId: 'fantastic-world.walkable', contentVersion: 1, dependencies: changed });
check('T-ID-4', 'dependency source change changes content hash input', hash(canonicalIdentityJson(docA)) !== hash(canonicalIdentityJson(changedDoc)));
const live = bindEvidenceRecord({ operation: 'telemetry', source: 'live', render: render(authored, { renderedEntityIds: authoredIds }), expectedScene: authored });
const headless = bindEvidenceRecord({ operation: 'telemetry', source: 'headless', render: render(authored, { renderedEntityIds: authoredIds }), expectedScene: authored });
check('T-ID-5', 'live and headless bind the same scene identity', live.sceneIdentity === headless.sceneIdentity && live.sceneReference.contentHash === headless.sceneReference.contentHash);
const gameAlias = resolveSceneAlias('mode:game', { identities: SCENE_IDENTITIES, aliases: SCENE_ALIASES });
const presetAlias = resolveSceneAlias('preset:fantastic', { identities: SCENE_IDENTITIES, aliases: SCENE_ALIASES });
check('T-ID-6', 'compatibility aliases resolve but canonical evidence never emits aliases',
  gameAlias.sceneReference.sceneIdentity === walkable.sceneIdentity
  && presetAlias.sceneReference.sceneIdentity === diorama.sceneIdentity
  && ![gameAlias.alias, presetAlias.alias].includes(live.sceneIdentity));
check('T-ID-7', 'evidence namespaces are kind-separated and content-bound',
  evidenceNamespace(walkable).startsWith('evidence/walkable-world/fantastic-world.walkable/v1/')
  && evidenceNamespace(walkable, zone).startsWith('evidence/zone/fantastic-world.fantastic-hall/v1/')
  && evidenceNamespace(diorama).startsWith('evidence/diorama-adaptation/fantastic-hall.diorama-adaptation/v2/')
  && evidenceNamespace(authored).startsWith('evidence/authored-world/' + encodeURIComponent(authored.logicalId) + '/v' + authored.contentVersion + '/'));

// Required negative/adversarial identities.
const prefixA = { ...authored, contentHash: 'sha256:' + 'a'.repeat(32) + '1'.repeat(32), sourceManifestHash: 'sha256:' + 'a'.repeat(32) + '1'.repeat(32), sceneIdentity: 'sha256:' + 'a'.repeat(32) };
const prefixB = { ...authored, contentHash: 'sha256:' + 'a'.repeat(32) + '2'.repeat(32), sourceManifestHash: 'sha256:' + 'a'.repeat(32) + '2'.repeat(32), sceneIdentity: 'sha256:' + 'a'.repeat(32) };
expectCode('T-ID-N1', 'same compact prefix with different full hashes is stale', 'IDENTITY_STALE', () => verifySceneReference(prefixA, prefixB));
expectCode('T-ID-N2', 'truncated content hash is rejected', 'IDENTITY_STALE', () => validateSceneReference({ ...diorama, contentHash: diorama.sceneIdentity }));
expectCode('T-ID-N3', 'backslash dependency path is rejected', 'IDENTITY_UNRESOLVED', () => canonicalDependencies([{ path: 'src\\main.js', sha256: 'sha256:' + '1'.repeat(64) }]));
expectCode('T-ID-N4', 'case-ambiguous dependency paths are rejected', 'IDENTITY_UNRESOLVED', () => canonicalDependencies([{ path: 'src/Main.js', sha256: 'sha256:' + '1'.repeat(64) }, { path: 'src/main.js', sha256: 'sha256:' + '2'.repeat(64) }]));
expectCode('T-ID-N5', 'duplicate dependency path is rejected', 'IDENTITY_UNRESOLVED', () => canonicalDependencies([{ path: 'src/main.js', sha256: 'sha256:' + '1'.repeat(64) }, { path: 'src/main.js', sha256: 'sha256:' + '1'.repeat(64) }]));
expectCode('T-ID-N6', 'unknown alias is rejected', 'IDENTITY_UNRESOLVED', () => resolveSceneAlias('preset:fantastic-ish', { identities: SCENE_IDENTITIES, aliases: SCENE_ALIASES }));
expectCode('T-ID-N7', 'zone parent mismatch is rejected', 'IDENTITY_PARENT_MISMATCH', () => verifySceneReference({ ...zone, parentSceneIdentity: diorama.sceneIdentity }, zone, { expectedParent: walkable }));
expectCode('T-ID-N8', 'mid-capture scene epoch change is rejected', 'IDENTITY_STALE', () => verifyEvidenceWindow(render(authored, { renderedEntityIds: authoredIds }), render(authored, { renderedEntityIds: authoredIds, epoch: 8 }), authored, authoredIds));
const forged = sanitizeRender({ ...render(authored, { renderedEntityIds: authoredIds }), sceneReference: { ...authored, contentHash: 'sha256:bad' } });
expectCode('T-ID-N9', 'forged bridge record is rejected', 'IDENTITY_UNRESOLVED', () => bindEvidenceRecord({ operation: 'telemetry', source: 'live', render: forged, expectedScene: authored }));

// Generated-module stale check uses an OS-temp candidate and never mutates the checked-in module.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan_identity_'));
try {
  const generated = path.join(ROOT, 'src', 'contracts', 'sceneIdentityManifest.generated.js');
  const stale = path.join(temp, 'sceneIdentityManifest.generated.js');
  fs.writeFileSync(stale, fs.readFileSync(generated, 'utf8') + '\n// stale adversarial candidate\n');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate_scene_identities.mjs'), '--check'], {
    cwd: ROOT,
    env: { ...process.env, ARTISAN_IDENTITY_CHECK_FILE: stale },
    encoding: 'utf8'
  });
  check('T-ID-N10', 'stale generated module fails check', run.status === 1 && /IDENTITY_STALE/.test(run.stderr), (run.stderr || run.stdout).trim());
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

// Full cross-label matrix. Every rejection happens in the pure binder before any writer can run.
const beforeArtifacts = treeHash(ARTIFACTS);
const operations = ['compile-ack', 'screenshot', 'telemetry', 'telemetry-import', 'manifest-export', 'audit', 'performance-report'];
const sources = ['live', 'headless'];
const staleDioramaHash = 'sha256:' + ('0' + diorama.contentHash.slice(8));
const staleDiorama = { ...diorama, contentHash: staleDioramaHash, sceneIdentity: runtimeSceneIdentity('diorama-adaptation', 2, staleDioramaHash) };
const cases = [
  ['walkable-to-diorama', render(walkable), diorama, 'IDENTITY_KIND_MISMATCH'],
  ['diorama-to-walkable', render(diorama), walkable, 'IDENTITY_KIND_MISMATCH'],
  ['zone-to-world', render(zone, { zoneReference: zone }), walkable, 'IDENTITY_KIND_MISMATCH'],
  ['authored-to-fantastic', render(authored, { renderedEntityIds: authoredIds }), diorama, 'IDENTITY_KIND_MISMATCH'],
  ['stale-hash', render(staleDiorama), diorama, 'IDENTITY_STALE'],
  ['legacy-alias', { sceneIdentity: 'preset:fantastic', sceneReference: null, zoneReference: null, legacy: true, epoch: 7, renderedEntityIds: ['one'] }, diorama, 'IDENTITY_UNRESOLVED']
];
let matrixPass = 0;
const failures = [];
for (const operation of operations) {
  for (const source of sources) {
    for (const [label, candidate, expected, code] of cases) {
      try {
        bindEvidenceRecord({ operation, source, render: candidate, expectedScene: expected });
        failures.push(operation + '/' + source + '/' + label + ':accepted');
      } catch (error) {
        if (error instanceof SceneIdentityError && error.code === code) matrixPass++;
        else failures.push(operation + '/' + source + '/' + label + ':' + (error.code || error.message));
      }
    }
  }
}
const matrixTotal = operations.length * sources.length * cases.length;
const afterArtifacts = treeHash(ARTIFACTS);
check('T-ID-MATRIX', 'all live/headless cross-label attempts reject before writing', matrixPass === matrixTotal && failures.length === 0, matrixPass + '/' + matrixTotal + ' ' + failures.slice(0, 4).join(' | '));
check('T-ID-NOWRITE', 'cross-label matrix leaves artifact tree byte-identical', beforeArtifacts === afterArtifacts, beforeArtifacts + ' -> ' + afterArtifacts);
check('T-ID-RENDERER', 'all generated Fantastic descriptors share the generated renderer fingerprint', identities.slice(0, 3).every(value => value.rendererHash === RENDERER_HASH));

const requiredRendererDependencies = [
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
check('T-ID-RENDERER-CLOSURE', 'renderer/evidence dependency closure is explicit, complete and path-sorted',
  JSON.stringify(RENDERER_DEPENDENCIES.map(entry => entry.path)) === JSON.stringify(requiredRendererDependencies),
  RENDERER_DEPENDENCIES.map(entry => entry.path).join(', '));

// A changed transitive dependency must make the checked-in generated identity fail verification.
const dependencyTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan_renderer_dependency_'));
try {
  const allDependencies = new Set([
    ...Object.values(IDENTITY_DEPENDENCY_SETS).flat().map(entry => entry.path),
    ...RENDERER_DEPENDENCIES.map(entry => entry.path),
    'src/contracts/sceneIdentityManifest.generated.js'
  ]);
  for (const relative of allDependencies) {
    const target = path.join(dependencyTemp, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, relative), target);
  }
  fs.appendFileSync(path.join(dependencyTemp, 'src', 'engine', 'SpatialValidator.js'), '\n// adversarial dependency mutation\n');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'generate_scene_identities.mjs'), '--check'], {
    cwd: ROOT,
    env: { ...process.env, ARTISAN_IDENTITY_ROOT: dependencyTemp },
    encoding: 'utf8'
  });
  check('T-ID-RENDERER-NEGATIVE', 'changed renderer dependency makes generated identity checking fail',
    run.status === 1 && /IDENTITY_STALE/.test(run.stderr), (run.stderr || run.stdout).trim());
} finally {
  fs.rmSync(dependencyTemp, { recursive: true, force: true });
}

async function headlessProductionBoundaryChecks() {
  const root = path.join(ARTIFACTS, `p06-headless-identity-${process.pid}-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    const walkableResult = await renderEvidence({ scene: 'mode:game', want: ['telemetry'], frames: 4 });
    check('T-ID-HEADLESS-WORLD', 'production headless route exposes The Fantastic World identity',
      walkableResult.render.sceneIdentity === walkable.sceneIdentity && walkableResult.render.sceneReference?.contentHash === walkable.contentHash && walkableResult.render.zoneReference === null);

    const zonePng = path.join(root, 'zone.png');
    const zoneResult = await renderEvidence({
      scene: zone.sceneIdentity,
      want: ['capture'],
      targets: { png: zonePng },
      envelope: value => bindEvidenceRecord({
        operation: 'screenshot', source: 'headless', render: value.render,
        expectedScene: walkable, expectedZone: zone,
        renderer: { kind: 'headless-studio', instanceId: 'test-instance', headlessRunId: value.headlessRunId },
        camera: value.capture.camera, inFrustum: value.capture.inFrustum
      })
    });
    check('T-ID-HEADLESS-ZONE', 'production headless writer emits parent-bound Hall zone camera/frustum evidence',
      fs.existsSync(zonePng)
      && zoneResult.evidence?.sceneReference?.sceneIdentity === walkable.sceneIdentity
      && zoneResult.evidence?.zoneReference?.parentSceneIdentity === walkable.sceneIdentity
      && zoneResult.evidence?.zoneEvidence?.cameraInZone === true
      && zoneResult.evidence?.inFrustum?.includes(zoneResult.evidence.zoneEvidence.zoneObjectId));

    const beforeNegative = treeHash(root);
    const staleHash = 'sha256:' + ('0' + diorama.contentHash.slice(8));
    const negativeCases = [
      ['forged', { ...diorama, contentHash: 'sha256:bad' }],
      ['stale', { ...diorama, contentHash: staleHash, sceneIdentity: runtimeSceneIdentity('diorama-adaptation', 2, staleHash) }],
      ['cross-label', walkable]
    ];
    let rejected = 0;
    for (const [label, expectedSceneReference] of negativeCases) {
      const targets = {
        png: path.join(root, label + '.png'),
        json: path.join(root, label + '.json'),
        md: path.join(root, label + '.md')
      };
      try {
        await renderEvidence({ scene: 'preset:fantastic', expectedSceneReference, want: ['capture', 'audit'], targets });
      } catch (error) {
        if (/HEADLESS_IDENTITY_MISMATCH|IDENTITY_(?:STALE|UNRESOLVED|KIND_MISMATCH)/.test(String(error.code || error.message))) rejected++;
      }
    }
    check('T-ID-HEADLESS-NEGATIVE', 'forged, stale and cross-label inputs fail in production HeadlessRunner before artifact writes',
      rejected === negativeCases.length && treeHash(root) === beforeNegative, `${rejected}/${negativeCases.length}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv.includes('--headless-e2e')) await headlessProductionBoundaryChecks();

const passed = results.filter(result => result.pass).length;
const summary = { suite: 'p06-scene-identity', passed, failed: results.length - passed, matrix: { passed: matrixPass, total: matrixTotal }, failures: results.filter(result => !result.pass) };
if (process.argv.includes('--json')) console.log(JSON.stringify({ summary, results }));
else {
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.id + ' ' + result.name + (result.pass || !result.detail ? '' : ' - ' + result.detail));
  console.log('\n' + passed + '/' + results.length + ' passed; cross-label matrix ' + matrixPass + '/' + matrixTotal);
}
process.exit(summary.failed ? 1 : 0);
