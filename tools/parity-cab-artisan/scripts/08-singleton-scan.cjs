#!/usr/bin/env node
// 08-singleton-scan.cjs — Detect singleton-lifetime contract violations.
//
// Born from the megazord ArcaneAudio.dispose() bug (2026-05-19): a singleton
// module disposed on per-mount viewport cleanup → audio plays once then dies
// on next React re-key. The bug passes AST equivalence, byte parity, signature
// diff, and parity-cab Stages 1-5. Only behavioral trace + remount-stress
// would catch it dynamically. This deterministic scanner catches it STATICALLY,
// before code ships — closing the loop for future modularizations.
//
// Pipeline integration:
//   - parity-cab can run standalone:  node 08-singleton-scan.cjs --config <cfg>
//   - modularize-monolith Phase 2.5 invokes this script and folds findings
//     into the RFC under each module's "Lifetime contract" section.
//
// What it detects:
//   1. Singleton-shape modules: exports an object with init() + (dispose|stop|
//      close|teardown), OR top-level `let X = null` / `let started = false`
//      pattern indicating module-scoped state.
//   2. Suspicious call sites: any call to <Singleton>.<dispose-like-method>
//      inside a lexical context narrower than the singleton's owner scope.
//
// What it WON'T catch (by design — those are LLM-adjudicated or dynamic):
//   - Conditional dispose that's actually correct (e.g., feature-flagged).
//   - Lifetimes that the static heuristic can't classify (very deep callback
//     chains).
//
// Output: .parity/singleton-lifetime-report.sij.json
//
// Exit: 0 if no HIGH violations, 1 if any HIGH violations present.

"use strict";

const fs = require("fs");
const path = require("path");
const { writeSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");

const SOURCE_EXT = /\.(ts|tsx|js|jsx)$/;
const SKIP_DIR   = /(^|\/)(node_modules|dist|build|\.git|coverage|\.parity|\.bridge|__tests__|test|tests)(\/|$)/;
const SKIP_FILE  = /\.(test|spec|d)\.(ts|tsx|js|jsx)$/;

const DISPOSE_VERBS = ["dispose", "close", "stop", "teardown", "destroy", "shutdown", "release"];
const DISPOSE_VERBS_RE = new RegExp("\\.(" + DISPOSE_VERBS.join("|") + ")\\s*\\(", "g");

// Heuristics for "suspicious lexical context" — call-site is inside one of these.
const SUSPICIOUS_CONTEXT_PATTERNS = [
  {
    name: "useEffect_cleanup",
    description: "Call inside a useEffect cleanup function (per-mount)",
    severity: "high",
    // Matches `return () => { ... <call> ... }` inside a useEffect-like callback.
    regex: /return\s+(?:function\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{[\s\S]{0,2000}?\.(?:DISPOSE_VERBS)\s*\(/,
  },
  {
    name: "raf_callback",
    description: "Call inside requestAnimationFrame callback (per-frame)",
    severity: "high",
    regex: /requestAnimationFrame\s*\(\s*(?:function\s*[\w$]*\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{[\s\S]{0,2000}?\.(?:DISPOSE_VERBS)\s*\(/,
  },
  {
    name: "viewport_or_component_dispose",
    description: "Call inside a per-mount component/viewport dispose function",
    severity: "high",
    // Matches `function dispose(` / `dispose() {` / `dispose: function` containing the call.
    regex: /(?:function\s+dispose|dispose\s*\(\)\s*\{|dispose\s*:\s*(?:function|\([^)]*\)\s*=>))\s*[\s\S]{0,1500}?\.(?:DISPOSE_VERBS)\s*\(/,
  },
];

// ─── Walk the modular tree ───────────────────────────────────────────────
function walk(dir, hits) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return hits; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const posix = full.replace(/\\/g, "/");
    if (e.isDirectory()) {
      if (SKIP_DIR.test(posix + "/")) continue;
      walk(full, hits);
    } else if (e.isFile()) {
      if (!SOURCE_EXT.test(e.name)) continue;
      if (SKIP_FILE.test(e.name)) continue;
      hits.push(full);
    }
  }
  return hits;
}

// ─── Pass 1: identify singleton modules ──────────────────────────────────
// Heuristic: a file is a "singleton" if it has:
//   (a) `export const <Name> = { ..., init(...) ... }` style — exports an
//       object literal containing an init method, OR
//   (b) Module-level mutable state: `let foo = null;` or `let started = false;`
//       in top-level scope, AND at least one exported method matching
//       /^(init|start|create)/.
// Brace-balanced body extractor: given `src` and offset of an opening `{`,
// return the index of its matching closing `}` (or -1 if unbalanced). Skips
// braces inside strings (single/double/template) and comments.
function matchBrace(src, openIdx) {
  let depth = 1;
  let i = openIdx + 1;
  while (i < src.length) {
    const c = src[i];
    // Skip line comments
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    // Skip block comments
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    // Skip strings (single/double/backtick)
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") { i += 2; continue; }
        // Template literal substitution
        if (q === "`" && src[i] === "$" && src[i + 1] === "{") {
          const end = matchBrace(src, i + 1);
          i = end + 1;
          continue;
        }
        i++;
      }
      i++; continue;
    }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

function identifySingletons(files) {
  const singletons = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");

    // Find object-literal exports with init() inside. Use brace-balancing
    // because lazy-regex picks the wrong `}` for multi-hundred-line objects.
    const exportStartRe = /export\s+const\s+(\w+)\s*=\s*\{/g;
    let m;
    while ((m = exportStartRe.exec(src)) !== null) {
      const name = m[1];
      const openIdx = m.index + m[0].length - 1; // index of the `{`
      const closeIdx = matchBrace(src, openIdx);
      if (closeIdx === -1) continue;
      const body = src.slice(openIdx + 1, closeIdx);
      const hasInit = /\binit\s*\(/.test(body) || /\bstart\s*\(/.test(body);
      const disposeMethods = DISPOSE_VERBS.filter((v) => new RegExp("\\b" + v + "\\s*\\(").test(body));
      if (hasInit && disposeMethods.length > 0) {
        singletons.push({
          name,
          file: rel,
          dispose_methods: disposeMethods,
          detection: "object-export-with-init-and-dispose",
        });
      }
    }

    // Find module-level mutable state with exported init. Accept optional type
    // annotation (`let ctx: AudioContext | null = null`).
    const moduleLetState = /^let\s+(\w+)(?:\s*:\s*[^=\n]+)?\s*=\s*(?:null|false|0|undefined)/gm;
    const stateVars = [];
    let s;
    while ((s = moduleLetState.exec(src)) !== null) stateVars.push(s[1]);
    if (stateVars.length > 0 && /^export\s+(?:async\s+)?function\s+(?:init|start|create)/m.test(src)) {
      const implicitName = path.basename(rel).replace(/\.(ts|tsx|js|jsx)$/, "");
      if (!singletons.find((sng) => sng.file === rel)) {
        singletons.push({
          name: implicitName,
          file: rel,
          dispose_methods: DISPOSE_VERBS.filter((v) => new RegExp("export\\s+(?:async\\s+)?function\\s+" + v).test(src)),
          state_vars: stateVars,
          detection: "module-level-state-with-exported-init",
        });
      }
    }
  }
  return singletons;
}

// Strip comments (preserves byte positions by replacing with spaces, so
// `lineOf` still works). Handles //, /* */, and string literals.
function stripComments(src) {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const c = src[i], next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    if (c === "/" && next === "*") {
      const start = i; i += 2;
      while (i < src.length - 1 && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      for (let j = start; j < Math.min(i, src.length); j++) if (src[j] !== "\n") out[j] = " ";
      continue;
    }
    // Skip string contents (so a `dispose(` inside a string template doesn't match)
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") { i += 2; continue; }
        i++;
      }
      i++; continue;
    }
    i++;
  }
  return out.join("");
}

// ─── Pass 2: scan call sites for dispose-like calls on singletons ────────
function scanCallSites(files, singletons) {
  const violations = [];
  const matched = [];

  for (const f of files) {
    const rawSrc = fs.readFileSync(f, "utf8");
    const src = stripComments(rawSrc); // ignore comments + string literals
    const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");

    // For each singleton, find calls like `<Name>.<dispose-verb>(`.
    for (const sng of singletons) {
      if (sng.file === rel) continue; // skip the singleton's own definition
      const re = new RegExp("\\b" + sng.name + "\\.(" + DISPOSE_VERBS.join("|") + ")\\s*\\(", "g");
      let m;
      while ((m = re.exec(src)) !== null) {
        const offset = m.index;
        const verb = m[1];

        // Determine lexical context. We look back N chars from the call to
        // see if it's enclosed in a suspicious wrapper.
        const window = src.slice(Math.max(0, offset - 1500), offset + 50);
        const context = classifyContext(window, verb);

        const entry = {
          singleton: sng.name,
          singleton_file: sng.file,
          call_site_file: rel,
          line: lineOf(src, offset),
          verb,
          context: context.name,
          severity: context.severity,
          rationale: context.description,
        };
        if (context.severity === "high" || context.severity === "med") {
          violations.push(entry);
        } else {
          matched.push(entry);
        }
      }
    }
  }
  return { violations, matched };
}

function classifyContext(window, verb) {
  // Test each suspicious pattern. The regex template uses `DISPOSE_VERBS` as
  // a literal placeholder we substitute at runtime so we don't have to
  // re-compile per call.
  for (const pat of SUSPICIOUS_CONTEXT_PATTERNS) {
    const filled = new RegExp(pat.regex.source.replace("DISPOSE_VERBS", verb), pat.regex.flags || "");
    if (filled.test(window)) {
      return { name: pat.name, severity: pat.severity, description: pat.description };
    }
  }
  // Default: top-level call (mount-once / module-init style) — OK.
  return { name: "top_level_or_app_scope", severity: "info", description: "Call appears at top-level/app-scope (no narrower wrapper detected)" };
}

function lineOf(src, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

// ─── Main ────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config || "parity.config.json");
  const modularRoot = cfg.modular.root;

  if (!fs.existsSync(modularRoot)) {
    console.error("ERROR: modular root not found at " + modularRoot);
    process.exit(2);
  }

  const startCwd = process.cwd();
  process.chdir(path.dirname(modularRoot));
  const files = walk(modularRoot, []);
  const singletons = identifySingletons(files);
  const { violations, matched } = scanCallSites(files, singletons);
  process.chdir(startCwd);

  const summary = {
    singletons_found: singletons.length,
    call_sites_total: violations.length + matched.length,
    high_violations: violations.filter((v) => v.severity === "high").length,
    med_violations: violations.filter((v) => v.severity === "med").length,
    info_acceptable: matched.length,
    decision: violations.some((v) => v.severity === "high") ? "fail" : "pass",
  };

  const outPath = path.join(cfg.out_dir, "singleton-lifetime-report.sij.json");
  writeSIJ(outPath, "singleton-lifetime-report", null,
    violations.concat(matched),
    { summary, singletons, scanned_files: files.length });

  console.log("[singleton-scan] " + summary.decision.toUpperCase() +
    " — " + summary.singletons_found + " singleton(s) found, " +
    summary.high_violations + " HIGH violation(s), " +
    summary.med_violations + " MED violation(s)");
  for (const sng of singletons) {
    console.log("  · " + sng.name + " @ " + sng.file + " (" + sng.detection + ")");
  }
  for (const v of violations) {
    console.log("  ⚠ " + v.severity.toUpperCase() + ": " + v.singleton + "." + v.verb + "() at " +
      v.call_site_file + ":" + v.line + " — " + v.rationale);
  }
  if (summary.high_violations > 0) process.exit(1);
}

if (require.main === module) main();
