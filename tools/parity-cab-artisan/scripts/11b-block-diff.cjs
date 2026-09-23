#!/usr/bin/env node
// 11b-block-diff.cjs — Line-level diff for matched blocks (Stage 11.5).
//
// Mechanizes the side-by-side body inspection that an LLM/human would otherwise
// do manually when AST X-Ray reports a `mutated` or `diverged` block. Reads
// `ast-xray.sij.json`, slices the original source for each matched block, and
// classifies each line that exists in monolith but NOT in modular (and vice
// versa) by severity:
//
//   critical  — dropped assignment to bare identifier (e.g. `_glowTex = new ...`)
//               First seen 2026-05-28: getGlowTex extraction defect — modular
//               dropped monolith's `_glowTex = new THREE.CanvasTexture(c)` line.
//   high      — dropped property setter (e.g. `light.intensity = 1.5`)
//   med       — dropped function call (likely side-effecting)
//   low       — dropped 'other' code
//   info      — blank, comment, or pure punctuation
//
// Output: `<out_dir>/block-diff.sij.json` + console report.
//
// Usage:
//   node 11b-block-diff.cjs --config parity.config.json
//   node 11b-block-diff.cjs --config parity.config.json --label getGlowTex
//   node 11b-block-diff.cjs --config parity.config.json --label getGlowTex --verbose
//
// RECONCILIATION MODE (--label X): emits a self-contained "reconciliation
// packet" — the FULL contiguous monolith + modular block text — so an agent
// ports the divergence WITHOUT ever re-opening the monolith (MASTER-PLAN Pilar
// 0.7; Law 5 token economy). The all-entities run stays lean (no packets).
// Caveat: block text shows intended behavior; ALWAYS grep the target modular
// API signature before writing (block text may use a different arg shape).
//
// LLM-leveraged: an agent should NEVER need to manually open mono + mod files
// side by side and read them line by line. That work is mechanical and
// belongs in script. The agent's only decision is whether each finding is
// `regression_to_fix` (per Disposition Policy v1.1) or an intentional drop
// (warrants an RFC). Surfacing the EXACT dropped line + identifier + hypothesis
// gives the agent everything needed to make that call without manual diff.

"use strict";

const fs = require("fs");
const path = require("path");
const { writeSIJ, readSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");
const { preprocessSource } = require("./lib/parse.cjs");

// ─── Source slicing ──────────────────────────────────────────────────────────
function sliceBody(source, startLine, endLine) {
  if (!source) return "";
  const lines = source.split(/\r?\n/);
  // AST X-Ray reports 1-based line numbers. Slice end is exclusive.
  return lines.slice(startLine - 1, endLine).join("\n");
}

// Normalize a line for set-based diff: trim, drop trailing semicolons, collapse
// whitespace. Keeps identifier names intact so we can classify.
function normalizeLine(line) {
  return line.trim().replace(/\s+/g, " ").replace(/;+\s*$/, "");
}

// Split a source line into its ;-separated statements, each normalized. Used by
// the survival recheck (D1 — de-chaining): the monolith frequently packs several
// statements onto one source line that the modular splits across lines/modules.
function splitStatements(line) {
  return line
    .split(";")
    .map((s) => normalizeLine(s))
    .filter((s) => s && s.length > 2);
}

// Walk the WHOLE modular tree and collect every normalized statement into a Set.
// This widens the survival check (D2 — split-refactor): logic that moved to a
// sibling module is still "present" even when the matched mod_file dropped it.
// Together D1+D2 collapse the AST label-matcher's false-positive "dropped" noise
// (measured ~96% on Megazord CRIT/HIGH, 2026-05-29) without hiding real drops:
// a statement that exists NOWHERE in the tree (e.g. mkVase's studGeo.dispose())
// stays flagged.
function buildModularCorpus(modRoot) {
  const corpus = new Set();
  const skip = new Set(["node_modules", ".parity", "dist", "reference"]);
  (function rec(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (ent.isDirectory()) { if (!skip.has(ent.name)) rec(path.join(dir, ent.name)); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(ent.name) || /\.test\./.test(ent.name)) continue;
      let text;
      try { text = fs.readFileSync(path.join(dir, ent.name), "utf8"); } catch { continue; }
      for (const line of text.split(/\r?\n/)) {
        for (const stmt of splitStatements(line)) corpus.add(stmt);
      }
    }
  })(modRoot);
  return corpus;
}

// ─── Line classification ─────────────────────────────────────────────────────
function classifyDroppedLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return { severity: "info", kind: "blank" };
  if (/^\/\//.test(trimmed) || /^\*/.test(trimmed) || /^\/\*/.test(trimmed) || /\*\/$/.test(trimmed)) {
    return { severity: "info", kind: "comment" };
  }
  if (/^[{}\[\]()]+$/.test(trimmed) || /^[{}\[\]()]+\s*[,;]?$/.test(trimmed)) {
    return { severity: "info", kind: "punctuation" };
  }

  // Critical: bare-identifier assignment (e.g. `_glowTex = new ...`, `cache = {}`).
  // Excludes `let/const/var X = ...` declarations (those are local scope, not
  // module-level state mutations).
  const bareAssignMatch = trimmed.match(/^([a-zA-Z_$][\w$]*)\s*=(?!=)\s*(.+)/);
  if (bareAssignMatch && !/^(let|const|var)\s/.test(trimmed)) {
    const ident = bareAssignMatch[1];
    const rhs = bareAssignMatch[2];
    return {
      severity: "critical",
      kind: "dropped_bare_assignment",
      identifier: ident,
      hypothesis:
        `Bare-identifier assignment to \`${ident}\` was present in monolith but ` +
        `dropped from modular. If \`${ident}\` is a module-level state holder ` +
        `(texture cache, singleton, registry, etc.) the modular version will ` +
        `silently return null/undefined from any function that depends on it. ` +
        `THIS IS THE getGlowTex CLASS OF BUG (RFC-011 §3.4 extraction defect class A).`,
      rhs_preview: rhs.slice(0, 80),
    };
  }

  // High: property setter on Three.js / scene / renderer object (per Disposition
  // Policy v1.1 — modular setters on shared runtime state default to
  // regression_to_fix).
  const propSetterMatch = trimmed.match(/^([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+)\s*=(?!=)/);
  if (propSetterMatch) {
    const target = propSetterMatch[1];
    const isThreeLike = /\b(intensity|color|emissive|emissiveIntensity|metalness|roughness|opacity|map|fog|background|toneMapping|outputColorSpace|fov|aspect|near|far|shadowMap)\b/.test(target);
    return {
      severity: "high",
      kind: "dropped_property_setter",
      target,
      hypothesis:
        `Property setter \`${target} = ...\` dropped from modular. ` +
        (isThreeLike
          ? `Target matches Three.js shared-state surface — per Disposition Policy v1.1 this is regression_to_fix by default.`
          : `Verify whether target is shared runtime state.`),
    };
  }

  // Med: function call (potentially side-effecting)
  const callMatch = trimmed.match(/^([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*\(/);
  if (callMatch && !/^(return|throw|new|await|yield|typeof|void)\b/.test(trimmed)) {
    const callee = callMatch[1];
    const isKnownSideEffect = /(applyLights|applyGlow|applyQuality|render|setSize|dispose|addEventListener|removeEventListener|setInterval|setTimeout|requestAnimationFrame|emit|publish|dispatch)/.test(callee);
    return {
      severity: isKnownSideEffect ? "high" : "med",
      kind: "dropped_call",
      callee,
      hypothesis:
        `Call to \`${callee}()\` dropped from modular. ` +
        (isKnownSideEffect
          ? `Callee matches known side-effect pattern (render/listener/RAF/emit etc.) — regression_to_fix unless explicitly dispositioned.`
          : `Verify if it's a pure helper or side-effecting.`),
    };
  }

  // Return statement dropped — usually a control flow change
  if (/^return\b/.test(trimmed)) {
    return {
      severity: "high",
      kind: "dropped_return",
      hypothesis: `Return statement dropped from modular — control flow divergence.`,
    };
  }

  // Throw statement dropped — error-handling change
  if (/^throw\b/.test(trimmed)) {
    return {
      severity: "high",
      kind: "dropped_throw",
      hypothesis: `Throw statement dropped from modular — error handling divergence.`,
    };
  }

  return { severity: "low", kind: "dropped_other" };
}

function classifyNewLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "blank" };
  if (/^\/\//.test(trimmed) || /^\*/.test(trimmed)) return { kind: "comment" };
  if (/^(import|export)\s/.test(trimmed) || /^export\b/.test(trimmed)) return { kind: "scaffolding_import_export" };
  if (/^(if\s*\(\s*!?isBrowser|throw\s+browserRequired|if\s*\(\s*typeof\s+document)/.test(trimmed)) {
    return { kind: "scaffolding_ssr_guard" };
  }
  if (/^(let|const|var)\s/.test(trimmed)) return { kind: "scaffolding_local_decl" };
  return { kind: "modular_addition" };
}

// ─── Block-level diff ────────────────────────────────────────────────────────
function diffBlock(monoBody, modBody) {
  const monoLines = monoBody.split(/\r?\n/);
  const modLines = modBody.split(/\r?\n/);

  // Normalize for set comparison; keep raw for reporting.
  const modNormSet = new Set();
  for (const ml of modLines) {
    const n = normalizeLine(ml);
    if (n) modNormSet.add(n);
  }
  const monoNormSet = new Set();
  for (const ml of monoLines) {
    const n = normalizeLine(ml);
    if (n) monoNormSet.add(n);
  }

  const droppedFromMono = [];
  for (const ml of monoLines) {
    const n = normalizeLine(ml);
    if (n && !modNormSet.has(n)) {
      droppedFromMono.push(ml);
    }
  }

  const newInMod = [];
  for (const ml of modLines) {
    const n = normalizeLine(ml);
    if (n && !monoNormSet.has(n)) {
      newInMod.push(ml);
    }
  }

  return { droppedFromMono, newInMod };
}

function analyzeEntity(entity, monoSource, modSourceMap, monoRoot, modRoot, modCorpus, includeFullBlocks) {
  // Need BOTH sides to do line-level diff.
  if (!entity.monolith || !entity.modular) return null;
  // Preserved blocks have hash-equal bodies — nothing to diff.
  if (entity.status === "preserved") return null;
  // Only mutated/diverged (same label, body changed) are worth deep-diffing.
  if (entity.status !== "mutated" && entity.status !== "diverged") return null;

  const mono = entity.monolith;
  const mod = entity.modular;

  // Mono source is one file (cfg.monolith.root). Mod source comes from many files.
  const modAbs = path.join(modRoot, mod.file);
  const modSource = modSourceMap[modAbs];
  if (!modSource) return null;

  const monoBody = sliceBody(monoSource, mono.line, mono.end_line);
  const modBody = sliceBody(modSource, mod.line, mod.end_line);
  if (!monoBody || !modBody) return null;

  const { droppedFromMono, newInMod } = diffBlock(monoBody, modBody);

  const droppedClassified = droppedFromMono.map((l) => {
    const base = {
      raw: l.length > 200 ? l.slice(0, 197) + "..." : l,
      ...classifyDroppedLine(l),
    };
    // Survival recheck (D1 de-chaining + D2 split-refactor). If EVERY statement
    // on this "dropped" line survives somewhere in the modular tree, it was
    // moved or de-chained — not dropped. Downgrade to info so it stops inflating
    // block severity, but keep it visible (survived_in_tree) for zero-trust
    // transparency. A line with any statement absent from the whole tree (a real
    // drop) is untouched.
    if (base.severity !== "info" && modCorpus) {
      const stmts = splitStatements(l);
      if (stmts.length > 0 && stmts.every((s) => modCorpus.has(s))) {
        base.original_severity = base.severity;
        base.severity = "info";
        base.kind = "moved_or_dechained";
        base.survived_in_tree = true;
      }
    }
    return base;
  });
  const newClassified = newInMod.map((l) => ({
    raw: l.length > 200 ? l.slice(0, 197) + "..." : l,
    ...classifyNewLine(l),
  }));

  // Aggregate severity for the block
  const sevCount = { critical: 0, high: 0, med: 0, low: 0, info: 0 };
  for (const d of droppedClassified) sevCount[d.severity] = (sevCount[d.severity] || 0) + 1;
  const blockSeverity =
    sevCount.critical > 0 ? "critical"
    : sevCount.high > 0 ? "high"
    : sevCount.med > 0 ? "med"
    : sevCount.low > 0 ? "low"
    : "info";

  return {
    entity_id: entity.entity_id,
    label: mono.label,
    mono_file: mono.file,
    mono_lines: [mono.line, mono.end_line],
    mono_loc: mono.loc,
    mod_file: mod.file,
    mod_lines: [mod.line, mod.end_line],
    mod_loc: mod.loc,
    ast_status: entity.status,
    severity: blockSeverity,
    severity_breakdown: sevCount,
    dropped_count: droppedClassified.length,
    survival_downgraded_count: droppedClassified.filter((d) => d.survived_in_tree).length,
    new_count: newClassified.length,
    dropped_lines: droppedClassified,
    new_lines_sample: newClassified.slice(0, 15),
    // Reconciliation packet (on-demand, --label only): the FULL contiguous mono
    // + mod block text, so an agent ports from THIS output and never re-opens
    // the monolith (MASTER-PLAN Pilar 0.7 · Law 5 token economy). Omitted in the
    // all-entities run to keep block-diff.sij.json lean.
    ...(includeFullBlocks
      ? {
          reconciliation_packet: {
            note: "Port the modular block to match the monolith block. Verify target modular API signatures (grep) before writing — block text alone may use a different arg shape.",
            mono_block_full: monoBody,
            mod_block_full: modBody,
          },
        }
      : {}),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config || "parity.config.json");

  const astXrayPath = path.join(cfg.out_dir, "ast-xray.sij.json");
  if (!fs.existsSync(astXrayPath)) {
    console.error("ERROR: ast-xray.sij.json not found at " + astXrayPath);
    console.error("Run `node 11-ast-xray.cjs --config <cfg>` first.");
    process.exit(2);
  }
  const astXray = readSIJ(astXrayPath);
  const entities = astXray.entities || [];

  // H1/H2: preprocess to match the line numbers ast-xray (11) recorded — so
  // block slices line up. NO-OP for plain column-0 single-file JS.
  const monoSource = preprocessSource(
    fs.readFileSync(cfg.monolith.root, "utf8"),
    cfg.monolith.root,
    (cfg.monolith && cfg.monolith.kind) || "single-file"
  );
  const monoRoot = path.dirname(cfg.monolith.root);
  const modRoot = cfg.modular.root;

  // Pre-load all modular files that appear in entities
  const modSourceMap = {};
  for (const e of entities) {
    if (e.modular && e.modular.file) {
      const abs = path.join(modRoot, e.modular.file);
      if (!modSourceMap[abs] && fs.existsSync(abs)) {
        modSourceMap[abs] = fs.readFileSync(abs, "utf8");
      }
    }
  }

  // Survival corpus: every normalized statement across the WHOLE modular tree
  // (D2). Powers the per-line survival recheck inside analyzeEntity.
  const modCorpus = buildModularCorpus(modRoot);
  console.log(`[block-diff] survival corpus: ${modCorpus.size} normalized statements (whole modular tree)`);

  const labelFilter = args.label;
  const verbose = !!args.verbose;

  console.log(`[block-diff] analyzing ${entities.length} entities (filter: ${labelFilter || "<all mutated+diverged>"})`);

  const findings = [];
  let totalDowngraded = 0;
  for (const e of entities) {
    if (labelFilter) {
      const monoLabel = e.monolith && e.monolith.label;
      const modLabel = e.modular && e.modular.label;
      if (monoLabel !== labelFilter && modLabel !== labelFilter) continue;
    }
    const analysis = analyzeEntity(e, monoSource, modSourceMap, monoRoot, modRoot, modCorpus, !!labelFilter);
    if (!analysis) continue;
    totalDowngraded += analysis.survival_downgraded_count || 0;
    // Without label filter, only surface blocks with meaningful findings
    if (!labelFilter && analysis.severity === "info") continue;
    findings.push(analysis);
  }

  // Sort by severity (critical first), then by dropped_count desc
  const sevOrder = { critical: 0, high: 1, med: 2, low: 3, info: 4 };
  findings.sort((a, b) => {
    const sa = sevOrder[a.severity] ?? 99;
    const sb = sevOrder[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    return b.dropped_count - a.dropped_count;
  });

  const summary = {
    entities_in_xray: entities.length,
    entities_diffable: entities.filter(
      (e) => (e.status === "mutated" || e.status === "diverged") && e.monolith && e.modular
    ).length,
    findings_with_issues: findings.length,
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    med: findings.filter((f) => f.severity === "med").length,
    low: findings.filter((f) => f.severity === "low").length,
    survival_downgraded_lines: totalDowngraded,
  };

  const outPath = path.join(cfg.out_dir, "block-diff.sij.json");
  writeSIJ(outPath, "block-diff", null, findings, { summary });
  console.log(`[block-diff] output: ${outPath}`);

  // Mirror to artifact-system sink if configured (same pattern as ast-xray)
  if (cfg.artifact_system_sink) {
    try {
      const projectId = cfg.project || "default";
      let asRoot = process.cwd();
      for (let i = 0; i < 5; i++) {
        const candidate = path.join(asRoot, ".parity-traces");
        const pkgPath = path.join(asRoot, "package.json");
        if (
          fs.existsSync(candidate) ||
          (fs.existsSync(pkgPath) &&
            JSON.parse(fs.readFileSync(pkgPath, "utf8")).name === "artifact-system")
        ) {
          const destDir = path.join(candidate, projectId);
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          const destFile = path.join(destDir, "block-diff.sij.json");
          fs.writeFileSync(destFile, fs.readFileSync(outPath, "utf8"), "utf8");
          console.log(`[block-diff] synced → ${destFile}`);
          break;
        }
        asRoot = path.dirname(asRoot);
      }
    } catch (err) {
      console.log(`[block-diff] warn: failed to sync to .parity-traces: ${err.message}`);
    }
  }

  // Console report
  console.log("");
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  Block-Diff — Line-level analysis of matched diverged blocks│");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log(`│  Entities in AST X-Ray:   ${String(summary.entities_in_xray).padStart(5)}`);
  console.log(`│  Entities diffable:       ${String(summary.entities_diffable).padStart(5)}  (mutated + diverged with both sides)`);
  console.log(`│  Findings with issues:    ${String(summary.findings_with_issues).padStart(5)}`);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log(`│  CRITICAL: ${String(summary.critical).padStart(4)}  (dropped bare-identifier assignment — getGlowTex class)`);
  console.log(`│  HIGH:     ${String(summary.high).padStart(4)}  (dropped property setter / return / throw / known side-effect)`);
  console.log(`│  MED:      ${String(summary.med).padStart(4)}  (dropped function call)`);
  console.log(`│  LOW:      ${String(summary.low).padStart(4)}  (other dropped code)`);
  console.log("└─────────────────────────────────────────────────────────────┘");

  const topPriority = findings.filter((f) => f.severity === "critical" || f.severity === "high");
  if (topPriority.length > 0) {
    console.log("");
    console.log("  Critical/High findings (top 10):");
    for (const f of topPriority.slice(0, 10)) {
      console.log(`    ${f.severity.toUpperCase()} · ${f.label}  (mono ${f.mono_file}:L${f.mono_lines[0]}-${f.mono_lines[1]}, mod ${f.mod_file}:L${f.mod_lines[0]}-${f.mod_lines[1]})`);
      const topDrops = f.dropped_lines.filter((d) => d.severity === "critical" || d.severity === "high").slice(0, 3);
      for (const d of topDrops) {
        console.log(`        ${d.severity.toUpperCase()} ${d.kind}: ${d.raw.trim().slice(0, 75)}`);
        if (d.hypothesis) console.log(`              hypothesis: ${d.hypothesis.slice(0, 120)}...`);
      }
      if (labelFilter && f.reconciliation_packet) {
        const rp = f.reconciliation_packet;
        console.log(`\n   ── RECONCILIATION PACKET (port from here — do NOT reopen the monolith) ──`);
        console.log(`   ┌─ MONOLITH ${f.mono_file}:${f.mono_lines.join("-")}`);
        for (const ln of rp.mono_block_full.split(/\r?\n/)) console.log(`   M│ ${ln}`);
        console.log(`   ├─ MODULAR ${f.mod_file}:${f.mod_lines.join("-")}`);
        for (const ln of rp.mod_block_full.split(/\r?\n/)) console.log(`   X│ ${ln}`);
        console.log(`   └─ ${rp.note}`);
      }
    }
  }

  if (verbose && labelFilter && findings.length > 0) {
    console.log("");
    console.log(`  Verbose dump for label=${labelFilter}:`);
    console.log(JSON.stringify(findings[0], null, 2));
  }

  // Warning-only mode for now (P1). Will promote to HARD gate in P2 (with
  // Provenance Ledger acting as the architectural enforcement layer).
  console.log("");
  console.log(
    `[block-diff] ${summary.critical === 0 && summary.high === 0 ? "PASS" : "WARN"} — ` +
    `${summary.critical} critical, ${summary.high} high, ${summary.med} med, ${summary.low} low`
  );
  process.exit(0);
}

if (require.main === module) main();
