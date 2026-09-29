@AGENTS.md

## Claude Code specifics

- Hooks in the repo's `.claude/settings.json` enforce the protocol: after compaction or resume the
  `mc brief` is re-injected, and a turn cannot end while fast gates fail or while `macrofy/` changed
  after the latest handoff note. They stay silent in sessions that don't touch `macrofy/`.
- Independent review: delegate to the `macrofy-reviewer` subagent
  (`.claude/agents/macrofy-reviewer.md`); protocol in `docs/runbooks/review.md`.
- Worktree sub-agents: while one holds a task, do not append to main's journal; merge its branch (fast-forward) first, then run the FULL `mc check` before pushing. If they diverge, keep main's journal and re-run `mc verify`.
- Unattended runs: `/goal node macrofy/harness/mc.mjs check exits 0 and mc brief shows T-nnn done`.
- When compacting, preserve: the active task id, failing check output, and files changed.
- Token hygiene: `/clear` after `mc done` + `mc note`; `/compact <focus>` in long tasks; check
  `/context` when a session feels slow; give every `/goal` a turn cap ("or stop after 15 turns").
