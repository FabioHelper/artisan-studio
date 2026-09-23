#!/usr/bin/env node
// bulk-disposition.cjs — Apply a disposition to many RFCs at once, filtered by
// gap kind / risk / name pattern. Preserves any RFC that was already
// dispositioned to a non-`pending` value (idempotent + non-destructive).
//
// Usage:
//   node bulk-disposition.cjs --config parity.config.json \
//        --gap diverged --risk high \
//        --disposition approved \
//        --notes "TS typing + THREE injection — module boundary change"
//
// Filters (all optional, AND-combined):
//   --gap        missing|diverged|new
//   --risk       med|high|critical (and above)
//   --name       regex (matches gap.name)
//   --domain     core|scene|creator|...
//
// Required:
//   --disposition  approved|intentional_drop|intentional_rename|regression_to_fix|rejected
//
// Optional:
//   --notes      free text appended to the front-matter notes field
//   --reviewer   default: "bulk-disposition"
//   --dry-run    print what would change without writing

"use strict";

const fs = require("fs");
const path = require("path");
const { loadConfig, parseArgs } = require("./lib/sij.cjs");

const VALID_DISPOSITIONS = new Set([
  "approved",
  "intentional_drop",
  "intentional_rename",
  "regression_to_fix",
  "rejected",
  "pending",
]);

const RISK_LEVELS = ["info", "low", "med", "high", "critical"];

function parseFrontMatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const fm = {};
  m[1].split("\n").forEach((line) => {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  });
  return { fm, body: m[2] };
}

function renderFrontMatter(fm) {
  const order = ["rfc_id", "title", "entity_id", "gap", "risk", "domain", "cab_required", "disposition", "reviewer", "reviewed_at", "notes"];
  const seen = new Set();
  const lines = [];
  for (const k of order) {
    if (fm[k] != null) { lines.push(`${k}: ${fm[k]}`); seen.add(k); }
  }
  for (const k of Object.keys(fm)) {
    if (!seen.has(k)) lines.push(`${k}: ${fm[k]}`);
  }
  return "---\n" + lines.join("\n") + "\n---\n";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config || "parity.config.json");

  if (!args.disposition || !VALID_DISPOSITIONS.has(args.disposition)) {
    console.error("ERROR: --disposition required, one of: " + [...VALID_DISPOSITIONS].join(", "));
    process.exit(2);
  }

  const rfcDir = path.join(cfg.out_dir, "rfcs");
  if (!fs.existsSync(rfcDir)) {
    console.error("ERROR: no rfcs/ dir at " + rfcDir + ". Run 04-rfc-gen.cjs first.");
    process.exit(2);
  }

  const files = fs.readdirSync(rfcDir).filter((f) => /\.md$/.test(f));
  const minRiskIdx = args.risk ? RISK_LEVELS.indexOf(args.risk) : -1;
  const nameRe = args.name ? new RegExp(args.name) : null;
  const reviewer = args.reviewer || "bulk-disposition";
  const today = new Date().toISOString().slice(0, 10);
  const dryRun = args["dry-run"] === true;

  let touched = 0;
  let skippedAlreadyDispositioned = 0;
  let skippedFilter = 0;

  for (const f of files) {
    const filePath = path.join(rfcDir, f);
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseFrontMatter(raw);
    if (!parsed) continue;
    const { fm, body } = parsed;

    // Idempotency: don't overwrite an already-dispositioned RFC
    if (fm.disposition && fm.disposition !== "pending" && fm.disposition !== args.disposition) {
      skippedAlreadyDispositioned++;
      continue;
    }

    // Filters
    if (args.gap && fm.gap !== args.gap) { skippedFilter++; continue; }
    if (minRiskIdx >= 0 && RISK_LEVELS.indexOf(fm.risk) < minRiskIdx) { skippedFilter++; continue; }
    if (nameRe && !nameRe.test(fm.title || "")) { skippedFilter++; continue; }
    if (args.domain && fm.domain !== args.domain) { skippedFilter++; continue; }

    // Apply
    fm.disposition = args.disposition;
    fm.reviewer = reviewer;
    fm.reviewed_at = today;
    if (args.notes) fm.notes = args.notes;

    if (!dryRun) {
      fs.writeFileSync(filePath, renderFrontMatter(fm) + body, "utf8");
    }
    touched++;
  }

  console.log(
    `[bulk-disposition${dryRun ? ":dry-run" : ""}] ` +
    `${touched} RFC(s) → ${args.disposition}; ` +
    `${skippedAlreadyDispositioned} already dispositioned (preserved); ` +
    `${skippedFilter} filtered out`
  );
}

if (require.main === module) main();
