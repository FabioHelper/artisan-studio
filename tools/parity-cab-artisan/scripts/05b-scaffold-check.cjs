#!/usr/bin/env node
// 05b-scaffold-check.cjs — Wiring / boot bridge (Stage 05.5 · HARDENING-PLAN H4).
//
// THE PARITY-PARADOX FIX. Structural parity (01–05) proves the SYMBOLS survived
// the split; it is BLIND to whether the modular app actually wires up and boots.
// The first real N=2 dogfood reported `GO · parity=1.0` while the app was dead —
// the modular entry HTML pointed at a module `src` that 404'd, so nothing ran.
//
// This gate is the deterministic bridge from "symbols match" to "it wires up":
//   1. Module-path resolution — every <script type="module" src> / <link href>
//      in the modular entry HTML resolves (relative to the HTML) to a real file.
//   2. Import-chain resolution — every relative `import ... from "./X"` across the
//      modular tree resolves to a real file (try .js/.ts/.tsx/.jsx, /index.*).
//   3. HTML structure sanity — matched </body>/</html>, no literal un-interpreted
//      escapes (e.g. a backtick-n that should have been a newline), and every
//      getElementById("X") / querySelector("#X") id referenced in modular JS
//      exists in the modular HTML.
//
// Output: `<out_dir>/scaffold-check.sij.json` (decision pass/warn/fail).
// Soft by default (exit 0); `--strict` exits 1 on a FAIL decision.
// Graceful SKIP (exit 0) when no modular HTML entry is configured/found
// (non-web projects) — emits decision="skip".
//
// Usage:
//   node 05b-scaffold-check.cjs --config parity.config.json
//   node 05b-scaffold-check.cjs --config parity.config.json --strict

"use strict";

const fs = require("fs");
const path = require("path");
const { writeSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");

const SOURCE_EXT = /\.(ts|tsx|js|jsx|cjs|mjs)$/;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.git|coverage|\.parity|\.bridge|reference)(\/|$)/;
const SKIP_FILE = /\.(test|spec|d)\.(ts|tsx|js|jsx)$/;
// Resolution candidates for an extension-less relative specifier.
const RESOLVE_EXTS = ["", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"];
const INDEX_FILES = ["index.js", "index.mjs", "index.cjs", "index.ts", "index.tsx", "index.jsx"];

// ── File discovery (mirrors 01-inventory / 11-ast-xray) ──────────────────────
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

function findHtmlFiles(dir, hits = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return hits; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const posix = full.replace(/\\/g, "/");
    if (e.isDirectory()) {
      if (SKIP_DIR.test(posix + "/")) continue;
      findHtmlFiles(full, hits);
    } else if (e.isFile() && /\.html?$/i.test(e.name)) {
      hits.push(full);
    }
  }
  return hits;
}

// ── Modular entry-HTML resolution ────────────────────────────────────────────
// Priority: cfg.modular.entry_html → cfg.modular.root/index.html →
// shallowest index.html in the modular tree → shallowest .html in the tree.
function resolveEntryHtml(cfg) {
  const modRoot = cfg.modular.root;
  if (cfg.modular.entry_html) {
    const base = path.dirname(path.resolve(cfg.__config_path || "."));
    const p = path.isAbsolute(cfg.modular.entry_html)
      ? cfg.modular.entry_html
      : path.resolve(base, cfg.modular.entry_html);
    if (fs.existsSync(p)) return p;
    // entry_html was specified but missing → still report it (HIGH miss later)
    return p;
  }
  const direct = path.join(modRoot, "index.html");
  if (fs.existsSync(direct)) return direct;
  const all = findHtmlFiles(modRoot);
  if (all.length === 0) return null;
  // Prefer an index.html, then the shallowest path.
  all.sort((a, b) => {
    const ai = /index\.html?$/i.test(a) ? 0 : 1;
    const bi = /index\.html?$/i.test(b) ? 0 : 1;
    if (ai !== bi) return ai - bi;
    return a.split(/[\\/]/).length - b.split(/[\\/]/).length;
  });
  return all[0];
}

// ── HTML asset-reference extraction ──────────────────────────────────────────
// Pull every <script src> and <link href> (local only — skip http(s):// and
// protocol-relative //cdn and data: URIs). Returns [{ kind, spec }].
function extractHtmlAssets(html) {
  const assets = [];
  const scriptRe = /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  const linkRe = /<link\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    const spec = (m[1] || m[2] || m[3] || "").trim();
    if (spec) assets.push({ kind: "script", spec });
  }
  while ((m = linkRe.exec(html)) !== null) {
    const spec = (m[1] || m[2] || m[3] || "").trim();
    if (spec) assets.push({ kind: "link", spec });
  }
  return assets;
}

function isExternalSpec(spec) {
  return /^(https?:)?\/\//i.test(spec) || /^data:/i.test(spec) || /^[a-z]+:/i.test(spec);
}

// Resolve a relative specifier against a base directory, trying extension and
// /index.* variants. Returns the resolved absolute path, or null if none exist.
function resolveSpecifier(baseDir, spec) {
  // Strip query/hash (e.g. "./app.js?v=2", "./a#b").
  const clean = spec.replace(/[?#].*$/, "");
  const target = path.resolve(baseDir, clean);
  for (const ext of RESOLVE_EXTS) {
    const cand = target + ext;
    try { if (fs.statSync(cand).isFile()) return cand; } catch (_) {}
  }
  // Directory → index.*
  for (const idx of INDEX_FILES) {
    const cand = path.join(target, idx);
    try { if (fs.statSync(cand).isFile()) return cand; } catch (_) {}
  }
  return null;
}

// ── Modular import-chain extraction ──────────────────────────────────────────
// Static `import ... from "X"` + `export ... from "X"` + dynamic `import("X")`.
// We only verify RELATIVE specifiers (./ or ../); bare specifiers are package
// imports resolved by the bundler/CDN and out of scope for a wiring check.
function extractRelativeSpecifiers(source) {
  const specs = [];
  const fromRe = /(?:^|[^\w$.])(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
  const sideRe = /(?:^|[^\w$.])import\s*['"]([^'"]+)['"]/g; // bare side-effect import
  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  for (const re of [fromRe, sideRe, dynRe]) {
    while ((m = re.exec(source)) !== null) {
      const spec = m[1];
      if (/^\.\.?\//.test(spec)) specs.push(spec);
    }
  }
  return specs;
}

function lineOfIndex(source, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

// ── Check 3 helpers — DOM id references ──────────────────────────────────────
function extractDomIds(html) {
  const ids = new Set();
  const idRe = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m;
  while ((m = idRe.exec(html)) !== null) {
    const v = (m[1] || m[2] || m[3] || "").trim();
    if (v) ids.add(v);
  }
  return ids;
}

function extractReferencedIds(source) {
  // getElementById("X") and querySelector("#X") (id selector, simple form).
  const refs = [];
  const gebi = /\bgetElementById\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  const qs = /\bquerySelector(?:All)?\s*\(\s*['"`]#([A-Za-z_][\w-]*)['"`]\s*\)/g;
  let m;
  while ((m = gebi.exec(source)) !== null) refs.push({ id: m[1], idx: m.index, via: "getElementById" });
  while ((m = qs.exec(source)) !== null) refs.push({ id: m[1], idx: m.index, via: "querySelector" });
  return refs;
}

// Literal un-interpreted escape: a backslash-n / backslash-t that appears as
// TWO literal characters inside an HTML text node (a classic template-string
// botch where `\n` was emitted literally instead of a newline). We scan for the
// backtick-escape pattern the report flagged. Conservative: only flag the
// distinctive `` `n `` / `` `t `` (backtick immediately followed by n/t) and the
// raw two-char "\n"/"\t" sequences sitting in HTML *text* (not inside a tag).
function findLiteralEscapes(html) {
  const hits = [];
  // The exact artifact the report named: a backtick followed by n/t (e.g. `n).
  const backtickEsc = /`[nt]\b/g;
  let m;
  while ((m = backtickEsc.exec(html)) !== null) {
    hits.push({ kind: "backtick_escape", at: lineOfIndex(html, m.index), snippet: html.slice(m.index, m.index + 12) });
  }
  return hits;
}

function checkHtmlBalance(html) {
  const issues = [];
  const hasBodyOpen = /<body\b/i.test(html);
  const hasBodyClose = /<\/body\s*>/i.test(html);
  const hasHtmlOpen = /<html\b/i.test(html);
  const hasHtmlClose = /<\/html\s*>/i.test(html);
  if (hasBodyOpen && !hasBodyClose) issues.push("missing </body>");
  if (hasHtmlOpen && !hasHtmlClose) issues.push("missing </html>");
  return issues;
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.config || "parity.config.json";
  const cfg = loadConfig(configPath);
  cfg.__config_path = configPath;
  const strict = !!args.strict;

  const findings = [];
  const add = (sev, kind, message, extra = {}) =>
    findings.push({ severity: sev, kind, message, ...extra });

  const modRoot = cfg.modular.root;
  const entryHtml = resolveEntryHtml(cfg);

  // Non-web project (no modular HTML entry) → graceful SKIP.
  if (!entryHtml) {
    const summary = {
      decision: "skip",
      reason: "no modular HTML entry configured or found (non-web project)",
      checks: { module_paths: "skip", import_chain: "n/a", html_sanity: "skip" },
      counts: { high: 0, med: 0, low: 0 },
    };
    const outPath = path.join(cfg.out_dir, "scaffold-check.sij.json");
    writeSIJ(outPath, "scaffold-check", null, [], { summary });
    console.log(`[scaffold-check] decision=skip — no modular HTML entry (non-web). → ${outPath}`);
    return; // exit 0
  }

  const entryRel = path.relative(modRoot, entryHtml).replace(/\\/g, "/");
  const entryExists = fs.existsSync(entryHtml);

  // ── Check 1: module-path resolution from the entry HTML ────────────────────
  let html = "";
  if (entryExists) {
    html = fs.readFileSync(entryHtml, "utf8");
  } else {
    add("high", "entry_html_missing",
      `configured modular entry HTML does not exist: ${entryHtml}`,
      { entry: entryRel });
  }

  const entryDir = path.dirname(entryHtml);
  let assetsChecked = 0;
  if (entryExists) {
    for (const a of extractHtmlAssets(html)) {
      if (isExternalSpec(a.spec)) continue; // CDN / external — out of scope
      assetsChecked++;
      const resolved = resolveSpecifier(entryDir, a.spec);
      if (!resolved) {
        add("high", "module_path_404",
          `<${a.kind} ${a.kind === "script" ? "src" : "href"}="${a.spec}"> in ${entryRel} does not resolve to a file (relative to the HTML)`,
          { entry: entryRel, spec: a.spec, asset_kind: a.kind });
      }
    }
  }

  // ── Check 2: import-chain resolution across the modular tree ────────────────
  const modFiles = walkDir(modRoot);
  let importsChecked = 0;
  for (const f of modFiles) {
    let src;
    try { src = fs.readFileSync(f, "utf8"); } catch (_) { continue; }
    const rel = path.relative(modRoot, f).replace(/\\/g, "/");
    const baseDir = path.dirname(f);
    for (const spec of extractRelativeSpecifiers(src)) {
      importsChecked++;
      const resolved = resolveSpecifier(baseDir, spec);
      if (!resolved) {
        add("high", "import_unresolved",
          `import "${spec}" in ${rel} does not resolve (tried .js/.ts/.tsx/.jsx + /index.*)`,
          { file: rel, spec });
      }
    }
  }

  // ── Check 3: HTML structure sanity ─────────────────────────────────────────
  let htmlIds = new Set();
  if (entryExists) {
    for (const issue of checkHtmlBalance(html)) {
      add("med", "html_unbalanced", `${entryRel}: ${issue}`, { entry: entryRel });
    }
    for (const esc of findLiteralEscapes(html)) {
      add("med", "literal_escape",
        `${entryRel}:L${esc.at}: literal un-interpreted escape near "${esc.snippet}" (template string likely emitted \\n/\\t literally)`,
        { entry: entryRel, line: esc.at });
    }
    htmlIds = extractDomIds(html);
  }
  // Also union ids from any OTHER html files in the modular tree (a referenced
  // id may live in a partial/page other than the entry).
  for (const hf of findHtmlFiles(modRoot)) {
    if (hf === entryHtml) continue;
    try { extractDomIds(fs.readFileSync(hf, "utf8")).forEach((id) => htmlIds.add(id)); } catch (_) {}
  }

  // Every getElementById / querySelector("#id") in modular JS must have a home
  // in the modular HTML. (Dynamically-created ids will false-positive here, so
  // this is MED, not HIGH.)
  let idRefsChecked = 0;
  for (const f of modFiles) {
    let src;
    try { src = fs.readFileSync(f, "utf8"); } catch (_) { continue; }
    const rel = path.relative(modRoot, f).replace(/\\/g, "/");
    for (const ref of extractReferencedIds(src)) {
      idRefsChecked++;
      if (!htmlIds.has(ref.id)) {
        add("med", "dom_id_missing",
          `${rel}:L${lineOfIndex(src, ref.idx)}: ${ref.via}("${ref.id}") — id "${ref.id}" not found in any modular HTML`,
          { file: rel, id: ref.id, via: ref.via });
      }
    }
  }

  // ── Decision ───────────────────────────────────────────────────────────────
  const counts = { high: 0, med: 0, low: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  let decision = "pass";
  if (counts.high > 0) decision = "fail";
  else if (counts.med > 0) decision = "warn";

  const summary = {
    decision,
    entry_html: entryRel,
    entry_html_exists: entryExists,
    checks: {
      module_paths: entryExists ? `${assetsChecked} local asset(s) checked` : "entry missing",
      import_chain: `${importsChecked} relative import(s) checked across ${modFiles.length} file(s)`,
      html_sanity: entryExists ? `${idRefsChecked} DOM id ref(s) checked` : "entry missing",
    },
    counts,
  };

  const outPath = path.join(cfg.out_dir, "scaffold-check.sij.json");
  writeSIJ(outPath, "scaffold-check", null, findings, { summary });

  console.log(`[scaffold-check] decision=${decision} · high=${counts.high} med=${counts.med} → ${outPath}`);
  console.log(`  entry HTML: ${entryRel}${entryExists ? "" : "  (MISSING)"}`);
  console.log(`  ${summary.checks.module_paths}; ${summary.checks.import_chain}; ${summary.checks.html_sanity}`);
  const high = findings.filter((f) => f.severity === "high");
  const med = findings.filter((f) => f.severity === "med");
  for (const f of high.slice(0, 15)) console.log(`    HIGH · ${f.kind} · ${f.message}`);
  if (high.length > 15) console.log(`    … +${high.length - 15} more HIGH`);
  for (const f of med.slice(0, 10)) console.log(`    MED  · ${f.kind} · ${f.message}`);
  if (med.length > 10) console.log(`    … +${med.length - 10} more MED`);

  if (strict && decision === "fail") {
    console.log("[scaffold-check] STRICT gate: FAIL — unresolved wiring (module paths / imports). Fix before cutover.");
    process.exit(1);
  }
}

if (require.main === module) main();
