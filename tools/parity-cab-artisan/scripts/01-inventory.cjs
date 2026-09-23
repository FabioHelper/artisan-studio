#!/usr/bin/env node
// 01-inventory.cjs — Walk a side (monolith or modular), extract every exported
// symbol, write a SIJ inventory.
//
// Usage:
//   node 01-inventory.cjs --config parity.config.json --side monolith
//   node 01-inventory.cjs --config parity.config.json --side modular

"use strict";

const fs = require("fs");
const path = require("path");
const { extractSymbols, preprocessSource } = require("./lib/parse.cjs");
const { writeSIJ, entityId, loadConfig, parseArgs } = require("./lib/sij.cjs");

const SOURCE_EXT = /\.(ts|tsx|js|jsx|cjs|mjs)$/;
const SKIP_DIR   = /(^|\/)(node_modules|dist|build|\.git|coverage|\.parity|\.bridge)(\/|$)/;
const SKIP_FILE  = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

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

function relTo(root, full) {
  return path.relative(root, full).replace(/\\/g, "/");
}

function inventoryFile(filePath, root, sideKind) {
  const raw = fs.readFileSync(filePath, "utf8");
  // H1/H2: for single-file monoliths, extract inline JS from HTML (when
  // .html/.htm) and dedent — line count preserved so `line` stays correct.
  const source = preprocessSource(raw, filePath, sideKind);
  const { symbols, imports } = extractSymbols(source, filePath);
  const rel = sideKind === "single-file" ? path.basename(filePath) : relTo(root, filePath);
  const loc = source.split("\n").length;
  // For single-file monoliths, the *entire top-level surface* is public API
  // (since `export default` typically renders one component that closes over
  // everything else). Include internal-* kinds and normalize their kind label.
  const includeInternals = sideKind === "single-file";
  return symbols
    .filter((s) => {
      if (s.exported) return true;
      if (includeInternals && /^internal-/.test(s.kind)) return true;
      return false;
    })
    .map((s) => {
      const kind = includeInternals ? s.kind.replace(/^internal-/, "") : s.kind;
      return {
        entity_id: entityId(rel, s.name),
        file: rel,
        line: s.line,
        name: s.name,
        kind,
        exported: s.exported || includeInternals,
        signature: s.signature,
        file_loc: loc,
        jsdoc: s.jsdoc,
        imports_count: imports.length,
      };
    });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config || "parity.config.json");
  const side = args.side;
  if (side !== "monolith" && side !== "modular") {
    console.error("ERROR: --side must be 'monolith' or 'modular'");
    process.exit(2);
  }
  const sideCfg = cfg[side];
  let files = [];
  if (sideCfg.kind === "single-file") {
    files = [sideCfg.root];
  } else {
    files = walk(sideCfg.root, []);
  }
  const entities = [];
  for (const f of files) {
    try {
      const items = inventoryFile(f, sideCfg.root, sideCfg.kind);
      entities.push(...items);
    } catch (err) {
      console.error("WARN: failed to parse " + f + ": " + err.message);
    }
  }
  const out = path.join(cfg.out_dir, `inventory.${side}.sij.json`);
  writeSIJ(out, "inventory", side, entities, {
    source_root: sideCfg.root.replace(/\\/g, "/"),
    source_kind: sideCfg.kind,
    file_count: files.length,
  });
  console.log(`[inventory:${side}] ${entities.length} symbols from ${files.length} file(s) → ${out}`);
}

if (require.main === module) main();
