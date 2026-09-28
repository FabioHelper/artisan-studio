# Runbook: independent review

Required when a task has `"review": "required"` or any `manual` criterion. The agent that wrote
the change must not be the one grading it.

## Who reviews

- **Claude Code:** the `macrofy-reviewer` subagent (`.claude/agents/macrofy-reviewer.md`) — a
  fresh context that sees the diff and criteria, not the reasoning that produced them.
- **Another model or tool** (Codex, Gemini): same brief, run in its own session.
- **The owner:** required for `manual` criteria that are product judgements (e.g. approving the
  mission).

## The reviewer's brief

Give the reviewer: the task id, `mc brief` output, the task's entry in `control/plan.json`, its
spec, and the diff since the task's `start` entry (its `head` field in the journal:
`git diff <head> -- .`). Ask it to:

1. Re-run every check the task names (`mc verify` output is a claim; re-running is evidence).
2. Check each acceptance criterion against the actual behaviour, not the code's intent.
3. Check scope: nothing outside the task changed; docs made wrong by the change were updated.
4. Report only gaps that affect correctness or the stated criteria — not style preferences.

## Recording the verdict

```sh
node harness/mc.mjs review T-nnn --verdict accept --notes "re-ran all checks; criteria A1–A3 hold"
node harness/mc.mjs review T-nnn --verdict reject --notes "A2 fails when the meal has no fat entry"
```

Record the reviewer's own words in `--notes`, and set `MC_AGENT` to the reviewer's identity
(e.g. `MC_AGENT=macrofy-reviewer`) so the journal shows who judged. A reject is fixed, re-verified
and re-reviewed; `mc done` accepts only a review newer than the latest verify.
