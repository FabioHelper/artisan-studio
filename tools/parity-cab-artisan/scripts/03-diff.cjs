#!/usr/bin/env node
// 03-diff.cjs — Compare tagged inventories side-by-side. Emit parity-report.sij.json
// with one entry per symbol that is missing/new/diverged, classified by risk.
"use strict";

const path = require("path");
const { readSIJ, writeSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");
const { classifyGapRisk, RISK_LEVELS } = require("./lib/heuristics.cjs");

// Normalize a signature for comparison. The goal: a JS-bare signature and its
// TS-typed equivalent should hash to the same string.
//
//   monolith: "function uid()"
//   modular:  "export function uid(): string"
//   normalized (both): "function uid()"
//
// Steps (order matters):
//   1) Strip comments + collapse whitespace.
//   2) Strip leading "export" / "default" / "async" keywords.
//   3) Replace "let" / "var" with "const" (declaration form is noise).
//   4) Strip return type annotations: ")\s*:\s*<type>" → ")".
//   5) Strip parameter type annotations: "name: <type>" → "name".
//   6) Strip default values: "name = <expr>" → "name".
//   7) Strip generic parameters: "<T extends X>" → "" (informational only).
//   8) Collapse, lowercase.
//
// We use balanced-bracket aware stripping for type annotations because TS types
// can contain commas/parens (Array<{ a: B }>, etc).
function stripBalanced(s, open, close, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) {
      if (--depth === 0) return i;
    }
  }
  return -1;
}

function stripGenerics(s) {
  // Remove all <...> blocks at top level. Be conservative: only strip if the
  // opening `<` is preceded by an identifier char (not by `=>` arrow or `<` of JSX).
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "<" && i > 0 && /[\w_$)]/.test(s[i - 1])) {
      // Find matching `>` with simple depth counter
      let depth = 1;
      let j = i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === "<") depth++;
        else if (s[j] === ">") depth--;
        j++;
      }
      if (depth === 0) { i = j; continue; }
    }
    out += s[i++];
  }
  return out;
}

function stripReturnType(s) {
  // ")<spaces>:<...>" up to "{" or ";" or "=>" or end → ")"
  return s.replace(/\)\s*:\s*[^{;=]+(?=\s*(?:\{|;|=>|$))/g, ")");
}

function stripParamTypes(s) {
  // Inside (...) blocks, strip ": <type>" after each identifier.
  // Walk balanced parens and rewrite inner content.
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "(") {
      const end = stripBalanced(s, "(", ")", i);
      if (end < 0) { result += s.slice(i); break; }
      const inner = s.slice(i + 1, end);
      // Within the param list, strip "name: type" → "name" and default values.
      // Split by commas at depth 0.
      const params = [];
      let depth = 0;
      let cur = "";
      for (const c of inner) {
        if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
        else if (c === ")" || c === "]" || c === "}" || c === ">") depth--;
        if (c === "," && depth === 0) { params.push(cur); cur = ""; continue; }
        cur += c;
      }
      if (cur.trim()) params.push(cur);
      const stripped = params.map((p) => {
        p = p.trim();
        // Remove default value: "x = expr" or "x: T = expr"
        p = p.replace(/\s*=\s*[^,]+$/, "");
        // Remove type annotation: take only the identifier (or rest pattern)
        const m = p.match(/^(\.\.\.)?([A-Za-z_$][\w$]*|\{[^}]*\}|\[[^\]]*\])/);
        return m ? (m[1] || "") + m[2] : p;
      });
      result += "(" + stripped.join(",") + ")";
      i = end + 1;
    } else {
      result += s[i++];
    }
  }
  return result;
}

function normalizeSig(sig) {
  if (!sig) return "";
  let s = sig
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^\s*export\s+(default\s+)?/, "");
  s = s.replace(/^\s*async\s+/, "");
  s = s.replace(/^(let|var)\s+/, "const ");
  s = stripGenerics(s);
  s = stripReturnType(s);
  s = stripParamTypes(s);
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  return s;
}

// Whether two symbols "match" (same name, same kind family).
const KIND_FAMILY = {
  function: "callable", component: "callable",
  class: "class",
  type: "type", interface: "type",
  enum: "enum",
  const: "const",
  default: "default",
  "re-export": "re-export",
};

function family(kind) { return KIND_FAMILY[kind] || kind; }

function indexByName(entities) {
  const m = new Map();
  for (const e of entities) {
    const arr = m.get(e.name) || [];
    arr.push(e);
    m.set(e.name, arr);
  }
  return m;
}

function pickBestMatch(symList, sym) {
  // Prefer same-family; then by signature similarity; else first.
  let best = null;
  let bestScore = -1;
  for (const candidate of symList) {
    let score = 0;
    if (family(candidate.kind) === family(sym.kind)) score += 5;
    const ns1 = normalizeSig(sym.signature), ns2 = normalizeSig(candidate.signature);
    if (ns1 === ns2) score += 5;
    else if (ns2 && ns1 && ns2.length && ns1.length) {
      const minLen = Math.min(ns1.length, ns2.length);
      let common = 0;
      for (let i = 0; i < minLen; i++) if (ns1[i] === ns2[i]) common++;
      score += Math.floor((common / Math.max(ns1.length, ns2.length)) * 3);
    }
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return { match: best, score: bestScore };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(args.config || "parity.config.json");
  const monoInv = readSIJ(path.join(cfg.out_dir, "inventory.monolith.tagged.sij.json"));
  const modInv  = readSIJ(path.join(cfg.out_dir, "inventory.modular.tagged.sij.json"));

  const monoSyms = monoInv.entities;
  const modSyms  = modInv.entities;
  const modIdx   = indexByName(modSyms);
  const monoIdx  = indexByName(monoSyms);

  const gaps = [];
  const matchedModularIds = new Set();

  // Pass 1: every monolith symbol — find a modular counterpart.
  for (const m of monoSyms) {
    const candidates = modIdx.get(m.name);
    if (!candidates || !candidates.length) {
      const risk = classifyGapRisk(m.tags.risk, "missing", cfg.risk_overrides);
      gaps.push({
        entity_id: m.entity_id,
        name: m.name,
        gap: "missing",
        risk,
        monolith: { file: m.file, line: m.line, kind: m.kind, signature: m.signature, tags: m.tags },
        modular: null,
        notes: "Symbol present in monolith but not found in modular tree.",
      });
      continue;
    }
    const { match, score } = pickBestMatch(candidates, m);
    if (match) matchedModularIds.add(match.entity_id);
    const sameFamily = family(match.kind) === family(m.kind);
    const sameSig = normalizeSig(match.signature) === normalizeSig(m.signature);
    if (sameFamily && sameSig) {
      // perfect match — not a gap (still listed for audit trail under "matched")
      continue;
    }
    if (!sameFamily || !sameSig) {
      const risk = classifyGapRisk(m.tags.risk, "diverged", cfg.risk_overrides);
      gaps.push({
        entity_id: m.entity_id,
        name: m.name,
        gap: "diverged",
        risk,
        monolith: { file: m.file, line: m.line, kind: m.kind, signature: m.signature, tags: m.tags },
        modular:  { file: match.file, line: match.line, kind: match.kind, signature: match.signature, tags: match.tags },
        notes: sameFamily ? "Signature changed." : `Kind changed: ${m.kind} → ${match.kind}.`,
        match_score: score,
      });
    }
  }

  // Pass 2: every modular symbol not matched → new.
  for (const x of modSyms) {
    if (matchedModularIds.has(x.entity_id)) continue;
    // Skip if same name exists in monolith (it was already considered & matched a different occurrence)
    const monoCounterparts = monoIdx.get(x.name);
    if (monoCounterparts && monoCounterparts.length) continue;
    const risk = classifyGapRisk(x.tags.risk, "new", cfg.risk_overrides);
    gaps.push({
      entity_id: x.entity_id,
      name: x.name,
      gap: "new",
      risk,
      monolith: null,
      modular: { file: x.file, line: x.line, kind: x.kind, signature: x.signature, tags: x.tags },
      notes: "Symbol new in modular tree.",
    });
  }

  // Parity score: matched / total monolith exported symbols.
  const monoExported = monoSyms.filter((s) => s.exported);
  const monoExportedNames = new Set(monoExported.map((s) => s.name));
  const matchedMonoNames = new Set();
  for (const m of monoExported) {
    const cand = modIdx.get(m.name);
    if (!cand) continue;
    const { match } = pickBestMatch(cand, m);
    if (match && family(match.kind) === family(m.kind) && normalizeSig(match.signature) === normalizeSig(m.signature)) {
      matchedMonoNames.add(m.name);
    } else if (match) {
      // partial — count as half
      matchedMonoNames.add(m.name); // still partially preserved
    }
  }
  const parityScore = monoExported.length === 0 ? 1 : matchedMonoNames.size / monoExportedNames.size;

  // Aggregate counts
  const summary = {
    parity_score: Number(parityScore.toFixed(3)),
    counts: {
      monolith_exported: monoExported.length,
      modular_exported: modSyms.filter((s) => s.exported).length,
      missing: gaps.filter((g) => g.gap === "missing").length,
      diverged: gaps.filter((g) => g.gap === "diverged").length,
      new:    gaps.filter((g) => g.gap === "new").length,
    },
    by_risk: RISK_LEVELS.reduce((acc, r) => {
      acc[r] = gaps.filter((g) => g.risk === r).length;
      return acc;
    }, {}),
  };

  const outPath = path.join(cfg.out_dir, "parity-report.sij.json");
  writeSIJ(outPath, "parity-report", null, gaps, { summary, thresholds: cfg.thresholds });
  console.log(`[diff] ${gaps.length} gaps (parity=${summary.parity_score}) → ${outPath}`);
  console.log("  counts:", JSON.stringify(summary.counts));
  console.log("  by risk:", JSON.stringify(summary.by_risk));
}

if (require.main === module) main();
