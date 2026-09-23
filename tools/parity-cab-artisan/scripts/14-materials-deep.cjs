#!/usr/bin/env node
// 14-materials-deep.cjs — Per-mesh PBR material parity diff (Stage 14 · MASTER-PLAN C2).
//
// The trace recorder ALREADY captures `materials_deep[]` (resolved per-mesh PBR
// state: color/emissive/metalness/roughness/opacity/blending/side/maps/uniforms
// + `used_by` entity identities) on BOTH sides. Until now that data was captured
// and never diffed — a material swap (roughness .4→.8, lost emissive, dropped
// transparency) was invisible to every gate and only *maybe* caught by pixel SSIM
// if a camera framed it. This stage closes that blind spot deterministically,
// with NO GPU and NO new dependency.
//
// MATCH STRATEGY (uuids are per-instance random + traversal order drifts between
// two independently-built scenes, so neither is a stable key):
//   1) primary  — `used_by` signature: the sorted set of entity identities whose
//                  meshes reference the material (content-independent, by design
//                  of captureMaterialsDeep). Best cross-side anchor.
//   2) fallback — structural signature: type + #used_by + map-presence (for
//                  shared/global materials with empty or generic used_by).
// Unmatched mono-side materials → DROPPED (never silent). Unmatched mod-side →
// ADDED (candidate remendo). Matched pairs → per-field PBR delta with tolerance.
//
// Output: `<out_dir>/materials-deep.sij.json` (+ mirror to artifact-system) + report.
// Usage:  node 14-materials-deep.cjs --config parity.config.json
// Exit:   0 = pass/warn (soft), 1 = real divergence (only when --strict). Default soft.

"use strict";

const fs   = require("fs");
const path = require("path");
const { writeSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");

// ── Trace fetch (API-first, local fallback) — mirrors 07-trace-diff fetchSidePair ──
function readTrace(cfg, side) {
  // Prefer artifact-system store if reachable on disk; else local out_dir/traces.
  const candidates = [];
  // walk up for .parity-traces/<project>/<side>.json
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

// ── PBR fields + tolerances ───────────────────────────────────────────────────
const EXACT_FIELDS = ["type", "color", "emissive", "transparent", "depthTest",
  "depthWrite", "side", "blending", "flatShading", "vertexColors", "toneMapped"];
const NUM_FIELDS = [
  { k: "metalness", eps: 0.02 },
  { k: "roughness", eps: 0.02 },
  { k: "opacity", eps: 0.02 },
  { k: "emissiveIntensity", eps: 0.02 },
  { k: "alphaTest", eps: 0.001 },
];
const MAP_KEYS = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap", "envMap"];

// Path A (ordinal-join, 2026-05-31, Law 8/L5/L6): the two traces' `entities[]`
// are positionally aligned (same manifest order, verified — identical positions,
// 23↔23). So entity_id is per-run/per-side random BUT entity ORDINAL is a stable
// cross-side key. We translate each material's `used_by` (raw entity_ids) into the
// set of ORDINALS via an id→ordinal map built from that side's entities[]. Both
// sides then yield comparable `used_by` signatures with ZERO recorder change and
// zero fabrication. If an id isn't in the map (shouldn't happen) it's kept raw so
// it simply won't false-match — safe.
// Build an ordinal map keyed by EVERY identity a material's used_by might carry
// for that entity — entity_id AND name AND object_type — because the recorder's
// entityIdOf resolves DIFFERENT fields per side (mono→entity_id, mod→name; see
// trace-recorder.js entityIdOf L538-548). Keying all of them onto the same
// ordinal makes both sides translate into one shared ordinal space.
function buildIdToOrdinal(entities) {
  const map = new Map();
  (entities || []).forEach((e, i) => {
    if (!e) return;
    if (e.entity_id) map.set(e.entity_id, i);
    if (e.name) map.set(e.name, i);
    // NOT object_type — it collides (many entities share "candle") and would
    // corrupt the ordinal via overwrite. entity_id + name are unique + sufficient.
  });
  return map;
}
function usedBySig(m, idMap) {
  let u = (m.used_by || []);
  if (idMap) u = u.map((id) => (idMap.has(id) ? "o" + idMap.get(id) : id));
  u = u.slice().sort();
  return u.length ? "U:" + u.join("|") : null;
}
function structSig(m) {
  const maps = MAP_KEYS.filter((k) => m.maps && m.maps[k]).join(",");
  return "S:" + (m.type || "?") + "|n" + (m.used_by ? m.used_by.length : 0) + "|" + maps;
}

// PBR distance — used to disambiguate when one match-key has MULTIPLE candidate
// materials (an entity owning N materials). Lower = more similar. This is what
// makes N-material entities pair correctly instead of arbitrary first-pop
// (which produced false "blue→gold" drifts). Hard penalty for type/map mismatch
// so we never pair across material classes.
function pbrDistance(a, b) {
  let d = 0;
  if (a.type !== b.type) d += 1000;
  if (a.color !== b.color) d += 100;            // hex string inequality — strong signal
  if (a.emissive !== b.emissive) d += 50;
  for (const { k } of NUM_FIELDS) {
    const av = a[k], bv = b[k];
    if (av != null && bv != null) d += Math.abs(av - bv);
    else if (av != null || bv != null) d += 1;
  }
  for (const mk of MAP_KEYS) {
    if (!!(a.maps && a.maps[mk]) !== !!(b.maps && b.maps[mk])) d += 10;
  }
  return d;
}

// Match: bucket mod materials by used-by sig, then struct sig. Within a bucket,
// pick the NEAREST unused candidate by PBR distance (not first) so an entity's
// N materials pair to their true twins.
function matchMaterials(monoArr, modArr, monoIdMap, modIdMap) {
  const pairs = [], droppedMono = [], addedMod = [];
  const modByUsed = new Map(), modByStruct = new Map();
  modArr.forEach((m, i) => {
    const u = usedBySig(m, modIdMap); if (u) { if (!modByUsed.has(u)) modByUsed.set(u, []); modByUsed.get(u).push(i); }
    const s = structSig(m); if (!modByStruct.has(s)) modByStruct.set(s, []);
    modByStruct.get(s).push(i);
  });
  const usedMod = new Set();
  function takeNearest(map, key, mm) {
    const arr = map.get(key);
    if (!arr || !arr.length) return -1;
    let best = -1, bestD = Infinity, bestPos = -1;
    for (let p = 0; p < arr.length; p++) {
      const i = arr[p];
      if (usedMod.has(i)) continue;
      const d = pbrDistance(mm, modArr[i]);
      if (d < bestD) { bestD = d; best = i; bestPos = p; }
    }
    if (best === -1) return -1;
    arr.splice(bestPos, 1);
    usedMod.add(best);
    return best;
  }
  for (const mm of monoArr) {
    let j = -1;
    const u = usedBySig(mm, monoIdMap);
    if (u) j = takeNearest(modByUsed, u, mm);
    if (j === -1) j = takeNearest(modByStruct, structSig(mm), mm);
    if (j === -1) droppedMono.push(mm);
    else pairs.push([mm, modArr[j]]);
  }
  modArr.forEach((m, i) => { if (!usedMod.has(i)) addedMod.push(m); });
  return { pairs, droppedMono, addedMod };
}

function diffPair(a, b) {
  const deltas = [];
  for (const f of EXACT_FIELDS) {
    if (String(a[f]) !== String(b[f])) deltas.push({ field: f, monolith: a[f], modular: b[f], kind: "exact" });
  }
  for (const { k, eps } of NUM_FIELDS) {
    const av = a[k], bv = b[k];
    if (av == null && bv == null) continue;
    if (av == null || bv == null || Math.abs(av - bv) > eps) {
      deltas.push({ field: k, monolith: av, modular: bv, kind: "numeric", eps });
    }
  }
  for (const mk of MAP_KEYS) {
    const am = !!(a.maps && a.maps[mk]), bm = !!(b.maps && b.maps[mk]);
    if (am !== bm) deltas.push({ field: "maps." + mk, monolith: am, modular: bm, kind: "map_presence" });
  }
  // ShaderMaterial uniforms (if both carry them)
  if (a.uniforms || b.uniforms) {
    const au = a.uniforms || {}, bu = b.uniforms || {};
    for (const uk of new Set([...Object.keys(au), ...Object.keys(bu)])) {
      if (JSON.stringify(au[uk]) !== JSON.stringify(bu[uk])) {
        deltas.push({ field: "uniforms." + uk, monolith: au[uk], modular: bu[uk], kind: "uniform" });
      }
    }
  }
  return deltas;
}

// Severity: color/emissive/opacity/transparent/map drift = visible → high;
// metalness/roughness = high (PBR look); blending/side = high; rest med.
function severityOf(field) {
  if (/^color|^emissive|opacity|transparent|^maps\.|blending|^side$/.test(field)) return "high";
  if (/metalness|roughness|emissiveIntensity|uniforms\./.test(field)) return "high";
  return "med";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg  = loadConfig(args.config || "parity.config.json");
  const strict = !!args.strict;

  const mono = readTrace(cfg, "monolith");
  const mod  = readTrace(cfg, "modular");
  if (!mono.obj || !mod.obj) {
    console.log("[materials-deep] SKIP — traces not found (run 06-behavior-trace first).");
    process.exit(0);
  }
  const monoMat = mono.obj.materials_deep || [];
  const modMat  = mod.obj.materials_deep || [];
  if (monoMat.length === 0 && modMat.length === 0) {
    console.log("[materials-deep] SKIP — no materials_deep in traces (recorder predates Stage 14 capture).");
    process.exit(0);
  }

  // Path A — build id→ordinal maps from the positionally-aligned entities[] so
  // used_by signatures are cross-side-comparable (entity_id is per-side random;
  // ordinal is the stable shared key).
  const monoIdMap = buildIdToOrdinal(mono.obj.entities);
  const modIdMap  = buildIdToOrdinal(mod.obj.entities);
  // Guard: ordinal-join only valid if the two entity lists are aligned (same
  // length). If not, fall back to raw used_by (no translation) — never fabricate.
  const aligned = (mono.obj.entities || []).length === (mod.obj.entities || []).length
    && (mono.obj.entities || []).length > 0;
  const { pairs, droppedMono, addedMod } = aligned
    ? matchMaterials(monoMat, modMat, monoIdMap, modIdMap)
    : matchMaterials(monoMat, modMat);
  if (!aligned) console.log("[materials-deep] note: entity lists not aligned — ordinal-join skipped, raw used_by match (lower precision).");

  const findings = [];
  let cleanPairs = 0;
  for (const [a, b] of pairs) {
    const deltas = diffPair(a, b);
    if (deltas.length === 0) { cleanPairs++; continue; }
    const sev = deltas.some((d) => severityOf(d.field) === "high") ? "high" : "med";
    findings.push({
      severity: sev, kind: "material_drift",
      used_by: a.used_by, type: a.type,
      mono_uuid: a.uuid, mod_uuid: b.uuid,
      deltas,
    });
  }
  for (const m of droppedMono) {
    findings.push({ severity: "high", kind: "material_dropped",
      used_by: m.used_by, type: m.type, mono_uuid: m.uuid,
      detail: "monolith material with no modular counterpart" });
  }
  for (const m of addedMod) {
    findings.push({ severity: "med", kind: "material_added",
      used_by: m.used_by, type: m.type, mod_uuid: m.uuid,
      detail: "modular material with no monolith counterpart (candidate remendo — disposition)" });
  }

  findings.sort((x, y) => (x.severity === "high" ? 0 : 1) - (y.severity === "high" ? 0 : 1));

  const highCount = findings.filter((f) => f.severity === "high").length;
  const decision = highCount > 0 ? "fail" : findings.length > 0 ? "warn" : "pass";
  const summary = {
    decision,
    monolith_materials: monoMat.length,
    modular_materials: modMat.length,
    matched_pairs: pairs.length,
    clean_pairs: cleanPairs,
    drifted_pairs: pairs.length - cleanPairs,
    dropped: droppedMono.length,
    added: addedMod.length,
    high: highCount,
    med: findings.filter((f) => f.severity === "med").length,
  };

  if (!fs.existsSync(cfg.out_dir)) fs.mkdirSync(cfg.out_dir, { recursive: true });
  const outPath = path.join(cfg.out_dir, "materials-deep.sij.json");
  writeSIJ(outPath, "materials-deep", null, findings, { summary });
  console.log(`[materials-deep] output: ${outPath}`);

  // Mirror to artifact-system (same pattern as 11b/11c/ast-xray)
  if (cfg.artifact_system_sink) {
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
          fs.writeFileSync(path.join(destDir, "materials-deep.sij.json"), fs.readFileSync(outPath, "utf8"), "utf8");
          console.log(`[materials-deep] synced → ${path.join(destDir, "materials-deep.sij.json")}`);
          break;
        }
        asRoot = path.dirname(asRoot);
      }
    } catch (err) { console.log(`[materials-deep] warn: sync failed: ${err.message}`); }
  }

  // Report
  console.log(`[materials-deep] decision=${decision} · mono=${monoMat.length} mod=${modMat.length} · matched=${pairs.length} (clean=${cleanPairs} drift=${summary.drifted_pairs}) dropped=${droppedMono.length} added=${addedMod.length}`);
  for (const f of findings.slice(0, 20)) {
    const who = (f.used_by && f.used_by.length) ? f.used_by.join(",") : f.type;
    if (f.kind === "material_drift") {
      console.log(`  [${f.severity}] drift · ${who}: ${f.deltas.map((d) => `${d.field} ${d.monolith}→${d.modular}`).slice(0, 4).join("; ")}`);
    } else {
      console.log(`  [${f.severity}] ${f.kind} · ${who} (${f.type}) — ${f.detail}`);
    }
  }
  if (findings.length > 20) console.log(`  … +${findings.length - 20} more`);
  if (decision === "pass") console.log("[materials-deep] ✓ all materials match within PBR tolerance.");

  process.exit(strict && highCount > 0 ? 1 : 0);
}

main();
