#!/usr/bin/env node
// 07-trace-diff.cjs — Semantic diff between monolith and modular behavior traces.
// Reads .parity/traces/{monolith,modular}.json, emits .parity/behavior-trace.sij.json
// with per-section parity scores and a top-level decision.
//
// Sections compared:
//   1) Entity census  — set of (object_type, position, scale) tuples
//   2) Initial lights — count + intensity proximity
//   3) Settings scrub — same preset → same renderer dimensions + light intensities
//   4) Audio scrub    — same set of categories with same defaults
//   5) Bus events     — set of event names (timing-insensitive)
//
// Tolerances configurable via parity.config.json::behavior_trace_tolerances.

"use strict";

const fs = require("fs");
const path = require("path");
const { writeSIJ, loadConfig, parseArgs, artifactSystem, probeArtifactSystem } = require("./lib/sij.cjs");

const DEFAULT_TOL = {
  entity_position_eps: 0.05,
  entity_scale_eps:    0.01,
  light_intensity_eps: 0.1,
  renderer_size_eps:   2,    // pixels
};

function close(a, b, eps) {
  const x = Number(a), y = Number(b);
  if (!isFinite(x) || !isFinite(y)) return false;
  return Math.abs(x - y) <= eps;
}

function diffEntities(mono, mod, tol) {
  // Strategy (in order of preference):
  //   1. Match by entity_id when both sides share IDs. Most accurate; works
  //      when host code uses stable IDs.
  //   2. Fall back to position-sorted pair-wise matching when IDs are randomly
  //      generated per-run (e.g., `uid()` regenerates each mount, so mono &
  //      modular have different ID sets despite identical scene layouts).
  //   3. Last resort: count-only.
  const a = mono || [], b = mod || [];
  const issues = [];

  if (a.length === 0 && b.length === 0) {
    return { pairs: 0, matched: 0, score: 0, issues: [{ severity: "warn", kind: "entities_empty_both_sides" }] };
  }

  // Step 1: try entity_id matching.
  const idMapA = new Map(), idMapB = new Map();
  for (const e of a) if (e.entity_id) idMapA.set(e.entity_id, e);
  for (const e of b) if (e.entity_id) idMapB.set(e.entity_id, e);
  const sharedIds = [...idMapA.keys()].filter((id) => idMapB.has(id));

  function comparePair(ea, eb, idLabel) {
    const posOk = close(ea.position[0], eb.position[0], tol.entity_position_eps) &&
                  close(ea.position[1], eb.position[1], tol.entity_position_eps) &&
                  close(ea.position[2], eb.position[2], tol.entity_position_eps);
    const scaleOk = close(ea.scale[0], eb.scale[0], tol.entity_scale_eps) &&
                    close(ea.scale[1], eb.scale[1], tol.entity_scale_eps) &&
                    close(ea.scale[2], eb.scale[2], tol.entity_scale_eps);
    if (!posOk) {
      issues.push({ severity: "high", kind: "entity_position", ...idLabel, monolith: ea.position, modular: eb.position });
      return false;
    }
    if (!scaleOk) {
      issues.push({ severity: "med", kind: "entity_scale", ...idLabel, monolith: ea.scale, modular: eb.scale });
      return false;
    }
    return true;
  }

  if (sharedIds.length > 0) {
    // ID overlap exists — use ID-keyed matching.
    let pairs = 0, matched = 0;
    for (const id of sharedIds) {
      pairs++;
      if (comparePair(idMapA.get(id), idMapB.get(id), { entity_id: id })) matched++;
    }
    // Missing/new only flagged if IDs are partially shared (so likely meaningful).
    for (const id of idMapA.keys()) if (!idMapB.has(id))
      issues.push({ severity: "high", kind: "entity_missing", entity_id: id, monolith_type: idMapA.get(id).object_type });
    for (const id of idMapB.keys()) if (!idMapA.has(id))
      issues.push({ severity: "med", kind: "entity_new", entity_id: id, modular_type: idMapB.get(id).object_type });
    return { pairs, matched, score: pairs === 0 ? 0 : matched / pairs, issues };
  }

  // Step 2: positional fallback (IDs are per-run randoms; sort + pair).
  const sortFn = (x, y) => (x.position[0] - y.position[0]) || (x.position[2] - y.position[2]) || (x.position[1] - y.position[1]);
  const aSorted = [...a].sort(sortFn);
  const bSorted = [...b].sort(sortFn);
  let pairs = 0, matched = 0;
  const n = Math.min(aSorted.length, bSorted.length);
  for (let i = 0; i < n; i++) {
    pairs++;
    if (comparePair(aSorted[i], bSorted[i], { index: i, fallback: "position-sorted" })) matched++;
  }
  if (aSorted.length !== bSorted.length) {
    issues.push({ severity: "high", kind: "entity_count_mismatch", monolith_count: aSorted.length, modular_count: bSorted.length });
  }
  if (sharedIds.length === 0 && idMapA.size > 0 && idMapB.size > 0) {
    issues.push({ severity: "info", kind: "entity_id_no_overlap_using_position_match", note: "IDs differ on both sides (likely per-run uid()); diff used position-sorted index match" });
  }
  return { pairs, matched, score: pairs === 0 ? 0 : matched / pairs, issues };
}

function diffLights(mono, mod, tol) {
  const a = mono || [], b = mod || [];
  const issues = [];
  if (a.length !== b.length) {
    issues.push({ severity: "high", kind: "light_count", monolith: a.length, modular: b.length });
  }
  let matched = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ok = close(a[i].intensity, b[i].intensity, tol.light_intensity_eps);
    if (!ok) issues.push({ severity: "med", kind: "light_intensity", index: i, monolith: a[i].intensity, modular: b[i].intensity });
    else matched++;
  }
  return { pairs: n, matched, score: n === 0 ? 0 : matched / n, issues };
}

function diffSettings(mono, mod, tol) {
  if ((mono && mono.skipped) || (mod && mod.skipped)) {
    return { pairs: 0, matched: 0, score: 1.0, issues: [{ severity: "info", kind: "settings_scrub_skipped", note: "settings scrub skipped by runtime config" }] };
  }
  const a = Array.isArray(mono) ? mono : [], b = Array.isArray(mod) ? mod : [];
  const issues = [];
  if (a.length !== b.length) {
    issues.push({ severity: "warn", kind: "settings_step_count", monolith: a.length, modular: b.length });
  }
  let matched = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const sa = a[i], sb = b[i];
    if (sa.step !== sb.step) {
      issues.push({ severity: "warn", kind: "settings_step_mismatch", index: i, monolith: sa.step, modular: sb.step });
      continue;
    }
    const ra = sa.observed_renderer, rb = sb.observed_renderer;
    const rendererOk = !ra && !rb || (ra && rb && close(ra.w, rb.w, tol.renderer_size_eps) && close(ra.h, rb.h, tol.renderer_size_eps));
    if (!rendererOk) {
      issues.push({ severity: "high", kind: "settings_renderer", step: sa.step, monolith: ra, modular: rb });
    }
    // Compare light arrays element-wise
    const la = sa.observed_lights || [];
    const lb = sb.observed_lights || [];
    let lightMatch = la.length === lb.length;
    for (let j = 0; j < Math.min(la.length, lb.length) && lightMatch; j++) {
      if (!close(la[j].intensity, lb[j].intensity, tol.light_intensity_eps)) lightMatch = false;
    }
    if (!lightMatch) {
      issues.push({ severity: "med", kind: "settings_lights", step: sa.step });
    }
    if (rendererOk && lightMatch) matched++;
  }
  return { pairs: n, matched, score: n === 0 ? 0 : matched / n, issues };
}

function diffAudio(mono, mod) {
  // WARNING: This is the WEAK audio check (category-name set).
  // The real "is audio working?" check is in diffAudioReady() below.
  const a = mono || [], b = mod || [];
  const namesA = new Set(a.map((x) => x.cat));
  const namesB = new Set(b.map((x) => x.cat));
  const issues = [];
  const missing = [...namesA].filter((n) => !namesB.has(n));
  const extra   = [...namesB].filter((n) => !namesA.has(n));
  missing.forEach((n) => issues.push({ severity: "high", kind: "audio_category_missing", category: n }));
  extra.forEach((n)   => issues.push({ severity: "med",  kind: "audio_category_new",     category: n }));
  return { pairs: namesA.size, matched: namesA.size - missing.length, score: namesA.size === 0 ? 1 : (namesA.size - missing.length) / namesA.size, issues };
}

function diffAudioReady(mono, mod) {
  // STRONG audio check: did init() get attempted AND succeed AND produce an
  // AudioContext class binding? Each side answers independently; we diff.
  const issues = [];
  if (!mono && !mod) {
    return { pairs: 0, matched: 0, score: 0, issues: [{ severity: "high", kind: "audio_ready_absent_both_sides" }] };
  }
  const checks = [
    { key: "available",    severity: "high" },
    { key: "init_returned", severity: "high" },
    { key: "ctx_state",    severity: "med" },
    { key: "cat_count",    severity: "high" },
  ];
  let pairs = 0, matched = 0;
  for (const c of checks) {
    pairs++;
    const va = mono ? mono[c.key] : null;
    const vb = mod  ? mod[c.key]  : null;
    if (va === vb) matched++;
    else issues.push({ severity: c.severity, kind: "audio_ready_" + c.key, monolith: va, modular: vb });
  }
  return { pairs, matched, score: pairs === 0 ? 0 : matched / pairs, issues };
}

function diffBus(mono, mod) {
  const eventsA = new Set((mono || []).map((e) => e.event));
  const eventsB = new Set((mod || []).map((e) => e.event));
  const missing = [...eventsA].filter((n) => !eventsB.has(n));
  const issues = missing.map((n) => ({ severity: "warn", kind: "bus_event_missing", event: n }));
  return { pairs: eventsA.size, matched: eventsA.size - missing.length, score: eventsA.size === 0 ? 1 : (eventsA.size - missing.length) / eventsA.size, issues };
}

function diffHUD(mono, mod) {
  const issues = [];
  if (!mono || !mod) {
    issues.push({ severity: "warn", kind: "hud_unavailable", note: "one or both sides missing HUD snapshot" });
    return { pairs: 0, matched: 0, score: 0, issues };
  }
  const keysToCompare = [
    "has_settings_button", "has_mixer_button",
    "panel_brain_explorer", "panel_inspector", "panel_ai_director",
    "total_canvases",
  ];
  let pairs = 0, matched = 0;
  for (const k of keysToCompare) {
    pairs++;
    if (mono[k] === mod[k]) matched++;
    else issues.push({ severity: "high", kind: "hud_mismatch", field: k, monolith: mono[k], modular: mod[k] });
  }
  // total_buttons comparison with tolerance (20%)
  pairs++;
  const a = mono.total_buttons, b = mod.total_buttons;
  if (a > 0 && Math.abs(a - b) / a <= 0.25) matched++;
  else issues.push({ severity: "med", kind: "hud_button_count_drift", monolith: a, modular: b });
  return { pairs, matched, score: pairs === 0 ? 0 : matched / pairs, issues };
}

function diffThreeVersion(mono, mod) {
  const issues = [];
  if (mono !== mod) {
    issues.push({ severity: "high", kind: "three_version_mismatch", monolith: mono, modular: mod });
    return { pairs: 1, matched: 0, score: 0, issues };
  }
  return { pairs: 1, matched: 1, score: 1, issues };
}

function diffRemountStress(mono, mod) {
  // Dynamic counterpart of P2 singleton-lifetime-scan (static). Both sides
  // tested + didn't see AudioContext.close() → both preserve singleton
  // lifetime across remount → pass.
  //
  // Failure modes and how each is scored:
  //   modular=fail, monolith=anything    → severity:high (real regression — modular
  //                                        broke the contract; this is exactly
  //                                        what the skill is supposed to PREVENT)
  //   monolith=fail, modular=pass        → severity:info (upgrade-note — the
  //                                        monolith has the bug; modular correctly
  //                                        applied the lifetime_contract_rule.
  //                                        This is the EXPECTED, CELEBRATED
  //                                        outcome of modularize-monolith. DO NOT
  //                                        score as fail — that would punish
  //                                        users for doing the right thing.)
  //   both fail                          → severity:high (bug copied across; rare)
  //
  // Score = "fraction of sides that pass the contract." Modular passing carries
  // more weight than monolith passing because modular is what we're shipping.
  const issues = [];
  function evaluate(side, t) {
    if (!t || !t.tested) {
      issues.push({ severity: "warn", kind: "remount_stress_not_tested", side, reason: (t && t.reason) || "missing" });
      return null;
    }
    return !!t.audio_context_survived;
  }
  const monoOk = evaluate("monolith", mono);
  const modOk  = evaluate("modular",  mod);

  // Decide the issue shape based on the (mono, mod) pair.
  if (modOk === false && monoOk === true) {
    issues.push({
      severity: "high",
      kind: "remount_stress_modular_regression",
      rationale: "Modular fails the singleton lifetime contract that monolith passes. This is a regression — see RFC-008 Appendix D + modularize-monolith SKILL.md <lifetime_contract_rule>.",
      monolith: mono, modular: mod,
    });
  } else if (modOk === false && monoOk === false) {
    issues.push({
      severity: "high",
      kind: "remount_stress_both_sides_killed",
      rationale: "AudioContext.close() fires on both sides during remount — the lifetime-contract bug existed in the monolith and was carried into modular. Fix per RFC-008 Appendix D.",
      monolith: mono, modular: mod,
    });
  } else if (modOk === true && monoOk === false) {
    issues.push({
      severity: "info",
      kind: "remount_stress_modular_upgraded_monolith",
      rationale: "Monolith had the singleton lifetime bug (AudioContext.close() during remount); modular correctly applies the lifetime_contract_rule and survives. This is the intended outcome of modularize-monolith — celebrated, not flagged.",
      monolith_closes_after: (mono && mono.closes_after),
      modular_closes_after:  (mod  && mod.closes_after),
    });
  }
  // Otherwise (both pass) → no issue at all.

  // Score: modular survival is the load-bearing signal (it's what we ship).
  // When modular passes, the section scores 1.0 regardless of monolith state.
  // When modular fails, the score is 0.0.
  let pairs = 0, matched = 0;
  if (modOk !== null) {
    pairs = 1;
    matched = modOk ? 1 : 0;
  }
  return { pairs, matched, score: pairs === 0 ? 0 : matched / pairs, issues };
}

// ─── R7: New diff functions (close RC1/RC3/RC4 blind spots) ───────────────────

function diffLightFull(mono, mod, tol) {
  const a = mono || [], b = mod || [];
  const issues = [];
  if (a.length !== b.length) {
    issues.push({ severity: "high", kind: "light_count", monolith: a.length, modular: b.length });
  }
  let matched = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let ok = true;
    if (a[i].position && b[i].position) {
      for (let j = 0; j < 3; j++) {
        if (!close(a[i].position[j], b[i].position[j], tol.entity_position_eps)) {
          issues.push({ severity: "high", kind: "light_position", index: i, axis: j,
            monolith: a[i].position, modular: b[i].position });
          ok = false;
          break;
        }
      }
    }
    if (a[i].type && b[i].type && a[i].type !== b[i].type) {
      issues.push({ severity: "high", kind: "light_type", index: i,
        monolith: a[i].type, modular: b[i].type });
      ok = false;
    }
    if (ok) matched++;
  }
  return { pairs: n, matched, score: n === 0 ? 0 : matched / n, issues };
}

function diffMaterials(mono, mod) {
  const a = mono || [], b = mod || [];
  const issues = [];
  if (a.length !== b.length) {
    issues.push({ severity: "med", kind: "material_count", monolith: a.length, modular: b.length });
  }
  let matched = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const pa = a[i].params || {}, pb = b[i].params || {};
    const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
    let same = true;
    for (const k of keys) {
      if (String(pa[k]) !== String(pb[k])) {
        issues.push({ severity: "med", kind: "material_param", index: i, param: k,
          monolith: pa[k], modular: pb[k] });
        same = false;
        break;
      }
    }
    if (same) matched++;
  }
  return { pairs: n, matched, score: n === 0 ? 1 : matched / n, issues };
}

function diffGpuTelemetry(mono, mod) {
  const issues = [];
  if (!mono && !mod) return { pairs: 0, matched: 0, score: 0, issues: [{ severity: "warn", kind: "gpu_telemetry_absent" }] };
  if (!mono || !mod) {
    issues.push({ severity: "high", kind: "gpu_telemetry_missing_one_side", monolith: !!mono, modular: !!mod });
    return { pairs: 0, matched: 0, score: 0, issues };
  }
  const ta = mono.totals || {}, tb = mod.totals || {};
  const checks = [
    { key: "lines", tolerance: 0, severity: "high" },
    { key: "matpool_size", tolerance: 0, severity: "med" },
    { key: "triangles", tolerance: 0.25, severity: "med" },
    { key: "calls", tolerance: 0.50, severity: "med" },
    { key: "geometries", tolerance: 0.25, severity: "med" },
  ];
  let pairs = 0, matched = 0;
  for (const c of checks) {
    const va = ta[c.key], vb = tb[c.key];
    if (va == null && vb == null) continue;
    pairs++;
    if (va == null || vb == null) {
      issues.push({ severity: c.severity, kind: "gpu_" + c.key + "_missing", monolith: va, modular: vb });
      continue;
    }
    if (c.tolerance === 0) {
      if (va === vb) matched++;
      else issues.push({ severity: c.severity, kind: "gpu_" + c.key, monolith: va, modular: vb });
    } else {
      const ratio = Math.abs(va - vb) / Math.max(Math.abs(va), 1);
      if (ratio <= c.tolerance) matched++;
      else issues.push({ severity: c.severity, kind: "gpu_" + c.key, monolith: va, modular: vb, drift_pct: Math.round(ratio * 100) });
    }
  }
  return { pairs, matched, score: pairs === 0 ? 0 : matched / pairs, issues };
}

function diffEntityMeta(mono, mod) {
  const a = mono || [], b = mod || [];
  const issues = [];
  const idMapA = new Map(), idMapB = new Map();
  for (const e of a) if (e.entity_id) idMapA.set(e.entity_id, e);
  for (const e of b) if (e.entity_id) idMapB.set(e.entity_id, e);
  const sharedIds = [...idMapA.keys()].filter((id) => idMapB.has(id));
  let pairs = 0, matched = 0;
  const comparePair = (ea, eb, label) => {
    pairs++;
    const da = ea.descendant_count ?? 0, db = eb.descendant_count ?? 0;
    if (Math.abs(da - db) <= 1) matched++;
    else issues.push({ severity: "med", kind: "entity_descendant_count", ...label, monolith: da, modular: db });
  };
  if (sharedIds.length > 0) {
    for (const id of sharedIds) comparePair(idMapA.get(id), idMapB.get(id), { entity_id: id });
  } else {
    const sortFn = (x, y) => (x.position[0] - y.position[0]) || (x.position[2] - y.position[2]);
    const aS = [...a].sort(sortFn), bS = [...b].sort(sortFn);
    for (let i = 0; i < Math.min(aS.length, bS.length); i++) comparePair(aS[i], bS[i], { index: i });
  }
  return { pairs, matched, score: pairs === 0 ? 1 : matched / pairs, issues };
}

function diffSceneCensus(mono, mod) {
  const a = mono || {}, b = mod || {};
  const issues = [];
  if (!Object.keys(a).length && !Object.keys(b).length) {
    return { pairs: 0, matched: 0, score: 0, issues: [{ severity: "warn", kind: "scene_census_absent" }] };
  }
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let pairs = 0, matched = 0;
  for (const k of allKeys) {
    pairs++;
    const va = a[k] || 0, vb = b[k] || 0;
    if (va === vb) matched++;
    else issues.push({ severity: "high", kind: "scene_census_mismatch", group: k, monolith: va, modular: vb });
  }
  return { pairs, matched, score: pairs === 0 ? 0 : matched / pairs, issues };
}

function diffEntityBehavior(mono, mod) {
    const a = mono || [], b = mod || [];
    const issues = [];
    const idMapA = new Map(), idMapB = new Map();
    for (const e of a) if (e.entity_id) idMapA.set(e.entity_id, e);
    for (const e of b) if (e.entity_id) idMapB.set(e.entity_id, e);
    const sharedIds = [...idMapA.keys()].filter((id) => idMapB.has(id));
    let pairs = 0, matched = 0;
    
    const isObjectEqual = (obj1, obj2) => {
        const keys1 = Object.keys(obj1), keys2 = Object.keys(obj2);
        if (keys1.length !== keys2.length) return false;
        for (const key of keys1) if (obj1[key] !== obj2[key]) return false;
        return true;
    };

    const comparePair = (ea, eb, label) => {
        pairs += 3;
        const aniA = ea.animation || "none", aniB = eb.animation || "none";
        const intA = ea.intent || "none", intB = eb.intent || "none";
        const parA = ea.params || {}, parB = eb.params || {};
        
        if (aniA === aniB) matched++;
        else issues.push({ severity: "high", kind: "entity_animation", ...label, monolith: aniA, modular: aniB });
        
        if (intA === intB) matched++;
        else issues.push({ severity: "med", kind: "entity_intent", ...label, monolith: intA, modular: intB });
        
        if (isObjectEqual(parA, parB)) matched++;
        else issues.push({ severity: "med", kind: "entity_params", ...label, monolith: JSON.stringify(parA), modular: JSON.stringify(parB) });
    };
    
    if (sharedIds.length > 0) {
      for (const id of sharedIds) comparePair(idMapA.get(id), idMapB.get(id), { entity_id: id });
    } else {
      const sortFn = (x, y) => (x.position[0] - y.position[0]) || (x.position[2] - y.position[2]);
      const aS = [...a].sort(sortFn), bS = [...b].sort(sortFn);
      for (let i = 0; i < Math.min(aS.length, bS.length); i++) comparePair(aS[i], bS[i], { index: i });
    }
    
    return { pairs, matched, score: Math.round((matched / Math.max(1, pairs)) * 100), issues };
}

function diffRendererConfig(mono, mod) {
  const issues = [];
  if (!mono && !mod) return { pairs: 0, matched: 0, score: 0, issues: [{ severity: "warn", kind: "renderer_config_absent" }] };
  if (!mono || !mod) {
    issues.push({ severity: "med", kind: "renderer_config_missing_one_side" });
    return { pairs: 0, matched: 0, score: 0, issues };
  }
  const highKeys = ["toneMapping", "shadowMap_enabled"];
  const medKeys = ["outputColorSpace", "toneMappingExposure"];
  let pairs = 0, matched = 0;
  for (const k of [...highKeys, ...medKeys]) {
    if (mono[k] == null && mod[k] == null) continue;
    pairs++;
    if (String(mono[k]) === String(mod[k])) matched++;
    else issues.push({ severity: highKeys.includes(k) ? "high" : "med",
      kind: "renderer_config_" + k, monolith: mono[k], modular: mod[k] });
  }
  return { pairs, matched, score: pairs === 0 ? 1 : matched / pairs, issues };
}

function diffSceneConfig(mono, mod) {
  const issues = [];
  if (!mono && !mod) return { pairs: 0, matched: 0, score: 0, issues: [{ severity: "warn", kind: "scene_config_absent" }] };
  if (!mono || !mod) {
    issues.push({ severity: "med", kind: "scene_config_missing_one_side" });
    return { pairs: 0, matched: 0, score: 0, issues };
  }
  const checks = [
    { key: "fog_type", severity: "high" },
    { key: "fog_color", severity: "med" },
    { key: "background_color", severity: "med" },
  ];
  let pairs = 0, matched = 0;
  for (const c of checks) {
    if (mono[c.key] == null && mod[c.key] == null) continue;
    pairs++;
    if (String(mono[c.key]) === String(mod[c.key])) matched++;
    else issues.push({ severity: c.severity, kind: "scene_" + c.key, monolith: mono[c.key], modular: mod[c.key] });
  }
  if (mono.fog_density != null || mod.fog_density != null) {
    pairs++;
    if (close(mono.fog_density || 0, mod.fog_density || 0, 0.005)) matched++;
    else issues.push({ severity: "med", kind: "scene_fog_density", monolith: mono.fog_density, modular: mod.fog_density });
  }
  return { pairs, matched, score: pairs === 0 ? 1 : matched / pairs, issues };
}

function diffCameraState(mono, mod) {
  // R8: explains a class of renderer.info per-frame deltas (calls, triangles,
  // memory.geometries) that look like regressions but are actually camera-
  // position artifacts. If frustum_visible_meshes differs significantly, the
  // sides simply pointed cameras at different parts of the scene at snapshot
  // time — the delta in renderer.info follows mechanically.
  //
  // This section is informational by design: a per-run orbit position is NOT
  // a regression. The signal is: did we see equivalent fractions of the scene?
  const issues = [];
  if (!mono && !mod) return { pairs: 0, matched: 0, score: 0, issues: [{ severity: "warn", kind: "camera_state_absent" }] };
  if (!mono || !mod) {
    issues.push({ severity: "warn", kind: "camera_state_missing_one_side", monolith: !!mono, modular: !!mod });
    return { pairs: 0, matched: 0, score: 0, issues };
  }
  let pairs = 0, matched = 0;

  // Position delta (euclidean). Info-only unless > 5 units (likely points at very different region).
  if (Array.isArray(mono.position) && Array.isArray(mod.position)) {
    pairs++;
    const dx = (mono.position[0] - mod.position[0]);
    const dy = (mono.position[1] - mod.position[1]);
    const dz = (mono.position[2] - mod.position[2]);
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (dist <= 0.5) matched++;
    else issues.push({
      severity: dist > 5 ? "med" : "info",
      kind: "camera_position_delta",
      delta: Number(dist.toFixed(3)),
      monolith: mono.position,
      modular: mod.position,
      rationale: "Orbit camera defaults may differ; affects frustum culling.",
    });
  }

  // FOV / aspect / projection-type checks — these are real if they diverge.
  if (mono.fov != null && mod.fov != null) {
    pairs++;
    if (Math.abs(mono.fov - mod.fov) <= 0.5) matched++;
    else issues.push({ severity: "med", kind: "camera_fov", monolith: mono.fov, modular: mod.fov });
  }
  if (mono.is_perspective !== mod.is_perspective || mono.is_orthographic !== mod.is_orthographic) {
    pairs++;
    issues.push({ severity: "high", kind: "camera_projection_type_mismatch",
      monolith: { perspective: mono.is_perspective, ortho: mono.is_orthographic },
      modular:  { perspective: mod.is_perspective,  ortho: mod.is_orthographic } });
  } else if (mono.is_perspective || mono.is_orthographic) {
    pairs++; matched++;
  }

  // Frustum-visible mesh count — THE diagnostic.
  if (typeof mono.frustum_visible_meshes === "number" && typeof mod.frustum_visible_meshes === "number") {
    pairs++;
    const a = mono.frustum_visible_meshes, b = mod.frustum_visible_meshes;
    const denom = Math.max(a, b, 1);
    const driftPct = Math.round((Math.abs(a - b) / denom) * 100);
    if (driftPct <= 20) matched++;
    else issues.push({
      severity: "info",
      kind: "frustum_visible_meshes_delta",
      monolith: a, modular: b, drift_pct: driftPct,
      rationale: "Significant frustum-culling delta. This MECHANICALLY explains any renderer.info.render.calls / .triangles / memory.geometries delta in gpu_telemetry — different camera angles → different mesh subsets drawn → different per-frame counters. Not a code regression by itself.",
      explains: ["gpu_telemetry/calls", "gpu_telemetry/triangles", "gpu_telemetry/geometries"],
    });
  }
  if (typeof mono.frustum_visible_entities === "number" && typeof mod.frustum_visible_entities === "number") {
    pairs++;
    if (mono.frustum_visible_entities === mod.frustum_visible_entities) matched++;
    else issues.push({ severity: "info", kind: "frustum_visible_entities_delta", monolith: mono.frustum_visible_entities, modular: mod.frustum_visible_entities });
  }
  return { pairs, matched, score: pairs === 0 ? 1 : matched / pairs, issues };
}

// Stage 12 verdict consumer. Reads pixel-diff.sij.json (produced by
// 12-pixel-diff.cjs) and embeds its summary as a section so the unified
// behavior-trace.sij.json carries visual-parity status alongside runtime
// signals. Pure read — does NOT recompute. If pixel-diff has not been run
// yet, returns a warn pointing the agent to run it.
function diffPixel(cfg) {
  const verdictPath = path.join(cfg.out_dir, "pixel-diff.sij.json");
  if (!fs.existsSync(verdictPath)) {
    return {
      pairs: 0, matched: 0, score: 0,
      issues: [{ severity: "warn", kind: "pixel_diff_not_run", rationale: "Run `node ~/.claude/skills/parity-cab/scripts/12-pixel-diff.cjs --config parity.config.json` after 06-behavior-trace to populate visual parity." }],
    };
  }
  let verdict;
  try { verdict = JSON.parse(fs.readFileSync(verdictPath, "utf8")); }
  catch (e) {
    return { pairs: 0, matched: 0, score: 0, issues: [{ severity: "warn", kind: "pixel_diff_unreadable", rationale: "Verdict file exists but failed to parse: " + e.message }] };
  }
  const summary = verdict.summary || {};
  const perPreset = Array.isArray(verdict.per_preset) ? verdict.per_preset : [];
  const issues = [];
  for (const p of perPreset) {
    if (p.decision === "pass") continue;
    issues.push({
      severity: p.decision === "fail" ? "high" : "med",
      kind: "pixel_diff_" + p.decision,
      preset: p.name,
      ssim: p.ssim,
      diff_pct: p.diff_pct,
      diff_png: p.diff_png,
      explains_field: null,
      rationale: p.decision === "fail"
        ? `Visual divergence on '${p.name}'. Inspect cross-pillar joins: camera_state, scene_config, renderer_config, materials.`
        : `Visual warning on '${p.name}' — below failure threshold.`,
    });
  }
  const pairs = perPreset.length || 0;
  const matched = perPreset.filter(p => p.decision === "pass").length;
  const score = pairs === 0 ? (summary.decision === "skipped" ? 1 : 0) : matched / pairs;
  return { pairs, matched, score, issues, embedded_summary: summary, input_fingerprint: verdict.input_fingerprint };
}

function diffHudDeep(mono, mod) {
  const issues = [];
  if (!mono || !mod) return { pairs: 0, matched: 0, score: 0, issues: [{ severity: "warn", kind: "hud_deep_absent" }] };
  let pairs = 0, matched = 0;
  const ca = mono.canvas_size, cb = mod.canvas_size;
  if (ca && cb) {
    pairs++;
    const wOk = Math.abs((ca.client_w || 0) - (cb.client_w || 0)) <= Math.max((ca.client_w || 0) * 0.05, 5);
    const hOk = Math.abs((ca.client_h || 0) - (cb.client_h || 0)) <= Math.max((ca.client_h || 0) * 0.05, 5);
    if (wOk && hOk) matched++;
    else issues.push({ severity: "med", kind: "hud_canvas_size", monolith: ca, modular: cb });
  }
  const titlesA = new Set((mono.top_button_titles || []).map(t => t.title));
  const titlesB = new Set((mod.top_button_titles || []).map(t => t.title));
  if (titlesA.size > 0 || titlesB.size > 0) {
    const missing = [...titlesA].filter(t => !titlesB.has(t));
    pairs++;
    if (missing.length === 0) matched++;
    else issues.push({ severity: "med", kind: "hud_button_titles_missing", missing });
  }
  return { pairs, matched, score: pairs === 0 ? 1 : matched / pairs, issues };
}

function diffSettingsPositions(mono, mod, tol) {
  const a = mono || [], b = mod || [];
  const issues = [];
  let matched = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const sa = a[i], sb = b[i];
    if (sa.step !== sb.step) continue;
    const la = sa.observed_lights || [], lb = sb.observed_lights || [];
    let posOk = true;
    for (let j = 0; j < Math.min(la.length, lb.length); j++) {
      if (la[j].position && lb[j].position) {
        for (let k = 0; k < 3; k++) {
          if (!close(la[j].position[k], lb[j].position[k], tol.entity_position_eps)) {
            issues.push({ severity: "med", kind: "settings_light_position", step: sa.step, light_index: j,
              monolith: la[j].position, modular: lb[j].position });
            posOk = false;
            break;
          }
        }
      }
      if (!posOk) break;
    }
    if (posOk) matched++;
  }
  return { pairs: n, matched, score: n === 0 ? 1 : matched / n, issues };
}

function decideOverall(sections) {
  let decision = "pass";
  for (const [, s] of Object.entries(sections)) {
    for (const i of s.issues) {
      if (i.severity === "high") decision = "fail";
      else if (i.severity === "med" && decision === "pass") decision = "warn";
    }
  }
  return decision;
}

function deriveProject(cfg) {
  if (cfg.project) return cfg.project;
  if (cfg.modular && cfg.modular.root) {
    const base = path.basename(path.resolve(cfg.modular.root));
    return base && base !== "src" ? base : "default";
  }
  return "default";
}

async function uploadDiffIfArtifactSystemUp(cfg, diffDoc, project) {
  if (!(await probeArtifactSystem(cfg))) return false;
  try {
    const url = artifactSystem(cfg).sink +
                "/diff?project=" + encodeURIComponent(project);
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(diffDoc) });
    if (r.ok) {
      console.log(`[trace-diff] uploaded diff to artifact-system (project=${project})`);
      return true;
    }
  } catch (e) {
    console.log("[trace-diff] artifact-system diff upload failed: " + e.message);
  }
  return false;
}

// Read both traces. Source-of-truth precedence:
//   1) artifact-system API when reachable (the canonical store as of P5 —
//      06-behavior-trace posts straight to /api/parity-trace and the diff
//      must follow the same address to avoid reading stale local snapshots).
//   2) Local file fallback at <cfg.out_dir>/traces/<side>.json (legacy
//      :4203-sink path, kept for offline/no-artifact-system workflows).
//
// When the API is up but ALSO has a local file present, the API wins. Any
// new run overwrites the local fallback via a write-through copy so the
// local snapshot doesn't go stale.
async function fetchSidePair(cfg, project) {
  const tracesDir = path.join(cfg.out_dir, "traces");
  const monoLocal = path.join(tracesDir, "monolith.json");
  const modLocal  = path.join(tracesDir, "modular.json");

  // Try artifact-system first (config-gated; standalone when disabled).
  const apiUp = await probeArtifactSystem(cfg);

  if (apiUp) {
    const base = artifactSystem(cfg).sink;
    try {
      const [rMono, rMod] = await Promise.all([
        fetch(base + "/monolith?project=" + encodeURIComponent(project)),
        fetch(base + "/modular?project=" + encodeURIComponent(project)),
      ]);
      if (rMono.ok && rMod.ok) {
        const mono = await rMono.json();
        const mod  = await rMod.json();
        // Write-through to local for offline diff + git-trackable snapshot.
        try {
          if (!fs.existsSync(tracesDir)) fs.mkdirSync(tracesDir, { recursive: true });
          fs.writeFileSync(monoLocal, JSON.stringify(mono, null, 2), "utf8");
          fs.writeFileSync(modLocal,  JSON.stringify(mod,  null, 2), "utf8");
        } catch (_) {}
        console.log("[trace-diff] read traces from artifact-system (project=" + project + ")");
        return { mono, mod };
      }
      console.log("[trace-diff] artifact-system reachable but /monolith or /modular missing — falling back to local files");
    } catch (e) {
      console.log("[trace-diff] artifact-system fetch failed: " + e.message + " — falling back to local files");
    }
  }

  // Local fallback.
  if (!fs.existsSync(monoLocal) || !fs.existsSync(modLocal)) {
    console.error("ERROR: traces not found in either source.");
    console.error("  artifact-system: " + (apiUp ? "reachable but project not present" : "unreachable"));
    console.error("  local:           " + monoLocal);
    console.error("                   " + modLocal);
    console.error("Run 06-behavior-trace.cjs first and let both harnesses report.");
    process.exit(2);
  }
  console.log("[trace-diff] read traces from local files (artifact-system unreachable)");
  return {
    mono: JSON.parse(fs.readFileSync(monoLocal, "utf8")),
    mod:  JSON.parse(fs.readFileSync(modLocal,  "utf8")),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config || "parity.config.json");
  const project = deriveProject(cfg);
  const { mono, mod } = await fetchSidePair(cfg, project);
  const tol  = Object.assign({}, DEFAULT_TOL, cfg.behavior_trace_tolerances || {});

  const sections = {
    three_version:        diffThreeVersion(mono.three_version, mod.three_version),
    entities:             diffEntities(mono.entities, mod.entities, tol),
    initial_lights:       diffLights(mono.lights_initial, mod.lights_initial, tol),
    light_positions:      diffLightFull(mono.lights_initial, mod.lights_initial, tol),           // R7: RC1 fix
    materials:            diffMaterials(mono.materials, mod.materials),                          // R7: RC1 fix
    gpu_telemetry:        diffGpuTelemetry(mono.gpu_telemetry, mod.gpu_telemetry),               // R7: RC1 fix
    entity_metadata:      diffEntityMeta(mono.entities, mod.entities),                           // R7: RC1 fix
    entity_behavior:      diffEntityBehavior(mono.entities, mod.entities),                       // R7: Zero-trust behavior fix
    scene_census:         diffSceneCensus(mono.scene_census, mod.scene_census),                   // R7: RC3 fix
    renderer_config:      diffRendererConfig(mono.renderer_config, mod.renderer_config),          // R7: RC4 fix
    scene_config:         diffSceneConfig(mono.scene_config, mod.scene_config),                   // R7: RC4 fix
    camera_state:         diffCameraState(mono.camera_state, mod.camera_state),                    // R8: explains gpu_telemetry per-frame deltas via frustum-visible-mesh count
    pixel_diff:           diffPixel(cfg),                                                            // Stage 12: visual parity verdict (read from pixel-diff.sij.json)
    settings_scrub:       diffSettings(mono.settings_scrub, mod.settings_scrub, tol),
    settings_light_positions: diffSettingsPositions(mono.settings_scrub, mod.settings_scrub, tol), // R7: RC1 fix
    audio_category_names: diffAudio(mono.audio_scrub, mod.audio_scrub),        // weak: name set
    audio_functional:     diffAudioReady(mono.audio_ready, mod.audio_ready),   // strong: init+ctx
    remount_stress:       diffRemountStress(mono.remount_stress, mod.remount_stress), // RFC-008 Appendix D dynamic check
    bus_events:           diffBus(mono.bus_events, mod.bus_events),
    hud:                  diffHUD(mono.hud, mod.hud),
    hud_deep:             diffHudDeep(mono.hud, mod.hud),                                        // R7: RC1 fix
  };

  const overall = decideOverall(sections);
  const totalIssues = Object.values(sections).reduce((acc, s) => acc + s.issues.length, 0);

  const summary = {
    decision: overall, // pass | warn | fail
    section_scores: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, Number(v.score.toFixed(3))])),
    total_issues: totalIssues,
    tolerances: tol,
  };

  const diffDoc = writeSIJ(path.join(cfg.out_dir, "behavior-trace.sij.json"), "behavior-trace", null,
    Object.values(sections).reduce((acc, s) => acc.concat(s.issues), []),
    { summary, sections });

  console.log(`[trace-diff] project=${project} decision=${overall} issues=${totalIssues}`);
  for (const [name, s] of Object.entries(sections)) {
    console.log(`  ${name}: score=${s.score.toFixed(3)} (${s.matched}/${s.pairs}) issues=${s.issues.length}`);
  }

  // Best-effort: surface the diff to artifact-system's tracker UI if it's running.
  await uploadDiffIfArtifactSystemUp(cfg, diffDoc, project);
}

if (require.main === module) main().catch((e) => { console.error("[trace-diff] FATAL:", e && e.stack || e); process.exit(1); });
