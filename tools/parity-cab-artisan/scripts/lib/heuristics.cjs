// heuristics.cjs — Domain / risk / volatility classifiers.
// All rules deterministic. No LLM in the loop.
"use strict";

// Path-segment → domain. Highest priority match wins (top of array).
const DOMAIN_RULES = [
  { test: /(^|\/)creator\//,  domain: "creator" },
  { test: /(^|\/)scene\//,    domain: "scene" },
  { test: /(^|\/)audio\//,    domain: "audio" },
  { test: /(^|\/)ui\//,       domain: "ui" },
  { test: /(^|\/)gfx\//,      domain: "gfx" },
  { test: /(^|\/)physics\//,  domain: "physics" },
  { test: /(^|\/)data\//,     domain: "data" },
  { test: /(^|\/)types?\//,   domain: "types" },
  { test: /(^|\/)core\//,     domain: "core" },
  { test: /(^|\/)utils?\//,   domain: "utils" },
];

// Symbol-name → domain (used for the monolith, where everything is in one file).
const SYMBOL_DOMAIN_RULES = [
  { test: /^mk[A-Z]/,                    domain: "creator" },  // mkBookshelf, mkCauldron…
  { test: /^make[A-Z]/,                  domain: "ui" },       // makeShowcase, makeSingle
  { test: /^(build|mount)[A-Z]/,         domain: "scene" },    // buildGuildHall, mountViewport
  { test: /(NPC|Brain)/,                 domain: "creator" },
  { test: /^Mat(Pool)?$/,                domain: "gfx" },
  { test: /(Audio|Sound|Mixer)/,         domain: "audio" },
  { test: /(Panel|Studio|Inspector|Console|Chat|Viewport|Entity)/, domain: "ui" },
  { test: /(Physics|enforce)/,           domain: "physics" },
  { test: /^(T|theme|hexToRGB|toThreeColor|blendColors|lighten|darken)$/, domain: "core" },
  { test: /(MANIFEST|CREATORS|PRESETS|TAGS)/, domain: "data" },
  { test: /^(phi|phiSplit|ZTP|finalizeGroup|uid|bus|EventBus)/, domain: "core" },
];

function classifyDomain(file, name) {
  for (const r of DOMAIN_RULES) if (r.test.test(file.replace(/\\/g, "/"))) return r.domain;
  for (const r of SYMBOL_DOMAIN_RULES) if (r.test.test(name)) return r.domain;
  return "unknown";
}

// Kind-level base risk. Tunable via config.risk_overrides.
const BASE_RISK_BY_DOMAIN = {
  core: "high",
  scene: "med",
  gfx: "med",
  physics: "med",
  data: "med",
  creator: "low",
  audio: "low",
  ui: "low",
  types: "low",
  utils: "low",
  unknown: "med",
};

const VOLATILITY_FROM_STABILITY = {
  FROZEN: "frozen",
  STABLE: "stable",
  DRAFT:  "draft",
  EXPERIMENTAL: "experimental",
};

function classifyVolatility(jsdoc) {
  if (!jsdoc || !jsdoc.stability) return "unknown";
  return VOLATILITY_FROM_STABILITY[jsdoc.stability] || "unknown";
}

// Risk for an *existing* symbol (pre-diff). Diff stage escalates further.
function classifyRisk(domain, kind, exported) {
  if (!exported) return "info";
  const base = BASE_RISK_BY_DOMAIN[domain] || "med";
  // Components & top-level scene/audio/core functions are louder
  if (kind === "component" && (domain === "scene" || domain === "core")) return "high";
  return base;
}

// Risk *escalation* on diff:
//   gap = "missing" (in monolith, not in modular)  → +2 levels
//   gap = "new"     (in modular, not in monolith)  → +1 level
//   gap = "diverged"                                → +1 level
const RISK_LEVELS = ["info", "low", "med", "high", "critical"];
function escalate(risk, levels) {
  const idx = RISK_LEVELS.indexOf(risk);
  if (idx < 0) return "med";
  const next = Math.min(RISK_LEVELS.length - 1, idx + levels);
  return RISK_LEVELS[next];
}

const ESCALATION_BY_GAP = {
  missing:  2,
  diverged: 1,
  new:      1,
};

function classifyGapRisk(baseRisk, gap, overrides = {}) {
  if (overrides[gap] != null) return overrides[gap];
  return escalate(baseRisk, ESCALATION_BY_GAP[gap] || 0);
}

module.exports = {
  classifyDomain,
  classifyVolatility,
  classifyRisk,
  classifyGapRisk,
  escalate,
  RISK_LEVELS,
};
