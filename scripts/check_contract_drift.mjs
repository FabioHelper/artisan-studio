// Contract drift check: engine, MCP, skill/plugin and docs must agree with
// src/contracts/artisanContract.js. Usage: node scripts/check_contract_drift.mjs [--json]
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as THREE from 'three';
import { parseAst } from 'rollup/parseAst';
import * as C from '../src/contracts/artisanContract.js';
import * as Presets from '../src/presets/manifests.js';
import { validateWorld } from '../mcp-server/Validator.js';
import { MaterialFoundry } from '../src/engine/MaterialFoundry.js';
import { SpatialValidator } from '../src/engine/SpatialValidator.js';
import { WorldCompiler } from '../src/engine/WorldCompiler.js';
import { LightingRig } from '../src/engine/LightingRig.js';
import * as I from '../src/contracts/sceneIdentityContract.js';
import * as G from '../src/contracts/sceneIdentityManifest.generated.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
const diff = (a, b) => [...a].filter(x => !b.has(x));

// P0.6-A identity contract: generated descriptors, compatibility aliases and dependency closure.
const generatedIdentities = Object.values(G.SCENE_IDENTITIES);
check('identity: schema v1 exposes three distinct Fantastic descriptors',
  C.SCENE_IDENTITY_SCHEMA_VERSION === 1 && generatedIdentities.length === 3
  && new Set(generatedIdentities.map(value => I.validateSceneReference(value).sceneIdentity)).size === 3);
check('identity: aliases are input-only and point at declared legacy aliases',
  Object.entries(G.SCENE_ALIASES).every(([alias, key]) => G.SCENE_IDENTITIES[key]?.legacyAliases.includes(alias))
  && G.SCENE_ALIASES['mode:game'] === 'walkableWorld'
  && G.SCENE_ALIASES['preset:fantastic'] === 'dioramaAdaptation');
const generatedDependencyLists = [...Object.values(G.IDENTITY_DEPENDENCY_SETS), G.RENDERER_DEPENDENCIES];
check('identity: generated dependencies are explicit, unique and path-sorted',
  generatedDependencyLists.every(list => {
    const paths = list.map(row => row.path);
    return paths.length === new Set(paths).size
      && JSON.stringify(paths) === JSON.stringify([...paths].sort())
      && paths.every(value => !/[*?[\]{}\\]/.test(value));
  }));
check('identity: generated module is excluded from every source set',
  generatedDependencyLists.every(list => !list.some(row => row.path === 'src/contracts/sceneIdentityManifest.generated.js')));
check('identity: zone is content-bound to the walkable parent',
  G.SCENE_IDENTITIES.fantasticHallZone.parentSceneIdentity === G.SCENE_IDENTITIES.walkableWorld.sceneIdentity
  && I.evidenceNamespace(G.SCENE_IDENTITIES.walkableWorld, G.SCENE_IDENTITIES.fantasticHallZone).includes('/' + I.hashHex(G.SCENE_IDENTITIES.walkableWorld.contentHash) + '/'));

// 1. Materials: engine registry == contract catalog
const foundry = new MaterialFoundry();
const engineMats = new Set(foundry.materials.keys());
const contractMats = new Set(Object.keys(C.MATERIAL_CATALOG));
check('materials: engine ⊆ contract', diff(engineMats, contractMats).length === 0, diff(engineMats, contractMats).join(','));
check('materials: contract ⊆ engine', diff(contractMats, engineMats).length === 0, diff(contractMats, engineMats).join(','));

// 1b. Material VALUES: every record carries the comparable PBR fields, and MaterialFoundry's construction
// values agree with the contract (register() applies the canonical fields and records any disagreement).
const COMPARABLE = ['color', 'roughness', 'metalness'];
const incomplete = Object.entries(C.MATERIAL_CATALOG).filter(([, m]) => COMPARABLE.some(k => m[k] === undefined) || (m.emissive === undefined) !== (m.emissiveIntensity === undefined)).map(([id]) => id);
check('materials: every record has comparable PBR fields', incomplete.length === 0, incomplete.join(','));
const hexOf = (c) => `#${c.getHexString().toUpperCase()}`;
const valueMismatch = [...foundry.materials.entries()].filter(([id, m]) => {
  const spec = C.MATERIAL_CATALOG[id];
  return !spec || hexOf(m.color) !== spec.color || m.roughness !== spec.roughness || m.metalness !== spec.metalness
    || hexOf(m.emissive) !== (spec.emissive || '#000000') || (spec.emissive !== undefined && m.emissiveIntensity !== spec.emissiveIntensity);
}).map(([id]) => id);
check(`materials: live comparable values match contract (${contractMats.size - valueMismatch.length}/${contractMats.size})`, valueMismatch.length === 0, valueMismatch.join(','));
check('materials: MaterialFoundry construction agrees with contract (Node; textured fallbacks excluded)', foundry.contractDrift.length === 0, JSON.stringify(foundry.contractDrift.slice(0, 4)));

// 2. Archetypes: EXECUTE every catalog route, observe which real builder ran (UniversalFoundry build*
// method or WorldCompiler inline compound), and compare it to the contract's independent
// ARCHETYPE_EXPECTED_ROUTES oracle — never to WorldCompiler's own route labels (SOL-FIX-1).
const compiler = new WorldCompiler(foundry);
const calls = [];
const foundryBuilders = new Set();
for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(compiler.foundry))) {
  if (!k.startsWith('build') || typeof compiler.foundry[k] !== 'function') continue;
  foundryBuilders.add(k);
  const orig = compiler.foundry[k].bind(compiler.foundry);
  compiler.foundry[k] = (...a) => { calls.push({ kind: 'foundry', route: k }); return orig(...a); };
}
const INLINE = WorldCompiler.INLINE_BUILDERS;
const inlineOriginals = { ...INLINE };
for (const k of Object.keys(inlineOriginals)) INLINE[k] = (...a) => { calls.push({ kind: 'inline', route: k }); return inlineOriginals[k](...a); };

/** Compiles every catalog id and returns each disagreement with the oracle (first builder that ran). */
function verifyRoutes(comp, oracle) {
  const bad = [];
  for (const id of Object.keys(C.ARCHETYPE_CATALOG)) {
    const want = oracle[id];
    calls.length = 0;
    let group = null, err = null;
    try { group = comp.compileEntity({ id: `${id}.probe`, assetRef: id }); } catch (e) { err = e.message; }
    let meshes = 0;
    group?.traverse(o => { if (o.isMesh) meshes++; });
    const got = calls[0];
    const ok = want && !err && meshes > 0 && got && got.kind === want.kind && got.route === want.route;
    if (!ok) bad.push(`${id}→${err ? 'ERR ' + err.slice(0, 60) : (got ? `${got.kind}:${got.route}` : 'none')} (want ${want ? `${want.kind}:${want.route}` : 'NO ORACLE ENTRY'})`);
  }
  return bad;
}

const ORACLE = C.ARCHETYPE_EXPECTED_ROUTES;
const catalogIds = new Set(Object.keys(C.ARCHETYPE_CATALOG)), oracleIds = new Set(Object.keys(ORACLE));
check('route oracle: keys equal ARCHETYPE_CATALOG exactly', diff(catalogIds, oracleIds).length === 0 && diff(oracleIds, catalogIds).length === 0,
  `missing: ${diff(catalogIds, oracleIds).join(',')}; extra: ${diff(oracleIds, catalogIds).join(',')}`);
const phantom = Object.entries(ORACLE).filter(([, r]) => r.kind === 'foundry' ? !foundryBuilders.has(r.route) : !(r.route in inlineOriginals)).map(([id, r]) => `${id}:${r.route}`);
check('route oracle: every expected builder really exists', phantom.length === 0, phantom.join(','));
const temporary = Object.entries(ORACLE).filter(([, r]) => r.temporary).map(([id]) => id).sort();
check('route oracle: temporary P0 routes are exactly arch.balcony_window (inline) + arch.tokyo_walls (full shell)',
  temporary.join(',') === 'arch.balcony_window,arch.tokyo_walls' && ORACLE['arch.balcony_window'].kind === 'inline' && ORACLE['arch.tokyo_walls'].route === 'buildTokyoApartmentShell', temporary.join(','));
const misrouted = verifyRoutes(compiler, ORACLE);
check(`archetypes: all ${catalogIds.size} catalog ids run the builder the independent oracle expects`, misrouted.length === 0, misrouted.join(' | '));
const labelDrift = Object.keys(ORACLE).filter(id => WorldCompiler.routeFor(id) !== ORACLE[id].route);
check('compiler: route-table labels agree with the oracle (documentation consistency only)', labelDrift.length === 0, labelDrift.join(','));

// 2a. Negative fixtures: a known id deliberately mapped to the WRONG real builder must fail, even when
// the mis-mapped table entry keeps the correct-looking label (the self-agreeing case Sol flagged).
const R = WorldCompiler.ROUTES;
const ROUTE_FIXTURES = {
  'furniture.table built by buildChest, label still buildTable': { 'furniture.table': { route: 'buildTable', build: R['storage.chest'].build } },
  'arch.tokyo_walls built by buildTatamiFloor, label still buildTokyoApartmentShell': { 'arch.tokyo_walls': { route: 'buildTokyoApartmentShell', build: R['arch.tatami_floor'].build } },
  'decor.woven_rug built by inline compileFramedPanel, label still compileRug': { 'decor.woven_rug': { route: 'compileRug', build: R['painting.sun_mountain_01'].build } }
};
for (const [label, override] of Object.entries(ROUTE_FIXTURES)) {
  const bad = new WorldCompiler(foundry);
  bad.foundry = compiler.foundry; // same spied builders
  bad.routes = { ...R, ...override };
  const found = verifyRoutes(bad, ORACLE);
  const [id] = Object.keys(override);
  check(`negative fixture: ${label} → routing check fails`, found.length === 1 && found[0].startsWith(`${id}→`), found.join(' | ') || 'NOT DETECTED');}
for (const k of Object.keys(inlineOriginals)) INLINE[k] = inlineOriginals[k];
const compilerSrc = read('src/engine/WorldCompiler.js');
check('compiler: no substring routing', !/ref\.includes\(/.test(compilerSrc));

// 2b. Adversarial ids must fail on EVERY path: MCP validator, browser validator, compile, compileEntity.
const ADVERSARIAL = ['unknown.table', 'unknown.lantern', 'primitive.box', 'totally.alchemist_shell.fake'];
const sv0 = new SpatialValidator(foundry);
for (const bad of ADVERSARIAL) {
  const world = { worldId: 'adversarial_probe', version: 1, entities: [{ id: 'probe.001', kind: 'prop', assetRef: bad, transform: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] }, relationships: [{ type: 'supported_by', target: 'ground.stone' }] }] };
  const paths = {};
  paths.validateWorld = !validateWorld(world).valid;
  paths.browserValidator = !sv0.validateWorld(world).valid;
  try { compiler.compile(world); paths.compile = false; } catch { paths.compile = true; }
  calls.length = 0;
  try { compiler.compileEntity(world.entities[0]); paths.compileEntity = false; } catch { paths.compileEntity = calls.length === 0; }
  const failedOpen = Object.entries(paths).filter(([, rejected]) => !rejected).map(([k]) => k);
  check(`adversarial '${bad}' rejected by validateWorld, browser validator, compile and compileEntity`, failedOpen.length === 0, `accepted by: ${failedOpen.join(',')}`);
}

// 2c. Lighting matrix: complete, bounded exposure, dual temperature, no flat white ambient, real mode response.
const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const warm = (h) => { const [r, , b] = rgb(h); return r > b; };
const cool = (h) => { const [r, , b] = rgb(h); return b > r; };
const lightingIssues = [];
for (const fam of C.LIGHTING_FAMILIES) {
  const row = C.LIGHTING_PROFILES[fam];
  if (!row) { lightingIssues.push(`${fam}: missing`); continue; }
  for (const preset of C.LIGHTING_PRESETS) {
    const p = row[preset];
    if (!p) { lightingIssues.push(`${fam}/${preset}: missing`); continue; }
    if (fam === 'fantastic') continue; // frozen pre-SPEC-07 values; the walkable world is out of P0 scope
    if (p.exposure < C.EXPOSURE_RANGE[0] || p.exposure > C.EXPOSURE_RANGE[1]) lightingIssues.push(`${fam}/${preset}: exposure ${p.exposure}`);
    if (!cool(p.fill.color)) lightingIssues.push(`${fam}/${preset}: fill ${p.fill.color} not cool`);
    if (!(warm(p.key.color) || (p.local.intensity > 0 && warm(p.local.color)))) lightingIssues.push(`${fam}/${preset}: no warm key or practical`);
    if (rgb(p.hemi.sky).every(v => v >= 0xf0)) lightingIssues.push(`${fam}/${preset}: flat white hemi sky`);
  }
  const flat = (p) => ({ background: p.background, exposure: p.exposure, hemiSky: p.hemi.sky, hemiGround: p.hemi.ground, hemiIntensity: p.hemi.intensity, keyColor: p.key.color, keyIntensity: p.key.intensity, fillColor: p.fill.color, fillIntensity: p.fill.intensity, localColor: p.local.color, localIntensity: p.local.intensity });
  for (let a = 0; a < C.LIGHTING_PRESETS.length; a++) for (let b = a + 1; b < C.LIGHTING_PRESETS.length; b++) {
    const fa = flat(row[C.LIGHTING_PRESETS[a]]), fb = flat(row[C.LIGHTING_PRESETS[b]]);
    const n = Object.keys(fa).filter(k => fa[k] !== fb[k]).length;
    if (n < C.MODE_RESPONSE.changedFieldsMin) lightingIssues.push(`${fam}: ${C.LIGHTING_PRESETS[a]}/${C.LIGHTING_PRESETS[b]} only ${n} fields differ`);
  }
}
const badFamilies = Object.entries(C.PRESET_SCENES).filter(([, s]) => !C.LIGHTING_FAMILIES.includes(s.lightingFamily)).map(([k]) => k);
check('lighting: every preset scene maps to a lighting family', badFamilies.length === 0, badFamilies.join(','));
check('lighting: profile matrix complete, exposure-bounded, dual-temperature, mode-responsive', lightingIssues.length === 0, lightingIssues.join(' | '));
// 2c'. BEHAVIOURAL lighting proof (SOL-FIX-2): instantiate the real LightingRig, apply every preset
// scene x preset (by scene id, via setPreset, and in forward + reverse order so leftover state shows),
// and require every applied light/background/exposure field to equal the canonical profile looked up
// directly from PRESET_SCENES[scene].lightingFamily. Any scene-specific branch, whatever its syntax,
// changes an applied value and fails here.
const near = (a, b) => Math.abs(a - b) < 1e-9;
const hexL = (c) => `#${c.getHexString()}`;
function lightingBehaviourIssues(RigClass) {
  const issues = [];
  const scene = new THREE.Scene();
  const rig = new RigClass(scene);
  const scenes = Object.keys(C.PRESET_SCENES);
  const compare = (sceneId, preset, how) => {
    const want = C.LIGHTING_PROFILES[C.PRESET_SCENES[sceneId].lightingFamily][preset];
    const got = {
      background: hexL(scene.background), exposure: rig.getExposure(),
      hemiSky: hexL(rig.hemiLight.color), hemiGround: hexL(rig.hemiLight.groundColor), hemiIntensity: rig.hemiLight.intensity,
      keyColor: hexL(rig.keyLight.color), keyIntensity: rig.keyLight.intensity, keyPosition: rig.keyLight.position.toArray(),
      fillColor: hexL(rig.fillLight.color), fillIntensity: rig.fillLight.intensity, fillPosition: rig.fillLight.position.toArray(),
      localColor: hexL(rig.hearthLight.color), localIntensity: rig.hearthLight.intensity, localDistance: rig.hearthLight.distance, localDecay: rig.hearthLight.decay
    };
    const exp = {
      background: want.background, exposure: want.exposure, hemiSky: want.hemi.sky, hemiGround: want.hemi.ground, hemiIntensity: want.hemi.intensity,
      keyColor: want.key.color, keyIntensity: want.key.intensity, keyPosition: want.key.position,
      fillColor: want.fill.color, fillIntensity: want.fill.intensity, fillPosition: want.fill.position,
      localColor: want.local.color, localIntensity: want.local.intensity, localDistance: want.local.distance, localDecay: want.local.decay
    };
    for (const [k, v] of Object.entries(exp)) {
      const g = got[k];
      const same = Array.isArray(v) ? v.every((x, i) => near(x, g[i])) : typeof v === 'number' ? near(v, g) : String(v).toLowerCase() === String(g).toLowerCase();
      if (!same) issues.push(`${sceneId}/${preset} (${how}) ${k}: ${JSON.stringify(g)} != ${JSON.stringify(v)}`);
    }
  };
  for (const order of [scenes, [...scenes].reverse()]) {
    for (const s of order) for (const preset of C.LIGHTING_PRESETS) { rig.setSceneProfile(s, preset); compare(s, preset, 'setSceneProfile'); }
    for (const s of order) { rig.setSceneProfile(s, 'dusk'); for (const preset of [...C.LIGHTING_PRESETS].reverse()) { rig.setPreset(preset); compare(s, preset, 'setPreset'); } }
  }
  return issues;
}
const rigIssues = lightingBehaviourIssues(LightingRig);
check(`lighting: LightingRig applies exactly the canonical profile for all ${Object.keys(C.PRESET_SCENES).length} scenes x ${C.LIGHTING_PRESETS.length} presets (behavioural)`, rigIssues.length === 0, rigIssues.slice(0, 4).join(' | '));

// Negative fixtures: re-import the REAL LightingRig source with one scene branch injected (the forms
// Sol showed the old regex missed) and require the behavioural check to catch each. A control copy
// with no injection must pass, so the fixture harness itself is not what fails.
const rigSource = read('src/engine/LightingRig.js');
const RIG_ANCHOR = 'this.hearthBounce.intensity = p.local.intensity * 0.4;';
async function loadRigVariant(injection) {
  if (!rigSource.includes(RIG_ANCHOR)) throw new Error('LightingRig fixture anchor missing');
  const src = rigSource.replace(RIG_ANCHOR, `${RIG_ANCHOR}\n    ${injection}`)
    .replace(/from 'three'/g, `from '${import.meta.resolve('three')}'`)
    .replace(/from '\.\.\/contracts\/artisanContract\.js'/g, `from '${pathToFileURL(path.join(ROOT, 'src/contracts/artisanContract.js')).href}'`);
  return (await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`)).LightingRig;
}
const RIG_FIXTURES = {
  control: '',
  'double-quoted equality': 'if (sceneName === "tokyo") this.keyLight.intensity *= 1.25;',
  'switch on currentScene': "switch (this.currentScene) { case 'winterhold': this.fillLight.intensity += 0.2; break; }",
  'array includes': "if (['armory'].includes(sceneName)) this.hemiLight.intensity += 0.15;",
  'prefix test on practical colour': "if (String(sceneName).startsWith('lib')) this.hearthLight.color.set('#ffffff');"
};
for (const [label, injection] of Object.entries(RIG_FIXTURES)) {
  let issues;
  try { issues = lightingBehaviourIssues(await loadRigVariant(injection)); } catch (e) { issues = null; check(`negative fixture: LightingRig ${label}`, false, e.message); continue; }
  if (label === 'control') check('negative fixture control: unmodified LightingRig source re-imported passes', issues.length === 0, issues.slice(0, 2).join(' | '));
  else check(`negative fixture: LightingRig ${label} scene branch → behavioural check fails`, issues.length > 0, 'NOT DETECTED');
}

// 2d. MCP write confinement (SOL-FIX-2): AST deny-by-default. artifacts.js is the only mcp-server
// module allowed to mutate the filesystem. Every other non-test module may use fs only as
// `fs.<read-only API>` (no aliasing, destructuring, computed access, write/promises imports), may not
// import child_process or load modules via require()/dynamic import of fs, and may call
// page.screenshot()/pdf() only with an object literal that has no `path` (so bytes come back to memory
// and are written by writeArtifactAt, which re-asserts confinement at the write boundary).
const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const FORBIDDEN_MODULES = new Set(['child_process', 'node:child_process']);
const FS_READ_OK = new Set(['existsSync', 'readFileSync', 'statSync', 'lstatSync', 'readdirSync']);
function writeConfinementIssues(src, file) {
  const issues = [];
  const ast = parseAst(src);
  const fsIdents = new Set();
  let helperWrites = 0;
  const visit = (node, parent, key) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'ImportDeclaration': {
        const mod = node.source.value;
        if (FORBIDDEN_MODULES.has(mod)) issues.push(`${file}: imports ${mod}`);
        if (FS_MODULES.has(mod)) {
          for (const s of node.specifiers) {
            if (s.type === 'ImportSpecifier') { const name = s.imported.name ?? s.imported.value; if (!FS_READ_OK.has(name) || mod.endsWith('promises')) issues.push(`${file}: imports {${name}} from ${mod}`); }
            else if (mod.endsWith('promises')) issues.push(`${file}: imports ${mod}`);
            else fsIdents.add(s.local.name);
          }
        }
        return; // specifiers are declarations, not references
      }
      case 'ImportExpression':
        if (node.source.type !== 'Literal' || FS_MODULES.has(node.source.value) || FORBIDDEN_MODULES.has(node.source.value)) issues.push(`${file}: dynamic import(${node.source.type === 'Literal' ? node.source.value : '<expr>'})`);
        break;
      case 'CallExpression': {
        const c = node.callee;
        if (c.type === 'Identifier' && c.name === 'require') issues.push(`${file}: require()`);
        if (c.type === 'Identifier' && (c.name === 'writeArtifactAt' || c.name === 'writeArtifact')) helperWrites++;
        const method = c.type === 'MemberExpression' && !c.computed ? c.property.name : null;
        if (method === 'screenshot' || method === 'pdf') {
          const [arg] = node.arguments;
          const bad = arg && (arg.type !== 'ObjectExpression' || arg.properties.some(p => p.type !== 'Property' || p.computed || (p.key.name ?? p.key.value) === 'path'));
          if (bad) issues.push(`${file}: ${method}() with a path or non-literal options`);
        }
        break;
      }
      case 'Identifier':
        if (fsIdents.has(node.name)) {
          const isPropKey = (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) || (parent?.type === 'Property' && key === 'key' && !parent.computed);
          const readUse = parent?.type === 'MemberExpression' && key === 'object' && !parent.computed && FS_READ_OK.has(parent.property.name);
          if (!isPropKey && !readUse) issues.push(`${file}: fs used as ${parent?.type === 'MemberExpression' ? `fs${parent.computed ? '[…]' : '.' + parent.property.name}` : `a value (${parent?.type})`}`);
        }
        break;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'parent') continue;
      if (Array.isArray(v)) v.forEach(n => visit(n, node, k));
      else if (v && typeof v.type === 'string') visit(v, node, k);
    }
  };
  visit(ast, null, null);
  return { issues, helperWrites };
}
const writeIssues = [];
let helperWrites = 0;
const scanned = fs.readdirSync(path.join(ROOT, 'mcp-server')).filter(n => /\.js$/.test(n) && !/^test_/.test(n) && n !== 'artifacts.js');
for (const f of scanned) {
  const r = writeConfinementIssues(read(`mcp-server/${f}`), f);
  writeIssues.push(...r.issues);
  helperWrites += r.helperWrites;
}
check(`MCP: no fs mutation outside artifacts.js; all writes via writeArtifact/writeArtifactAt (AST, ${scanned.length} modules)`, writeIssues.length === 0 && helperWrites >= 5, writeIssues.join(' | ') || `${helperWrites} helper writes`);

// Negative fixtures: each must be rejected by the same AST check (the positive control must pass).
const WRITE_FIXTURES = {
  'reassigned confined path': "import fs from 'fs'; import { safeArtifactPath } from './artifacts.js'; let p = safeArtifactPath('x', '.json'); p = 'C:/Windows/evil.json'; fs.writeFileSync(p, '{}');",
  'aliased write function': "import fs from 'fs'; const w = fs.writeFileSync; w('a', 'b');",
  'aliased fs object': "import fs from 'fs'; const f = fs; f.writeFileSync('a', 'b');",
  'destructured fs': "import fs from 'fs'; const { writeFileSync } = fs; writeFileSync('a', 'b');",
  'named write import': "import { writeFileSync as keep } from 'fs'; keep('a', 'b');",
  'computed fs member': "import fs from 'fs'; fs['write' + 'FileSync']('a', 'b');",
  'fs/promises': "import fsp from 'node:fs/promises'; await fsp.writeFile('a', 'b');",
  'promises named import': "import { promises } from 'fs'; await promises.writeFile('a', 'b');",
  'screenshot with path': "export async function s(page, p) { await page.screenshot({ path: p }); }",
  'screenshot with options variable': "export async function s(page, p) { const o = { path: p }; await page.screenshot(o); }",
  'screenshot with spread options': "export async function s(page, o) { await page.screenshot({ ...o }); }",
  'child_process': "import { execSync } from 'child_process'; execSync('echo x > y');",
  'dynamic fs import': "const f = await import('fs'); f.writeFileSync('a', 'b');",
  'require fs': "const f = require('fs'); f.writeFileSync('a', 'b');"
};
for (const [label, src] of Object.entries(WRITE_FIXTURES)) {
  check(`negative fixture: write scan rejects ${label}`, writeConfinementIssues(src, 'fixture').issues.length > 0, 'NOT DETECTED');
}
const control = writeConfinementIssues("import fs from 'fs'; import { writeArtifactAt, safeArtifactPath } from './artifacts.js'; export async function s(page, a) { const png = await page.screenshot({ type: 'png' }); if (fs.existsSync(a)) writeArtifactAt(safeArtifactPath('x', '.png'), fs.readFileSync(a)); return png; }", 'control');
check('negative fixture control: confined helper write + read-only fs passes the write scan', control.issues.length === 0 && control.helperWrites === 1, control.issues.join(' | '));

// 3. Presets: canonical shape, catalog membership, both validators agree
const sv = new SpatialValidator(foundry);
for (const [name, m] of Object.entries(Presets)) {
  if (!m || !Array.isArray(m.entities)) continue;
  const mcp = validateWorld(m);
  const browser = sv.validateWorld(m);
  const shapeOk = m.entities.every(e => Array.isArray(e.relationships ?? []));
  check(`preset ${name}: valid in MCP + browser validators`, mcp.valid && browser.valid && shapeOk && mcp.warnings.length === 0,
    [...mcp.errors.map(e => e.message), ...browser.errors].slice(0, 3).join(' | '));
}

// 4. Scenes & camera angles exist in main.js
const mainSrc = read('src/main.js');
const missingScenes = Object.keys(C.PRESET_SCENES).filter(s => !mainSrc.includes(`mode === '${s}'`));
check('scenes: PRESET_SCENES handled by loadScene', missingScenes.length === 0, missingScenes.join(','));
const missingAngles = C.CAMERA_ANGLES.filter(a => !mainSrc.includes(`angle === '${a}'`));
check('camera angles handled by setCameraAngle', missingAngles.length === 0, missingAngles.join(','));

// 5. MCP declares no private copies of contract facts
const mcpIndex = read('mcp-server/index.js');
check('MCP index: no literal enum lists', !/enum:\s*\[/.test(mcpIndex));
check('MCP catalogs.js is a pure re-export', !/[{,]\s*'[a-z]+\.[a-z_0-9]+'\s*:/.test(read('mcp-server/catalogs.js')));
check('MCP: no conversation-brain artifact paths', !/antigravity[\\/]+brain/i.test(mcpIndex + read('mcp-server/HeadlessRunner.js') + read('mcp-server/artifacts.js')));
check('MCP bridge binds loopback', /BRIDGE_HOST = '127\.0\.0\.1'/.test(read('mcp-server/bridge.js')) && /listen\(WS_PORT, BRIDGE_HOST/.test(read('mcp-server/bridge.js')));

// 5b. SPEC-08 evidence integrity: headless evidence is canvas-only (no DOM overlays), and the audit reports
// measured observations, never canned repair claims or rhetorical verdicts.
check('MCP: HeadlessRunner makes no page.screenshot( call (canvas-only evidence)', !/page\.screenshot\(/.test(read('mcp-server/HeadlessRunner.js')));
const CLAIM_TOKENS = ['actionTaken', "'MITIGATED'", "'RESOLVED'", 'ZERO GUESSWORK', 'LOCKED 60 FPS'];
const claimHits = ['src/engine/ArtisanProfiler.js', 'scripts/run_perf_audit.js'].flatMap(f => CLAIM_TOKENS.filter(t => read(f).includes(t)).map(t => `${f}:${t}`));
check('audit: no canned repair/verdict claims in ArtisanProfiler.js or run_perf_audit.js', claimHits.length === 0, claimHits.join(', '));

// 6. Skill / plugin / docs: referenced ids and budgets must exist in the contract
const anchorSet = new Set(Object.values(C.ARCHETYPE_CATALOG).flatMap(a => a.anchors));
const budgetValues = new Set(Object.values(C.PERFORMANCE_PROFILES).flatMap(p => [p.drawCallsMax, p.visibleDrawCallsMax]).filter(Boolean));
function auditDoc(label, text) {
  const unknown = [];
  for (const [, tok] of text.matchAll(/`([a-z]+\.[a-z0-9_.]+)`/g)) {
    if (C.ARCHETYPE_CATALOG[tok] || C.MATERIAL_CATALOG[tok] || anchorSet.has(tok)) continue;
    if (/^(ground|anchor\.surface|prop\.my_|.*\.\d{3}$)/.test(tok) || /\.(js|mjs|json|md|world)$/.test(tok) || tok.includes('..')) continue;
    if (/^(artisan|window|three|renderer|entity|ref|scripts|src|mcp-server|error)\./.test(tok)) continue;
    unknown.push(tok);
  }
  const budgets = [...text.matchAll(/(?:<=|≤)\s*(\d+)\s*(?:draw|draws|visible draw)/gi)].map(m => Number(m[1]));
  const badBudgets = budgets.filter(b => !budgetValues.has(b));
  check(`${label}: catalog ids exist`, unknown.length === 0, unknown.join(','));
  check(`${label}: draw-call budgets match a profile`, badBudgets.length === 0, badBudgets.join(','));
}
const skillRoot = 'plugins/artisan-3d-studio/skills/artisan-3d-studio';
auditDoc('plugin skill', read(`${skillRoot}/SKILL.md`) + read(`${skillRoot}/references/foundry-extension.md`));
auditDoc('MCP essence', read('mcp-server/knowledge/essence.md'));
auditDoc('LLM_AUTHORING_MANUAL', read('LLM_AUTHORING_MANUAL.md'));
auditDoc('AGENTS.md', read('AGENTS.md'));
const skillLines = read(`${skillRoot}/SKILL.md`).split('\n').length;
check('plugin skill entrypoint stays concise (<= 60 lines)', skillLines <= 60, `${skillLines} lines`);
const geminiSkill = path.join(process.env.USERPROFILE || '', '.gemini', 'config', 'skills', 'artisan-3d-studio', 'SKILL.md');
if (fs.existsSync(geminiSkill)) auditDoc('Gemini skill', fs.readFileSync(geminiSkill, 'utf8'));

// 7. Plugin wiring points at this repo's server
const mcpJson = JSON.parse(read('plugins/artisan-3d-studio/.mcp.json'));
const serverArgs = mcpJson.mcpServers?.['artisan-3d']?.args || [];
const target = serverArgs.find(a => a.endsWith('index.js'));
check('plugin .mcp.json → this repo mcp-server/index.js', target && path.resolve(target) === path.join(ROOT, 'mcp-server', 'index.js'), target);
const yamlText = read(`${skillRoot}/agents/openai.yaml`);
check('skill declares artisan-3d MCP dependency', /value:\s*"artisan-3d"/.test(yamlText) && /transport:\s*"stdio"/.test(yamlText));

const passed = results.filter(r => r.pass).length;
const summary = { suite: 'contract-drift', contractVersion: C.CONTRACT_VERSION, passed, failed: results.length - passed, failures: results.filter(r => !r.pass) };
if (process.argv.includes('--json')) console.log(JSON.stringify({ summary, results }));
else {
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail && !r.pass ? ` — ${r.detail}` : ''}`);
  console.log(`\n${passed}/${results.length} passed (contract ${C.CONTRACT_VERSION})`);
}
process.exit(summary.failed ? 1 : 0);
