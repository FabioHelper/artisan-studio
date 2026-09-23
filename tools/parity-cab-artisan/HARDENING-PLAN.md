# HARDENING PLAN — N=2 Beta Findings (testmodular2-glm)

> **Status:** PLAN — specs for review, NOT yet executed. Source: the first real
> N=2 dogfood (`testmodular2-glm`, an 834-line Three.js+YUKA+GSAP+audio HTML
> monolith modularized into 5 ES modules). Full report:
> `C:\Users\Fabio D\Desktop\testmodular2-glm\PARITY-CAB-REPORT.md`.
> **This plan supersedes the report's "Fix Prompt" where they differ** — notably
> H2 (the report's one-liner is wrong; see below).

---

## 0. The foundational reframe (addresses the "modularization-primary" coherence gap)

**The Parity Paradox (the #1 finding):** the harness reported `GO · parity=1.0` and
the modular app was *completely broken* (button did nothing). That is not a bug in
one stage — it's a **framing error in what the tool treats as its verdict.**

- **MODULARIZATION is the product** (a working modular app). It is PRIMARY.
- **PARITY is one verification layer** (did the symbols/AST survive the split). It is
  SECONDARY — necessary, not sufficient.

Today the CAB verdict equates "structural parity" with "GO," which over-promises.
The hardening below does two things: (a) adds the missing layers that verify the
modularization actually **wires up and boots** (H4) and surfaces what static
analysis cannot see (H5); and (b) **reframes the verdict + docs** so a structural
GO never *reads* as "the app works" (H5, H6). Every task is judged against this:
*does it move the harness from "parity-checker" toward "modularization-validator"?*

**Anti-bloat note:** all six tasks close a NAMED gap demonstrated by a real run.
None adds an external dependency (HTML/AST/path-resolution are all in-Node).

---

## Priority & sequence

| # | Task | Fixes | Priority | Effort | Risk |
|---|---|---|---|---|---|
| **H1** | HTML-embedded JS extraction | Problem 1 | **P0** (HTML = the user's whole domain) | S | low |
| **H2** | Indentation normalization (dedent, NOT regex-loosen) | Problem 2 | **P0** | S | low |
| **H4** | `05b-scaffold-check` gate (wiring/boot bridge) | Problems 4·5·6 | **P0** (closes the Parity Paradox) | M | med |
| **H5** | Runtime checklist + verdict reframe in CAB | Problem 7 + coherence | **P0** | S–M | low |
| **H3** | Export-wrapper normalization in AST-xray | Problem 3 | **P1** (false-positive cleanup) | S | low |
| **H6** | Docs/coherence reframe + opt-in fast-search note | coherence (c) + boost (a) | **P1** | S | none |

Recommended order: **H1 → H2** (without them, HTML monoliths produce garbage
symbols — everything downstream is then meaningless) → **H4 → H5** (the Parity-
Paradox fix) → **H3** → **H6**.

---

## H1 — HTML-embedded JS extraction  *(Problem 1)*

**Problem:** the monolith was a `.html` file; `extractSymbols()` ran its regexes
against raw HTML (`<style>`, `<div>`, `<script>` tags) → `0 symbols`. HTML-embedded
JS is the norm for this user's Three.js/game monoliths, so this is foundational,
not edge-case.

**Spec (careful — preserve line numbers):**
- Add `extractJsFromHtml(source) → string` to `scripts/lib/parse.cjs`.
- It must **replace all non-`<script>` content with blank lines (preserving newline
  count), and keep ONLY inline `<script>` bodies in place** — so a symbol's reported
  `line` still maps to the original `.html` line. Do NOT concatenate script bodies
  (the report's `.join('\n\n')` loses line mapping; the report itself flagged this).
- Skip `<script src=...>` (external/CDN — no inline body) and non-JS `type`s
  (`application/json`, `importmap`, etc.). Keep `type="module"` and bare/`text/javascript`.
- Wire-in at `scripts/01-inventory.cjs`: when `cfg.<side>.kind === "single-file"` AND
  the resolved root ends in `.html`/`.htm`, pass the source through `extractJsFromHtml`
  before `extractSymbols`. (Also apply in any other single-file reader: 11-ast-xray,
  11b, 11c read the monolith too — audit them.)
- **Generalization:** this also belongs in `modularize-monolith` (its SKILL.md already
  claims "HTML-embedded browser games" support — make it real end-to-end).

**Verify:** point inventory at an `.html` fixture with one inline `<script>` → symbols
found with correct original-HTML line numbers; a `<script src=cdn>` contributes nothing.
Add an `examples/demo-html/` sandbox (a tiny HTML monolith) so this is regression-tested.

---

## H2 — Indentation normalization  *(Problem 2 — report's fix REJECTED, replaced)*

**Problem:** HTML-extracted JS keeps its nesting indentation (e.g. 8 spaces); the
`topLevel*` patterns anchor at `^` (column 0) → indented top-level `class`/`function`/
`const` are invisible.

**⚠️ Why the report's fix is WRONG:** the report proposes loosening the regexes to
`^[\t ]*`. But `parse.cjs:28-29` is column-0 *by deliberate design* — its own comment:
*"STRICT: column 0 only … Otherwise we'd catch every `const x = …` inside function
bodies."* Loosening to `^[\t ]*` re-introduces exactly that false-positive: every
nested `const`/`function`/`class` inside a body would be mis-counted as a top-level
symbol, **corrupting the symbol inventory and the parity score** (and silently — the
worst kind). Do NOT apply the report's H2.

**Spec (the correct fix — dedent, keep regexes strict):**
- Add `normalizeIndent(source) → string` to `parse.cjs`: compute the minimum common
  leading whitespace across all **non-blank** lines and strip exactly that prefix
  from every line. This shifts genuine top-level code to column 0 (so strict `^`
  matches) while **preserving relative nesting** (nested code stays indented → still
  not column 0 → no false positives) **and line count** (dedent removes columns, not
  lines → reported line numbers stay correct).
- Apply to `single-file` monoliths only (directory trees are already at column 0),
  AFTER `extractJsFromHtml` (H1). For HTML-extracted source the blanked surroundings
  are empty lines (ignored by the min-indent calc), so the min-indent = the script's
  base indent → clean dedent.
- Keep `PAT.topLevelFn/Const/Class` exactly as-is (strict `^`).

**Verify:** an 8-space-indented `class Foo{}` at top level → found; a `const x=…`
nested inside a function body → NOT found as a symbol; line numbers unchanged.

---

## H3 — Export-wrapper normalization in AST-xray  *(Problem 3)*

**Problem:** `class SmartEngine{}` (monolith) vs `export class SmartEngine{}` (modular)
are reported as 6 DROPPED + 6 NEW HIGH-severity blocks — they're the *same* classes.
Modularization *always* adds `export`, so this false-positive hits **every** cutover.

**Root cause (confirmed):** `11-ast-xray.cjs` hashes AST *shape* (sha256, ~L242) walking
nodes by `node.type` (L526). An `ExportNamedDeclaration`/`ExportDefaultDeclaration`
wrapper node changes the shape vs a bare `ClassDeclaration` → different hash → not matched.

**Spec:** in the AST walk and block-identification (around L520-545), when
`node.type === "ExportNamedDeclaration" || "ExportDefaultDeclaration"`, descend to
`node.declaration` (the real class/function/const) and use THAT for the block's
type, label, body, and structural hash. Net: `export class Foo{body}` and
`class Foo{body}` produce an identical hash → matched as **preserved**. The hash is
already position-independent (structural), so the "imports add lines above" offset
the report mentions does not affect the hash — only the reported line, which is fine.
- Guard: `export default <expr>` (no `.declaration` that's a named decl) — handle the
  anonymous/expression case (fall back to current behavior; don't crash).

**Verify:** re-run xray on `testmodular2-glm` → the 6 drop/6 new collapse to preserved;
re-run the existing demo + Megazord xray → no regression (counts unchanged or better).

---

## H4 — `05b-scaffold-check` gate  *(Problems 4·5·6 — THE Parity-Paradox fix)*

**Problem:** the app was broken because the modular wiring was broken (module `src`
path 404'd → nothing executed), and structural parity is blind to it. This is the
single most valuable add: a **deterministic bridge from "symbols match" to "it
actually wires up."**

**Spec — new `scripts/05b-scaffold-check.cjs` (mirrors 13/14/15 shape):**
1. **Module-path resolution:** parse the modular entry HTML (config
   `modular.entry_html` or auto-detect `index.html`) for `<script type="module" src>`
   + `<link href>`; resolve each `src` **relative to the HTML file's location**, and
   verify the target file exists. Flag 404-class mismatches (Problem 5/6). HIGH severity.
2. **Import-chain resolution:** for every modular `.js/.ts/.jsx/.tsx`, walk
   `import … from "./X"` (reuse `parse.cjs` imports) and verify each relative specifier
   resolves to a real file (try `.js/.ts/.tsx/.jsx`, `/index.*`). Flag unresolved. HIGH.
3. **HTML structure sanity:** modular HTML has matched `</body>`/`</html>`, no literal
   un-interpreted escapes (e.g. `` `n ``), every `getElementById("X")`/`querySelector`
   id referenced in modular JS exists in the HTML. MED (Problem 4).
- Emit `<out_dir>/scaffold-check.sij.json` (decision pass/warn/fail; soft by default,
  `--strict` exits 1). Config-driven, no hardcoded paths. Graceful SKIP if no modular
  HTML entry is configured (non-web projects).
- Wire into `run-all.cjs` between 05 and 06, and add a `gate:scaffold` npm script.
- **Wire into the verdict (H5):** `05-cab-gate` reads scaffold-check like it already
  reads behavior-trace (L115-120) — a scaffold FAIL must downgrade GO. This is what
  makes the verdict mean "modularization valid," not just "parity."

**Verify:** on a fixture with a wrong module `src` → scaffold-check FAIL + CAB
downgrades from GO; fix the path → pass. (This would have caught Problems 5/6 before
the browser ever opened.)

---

## H5 — Runtime checklist + verdict reframe in CAB  *(Problem 7 + coherence)*

**Problem:** `window.onload` with `type="module"` is a runtime-timing bug static
analysis can't catch; and more broadly the CAB "GO" reads as "works" when it only
means "structural parity." 

**Spec (`scripts/05-cab-gate.cjs`):**
1. **Runtime checklist:** scan the monolith source for patterns that structural parity
   can't verify and emit a `runtime_checklist[]` in the verdict (L141 object),
   informational (does NOT change the decision). Patterns → checklist items:
   `window.onload`/`onload=` → "verify modular uses addEventListener + readyState
   fallback"; CDN `<script src=…cdn…>` globals (THREE/YUKA/gsap/etc.) → "verify modular
   loads the same CDN globals before module exec"; `new (AudioContext|webkitAudioContext)`
   → "verify audio unlock on user gesture survives the split"; `getElementById`/DOM ids
   → "verify referenced DOM ids exist in modular HTML".
2. **Verdict reframe (the coherence fix):** add `verdict.scope = "structural-parity +
   scaffold"` and change the printed line + the JSON so a GO is explicitly qualified —
   e.g. `GO (structural) — runtime not verified; see runtime_checklist + run gate:behavior`.
   Fold the H4 scaffold-check decision into `decide()` so wiring failures actually
   block/downgrade GO. The verdict must never *read* as "the app works" on symbols alone.

**Verify:** a monolith using `window.onload` + CDN globals → GO verdict carries a 2-3
item checklist; a scaffold FAIL → decision is no longer plain GO.

---

## H6 — Docs/coherence reframe + opt-in fast-search note  *(coherence (c) + boost (a))*

**Spec:**
1. **Reframe the entrypoint** so MODULARIZATION is primary. `QUICKSTART.md` (and a short
   top-level pointer) should read: *"Goal: modularize a monolith into faithful modules.
   Step 1 = decompose (modularize-monolith). Step 2 = VERIFY with parity-cab (symbols/
   AST), scaffold-check (wiring/boot), and the runtime checklist."* Present parity-cab as
   the **verification companion**, not the headline. Cross-link the `modularize-monolith`
   skill as the primary tool.
2. **Opt-in fast-search note** (the salvage from the high-speed-skill review): one line
   in QUICKSTART §0 — *"Optional: `ripgrep`/`fd` speed manual ground-truthing; install
   via your package manager if you like. The harness does not require or auto-install
   them."* No persona, no prohibitions, no silent installs.

**Verify:** a fresh reader of QUICKSTART understands modularization is the product and
parity is one check; the demo still works.

---

## What this plan deliberately does NOT do
- Does **not** apply the report's H2 regex-loosening (would corrupt the inventory — see H2).
- Does **not** add `rg`/`fd`/`jq`/scoop into the harness runtime (rejected in the
  high-speed-skill review — bloat + RCE risk; kept opt-in only, H6).
- Does **not** auto-run a browser (the runtime gap is bridged structurally by H4 +
  informationally by H5; full runtime truth stays with the existing `gate:behavior`).
- Does **not** touch any modularized project's `src/` (harness-only changes).
