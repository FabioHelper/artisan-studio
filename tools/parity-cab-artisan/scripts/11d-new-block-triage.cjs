#!/usr/bin/env node
// 11d-new-block-triage.cjs — Triage high-side-effect new_blocks (Stage 11.7).
//
// MASTER-PLAN C1 follow-up. The --strict gate surfaced N new_blocks with
// side_effect_potential:"high". Most are AST-label-split FPs (monolith had
// identical logic in an anonymous/inline closure; modular extracted + named it).
// This script separates them mechanically without LLM:
//
//   SPLIT-FP  — the THREE.js setter calls that triggered "high" exist verbatim
//               in the monolith (logic came FROM the monolith, just renamed).
//               → auto-generate ast-xray.dispositions.json entry (NOT a new behavior).
//
//   CANDIDATE — at least one side-effect call is absent from the monolith.
//               → printed for Opus/Fabio sign-off (DO NOT auto-disposition).
//
// Escalate-to-Opus: any CANDIDATE before touching modular src. This script
// only reads; it writes the dispositions file for split-FPs only.
//
// Usage: node 11d-new-block-triage.cjs --config parity.config.json [--dry-run]

"use strict";

const fs   = require("fs");
const path = require("path");
const { loadConfig, parseArgs } = require("./lib/sij.cjs");

// ── Side-effect statement extractor ────────────────────────────────────────
// Extracts the bare call/setter lines that triggered side_effect_potential:"high".
// Mirrors the detector in 11-ast-xray.cjs (THREE setter patterns + known wrappers).
const HIGH_PATTERNS = [
  /\b\w+\.intensity\s*=/,
  /\b\w+\.opacity\s*=/,
  /\b\w+\.fov\s*=/,
  /\b\w+\.fog\s*=/,
  /\b\w+\.background\s*=/,
  /\b\w+\.environment\s*=/,
  /\b\w+\.toneMappingExposure\s*=/,
  /\b\w+\.toneMapping\s*=/,
  /\b\w+\.shadowMap\b/,
  /\bapplyLights\s*\(/,
  /\bapplyGlow\s*\(/,
  /\bapplyQuality\s*\(/,
  /\bsetPixelRatio\s*\(/,
  /\bsetSize\s*\(/,
  /\b\w+\.color\s*\.\s*set\s*\(/,
  /\b\w+\.needsUpdate\s*=/,
  /\bLight\s*\(/,
  /\bnew\s+THREE\.\w*(Light|Material|Renderer|Camera|Scene|Fog)\b/,
];

// canonicalize() — reduce a line to a NAME-AGNOSTIC structural signature so a
// faithful-but-renamed/retyped monolith line matches its modular twin. Verified
// necessary 2026-05-30: 14/38 candidates were split-FPs the verbatim matcher
// missed due to (a) TS casts `x as unknown as T`, (b) `var`→`const`, (c) local
// renames (`keyL`→`keyLight`). We match on WHAT THE CODE DOES (the THREE call +
// its numeric/hex/string literals), not on identifier names. Mirrors the AST
// X-Ray structural-hash philosophy.
function canonicalize(line) {
  let s = line.trim();
  s = s.replace(/\/\/.*$/, "");                       // strip trailing line comment
  s = s.replace(/\s+as\s+unknown\s+as\s+[\w.$<>\[\]]+/g, ""); // strip `as unknown as T`
  s = s.replace(/\s+as\s+[\w.$<>\[\]]+/g, "");          // strip `as T`
  s = s.replace(/:\s*[\w.$<>\[\]|&,{} ]+?(?=[=,);])/g, ""); // strip TS type annotations
  s = s.replace(/\b(var|const|let)\s+/g, "");           // normalize declarations
  // Numeric canonicalization — ORDER MATTERS (most specific first) so floats/hex
  // tokenize atomically. A naive int-first pass fragments `.025` into `0|25`.
  s = s.replace(/0x[0-9a-fA-F]+/g, (h) => " #NUM:" + parseInt(h, 16) + " ");      // hex
  s = s.replace(/\d+\.\d+/g, (n) => " #NUM:" + Number(n) + " ");                   // 1.5
  s = s.replace(/(?<![\w.])\.\d+/g, (n) => " #NUM:" + Number("0" + n) + " ");      // .025 → 0.025
  s = s.replace(/(?<![\w.:])\d+(?![\w.])/g, (n) => " #NUM:" + Number(n) + " ");    // bare int
  // Reduce to the structural skeleton: keep THREE.*, method names, numeric/hex
  // literals, string literals; drop identifier names (which differ on rename).
  const tokens = [];
  const re = /THREE\.\w+|\.\w+\s*\(|\b(?:new|return)\b|#NUM:-?[\d.]+|"[^"]*"|'[^']*'/g;
  let mm;
  while ((mm = re.exec(s)) !== null) tokens.push(mm[0].replace(/\s+/g, ""));
  return tokens.join("|");
}

function extractSideEffectCalls(source) {
  const calls = new Set();
  for (const line of source.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("*")) continue;
    for (const pat of HIGH_PATTERNS) {
      if (pat.test(t)) {
        const canon = canonicalize(t);
        if (canon && canon.length > 2) calls.add(canon);
        break;
      }
    }
  }
  return [...calls];
}

// ── Monolith statement corpus (canonical signatures) ─────────────────────────
function buildMonolithCorpus(monoPath) {
  const corpus = new Set();
  const text = fs.readFileSync(monoPath, "utf8");
  // The monolith packs many statements per line (e.g. `const scene = ...; scene.fog = ...`).
  // Split on `;` so each statement gets its own canonical signature.
  for (const rawLine of text.split(/\r?\n/)) {
    for (const stmt of rawLine.split(";")) {
      const canon = canonicalize(stmt);
      if (canon && canon.length > 2) corpus.add(canon);
    }
  }
  return corpus;
}

// ── Source slicer ───────────────────────────────────────────────────────────
function sliceBlock(source, startLine, endLine) {
  const lines = source.split(/\r?\n/);
  return lines.slice(startLine - 1, endLine).join("\n");
}

function main() {
  const args    = parseArgs(process.argv.slice(2));
  const cfg     = loadConfig(args.config || "parity.config.json");
  const dryRun  = !!args["dry-run"];

  const xrayPath = path.join(cfg.out_dir, "ast-xray.sij.json");
  if (!fs.existsSync(xrayPath)) { console.error("ERROR: run gate:xray first."); process.exit(2); }
  const xray = JSON.parse(fs.readFileSync(xrayPath, "utf8"));

  const highNew = (xray.entities || []).filter(
    (e) => e.status === "new" && e.modular && e.modular.side_effect_potential === "high"
  );

  if (highNew.length === 0) {
    console.log("[new-block-triage] No high-side-effect new_blocks. Nothing to triage.");
    process.exit(0);
  }

  const monolithCorpus = buildMonolithCorpus(cfg.monolith.root);
  const modRoot        = cfg.modular.root;

  // Pre-load modular files
  const modSrcCache = {};
  for (const e of highNew) {
    if (!e.modular || !e.modular.file) continue;
    const abs = path.join(modRoot, e.modular.file);
    if (!modSrcCache[abs] && fs.existsSync(abs)) {
      modSrcCache[abs] = fs.readFileSync(abs, "utf8");
    }
  }

  const splitFPs  = [];
  const candidates = [];

  for (const e of highNew) {
    const m   = e.modular;
    const abs = path.join(modRoot, m.file);
    const src = modSrcCache[abs];
    if (!src) { candidates.push({ ...e, reason: "source_not_found" }); continue; }

    const body      = sliceBlock(src, m.line, m.end_line);
    const seCalls   = extractSideEffectCalls(body);

    if (seCalls.length === 0) {
      // Detector fired but no extractable call found in this slice — conservative: skip
      splitFPs.push({ entity_id: e.entity_id, label: m.label, file: m.file,
                      reason: "no_extractable_se_call_in_slice_safe_to_disposition" });
      continue;
    }

    // seCalls and corpus are BOTH canonical signatures now → direct membership.
    const missingFromMono = seCalls.filter((c) => !monolithCorpus.has(c));

    if (missingFromMono.length === 0) {
      splitFPs.push({ entity_id: e.entity_id, label: m.label, file: m.file,
                      se_calls_all_in_monolith: seCalls });
    } else {
      candidates.push({ entity_id: e.entity_id, label: m.label, file: m.file,
                        lines: [m.line, m.end_line], loc: m.loc,
                        missing_from_monolith: missingFromMono,
                        all_se_calls: seCalls });
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`[new-block-triage] ${highNew.length} high-side-effect new_blocks triaged.`);
  console.log(`  split-FP (auto-disposition): ${splitFPs.length}`);
  console.log(`  genuine candidates (STOP → Opus/Fabio): ${candidates.length}`);
  console.log("");

  if (splitFPs.length > 0) {
    console.log("── SPLIT-FPs (all THREE.js calls found verbatim in monolith) ──────────────");
    for (const f of splitFPs) {
      console.log(`  ✓ ${f.label} (${path.basename(f.file)}) → dispositioned`);
    }
    console.log("");
  }

  if (candidates.length > 0) {
    console.log("── CANDIDATES (calls NOT in monolith — ESCALATE TO OPUS/FABIO) ────────────");
    for (const c of candidates) {
      console.log(`  ⚠ ${c.label} (${path.basename(c.file)}:L${c.lines[0]}-${c.lines[1]}, ${c.loc}LOC)`);
      for (const call of c.missing_from_monolith.slice(0, 4)) {
        console.log(`      MISSING: ${call}`);
      }
    }
    console.log("");
    console.log("  ⚠ Do NOT auto-disposition CANDIDATES. Escalate to Opus for ground-truth.");
  }

  // ── Write dispositions for split-FPs ───────────────────────────────────────
  const dispPath = path.join(cfg.out_dir, "ast-xray.dispositions.json");
  const existing = fs.existsSync(dispPath)
    ? JSON.parse(fs.readFileSync(dispPath, "utf8"))
    : { dispositioned: [] };

  const existingSet = new Set(existing.dispositioned);
  let added = 0;
  for (const f of splitFPs) {
    if (!existingSet.has(f.entity_id)) {
      existing.dispositioned.push(f.entity_id);
      added++;
    }
  }

  if (dryRun) {
    console.log(`[new-block-triage] dry-run: would add ${added} split-FP dispositions to ${dispPath}`);
  } else if (added > 0) {
    fs.writeFileSync(dispPath, JSON.stringify(existing, null, 2), "utf8");
    console.log(`[new-block-triage] wrote ${dispPath} (+${added} dispositions, total ${existing.dispositioned.length})`);
  } else {
    console.log("[new-block-triage] no new dispositions to write.");
  }

  // Exit 1 only if there are genuine candidates — pipeline knows to pause
  process.exit(candidates.length > 0 ? 1 : 0);
}

main();
