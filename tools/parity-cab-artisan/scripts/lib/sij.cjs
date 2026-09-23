// sij.cjs — SIJ-compliant JSON writer/reader. All outputs share a stable envelope.
"use strict";

const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = "1.0.0";

function envelope(kind, side, entities, extra = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    schema_kind: "parity-cab/" + kind,
    generated_at: new Date().toISOString(),
    entity_id_strategy: "file_path::symbol_name",
    side: side || null,
    ...extra,
    entities,
  };
}

function writeSIJ(filePath, kind, side, entities, extra = {}) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const obj = envelope(kind, side, entities, extra);
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
  return obj;
}

function readSIJ(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function entityId(file, name) {
  // Normalize to posix relative path
  return file.replace(/\\/g, "/") + "::" + name;
}

const DEFAULT_RUNTIME = {
  ready: {
    global: "__viewport",
    timeout_ms: 20000
  },
  globals: {
    matpool: "MatPool",
    audio: "ArcaneAudio",
    bus: "bus"
  },
  vendor: {
    three_umd: "https://unpkg.com/three@0.150.0/build/three.min.js",
    react_umd: [
      "https://unpkg.com/react@18.2.0/umd/react.production.min.js",
      "https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"
    ],
    babel_umd: "https://unpkg.com/@babel/standalone/babel.min.js",
    importmap: {
      "three": "https://esm.sh/three@0.150.0",
      "react": "https://esm.sh/react@18.2.0",
      "react-dom": "https://esm.sh/react-dom@18.2.0",
      "react-dom/client": "https://esm.sh/react-dom@18.2.0/client",
      "react/jsx-runtime": "https://esm.sh/react@18.2.0/jsx-runtime"
    }
  },
  sides: {
    monolith: {
      mode: "eval-jsx",
      mount: "#root",
      render: "react",
      root_export: "MegazordStudio",
      exports: ["MegazordStudio", "MatPool", "ArcaneAudio", "bus"]
    },
    modular: {
      mode: "module",
      mount: "#studio-root",
      render: "react",
      entry: "/modular/ui/studio.js",
      entry_export: "default",
      side_imports: [
        { from: "/modular/gfx/mat-pool.js", binding: "MatPool", expose: "MatPool" },
        { from: "/modular/audio/index.js", binding: "ArcaneAudio", expose: "ArcaneAudio" },
        { from: "/modular/core/index.js", binding: "bus", expose: "bus" }
      ],
      init: ["MatPool.initialize(THREE)"]
    }
  },
  hud_probes: [
    { id: "panel_inspector", kind: "button_text", match: "inspector" }
  ],
  settings_presets: null
};

function deepMerge(target, source) {
  if (!source) return target;
  const result = Array.isArray(target) ? [...target] : Object.assign({}, target);
  for (const key of Object.keys(source)) {
    const sVal = source[key];
    const tVal = result[key];
    if (sVal !== undefined) {
      if (sVal === null) {
        result[key] = null;
      } else if (typeof sVal === "object" && !Array.isArray(sVal) && typeof tVal === "object" && !Array.isArray(tVal)) {
        result[key] = deepMerge(tVal, sVal);
      } else {
        result[key] = sVal;
      }
    }
  }
  return result;
}

function validateRuntime(runtime, baseDir, cfg) {
  const allowedModes = ["html", "eval-jsx", "module"];
  for (const side of ["monolith", "modular"]) {
    const s = runtime.sides && runtime.sides[side];
    if (!s) continue;
    if (!allowedModes.includes(s.mode)) {
      throw new Error(`Invalid runtime.sides.${side}.mode: "${s.mode}". Allowed: ${allowedModes.join(", ")}`);
    }
    if (s.mode === "module" && !s.entry) {
      throw new Error(`Missing required runtime.sides.${side}.entry for mode "module"`);
    }
    if (s.mode === "html") {
      let entryHtml = s.entry_html;
      if (entryHtml && !path.isAbsolute(entryHtml)) {
        entryHtml = path.resolve(baseDir, entryHtml);
      }
      if (!entryHtml && cfg && cfg[side] && cfg[side].root) {
        try {
          const r = path.isAbsolute(cfg[side].root) ? cfg[side].root : path.resolve(baseDir, cfg[side].root);
          if (fs.existsSync(r) && fs.statSync(r).isDirectory()) {
            entryHtml = path.join(r, "index.html");
          } else {
            entryHtml = r;
          }
        } catch (_) {}
      }
      if (!entryHtml || !fs.existsSync(entryHtml)) {
        throw new Error(`Missing entry HTML for mode "html" on side "${side}": ${entryHtml}`);
      }
      s.entry_html = entryHtml;
    }
  }
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error("Config file not found: " + configPath);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const clean = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const cfg = JSON.parse(clean);
  // Resolve relative roots against the config file's directory
  const baseDir = path.dirname(path.resolve(configPath));
  function abs(p) {
    return path.isAbsolute(p) ? p : path.resolve(baseDir, p);
  }
  if (cfg.monolith && cfg.monolith.root) cfg.monolith.root = abs(cfg.monolith.root);
  if (cfg.modular && cfg.modular.root)   cfg.modular.root  = abs(cfg.modular.root);
  if (cfg.out_dir)                       cfg.out_dir       = abs(cfg.out_dir);
  cfg.thresholds = cfg.thresholds || { parity_score_min: 0.85, max_high_open: 0 };
  cfg.risk_overrides = cfg.risk_overrides || {};

  // S0: Normalize cfg.runtime with deep-merge and loud validation
  cfg.runtime = deepMerge(DEFAULT_RUNTIME, cfg.runtime || {});
  validateRuntime(cfg.runtime, baseDir, cfg);
  return cfg;
}

// ── artifact-system integration (AC2.3 — config-driven, no hardcoded coupling) ──
// The RUNTIME gates (06/07/12/13) can OPTIONALLY mirror traces/verdicts to a
// running artifact-system UI. This resolves every artifact-system URL from
// config so the harness is portable — defaults reproduce the historical
// literals exactly (zero behavior change when a config omits these fields).
//   cfg.artifact_system_enabled : false → fully standalone (never probe/mirror);
//                                 "auto" (default) | true → probe, degrade if down.
//   cfg.artifact_system_base    : base origin (default "http://localhost:4201").
//   cfg.artifact_system_sink    : full /api/parity-trace URL (back-compat override).
//   cfg.local_sink_port         : standalone fallback sink port (default 4203).
function artifactSystem(cfg) {
  cfg = cfg || {};
  const base = String(cfg.artifact_system_base || "http://localhost:4201").replace(/\/+$/, "");
  const sink = cfg.artifact_system_sink || (base + "/api/parity-trace");
  let enabled = cfg.artifact_system_enabled;
  if (enabled === undefined || enabled === null) enabled = "auto";
  return {
    enabled,                         // false | "auto" | true
    base,                            // e.g. http://localhost:4201
    sink,                            // .../api/parity-trace
    health:    base + "/api/health",
    artifact:  base + "/api/artifact",
    telemetry: base + "/api/cab-telemetry",
  };
}

function localSinkPort(cfg) {
  return (cfg && cfg.local_sink_port) || 4203;
}

// Reachability probe that respects an explicit standalone opt-out. Returns false
// immediately when integration is disabled (so a standalone project never even
// opens a socket), else pings /api/health with a short timeout.
async function probeArtifactSystem(cfg) {
  const as = artifactSystem(cfg);
  if (as.enabled === false) return false;
  try {
    const r = await fetch(as.health, { signal: AbortSignal.timeout(500) });
    return r.ok;
  } catch (_) {
    return false;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { args[key] = next; i++; }
      else { args[key] = true; }
    }
  }
  return args;
}

module.exports = { envelope, writeSIJ, readSIJ, entityId, loadConfig, parseArgs, SCHEMA_VERSION, artifactSystem, localSinkPort, probeArtifactSystem, DEFAULT_RUNTIME };
