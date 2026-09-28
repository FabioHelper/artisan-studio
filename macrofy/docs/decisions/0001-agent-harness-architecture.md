# ADR 0001: Agent harness architecture for Macrofy

Status: Accepted

Date: 2026-09-28 · Task: T-001

## Context

Macrofy will be built mostly by AI coding agents (Claude Code, and possibly Codex or Gemini)
working across many sessions whose context windows start empty and get compacted. The owner's
requirements: integrity, quality assurance and context continuity, with the mission, goals and
steps tracked end to end so that none are lost — enforced by a harness rather than by good
intentions — plus documentation that is productive and never stale.

### What the research says

- **Long-running agents fail in two ways:** they try to one-shot everything, or they declare
  victory early — marking features complete without end-to-end testing. The remedy is a
  structured feature list where every item starts as failing and is flipped only after
  verification. The list is kept in **JSON, because models are less likely to overwrite JSON
  inappropriately than Markdown**. Each item has explicit verification steps. There is also a
  progress file plus git history so a fresh session can "quickly understand the state of work",
  and a fixed session-start routine (Anthropic, *Effective harnesses for long-running agents*).
- **Context is a finite resource that rots as it grows:** keep the always-loaded instructions
  small, retrieve just in time, use structured note-taking outside the window, and use
  sub-agents to get clean-context work (Anthropic, *Effective context engineering for AI agents*).
- **Claude Code practice:**
  - Give the agent a check it can run.
  - Keep `CLAUDE.md` short. Each line must earn its place, and a bloated file gets ignored.
  - Use hooks for anything that must happen every time, because instructions are advisory and
    hooks are deterministic.
  - Have a fresh-context reviewer grade the work, not the writer.
  - Show evidence rather than assertions.

  (Claude Code docs: *Best practices*, *Hooks*, *Memory*, */goal*.)
- **Agent-first repositories:**
  - Treat `AGENTS.md` as a table of contents, not an encyclopedia. A monolithic manual "turns
    into a graveyard of stale rules".
  - The repository is the system of record, because agents cannot see knowledge held elsewhere.
  - Keep tech debt in a tracked register.
  - Enforce architecture and doc freshness mechanically, and garbage-collect regularly.

  (OpenAI, *Harness engineering*, and summaries of it.)

### What this repository's Artisan harness taught us

Keep:
- Plan nodes with guards, and checks that must be shown failing on negative fixtures ("a check
  never observed failing is unverified").
- A findings register checked in both directions.
- Independent re-audits: one caught a "fully compliant" claim that did not reproduce.
- The rule "a green gate means the declared rules were obeyed — not that the work is good".

Avoid:
- **Evidence that is only a symbol existing in a file.** It proves the code exists, not that it
  works.
- **Self-reported "last verified" numbers stored in JSON.** They go stale.
- **Three divergent agent instruction files** (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`).
- **Hard-coded machine-local paths.** They break in the cloud and CI.
- **About 80 one-off diagnostic scripts** with no owner.
- **Per-task handoff files that pile up** in `.bridge/`.
- **A README roadmap that drifted** from reality.

## Decision

1. **State is data; status is derived.**
   - Mission, plan, checks and findings are JSON in `control/`.
   - Task status is derived from an append-only journal (`control/journal.jsonl`). The `status`
     field in `plan.json` is only a cache that the gates verify.
   - Hand-editing a task to `done` fails the gate. So does editing history, and so does any
     edit that is not a pure append relative to `HEAD` (locally) or the base commit (in CI).
2. **Done means proven.**
   - `start` locks a task's acceptance criteria with a hash.
   - `done` requires a passing `verify` of exactly those criteria, run by the harness executing
     registered checks — not the agent's say-so.
   - When the task requires it, `done` also needs a later accepting review by someone other than
     the writer.
   - Changing criteria after the lock needs a journaled `amend` with a reason, and the owner
     sees it.
   - The full `check` re-runs the checks of every done task, so a regression turns red unless a
     finding declares it.
3. **The mission cannot be silently lost.**
   - Every goal must have live work, and every task must serve a goal.
   - Only one task may be active at a time (WIP limit 1), and dependencies come first.
   - Owner questions are first-class blocks, surfaced in every brief.
4. **Context continuity is layered:**
   - `mc brief` gives a whole-project briefing in about 10 lines, ending in a single NEXT action.
   - The handoff note is required after changes.
   - The Claude Code SessionStart hook re-injects the brief after compaction or resume.
   - Git history carries the rest.
5. **Enforcement at three layers:**
   - **The `mc` CLI**, which works with any agent and refuses invalid transitions.
   - **Claude Code hooks.** The Stop hook blocks the end of a turn while fast gates fail or
     while `macrofy/` changed after the latest handoff. It releases when stuck and alerts a
     human.
   - **CI** (`.github/workflows/macrofy-harness.yml`), which runs the full gate and selftests
     on every change. This is the backstop for work done by any agent or person.
6. **Documentation has kinds, and each kind has a freshness rule enforced by a gate:**
   - generated (drift-checked);
   - decision records (immutable once accepted);
   - specs (owned by exactly one task);
   - codemap and runbooks (every named path must exist).

   In addition, every document must be reachable from the index with no dead links, and agent
   entry points have line budgets. See [the docs index](../README.md).
7. **One instruction source.** `AGENTS.md` is canonical for all agents. `CLAUDE.md` imports it
   and adds only Claude-specific notes.
8. **Zero dependencies and portable paths.** The harness uses Node built-ins only, and all paths
   are relative to `macrofy/`.

## Consequences

- Agents spend a few seconds per task on `start`/`verify`/`done`/`note`. In return, "is it
  done?" is always answered by evidence, and every session starts from an accurate briefing.
- Every turn that changes `macrofy/` ends with a handoff note. That is deliberate friction.
- Gates enforce form, not taste. Quality still depends on good acceptance criteria (written
  with the owner), end-to-end checks, and honest independent review. The harness makes skipping
  those visible; it cannot make them good.
- The harness's own trustworthiness is tested: the selftest proves every gate can fail, and it
  fails if a gate is added without a negative fixture.

## Sources

- Anthropic — [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- Anthropic — [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Claude Code docs — [Best practices](https://code.claude.com/docs/en/best-practices), [Hooks](https://code.claude.com/docs/en/hooks), [Memory](https://code.claude.com/docs/en/memory), [/goal](https://code.claude.com/docs/en/goal)
- OpenAI — [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/) (read through search summaries; direct access was blocked from the build environment)
- This repository's Artisan harness: `PLAN.json`, `FINDINGS.json`, `scripts/gate.py`, `.bridge/`
