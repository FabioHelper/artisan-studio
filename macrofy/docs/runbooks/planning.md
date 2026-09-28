# Runbook: turning owner intent into work

Use when `mc brief` shows no ready task, or the owner brings a new idea.

1. **Interview, don't assume.** Ask the owner about users, the problem, must-haves, non-goals,
   platforms, data sources and constraints. In Claude Code, use the AskUserQuestion tool. Record
   open questions with `mc block T-nnn --reason "…" --owner-question "…"` rather than guessing.
2. **Mission first.** Goals go in `control/mission.json`; each has a *measure* that says how we
   know it is achieved. Only the owner moves `status` to `approved`.
3. **Milestones are outcomes** a user could notice, not layers ("log a meal end to end", not
   "build the database").
4. **Tasks are small and vertical:** one session, one commit or a few, one observable result.
   Each task has:
   - `goals` — at least one mission goal it advances;
   - `depends_on` — only real ordering constraints;
   - `acceptance` — observable criteria; each names a check from `control/checks.json` (register
     the check first; write the test as part of the task if it doesn't exist yet) or is `manual`
     (which forces an independent review);
   - `review` — `required` for product work, `optional` only for mechanical changes;
   - `spec` — for anything non-trivial, copy `docs/specs/_TEMPLATE.md` to
     `docs/specs/SPEC-T-nnn-<slug>.md` and fill it in *before* building.
5. **Prefer end-to-end checks.** A criterion like "a user can log a meal and see updated macro
   totals" should be backed by a test that drives the product the way a user would.
6. **Validate:** `mc check --fast` must pass. It catches unknown goals, phantom checks, cycles,
   goals with no work and tasks with no goal.
7. **Owner sign-off** on new milestones before `mc start`; record it in a note.
