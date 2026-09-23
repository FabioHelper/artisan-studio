#!/usr/bin/env node
// 11-ast-xray.cjs — Zero-Trust Semantic AST X-Ray.
//
// Additive layer on top of parity-cab's existing regex heuristics.
// Uses acorn (already in node_modules via dependency-cruiser) for real AST
// parsing. Extracts EVERY logic block (function bodies, loops, conditionals,
// math expressions, requestAnimationFrame callbacks) from both sides and
// computes structural hashes to prove logic preservation.
//
// This catches the class of bug that regex-based tools miss: logic living
// inside closures, render loops, and anonymous callbacks that have no exported
// symbol name to match on.
//
// Usage:
//   node 11-ast-xray.cjs --config parity.config.json
//
// Output: <out_dir>/ast-xray.sij.json
//
// Exit codes:
//   0 = PASS (all blocks mapped or warnings only)
//   1 = FAIL (critical unmapped blocks — reserved for future blocking mode)
//   Currently always exits 0 (warning-only mode).

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { writeSIJ, loadConfig, parseArgs } = require("./lib/sij.cjs");
const { preprocessSource } = require("./lib/parse.cjs");

// ─── Acorn loader ───────────────────────────────────────────────────────────
// acorn is available via dependency-cruiser's transitive deps. We resolve it
// from the project's node_modules (the cwd when running gate:xray).
let acorn;
try {
  acorn = require("acorn");
} catch (_) {
  // Fallback: try to resolve from the artifact-system root
  try {
    acorn = require(require.resolve("acorn", {
      paths: [process.cwd(), path.join(process.cwd(), "../..")]
    }));
  } catch (e2) {
    console.error("ERROR: acorn not found. Install it or run from a project with dependency-cruiser.");
    process.exit(2);
  }
}

const acornJsx = (() => {
  try { return require("acorn-jsx"); } catch (_) {
    try {
      return require(require.resolve("acorn-jsx", {
        paths: [process.cwd(), path.join(process.cwd(), "../..")]
      }));
    } catch (_2) { return null; }
  }
})();

// ─── Constants ──────────────────────────────────────────────────────────────
const SOURCE_EXT = /\.(ts|tsx|js|jsx|cjs|mjs)$/;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.git|coverage|\.parity|\.bridge|reference)(\/|$)/;
const SKIP_FILE = /\.(test|spec|d)\.(ts|tsx|js|jsx)$/;

// Block types we care about for semantic hashing
const LOGIC_NODE_TYPES = new Set([
  "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement",
  "DoWhileStatement", "IfStatement", "SwitchStatement", "TryStatement",
  "ClassDeclaration", "MethodDefinition",
]);

// Nodes that indicate "continuous frame logic" — the exact class of bug
// that triggered this tool's creation
const FRAME_LOOP_CALLERS = new Set([
  "requestAnimationFrame", "setInterval", "setTimeout",
]);

// ─── File discovery ─────────────────────────────────────────────────────────
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

// ─── TypeScript stripping (lightweight, no deps) ────────────────────────────
// We strip TS-specific syntax so acorn (which only parses JS/JSX) can handle
// the source. This is a pragmatic trade-off: we lose type annotations but
// preserve all logic blocks, which is exactly what we're hashing.
function stripTypeScript(source) {
  let s = source;
  // Remove type imports: import type { X } from '...'
  s = s.replace(/^\s*import\s+type\s+\{[^}]*\}\s*from\s*['"][^'"]*['"];?\s*$/gm, "");
  // Remove type-only exports: export type { X }
  s = s.replace(/^\s*export\s+type\s+\{[^}]*\};?\s*$/gm, "");
  // Remove interface declarations (multi-line)
  s = s.replace(/^\s*(?:export\s+)?interface\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[^{]+)?\s*\{[^}]*\}/gm, "");
  // Remove type alias declarations
  s = s.replace(/^\s*(?:export\s+)?type\s+[A-Za-z_$][\w$]*(?:<[^>]*>)?\s*=\s*[^;]+;/gm, "");
  // Remove 'as TYPE' casts (conservative — only simple ones)
  s = s.replace(/\s+as\s+[A-Za-z_$][\w$<>\[\]|&.]*(?:\s*&\s*\{[^}]*\})?/g, "");
  // Remove type annotations on parameters/variables: ': Type'
  // This is the trickiest part. We handle common patterns:
  //   (param: Type) → (param)
  //   const x: Type = → const x =
  //   ): ReturnType => → ) =>
  //   ): ReturnType { → ) {
  s = s.replace(/:\s*(?:typeof\s+)?[A-Za-z_$][\w$]*(?:<[^>]*>)?(?:\[\])?(?:\s*\|\s*(?:typeof\s+)?[A-Za-z_$][\w$]*(?:<[^>]*>)?(?:\[\])?)*(?=\s*[,)=;{\n])/g, "");
  // Remove generic type parameters on functions/classes: <T extends X>
  s = s.replace(/(?<=(?:function|class)\s+[A-Za-z_$][\w$]*)\s*<[^>]*>/g, "");
  // Remove 'declare' statements
  s = s.replace(/^\s*declare\s+.+$/gm, "");
  // Remove '!' non-null assertions
  s = s.replace(/!\./g, ".");
  s = s.replace(/!(?=\s*[;,)\]}])/g, "");
  // Remove 'import type' inline: import { type X, Y } → import { Y }
  s = s.replace(/,?\s*type\s+[A-Za-z_$][\w$]*/g, (m, offset) => {
    // Only inside import { ... }
    const before = s.lastIndexOf("import", offset);
    if (before >= 0 && offset - before < 200) return "";
    return m;
  });
  return s;
}

// ─── Safe parse ─────────────────────────────────────────────────────────────
function safeParse(source, filePath) {
  const stripped = stripTypeScript(source);
  const isJSX = /\.(jsx|tsx)$/.test(filePath) || /<[A-Z][\w.]*[\s/>]/.test(stripped);

  const opts = {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    allowReturnOutsideFunction: true,
    allowImportExportEverywhere: true,
    allowAwaitOutsideFunction: true,
    allowSuperOutsideMethod: true,
  };

  // Try with JSX first if applicable
  if (isJSX && acornJsx) {
    try {
      const Parser = acorn.Parser.extend(acornJsx());
      return Parser.parse(stripped, opts);
    } catch (_) { /* fall through */ }
  }

  // Try plain acorn
  try {
    return acorn.parse(stripped, opts);
  } catch (_) { /* fall through */ }

  // Last resort: acorn-loose if available
  try {
    const loose = require("acorn-loose");
    return loose.parse(stripped, opts);
  } catch (_) {
    try {
      const loose = require(require.resolve("acorn-loose", {
        paths: [process.cwd(), path.join(process.cwd(), "../..")]
      }));
      return loose.parse(stripped, opts);
    } catch (_2) { /* give up */ }
  }

  return null;
}

// ─── Semantic block extraction ──────────────────────────────────────────────
// Walk the AST and extract every "logic block" — a function, loop, conditional,
// class method, or frame-loop callback. For each block we record:
//   - its structural hash (shape of the AST, not variable names)
//   - its human-readable label
//   - its location
//   - whether it's a frame-loop callback

function structuralHash(node, source) {
  // We hash the STRUCTURE of the AST, not the variable names.
  // This means renamed variables don't break the match, but
  // changed logic (added/removed if-branches, changed math) does.
  const parts = [];

  function walk(n, depth) {
    if (!n || typeof n !== "object") return;
    if (depth > 30) return; // prevent infinite recursion

    if (n.type) {
      parts.push(n.type);

      // For operators, include the operator itself (it's logic, not naming)
      if (n.operator) parts.push(n.operator);

      // For member expressions, include property names (they're API calls)
      if (n.type === "MemberExpression" && n.property) {
        if (n.property.type === "Identifier") parts.push("." + n.property.name);
        else if (n.property.type === "Literal") parts.push("[" + n.property.value + "]");
      }

      // For call expressions, include callee name (it's an API call)
      if (n.type === "CallExpression" && n.callee) {
        if (n.callee.type === "Identifier") parts.push("call:" + n.callee.name);
        else if (n.callee.type === "MemberExpression" && n.callee.property) {
          if (n.callee.property.type === "Identifier") {
            parts.push("call:." + n.callee.property.name);
          }
        }
      }

      // For literals, include numeric values (math constants matter)
      if (n.type === "Literal" && typeof n.value === "number") {
        parts.push("num:" + n.value);
      }
    }

    // Recurse into children
    for (const key of Object.keys(n)) {
      if (key === "type" || key === "start" || key === "end" ||
          key === "loc" || key === "range" || key === "raw" ||
          key === "leadingComments" || key === "trailingComments") continue;
      const child = n[key];
      if (Array.isArray(child)) {
        for (const c of child) walk(c, depth + 1);
      } else if (child && typeof child === "object" && child.type) {
        walk(child, depth + 1);
      }
    }
  }

  walk(node, 0);
  const joined = parts.join("|");
  return crypto.createHash("sha256").update(joined).digest("hex").slice(0, 16);
}

// ─── Side-effect potential heuristics (RFC-011 P0.B3 — quick win) ──────────
// Tags blocks that contain THREE.js / Scene / Light / Material / Camera /
// Renderer setters. Output is informational only in P0 (severity unchanged).
// Full severity-bumping (block gate on critical) is P1.2 in RFC-011.
const SIDE_EFFECT_PATTERNS = [
  /\.\s*intensity\s*=/,                        // Light.intensity (the lighting regression)
  /\.\s*fov\s*=/,                              // Camera.fov
  /\.\s*opacity\s*=/,                          // Material.opacity
  /\.\s*emissiveIntensity\s*=/,                // PBR
  /\.\s*metalness\s*=/, /\.\s*roughness\s*=/,
  /\.\s*color\s*\.\s*set\(/,                   // color mutation
  /\.\s*position\s*\.\s*(set|copy)\(/,         // position mutation
  /\.\s*quaternion\s*\.\s*(set|copy)\(/,
  /\.\s*setSize\(/,                            // renderer.setSize
  /\.\s*setPixelRatio\(/,
  /\.\s*toneMapping\s*=/,
  /\.\s*outputColorSpace\s*=/,
  /\bscene\s*\.\s*(fog|background)\s*=/,
  /\bapplyLights\s*\(/, /\bapplyGlow\s*\(/, /\bapplyQuality\s*\(/,
  /\.\s*updateProjectionMatrix\s*\(/,
  /\bnew\s+THREE\.(AmbientLight|DirectionalLight|PointLight|SpotLight|HemisphereLight)/,
];

function detectSideEffectPotential(blockSource) {
  if (!blockSource || typeof blockSource !== "string") return "none";
  for (const pat of SIDE_EFFECT_PATTERNS) {
    if (pat.test(blockSource)) return "high";
  }
  // React useEffect with body = medium signal
  if (/\buseEffect\s*\(/.test(blockSource)) return "med";
  return "none";
}

// ─── RFC-011 §3.4 — Extraction defect detection ─────────────────────────────
// FILE-LEVEL scanners (run on ORIGINAL TypeScript source — pre-strip).
// These catch CLASSES of bug that AST X-Ray block matching can't see because
// the labels match exactly between monolith and modular but the body lost
// a critical line during extraction.
//
// Class A — Silenced null assertion: `return foo!` where `foo` was never
//           assigned anywhere in the enclosing function body. TS `!` non-null
//           assertion silences the compile error, but runtime returns null.
//           First seen 2026-05-28 in src/gfx/glow.ts::getGlowTex — modular
//           dropped monolith's `_glowTex = new THREE.CanvasTexture(c)` line.
//           Caller atmosphere.ts:72 got `map: null` for cauldron steam wisps.
//           Pure regex (TS source) — does not require AST since stripTypeScript
//           removes `!` before acorn parsing.
//
// Class B — Clock call ordering: `getElapsedTime()` called BEFORE `getDelta()`
//           in the same function body. THREE.Clock.getElapsedTime() invokes
//           getDelta() internally and updates oldTime, so a subsequent
//           getDelta() returns ~0. Silently breaks all dt-dependent animations.
//           First seen 2026-05-27 in viewport.ts (P0.B2 fix swapped the order).
//           Monolith megazord_v12_8.jsx.bak:2510 has dt FIRST then t SECOND.

/**
 * Find function bodies in the given source and check each for `return X!`
 * where X is never assigned within the body. Returns array of defect records.
 */
function detectExtractionDefects(source, relPath) {
  const defects = [];
  if (!source || typeof source !== "string") return defects;

  // Match `return <identifier>!` followed by terminator (;, newline, }, or close brace)
  const returnNonNullPattern = /\breturn\s+([a-zA-Z_$][\w$]*)\s*!\s*(?:;|\r?\n|\})/g;
  let m;
  while ((m = returnNonNullPattern.exec(source)) !== null) {
    const ident = m[1];
    const matchIdx = m.index;

    // Find the enclosing function body. Scan backward for an unmatched `{`
    // (depth tracking, ignoring `{`/`}` inside strings — simple heuristic).
    const bodyStart = findEnclosingFunctionBodyStart(source, matchIdx);
    if (bodyStart < 0) continue;

    // Find the matching close `}` after matchIdx
    const bodyEnd = findMatchingClose(source, bodyStart);
    if (bodyEnd < 0) continue;

    const body = source.slice(bodyStart, bodyEnd);

    // Is the identifier assigned anywhere in the body? Look for `ident =` or
    // `ident +=` etc., but NOT `ident ==` or `ident ===`. Also exclude
    // declarations (`let ident = ...` or `const ident = ...`) since the
    // initializer doesn't count if it's null/undefined.
    const assignPattern = new RegExp(
      `(?<![=!<>])\\b${escapeRegex(ident)}\\s*=(?!=)`,
      "g"
    );
    let assignMatch;
    let realAssignmentFound = false;
    while ((assignMatch = assignPattern.exec(body)) !== null) {
      // Check the assignment is NOT a let/const declaration with a falsy literal
      const before = body.slice(Math.max(0, assignMatch.index - 30), assignMatch.index);
      const isLetConstNull = /\b(?:let|const|var)\s*$/.test(before);
      if (isLetConstNull) {
        // Check the RHS — if it's literally `null` or `undefined`, it doesn't count
        const afterEq = body.slice(assignMatch.index + assignMatch[0].length).trim();
        if (/^(null|undefined)\s*[;,]/.test(afterEq)) continue;
      }
      realAssignmentFound = true;
      break;
    }

    if (!realAssignmentFound) {
      const lineNum = source.slice(0, matchIdx).split(/\r?\n/).length;
      defects.push({
        file: relPath,
        line: lineNum,
        identifier: ident,
        kind: "silenced_null_assertion",
        severity: "high",
        snippet: source.slice(matchIdx, matchIdx + 80).replace(/\r?\n.*$/s, ""),
        explanation:
          `\`return ${ident}!\` at L${lineNum} — \`${ident}\` is never assigned ` +
          `within the enclosing function body. TS \`!\` assertion silences compile ` +
          `but runtime returns null/undefined.`,
        rfc_reference: "RFC-011 §3.4 — AST X-Ray hardening (extraction defect class A)",
        first_seen: "2026-05-28 src/gfx/glow.ts::getGlowTex",
      });
    }
  }

  return defects;
}

/**
 * Find functions where `getElapsedTime()` is called before `getDelta()` on the
 * same identifier. Returns array of warning records.
 */
function detectClockCallOrdering(source, relPath) {
  const warnings = [];
  if (!source || typeof source !== "string") return warnings;

  // Find all function bodies (any kind). Iterate and check each one.
  // Conservative: scan for `<id>.getElapsedTime()` then check if same function
  // also has `<id>.getDelta()`, and if so verify the ORDER.
  const elapsedPattern = /\b([a-zA-Z_$][\w$]*)\s*\.\s*getElapsedTime\s*\(\s*\)/g;
  let m;
  const seen = new Set();
  while ((m = elapsedPattern.exec(source)) !== null) {
    const clockId = m[1];
    const elapsedIdx = m.index;

    const bodyStart = findEnclosingFunctionBodyStart(source, elapsedIdx);
    if (bodyStart < 0) continue;
    const bodyEnd = findMatchingClose(source, bodyStart);
    if (bodyEnd < 0) continue;
    const body = source.slice(bodyStart, bodyEnd);

    // Find getDelta() on the same id in this body
    const deltaPattern = new RegExp(`\\b${escapeRegex(clockId)}\\s*\\.\\s*getDelta\\s*\\(\\s*\\)`, "g");
    const deltaMatch = deltaPattern.exec(body);
    if (!deltaMatch) continue;

    const elapsedIdxInBody = elapsedIdx - bodyStart;
    const deltaIdxInBody = deltaMatch.index;

    // If getElapsedTime comes BEFORE getDelta in the body, that's the bug.
    if (elapsedIdxInBody < deltaIdxInBody) {
      const key = `${relPath}:${elapsedIdx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lineNum = source.slice(0, elapsedIdx).split(/\r?\n/).length;
      warnings.push({
        file: relPath,
        line: lineNum,
        clock_identifier: clockId,
        kind: "clock_call_ordering",
        severity: "high",
        explanation:
          `\`${clockId}.getElapsedTime()\` at L${lineNum} called BEFORE ` +
          `\`${clockId}.getDelta()\` in the same function body. ` +
          `THREE.Clock.getElapsedTime() internally calls getDelta() and updates ` +
          `oldTime — the subsequent getDelta() returns ~0. Silently breaks all ` +
          `dt-dependent animations (entity motion, FSM ticks, sin/cos accumulators).`,
        rfc_reference: "RFC-011 §3.4 — AST X-Ray hardening (extraction defect class B)",
        first_seen: "2026-05-27 src/scene/viewport.ts L286-294 (P0.B2 fix)",
        canonical_order: "dt = clock.getDelta(); t = clock.getElapsedTime(); (matches monolith :2510)",
      });
    }
  }

  return warnings;
}

// ─── Helpers for the file-level detectors ───────────────────────────────────
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scan backward from `idx` to find the `{` that opens the enclosing function
 * body. Returns the index of the character AFTER `{`, or -1 if not found.
 * Skips `{`/`}` inside strings and line comments (simple heuristic).
 */
function findEnclosingFunctionBodyStart(source, idx) {
  let depth = 1;
  let i = idx - 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let stringChar = "";
  while (i >= 0) {
    const ch = source[i];
    const next = source[i + 1];
    // Skip string/comment tracking when scanning backward — best effort.
    // For pragmatic purposes, just count braces.
    if (!inString) {
      if (ch === "}") depth++;
      else if (ch === "{") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    i--;
  }
  return -1;
}

/**
 * From `bodyStart` (just after `{`), find the matching `}`.
 */
function findMatchingClose(source, bodyStart) {
  let depth = 1;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractBlocks(ast, source, filePath, root) {
  const blocks = [];
  const rel = path.relative(root, filePath).replace(/\\/g, "/");

  function getLine(node) {
    return node.loc ? node.loc.start.line : 0;
  }

  function getEndLine(node) {
    return node.loc ? node.loc.end.line : 0;
  }

  function labelFor(node, parent) {
    if (node.type === "FunctionDeclaration" && node.id) {
      return node.id.name;
    }
    if (node.type === "MethodDefinition" && node.key) {
      const className = parent && parent.id ? parent.id.name + "." : "";
      return className + (node.key.name || node.key.value || "<computed>");
    }
    // H3: name a class by its identifier (NOT line) so `class Foo` ≡ `export class Foo`
    // match by label across the split — the `export` wrapper is the parent and never
    // reaches structuralHash, so the real cause of false drops was the anonymous,
    // line-dependent label below. A name-matched class whose body diverged (e.g. methods
    // extracted to other modules) is then correctly classed "diverged", not "dropped+new".
    if ((node.type === "ClassDeclaration" || node.type === "ClassExpression") && node.id) {
      return node.id.name;
    }
    // Arrow/function expression assigned to a variable
    if (parent && parent.type === "VariableDeclarator" && parent.id) {
      return parent.id.name || "<anon>";
    }
    // Property value
    if (parent && parent.type === "Property" && parent.key) {
      return parent.key.name || parent.key.value || "<prop>";
    }
    return "<anonymous:" + getLine(node) + ">";
  }

  function isFrameLoopCallback(node, parent) {
    if (!parent) return false;
    if (parent.type === "CallExpression" && parent.callee) {
      const callee = parent.callee;
      if (callee.type === "Identifier" && FRAME_LOOP_CALLERS.has(callee.name)) return true;
      if (callee.type === "MemberExpression" && callee.property &&
          callee.property.type === "Identifier" && FRAME_LOOP_CALLERS.has(callee.property.name)) return true;
    }
    return false;
  }

  function walkNode(node, parent, grandparent) {
    if (!node || typeof node !== "object") return;

    if (LOGIC_NODE_TYPES.has(node.type)) {
      const loc = getEndLine(node) - getLine(node);
      // Only include blocks with meaningful logic (>= 3 lines)
      if (loc >= 3) {
        const label = labelFor(node, parent);
        const hash = structuralHash(node, source);
        const isFrameLoop = isFrameLoopCallback(node, parent);
        const bodyNode = node.body || node.consequent || node.block || node;
        const bodyLoc = bodyNode ? (getEndLine(bodyNode) - getLine(bodyNode)) : loc;

        const blockSource = source.slice(node.start, node.end);
        const sideEffectPotential = detectSideEffectPotential(blockSource);
        blocks.push({
          entity_id: `${rel}::${label}::L${getLine(node)}`,
          file: rel,
          label,
          type: node.type,
          line: getLine(node),
          end_line: getEndLine(node),
          loc: loc,
          body_loc: bodyLoc,
          hash,
          is_frame_loop: isFrameLoop,
          // Complexity estimate: count nested logic nodes
          complexity: countNested(node),
          // RFC-011 P0.B3: side-effect potential (informational tag in P0;
          // P1.2 will use it to bump severity + block gate on `high` new_blocks).
          side_effect_potential: sideEffectPotential,
        });
      }
    }

    // Recurse
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" ||
          key === "loc" || key === "range") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === "object" && c.type) {
            walkNode(c, node, parent);
          }
        }
      } else if (child && typeof child === "object" && child.type) {
        walkNode(child, node, parent);
      }
    }
  }

  function countNested(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 20) return 0;
    let count = 0;
    if (LOGIC_NODE_TYPES.has(node.type) && depth > 0) count++;
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" ||
          key === "loc" || key === "range") continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) count += countNested(c, depth + 1);
      } else if (child && typeof child === "object" && child.type) {
        count += countNested(child, depth + 1);
      }
    }
    return count;
  }

  walkNode(ast, null, null);
  return blocks;
}

// ─── Block matching ─────────────────────────────────────────────────────────
// Match monolith blocks to modular blocks using a tiered strategy:
//   1. Exact hash match (strongest proof — identical logic structure)
//   2. Label match + high hash similarity (renamed but same logic)
//   3. Unmatched → orphan (logic dropped or significantly mutated)

function matchBlocks(monoBlocks, modBlocks) {
  const results = [];
  const usedMod = new Set();

  // Build index of modular blocks by hash and by label
  const modByHash = new Map();
  const modByLabel = new Map();
  for (let i = 0; i < modBlocks.length; i++) {
    const b = modBlocks[i];
    if (!modByHash.has(b.hash)) modByHash.set(b.hash, []);
    modByHash.get(b.hash).push(i);

    const normLabel = b.label.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!modByLabel.has(normLabel)) modByLabel.set(normLabel, []);
    modByLabel.get(normLabel).push(i);
  }

  for (const mono of monoBlocks) {
    // Tier 1: exact hash match
    const hashCandidates = modByHash.get(mono.hash) || [];
    const exactMatch = hashCandidates.find(i => !usedMod.has(i));
    if (exactMatch !== undefined) {
      usedMod.add(exactMatch);
      results.push({
        monolith: mono,
        modular: modBlocks[exactMatch],
        match_type: "exact_hash",
        confidence: 1.0,
        status: "preserved",
      });
      continue;
    }

    // Tier 2: label match
    const normLabel = mono.label.toLowerCase().replace(/[^a-z0-9]/g, "");
    const labelCandidates = modByLabel.get(normLabel) || [];
    const labelMatch = labelCandidates.find(i => !usedMod.has(i));
    if (labelMatch !== undefined) {
      const mod = modBlocks[labelMatch];
      // Compute similarity: how many hash chars match
      let same = 0;
      for (let i = 0; i < Math.min(mono.hash.length, mod.hash.length); i++) {
        if (mono.hash[i] === mod.hash[i]) same++;
      }
      const similarity = same / 16;
      usedMod.add(labelMatch);
      results.push({
        monolith: mono,
        modular: mod,
        match_type: similarity > 0.5 ? "label_similar" : "label_diverged",
        confidence: similarity,
        status: similarity > 0.3 ? "mutated" : "diverged",
      });
      continue;
    }

    // Tier 3: unmatched — logic was dropped
    results.push({
      monolith: mono,
      modular: null,
      match_type: "none",
      confidence: 0,
      status: "dropped",
    });
  }

  // Also flag new blocks in modular that don't exist in monolith
  for (let i = 0; i < modBlocks.length; i++) {
    if (!usedMod.has(i)) {
      results.push({
        monolith: null,
        modular: modBlocks[i],
        match_type: "new",
        confidence: 0,
        status: "new",
      });
    }
  }

  return results;
}

// ─── Severity classification ────────────────────────────────────────────────
function classifySeverity(result) {
  if (result.status === "preserved" || result.status === "new") return "info";
  if (result.status === "mutated" && result.confidence > 0.5) return "low";
  if (result.status === "mutated") return "med";
  // Dropped blocks:
  const mono = result.monolith;
  if (!mono) return "info";
  if (mono.is_frame_loop) return "critical"; // Frame loop logic dropped = the exact Megazord bug
  if (mono.loc >= 40) return "high";
  if (mono.loc >= 15) return "med";
  if (mono.complexity >= 5) return "med";
  return "low";
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

  console.log("[ast-xray] parsing monolith...");
  // H1/H2: single-file monoliths may be HTML-embedded JS and/or indented.
  // Extract inline <script> bodies (when .html/.htm) and dedent before parsing.
  // Line count is preserved so block line numbers map to the original file.
  const monoSource = preprocessSource(
    fs.readFileSync(monolithPath, "utf8"),
    monolithPath,
    (cfg.monolith && cfg.monolith.kind) || "single-file"
  );
  const monoAst = safeParse(monoSource, monolithPath);
  if (!monoAst) {
    console.error("ERROR: failed to parse monolith " + monolithPath);
    console.log("[ast-xray] SKIP — parse failure (non-blocking)");
    process.exit(0);
  }
  const monoBlocks = extractBlocks(monoAst, monoSource, monolithPath, path.dirname(monolithPath));
  console.log(`[ast-xray] monolith: ${monoBlocks.length} logic blocks extracted`);

  console.log("[ast-xray] parsing modular tree...");
  const modFiles = walkDir(modularRoot);
  const modBlocks = [];
  let parseFailures = 0;
  // RFC-011 §3.4 — file-level extraction-defect scanners (run on ORIGINAL TS
  // source, BEFORE stripTypeScript, so we can see `!` non-null assertions).
  const extractionDefects = [];
  const clockOrderingWarnings = [];
  for (const f of modFiles) {
    try {
      const src = fs.readFileSync(f, "utf8");
      const relPath = path.relative(modularRoot, f).replace(/\\/g, "/");
      // Run the file-level scanners FIRST (on original source).
      extractionDefects.push(...detectExtractionDefects(src, relPath));
      clockOrderingWarnings.push(...detectClockCallOrdering(src, relPath));
      // Then parse for block-level analysis.
      const ast = safeParse(src, f);
      if (!ast) { parseFailures++; continue; }
      modBlocks.push(...extractBlocks(ast, src, f, modularRoot));
    } catch (err) {
      parseFailures++;
    }
  }
  console.log(`[ast-xray] modular: ${modBlocks.length} logic blocks from ${modFiles.length} files (${parseFailures} parse failures)`);
  if (extractionDefects.length > 0) {
    console.log(`[ast-xray] ⚠ ${extractionDefects.length} extraction defect(s) detected (class A: silenced_null_assertion)`);
  }
  if (clockOrderingWarnings.length > 0) {
    console.log(`[ast-xray] ⚠ ${clockOrderingWarnings.length} clock call ordering warning(s) detected (class B: getElapsedTime before getDelta)`);
  }

  // Match blocks
  console.log("[ast-xray] matching blocks...");
  const results = matchBlocks(monoBlocks, modBlocks);

  // Classify severity
  for (const r of results) {
    r.severity = classifySeverity(r);
  }

  // Build entities for SIJ output
  const entities = results.map((r, i) => ({
    entity_id: r.monolith
      ? r.monolith.entity_id
      : r.modular.entity_id,
    ord: i,
    status: r.status,
    match_type: r.match_type,
    confidence: r.confidence,
    severity: r.severity,
    monolith: r.monolith ? {
      file: r.monolith.file,
      label: r.monolith.label,
      type: r.monolith.type,
      line: r.monolith.line,
      end_line: r.monolith.end_line,
      loc: r.monolith.loc,
      hash: r.monolith.hash,
      is_frame_loop: r.monolith.is_frame_loop,
      complexity: r.monolith.complexity,
    } : null,
    modular: r.modular ? {
      file: r.modular.file,
      label: r.modular.label,
      type: r.modular.type,
      line: r.modular.line,
      end_line: r.modular.end_line,
      loc: r.modular.loc,
      hash: r.modular.hash,
      is_frame_loop: r.modular.is_frame_loop,
      complexity: r.modular.complexity,
      // RFC-011 P0.B3: side-effect potential tag (informational in P0)
      side_effect_potential: r.modular.side_effect_potential || "none",
    } : null,
  }));

  // Summary statistics
  const preserved = results.filter(r => r.status === "preserved").length;
  const mutated = results.filter(r => r.status === "mutated").length;
  const diverged = results.filter(r => r.status === "diverged").length;
  const dropped = results.filter(r => r.status === "dropped").length;
  const newBlocks = results.filter(r => r.status === "new").length;
  const frameLoopDropped = results.filter(r =>
    r.status === "dropped" && r.monolith && r.monolith.is_frame_loop
  ).length;

  const bySeverity = {};
  for (const r of results) {
    bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
  }

  const preservationScore = monoBlocks.length === 0
    ? 1
    : (preserved + mutated * 0.5) / monoBlocks.length;

  const summary = {
    monolith_blocks: monoBlocks.length,
    modular_blocks: modBlocks.length,
    modular_files: modFiles.length,
    modular_parse_failures: parseFailures,
    preserved,
    mutated,
    diverged,
    dropped,
    new_blocks: newBlocks,
    frame_loop_dropped: frameLoopDropped,
    preservation_score: Number(preservationScore.toFixed(3)),
    by_severity: bySeverity,
    // RFC-011 §3.4 — extraction defect classes (file-level detectors)
    extraction_defects_count: extractionDefects.length,
    clock_call_ordering_warnings_count: clockOrderingWarnings.length,
  };

  const outPath = path.join(cfg.out_dir, "ast-xray.sij.json");
  const sijData = writeSIJ(outPath, "ast-xray", null, entities, {
    summary,
    extraction_defects: extractionDefects,
    clock_call_ordering_warnings: clockOrderingWarnings,
  });

  // Also copy to .parity-traces/<project>/ so the artifact-system server
  // can serve it via GET /api/parity-trace/xray?project=<id>
  if (cfg.artifact_system_sink) {
    try {
      const sinkUrl = new URL(cfg.artifact_system_sink);
      // Derive parity-traces dir from the sink URL's base
      // E.g., http://localhost:4201/api/parity-trace → <artifact-system-root>/.parity-traces/<project>/
      const projectId = cfg.project || "default";
      // Try to find the artifact-system root by walking up from cwd
      // The .parity-traces dir is at the artifact-system root level
      let asRoot = process.cwd();
      // Walk up to find artifact-system root (look for package.json with name "artifact-system")
      for (let i = 0; i < 5; i++) {
        const candidate = path.join(asRoot, ".parity-traces");
        const pkgPath = path.join(asRoot, "package.json");
        if (fs.existsSync(candidate) || (fs.existsSync(pkgPath) && JSON.parse(fs.readFileSync(pkgPath, "utf8")).name === "artifact-system")) {
          const destDir = path.join(candidate, projectId);
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          const destFile = path.join(destDir, "ast-xray.sij.json");
          fs.writeFileSync(destFile, JSON.stringify(sijData, null, 2), "utf8");
          console.log(`[ast-xray] synced → ${destFile}`);
          break;
        }
        asRoot = path.dirname(asRoot);
      }
    } catch (err) {
      console.log(`[ast-xray] warn: failed to sync to .parity-traces: ${err.message}`);
    }
  }

  // Console report
  console.log("");
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│  AST X-Ray — Semantic Block Preservation Report            │");
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log(`│  Monolith blocks:      ${String(monoBlocks.length).padStart(5)}`);
  console.log(`│  Modular blocks:       ${String(modBlocks.length).padStart(5)}`);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log(`│  ✓ Preserved (exact):  ${String(preserved).padStart(5)}  (identical logic structure)`);
  console.log(`│  ~ Mutated:            ${String(mutated).padStart(5)}  (same name, changed logic)`);
  console.log(`│  ≠ Diverged:           ${String(diverged).padStart(5)}  (same name, different structure)`);
  console.log(`│  ✗ Dropped:            ${String(dropped).padStart(5)}  (monolith logic not in modular)`);
  console.log(`│  + New:                ${String(newBlocks).padStart(5)}  (modular-only additions)`);
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log(`│  Preservation score:   ${(preservationScore * 100).toFixed(1)}%`);
  if (frameLoopDropped > 0) {
    console.log(`│  ⚠ FRAME LOOP DROPPED: ${frameLoopDropped}  ← CRITICAL (render loop logic lost)`);
  }
  console.log("├─────────────────────────────────────────────────────────────┤");
  console.log(`│  By severity: ${JSON.stringify(bySeverity)}`);
  console.log(`│  Output: ${outPath}`);
  console.log("└─────────────────────────────────────────────────────────────┘");

  // List dropped blocks (HIGH+ only)
  const criticalDropped = results.filter(r =>
    r.status === "dropped" && (r.severity === "critical" || r.severity === "high")
  );
  if (criticalDropped.length > 0) {
    console.log("");
    console.log("  Dropped blocks (HIGH+):");
    for (const r of criticalDropped.slice(0, 20)) {
      const m = r.monolith;
      const flag = m.is_frame_loop ? " ← FRAME LOOP" : "";
      console.log(`    ${r.severity.toUpperCase()} · ${m.type} · ${m.label} (${m.file}:L${m.line}-${m.end_line}, ${m.loc} LOC)${flag}`);
    }
  }

  // RFC-011 §3.4 — surface extraction defects (warning-only in P1; will gate in P2)
  if (extractionDefects.length > 0) {
    console.log("");
    console.log("  ⚠ Extraction defects (class A — silenced_null_assertion):");
    for (const d of extractionDefects.slice(0, 10)) {
      console.log(`    ${d.severity.toUpperCase()} · ${d.file}:L${d.line} · return ${d.identifier}!  (${d.identifier} never assigned in body)`);
    }
  }
  if (clockOrderingWarnings.length > 0) {
    console.log("");
    console.log("  ⚠ Clock call ordering (class B — getElapsedTime before getDelta):");
    for (const w of clockOrderingWarnings.slice(0, 10)) {
      console.log(`    ${w.severity.toUpperCase()} · ${w.file}:L${w.line} · ${w.clock_identifier}.getElapsedTime() before ${w.clock_identifier}.getDelta()`);
    }
  }

  // ── C1 (MASTER-PLAN curation) — high side-effect new_blocks ────────────────
  // RFC-011 P0.B3 computed `side_effect_potential` on every new modular block but
  // never gated on it. The 2026-05-27 `applyLights(DEFAULTS)` ambient-drift
  // regression was a `new` block with side_effect_potential="high" that exited
  // PASS and was only caught downstream by pixel-diff. Per Disposition Policy
  // v1.1, a new modular block that mutates shared runtime state is
  // regression_to_fix BY DEFAULT — so an UN-DISPOSITIONED high one must block.
  //
  // Disposition-aware (mirrors 10-coverage-gate): a block is exempt if its
  // entity_id (or label) appears in the dispositions file. Load order:
  //   1) --dispositions <path>  2) <out_dir>/ast-xray.dispositions.json
  // Shape: { "dispositioned": ["entity_id_or_label", ...] } (zero-trust: only an
  // explicit human/RFC sign-off removes a block from the blocking set).
  let dispositioned = new Set();
  const dispPath = args.dispositions || path.join(cfg.out_dir, "ast-xray.dispositions.json");
  if (fs.existsSync(dispPath)) {
    try {
      const dj = JSON.parse(fs.readFileSync(dispPath, "utf8"));
      dispositioned = new Set(dj.dispositioned || []);
    } catch (e) {
      console.log(`[ast-xray] warn: could not parse dispositions ${dispPath}: ${e.message}`);
    }
  }
  // NOTE: raw `results` (from matchBlocks) carry entity_id on r.modular/r.monolith,
  // NOT at top level (the top-level entity_id only exists in the mapped SIJ output).
  // These are `new` blocks → modular side always present.
  const highSideEffectNew = results.filter(
    (r) =>
      r.status === "new" &&
      r.modular &&
      r.modular.side_effect_potential === "high" &&
      !dispositioned.has(r.modular.entity_id) &&
      !dispositioned.has(r.modular.label)
  );
  if (highSideEffectNew.length > 0) {
    console.log("");
    console.log("  ⚠ High side-effect new_blocks (modular mutates shared state; un-dispositioned):");
    for (const r of highSideEffectNew.slice(0, 15)) {
      const m = r.modular;
      console.log(`    HIGH · ${m.type} · ${m.label} (${m.file}:L${m.line}-${m.end_line}) — regression_to_fix by default (Disposition Policy v1.1)`);
    }
    if (highSideEffectNew.length > 15) console.log(`    … +${highSideEffectNew.length - 15} more`);
  }

  // ── Gate decision ──────────────────────────────────────────────────────────
  // Default = warning-only (back-compat; exit 0). `--strict` promotes to a HARD
  // gate: any blocking class → exit 1. Megazord opts in via its gate:xray script.
  const blocking = {
    frame_loop_dropped: criticalDropped.filter((r) => r.monolith && r.monolith.is_frame_loop).length,
    extraction_defects: extractionDefects.length,
    clock_ordering: clockOrderingWarnings.length,
    high_side_effect_new: highSideEffectNew.length,
  };
  const blockingTotal = Object.values(blocking).reduce((a, b) => a + b, 0);
  const pass = criticalDropped.length === 0 && extractionDefects.length === 0 && clockOrderingWarnings.length === 0 && highSideEffectNew.length === 0;

  console.log("");
  console.log(`[ast-xray] ${pass ? "PASS" : "WARN"} — ${criticalDropped.length} dropped HIGH+, ${extractionDefects.length} extraction defects, ${clockOrderingWarnings.length} clock ordering, ${highSideEffectNew.length} high-side-effect new_blocks`);

  if (args.strict) {
    if (blockingTotal > 0) {
      console.log(`[ast-xray] STRICT gate: FAIL — blocking=${JSON.stringify(blocking)} (frame-loop drops + extraction defects + clock ordering + un-dispositioned high side-effect new_blocks all block). Disposition via ${path.basename(dispPath)} to sign off.`);
      process.exit(1);
    }
    console.log("[ast-xray] STRICT gate: PASS — no blocking findings.");
  }
}

if (require.main === module) main();
