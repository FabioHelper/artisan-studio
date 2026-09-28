# Macrofy — agent guide

Canonical instructions for every coding agent (Claude Code, Codex, Gemini, …). `CLAUDE.md` imports
this file; do not create divergent copies. Macrofy lives in `macrofy/` inside the artisan-studio repo
and shares nothing with Artisan Studio.

This file is a map, not an encyclopedia. It deliberately does **not** describe the mission, the
plan or progress: those live in `control/` (machine-checked) and are rendered to
[docs/STATUS.md](docs/STATUS.md). Ask the harness instead of trusting prose.

`mc` below means `node harness/mc.mjs`, run from `macrofy/`.

## Every session

1. **Orient:** `mc brief` — mission, goals, active task, owner questions, last handoff, gate state, NEXT.
2. **Load only what the task needs:** its entry in `control/plan.json`, its spec, the files it touches.
3. **One task at a time:** `mc start T-nnn` locks its acceptance criteria → build →
   `mc verify T-nnn` → independent review when required ([runbook](docs/runbooks/review.md)) →
   `mc done T-nnn`.
4. **Commit** per task; the message starts with the task id (`T-004: …`).
5. **Hand off before stopping:** `mc note "done: … / next: … / gotchas: …"` — written for a
   reader with zero context. The next session starts from it.

No active or ready task? Follow [docs/runbooks/planning.md](docs/runbooks/planning.md). Never
invent product scope.

## Rules (enforced by `mc check`; failures print the fix)

- **Status is proven, not claimed.** Task status changes only through `mc`; the journal
  (`control/journal.jsonl`) is append-only and is the audit trail.
- **Criteria are locked at start.** Changing them afterwards needs `mc amend T --reason "…"`,
  which is shown to the owner. Never weaken a criterion to get green.
- **Every criterion has a check** registered in `control/checks.json`, or is `manual` — which
  forces an independent review. No phantom checks.
- **Every task serves a mission goal; every goal has work.** Anything else is scope creep: ask.
- **Never hide red.** A known defect you are not fixing now goes into `control/findings.json`
  (with `expected_failing` check ids). The register is checked in both directions.
- **Owner decisions are the owner's.** Product, UX, data or pricing questions:
  `mc block T --reason "…" --owner-question "…"`, then continue with other ready work.
- **Docs change with the code.** A change that makes a doc wrong updates it in the same commit.
  `docs/STATUS.md` is generated (`mc render`); never edit it by hand. See [docs/README.md](docs/README.md).
- **Two failed attempts at the same fix → stop.** Record a finding or block, write a note, and
  report; a fresh context with a better plan beats a third blind attempt.

## Evidence over assertion

A green gate means the declared rules were obeyed — not that the work is good. When reporting,
show the command you ran and its result. Prefer end-to-end checks that exercise the product the
way a user would over unit tests alone.

## Where things are

| Path | What |
|---|---|
| `control/mission.json` | Mission, goals (with measures), non-goals, constraints — owner-approved |
| `control/plan.json` | Milestones and tasks with dependencies and acceptance criteria |
| `control/checks.json` | Registry of runnable checks (argv, run from `macrofy/`) |
| `control/findings.json` | Known defects and deviations, with expected failing checks |
| `control/journal.jsonl` | Append-only log: start/verify/review/done/block/note… |
| `harness/` | Mission-control CLI, gates, selftests, Claude Code hook adapters |
| `docs/` | Documentation system — index and freshness rules in [docs/README.md](docs/README.md) |

Why it is built this way: [ADR 0001](docs/decisions/0001-agent-harness-architecture.md).
