# SPEC-01: Governed Plan Board & Quality Gates (P1–P10)

## 1. Objective
Establish a self-auditing, machine-governed plan board (`PLAN.json` + `FINDINGS.json` + `board.html`) adhering strictly to the S.A.R.T. governance architecture. The system guarantees that "is this work landed?" is determined solely by examining the physical code tree for verified markers `(file, symbol)`, never by trusting unverified status labels.

## 2. Architecture & Schemas
- **`PLAN.json`**:
  - `arcs`: Grouping thematic lines of work (`ARC-GOVERNANCE`, `ARC-LIFECYCLE`, `ARC-PERFORMANCE`, `ARC-INTEGRATION`, `ARC-VERIFICATION`).
  - `nodes`: Heterogeneous list of `build` (parent units of work) and `phase` (atomic milestones carrying `parent`).
  - `intent`: One of `draft`, `approved`, `in_execution`, `closed`.
  - `evidence`: `{ "file": "<path>", "symbol": "<needle>" }`. Enforces check P5: Builds with phases carry **no evidence of their own**; landed-ness is the conjunction of all child phases.
  - `guard`: Test identifiers guarding against regression.
  - `mode`: `spec_driven` (with a verified `spec` path) or `needs_spec`.
  - `owner_decides`: Unambiguous questions reserved for the project owner.

- **`FINDINGS.json`**:
  - Empirical defect and expectation register.
  - `expected_failures`: Expected test failures linked to open findings, ensuring legitimate red gates remain controlled and transparent.
  - `disposition`: `open`, `investigating`, `accepted_until_owner_runs`, `accepted_permanently`, `closed`.

- **`board.html`**:
  - Pure client-side interactive visual status board rendered by `make_board.py`.
  - Enforces deterministic hashing (SHA-256 fingerprint) and single-token replacement.

## 3. The 10 Invariant Quality Gates (P1–P10)
| Check | Invariant | Real Failure Prevented |
| :--- | :--- | :--- |
| **P1** | Every `depends_on` resolves | Broken references silently discarding dependencies |
| **P2** | Dependency graph is acyclic | Deadlocks where two nodes wait for each other |
| **P3** | No node landed before its predecessors | Work built on foundations that never existed |
| **P4** | `intent` and code tree evidence agree | False `closed` claims without code, or untracked changes |
| **P5** | Build landed-ness is conjunction of phases | Partial phase completion claiming full build completion |
| **P6** | Both directions against findings register | Unregistered failures (regressions) or stale expected failures |
| **P7** | Real test IDs for all landed guards | Phantom guards that were never implemented |
| **P8** | Plan and human documentation agree | Drift between roadmap docs and actual codebase state |
| **P9** | Every non-null `spec` path exists on disk | Execution from memory without an engineering specification |
| **P10**| Published board matches fresh regeneration | Stale board HTML published without syncing with plan data |

## 4. Negative Fixtures Requirement
Every check (P1 through P10) must be accompanied by an isolated negative fixture proving that the check fails when fed invalid or conflicting data. A check that has never been observed failing is unverified.

## 5. CLI Protocols
- `python scripts/gate.py --status`: Prints resume protocol, highlighting `in_execution` work, `owner_decides` items, and exact `NEXT` action.
- `python scripts/gate.py --check-p10`: Verifies `board.html` integrity.
- `python scripts/gate.py --diff <old> <new>`: Classifies metrics into APPEARED, RESOLVED, VALUES MOVED, JITTER.
