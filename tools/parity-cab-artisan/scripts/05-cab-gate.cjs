#!/usr/bin/env node
// 05-cab-gate.cjs — Final verdict. Re-reads RFC dispositions, runs tsc (optional),
// scores parity, emits GO/NO-GO.
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { readSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");

function readRFCDispositions(rfcDir) {
  if (!fs.existsSync(rfcDir)) return [];
  const files = fs.readdirSync(rfcDir).filter((f) => /\.md$/.test(f));
  return files.map((f) => {
    const raw = fs.readFileSync(path.join(rfcDir, f), "utf8");
    const fm = (raw.match(/^---\n([\s\S]*?)\n---/) || [, ""])[1];
    const o = { file: f };
    fm.split("\n").forEach((line) => {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) o[m[1]] = m[2].trim();
    });
    return o;
  });
}

function runTsc(cfg) {
  const tscRoot = cfg.tsc_root || cfg.modular.root;
  // Walk up from tsc_root looking for a tsconfig.json (or use one in tsc_root itself)
  let dir = tscRoot;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "tsconfig.json"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const tscBin = path.join(dir, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  if (!fs.existsSync(tscBin)) {
    return { status: "skip", details: "tsc not found in " + dir + "/node_modules/.bin (skipping)" };
  }
  try {
    execSync(`"${tscBin}" --noEmit -p "${path.join(dir, "tsconfig.json")}"`, { stdio: "pipe", encoding: "utf8" });
    return { status: "pass", details: "0 errors" };
  } catch (e) {
    const out = (e.stdout || "") + (e.stderr || "");
    const lines = out.split("\n").filter((l) => /error TS\d+/.test(l));
    return { status: "fail", details: `${lines.length} error(s)`, sample: lines.slice(0, 5) };
  }
}

function decide(checks, thresholds) {
  const fails = Object.entries(checks).filter(([, v]) => v.status === "fail");
  const warns = Object.entries(checks).filter(([, v]) => v.status === "warn");
  if (fails.length) return "NO-GO";
  if (warns.length) return "GO-WITH-WARNINGS";
  return "GO";
}

// H5: runtime checklist — the things STRUCTURAL parity cannot verify. Scans the
// monolith for patterns whose modular equivalent must be hand-verified (the
// Parity-Paradox class from the N=2 test). Informational: does NOT change the decision.
function buildRuntimeChecklist(cfg) {
  const list = [];
  let src = "";
  try {
    const root = cfg.monolith && cfg.monolith.root;
    if (root && fs.existsSync(root) && fs.statSync(root).isFile()) src = fs.readFileSync(root, "utf8");
  } catch (_) { return list; }
  if (!src) return list;
  const add = (re, msg) => { if (re.test(src)) list.push(msg); };
  add(/\bwindow\.onload\b|\bonload\s*=/, "Monolith uses window.onload — verify the modular uses addEventListener('load', …) WITH a document.readyState fallback (type=module scripts are deferred, so a late handler never fires).");
  add(/<script[^>]+src=["'][^"']*(unpkg|jsdelivr|cdnjs|cdn\.|googleapis|gstatic|skypack|esm\.sh)[^"']*["']/i, "Monolith loads CDN <script> globals — verify the modular HTML loads the SAME CDN globals (e.g. THREE/YUKA/gsap) BEFORE the module executes.");
  add(/new\s+\(?\s*(?:window\.)?(?:AudioContext|webkitAudioContext)\b/, "Monolith creates an AudioContext — verify audio unlock on a user gesture still works after the split.");
  add(/\bgetElementById\(|\bquerySelector(?:All)?\(/, "Monolith references DOM elements — verify every id/selector used in the modular JS exists in the modular HTML.");
  add(/\blocalStorage\b|\bsessionStorage\b/, "Monolith uses web storage — verify keys/format are unchanged in the modular split.");
  return list;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config || "parity.config.json");
  const report = readSIJ(path.join(cfg.out_dir, "parity-report.sij.json"));
  const summary = report.summary;
  const rfcs = readRFCDispositions(path.join(cfg.out_dir, "rfcs"));

  const checks = {};

  // Check 1: tsc clean
  checks.tsc_clean = runTsc(cfg);

  // Check 2: parity threshold
  const minScore = cfg.thresholds.parity_score_min;
  checks.parity_threshold = {
    status: summary.parity_score >= minScore ? "pass" : "fail",
    expected: minScore,
    actual: summary.parity_score,
  };

  // Check 3: HIGH risk RFCs unresolved
  const highOpen = rfcs.filter((r) => (r.risk === "high" || r.risk === "critical") && r.disposition === "pending");
  checks.high_rfcs_open = {
    status: highOpen.length <= (cfg.thresholds.max_high_open || 0) ? "pass" : "fail",
    count: highOpen.length,
    sample: highOpen.slice(0, 5).map((r) => r.rfc_id + " " + r.file),
  };

  // Check 4: MED risk RFCs unresolved (warning only)
  const medOpen = rfcs.filter((r) => r.risk === "med" && r.disposition === "pending");
  checks.med_rfcs_open = {
    status: medOpen.length === 0 ? "pass" : "warn",
    count: medOpen.length,
    sample: medOpen.slice(0, 5).map((r) => r.rfc_id + " " + r.file),
  };

  // Check 5: missing symbols — only "unresolved" missing count (pending disposition)
  // block. Dispositioned missing (intentional_drop / intentional_rename / approved)
  // do not fail the gate.
  const missingRfcs = rfcs.filter((r) => r.gap === "missing");
  const missingPending = missingRfcs.filter((r) => !r.disposition || r.disposition === "pending");
  checks.missing_symbols = {
    status: missingPending.length === 0 ? "pass" : (missingPending.length > 5 ? "fail" : "warn"),
    count_total: summary.counts.missing,
    count_pending: missingPending.length,
    count_dispositioned: missingRfcs.length - missingPending.length,
  };

  // Check 6: any regression_to_fix dispositions block
  const regressions = rfcs.filter((r) => r.disposition === "regression_to_fix");
  checks.regressions_pending = {
    status: regressions.length === 0 ? "pass" : "fail",
    count: regressions.length,
    sample: regressions.slice(0, 5).map((r) => r.rfc_id + " " + r.file),
  };

  // Check 7: behavior trace match (Stage 6). Skipped if not yet run — does not
  // block by absence. When present, follows its own decision (pass/warn/fail).
  const tracePath = path.join(cfg.out_dir, "behavior-trace.sij.json");
  if (fs.existsSync(tracePath)) {
    try {
      const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
      const dec = (trace.summary && trace.summary.decision) || "warn";
      checks.behavior_trace_matches = {
        status: dec === "pass" ? "pass" : (dec === "warn" ? "warn" : "fail"),
        section_scores: trace.summary && trace.summary.section_scores,
        total_issues: trace.summary && trace.summary.total_issues,
      };
    } catch (e) {
      checks.behavior_trace_matches = { status: "warn", details: "could not parse behavior-trace.sij.json: " + e.message };
    }
  } else {
    checks.behavior_trace_matches = { status: "skip", details: "Stage 6 not run. Execute 06-behavior-trace.cjs + 07-trace-diff.cjs to populate." };
  }

  // Check 8: scaffold / wiring (Stage 05b). Bridges the "Parity Paradox" — structural
  // parity GO does NOT mean the app boots. A scaffold FAIL (broken module path / import
  // chain) downgrades the verdict via decide(). Skipped if 05b not run (non-web project).
  const scaffoldPath = path.join(cfg.out_dir, "scaffold-check.sij.json");
  if (fs.existsSync(scaffoldPath)) {
    try {
      const sc = JSON.parse(fs.readFileSync(scaffoldPath, "utf8"));
      const dec = (sc.summary && sc.summary.decision) || "warn";
      const map = { pass: "pass", warn: "warn", fail: "fail", skip: "skip" };
      checks.scaffold_wiring = {
        status: map[dec] || "warn",
        high: sc.summary && sc.summary.high, med: sc.summary && sc.summary.med,
      };
    } catch (e) {
      checks.scaffold_wiring = { status: "warn", details: "could not parse scaffold-check.sij.json: " + e.message };
    }
  } else {
    checks.scaffold_wiring = { status: "skip", details: "Stage 05b not run (non-web project or skipped)." };
  }

  const runtimeChecklist = buildRuntimeChecklist(cfg);
  const decision = decide(checks, cfg.thresholds);
  const nextSteps = [];
  if (checks.tsc_clean.status === "fail") nextSteps.push("Fix tsc errors before re-running CAB gate");
  if (checks.parity_threshold.status === "fail") nextSteps.push(`Restore parity to ≥ ${minScore} (currently ${summary.parity_score})`);
  if (highOpen.length) nextSteps.push(`Review ${highOpen.length} HIGH-risk RFC(s) under .parity/rfcs/`);
  if (regressions.length) nextSteps.push(`Fix ${regressions.length} regression(s) flagged in RFCs`);
  if (!nextSteps.length) nextSteps.push("Cutover is structurally clean. Recommend visual/behavioral acceptance test before merge.");

  const verdict = {
    schema_version: "1.0.0",
    schema_kind: "parity-cab/cab-verdict",
    generated_at: new Date().toISOString(),
    decision,
    scope: "structural-parity + scaffold",
    parity_score: summary.parity_score,
    counts: summary.counts,
    by_risk: summary.by_risk,
    rfc_dispositions: rfcs.reduce((acc, r) => { acc[r.disposition || "missing"] = (acc[r.disposition || "missing"] || 0) + 1; return acc; }, {}),
    checks,
    runtime_checklist: runtimeChecklist,
    next_steps: nextSteps,
  };
  const outPath = path.join(cfg.out_dir, "cab-verdict.json");
  fs.writeFileSync(outPath, JSON.stringify(verdict, null, 2), "utf8");
  console.log(`[cab-gate] decision=${decision} (${verdict.scope}) parity=${summary.parity_score} → ${outPath}`);
  if (/^GO/.test(decision)) console.log(`  ⚠ STRUCTURAL parity only — this is NOT proof the app works. Review scaffold_wiring + runtime_checklist (${runtimeChecklist.length} item(s)) + run a behavioral test before declaring victory.`);
  for (const [name, c] of Object.entries(checks)) {
    console.log(`  ${name}: ${c.status}${c.count != null ? ` (${c.count})` : ""}${c.details ? ` — ${c.details}` : ""}`);
  }
  // Exit non-zero on NO-GO so CI can use this directly
  if (decision === "NO-GO") process.exit(1);
}

if (require.main === module) main();
