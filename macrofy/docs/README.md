# Macrofy documentation

Every document here has exactly one job, one kind, and a mechanical freshness rule. If a document
cannot be kept true by one of the rules below, it does not belong in the repository.

## Index

| Doc | Kind | Answers |
|---|---|---|
| [STATUS.md](STATUS.md) | generated | Where are we? Mission, goals, milestones, blockers, recent handoffs |
| [architecture.md](architecture.md) | living codemap | Where is the code for X, and which invariants hold? |
| [decisions/](decisions/0001-agent-harness-architecture.md) | decision records | Why is it built this way? |
| [runbooks/planning.md](runbooks/planning.md) | runbook | How does owner intent become tasks and specs? |
| [runbooks/review.md](runbooks/review.md) | runbook | How is work independently reviewed? |
| [runbooks/weighing-protocol.md](runbooks/weighing-protocol.md) | runbook | How does the owner check an estimate against a kitchen scale ("Conferir com balança", pt-BR)? |
| [runbooks/feasibility-test.md](runbooks/feasibility-test.md) | runbook | How does the owner run the on-phone model feasibility test (pt-BR)? |
| [specs/_TEMPLATE.md](specs/_TEMPLATE.md) | template | What goes into a task spec? |

Decision records: [0001 agent harness architecture](decisions/0001-agent-harness-architecture.md) · [0002 geometry-first food estimation](decisions/0002-geometry-first-food-estimation.md) (accepted) · [0003 pretrained models only](decisions/0003-no-model-training.md) · [0004 PWA first on iPhone 16e](decisions/0004-pwa-first-on-iphone-16e.md) · [0005 automatic plate and food detection](decisions/0005-automatic-plate-and-food-detection.md) · [0006 zero setup and scale checks](decisions/0006-zero-setup-and-scale-checks.md).

## Kinds of document and how each stays true

| Kind | Where | Rule | Enforced by |
|---|---|---|---|
| **Generated** | `docs/STATUS.md` | Rendered from `control/`; never edited by hand | gate D3 byte-compares with a fresh render |
| **State** (not prose) | `control/*.json` | Mission, plan, checks, findings are data; docs link to them rather than copy them | gates S1–S4, J1–J5 |
| **Decision record** | `docs/decisions/NNNN-*.md` | Immutable once `Status: Accepted`; changed only by a superseding ADR. A historical snapshot: its paths are true as of its date, so it is exempt from link/path checks | gate D5 |
| **Spec** | `docs/specs/SPEC-T-nnn-*.md` | Written before building; owned by exactly one task (`spec` field); frozen when the task is done | gates S2, D6 |
| **Living codemap** | `docs/architecture.md` | Names modules and paths, never line numbers or counts; updated in the same commit as the change that makes it wrong | gate D2 (every named path exists) + review |
| **Runbook** | `docs/runbooks/*.md` | Procedures an agent follows; commands in them are real | gate D2 + use |
| **Agent entry points** | `AGENTS.md`, `CLAUDE.md` | Maps, not manuals: ≤120 and ≤30 lines | gate D4 |

All kinds: every relative link resolves and every doc is reachable from `AGENTS.md` or this index
(gate D1). A file starting with `_` is a template and exempt from ownership rules.

## What not to write

- Status, progress or counts in prose — they rot the moment work moves. Use `mc brief` / STATUS.md.
- Restatements of code, schemas or config — link to the source instead.
- Session diaries — handoffs go in the journal via `mc note`.
- Plans outside `control/plan.json` — a second plan is a stale plan.
