# parity-cab — SAFE TEST SANDBOX

This folder is a **self-contained playground** for testing the parity-cab harness
**without touching any real project**. It is a tiny "monolith" (`monolith.jsx`) and
its "modularized" cutover (`modular/`), with **two planted divergences** so you can
confirm the harness actually catches things.

## Why it's safe
- It only **reads** `monolith.jsx` + `modular/` and **writes** to `./.parity/`.
- No `artifact_system_sink` → it does **not** contact any server, and it cannot
  affect Megazord, artifact-system, or anything else.
- Run anything here freely. Worst case you delete `./.parity/` and re-run.

## Run it (no browser, no server)
From THIS folder:

```bash
# C5 — dynamic-JSX label coverage (needs ast-grep `sg` on PATH)
node ../../scripts/09b-jsx-coverage.cjs --config parity.config.json

# Full deterministic source pipeline (inventory → classify → diff → coverage → CAB)
node ../../scripts/run-all.cjs --config parity.config.json
```

## Expected result (proves the harness works)
`gate:jsx` must report **2 dropped JSX labels**:
- `"85% Boost Active"` — the modular `hud.jsx` silently changed it to `"Active"`.
- `"Click · Drag · Scroll"` — the modular dropped the `<em>` controls hint.

If you see those two orphans, the harness is working. Fix `modular/hud.jsx` to
match `monolith.jsx` and re-run → `decision=pass`.

## What this does NOT cover
The **runtime** gates (behavior-trace, scene-graph, anim, pixel — Stages 06/12/13/15)
need a live Three.js scene + a browser harness, which this toy app doesn't have.
They are exercised on a real graphics project (e.g. Megazord) via `npm run gate:visual:auto`.
The **source** gates above are fully portable and run anywhere with Node + ast-grep.
