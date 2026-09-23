# SPEC-16 — Runtime Adapter Contract (de-Megazord the harness)

> **Status:** DRAFT — ready to execute.
> **Author:** Opus 5 (spec) · **Executor:** a cheaper model in a FRESH session.
> **Repo:** `C:/Users/Fabio D/.claude/skills/parity-cab` (git, branch `main`, clean at spec time).
> **Goal:** make the RUNTIME gates (06/07/12/13/14/15) work on **any** THREE.js project,
> without breaking Megazord.

---

## 0. Why this exists (read once, do not re-derive)

The SOURCE gates (01–05, 05b, 08, 09, 09b, 11x) are already project-agnostic — they take
`parity.config.json` and walk files. Nothing to do there.

The RUNTIME gates are gated behind **one** blocking file: `scripts/06-behavior-trace.cjs`
writes two harness HTMLs that are hardcoded to Megazord's module layout. A measurement pass
(2026-09-19) found the total real coupling is **2 files**:

| File | Coupling | Nature |
|---|---|---|
| `scripts/06-behavior-trace.cjs` | 18 hits | **REAL** — hardcoded imports, mount ids, CDN pins |
| `scripts/lib/trace-recorder.js` | 30 hits | **SOFT** — optional `window.*` globals, already duck-typed + graceful-degrading |
| `07,08,09,11,11b,15` | 1–3 hits each | **NONE** — comments, provenance notes, selftest fixture names |
| `lib/heuristics.cjs` | 2 hits | **NONE** — generic regexes; the comment just cites Megazord examples |

So: **do not touch 07/08/09/11/11b/15/heuristics.** Changing a comment there is out of scope.

### The exact blockers in 06

- `06-behavior-trace.cjs:42-149` `buildMonolithHarness()` — pins React 18 UMD +
  `three@0.150.0` + `@babel/standalone` from unpkg; strips ES module syntax from the source
  with regex; evals it in a `new Function`; expects a `MegazordStudio` global; mounts `#root`.
- `06-behavior-trace.cjs:150-229` `buildModularHarness()` — a hardcoded importmap, then literal
  `import MegazordStudio from "/modular/ui/studio.js"`, `import { MatPool } from
  "/modular/gfx/mat-pool.js"`, `import { ArcaneAudio } from "/modular/audio/index.js"`,
  `import { bus } from "/modular/core/index.js"`, `MatPool.initialize(THREE)`,
  mounts `#studio-root`.
- There is **no config field** to redirect any of it. Confirmed by grep.

### The soft seams in trace-recorder.js

Already optional — these are `if (window.X)` checks that log "not available — skipping":
`window.MatPool` (L301, L1340, L1363), `window.ArcaneAudio` (L1242-1245), `window.bus`,
`window.__viewport` (readiness signal, L1333-1357). Three places carry Megazord *values*
rather than Megazord *names*:

- `snapshotHUD()` L162-169 — probes for literal panel names ("brain explorer", "inspector",
  "ai director").
- `scrubEngineSettings()` L1150-1206 — three hardcoded presets (`balanced/highfps/maxvis`) with
  Megazord's own brightness×contrast×ambient math, applied directly to `viewport.scene`.
- `scrubAudio()` L1241-1301 — assumes an `ArcaneAudio`-shaped mixer API.

---

## 1. Decision already made — DO NOT FORK

**Generalize in place on `main`. Do not create `parity-cab-generic/`.**

Rationale (non-negotiable, this is the owner's own hard-won lesson): a duplicate copy of this
harness in a second directory is exactly how it broke before — `projects/megazord/package.json`
(8 `gate:*` scripts) plus `scripts/run-coverage-gate.cjs`, `run-visual-parity.cjs`,
`run-visual-parity-auto.cjs` hardcode absolute paths into `.claude/skills/parity-cab/scripts/...`.
A fork creates two truths and silently re-breaks those gates. One harness, config-driven.

**Backward compatibility is an acceptance criterion, not a nicety.** When `runtime` is absent
from `parity.config.json`, 06 MUST emit byte-identical harnesses to today's output.

---

## 2. Deliverable — the `runtime` config block

Add an OPTIONAL `runtime` object to `parity.config.json`. Full shape:

```jsonc
{
  "runtime": {
    // --- readiness contract: how the recorder knows the app booted ---
    "ready": {
      "global": "__viewport",        // window.<global> must expose { scene, renderer, camera }
      "timeout_ms": 20000
    },

    // --- optional app globals the recorder hooks if present ---
    "globals": {
      "matpool": "MatPool",          // null => skip MatPool telemetry
      "audio":   "ArcaneAudio",      // null => skip audio scrub
      "bus":     "bus"               // null => skip bus event capture
    },

    // --- CDN / vendor pins (harness <head>) ---
    "vendor": {
      "three_umd":  "https://unpkg.com/three@0.150.0/build/three.min.js",
      "react_umd":  ["https://unpkg.com/react@18.2.0/umd/react.production.min.js",
                     "https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"],
      "babel_umd":  "https://unpkg.com/@babel/standalone/babel.min.js",
      "importmap":  { "three": "https://esm.sh/three@0.150.0" }
    },

    // --- per-side harness recipe ---
    "sides": {
      "monolith": { "mode": "eval-jsx", "mount": "#root", "render": "react",
                    "root_export": "MegazordStudio",
                    "exports": ["MegazordStudio", "MatPool", "ArcaneAudio", "bus"] },
      "modular":  { "mode": "module", "mount": "#studio-root", "render": "react",
                    "entry": "/modular/ui/studio.js", "entry_export": "default",
                    "side_imports": [
                      { "from": "/modular/gfx/mat-pool.js", "binding": "MatPool",     "expose": "MatPool" },
                      { "from": "/modular/audio/index.js",  "binding": "ArcaneAudio", "expose": "ArcaneAudio" },
                      { "from": "/modular/core/index.js",   "binding": "bus",         "expose": "bus" }
                    ],
                    "init": ["MatPool.initialize(THREE)"] }
    },

    // --- optional: generic HUD probes replacing the hardcoded three ---
    "hud_probes": [
      { "id": "panel_inspector", "kind": "button_text", "match": "inspector" }
    ],

    // --- optional: settings scrub. null/absent => scrubEngineSettings SKIPS ---
    "settings_presets": null
  }
}
```

### `sides[*].mode` — the three recipes

| mode | What the harness does | Use for |
|---|---|---|
| `"html"` | **NEW, and the priority deliverable.** Reads the side's own entry HTML, injects `<script>recorder</script>` + the `__TRACE_*` config into `<head>` **before every other script/importmap**, serves it with the side's directory mounted as static root. No transpile, no eval, no CDN pins. | Any ordinary THREE.js project (each version is an `index.html` + modules). **This is the general-purpose path.** |
| `"eval-jsx"` | Today's monolith path, now parameterised: vendor pins, the strip-imports regex, the `new Function` eval, the returned `exports` list, the mount id and `root_export`. | A single-file `.jsx` / `.bak` monolith. Preserves Megazord. |
| `"module"` | Today's modular path, now parameterised: importmap, `entry` + `entry_export`, `side_imports[]`, `expose` names, `init[]` statements, mount id. | An ES-module tree with no HTML entry. Preserves Megazord. |

`"render": "react"` keeps the existing `RemountWrapper` + `createRoot` path (needed by
`scrubRemountStress`). `"render": "none"` means the entry self-mounts — the harness just
imports it and waits for `ready.global`. `mode: "html"` implies `render: "none"`.

### Trust note (deliberate)

`init[]` and `side_imports[]` are injected into the harness as literal JS. `parity.config.json`
is trusted input at the same level as the source it audits — both are already executed by the
harness. Do not build a sandbox or an expression parser. Do add one line to the QUICKSTART
saying config is trusted input.

---

## 3. Steps

Tick each as you go. Every step ends with a runnable check.

### S0 — config plumbing
- [ ] `scripts/lib/sij.cjs` — extend `loadConfig()` to normalise `cfg.runtime`, filling defaults
      that reproduce today's Megazord behaviour when the block is absent or partial.
      Deep-merge per key, not whole-object replace: a config setting only
      `runtime.sides.modular.entry` must keep every default vendor pin.
- [ ] Validate loudly: unknown `mode`, missing `entry` for `mode:"module"`, missing entry HTML
      for `mode:"html"` → throw with the offending config path in the message. Never silently default.
- [ ] Add a `--dry-run` flag to 06: write harnesses, skip the sink/server, exit 0.
- [ ] *Check:* `node scripts/06-behavior-trace.cjs --config examples/demo/parity.config.json --dry-run`
      — evidence: `scripts/lib/sij.cjs :: loadConfig`

### S1 — 06 harness builders become template-driven
- [ ] Replace `buildMonolithHarness` / `buildModularHarness` with one
      `buildHarness(cfg, side, recorderJs, project, sinkUrl)` dispatching on `mode`. Keep the two
      old names as thin wrappers **only if** something else calls them — grep first; if nothing
      does, delete them.
- [ ] Implement `mode:"html"`: read the side's entry HTML (`sides[side].entry_html` →
      `<side>.entry_html` → `<side>.root/index.html`), inject the recorder config +
      `<script>${recorderJs}</script>` immediately after `<head>` (before any importmap, which
      must stay the page's own), leave the rest byte-untouched.
- [ ] Implement `mode:"eval-jsx"` and `mode:"module"` as parameterised versions of the current
      literals. **Every Megazord identifier must come from config, none from source.**
- [ ] `serveStatic()` L230-258: mount each side's root generically (today `dist/` → `/modular/*`).
      Keep `/modular/*` working; add `/monolith/*` for the html/module modes.
- [ ] *Check:* the backward-compat gate in S3.
      — evidence: `scripts/06-behavior-trace.cjs :: buildHarness`

### S2 — trace-recorder seams
The recorder currently reads globals by literal name. Make it read them from the injected config.
- [ ] Emit `window.__PARITY_RUNTIME = <runtime block>` alongside the existing `__TRACE_SINK_URL` /
      `__TRACE_SIDE` / `__TRACE_PROJECT` / `__PIXEL_PRESETS` injection (06 L58, L155).
- [ ] `waitForReady()` L1333 — read `__PARITY_RUNTIME.ready.global` / `.timeout_ms` instead of the
      literal `__viewport` / `READY_TIMEOUT_MS`. Keep the existing defaults.
- [ ] `hookMatPool` / `scrubAudio` / `hookBus` call sites — resolve the global by configured name;
      `null` name → skip with the existing "not available — skipping" log path (already written,
      just route to it).
- [ ] `snapshotHUD()` L162-169 — drive the panel probes from `hud_probes[]`. Default array =
      today's three literals so Megazord output is unchanged. Keep the generic
      `button count` / `button titles` / `canvas size` capture exactly as-is.
- [ ] `scrubEngineSettings()` L1150 — if `settings_presets` is null/absent, record
      `trace.settings_scrub = { skipped: true, reason: "no settings_presets configured" }` and
      return. Otherwise drive the existing loop from the configured presets. Megazord's config
      supplies today's three presets + five brightness values, so its trace is unchanged.
- [ ] **Do not touch** `snapshotScene`, `captureGpuTelemetry`, `captureSceneCensus`,
      `captureRendererConfig`, `captureCameraState`, `captureSceneConfig`, `captureMaterialsDeep`,
      `captureSceneGraphHash`, `scrubPixelPresets`, `scrubAnimationSeries`. They are already
      generic THREE.js code and are the whole value of stages 12–15. Changing them is a regression.
      — evidence: `scripts/lib/trace-recorder.js :: waitForReady`

### S3 — prove Megazord is untouched (BLOCKING)
- [ ] Before any edit: `node scripts/06-behavior-trace.cjs --config <megazord parity.config.json> --dry-run`
      and save both harness HTMLs as the golden baseline. If the megazord config is not at hand,
      synthesise one from the CURRENT hardcoded literals — they are the spec for the defaults.
- [ ] After S1+S2: regenerate with `runtime` ABSENT. **Byte-identical to the baseline**
      (`sha256sum`). Not "equivalent". Identical.
- [ ] Then write `examples/megazord.runtime.config.jsonc` containing the explicit `runtime` block
      that reproduces the defaults, and prove it ALSO produces the byte-identical harness. This is
      the round-trip proof that the config surface is complete.
- [ ] *Check:* both hashes match. Record them in the CHANGELOG entry.
      — attest

### S4 — a real generic fixture
- [ ] `examples/demo-three/` — two tiny THREE.js apps, `a/index.html` and `b/index.html`, each
      ~80 lines, no build step, no npm deps, loading three from the configured CDN. Each exposes
      `window.__viewport = { scene, renderer, camera }`. No MatPool, no audio, no bus — this fixture
      exists to prove the harness works when those are ABSENT.
- [ ] Plant exactly three divergences in `b`, one per stage: a changed mesh (→13), a roughness
      change (→14), a removed per-frame light flicker (→15).
- [ ] `parity.config.json` with `runtime.sides.{monolith,modular}.mode = "html"` and
      `globals` all `null`.
- [ ] `examples/demo-three/README.md` listing the three planted bugs and which stage must catch each.
- [ ] *Check:* the fixture's harnesses generate and the three stages' `--selftest` still pass.
      — evidence: `examples/demo-three/README.md`

### S5 — selftest + docs
- [ ] Add `node scripts/06-behavior-trace.cjs --selftest` following the existing convention in
      `13-scenegraph-hash.cjs` / `15-anim-series.cjs`: no config, no browser, no network. It must
      assert (a) all three modes produce parseable HTML, (b) the recorder `<script>` precedes every
      other script tag in `mode:"html"` output, (c) an unknown mode throws, (d) an absent `runtime`
      block reproduces the S3 golden hash.
- [ ] `SKILL.md` — new section "Runtime adapter contract" after "When to require Stage 6": the
      `runtime` block, the three modes, and the `window.__viewport` requirement an app must satisfy.
- [ ] `QUICKSTART.md` §1 — add `runtime` to the config table; add the trusted-input line.
- [ ] `CHANGELOG.md` — new `## [R8] — <date>` entry with the S3 hashes.
- [ ] *Check:* `node scripts/06-behavior-trace.cjs --selftest` exits 0.
      — evidence: `scripts/06-behavior-trace.cjs :: selftest`

---

## 4. Out of scope (do not drift)

- Any change to stages 01–05, 05b, 07–11d, 12–15 **logic**. 07 may need to tolerate a
  `settings_scrub: { skipped: true }` section — that one-line guard is in scope; nothing else in
  07 is.
- Renaming `monolith`/`modular` to `a`/`b`. Tempting, breaks every existing config and all
  8 megazord `gate:*` scripts. A later SPEC can add aliases.
- The artifact-system integration. It is already config-driven and already optional.
- Fixing comments that mention Megazord. They are provenance, they are correct, leave them.
- Installing any npm dependency. The harness is Node-built-ins-only by law (SKILL.md
  "Operational rules" #3).

## 5. Definition of done

1. `node scripts/06-behavior-trace.cjs --selftest` → exit 0.
2. Megazord harness bytes unchanged, with and without an explicit `runtime` block (S3 hashes).
3. `examples/demo-three/` generates harnesses with zero app globals and no transpile.
4. `git log` shows one commit per step group, message citing SPEC-16.
5. No new dependency in `package.json`.
