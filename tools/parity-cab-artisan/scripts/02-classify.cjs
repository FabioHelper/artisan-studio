#!/usr/bin/env node
// 02-classify.cjs — Read both inventories, tag each entity with domain/risk/volatility,
// write tagged inventories back.
"use strict";

const path = require("path");
const { readSIJ, writeSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");
const { classifyDomain, classifyVolatility, classifyRisk } = require("./lib/heuristics.cjs");

function tagEntities(entities, sideName) {
  return entities.map((e) => {
    const domain = classifyDomain(e.file, e.name);
    const volatility = classifyVolatility(e.jsdoc);
    const risk = classifyRisk(domain, e.kind, e.exported);
    return { ...e, tags: { domain, volatility, risk, side: sideName } };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config || "parity.config.json");
  for (const side of ["monolith", "modular"]) {
    const inPath  = path.join(cfg.out_dir, `inventory.${side}.sij.json`);
    const outPath = path.join(cfg.out_dir, `inventory.${side}.tagged.sij.json`);
    const inv = readSIJ(inPath);
    const tagged = tagEntities(inv.entities, side);
    writeSIJ(outPath, "inventory-tagged", side, tagged, {
      source_root: inv.source_root,
      source_kind: inv.source_kind,
      file_count: inv.file_count,
    });
    const summary = tagged.reduce((acc, e) => {
      acc.byDomain[e.tags.domain] = (acc.byDomain[e.tags.domain] || 0) + 1;
      acc.byRisk[e.tags.risk]     = (acc.byRisk[e.tags.risk]     || 0) + 1;
      acc.byKind[e.kind]          = (acc.byKind[e.kind]          || 0) + 1;
      return acc;
    }, { byDomain: {}, byRisk: {}, byKind: {} });
    console.log(`[classify:${side}] ${tagged.length} tagged → ${outPath}`);
    console.log("  domains:", JSON.stringify(summary.byDomain));
    console.log("  risks:  ", JSON.stringify(summary.byRisk));
  }
}

if (require.main === module) main();
