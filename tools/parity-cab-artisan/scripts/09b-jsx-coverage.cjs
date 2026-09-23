#!/usr/bin/env node
// 09b-jsx-coverage.cjs — Dynamic-JSX label coverage diff (Stage 09b · MASTER-PLAN C5).
//
// Stage 09 (coverage-scan) is REGEX-based and misses dynamic JSX: labels produced
// by `.map()`, ternaries, and template literals. That's the known "85%/70%/55%
// AutoQuality HUD buttons silently dropped" class (R5) — present in the monolith,
// absent in the modular cutover, invisible to every regex gate.
//
// This stage uses ast-grep (`sg`, tree-sitter TSX) — finally ACTIVATING the long-
// declared-but-unused AST_REFACTOR cap. It extracts UI LABELS from BOTH sides:
//   - jsx_text                              (static visible text: ">85%<")
//   - string / template_string INSIDE a     (dynamic element-child labels:
//     jsx_expression but NOT inside a         {cond ? "ON" : "OFF"}, {`${q}%`})
//     jsx_attribute (excludes style noise)
// then diffs the label SETS. Mono-only labels = orphans (candidate dropped UI).
//
// Portable: degrades to SKIP (exit 0) if `sg` isn't installed or :4201 is down.
// Output: `<out_dir>/jsx-coverage.sij.json` (+ artifact-system mirror) + report.
// Usage:  node 09b-jsx-coverage.cjs --config parity.config.json [--strict]
//         node 09b-jsx-coverage.cjs --selftest
// Exit:   0 = pass/warn (soft), 1 = orphans present (only when --strict).

"use strict";

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { writeSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");

// ast-grep rule: visible JSX text + element-child string/template labels, excluding
// attribute (style/className/etc.) strings — the noise filter that makes the diff
// about UI LABELS, not CSS values.
// Rule body shared by both language passes. `tsx` covers .tsx/.ts; `js` covers
// .js/.jsx (tree-sitter-javascript parses JSX too). Running BOTH makes C5 portable
// to ANY JS/TS project, not only .tsx ones (the demo sandbox is .jsx). sg applies
// each rule only to files of its declared language, so there's no double-count.
const RULE_BODY = `rule:
  any:
    - kind: jsx_text
    - all:
        - any: [{kind: string},{kind: template_string}]
        - inside: {kind: jsx_expression, stopBy: end}
        - not: {inside: {kind: jsx_attribute, stopBy: end}}`;
const SG_LANGS = ["tsx", "js"];
// NOTE (C5 scope): this extracts JSX-DIRECT labels (visible text + element-child
// ternary/template strings). Labels defined in DATA arrays (`{label:"X"}` mapped
// into JSX) are intentionally OUT of scope — including object-property strings via
// a `label`-key branch was tried and REGRESSED precision (it pulled audio/entity
// data strings that the modular organizes differently, inflating false orphans
// 12→27). Per Law 5 (don't over-fit) the scanner SURFACES JSX-direct candidates;
// the disposition step ground-truths whether each is a real drop vs a mono-inline→
// mod-data-array/different-file refactor (e.g. the Engine Settings panel EXISTS in
// modular settings-panel.tsx — those orphans are refactor-form, not drops).

// ── sg runner (execSync via shell — resolves the npm `sg.cmd` shim that
// execFileSync can't run on Windows; native paths only). Returns matches or a
// skip reason (ast-grep absent = portable SKIP, not a hard failure).
function sgScan(target, ruleFile) {
  let out;
  try {
    out = execSync(`sg scan --rule "${ruleFile}" "${target}" --json=compact`,
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    if (e && typeof e.stdout === "string" && e.stdout.trim().startsWith("[")) out = e.stdout;
    else return { ok: false, reason: "ast-grep (sg) not runnable: " + String((e && e.message) || e).split("\n")[0] };
  }
  try { return { ok: true, matches: JSON.parse(out || "[]") }; }
  catch (_) { return { ok: false, reason: "could not parse sg JSON output" }; }
}

// ── Label normalization + noise filter ──────────────────────────────────────
const CSS_WORDS = new Set(["inherit","none","auto","pointer","monospace","serif","sans-serif",
  "transparent","hidden","visible","nowrap","wrap","center","flex","grid","block","inline",
  "inline-block","column","row","absolute","relative","fixed","static","sticky","uppercase",
  "lowercase","capitalize","bold","normal","italic","solid","dashed","dotted","ellipsis","cover",
  "contain","top","bottom","left","right","middle","baseline","start","end","stretch",
  "space-between","space-around","space-evenly","flex-start","flex-end","not-allowed","default",
  "border-box","content-box","scroll","col-resize","row-resize","ew-resize","ns-resize","grab"]);
function normLabel(raw) {
  let t = String(raw == null ? "" : raw);
  t = t.replace(/^[`'"]+|[`'"]+$/g, "");   // strip surrounding quotes/backticks
  t = t.replace(/\s+/g, " ").trim();
  return t;
}
function isLabel(t) {
  if (!t || t.length < 1 || t.length > 80) return false;
  if (!/[A-Za-z0-9]/.test(t)) return false;                       // must have alphanumeric
  if (/^#[0-9a-fA-F]{3,8}$/.test(t)) return false;                // hex color
  if (/^-?\d+(\.\d+)?(px|em|rem|vh|vw|s|ms|deg|fr|pt)$/.test(t)) return false; // pure dimension (keeps "85%")
  if (CSS_WORDS.has(t.toLowerCase())) return false;
  if (/^[\d.]+(px|em|rem)?( +[\d.]+(px|em|rem)?)+$/.test(t)) return false; // multi-dim shorthand "0 0 14px"
  if (/^(rgba?|hsla?)\(/i.test(t)) return false;                  // color function fragments
  return true;
}

// Extract the label multiset from a target path (single file or directory).
// A single-file monolith with an unrecognized extension (.bak) is copied to a
// temp .tsx so sg will parse it.
function extractLabels(target) {
  const tmp = [];
  let scanTarget = target;
  try {
    const st = fs.statSync(target);
    if (st.isFile() && !/\.(tsx|jsx|ts|js|mjs|cjs)$/.test(target)) {
      const tf = path.join(os.tmpdir(), "parity-jsx-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".tsx");
      fs.writeFileSync(tf, fs.readFileSync(target, "utf8"), "utf8");
      tmp.push(tf); scanTarget = tf;
    }
  } catch (e) { return { ok: false, reason: "target not found: " + target }; }

  const counts = new Map();
  for (const lang of SG_LANGS) {
    const ruleFile = path.join(os.tmpdir(), "parity-jsxrule-" + lang + "-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".yml");
    fs.writeFileSync(ruleFile, "id: jsxlabels\nlanguage: " + lang + "\n" + RULE_BODY, "utf8");
    const res = sgScan(scanTarget, ruleFile);
    try { fs.unlinkSync(ruleFile); } catch (_) {}
    if (!res.ok) {
      if (/not runnable/.test(res.reason || "")) { for (const f of tmp) { try { fs.unlinkSync(f); } catch (_) {} } return res; } // sg absent → SKIP
      continue; // language-specific parse error → skip that pass, keep going
    }
    for (const m of res.matches) {
      const t = normLabel(m && m.text);
      if (isLabel(t)) counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  for (const f of tmp) { try { fs.unlinkSync(f); } catch (_) {} }
  return { ok: true, counts };
}

// ── Core diff (pure — exercised by --selftest) ──────────────────────────────
function diffLabels(monoCounts, modCounts) {
  const findings = [];
  for (const [label, n] of monoCounts) {
    if (!modCounts.has(label)) {
      findings.push({ severity: "med", kind: "jsx_label_dropped", label, mono_count: n,
        detail: "JSX label present in monolith, ABSENT in modular (candidate silently-dropped UI — the 85%/70%/55% class)" });
    }
  }
  const added = [];
  for (const [label, n] of modCounts) {
    if (!monoCounts.has(label)) added.push({ severity: "info", kind: "jsx_label_added", label, mod_count: n,
      detail: "JSX label in modular with no monolith counterpart (new/renamed — informational)" });
  }
  findings.sort((a, b) => a.label.localeCompare(b.label));
  const orphans = findings.length;
  const all = findings.concat(added);
  const decision = orphans > 0 ? "warn" : "pass";
  const summary = {
    decision,
    monolith_labels: monoCounts.size,
    modular_labels: modCounts.size,
    dropped_orphans: orphans,
    added: added.length,
    med: orphans, info: added.length,
  };
  return { findings: all, summary };
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
        fs.writeFileSync(path.join(destDir, "jsx-coverage.sij.json"), fs.readFileSync(outPath, "utf8"), "utf8");
        console.log(`[jsx-coverage] synced → ${path.join(destDir, "jsx-coverage.sij.json")}`);
        break;
      }
      asRoot = path.dirname(asRoot);
    }
  } catch (err) { console.log(`[jsx-coverage] warn: sync failed: ${err.message}`); }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) return selftest();
  const cfg = loadConfig(args.config || "parity.config.json");
  const strict = !!args.strict;

  const mono = extractLabels(cfg.monolith.root);
  if (!mono.ok) { console.log("[jsx-coverage] SKIP — " + mono.reason + (/ast-grep/.test(mono.reason) ? "  (install: `npm i -g @ast-grep/cli`)" : "")); process.exit(0); }
  const mod = extractLabels(cfg.modular.root);
  if (!mod.ok) { console.log("[jsx-coverage] SKIP — " + mod.reason); process.exit(0); }

  const { findings, summary } = diffLabels(mono.counts, mod.counts);

  if (!fs.existsSync(cfg.out_dir)) fs.mkdirSync(cfg.out_dir, { recursive: true });
  const outPath = path.join(cfg.out_dir, "jsx-coverage.sij.json");
  writeSIJ(outPath, "jsx-coverage", null, findings, { summary });
  console.log(`[jsx-coverage] output: ${outPath}`);
  mirrorToArtifactSystem(cfg, outPath);

  console.log(`[jsx-coverage] decision=${summary.decision} · mono_labels=${summary.monolith_labels} mod_labels=${summary.modular_labels} · DROPPED orphans=${summary.dropped_orphans} added=${summary.added}`);
  for (const f of findings.filter((x) => x.kind === "jsx_label_dropped").slice(0, 25)) {
    console.log(`  [${f.severity}] dropped JSX label: "${f.label}"${f.mono_count > 1 ? " (×" + f.mono_count + ")" : ""}`);
  }
  const dropped = findings.filter((x) => x.kind === "jsx_label_dropped").length;
  if (dropped > 25) console.log(`  … +${dropped - 25} more dropped labels`);
  if (summary.decision === "pass") console.log("[jsx-coverage] ✓ every monolith JSX label has a modular counterpart.");

  process.exit(strict && summary.dropped_orphans > 0 ? 1 : 0);
}

// ── Self-test: synthetic label sets prove the diff logic (no sg/browser) ─────
function selftest() {
  let pass = true;
  const fail = (m) => { pass = false; console.log("  ✗ " + m); };
  const ok = (m) => console.log("  ✓ " + m);

  // normalization + filter
  normLabel('"ON"') === "ON" ? ok('normLabel strips quotes ("ON"→ON)') : fail("normLabel quote-strip");
  isLabel("85%") ? ok("isLabel keeps '85%' (the target class)") : fail("isLabel dropped '85%'");
  !isLabel("monospace") ? ok("isLabel drops CSS word 'monospace'") : fail("isLabel kept CSS noise");
  !isLabel("#1a0a04") ? ok("isLabel drops hex color") : fail("isLabel kept hex");
  !isLabel("10px") ? ok("isLabel drops pure dimension '10px'") : fail("isLabel kept dimension");

  // diff: mono has 85%/70%/55% AutoQuality presets; mod dropped them
  const monoC = new Map([["85%", 1], ["70%", 1], ["55%", 1], ["NPC", 1], ["VALID", 1]]);
  const modC = new Map([["NPC", 1], ["VALID", 1], ["BRAND NEW", 1]]);
  const { findings, summary } = diffLabels(monoC, modC);
  const dropped = findings.filter((f) => f.kind === "jsx_label_dropped").map((f) => f.label);
  (dropped.includes("85%") && dropped.includes("70%") && dropped.includes("55%")) ? ok("detects dropped 85%/70%/55% AutoQuality labels (the R5 class)") : fail("did not detect dropped preset labels: " + JSON.stringify(dropped));
  summary.dropped_orphans === 3 ? ok("exactly 3 dropped orphans") : fail("expected 3 orphans, got " + summary.dropped_orphans);
  findings.some((f) => f.kind === "jsx_label_added" && f.label === "BRAND NEW") ? ok("flags mod-only label as added/info") : fail("missed added label");
  summary.decision === "warn" ? ok("decision=warn (orphans present, soft by default)") : fail("expected warn, got " + summary.decision);

  console.log(pass ? "\n[jsx-coverage] SELFTEST PASS" : "\n[jsx-coverage] SELFTEST FAIL");
  process.exit(pass ? 0 : 1);
}

main();
