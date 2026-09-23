#!/usr/bin/env node
// 09-coverage-scan.cjs — Deterministic coverage inventory.
//
// Born from the Megazord audit (2026-05-19) where parity-cab and modularize-
// monolith both passed a structurally-incomplete cutover (4 subsystems
// missing: GPU profiler, autoQuality, ZTP/MAT header indicators, boot log
// messages). Root cause: Phase 1 inventory only catalogs TOP-LEVEL EXPORTED
// SYMBOLS. Closure-scoped code, JSX text literals, useState initial values,
// bus.emit message text, and innerHTML assignments are INVISIBLE.
//
// This scanner catalogs ALL meaningful constructs in the source monolith
// (not just exports) and checks each for presence in the modular tree.
//
// Categories detected (regex-based, deterministic):
//   1. closure-fn / closure-const  — function/const declarations NOT preceded
//                                    by `export` (i.e., scope-local in monolith)
//   2. bus-emit-message            — `bus.emit("type", { ..., msg: "..." })`
//                                    string literals (boot logs etc.)
//   3. useState-log-string         — string literals in useState array initial
//                                    values (e.g., the boot log array)
//   4. inner-html-assign           — `someRef.innerHTML = ` assignments (DOM
//                                    bypass, often missed)
//   5. jsx-visible-text            — `>Text<` patterns with letters (header
//                                    indicators like "ZTP", "MAT:0")
//
// For each: search the modular tree for a match. Emit SIJ-compliant
// coverage-inventory.sij.json with severity classification.
//
// Severity rule of thumb:
//   - closure-fn ≥ 8 LOC    → HIGH (substantial subsystem)
//   - closure-const that's an object literal ≥ 6 LOC → HIGH
//   - bus-emit-message not found in modular → MED (cosmetic-ish)
//   - useState-log-string not found       → LOW (boot log)
//   - inner-html-assign not found         → HIGH (DOM behavior)
//   - jsx-visible-text not found AND text length ≥ 3 → LOW
//
// Usage: node 09-coverage-scan.cjs --config parity.config.json
"use strict";

const fs = require("fs");
const path = require("path");
const { writeSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");

const SOURCE_EXT = /\.(ts|tsx|js|jsx|cjs|mjs)$/;
const SKIP_DIR   = /(^|\/)(node_modules|dist|build|\.git|coverage|\.parity|\.bridge)(\/|$)/;
const SKIP_FILE  = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

function walkDir(dir, hits = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return hits; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const posix = full.replace(/\\/g, "/");
    if (e.isDirectory()) {
      if (SKIP_DIR.test(posix + "/")) continue;
      walkDir(full, hits);
    } else if (e.isFile() && SOURCE_EXT.test(e.name) && !SKIP_FILE.test(e.name)) {
      hits.push(full);
    }
  }
  return hits;
}

function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

// Find the matching `}` for a `{` at startIdx; returns -1 if unbalanced.
function balanced(s, startIdx, open, close) {
  if (s[startIdx] !== open) return -1;
  let depth = 0;
  for (let i = startIdx; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function stripComments(s) {
  // Strip block comments (greedy but anchored on /* ... */)
  s = s.replace(/\/\*[\s\S]*?\*\//g, m => " ".repeat(m.length));
  // Strip line comments (preserve newlines so line numbers stay valid)
  s = s.replace(/\/\/[^\n]*/g, m => " ".repeat(m.length));
  return s;
}

// ─── Detectors ──────────────────────────────────────────────────────────────

function detectClosureFunctions(source, cleanSrc) {
  // Match `function NAME(...)` NOT preceded by `export`.
  const hits = [];
  const re = /(^|\n)\s{2,}function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(cleanSrc)) !== null) {
    const name = m[2];
    const headStart = m.index + (m[1] ? 1 : 0);
    const braceIdx = cleanSrc.indexOf("{", m.index);
    if (braceIdx < 0) continue;
    const endIdx = balanced(cleanSrc, braceIdx, "{", "}");
    if (endIdx < 0) continue;
    const loc = (cleanSrc.slice(braceIdx, endIdx).match(/\n/g) || []).length;
    hits.push({
      kind: "closure-fn",
      name,
      line: lineOf(source, headStart),
      end_line: lineOf(source, endIdx),
      loc,
      sig: `function ${name}(${m[3]})`,
    });
  }
  return hits;
}

function detectClosureConsts(source, cleanSrc) {
  // const NAME = ... where it's NOT export and value spans multiple lines
  // (i.e., looks like a subsystem, not a trivial assignment).
  const hits = [];
  const re = /(^|\n)\s{2,}(?:const|let)\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(cleanSrc)) !== null) {
    const name = m[2];
    const headStart = m.index + (m[1] ? 1 : 0);
    const braceIdx = cleanSrc.indexOf("{", m.index);
    if (braceIdx < 0) continue;
    const endIdx = balanced(cleanSrc, braceIdx, "{", "}");
    if (endIdx < 0) continue;
    const loc = (cleanSrc.slice(braceIdx, endIdx).match(/\n/g) || []).length;
    if (loc < 6) continue; // skip trivial inline objects
    hits.push({
      kind: "closure-const",
      name,
      line: lineOf(source, headStart),
      end_line: lineOf(source, endIdx),
      loc,
    });
  }
  return hits;
}

function detectBusEmitMessages(source) {
  // bus.emit("log", { ..., msg: "..." })  AND bus.emit("X", { ..., msg: `...` })
  const hits = [];
  const re = /bus\.emit\(\s*["']([^"']+)["']\s*,\s*\{[^}]*?msg\s*:\s*[`"']([^`"']+)[`"']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    hits.push({
      kind: "bus-emit-message",
      event: m[1],
      text: m[2].slice(0, 200),
      line: lineOf(source, m.index),
    });
  }
  return hits;
}

function detectUseStateLogStrings(source) {
  // useState(() => [ { ts: ..., level: ..., msg: "..." }, ... ])
  // Look for occurrences of `msg: "..."` inside arrays passed to useState.
  // Simpler: scan all `msg: "TEXT"` literals with [BRACKETED] prefix that
  // look like boot/system log messages.
  const hits = [];
  const re = /msg\s*:\s*[`"']\s*(\[[A-Z0-9_-]+\][^`"']{3,200})[`"']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    hits.push({
      kind: "useState-log-string",
      text: m[1].slice(0, 200),
      line: lineOf(source, m.index),
    });
  }
  return hits;
}

function detectInnerHTMLAssigns(source, cleanSrc) {
  // `<expr>.innerHTML = ` — direct DOM writes bypass React.
  const hits = [];
  const re = /([A-Za-z_$][\w$.?]*)\.innerHTML\s*=/g;
  let m;
  while ((m = re.exec(cleanSrc)) !== null) {
    hits.push({
      kind: "inner-html-assign",
      target: m[1],
      line: lineOf(source, m.index),
    });
  }
  return hits;
}

function detectJSXVisibleText(source) {
  // Look for `>Visible Text<` patterns with letters; filter out trivial
  // single-char or whitespace-only matches.
  // Conservative: only flag short labels likely to be UI indicators.
  const hits = [];
  const re = />\s*([A-Z][A-Z0-9 .:_-]{1,30}[A-Z0-9])\s*</g;
  let m;
  while ((m = re.exec(source)) !== null) {
    hits.push({
      kind: "jsx-visible-text",
      text: m[1],
      line: lineOf(source, m.index),
    });
  }
  return hits;
}

// ─── Modular-side search ────────────────────────────────────────────────────

function buildModularIndex(modularRoot) {
  const files = walkDir(modularRoot);
  const idx = files.map((f) => ({
    file: f,
    rel: path.relative(modularRoot, f).replace(/\\/g, "/"),
    content: fs.readFileSync(f, "utf8"),
  }));
  // Combined haystack for fast substring searches
  const haystack = idx.map((e) => e.content).join("\n\n");
  return { files: idx, haystack };
}

function findInModular(idx, needle, opts = {}) {
  // Returns first matching file or null
  if (!needle || needle.length < 2) return null;
  const cmp = opts.caseInsensitive ? needle.toLowerCase() : needle;
  for (const e of idx.files) {
    const hay = opts.caseInsensitive ? e.content.toLowerCase() : e.content;
    if (hay.indexOf(cmp) >= 0) return e.rel;
  }
  return null;
}

// ─── Severity classification ────────────────────────────────────────────────

function classifySeverity(item) {
  if (item.kind === "closure-fn") {
    if (item.loc >= 80) return "critical";
    if (item.loc >= 20) return "high";
    if (item.loc >= 8) return "med";
    return "low";
  }
  if (item.kind === "closure-const") {
    if (item.loc >= 40) return "high";
    if (item.loc >= 10) return "med";
    return "low";
  }
  if (item.kind === "bus-emit-message") return "med";
  if (item.kind === "useState-log-string") return "low";
  if (item.kind === "inner-html-assign") return "high";
  if (item.kind === "jsx-visible-text") return "low";
  return "med";
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config || "parity.config.json");
  const monolithPath = cfg.monolith.root;
  const modularRoot = cfg.modular.root;

  if (!fs.existsSync(monolithPath)) {
    console.error(`ERROR: monolith not found at ${monolithPath}`);
    process.exit(2);
  }
  if (!fs.existsSync(modularRoot)) {
    console.error(`ERROR: modular root not found at ${modularRoot}`);
    process.exit(2);
  }

  const source = fs.readFileSync(monolithPath, "utf8");
  const cleanSrc = stripComments(source);

  // Detect all categories
  const detected = []
    .concat(detectClosureFunctions(source, cleanSrc))
    .concat(detectClosureConsts(source, cleanSrc))
    .concat(detectBusEmitMessages(source))
    .concat(detectUseStateLogStrings(source))
    .concat(detectInnerHTMLAssigns(source, cleanSrc))
    .concat(detectJSXVisibleText(source));

  // Build modular index for cross-referencing
  const idx = buildModularIndex(modularRoot);

  // For each detected item, search modular tree for a match
  const entities = detected.map((item, ord) => {
    let needle;
    let matchOpts = {};
    if (item.kind === "closure-fn" || item.kind === "closure-const") {
      needle = item.name; // exact symbol-name match
    } else if (item.kind === "bus-emit-message" || item.kind === "useState-log-string") {
      // Match by core text fragment (skip the leading bracket prefix)
      needle = item.text.replace(/^\[[^\]]+\]\s*/, "").slice(0, 40);
    } else if (item.kind === "inner-html-assign") {
      needle = item.target + ".innerHTML";
    } else if (item.kind === "jsx-visible-text") {
      needle = item.text;
    }
    const modMatch = needle ? findInModular(idx, needle) : null;
    const severity = classifySeverity(item);
    return {
      entity_id: `${item.kind}::${item.name || item.text || item.target}::${item.line}`,
      ord,
      ...item,
      needle,
      modular_match: modMatch,
      status: modMatch ? "present" : "orphan",
      severity,
    };
  });

  // Stats
  const orphans = entities.filter((e) => e.status === "orphan");
  const byCat = entities.reduce((acc, e) => {
    acc[e.kind] = acc[e.kind] || { total: 0, orphan: 0 };
    acc[e.kind].total++;
    if (e.status === "orphan") acc[e.kind].orphan++;
    return acc;
  }, {});
  const bySev = orphans.reduce((acc, e) => { acc[e.severity] = (acc[e.severity] || 0) + 1; return acc; }, {});

  const summary = {
    total_items: entities.length,
    orphan_items: orphans.length,
    matched_items: entities.length - orphans.length,
    by_category: byCat,
    orphans_by_severity: bySev,
    monolith_source: path.basename(monolithPath),
    modular_root: modularRoot.replace(/\\/g, "/"),
  };

  const out = path.join(cfg.out_dir, "coverage-inventory.sij.json");
  writeSIJ(out, "coverage-inventory", null, entities, { summary });

  console.log(`[coverage-scan] ${entities.length} items detected; ${orphans.length} orphans → ${out}`);
  console.log(`  by category:`, JSON.stringify(byCat));
  console.log(`  orphans by severity:`, JSON.stringify(bySev));
  if (orphans.length > 0) {
    console.log(`  top orphans (HIGH+):`);
    orphans
      .filter((o) => o.severity === "critical" || o.severity === "high")
      .slice(0, 15)
      .forEach((o) => {
        const label = o.name || o.text || o.target;
        console.log(`    ${o.severity.toUpperCase()} · ${o.kind} · ${label} (L${o.line}${o.loc ? `, ${o.loc} LOC` : ""})`);
      });
  }

  // CI-friendly exit
  const blocking = orphans.filter((o) => o.severity === "high" || o.severity === "critical").length;
  if (blocking > 0) process.exit(1);
}

if (require.main === module) main();
