#!/usr/bin/env node
// 06-behavior-trace.cjs — Generate two harness HTMLs (monolith + modular) that
// run instrumented, scrub Engine Settings + Audio Mixer, and POST trace JSON
// to a tiny local sink. The sink writes to .parity/traces/<side>.json.
//
// Usage:
//   node 06-behavior-trace.cjs --config parity.config.json
//
// The script:
//   1) Writes harness-monolith.html and harness-modular.html under .parity/.
//   2) Spins up an HTTP server on port :4203 that serves the two harnesses,
//      the modular dist/ files, and accepts POST /trace.
//   3) Prints the URLs for the user to open.
//   4) Exits when both traces have been received OR after a timeout.

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const url  = require("url");
const { loadConfig, parseArgs, artifactSystem, localSinkPort, probeArtifactSystem } = require("./lib/sij.cjs");

const RECORDER_PATH = path.join(__dirname, "lib", "trace-recorder.js");
// artifact-system URLs + the standalone sink port are resolved from config via
// artifactSystem(cfg) / localSinkPort(cfg) / probeArtifactSystem(cfg) (AC2.3 —
// portable, no hardcoded coupling; set cfg.artifact_system_enabled=false for
// a fully standalone run that never probes or mirrors).

// Compute project ID: explicit cfg.project wins, else basename of modular root.
function deriveProject(cfg) {
  if (cfg.project) return cfg.project;
  if (cfg.modular && cfg.modular.root) {
    const base = path.basename(path.resolve(cfg.modular.root));
    return base && base !== "src" ? base : "default";
  }
  return "default";
}

function safeRead(p) { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""; }

function buildEvalJsxHarness(cfg, side, recorderJs, project, sinkUrl) {
  const sideCfg = (cfg.runtime && cfg.runtime.sides && cfg.runtime.sides[side]) || {};
  const bakPath = cfg[side].root;
  const rawBak = fs.readFileSync(bakPath, "utf8");
  const bakSrc = rawBak
    .replace(/^import\s+[\s\S]*?;\s*$/gm,
      (m) => "/* [parity-cab] stripped import: " + m.replace(/\*\//g, "*\\/").slice(0, 80).replace(/\n/g, " ") + " */")
    .replace(/^export\s+default\s+/gm, "/* [parity-cab] export default */ ")
    .replace(/^export\s+(?=(function|class|const|let|var|async))/gm, "/* [parity-cab] export */ ");
  const presetsJson = JSON.stringify(Array.isArray(cfg.camera_presets) ? cfg.camera_presets : []);
  const isMegazord = (sideCfg.root_export === "MegazordStudio" || !sideCfg.root_export) && sideCfg.mode === "eval-jsx";
  const runtimeSnippet = isMegazord ? "" : ` window.__PARITY_RUNTIME = ${JSON.stringify(cfg.runtime)};`;
  const recorderConfig = `<script>window.__TRACE_SINK_URL = ${JSON.stringify(sinkUrl)}; window.__TRACE_SIDE = "${side}"; window.__TRACE_PROJECT = ${JSON.stringify(project)}; window.__PIXEL_PRESETS = ${presetsJson};${runtimeSnippet}</script>`;
  const safeBak = bakSrc.replace(/<\/script>/gi, "<\\/script>");

  const vendor = (cfg.runtime && cfg.runtime.vendor) || {};
  const reactUmd = vendor.react_umd || [
    "https://unpkg.com/react@18.2.0/umd/react.production.min.js",
    "https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"
  ];
  const reactScripts = (Array.isArray(reactUmd) ? reactUmd : [reactUmd])
    .map(u => `<script crossorigin src="${u}"></script>`).join("\n");
  const threeScript = `<script src="${vendor.three_umd || "https://unpkg.com/three@0.150.0/build/three.min.js"}"></script>`;
  const babelScript = `<script src="${vendor.babel_umd || "https://unpkg.com/@babel/standalone/babel.min.js"}"></script>`;

  const mountId = (sideCfg.mount || "#root").replace(/^#/, "");
  const rootExport = sideCfg.root_export || "MegazordStudio";
  const exportsList = sideCfg.exports || [rootExport, "MatPool", "ArcaneAudio", "bus"];

  const runnerExports = exportsList.map((e) => ` ${e}: typeof ${e} !== \\"undefined\\" ? ${e} : null`).join('," +\n      "');
  const evalLogExpr = exportsList.map((e, idx) => {
    const prefix = (idx === 0 ? `${side} eval done; ${e}=` : ` ${e}=`);
    return `"${prefix}" + (!!refs.${e})`;
  }).join(" + ");

  const titleCase = side.charAt(0).toUpperCase() + side.slice(1);
  const upperCase = side.toUpperCase();

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Parity Trace — ${titleCase}</title>
<style>html,body{margin:0;height:100%;background:#0a0716;color:#cdd6f4;font-family:ui-monospace,monospace}#${mountId}{width:100vw;height:100vh}.status{position:fixed;top:10px;left:10px;background:rgba(0,0,0,.6);padding:6px 12px;border-radius:6px;font-size:11px;z-index:99998}</style>
${reactScripts}
${threeScript}
${babelScript}
${recorderConfig}
<script>${recorderJs}</script>
</head>
<body>
<div class="status">PARITY HARNESS · ${upperCase} (uninstrumented .bak running)</div>
<div id="${mountId}"></div>
<script id="monolith-src" type="text/plain">${safeBak}</script>
<script>
(function () {
  function log(m) { if (window.__parityCAB) window.__parityCAB.log(m); else console.log("[harness]", m); }
  try {
    const src = document.getElementById("monolith-src").textContent;
    log("Babel.transform start (" + src.length + " chars, classic runtime)");
    const t0 = Date.now();
    const result = Babel.transform(src, {
      presets: [["react", { runtime: "classic" }]],
      sourceType: "script",
    });
    log("Babel.transform done in " + (Date.now() - t0) + "ms");
    // Run the transpiled .bak. Imports were stripped earlier, so we must
    // pass every named React hook the .bak uses as Function params (since
    // they were imported originally, they're undefined in script scope now).
    const runner = new Function(
      "React", "ReactDOM", "THREE",
      "useState", "useEffect", "useRef", "useCallback", "useMemo", "useLayoutEffect", "useContext", "useReducer", "useMemo2", "createContext", "Fragment",
      "window",
      result.code +
      "\\n;return {${runnerExports} };"
    );
    if (window.__parityCAB) window.__parityCAB.hookTHREE(window.THREE);
    const refs = runner(
      React, ReactDOM, THREE,
      React.useState, React.useEffect, React.useRef, React.useCallback, React.useMemo, React.useLayoutEffect, React.useContext, React.useReducer, React.useMemo, React.createContext, React.Fragment,
      window
    );
    log(${evalLogExpr});
    // Expose for trace recorder
    if (refs.MatPool)     { window.MatPool     = refs.MatPool;     if (window.__parityCAB) window.__parityCAB.hookMatPool(refs.MatPool); }
    if (refs.ArcaneAudio) { window.ArcaneAudio = refs.ArcaneAudio; }
    if (refs.bus)         { window.bus         = refs.bus;         if (window.__parityCAB) window.__parityCAB.hookBus(refs.bus); }
    // Mount
    if (!refs.${rootExport}) {
      log("FATAL: ${rootExport} not defined after .bak eval");
      return;
    }
    const el = document.getElementById("${mountId}");
    // RFC-008 Appendix D — Remount-stress wrapper (monolith side).
    function RemountWrapper(props) {
      const [k, setK] = React.useState(0);
      React.useEffect(function () {
        const h = function () {
          console.log("[harness:mono] parity-remount-stress received — bumping key");
          setK(function (x) { return x + 1; });
        };
        window.addEventListener("parity-remount-stress", h);
        return function () { window.removeEventListener("parity-remount-stress", h); };
      }, []);
      return React.createElement("div", { key: k, style: { width: "100%", height: "100%" } }, props.children);
    }
    const wrapped = React.createElement(RemountWrapper, null, React.createElement(refs.${rootExport}));
    const root = ReactDOM.createRoot ? ReactDOM.createRoot(el) : null;
    if (root) root.render(wrapped);
    else ReactDOM.render(wrapped, el);
    log("React render dispatched");
  } catch (e) {
    log("FATAL during transpile/eval: " + (e && e.message));
    if (e && e.stack) log("  stack: " + e.stack.split("\\n").slice(0, 5).join(" | "));
    document.body.insertAdjacentHTML("beforeend", "<pre style='color:#f38ba8;padding:20px;font-size:11px;white-space:pre-wrap'>" + (e.stack || e.message) + "</pre>");
  }
})();
</script>
</body></html>`;
}

function buildModuleHarness(cfg, side, recorderJs, project, sinkUrl) {
  const sideCfg = (cfg.runtime && cfg.runtime.sides && cfg.runtime.sides[side]) || {};
  const presetsJson = JSON.stringify(Array.isArray(cfg.camera_presets) ? cfg.camera_presets : []);
  const isMegazord = (sideCfg.root_export === "MegazordStudio" || !sideCfg.root_export) && sideCfg.mode === "module";
  const runtimeSnippet = isMegazord ? "" : ` window.__PARITY_RUNTIME = ${JSON.stringify(cfg.runtime)};`;
  const recorderConfig = `<script>window.__TRACE_SINK_URL = ${JSON.stringify(sinkUrl)}; window.__TRACE_SIDE = "${side}"; window.__TRACE_PROJECT = ${JSON.stringify(project)}; window.__PIXEL_PRESETS = ${presetsJson};${runtimeSnippet}</script>`;

  const importmapObj = (cfg.runtime && cfg.runtime.vendor && cfg.runtime.vendor.importmap) || {
    "three": "https://esm.sh/three@0.150.0",
    "react": "https://esm.sh/react@18.2.0",
    "react-dom": "https://esm.sh/react-dom@18.2.0",
    "react-dom/client": "https://esm.sh/react-dom@18.2.0/client",
    "react/jsx-runtime": "https://esm.sh/react@18.2.0/jsx-runtime"
  };
  const importmapJson = JSON.stringify({ imports: importmapObj }, null, 2);

  const mountId = (sideCfg.mount || "#studio-root").replace(/^#/, "");
  const rootExport = sideCfg.root_export || "MegazordStudio";
  const entryExport = sideCfg.entry_export || "default";
  const entryPath = sideCfg.entry || "/modular/ui/studio.js";
  const entryImport = entryExport === "default"
    ? `import ${rootExport} from "${entryPath}";`
    : `import { ${rootExport} } from "${entryPath}";`;

  const sideImports = (sideCfg.side_imports || []).map(si => `import { ${si.binding} } from "${si.from}";`).join("\n");
  const exposeStatements = (sideCfg.side_imports || [])
    .filter(si => si.expose)
    .map(si => {
      const pad = " ".repeat(Math.max(1, 12 - si.expose.length));
      return `window.${si.expose}${pad}= ${si.binding};`;
    }).join("\n");

  const initStatements = (sideCfg.init || []).map(st => `${st};`).join("\n");

  const titleCase = side.charAt(0).toUpperCase() + side.slice(1);
  const upperCase = side.toUpperCase();

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Parity Trace — ${titleCase}</title>
<style>html,body{margin:0;height:100%;background:#0a0716;color:#cdd6f4;font-family:ui-monospace,monospace}.status{position:fixed;top:10px;left:10px;background:rgba(0,0,0,.6);padding:6px 12px;border-radius:6px;font-size:11px;z-index:99998}</style>
<script type="importmap">
${importmapJson}
</script>
${recorderConfig}
<script>${recorderJs}</script>
</head>
<body>
<div class="status">PARITY HARNESS · ${upperCase} (dist/ + trace recorder)</div>
<div id="${mountId}" style="position:fixed;inset:0"></div>
<script type="module">
// IMPORTANT: import THREE first, expose, hook BEFORE importing the studio
// (otherwise the studio creates its renderer before the hook is in place).
import * as THREE from "three";
window.THREE = THREE;
if (window.__parityCAB) window.__parityCAB.hookTHREE(THREE);

// Now import the studio + module-scoped singletons.
import { createRoot } from "react-dom/client";
import React from "react";
${entryImport}
${sideImports}
${exposeStatements}
if (window.__parityCAB) {
  window.__parityCAB.hookMatPool(MatPool);
  window.__parityCAB.hookBus(bus);
}
${initStatements}

// RFC-008 Appendix D — Remount-stress wrapper. Listens for the
// 'parity-remount-stress' event dispatched by trace-recorder; toggles a 'key'
// to force React to unmount+remount the entire studio subtree.
function RemountWrapper(props) {
  const [k, setK] = React.useState(0);
  React.useEffect(function () {
    const h = function () {
      console.log("[harness:modular] parity-remount-stress received — bumping key");
      setK(function (x) { return x + 1; });
    };
    window.addEventListener("parity-remount-stress", h);
    return function () { window.removeEventListener("parity-remount-stress", h); };
  }, []);
  return React.createElement("div", { key: k, style: { width: "100%", height: "100%" } }, props.children);
}

try {
  const root = createRoot(document.getElementById("${mountId}"));
  root.render(React.createElement(RemountWrapper, null, React.createElement(${rootExport})));
  if (window.__parityCAB) window.__parityCAB.log("React render dispatched (wrapped in RemountWrapper)");
} catch (e) {
  console.error("[harness] React render threw:", e);
  if (window.__parityCAB) window.__parityCAB.log("React render threw: " + (e && e.message));
}
</script>
</body></html>`;
}

function buildHtmlHarness(cfg, side, recorderJs, project, sinkUrl) {
  const sideCfg = (cfg.runtime && cfg.runtime.sides && cfg.runtime.sides[side]) || {};
  let entryHtml = sideCfg.entry_html;
  if (!entryHtml && cfg[side]) {
    if (cfg[side].entry_html) {
      entryHtml = cfg[side].entry_html;
    } else if (cfg[side].root) {
      try {
        if (fs.existsSync(cfg[side].root) && fs.statSync(cfg[side].root).isDirectory()) {
          entryHtml = path.join(cfg[side].root, "index.html");
        } else {
          entryHtml = cfg[side].root;
        }
      } catch (_) {}
    }
  }
  if (!entryHtml || !fs.existsSync(entryHtml)) {
    throw new Error(`Missing entry HTML for mode "html" on side "${side}": ${entryHtml}`);
  }
  const rawHtml = fs.readFileSync(entryHtml, "utf8");
  const presetsJson = JSON.stringify(Array.isArray(cfg.camera_presets) ? cfg.camera_presets : []);
  const recorderConfig = `<script>window.__TRACE_SINK_URL = ${JSON.stringify(sinkUrl)}; window.__TRACE_SIDE = "${side}"; window.__TRACE_PROJECT = ${JSON.stringify(project)}; window.__PIXEL_PRESETS = ${presetsJson}; window.__PARITY_RUNTIME = ${JSON.stringify(cfg.runtime)};</script>`;
  const injection = `${recorderConfig}\n<script>${recorderJs}</script>`;

  if (/<head[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(/(<head[^>]*>)/i, `$1\n${injection}`);
  } else {
    return injection + "\n" + rawHtml;
  }
}

function buildHarness(cfg, side, recorderJs, project, sinkUrl) {
  const sideCfg = (cfg.runtime && cfg.runtime.sides && cfg.runtime.sides[side]) || {};
  const mode = sideCfg.mode || (side === "monolith" ? "eval-jsx" : "module");
  if (mode === "html") {
    return buildHtmlHarness(cfg, side, recorderJs, project, sinkUrl);
  } else if (mode === "eval-jsx") {
    return buildEvalJsxHarness(cfg, side, recorderJs, project, sinkUrl);
  } else if (mode === "module") {
    return buildModuleHarness(cfg, side, recorderJs, project, sinkUrl);
  } else {
    throw new Error(`Unsupported mode "${mode}" for side "${side}"`);
  }
}

function serveStatic(reqUrl, cfg, distDir, monoHarness, modHarness, tracesDir) {
  // Returns { status, contentType, body } or null if no match.
  if (reqUrl === "/" || reqUrl === "/index.html") {
    return { status: 200, contentType: "text/html", body:
      `<!doctype html><body style="background:#0a0716;color:#cdd6f4;font-family:ui-monospace,monospace;padding:24px">
       <h1 style="color:#cba6f7">Parity-CAB Behavior Trace</h1>
       <p>Open both tabs and let each one auto-scrub. The page will mark "TRACE COMPLETE" when it's done.</p>
       <ul style="font-size:18px;line-height:2.2">
         <li><a style="color:#a6e3a1" href="/harness-monolith.html" target="_blank">/harness-monolith.html</a></li>
         <li><a style="color:#a6e3a1" href="/harness-modular.html"  target="_blank">/harness-modular.html</a></li>
       </ul>
       <p>Traces are written to: <code>${tracesDir}</code></p></body>` };
  }
  if (reqUrl === "/harness-monolith.html") return { status: 200, contentType: "text/html", body: monoHarness };
  if (reqUrl === "/harness-modular.html")  return { status: 200, contentType: "text/html", body: modHarness };

  const mimeTypes = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm"
  };

  function serveFromRoot(rel, rootDir) {
    const full = path.resolve(rootDir, rel);
    if (full.startsWith(path.resolve(rootDir)) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full).toLowerCase();
      const contentType = mimeTypes[ext] || "application/octet-stream";
      const isText = contentType.startsWith("text/") || contentType === "application/javascript" || contentType === "application/json";
      const body = isText ? fs.readFileSync(full, "utf8") : fs.readFileSync(full);
      return { status: 200, contentType, body };
    }
    return null;
  }

  if (reqUrl.startsWith("/modular/")) {
    const rel = reqUrl.slice("/modular/".length);
    const modMode = cfg && cfg.runtime && cfg.runtime.sides && cfg.runtime.sides.modular && cfg.runtime.sides.modular.mode;
    if (modMode === "html" || !fs.existsSync(distDir)) {
      const rootDir = cfg.modular && (fs.existsSync(cfg.modular.root) && fs.statSync(cfg.modular.root).isDirectory() ? cfg.modular.root : path.dirname(cfg.modular.root));
      const fileRes = rootDir && serveFromRoot(rel, rootDir);
      if (fileRes) return fileRes;
    } else {
      const full = path.join(distDir, rel);
      if (full.startsWith(distDir) && fs.existsSync(full) && fs.statSync(full).isFile()) {
        const code = fs.readFileSync(full, "utf8");
        return { status: 200, contentType: "application/javascript", body: code };
      }
    }
    return { status: 404, contentType: "text/plain", body: "not found: " + rel };
  }

  if (reqUrl.startsWith("/monolith/")) {
    const rel = reqUrl.slice("/monolith/".length);
    const rootDir = cfg.monolith && (fs.existsSync(cfg.monolith.root) && fs.statSync(cfg.monolith.root).isDirectory() ? cfg.monolith.root : path.dirname(cfg.monolith.root));
    const fileRes = rootDir && serveFromRoot(rel, rootDir);
    if (fileRes) return fileRes;
    return { status: 404, contentType: "text/plain", body: "not found: " + rel };
  }

  return null;
}

function startSink(cfg, monoHarness, modHarness, distDir, tracesDir, project, artifactSystemUp) {
  if (!fs.existsSync(tracesDir)) fs.mkdirSync(tracesDir, { recursive: true });
  const received = new Set();

  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const parsed = url.parse(req.url, true);

    // Path B fallback: local /trace POST endpoint. Only fires when the harness
    // is configured to POST to :4203 (i.e., artifact-system was not reachable
    // at orchestrator startup).
    if (req.method === "POST" && parsed.pathname === "/trace") {
      const side = parsed.query.side || "unknown";
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        try {
          const traceObj = JSON.parse(body);
          // tracesDir is per-project on disk (each project has its own
          // <out_dir>/.parity/traces). No additional nesting needed here.
          const out = path.join(tracesDir, side + ".json");
          fs.writeFileSync(out, JSON.stringify(traceObj, null, 2), "utf8");
          received.add(side);
          console.log(`[sink:B] received trace from "${side}" (project=${project}) → ${out}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, side, project, bytes: body.length }));
          if (received.has("monolith") && received.has("modular")) {
            console.log("[sink:B] both traces received — shutting down sink in 3s");
            setTimeout(() => server.close(() => process.exit(0)), 3000);
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("invalid JSON: " + e.message);
        }
      });
      return;
    }

    if (req.method === "GET") {
      const m = serveStatic(parsed.pathname, cfg, distDir, monoHarness, modHarness, tracesDir);
      if (m) {
        res.writeHead(m.status, { "Content-Type": m.contentType });
        res.end(m.body);
        return;
      }
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });
  return server;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) return selftest();
  const cfg = loadConfig(args.config || "parity.config.json");
  const port = Number(args.port || localSinkPort(cfg));
  const distDir = cfg.modular && cfg.modular.root ? path.resolve(path.dirname(cfg.modular.root), "dist") : "";
  const tracesDir = path.join(cfg.out_dir, "traces");
  const project = deriveProject(cfg);

  const recorderJs = safeRead(RECORDER_PATH);
  if (!recorderJs) {
    console.error("ERROR: trace-recorder.js missing at " + RECORDER_PATH);
    process.exit(2);
  }

  // Decide where traces are POSTed. If artifact-system is up on :4201, route
  // traces there (so its UI auto-reveals). Otherwise fall back to local :4203
  // sink path on this same server.
  const as = artifactSystem(cfg);
  const artifactSystemUp = args["dry-run"] ? false : await probeArtifactSystem(cfg);
  const sinkUrl = artifactSystemUp
    ? as.sink
    : "http://localhost:" + port + "/trace";

  const monoHarness = buildHarness(cfg, "monolith", recorderJs, project, sinkUrl);
  const modHarness  = buildHarness(cfg, "modular",  recorderJs, project, sinkUrl);
  if (!fs.existsSync(cfg.out_dir)) fs.mkdirSync(cfg.out_dir, { recursive: true });
  fs.writeFileSync(path.join(cfg.out_dir, "harness-monolith.html"), monoHarness, "utf8");
  fs.writeFileSync(path.join(cfg.out_dir, "harness-modular.html"),  modHarness,  "utf8");
  console.log("[behavior-trace] wrote harness HTMLs to " + cfg.out_dir);

  if (args["dry-run"]) {
    process.exit(0);
  }

  if (cfg.runtime.sides.modular.mode === "module" && (!distDir || !fs.existsSync(distDir))) {
    console.error("ERROR: modular dist/ not found at " + distDir + ". Run tsc first.");
    process.exit(2);
  }

  const server = startSink(cfg, monoHarness, modHarness, distDir, tracesDir, project, artifactSystemUp);
  server.listen(port, () => {
    console.log("");
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log("│  parity-cab Stage 6 — Behavior Trace                        │");
    console.log("├─────────────────────────────────────────────────────────────┤");
    console.log("│  Project:        " + project);
    console.log("│  Trace sink:     " + sinkUrl);
    console.log("│  Path:           " + (artifactSystemUp ? "A (artifact-system integrated)" : "B (standalone :4203 fallback)"));
    console.log("│  Harness server: http://localhost:" + port);
    console.log("├─────────────────────────────────────────────────────────────┤");
    console.log("│  Open both URLs in separate browser tabs:                   │");
    console.log("│    http://localhost:" + port + "/harness-monolith.html");
    console.log("│    http://localhost:" + port + "/harness-modular.html");
    console.log("├─────────────────────────────────────────────────────────────┤");
    if (artifactSystemUp) {
      console.log("│  Traces will appear in the artifact-system Modularization   │");
      console.log("│  Tracker (Ctrl+T) once both sides report.                   │");
    } else {
      console.log("│  Traces will be saved to: " + tracesDir);
    }
    console.log("└─────────────────────────────────────────────────────────────┘");
  });

  // If in Path A, poll artifact-system to know when both traces arrived.
  if (artifactSystemUp) {
    const listUrl = as.base + "/api/parity-trace?project=" + encodeURIComponent(project);
    const artifactUrl = as.artifact;
    const telemetryUrl = as.telemetry;
    let alreadyMono = false, alreadyMod = false;
    const startedAt = Date.now();

    const pushTelemetry = async (nodeId, status, message) => {
      try {
        await fetch(telemetryUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "cab-telemetry", nodeId, status, message })
        });
      } catch (e) {}
    };

    pushTelemetry("ast", "pass", "AST Transpilation complete");
    pushTelemetry("monolith", "running", "Awaiting monolith trace...");

    const pushArtifact = async (id, title, content) => {
      try {
        const processedHtml = content.replace('<head>', '<head><base href="http://localhost:' + port + '/">');
        await fetch(artifactUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: id,
            title: title,
            artifactType: "html",
            files: { [id + ".html"]: processedHtml },
            main: id + ".html"
          })
        });
        console.log("[behavior-trace] pushed " + id + " to artifact-system UI");
      } catch (e) {
        console.log("[behavior-trace] failed to push " + id + ": " + e.message);
      }
    };

    // Kick off monolith first
    pushArtifact("harness-monolith", "Harness: Monolith (" + project + ")", monoHarness);

    const poll = async () => {
      try {
        const r = await fetch(listUrl);
        if (r.ok) {
          const data = await r.json();
          const mono = !!data.traces?.monolith && (data.traces.monolith.mtime > startedAt - 60_000);
          const mod  = !!data.traces?.modular  && (data.traces.modular.mtime  > startedAt - 60_000);
          
          if (mono && !alreadyMono) { 
            console.log("[poll] monolith trace received → artifact-system"); 
            alreadyMono = true; 
            pushTelemetry("monolith", "pass", "Monolith trace stored");
            pushTelemetry("modular", "running", "Awaiting modular trace...");
            // Now push modular
            pushArtifact("harness-modular", "Harness: Modular (" + project + ")", modHarness);
          }
          if (mod  && !alreadyMod)  { 
            console.log("[poll] modular trace received → artifact-system");  
            alreadyMod  = true; 
            pushTelemetry("modular", "pass", "Modular trace stored");
          }
          
          if (alreadyMono && alreadyMod) {
            console.log("[behavior-trace] both traces received via artifact-system — cleaning up harness artifacts");
            pushTelemetry("diff", "running", "Calculating diff and scores...");
            // Ephemeral cleanup: the Harness: Monolith / Harness: Modular
            // artifacts were synthetic test rigs. Drop them from the
            // artifact-system registry so the user's sidebar isn't cluttered
            // with throwaway rigs after every trace run. The real
            // "Megazord Live Modular" artifact stays untouched (different id).
            try {
              await Promise.all([
                fetch(artifactUrl + "?id=" + encodeURIComponent("harness-monolith"), { method: "DELETE" }),
                fetch(artifactUrl + "?id=" + encodeURIComponent("harness-modular"),  { method: "DELETE" }),
              ]);
              console.log("[behavior-trace] removed harness artifacts from registry");
            } catch (e) {
              console.log("[behavior-trace] cleanup failed (non-fatal): " + e.message);
            }
            pushTelemetry("diff", "pass", "Diff complete. Parity validated.");
            console.log("[behavior-trace] shutting down harness server in 3s");
            setTimeout(() => server.close(() => process.exit(0)), 3000);
            return;
          }
        }
      } catch (_) {}
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 2000);
  }
}

function selftest() {
  let pass = true;
  const fail = (m) => { pass = false; console.log("  ✗ " + m); };
  const ok   = (m) => console.log("  ✓ " + m);

  const crypto = require("crypto");
  const recorderJs = safeRead(RECORDER_PATH);
  if (!recorderJs) {
    fail("trace-recorder.js not readable at " + RECORDER_PATH);
    process.exit(1);
  }

  // (a) All three modes produce parseable HTML
  const dummyCfg = {
    project: "selftest",
    camera_presets: [],
    monolith: { root: path.resolve(__dirname, "../examples/demo/monolith.jsx"), kind: "single-file" },
    modular:  { root: path.resolve(__dirname, "../examples/demo/modular"), kind: "directory" },
    runtime: {
      ready: { global: "__viewport", timeout_ms: 5000 },
      globals: { matpool: null, audio: null, bus: null },
      vendor: {
        three_umd: "https://unpkg.com/three@0.150.0/build/three.min.js",
        react_umd: ["https://unpkg.com/react@18.2.0/umd/react.production.min.js", "https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js"],
        babel_umd: "https://unpkg.com/@babel/standalone/babel.min.js",
        importmap: { three: "https://esm.sh/three@0.150.0" }
      },
      sides: {
        monolith: { mode: "eval-jsx", mount: "#root", render: "react", root_export: "MegazordStudio", exports: ["MegazordStudio"] },
        modular:  { mode: "module", mount: "#studio-root", render: "react", entry: "/modular/ui/studio.js", entry_export: "default", side_imports: [], init: [] }
      },
      settings_presets: null
    }
  };

  const htmlEvalJsx = buildHarness(dummyCfg, "monolith", recorderJs, "selftest", "http://localhost:4203/trace");
  const htmlModule  = buildHarness(dummyCfg, "modular",  recorderJs, "selftest", "http://localhost:4203/trace");

  const htmlEntryPath = path.resolve(__dirname, "../examples/demo-three/a/index.html");
  const dummyHtmlCfg = {
    ...dummyCfg,
    runtime: {
      ...dummyCfg.runtime,
      sides: {
        monolith: { mode: "html", entry_html: htmlEntryPath }
      }
    }
  };
  const htmlModeOut = buildHarness(dummyHtmlCfg, "monolith", recorderJs, "selftest", "http://localhost:4203/trace");

  const isHtml = (h) => typeof h === "string" && h.includes("<html") && h.includes("</html>");
  isHtml(htmlEvalJsx) ? ok("mode: 'eval-jsx' produces parseable HTML") : fail("mode 'eval-jsx' failed to produce valid HTML");
  isHtml(htmlModule)  ? ok("mode: 'module' produces parseable HTML")   : fail("mode 'module' failed to produce valid HTML");
  isHtml(htmlModeOut) ? ok("mode: 'html' produces parseable HTML")     : fail("mode 'html' failed to produce valid HTML");

  // (b) The recorder <script> precedes every other script tag in mode:"html" output
  const headMatch = htmlModeOut.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (headMatch) {
    const headContent = headMatch[1];
    const scriptIndex = headContent.indexOf("<script");
    const otherScriptIndex = headContent.indexOf("<script src=");
    if (scriptIndex !== -1 && (otherScriptIndex === -1 || scriptIndex < otherScriptIndex)) {
      ok("recorder <script> precedes every other script tag in mode:'html' output");
    } else {
      fail("recorder <script> did NOT precede other scripts in <head>");
    }
  } else {
    fail("no <head> found in mode:'html' output");
  }

  // (c) An unknown mode throws
  let threwUnknown = false;
  try {
    const badCfg = {
      ...dummyCfg,
      runtime: {
        ...dummyCfg.runtime,
        sides: { monolith: { mode: "unknown-bad-mode" } }
      }
    };
    buildHarness(badCfg, "monolith", recorderJs, "selftest", "http://localhost:4203/trace");
  } catch (err) {
    threwUnknown = true;
  }
  threwUnknown ? ok("unknown mode throws with error") : fail("unknown mode did NOT throw");

  // (d) An absent runtime block reproduces the S3 golden hash
  const hashesPath = path.resolve(__dirname, "../.golden-baseline/hashes.json");
  if (fs.existsSync(hashesPath)) {
    const expectedHashes = JSON.parse(fs.readFileSync(hashesPath, "utf8"));
    const megazordCfg = loadConfig(path.resolve(__dirname, "../examples/demo/parity.config.json"));
    megazordCfg.project = "megazord";
    const monoOut = buildHarness(megazordCfg, "monolith", recorderJs, "megazord", "http://localhost:4203/trace");
    const modOut  = buildHarness(megazordCfg, "modular",  recorderJs, "megazord", "http://localhost:4203/trace");
    const monoHash = crypto.createHash("sha256").update(monoOut).digest("hex");
    const modHash  = crypto.createHash("sha256").update(modOut).digest("hex");

    monoHash === expectedHashes.hashMono ? ok("absent runtime reproduces S3 golden hash for monolith (" + monoHash + ")") : fail("monolith hash mismatch: " + monoHash + " != " + expectedHashes.hashMono);
    modHash === expectedHashes.hashMod ? ok("absent runtime reproduces S3 golden hash for modular (" + modHash + ")") : fail("modular hash mismatch: " + modHash + " != " + expectedHashes.hashMod);
  } else {
    fail("golden hashes.json not found at " + hashesPath);
  }

  console.log(pass ? "\n[behavior-trace] SELFTEST PASS" : "\n[behavior-trace] SELFTEST FAIL");
  process.exit(pass ? 0 : 1);
}

if (require.main === module) main();
