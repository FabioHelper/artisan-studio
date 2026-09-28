# Macrofy

A product centred on macronutrients. What it does, and for whom, is being defined with the owner —
see [docs/STATUS.md](docs/STATUS.md) for the live mission, plan and next action.

Macrofy is isolated from Artisan Studio (the rest of this repository): no shared dependencies,
build config or source.

## How work happens here

Macrofy is built by AI coding agents under a mission-control harness that keeps the mission,
plan and evidence in machine-checked files and blocks work that skips steps.

```sh
cd macrofy
node harness/mc.mjs brief       # where are we, what's next
node harness/mc.mjs check       # all gates, including re-running checks of finished work
node harness/mc.mjs selftest    # prove every gate can fail
```

- Agents start at [AGENTS.md](AGENTS.md).
- Documentation system: [docs/README.md](docs/README.md).
- Design rationale: [ADR 0001](docs/decisions/0001-agent-harness-architecture.md).
