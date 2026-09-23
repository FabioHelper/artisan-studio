#!/usr/bin/env node
// 10-coverage-gate.cjs — Verdict on coverage-inventory.sij.json + RFC dispositions.
//
// Pairs with 09-coverage-scan.cjs. Reads the inventory of orphans, cross-
// references with existing RFC dispositions, and emits a GO/NO-GO decision
// for the structural-coverage axis (separate from but composable with
// 05-cab-gate's signature-parity axis).
//
// Disposition source: .parity/rfcs/*.md — same files parity-cab's 04-rfc-gen
// produces. Convention: a coverage-orphan RFC has front-matter
//   coverage_entity_id:  <entity_id>            (single orphan)
//   coverage_entity_ids: <id1>,<id2>,<id3>      (bulk — comma-separated)
// and the standard disposition field. If marked
//   disposition: intentional_drop | intentional_rename | approved
// the orphan no longer blocks. Otherwise (default `pending`) it blocks if
// severity is high/critical.
//
// Outputs: coverage-verdict.json + non-zero exit on blocking orphans.
//
// Usage: node 10-coverage-gate.cjs --config parity.config.json
"use strict";

const fs = require("fs");
const path = require("path");
const { readSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");

function readDispositions(rfcDir) {
  if (!fs.existsSync(rfcDir)) return {};
  const out = {};
  const files = fs.readdirSync(rfcDir).filter((f) => /\.md$/.test(f));
  for (const f of files) {
    const raw = fs.readFileSync(path.join(rfcDir, f), "utf8");
    const fm = (raw.match(/^---\n([\s\S]*?)\n---/) || [, ""])[1];
    const o = {};
    fm.split("\n").forEach((line) => {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) o[m[1]] = m[2].trim();
    });
    if (o.coverage_entity_id) out[o.coverage_entity_id] = { ...o, file: f };
    if (o.coverage_entity_ids) {
      const ids = o.coverage_entity_ids.split(",").map((s) => s.trim()).filter(Boolean);
      for (const id of ids) out[id] = { ...o, file: f };
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config || "parity.config.json");
  const invPath = path.join(cfg.out_dir, "coverage-inventory.sij.json");
  if (!fs.existsSync(invPath)) {
    console.error("ERROR: coverage-inventory.sij.json not found at " + invPath);
    console.error("Run 09-coverage-scan.cjs first.");
    process.exit(2);
  }
  const inv = readSIJ(invPath);
  const dispositions = readDispositions(path.join(cfg.out_dir, "rfcs"));

  const orphans = inv.entities.filter((e) => e.status === "orphan");
  const tagged = orphans.map((o) => {
    const dispo = dispositions[o.entity_id];
    let effective_severity = o.severity;
    let resolution = "pending";
    if (dispo) {
      resolution = dispo.disposition || "pending";
      if (["approved", "intentional_drop", "intentional_rename"].includes(resolution)) {
        effective_severity = "info"; // resolved → not blocking
      } else if (resolution === "regression_to_fix") {
        effective_severity = "critical"; // explicit blocker
      }
    }
    return { ...o, disposition: resolution, effective_severity };
  });

  const blocking = tagged.filter((t) => t.effective_severity === "high" || t.effective_severity === "critical");
  const warning  = tagged.filter((t) => t.effective_severity === "med");
  const info     = tagged.filter((t) => t.effective_severity === "info" || t.effective_severity === "low");
  const dispositioned = tagged.filter((t) => t.disposition !== "pending");

  const decision = blocking.length === 0 ? (warning.length === 0 ? "PASS" : "PASS-WITH-WARNINGS") : "FAIL";

  const summary = {
    decision,
    total_items: inv.entities.length,
    orphan_items: orphans.length,
    matched_items: inv.entities.length - orphans.length,
    blocking: blocking.length,
    warning: warning.length,
    info_or_low: info.length,
    dispositioned: dispositioned.length,
  };

  const verdict = {
    schema_version: "1.0.0",
    schema_kind: "parity-cab/coverage-verdict",
    generated_at: new Date().toISOString(),
    summary,
    blocking_orphans: blocking.map((o) => ({
      entity_id: o.entity_id,
      kind: o.kind,
      name: o.name || o.text || o.target,
      line: o.line,
      loc: o.loc,
      severity: o.severity,
      disposition: o.disposition,
    })),
    warning_orphans: warning.map((o) => ({
      entity_id: o.entity_id,
      kind: o.kind,
      name: o.name || o.text || o.target,
      line: o.line,
      severity: o.severity,
      disposition: o.disposition,
    })),
    by_disposition: tagged.reduce((acc, t) => {
      acc[t.disposition] = (acc[t.disposition] || 0) + 1;
      return acc;
    }, {}),
  };

  const out = path.join(cfg.out_dir, "coverage-verdict.json");
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2), "utf8");

  console.log(`[coverage-gate] decision=${decision} → ${out}`);
  console.log(`  total=${inv.entities.length}  matched=${summary.matched_items}  orphans=${summary.orphan_items}`);
  console.log(`  blocking=${blocking.length}  warning=${warning.length}  info/low=${info.length}  dispositioned=${dispositioned.length}`);
  if (blocking.length > 0) {
    console.log(`  blocking items:`);
    blocking.slice(0, 12).forEach((o) => {
      const label = o.name || o.text || o.target;
      console.log(`    · ${o.kind} · ${label} (L${o.line}${o.loc ? `, ${o.loc} LOC` : ""}) → disposition=${o.disposition}`);
    });
  }

  if (decision === "FAIL") process.exit(1);
}

if (require.main === module) main();
