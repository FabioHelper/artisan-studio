// parse.cjs — Lightweight top-level symbol extractor for .ts/.tsx/.js/.jsx.
// Zero deps. Optional upgrade to @babel/parser if found in node_modules.
//
// Output contract: extractSymbols(source, filePath) → { symbols: [...], imports: [...] }
//   symbol: { name, kind, exported, signature, line, jsdoc }
//   import: { from, names: string[], default: string|null, namespace: string|null }
//
// Kinds: "function" | "component" | "class" | "const" | "type" | "interface" | "enum" | "default"
// "component" is heuristic: PascalCase + returns JSX-ish (regex-detected).

"use strict";

const PAT = {
  // export function NAME(  /  export async function NAME(
  exportFn:  /^[\t ]*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*([(<])/gm,
  // export const NAME =  (could be arrow fn or value)
  exportConst: /^[\t ]*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/gm,
  // export class NAME
  exportClass: /^[\t ]*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
  // export interface NAME / export type NAME
  exportType: /^[\t ]*export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm,
  // export enum NAME
  exportEnum: /^[\t ]*export\s+(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/gm,
  // export default <fn|class|expr>
  exportDefault: /^[\t ]*export\s+default\s+(?:function\s+([A-Za-z_$][\w$]*)?|class\s+([A-Za-z_$][\w$]*)?|([A-Za-z_$][\w$]*))/gm,
  // export { A, B as C, ... }
  exportNamed: /^[\t ]*export\s*\{([^}]+)\}/gm,
  // Top-level (not exported) — STRICT: column 0 only (no leading whitespace).
  // Otherwise we'd catch every `const x = ...` inside function bodies.
  topLevelFn:    /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*([(<])/gm,
  topLevelConst: /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/gm,
  topLevelClass: /^(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
  // Imports
  importDefault: /^[\t ]*import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{([^}]+)\})?\s*from\s*['"]([^'"]+)['"]/gm,
  importNamed:   /^[\t ]*import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gm,
  importStar:    /^[\t ]*import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/gm,
  importSide:    /^[\t ]*import\s*['"]([^'"]+)['"]/gm,
  // JSDoc: capture the comment immediately above a symbol
  jsdocBlock:    /\/\*\*([\s\S]*?)\*\//g,
};

function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

// Slice signature: from the matched header up to the first `{` or end of declaration.
function captureSignature(source, startOffset, maxChars = 320) {
  const slice = source.slice(startOffset, startOffset + maxChars);
  // Stop at `{` (function body / interface body / class body / type literal start)
  // OR at `;` (type alias, const init that ends without body) OR newline run.
  let end = slice.length;
  let depth = 0;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    if (c === "(" || c === "<" || c === "[") depth++;
    else if (c === ")" || c === ">" || c === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === "{" || c === "=" && slice[i+1] === ">" || c === ";")) {
      // For arrow functions, include "=>" but stop at the body brace
      if (c === "=" && slice[i+1] === ">") {
        // Find next "{" or end of line
        const rest = slice.slice(i + 2);
        const brace = rest.indexOf("{");
        const nl = rest.indexOf("\n");
        end = i + 2 + (brace !== -1 && (nl === -1 || brace < nl) ? brace : (nl !== -1 ? nl : rest.length));
      } else {
        end = i;
      }
      break;
    }
  }
  return slice.slice(0, end).trim().replace(/\s+/g, " ");
}

// Look for a JSDoc block ending immediately before `line`.
function findJsdocBefore(source, line) {
  // Walk backward by lines from `line-1` until we either hit `*/` or non-blank/non-comment.
  const lines = source.split("\n");
  let i = line - 2; // line is 1-indexed; we want the line above
  // Skip blank/whitespace-only lines
  while (i >= 0 && /^\s*$/.test(lines[i])) i--;
  if (i < 0) return null;
  if (!/\*\/\s*$/.test(lines[i])) return null;
  // Walk up to find /**
  let start = i;
  while (start >= 0 && !/\/\*\*/.test(lines[start])) start--;
  if (start < 0) return null;
  const block = lines.slice(start, i + 1).join("\n");
  // Extract @stability tag and first description line
  const stability = (block.match(/@stability\s+([A-Z]+)/) || [, null])[1];
  const desc = (block.match(/\*\s+(?!@)([^\n]+)/) || [, ""])[1].trim();
  return { stability, description: desc };
}

// Heuristic: PascalCase symbol whose source body within 600 chars contains `<` followed by capital
// or a JSX-like return is likely a React component.
function looksLikeComponent(name, source, offset) {
  if (!/^[A-Z]/.test(name)) return false;
  const window = source.slice(offset, offset + 1200);
  return /return\s*\(/m.test(window) && /<[A-Z][\w.]*[\s/>]/.test(window);
}

// ─── HTML-embedded JS extraction (H1) ───────────────────────────────────────
// HTML monoliths (Three.js/game single-file apps) embed their JS in inline
// <script> tags. Running the symbol regexes against raw HTML yields 0 symbols.
//
// extractJsFromHtml(source) → string
//   Returns a string the SAME LENGTH IN LINES as `source`, where every line
//   that is NOT inside an inline <script> body is BLANKED (replaced with an
//   empty line). Only inline-script bodies are kept, IN PLACE — so a symbol's
//   reported `line` still maps to the original .html line number.
//
//   - Skips <script src=...> (external/CDN — no inline body to extract).
//   - Skips non-JS types (application/json, importmap, etc.). Keeps
//     type="module", type="text/javascript", and bare <script>.
//   - Does NOT concatenate bodies (that would destroy line mapping).
function extractJsFromHtml(source) {
  // Build the output as an array of characters initialized to the source, then
  // blank out everything that is not inside a kept <script> body. Working at
  // char level (preserving \n) keeps the byte/line offsets identical so lineOf
  // stays correct.
  const out = source.split("");

  // Blank a [start, end) char range, preserving newlines (so line count holds).
  function blank(start, end) {
    for (let i = start; i < end && i < out.length; i++) {
      if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
    }
  }

  // Match each <script ...> ... </script> (case-insensitive, body non-greedy).
  // The opening tag is captured separately so we can inspect its attributes.
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let lastIndex = 0;
  let m;
  while ((m = scriptRe.exec(source)) !== null) {
    const fullStart = m.index;
    const attrs = m[1] || "";
    const body = m[2] || "";
    const fullEnd = scriptRe.lastIndex;

    // Body char range within `source`.
    const bodyStart = fullStart + m[0].indexOf(body, attrs.length);
    const bodyEnd = bodyStart + body.length;

    // Blank everything between the previous kept region and this script's body.
    blank(lastIndex, bodyStart);

    // Decide whether to KEEP this script's body.
    const hasSrc = /\bsrc\s*=/i.test(attrs);
    const typeMatch = attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const type = (typeMatch ? (typeMatch[1] || typeMatch[2] || typeMatch[3] || "") : "").trim().toLowerCase();
    const isJsType =
      type === "" ||
      type === "module" ||
      type === "text/javascript" ||
      type === "application/javascript" ||
      type === "text/babel" ||
      type === "application/ecmascript" ||
      type === "text/ecmascript";

    if (hasSrc || !isJsType) {
      // External/CDN or non-JS (json/importmap/etc.) → blank the body too.
      blank(bodyStart, bodyEnd);
    }
    // else: keep the body in place (already untouched).

    // The closing </script> tag itself is not JS — blank it.
    blank(bodyEnd, fullEnd);
    lastIndex = fullEnd;
  }
  // Blank any trailing content after the last script.
  blank(lastIndex, out.length);

  return out.join("");
}

// ─── Indentation normalization / dedent (H2) ────────────────────────────────
// HTML-extracted (or otherwise nested) single-file source keeps its base
// indentation (e.g. an inline <script> body indented 4-8 spaces). The
// topLevel* patterns anchor at `^` (column 0) BY DESIGN — they must NOT be
// loosened to `^[\t ]*` (that would mis-count every nested const/function/class
// inside a body as top-level, silently corrupting the inventory).
//
// The correct fix is to DEDENT: strip the minimum common leading whitespace
// across all NON-BLANK lines so genuine top-level code shifts to column 0
// (strict `^` matches) while relative nesting is PRESERVED (nested code stays
// indented → still not column 0 → no false positives) and the line COUNT is
// unchanged (we remove columns, not lines → reported line numbers stay correct).
//
// normalizeIndent(source) → string
function normalizeIndent(source) {
  const lines = source.split("\n");
  let min = Infinity;
  for (const line of lines) {
    // Ignore blank / whitespace-only lines (incl. HTML-blanked surroundings).
    if (/^\s*$/.test(line)) continue;
    const lead = line.match(/^[\t ]*/)[0];
    // A line with zero leading whitespace already pins min at 0 → early-out.
    if (lead.length < min) min = lead.length;
    if (min === 0) break;
  }
  if (min === Infinity || min === 0) return source; // nothing to strip
  return lines
    .map((line) => (/^\s*$/.test(line) ? line : line.slice(min)))
    .join("\n");
}

// ─── Single-file preprocessing entrypoint (H1 + H2 wire-in helper) ──────────
// Centralizes the "if it's a single-file monolith, extract inline JS from HTML
// (when .html/.htm) then dedent" pipeline so every single-file reader
// (01-inventory, 11-ast-xray, 11b, 11c) behaves identically. Line count is
// preserved end-to-end so reported line numbers map back to the original file.
//
// kind === "single-file" → apply; anything else (directory trees, already at
// column 0) → return source untouched (NO-OP), preserving plain-JS behavior.
function preprocessSource(source, filePath, kind) {
  if (kind !== "single-file") return source;
  let s = source;
  if (/\.(html?|htm)$/i.test(String(filePath || ""))) {
    s = extractJsFromHtml(s);
  }
  s = normalizeIndent(s);
  return s;
}

function extractSymbols(source, filePath) {
  const symbols = [];
  const imports = [];
  const seen = new Set();

  // Reset all `g` regexes by creating fresh local copies
  function each(re, fn) {
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m = r.exec(source)) !== null) fn(m);
  }

  function add(sym) {
    const key = sym.kind + ":" + sym.name + ":" + sym.line;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push(sym);
  }

  // Exported function
  each(PAT.exportFn, (m) => {
    const name = m[1];
    const line = lineOf(source, m.index);
    const sig  = captureSignature(source, m.index);
    const kind = looksLikeComponent(name, source, m.index) ? "component" : "function";
    add({ name, kind, exported: true, signature: sig, line, jsdoc: findJsdocBefore(source, line) });
  });

  // Exported const (could be arrow fn or value)
  each(PAT.exportConst, (m) => {
    const name = m[1];
    const line = lineOf(source, m.index);
    const sig  = captureSignature(source, m.index);
    // Detect arrow fn vs primitive
    const isArrow = /\)\s*(?::\s*[^=]+)?\s*=>/.test(sig) || /\(\s*\w*\s*\)\s*=>/.test(sig);
    let kind = "const";
    if (isArrow) kind = looksLikeComponent(name, source, m.index) ? "component" : "function";
    add({ name, kind, exported: true, signature: sig, line, jsdoc: findJsdocBefore(source, line) });
  });

  // Exported class / type / interface / enum / default
  each(PAT.exportClass,  (m) => add({ name: m[1], kind: "class",     exported: true, signature: captureSignature(source, m.index), line: lineOf(source, m.index), jsdoc: findJsdocBefore(source, lineOf(source, m.index)) }));
  each(PAT.exportType,   (m) => {
    const kind = source.slice(m.index, m.index + 32).includes("interface") ? "interface" : "type";
    add({ name: m[1], kind, exported: true, signature: captureSignature(source, m.index), line: lineOf(source, m.index), jsdoc: findJsdocBefore(source, lineOf(source, m.index)) });
  });
  each(PAT.exportEnum,   (m) => add({ name: m[1], kind: "enum",      exported: true, signature: captureSignature(source, m.index), line: lineOf(source, m.index), jsdoc: findJsdocBefore(source, lineOf(source, m.index)) }));
  each(PAT.exportDefault, (m) => {
    const name = m[1] || m[2] || m[3] || "<default>";
    add({ name, kind: "default", exported: true, signature: captureSignature(source, m.index), line: lineOf(source, m.index), jsdoc: findJsdocBefore(source, lineOf(source, m.index)) });
  });

  // export { A, B as C }
  each(PAT.exportNamed, (m) => {
    const body = m[1];
    const line = lineOf(source, m.index);
    body.split(",").forEach((part) => {
      part = part.trim();
      if (!part) return;
      const [orig, alias] = part.split(/\s+as\s+/).map((s) => s.trim());
      const name = alias || orig;
      if (/^type\s+/.test(orig)) return; // type-only re-exports skipped
      add({ name, kind: "re-export", exported: true, signature: `export { ${part} }`, line, jsdoc: null });
    });
  });

  // Non-exported top-level (informational; not flagged in parity diff)
  each(PAT.topLevelFn, (m) => {
    const name = m[1];
    const line = lineOf(source, m.index);
    if (symbols.some((s) => s.name === name && s.line === line)) return;
    add({ name, kind: "internal-function", exported: false, signature: captureSignature(source, m.index), line, jsdoc: findJsdocBefore(source, line) });
  });
  each(PAT.topLevelClass, (m) => {
    const name = m[1];
    const line = lineOf(source, m.index);
    if (symbols.some((s) => s.name === name && s.line === line)) return;
    add({ name, kind: "internal-class", exported: false, signature: captureSignature(source, m.index), line, jsdoc: findJsdocBefore(source, line) });
  });
  each(PAT.topLevelConst, (m) => {
    const name = m[1];
    const line = lineOf(source, m.index);
    if (symbols.some((s) => s.name === name && s.line === line)) return;
    const sig = captureSignature(source, m.index);
    const isArrow = /\)\s*(?::\s*[^=]+)?\s*=>/.test(sig) || /\(\s*\w*\s*\)\s*=>/.test(sig);
    let kind = "internal-const";
    if (isArrow) kind = looksLikeComponent(name, source, m.index) ? "internal-component" : "internal-function";
    add({ name, kind, exported: false, signature: sig, line, jsdoc: findJsdocBefore(source, line) });
  });

  // Imports
  each(PAT.importDefault, (m) => imports.push({ from: m[3], default: m[1], names: m[2] ? m[2].split(",").map((s) => s.trim()) : [], namespace: null }));
  each(PAT.importNamed,   (m) => imports.push({ from: m[2], default: null, names: m[1].split(",").map((s) => s.trim()), namespace: null }));
  each(PAT.importStar,    (m) => imports.push({ from: m[2], default: null, names: [], namespace: m[1] }));
  each(PAT.importSide,    (m) => imports.push({ from: m[1], default: null, names: [], namespace: null }));

  return { symbols, imports };
}

module.exports = { extractSymbols, captureSignature, lineOf, findJsdocBefore, extractJsFromHtml, normalizeIndent, preprocessSource };
