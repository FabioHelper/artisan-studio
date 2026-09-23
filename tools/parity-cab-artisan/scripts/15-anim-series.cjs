#!/usr/bin/env node
// 15-anim-series.cjs — Animation transform-stream parity diff (Stage 15 · MASTER-PLAN C4).
//
// The recorder drives N fixed-Δt ticks DETERMINISTICALLY (synchronous rAF-pump +
// scripted clock — no GPU/timing in the loop) and emits `trace.anim_series`: per
// object a STREAM of per-frame hashes (matrixWorld + animated scalars: light
// intensity/color, material opacity/emissiveIntensity/emissive). This stage diffs
// the two streams frame-by-frame and reports the FIRST frame an object diverges.
//
// WHY: only path that catches TIME-VARYING regressions — flicker / easing /
// accumulators — the historical keyL.intensity-flicker + god-ray-opacity-breathing
// near-misses that a frame-0 snapshot AND pixel-diff both miss. (And on this box
// pixel-diff is GPU-nondeterministic — see C6 — so this deterministic gate carries
// the behavioral trust.)
//
// Cross-side identity: ordinal-join (same path A as 13/14; collision-proof after
// the entityIdOf→entity_id fix). Divergence is classed:
//   - frame 0          → anim_initial_divergence (objects START different — incl.
//                        initial WORLD placement, which C3 geometry hashing misses).
//   - frame k>0        → anim_time_varying_divergence (the C4-core catch; one side
//                        animates differently or not at all). Reports k.
//
// Output: `<out_dir>/anim-series.sij.json` (+ artifact-system mirror) + report.
// Usage:  node 15-anim-series.cjs --config parity.config.json [--strict]
//         node 15-anim-series.cjs --selftest   (no config; proves diff logic)
// Exit:   0 = pass/warn (soft), 1 = real divergence (only when --strict). Default soft.

"use strict";

const fs   = require("fs");
const path = require("path");
const { writeSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");

// ── Trace fetch (mirrors 13/14) ─────────────────────────────────────────────
function readTrace(cfg, side) {
  const candidates = [];
  let root = process.cwd();
  for (let i = 0; i < 5; i++) {
    candidates.push(path.join(root, ".parity-traces", cfg.project || "default", side + ".json"));
    root = path.dirname(root);
  }
  candidates.push(path.join(cfg.out_dir, "traces", side + ".json"));
  for (const c of candidates) {
    if (fs.existsSync(c)) { try { return { obj: JSON.parse(fs.readFileSync(c, "utf8")), path: c }; } catch (_) {} }
  }
  return { obj: null, path: null };
}

// ── Cross-side bucket key: self-contained entity_ord, stamped at anim-capture
// time by the recorder (first-encounter ordinal from anim's OWN traverse). This
// is robust to the modular app re-instantiating entities between the snapshot and
// the anim scrub — which regenerates uids and broke census-id resolution (mono
// kept ids, mod regenerated → 0/23 resolved). entity_ord aligns by manifest order,
// independent of the current uid. -2 = glowfly; <0 = no entity (furniture, ∅).
function entityKey(o) {
  const eo = (o.entity_ord == null) ? -1 : o.entity_ord;
  if (eo === -2) return "glowfly";
  if (eo < 0) return "∅";
  return "o" + eo;
}
// Within an entity bucket, pair anim objects. geo_hash (start-state-independent
// geometry signature) is the strongest key — exact match = distance 0, which
// disambiguates the many null-entity furniture meshes sharing (Mesh, Box, 24).
// Falls back to obj_type + geo_type + vtx. Hard penalty across obj_type so a
// Light never pairs to a Mesh.
function objDistance(a, b) {
  if (a.geo_hash && b.geo_hash && a.geo_hash === b.geo_hash && a.obj_type === b.obj_type) return 0;
  let d = 1;
  if (a.obj_type !== b.obj_type) d += 1000;
  if ((a.geo_type || null) !== (b.geo_type || null)) d += 100;
  d += Math.abs((a.vtx || 0) - (b.vtx || 0)) * 0.01;
  return d;
}
function matchObjects(monoArr, modArr) {
  const pairs = [], dropped = [], added = [];
  const modByKey = new Map();
  modArr.forEach((o, i) => { const k = entityKey(o); if (!modByKey.has(k)) modByKey.set(k, []); modByKey.get(k).push(i); });
  const used = new Set();
  function takeNearest(key, mm) {
    const arr = modByKey.get(key); if (!arr || !arr.length) return -1;
    let best = -1, bestD = Infinity, bestPos = -1;
    for (let p = 0; p < arr.length; p++) { const i = arr[p]; if (used.has(i)) continue; const dd = objDistance(mm, modArr[i]); if (dd < bestD) { bestD = dd; best = i; bestPos = p; } }
    if (best === -1) return -1;
    arr.splice(bestPos, 1); used.add(best); return best;
  }
  for (const mm of monoArr) { const j = takeNearest(entityKey(mm), mm); if (j === -1) dropped.push(mm); else pairs.push([mm, modArr[j]]); }
  modArr.forEach((o, i) => { if (!used.has(i)) added.push(o); });
  return { pairs, dropped, added };
}

// ── Stream helpers ──────────────────────────────────────────────────────────
function streamOf(o, N) {
  if (o.static) { const a = new Array(N); for (let i = 0; i < N; i++) a[i] = o.hash; return a; }
  return o.hashes || [];
}
function isAnimated(o) { return !o.static; }
// First frame index where the two streams differ; -1 if identical over the
// compared range. A length mismatch counts as divergence at the shorter length.
function firstDiverge(sa, sb) {
  const n = Math.min(sa.length, sb.length);
  for (let i = 0; i < n; i++) if (sa[i] !== sb[i]) return i;
  if (sa.length !== sb.length) return n;
  return -1;
}
function whoOf(o) { return (o.entity || "(no-entity)") + " [" + o.obj_type + (o.geo_type ? "/" + o.geo_type : "") + "]"; }

// ── Core diff (pure — exercised by --selftest) ──────────────────────────────
function runDiff(monoObj, modObj) {
  const ma = monoObj.anim_series, mb = modObj.anim_series;
  if (!ma || !mb || ma.skipped || mb.skipped || !Array.isArray(ma.objects) || !Array.isArray(mb.objects)) {
    return { skipped: true, reason: (ma && ma.skipped ? "mono:" + ma.reason : "") + " " + (mb && mb.skipped ? "mod:" + mb.reason : "") || "no anim_series" };
  }
  const N = Math.min(ma.frames || 0, mb.frames || 0) || Math.max((ma.objects[0] && (ma.objects[0].hashes || []).length) || 1, 1);
  const { pairs, dropped, added } = matchObjects(ma.objects, mb.objects);

  const findings = [];
  let cleanStreams = 0, timeVarying = 0, initialDiv = 0;
  for (const [a, b] of pairs) {
    const sa = streamOf(a, N), sb = streamOf(b, N);
    const k = firstDiverge(sa, sb);
    if (k === -1) { cleanStreams++; continue; }
    const timeVary = k > 0;
    if (timeVary) timeVarying++; else initialDiv++;
    // Severity: time-varying = high (the core catch). initial divergence on a
    // BOTH-STATIC pair = high (a real placement/material/transform divergence that
    // C3 geometry hashing misses). initial divergence INVOLVING an animated object
    // = med — empirically the start-state-offset artifact (the two harnesses begin
    // the pump from different accumulated states / RNG phases; capture-sequencing,
    // not a regression). Documented v1.1: deterministic anim start-state.
    const bothStatic = !isAnimated(a) && !isAnimated(b);
    findings.push({
      severity: timeVary ? "high" : (bothStatic ? "high" : "med"),
      kind: timeVary ? "anim_time_varying_divergence" : "anim_initial_divergence",
      who: whoOf(a), entity: a.entity, obj_type: a.obj_type,
      first_divergence_frame: k, frames: N,
      mono_animated: isAnimated(a), mod_animated: isAnimated(b),
      detail: timeVary
        ? ("streams match through frame " + (k - 1) + " then diverge at frame " + k + " — time-varying (flicker/easing/accumulator). mono_anim=" + isAnimated(a) + " mod_anim=" + isAnimated(b) + (isAnimated(a) !== isAnimated(b) ? " (ONE SIDE STATIC — animation lost/gained, the keyL.intensity class)" : ""))
        : (bothStatic
          ? "both-static objects differ at frame 0 — REAL placement/material/transform divergence (C3 geometry-hash misses world placement)"
          : "frame-0 difference involving an animated object — LIKELY start-state offset (accumulator/RNG-phase desync from capture-sequencing), not a regression; see v1.1 anim start-state determinism"),
    });
  }
  for (const m of dropped) findings.push({ severity: isAnimated(m) ? "high" : "med", kind: "anim_object_dropped", who: whoOf(m), entity: m.entity, obj_type: m.obj_type, animated: isAnimated(m), detail: "monolith object with no modular counterpart in its entity bucket" + (isAnimated(m) ? " (was ANIMATED — lost animated object)" : "") });
  for (const m of added) findings.push({ severity: isAnimated(m) ? "high" : "med", kind: "anim_object_added", who: whoOf(m), entity: m.entity, obj_type: m.obj_type, animated: isAnimated(m), detail: "modular object with no monolith counterpart" + (isAnimated(m) ? " (is ANIMATED — candidate added animation)" : "") });
  findings.sort((x, y) => (x.severity === "high" ? 0 : 1) - (y.severity === "high" ? 0 : 1));

  const high = findings.filter((f) => f.severity === "high").length;
  const decision = high > 0 ? "fail" : findings.length > 0 ? "warn" : "pass";
  const summary = {
    decision, frames: N,
    monolith_objects: ma.objects.length, modular_objects: mb.objects.length,
    mono_animated: ma.animated_count, mod_animated: mb.animated_count,
    matched_pairs: pairs.length, clean_streams: cleanStreams,
    time_varying_divergences: timeVarying, initial_divergences: initialDiv,
    dropped: dropped.length, added: added.length,
    high, med: findings.filter((f) => f.severity === "med").length,
  };
  return { findings, summary };
}

function mirrorToArtifactSystem(cfg, outPath) {
  if (!cfg.artifact_system_sink) return;
  try {
    const projectId = cfg.project || "default";
    let asRoot = process.cwd();
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(asRoot, ".parity-traces");
      const pkgPath = path.join(asRoot, "package.json");
      if (fs.existsSync(candidate) || (fs.existsSync(pkgPath) && JSON.parse(fs.readFileSync(pkgPath, "utf8")).name === "artifact-system")) {
        const destDir = path.join(candidate, projectId);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(path.join(destDir, "anim-series.sij.json"), fs.readFileSync(outPath, "utf8"), "utf8");
        console.log(`[anim-series] synced → ${path.join(destDir, "anim-series.sij.json")}`);
        break;
      }
      asRoot = path.dirname(asRoot);
    }
  } catch (err) { console.log(`[anim-series] warn: sync failed: ${err.message}`); }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) return selftest();
  const cfg = loadConfig(args.config || "parity.config.json");
  const strict = !!args.strict;

  const mono = readTrace(cfg, "monolith");
  const mod  = readTrace(cfg, "modular");
  if (!mono.obj || !mod.obj) { console.log("[anim-series] SKIP — traces not found (run 06-behavior-trace first)."); process.exit(0); }
  const res = runDiff(mono.obj, mod.obj);
  if (res.skipped) { console.log("[anim-series] SKIP — " + res.reason + " (recorder predates Stage 15 capture; re-run 06-behavior-trace)."); process.exit(0); }
  const { findings, summary } = res;

  if (!fs.existsSync(cfg.out_dir)) fs.mkdirSync(cfg.out_dir, { recursive: true });
  const outPath = path.join(cfg.out_dir, "anim-series.sij.json");
  writeSIJ(outPath, "anim-series", null, findings, { summary });
  console.log(`[anim-series] output: ${outPath}`);
  mirrorToArtifactSystem(cfg, outPath);

  console.log(`[anim-series] decision=${summary.decision} · frames=${summary.frames} · mono=${summary.monolith_objects}(${summary.mono_animated} anim) mod=${summary.modular_objects}(${summary.mod_animated} anim) · matched=${summary.matched_pairs} clean=${summary.clean_streams} time-varying=${summary.time_varying_divergences} initial=${summary.initial_divergences} dropped=${summary.dropped} added=${summary.added}`);
  for (const f of findings.slice(0, 20)) {
    if (f.kind === "anim_time_varying_divergence") console.log(`  [${f.severity}] TIME-VARYING @frame ${f.first_divergence_frame} · ${f.who}${f.mono_animated !== f.mod_animated ? " (one side static!)" : ""}`);
    else if (f.kind === "anim_initial_divergence") console.log(`  [${f.severity}] initial-state · ${f.who}`);
    else console.log(`  [${f.severity}] ${f.kind} · ${f.who}`);
  }
  if (findings.length > 20) console.log(`  … +${findings.length - 20} more`);
  if (summary.decision === "pass") console.log("[anim-series] ✓ all transform/scalar streams identical frame-by-frame.");

  process.exit(strict && summary.high > 0 ? 1 : 0);
}

// ── Self-test: synthetic streams prove the diff logic deterministically ──────
function selftest() {
  let pass = true;
  const fail = (m) => { pass = false; console.log("  ✗ " + m); };
  const ok = (m) => console.log("  ✓ " + m);
  const N = 8;
  const ents = [{ entity_id: "x1", name: "Glowfly" }, { entity_id: "x2", name: "KeyLight" }, { entity_id: "x3", name: "Dust" }];
  const modEnts = [{ entity_id: "y1", name: "Glowfly" }, { entity_id: "y2", name: "KeyLight" }, { entity_id: "y3", name: "Dust" }];
  const animStream = (seed) => { const a = []; for (let i = 0; i < N; i++) a.push("h" + ((seed + i) % 5)); return a; };

  // mono: glowfly animates (stream A), keylight FLICKERS (stream B), dust dropped-extra
  const mono = { entities: ents, anim_series: { frames: N, animated_count: 2, objects: [
    { entity: "x1", entity_ord: 0, obj_type: "Mesh", geo_type: "Box", vtx: 24, static: false, hashes: animStream(0) },
    { entity: "x2", entity_ord: 1, obj_type: "DirectionalLight", geo_type: "light", vtx: 0, static: false, hashes: animStream(2) }, // flickers
    { entity: "x3", entity_ord: 2, obj_type: "Points", geo_type: "BufferGeometry", vtx: 250, static: true, hash: "static0" },
  ] } };
  // mod: glowfly identical; keylight is STATIC (flicker LOST — keyL.intensity class);
  // dust identical static.
  const mod = { entities: modEnts, anim_series: { frames: N, animated_count: 1, objects: [
    { entity: "y1", entity_ord: 0, obj_type: "Mesh", geo_type: "Box", vtx: 24, static: false, hashes: animStream(0) },  // identical
    { entity: "y2", entity_ord: 1, obj_type: "DirectionalLight", geo_type: "light", vtx: 0, static: true, hash: "h2" }, // flicker dropped
    { entity: "y3", entity_ord: 2, obj_type: "Points", geo_type: "BufferGeometry", vtx: 250, static: true, hash: "static0" },
  ] } };

  const { findings, summary } = runDiff(mono, mod);
  summary.clean_streams === 2 ? ok("glowfly + dust streams identical (2 clean)") : fail("expected 2 clean streams, got " + summary.clean_streams);
  const tv = findings.find((f) => f.kind === "anim_time_varying_divergence");
  tv ? ok("keylight flicker LOST → time-varying divergence @frame " + tv.first_divergence_frame + (tv.mono_animated !== tv.mod_animated ? " (one side static)" : "")) : fail("flicker-lost NOT detected as time-varying");
  tv && tv.first_divergence_frame === 1 ? ok("divergence localized to frame 1 (flicker starts)") : fail("wrong divergence frame: " + (tv && tv.first_divergence_frame));
  summary.decision === "fail" ? ok("decision=fail (high findings present)") : fail("expected fail, got " + summary.decision);

  // initial divergence: two static objects with different constant hash
  const m2 = { entities: [{ entity_id: "a", name: "Wall" }], anim_series: { frames: N, animated_count: 0, objects: [{ entity: "a", entity_ord: 0, obj_type: "Mesh", geo_type: "Box", vtx: 8, static: true, hash: "wallA" }] } };
  const d2 = { entities: [{ entity_id: "b", name: "Wall" }], anim_series: { frames: N, animated_count: 0, objects: [{ entity: "b", entity_ord: 0, obj_type: "Mesh", geo_type: "Box", vtx: 8, static: true, hash: "wallB" }] } };
  const r2 = runDiff(m2, d2);
  const init = r2.findings.find((f) => f.kind === "anim_initial_divergence");
  init && init.first_divergence_frame === 0 ? ok("static objects at different state → initial divergence @frame 0") : fail("initial divergence NOT detected at frame 0");

  // skip path
  const r3 = runDiff({ entities: [], anim_series: { skipped: true, reason: "no_scene" } }, { entities: [], anim_series: { skipped: true, reason: "no_scene" } });
  r3.skipped ? ok("skipped traces handled gracefully") : fail("skip path not handled");

  console.log(pass ? "\n[anim-series] SELFTEST PASS" : "\n[anim-series] SELFTEST FAIL");
  process.exit(pass ? 0 : 1);
}

main();
