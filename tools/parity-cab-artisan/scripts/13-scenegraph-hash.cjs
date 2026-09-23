#!/usr/bin/env node
// 13-scenegraph-hash.cjs — Per-object scene-graph structural diff (Stage 13 · MASTER-PLAN C3).
//
// The trace recorder captures `trace.scene_graph[]` on BOTH sides: for every
// geometry-bearing object (Mesh / Line / Points) a structural fingerprint —
//   { entity, obj_type, geo_type, vtx, idx, attrs, geo_hash, mat_sig }
// where `geo_hash` is a double-lane FNV-1a over the QUANTIZED geometry attribute
// arrays (position / normal / uv / index), UUIDs STRIPPED (not hashed). This stage
// diffs the two graphs per-object and reports wrong-mesh / wrong-vertex / wrong-UV
// and the geo-merge divergence (modular splitting a merged mono mesh into N) —
// deterministically, with NO GPU, FAILING FAST BEFORE PIXELS. SSIM only catches a
// geometry regression if a camera happens to frame it; this catches it always.
//
// Cross-side identity (uuids + traversal order are per-run/per-side unstable, so
// neither is a key): ORDINAL-JOIN (same path A as 14-materials-deep) — translate
// each object's `entity` into the positionally-aligned entities[] ordinal space.
// Determinism upstream: the recorder seeds Math.random (mulberry32 LCG) at harness
// boot so procedural vertex buffers (starfield / dust / books / bristles) are
// bit-identical across sides; without it geo_hash would never match. See
// trace-recorder.js `__PARITY_SEED_RNG`.
//
// Output: `<out_dir>/scene-graph.sij.json` (+ mirror to artifact-system) + report.
// Usage:  node 13-scenegraph-hash.cjs --config parity.config.json [--strict]
//         node 13-scenegraph-hash.cjs --selftest   (no config; proves diff logic)
// Exit:   0 = pass/warn (soft), 1 = real divergence (only when --strict). Default soft.

"use strict";

const fs   = require("fs");
const path = require("path");
const { writeSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");

// ── Trace fetch (API-first on-disk, local fallback) — mirrors 14-materials-deep ──
function readTrace(cfg, side) {
  const candidates = [];
  let root = process.cwd();
  for (let i = 0; i < 5; i++) {
    candidates.push(path.join(root, ".parity-traces", cfg.project || "default", side + ".json"));
    root = path.dirname(root);
  }
  candidates.push(path.join(cfg.out_dir, "traces", side + ".json"));
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try { return { obj: JSON.parse(fs.readFileSync(c, "utf8")), path: c }; } catch (_) {}
    }
  }
  return { obj: null, path: null };
}

// ── Ordinal-join (path A) — identical to 14-materials-deep buildIdToOrdinal ──────
// entity_id is per-side random; entity ORDINAL (index in the positionally-aligned
// entities[]) is the stable cross-side key. Key the map by entity_id AND name
// because the recorder's entityIdOf resolves entity_id on mono / name on mod.
function buildIdToOrdinal(entities) {
  const map = new Map();
  (entities || []).forEach((e, i) => {
    if (!e) return;
    if (e.entity_id) map.set(String(e.entity_id), i);
    if (e.name) map.set(String(e.name), i);
  });
  return map;
}
// The bucket key for an object: its entity translated to ordinal space. Objects
// with no entity (static furniture: room/walls/floor) share the "∅" bucket and
// match within it by geo_hash-exact-first — acceptable for v1 (noted limitation).
function entityKey(o, idMap) {
  const e = o.entity;
  if (e == null) return "∅";
  if (idMap && idMap.has(String(e))) return "o" + idMap.get(String(e));
  return "e:" + e;
}

// ── Object distance (only used WITHIN one entity bucket to pair twins) ──────────
// Exact geo_hash match is the strongest signal (distance 0). Otherwise nearest by
// geo_type + obj_type + vertex/index count. Hard penalty across geo_type so we
// never pair a Box to a Lathe.
function objDistance(a, b) {
  if (a.geo_hash && b.geo_hash && a.geo_hash === b.geo_hash) {
    return a.mat_sig === b.mat_sig ? 0 : 0.5; // identical geometry; tiebreak on material
  }
  let d = 1;
  if (a.geo_type !== b.geo_type) d += 1000;
  if (a.obj_type !== b.obj_type) d += 500;
  d += Math.abs((a.vtx || 0) - (b.vtx || 0)) * 0.01;
  d += Math.abs((a.idx || 0) - (b.idx || 0)) * 0.001;
  if (a.mat_sig !== b.mat_sig) d += 5;
  return d;
}

// Match: bucket mod objects by entity key, then within a bucket pick the NEAREST
// unused mod object per mono object. Unmatched mono → dropped (never silent);
// unmatched mod → added (candidate — often the geo-merge "extra geos" class).
function matchObjects(monoArr, modArr, monoIdMap, modIdMap) {
  const pairs = [], dropped = [], added = [];
  const modByKey = new Map();
  modArr.forEach((o, i) => {
    const k = entityKey(o, modIdMap);
    if (!modByKey.has(k)) modByKey.set(k, []);
    modByKey.get(k).push(i);
  });
  const usedMod = new Set();
  function takeNearest(key, mm) {
    const arr = modByKey.get(key);
    if (!arr || !arr.length) return -1;
    let best = -1, bestD = Infinity, bestPos = -1;
    for (let p = 0; p < arr.length; p++) {
      const i = arr[p];
      if (usedMod.has(i)) continue;
      const dd = objDistance(mm, modArr[i]);
      if (dd < bestD) { bestD = dd; best = i; bestPos = p; }
    }
    if (best === -1) return -1;
    arr.splice(bestPos, 1);
    usedMod.add(best);
    return best;
  }
  for (const mm of monoArr) {
    const j = takeNearest(entityKey(mm, monoIdMap), mm);
    if (j === -1) dropped.push(mm);
    else pairs.push([mm, modArr[j]]);
  }
  modArr.forEach((o, i) => { if (!usedMod.has(i)) added.push(o); });
  return { pairs, dropped, added };
}

function diffPair(a, b) {
  const out = [];
  if ((a.geo_hash || null) !== (b.geo_hash || null)) {
    const sameCount = a.vtx === b.vtx && a.idx === b.idx;
    out.push({
      kind: sameCount ? "geo_data_changed" : "geo_topology_changed",
      severity: "high",
      detail: sameCount
        ? "same vtx/idx count, different attribute data — position/normal/uv drift (wrong vertices or UV)"
        : "vertex/index count differs — wrong mesh or geo-merge divergence",
      mono: { geo_type: a.geo_type, vtx: a.vtx, idx: a.idx, hash: a.geo_hash, attrs: a.attrs },
      mod:  { geo_type: b.geo_type, vtx: b.vtx, idx: b.idx, hash: b.geo_hash, attrs: b.attrs },
    });
  }
  if ((a.mat_sig || null) !== (b.mat_sig || null)) {
    out.push({
      kind: "mat_sig_changed", severity: "med",
      detail: "coarse material signature differs — see materials-deep (Stage 14) for PBR-level detail",
      mono: a.mat_sig, mod: b.mat_sig,
    });
  }
  return out;
}

function whoOf(o) {
  return (o.entity || "(no-entity)") + (o.name ? " · " + o.name : "") + " [" + (o.geo_type || o.obj_type) + "]";
}

// ── Core diff (pure — exercised by --selftest with synthetic graphs) ────────────
function runDiff(monoObj, modObj) {
  const monoSG = monoObj.scene_graph || [];
  const modSG  = modObj.scene_graph || [];
  const monoIdMap = buildIdToOrdinal(monoObj.entities);
  const modIdMap  = buildIdToOrdinal(modObj.entities);
  const aligned = (monoObj.entities || []).length === (modObj.entities || []).length
    && (monoObj.entities || []).length > 0;
  const { pairs, dropped, added } = aligned
    ? matchObjects(monoSG, modSG, monoIdMap, modIdMap)
    : matchObjects(monoSG, modSG);

  const findings = [];
  let cleanPairs = 0, geoChanged = 0, matChanged = 0;
  for (const [a, b] of pairs) {
    const deltas = diffPair(a, b);
    if (deltas.length === 0) { cleanPairs++; continue; }
    if (deltas.some((d) => d.kind.startsWith("geo_"))) geoChanged++;
    if (deltas.some((d) => d.kind === "mat_sig_changed")) matChanged++;
    const sev = deltas.some((d) => d.severity === "high") ? "high" : "med";
    findings.push({ severity: sev, kind: "object_changed", who: whoOf(a),
      entity: a.entity, obj_type: a.obj_type, deltas });
  }
  for (const m of dropped) {
    findings.push({ severity: "high", kind: "mesh_dropped", who: whoOf(m),
      entity: m.entity, obj_type: m.obj_type, geo_type: m.geo_type, vtx: m.vtx,
      detail: "monolith object with no modular counterpart in its entity bucket" });
  }
  for (const m of added) {
    findings.push({ severity: "med", kind: "mesh_added", who: whoOf(m),
      entity: m.entity, obj_type: m.obj_type, geo_type: m.geo_type, vtx: m.vtx,
      detail: "modular object with no monolith counterpart (candidate — often geo-merge split)" });
  }
  findings.sort((x, y) => (x.severity === "high" ? 0 : 1) - (y.severity === "high" ? 0 : 1));

  const highCount = findings.filter((f) => f.severity === "high").length;
  const decision = highCount > 0 ? "fail" : findings.length > 0 ? "warn" : "pass";
  const summary = {
    decision, aligned_entities: aligned,
    monolith_objects: monoSG.length,
    modular_objects: modSG.length,
    matched_pairs: pairs.length,
    clean_pairs: cleanPairs,
    geo_changed_pairs: geoChanged,
    mat_changed_pairs: matChanged,
    dropped: dropped.length,
    added: added.length,
    high: highCount,
    med: findings.filter((f) => f.severity === "med").length,
  };
  return { findings, summary };
}

// ── Artifact-system mirror (same pattern as 11b/11c/14/ast-xray) ────────────────
function mirrorToArtifactSystem(cfg, outPath) {
  if (!cfg.artifact_system_sink) return;
  try {
    const projectId = cfg.project || "default";
    let asRoot = process.cwd();
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(asRoot, ".parity-traces");
      const pkgPath = path.join(asRoot, "package.json");
      if (fs.existsSync(candidate) ||
          (fs.existsSync(pkgPath) && JSON.parse(fs.readFileSync(pkgPath, "utf8")).name === "artifact-system")) {
        const destDir = path.join(candidate, projectId);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, "scene-graph.sij.json"), fs.readFileSync(outPath, "utf8"), "utf8");
        console.log(`[scene-graph] synced → ${path.join(destDir, "scene-graph.sij.json")}`);
        break;
      }
      asRoot = path.dirname(asRoot);
    }
  } catch (err) { console.log(`[scene-graph] warn: sync failed: ${err.message}`); }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) return selftest();
  const cfg  = loadConfig(args.config || "parity.config.json");
  const strict = !!args.strict;

  const mono = readTrace(cfg, "monolith");
  const mod  = readTrace(cfg, "modular");
  if (!mono.obj || !mod.obj) {
    console.log("[scene-graph] SKIP — traces not found (run 06-behavior-trace first).");
    process.exit(0);
  }
  if (!Array.isArray(mono.obj.scene_graph) && !Array.isArray(mod.obj.scene_graph)) {
    console.log("[scene-graph] SKIP — no scene_graph in traces (recorder predates Stage 13 capture; re-run 06-behavior-trace).");
    process.exit(0);
  }

  const { findings, summary } = runDiff(mono.obj, mod.obj);

  if (!fs.existsSync(cfg.out_dir)) fs.mkdirSync(cfg.out_dir, { recursive: true });
  const outPath = path.join(cfg.out_dir, "scene-graph.sij.json");
  writeSIJ(outPath, "scene-graph", null, findings, { summary });
  console.log(`[scene-graph] output: ${outPath}`);
  mirrorToArtifactSystem(cfg, outPath);

  console.log(`[scene-graph] decision=${summary.decision} · mono=${summary.monolith_objects} mod=${summary.modular_objects} · matched=${summary.matched_pairs} (clean=${summary.clean_pairs} geo-changed=${summary.geo_changed_pairs} mat-changed=${summary.mat_changed_pairs}) dropped=${summary.dropped} added=${summary.added}`);
  for (const f of findings.slice(0, 20)) {
    if (f.kind === "object_changed") {
      console.log(`  [${f.severity}] ${f.deltas.map((d) => d.kind).join("+")} · ${f.who}`);
    } else {
      console.log(`  [${f.severity}] ${f.kind} · ${f.who} (vtx=${f.vtx}) — ${f.detail}`);
    }
  }
  if (findings.length > 20) console.log(`  … +${findings.length - 20} more`);
  if (summary.decision === "pass") console.log("[scene-graph] ✓ every object matched with identical geometry + material signature.");

  process.exit(strict && summary.high > 0 ? 1 : 0);
}

// ── Self-test: synthetic graphs prove the diff logic deterministically (no browser) ──
// Mirrors the recorder's hash property: identical attribute arrays → identical
// geo_hash; a deliberate vertex change → different geo_hash. Permanent regression
// fixture (Law 4 — mechanize the "deliberate change → different" proof).
function fnvGeoHash(geoType, attrArrays, indexArr) {
  // EXACT mirror of trace-recorder.js captureSceneGraphHash hasher — keep in sync.
  let a = 0x811c9dc5, b = 0x84222325;
  function u32(n) {
    n = n >>> 0;
    a ^= (n & 0xffff); a = Math.imul(a, 0x01000193);
    a ^= (n >>> 16);   a = Math.imul(a, 0x01000193);
    b ^= (n & 0xffff); b = Math.imul(b, 0x85ebca77);
    b ^= (n >>> 16);   b = Math.imul(b, 0x85ebca77);
  }
  function str(s) { s = String(s); for (let i = 0; i < s.length; i++) u32(s.charCodeAt(i)); }
  function f(x) { u32((Math.round((x || 0) * 1e5)) | 0); }
  str(geoType || "BufferGeometry");
  const names = Object.keys(attrArrays).sort();
  str("ATTRS"); u32(names.length);
  for (const nm of names) {
    const arr = attrArrays[nm];
    str(nm); u32(arr.length);
    for (let i = 0; i < arr.length; i++) f(arr[i]);
  }
  if (indexArr) { str("INDEX"); u32(indexArr.length); for (let k = 0; k < indexArr.length; k++) u32(indexArr[k]); }
  return ((a >>> 0).toString(16).padStart(8, "0")) + ((b >>> 0).toString(16).padStart(8, "0"));
}

function selftest() {
  let pass = true;
  const fail = (m) => { pass = false; console.log("  ✗ " + m); };
  const ok   = (m) => console.log("  ✓ " + m);

  // (1) Hash property — identical arrays → identical hash; changed → different.
  const posA = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const posB = posA.slice();
  const posC = posA.slice(); posC[4] = 2; // one vertex moved
  const h1 = fnvGeoHash("BoxGeometry", { position: posA });
  const h2 = fnvGeoHash("BoxGeometry", { position: posB });
  const h3 = fnvGeoHash("BoxGeometry", { position: posC });
  h1 === h2 ? ok("identical geometry → identical geo_hash (" + h1 + ")") : fail("identical geometry produced different hashes");
  h1 !== h3 ? ok("moved vertex → different geo_hash (" + h1 + " ≠ " + h3 + ")") : fail("vertex change did not change hash");
  // vtx-count change → different hash
  const h4 = fnvGeoHash("BoxGeometry", { position: posA.concat([5, 5, 5]) });
  h1 !== h4 ? ok("added vertex (count change) → different geo_hash") : fail("vertex-count change did not change hash");

  // (2) Diff logic — build aligned synthetic traces.
  const ents = [{ entity_id: "x1", name: "Cauldron" }, { entity_id: "x2", name: "Vase" }];
  const baseObj = (entity, geo_type, vtx, hash, mat) =>
    ({ entity, obj_type: "Mesh", name: null, geo_type, vtx, idx: 0, attrs: ["position"], geo_hash: hash, mat_sig: mat });
  const monoSG = [
    baseObj("x1", "LatheGeometry", 100, "aaaa1111bbbb2222", "MeshStandardMaterial:ff0000"),
    baseObj("x1", "TorusGeometry", 48, "cccc3333dddd4444", "MeshStandardMaterial:gold"),
    baseObj("x2", "BoxGeometry", 24, "eeee5555ffff6666", "MeshBasicMaterial:00ff00"),
  ];
  // modular: x1 keeps lathe but DROPS the torus (gold rings — the R1 class);
  // x2 box has a vertex-count change; plus a NEW extra mesh (geo-merge split).
  const modEnts = [{ entity_id: "y1", name: "Cauldron" }, { entity_id: "y2", name: "Vase" }];
  const modSG = [
    baseObj("y1", "LatheGeometry", 100, "aaaa1111bbbb2222", "MeshStandardMaterial:ff0000"), // clean match
    baseObj("y2", "BoxGeometry", 30, "9999000088887777", "MeshBasicMaterial:00ff00"),       // topology change
    baseObj("y2", "BoxGeometry", 12, "1212343456567878", "MeshBasicMaterial:00ff00"),       // added (split)
  ];
  const { findings, summary } = runDiff(
    { entities: ents, scene_graph: monoSG },
    { entities: modEnts, scene_graph: modSG });

  summary.clean_pairs === 1 ? ok("1 clean pair (Cauldron lathe identical)") : fail("expected 1 clean pair, got " + summary.clean_pairs);
  const hasDrop = findings.some((f) => f.kind === "mesh_dropped");
  hasDrop ? ok("dropped torus detected (R1 gold-ring class)") : fail("dropped mesh NOT detected");
  const hasTopo = findings.some((f) => f.deltas && f.deltas.some((d) => d.kind === "geo_topology_changed"));
  hasTopo ? ok("vase box vtx-count change → geo_topology_changed (high)") : fail("topology change NOT detected");
  const hasAdd = findings.some((f) => f.kind === "mesh_added");
  hasAdd ? ok("extra modular mesh → mesh_added (geo-merge split class)") : fail("added mesh NOT detected");
  summary.decision === "fail" ? ok("decision=fail (high findings present)") : fail("expected decision=fail, got " + summary.decision);

  console.log(pass ? "\n[scene-graph] SELFTEST PASS" : "\n[scene-graph] SELFTEST FAIL");
  process.exit(pass ? 0 : 1);
}

main();
