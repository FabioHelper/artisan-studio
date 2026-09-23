# Letter to Sol — independent audit of Artisan Studio P0

From: Fabio (owner) and Claude Opus 5 (P0 executor)
To: Sol (independent auditor)
Date: 2026-09-21

Hi Sol,

You wrote the audit and plan in `.bridge/ARTISAN-VISIBILITY-CREATIVE-PLAN.md`. Claude has now executed **P0 only** from that plan. Before anyone starts P1, we want you to check independently whether P0 really meets the plan. Please don't trust Claude's claims; re-run things and look at the evidence yourself.

## Project

`C:\Users\Fabio D\.gemini\antigravity\scratch\artisan-studio-app`

## Rules for you

1. **Read-only audit.** Do not edit source, governance or `.bridge` files. The one exception is the verdict file in step 5.
2. No commits. Publish nothing. Do not touch `C:\Users\Fabio D\Desktop\THREEJS_HARNESSING`.
3. Put any scratch output in OS temp or under `.artisan-artifacts\` (git-ignored artifact root).
4. **Do not write any project file while `verify_astra_harness.mjs` is running.** Its SHA-256 tree gate will (correctly) fail if you do. Claude tripped it once this way.
5. Do not start P1.

## What to read (in this order)

1. `C:\Users\Fabio D\.gemini\antigravity\scratch\artisan-studio-app\.bridge\ARTISAN-VISIBILITY-CREATIVE-PLAN.md`, your own plan, P0 section (allowlist, gates 1–13).
2. `C:\Users\Fabio D\.gemini\antigravity\scratch\artisan-studio-app\.bridge\ARTISAN-VISIBILITY-P0-HANDOFF.json`: Claude's gate-by-gate claims, deviations, and a `sol_audit_checklist`.
3. `C:\Users\Fabio D\.gemini\antigravity\scratch\artisan-studio-app\.bridge\ARTISAN-VISIBILITY-P0-WORKLOG.jsonl`: 12 step-by-step entries.
4. `C:\Users\Fabio D\.gemini\antigravity\scratch\artisan-studio-app\docs\specs\SPEC-07-VISIBILITY-CREATIVE-CONTRACT.md`: the new spec.
5. `C:\Users\Fabio D\.gemini\antigravity\scratch\artisan-studio-app\.bridge\ARTISAN-VISIBILITY-CREATIVE-BASELINE.json`: SHA-256 baseline taken before any edit.

## Evidence locations

| What | Path (under the project) |
|---|---|
| Exact pre-edit copy of every changed file (diff these) | `.artisan-artifacts\p0-preimage\<same relative path>` |
| Preservation tool | `.artisan-artifacts\p0-evidence\treehash.mjs` |
| Material diff (33 records) and live browser dumps | `.artisan-artifacts\p0-evidence\mat_changes.json`, `mat_browser.json`, `mat_browser_after.json` |
| Brightness before | `.artisan-artifacts\brightness\p0-before\` |
| Brightness after + before/after sheet | `.artisan-artifacts\brightness\p0-after\before_after.png` |
| Last verifier report | `.artisan-artifacts\verify\verify_report.json` |

## What to verify (run from the project root)

```
node .artisan-artifacts/p0-evidence/treehash.mjs compare . .bridge/ARTISAN-VISIBILITY-CREATIVE-BASELINE.json src/contracts/artisanContract.js src/engine/LightingRig.js src/engine/MaterialFoundry.js src/engine/WorldCompiler.js src/main.js mcp-server/artifacts.js mcp-server/bridge.js mcp-server/test_ws_bridge.js scripts/measure_brightness.mjs scripts/check_contract_drift.mjs scripts/verify_astra_harness.mjs package.json HARNESS-SIJ.json FINDINGS.json PLAN.json docs/specs/SPEC-07-VISIBILITY-CREATIVE-CONTRACT.md board.html .bridge/ARTISAN-VISIBILITY-P0-HANDOFF.json .bridge/ARTISAN-VISIBILITY-P0-WORKLOG.jsonl .bridge/LETTER-TO-SOL-P0-AUDIT.md
node scripts/check_contract_drift.mjs
node mcp-server/test_ws_bridge.js
npm run measure:brightness -- --tag sol-audit --compare-to .artisan-artifacts/brightness/p0-before
python make_board.py
python scripts/gate.py
node scripts/verify_astra_harness.mjs
```

Claimed results:
- The preservation check reports `unapproved: []`.
- The contract drift check passes 41/41.
- The bridge tests pass 29/29.
- The brightness run reports ALL GATES PASS (about 3 minutes).
- The governance gate is green on P1–P10.
- The verifier shows 0 blocking failures. Its only warning is the pre-existing draw overages: Tokyo 45/30, Winterhold 39/30, Fantastic 58/35. It takes about 6 minutes.

Also run `git rev-parse HEAD`; it should still be `909d41f182b2c4446411af6e19251f04257e13bf`.

## The questions we most want your judgement on

1. **Are the gates honest, not just green?** Could `measure_brightness.mjs`, the builder-spy routing test, or the static write scan in `check_contract_drift.mjs` pass vacuously? Try to break them. For example, feed a near-match archetype id, or reintroduce a scene-name branch in `LightingRig.js` in a temp copy.
2. **Gate 6 caveat.** `arch.balcony_window` never had a foundry builder; it crashed since HEAD. It is now built inline in `WorldCompiler.js`. `arch.tokyo_walls` routes explicitly to the full apartment shell. Does that satisfy "intended exact route", or should it be recorded as a gate 6 partial?
3. **Artifact-write deviation.** `mcp-server/index.js` and `HeadlessRunner.js` were outside the allowlist, so their 4 writes were proven confined rather than rerouted through `artifacts.js`. Is that acceptable for P0?
4. **Material contract.** It now follows browser-live values: 33 records rather than your 22, because Node uses canvas-free fallbacks. Is that the right source of truth? Is "MaterialFoundry applies the contract, and records any disagreement" safe?
5. **Mood.** Look at `before_after.png`, especially Winterhold. It gained a warm-neutral key to satisfy the dual-temperature rule. Give your opinion; Fabio makes the final call on gate 4.
6. **Governance truth.** Check the new findings in `FINDINGS.json`, `scene_baselines` in `HARNESS-SIJ.json`, and the new `PLAN.json` nodes: `BUILD-VIS` is in_execution until owner review, `BUILD-CREATIVE` is approved, `BUILD-PERF-SCENES` is draft. Is anything overstated?

## How we cooperate: write your verdict here

Create **one** file:
`C:\Users\Fabio D\.gemini\antigravity\scratch\artisan-studio-app\.bridge\ARTISAN-VISIBILITY-P0-SOL-AUDIT.json`

Use this shape:

```json
{
  "auditor": "Sol",
  "date": "YYYY-MM-DD",
  "verdict": "ACCEPT | ACCEPT_WITH_FIXES | REJECT",
  "commands_run": [{ "command": "...", "result": "..." }],
  "gates": [{ "gate": 1, "status": "PASS|PARTIAL|FAIL", "evidence": "..." }],
  "answers": { "q1": "...", "q2": "...", "q3": "...", "q4": "...", "q5": "...", "q6": "..." },
  "required_fixes_before_P1": [{ "id": "SOL-FIX-1", "file": "...", "problem": "...", "expected": "..." }],
  "p1_amendments": ["changes you want to the P1 plan/allowlist before it runs"],
  "notes_for_claude": "anything else"
}
```

After that:
- **If you list required fixes**, Claude will apply only those, in a fresh session. Each fix gets its own worklog entry, and Claude will re-run the same commands.
- **If you ACCEPT**, and Fabio approves the contact sheet, Claude records `.bridge/ARTISAN-VISIBILITY-P0-OWNER-ACCEPTANCE.json` and closes `BUILD-VIS`. P1 then starts in a new session, using your `p1_amendments`.
- If you and Claude disagree, write it down in the verdict file. Fabio decides.

Thank you. Please be as strict with this work as you were in the original audit.

— Fabio & Claude
