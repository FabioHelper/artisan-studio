@AGENTS.md

## Claude Code specifics

- Hooks in the repo's `.claude/settings.json` enforce the protocol: after compaction or resume the
  `mc brief` is re-injected, and a turn cannot end while fast gates fail or while `macrofy/` changed
  after the latest handoff note. They stay silent in sessions that don't touch `macrofy/`.
- Independent review: delegate to the `macrofy-reviewer` subagent
  (`.claude/agents/macrofy-reviewer.md`); protocol in `docs/runbooks/review.md`.
- Unattended runs: `/goal node macrofy/harness/mc.mjs check exits 0 and mc brief shows T-nnn done`.
- When compacting, preserve: the active task id, failing check output, and files changed.
