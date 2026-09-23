# SPEC — Provenance Ledger (AC2.5 · the "un-provenanced logic is impossible by construction" pillar)

> **Status:** SPEC (the "1 spec" of the "1 spec + 2 impl" estimate). NOT yet
> implemented. Concretizes RFC-011 §3.1 ("Stage 0.5 — Provenance Ledger") into an
> implementable design. Spans TWO skills: write-time stamping lives in
> `modularize-monolith`; the verifying gate lives here in `parity-cab`.
> Supersedes the RFC-011 sketch where they differ (notably the gate NUMBER — slot
> 13 is now scene-graph; and the zero-trust "claim vs verify" core, below).

---

## 0. Why (the gap this closes)

Every existing parity check is **post-hoc**: AST X-Ray (11), remendo-scan (11c),
new-block-triage (11d), coverage (09/09b), the runtime gates — they all run AFTER
the agent has emitted the modular code, and flag divergence reactively. RFC-011 §2
names the residual risk plainly: *"Agent silently introduces a `new_block` mutating
shared state · pixel-diff catches it months later."* Disposition policy v1.1 is also
post-hoc ("flags AFTER the agent emits divergent code, not at write-time").

AC2.5 asks for the opposite: make un-provenanced modular logic **impossible by
construction** — i.e. a cutover that contains a line of behavior with no monolith
origin is *rejected at the gate*, before it can reach the harness or the user.

This is the write-time complement to the read-time detectors. It does not replace
them (they still corroborate); it removes the *class* of "invisible drift."

---

## 1. The core idea — a ledger that CLAIMS, a gate that VERIFIES (zero-trust)

Every modular file gets a sidecar **provenance ledger** that maps each of its line
ranges to either (a) a monolith source range it was extracted from, or (b) an
allow-listed `scaffolding` category. The ledger is *authored during extraction*
(the agent/tool that splits the monolith writes it), so on its own it is just a
**claim** — and the agent could lie or hallucinate.

The load-bearing trick: the gate does not trust the claim. For every `extracted`
entry it recomputes `astHash(monolith[from_lines])` and `astHash(modular[modular_lines])`
and asserts they are **structurally equal** (reusing 11-ast-xray's
position-independent `structuralHash`, which already ignores `export` wrappers,
local renames, TS casts, and literal reformatting — see H3). Therefore:

- A **fabricated** provenance entry (claiming a block came from monolith lines that
  don't contain it) **fails the hash check** → it cannot be forged.
- A **dropped** monolith range (no entry claims it) **fails the coverage check**.
- A **net-new** block (no monolith origin, not scaffolding) **has no valid entry it
  can write** → HARD FAIL.

So even though the agent *writes* the ledger, it **cannot write a passing one** for
code that isn't a faithful, accounted-for transform of the monolith. That is the
"by construction" guarantee.

---

## 2. Schema — `<modular_file>.provenance.sij.json`

One sidecar per modular source file, beside the file (or mirrored under
`<out_dir>/provenance/<modular_file>.provenance.sij.json`). SIJ envelope + `entries[]`:

```json
{
  "schema_version": "1.0.0",
  "schema_kind": "modularize-monolith/provenance-ledger",
  "generated_at": "2026-06-15T20:00:00Z",
  "modular_file": "src/scene/viewport.ts",
  "monolith_file": "reference/megazord_v12_8.jsx.bak",
  "entries": [
    { "modular_lines": [1, 8],   "kind": "scaffolding", "scaffold_class": "imports" },
    { "modular_lines": [9, 47],  "kind": "extracted",
      "from_monolith_lines": [2267, 2310], "ast_hash": "sha256:…" },
    { "modular_lines": [48, 53], "kind": "scaffolding", "scaffold_class": "type_annotation" },
    { "modular_lines": [54, 71], "kind": "extracted",
      "from_monolith_lines": [2410, 2433], "ast_hash": "sha256:…",
      "transform": "renamed_local:renderScale→RENDER_SCALE" }
  ]
}
```

Field rules:
- `modular_lines` / `from_monolith_lines`: inclusive 1-based `[start, end]`. Modular
  ranges across all entries in a file MUST partition the file with no gaps/overlaps
  (every line accounted for exactly once).
- `kind`: `"extracted"` | `"scaffolding"` (no third value — that's the point).
- `extracted` requires `from_monolith_lines` + `ast_hash`. `transform` is optional,
  free-text, informational (helps human review; NOT trusted by the gate — the hash is).
- `scaffolding` requires `scaffold_class` from the **closed allow-list** (§4.3). No
  free-form scaffolding — an unrecognized class is a FAIL.

---

## 3. Write-time production (modularize-monolith — Phase 4 augmentation)

`modularize-monolith` Phase 4 (Chunked Extraction) already moves monolith ranges
into modular files; it just doesn't *record* the mapping. Augment it so that for
every chunk the agent emits, it also appends a ledger entry naming the monolith
line range that chunk came from. Concretely:

1. Phase 4 already reads the monolith in ranges. Stamp each emitted chunk with its
   source `[a,b]` at emission time (the agent knows it — it just read those lines).
2. After a file is fully emitted, write its `.provenance.sij.json` partitioning the
   whole file (extracted chunks + the scaffolding the agent added around them).
3. `scaffold_class` is chosen from the allow-list (§4.3); anything the agent can't
   classify as scaffolding MUST be an `extracted` chunk with a real source range.

Crucially, the agent is **not asked to be honest** — it's asked to be *checkable*.
The Phase 5.2 gate (§4) re-derives the hashes; a sloppy or fabricated ledger fails
there, exactly like a sloppy extraction fails the existing gates today.

`modularize-monolith/SKILL.md` gains a `<provenance_ledger_rule>` (Phase 4.5 +
Phase 5.2) mirroring the existing `<coverage_inventory_rule>` shape.

---

## 4. The gate — `scripts/05c-provenance-gate.cjs` (parity-cab)

Numbered **05c** (not RFC-011's stale "13" — slot 13 is scene-graph). It is a
**pre-cutover structural gate**, peer to `05b-scaffold-check`: it runs before 06 and
its verdict folds into the CAB decision. Reuses `lib/parse.cjs` (HTML extract +
dedent, H1/H2) and 11-ast-xray's `structuralHash`.

### 4.1 Inputs
`parity.config.json` (`monolith.root`, `modular.root`, `out_dir`) + every modular
file's `.provenance.sij.json`. Graceful **SKIP** (exit 0, `decision="skip"`) if no
ledgers exist yet (so it's adoptable incrementally / non-breaking) — UNLESS
`--require-ledger`, which turns "no ledger" into a FAIL (the end-state posture).

### 4.2 Assertions (each emits findings; `--strict` exits 1 on any HIGH)
1. **Total coverage** — every modular line is in exactly one entry (no gap/overlap). HIGH.
2. **Hash match** — for each `extracted` entry, `structuralHash(modular[modular_lines])
   === structuralHash(monolith[from_monolith_lines])`. Mismatch = HIGH (forged/drifted
   provenance). This is the anti-forgery core.
3. **Monolith coverage ≥ threshold** — union of all `from_monolith_lines` covers
   ≥ `cfg.provenance.min_monolith_coverage` (default 0.99) of the monolith's
   *non-blank, non-comment* lines. Uncovered monolith logic = DROPPED behavior. HIGH.
   (Denominator excludes comments/blanks via parse.cjs tokenization, so reformatting
   and stripped comments don't dilute the score.)
4. **Scaffolding is really scaffolding** — every `scaffolding` entry's lines, when
   parsed, contain ONLY nodes in the allow-list (§4.3). A statement with a call,
   assignment, or control-flow inside a "scaffolding" block = HIGH (smuggled logic).
5. **No new logic** — equivalently: there is no modular line that is neither covered
   by a hash-verified `extracted` entry nor a validated `scaffolding` entry. This is
   assertions 1+2+4 together; called out so the verdict can name it as the headline.

### 4.3 `scaffold_class` allow-list (closed)
`imports` · `exports` · `barrel_reexport` · `type_annotation` · `interface_or_type_decl`
· `default_export_wrapper` · `blank_or_comment`. **Nothing else.** Adding a class is
an RFC-level change (keeps the escape hatch from quietly widening).

### 4.4 Output / disposition
`<out_dir>/provenance-gate.sij.json` (decision pass/warn/fail/skip + findings).
Disposition-aware like the other gates: `<out_dir>/provenance-gate.dispositions.json`
`{ dispositioned: [entity_id|label] }` lets a human sign off a *justified* exception
(e.g. a hand-written compatibility shim that legitimately has no monolith origin) —
recorded with rationale, audit-trailed. An un-dispositioned HIGH blocks under `--strict`.

### 4.5 CAB fold-in (Check 9)
`05-cab-gate.cjs` reads `provenance-gate.sij.json` like it reads `scaffold-check`
(H4 Check 8): a provenance FAIL downgrades GO. Add to `verdict.scope` →
`"structural-parity + scaffold + provenance"`. The GO caveat (H5) gains: *"every
modular line is provenance-verified against the monolith."* when provenance passed.

---

## 5. Backfill mode (`--backfill`) — make it usable on Megazord TODAY (M1)

Megazord (and any already-modularized project) has NO ledgers. Requiring hand-authored
ledgers for ~100 existing files is a non-starter. So the gate ships a **generator**:

`node 05c-provenance-gate.cjs --config … --backfill` walks each modular file, and for
each top-level block computes its `structuralHash`, then finds the monolith block with
the **same hash** (reusing 11d-new-block-triage's canonical signature matcher, which
already strips casts/renames/literals). A unique hash match → write an `extracted`
entry with that monolith range. Recognized import/export/type lines → `scaffolding`.
Anything left unmatched is written as a **`kind:"unresolved"` stub** (NOT a valid
ledger kind — it forces a human to either find its origin, classify it scaffolding, or
disposition it). Backfill thus produces a *draft* ledger + a punch-list of exactly the
blocks that lack provenance — which on Megazord is the same "new_block" set 11d already
triages, now framed as the to-account-for backlog.

This makes AC2.5 testable on the existing case (close the loop on Megazord's new_blocks)
without waiting for a fresh from-scratch modularization.

---

## 6. Relationship to the existing detectors (it HARDENS, doesn't duplicate)

- **AST X-Ray Class A/B (silenced-null, clock-order)** + **new_block side-effect
  potential**: today warning-only, "graduate to HARD in P2" (domain-notes 2026-05-28).
  The provenance gate IS that graduation: a `new_block` is by definition un-provenanced
  → HARD FAIL — no separate promotion needed. X-Ray stays the richer *diagnostic*;
  provenance is the *blocker*.
- **remendo-scan (11c)**: net-new side effects are a subset of un-provenanced lines;
  provenance subsumes the blocking decision, 11c stays the human-readable explainer.
- **coverage (09/09b)**: orthogonal — covers closure/JSX *labels*; provenance covers
  *line ranges*. Both keep running.

---

## 7. Rosetta tie-in (§4 of RFC-011)

The ledger entry is already a defined Rosetta action: `provenance_entry { modular_lines,
kind, from_monolith_lines }` (RFC-011 §4). So ledgers validate against the Refactor &
Parity Rosetta Stone the same way every other SIJ artifact does — a malformed entry is
rejected at schema-validation time, before the gate's semantic checks. Implementing
AC2.5 is therefore also the first real *consumer* of the Rosetta `provenance_entry`
action (partially discharging the SIJ-Rosetta thread of P2).

---

## 8. Phasing + acceptance

- **Spec** (this doc). ✅
- **Impl-1 — gate + backfill** (`05c-provenance-gate.cjs` + `--backfill` + `gate:provenance`
  npm + CAB Check 9 + selftest fixture). Provable on Megazord via backfill. ~1 stretch.
- **Impl-2 — write-time** (`modularize-monolith` Phase 4.5 stamping + `<provenance_ledger_rule>`
  + `--require-ledger` end-state). Provable on the next from-scratch modularization. ~1 stretch.

**AC2.5 proof command (DoD):** `node scripts/05c-provenance-gate.cjs --config <cfg> --strict`
exits 0 with `decision=pass` AND a planted un-provenanced block (selftest fixture) makes
it exit 1 — i.e. the gate demonstrably *cannot* be passed by un-provenanced logic.

---

## 9. Deliberately NOT in scope (anti-bloat, Law 5)
- No per-token provenance (line-range granularity is enough; sub-line is noise).
- No new dependency (reuses parse.cjs + 11-ast-xray structuralHash + 11d matcher).
- No runtime/behavioral claim — provenance is a STRUCTURAL guarantee (a faithful
  transform), not proof the app runs (that stays with scaffold-check H4 + runtime gates).
- Does not auto-fix — it BLOCKS + names the unaccounted block; restoring/dispositioning
  stays the LLM's job (same contract as every other gate).

---

## 10. Open questions / risks
- **Reordered extraction**: a modular file may interleave blocks from distant monolith
  ranges (helpers hoisted). Per-entry hashing handles this (each entry is independent);
  only the ≥99% *union* coverage matters, not ordering. Confirm on a reorder-heavy file.
- **Legitimately new scaffolding** (e.g. a DI barrel that has no monolith analog): the
  `scaffolding` allow-list + disposition path covers it; watch that the allow-list
  doesn't need widening on the 2nd monolith (if it does, that's real signal, not bloat).
- **Hash granularity vs. genuine micro-refactors**: structuralHash already tolerates
  renames/casts/literal reformat (H3 + 11d). A genuine semantic micro-change (the thing
  we WANT to catch) correctly fails — that's the feature, dispositioned if intentional.
