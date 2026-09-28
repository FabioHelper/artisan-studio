# Macrofy architecture (codemap)

A map of where things live and which invariants hold. It names modules and paths, never line
numbers or counts. Update it in the same commit as any change that makes it wrong.

## Product

Not started. Design: [ADR 0002](decisions/0002-geometry-first-food-estimation.md) (native iPhone first) (see [STATUS.md](STATUS.md));
its modules will be mapped here as they land.

## Mission-control harness (`harness/`)

| Module | Responsibility |
|---|---|
| `harness/mc.mjs` | CLI. The only writer of task status: every mutation appends to the journal, updates `control/plan.json`, re-renders `docs/STATUS.md` |
| `harness/lib/state.mjs` | Loading control files into a snapshot (from disk or an in-memory fixture), journal parsing, status derivation, acceptance hashing, done-evidence rules |
| `harness/lib/gates.mjs` | The gates. Pure functions `snapshot → problems[]`; each problem carries a fix instruction written for an agent |
| `harness/lib/render.mjs` | Deterministic `docs/STATUS.md` and the session brief, including the NEXT-action rule |
| `harness/selftest.mjs` | Negative fixtures: proves each gate fails on broken input and passes on good input |
| `harness/hooks/` | Claude Code adapters (SessionStart, Stop) plus their selftest in a throwaway git repo |

Wiring outside `macrofy/`: hooks are registered in the repo's `.claude/settings.json`, the reviewer
subagent is `.claude/agents/macrofy-reviewer.md`, and CI runs `.github/workflows/macrofy-harness.yml`.

## Invariants

- Task status is derived from `control/journal.jsonl`; `plan.json`'s `status` field is a cache the
  gates compare against the derivation.
- The journal is append-only relative to `HEAD` locally and to the base commit in CI.
- The harness has no dependencies beyond Node built-ins, so every agent and CI can run it.
- Hooks are inert unless the session changed or discussed `macrofy/`.

## Extending the harness

- **New check:** add it to `control/checks.json` (argv array, run from `macrofy/`, exit 0 = pass),
  then reference it from acceptance criteria.
- **New gate:** add a function to `harness/lib/gates.mjs`, register it in `GATES`, and add at
  least one negative fixture to `harness/selftest.mjs` — the selftest fails for any gate that
  has never been observed failing.
- **Another agent tool:** reuse `mc`; only write a thin adapter like `harness/hooks/` if that tool
  has lifecycle hooks.
