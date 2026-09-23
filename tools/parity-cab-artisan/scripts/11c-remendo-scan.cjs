#!/usr/bin/env node
// 11c-remendo-scan.cjs — Zero-trust "remendo" detector (Stage 11.6 · MASTER-PLAN Pilar 0.2).
//
// Mechanizes the manual "are there improvised additions in the modular?" audit.
// A modularization must contain ONLY logic that traces to the monolith plus
// benign structural scaffolding. Any NET-NEW side-effect / behavioral token
// (present in the modular but absent — or fewer — in the monolith) is a
// "remendo" candidate the human must disposition. "Modularize ≠ improve."
//
// METHOD (deterministic, ~seconds): count a curated catalog of side-effect
// tokens in the monolith (ground truth) vs the whole modular tree. Any token
// whose modular count exceeds the monolith count is flagged, with every modular
// `file:line` occurrence listed. When the monolith count is 0, EVERY modular
// occurrence is a certain net-new behavior.
//
// This is the deterministic twin of the manual zero-trust additions audit
// (an LLM agent spent ~130k tokens doing it by hand once — never again). It is
// a NECESSARY-not-sufficient gate: it catches the side-effect token class with
// near-zero false negatives, but does NOT catch altered output strings or logic
// remendos that reuse only monolith-present tokens — those need block-diff (11b)
// + the Provenance Ledger (Pilar 0.4).
//
// Output: `<out_dir>/remendo-scan.sij.json` (+ mirror to artifact-system) + report.
// Usage:  node 11c-remendo-scan.cjs --config parity.config.json
//
// Exit 0 always (soft/observational). Promotion to exit-1 HARD gate = Pilar 0.5.

"use strict";

const fs = require("fs");
const path = require("path");
const { writeSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");
const { preprocessSource } = require("./lib/parse.cjs");

// ─── Token catalog ───────────────────────────────────────────────────────────
// `behavioral: true` tokens are runtime side-effects → a net-new one fails the
// scan. Debug tokens (console/debugger) are warnings (leftover instrumentation).
const TOKENS = [
  { name: "console.*",      re: /\bconsole\s*\.\s*(log|warn|error|info|debug|trace|table|group|groupEnd|dir|assert|count|time|timeEnd)\b/g, klass: "debug",     severity: "low",  behavioral: false },
  { name: "debugger",       re: /\bdebugger\b/g,                                  klass: "debug",     severity: "med",  behavioral: false },
  { name: "setTimeout",     re: /\bsetTimeout\s*\(/g,                             klass: "timer",     severity: "high", behavioral: true  },
  { name: "setInterval",    re: /\bsetInterval\s*\(/g,                            klass: "timer",     severity: "high", behavioral: true  },
  { name: "localStorage",   re: /\blocalStorage\b/g,                              klass: "storage",   severity: "high", behavioral: true  },
  { name: "sessionStorage", re: /\bsessionStorage\b/g,                            klass: "storage",   severity: "high", behavioral: true  },
  { name: ".resume(",       re: /\.\s*resume\s*\(/g,                              klass: "lifecycle", severity: "high", behavioral: true  },
  { name: "new Audio",      re: /\bnew\s+Audio\s*\(/g,                            klass: "media",     severity: "high", behavioral: true  },
  { name: "alert/confirm",  re: /\b(?:alert|confirm|prompt)\s*\(/g,               klass: "dialog",    severity: "med",  behavioral: true  },
  { name: "fetch(",         re: /\bfetch\s*\(/g,                                  klass: "network",   severity: "info", behavioral: false }, // exists in monolith → count-compare only
];

function isPureCommentLine(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

// Count + locate each token across a file's lines. Pure-comment lines skipped.
function scanText(text, relFile, sink) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isPureCommentLine(line)) continue;
    for (const tok of TOKENS) {
      tok.re.lastIndex = 0;
      let count = 0;
      while (tok.re.exec(line) !== null) count++;
      if (count > 0) {
        if (!sink[tok.name]) sink[tok.name] = [];
        sink[tok.name].push({ file: relFile, line: i + 1, count, snippet: line.trim().slice(0, 120) });
      }
    }
  }
}

function walkFiles(root, exts, skipDirs) {
  const out = [];
  (function rec(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (ent.isDirectory()) {
        if (!skipDirs.includes(ent.name)) rec(path.join(dir, ent.name));
      } else if (exts.some((e) => ent.name.endsWith(e)) && !/\.test\.(ts|tsx|js|jsx)$/.test(ent.name)) {
        out.push(path.join(dir, ent.name));
      }
    }
  })(root);
  return out;
}

function tally(sink, name) {
  return (sink[name] || []).reduce((s, o) => s + o.count, 0);
}

function main() {
  const args = parseArgs(process.argv);
  const cfg = loadConfig(args.config || "parity.config.json");

  // ── Monolith baseline (single-file or directory) ──
  const monoSink = {};
  const monoRoot = cfg.monolith.root;
  const monoIsDir = fs.statSync(monoRoot).isDirectory();
  const monoFiles = monoIsDir
    ? walkFiles(monoRoot, [".js", ".jsx", ".ts", ".tsx"], ["node_modules", ".parity", "dist"])
    : [monoRoot];
  for (const f of monoFiles) {
    // H1/H2: for a single-file monolith, extract inline JS from HTML and dedent
    // so we count JS side-effect tokens, not HTML/CSS markup. NO-OP for plain JS.
    const raw = fs.readFileSync(f, "utf8");
    const text = monoIsDir ? raw : preprocessSource(raw, f, cfg.monolith.kind || "single-file");
    scanText(text, path.relative(process.cwd(), f), monoSink);
  }

  // ── Modular tree ──
  const modSink = {};
  const modRoot = cfg.modular.root;
  const modFiles = walkFiles(modRoot, [".ts", ".tsx", ".js", ".jsx"], ["node_modules", ".parity", "dist", "reference"]);
  for (const f of modFiles) scanText(fs.readFileSync(f, "utf8"), path.relative(process.cwd(), f), modSink);

  // ── Per-token diff ──
  const findings = [];
  for (const tok of TOKENS) {
    const monoCount = tally(monoSink, tok.name);
    const modCount = tally(modSink, tok.name);
    if (modCount <= monoCount) continue;
    const certain = monoCount === 0;
    findings.push({
      token: tok.name,
      class: tok.klass,
      behavioral: tok.behavioral,
      severity: certain ? tok.severity : (tok.severity === "info" ? "info" : "review"),
      monolith_count: monoCount,
      modular_count: modCount,
      net_new: modCount - monoCount,
      confidence: certain ? "certain_net_new" : "count_delta_only",
      disposition: "PENDING",
      occurrences: (modSink[tok.name] || []).map((o) => ({ file: o.file, line: o.line, snippet: o.snippet })),
    });
  }

  // ── Decision ──
  const behavioralRemendos = findings.filter((f) => f.behavioral && f.monolith_count === 0);
  const decision = behavioralRemendos.length > 0 ? "fail" : findings.length > 0 ? "warn" : "pass";
  const sevCount = (s) => findings.filter((f) => f.severity === s).length;
  const summary = {
    decision,
    tokens_flagged: findings.length,
    behavioral_remendos: behavioralRemendos.length,
    behavioral_net_new_lines: behavioralRemendos.reduce((s, f) => s + f.net_new, 0),
    debug_net_new_lines: findings.filter((f) => f.class === "debug").reduce((s, f) => s + f.net_new, 0),
    by_severity: { high: sevCount("high"), med: sevCount("med"), low: sevCount("low"), review: sevCount("review"), info: sevCount("info") },
    monolith_files_scanned: monoFiles.length,
    modular_files_scanned: modFiles.length,
  };

  // ── Write + mirror ──
  if (!fs.existsSync(cfg.out_dir)) fs.mkdirSync(cfg.out_dir, { recursive: true });
  const outPath = path.join(cfg.out_dir, "remendo-scan.sij.json");
  writeSIJ(outPath, "remendo-scan", null, findings, { summary });
  console.log(`[remendo-scan] output: ${outPath}`);

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
          const destFile = path.join(destDir, "remendo-scan.sij.json");
          fs.writeFileSync(destFile, fs.readFileSync(outPath, "utf8"), "utf8");
          console.log(`[remendo-scan] synced → ${destFile}`);
          break;
        }
        asRoot = path.dirname(asRoot);
      }
    } catch (err) {
      console.log(`[remendo-scan] warn: failed to sync to .parity-traces: ${err.message}`);
    }
  }

  // ── Console report ──
  console.log(`[remendo-scan] decision=${decision} flagged=${findings.length} behavioral_remendos=${behavioralRemendos.length} debug_net_new=${summary.debug_net_new_lines}`);
  for (const f of findings) {
    console.log(`  [${f.severity}] ${f.token} (${f.class}${f.behavioral ? ", behavioral" : ""}): mono=${f.monolith_count} mod=${f.modular_count} net_new=${f.net_new} · ${f.confidence}`);
    for (const o of f.occurrences.slice(0, 10)) console.log(`        ${o.file}:${o.line}  ${o.snippet}`);
    if (f.occurrences.length > 10) console.log(`        … +${f.occurrences.length - 10} more occurrences`);
  }
  if (decision === "pass") console.log("[remendo-scan] ✓ no net-new side-effect tokens — clean on this heuristic.");

  process.exit(0); // soft stage; HARD-gate promotion = MASTER-PLAN Pilar 0.5
}

main();
