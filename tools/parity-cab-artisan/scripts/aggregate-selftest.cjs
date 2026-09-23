#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const RUN_ALL = path.join(ROOT, "scripts", "run-all.cjs");
const TEMP_BASE = path.resolve(os.tmpdir());
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };

function contained(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function configAt(dir, fields) {
  const config = path.join(dir, "parity config.json");
  write(config, JSON.stringify({
    project: "aggregate-selftest",
    profile: "library",
    run_id: fields.run_id,
    monolith: { root: fields.monolith, kind: "single-file" },
    modular: { root: fields.modular, kind: "directory" },
    out_dir: fields.out_dir,
    thresholds: { parity_score_min: 0.85, max_high_open: 0 },
    risk_overrides: {},
  }, null, 2));
  return config;
}

function run(config) {
  return spawnSync(process.execPath, [RUN_ALL, "--config", config], {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
  });
}

function assertVerdict(result, outDir, expectedDecision, expectedExit) {
  assert(result.error === undefined, `spawn failed: ${result.error && result.error.message}`);
  assert(result.status === expectedExit,
    `expected exit ${expectedExit}, got ${result.status}; stderr=${result.stderr}`);

  const evidencePath = path.join(outDir, "aggregate-verdict.sij.json");
  const verdict = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const evidenceHash = sha256(evidencePath);

  assert(verdict.decision === expectedDecision && verdict.exit_code === expectedExit,
    `expected ${expectedDecision}/${expectedExit}, got ${verdict.decision}/${verdict.exit_code}`);
  assert(verdict.invoked && verdict.invoked.root === ROOT &&
    verdict.invoked.path === RUN_ALL && verdict.invoked.shell === false,
    "aggregate invocation provenance missing");
  assert(verdict.run_id && verdict.profile === "library",
    "aggregate run identity missing");
  assert(Array.isArray(verdict.children) &&
    verdict.children.every((child) => child.shell === false &&
      Array.isArray(child.argv) && child.executable === process.execPath),
    "child argv/shell contract missing");

  return { verdict, evidencePath, evidenceHash };
}

function main() {
  const temp = fs.mkdtempSync(path.join(TEMP_BASE, "parity-cab-aggregate-"));
  assert(contained(temp, TEMP_BASE), `refusing temp directory outside ${TEMP_BASE}: ${temp}`);
  const receipts = [];

  try {
    const goodDir = path.join(temp, "good");
    const goodMono = path.join(goodDir, "monolith.js");
    const goodMod = path.join(goodDir, "modular");
    write(goodMono, "export function ring(r) { return r * 2; }\n");
    write(path.join(goodMod, "core.js"), "export function ring(r) { return r * 2; }\n");

    const goodResult = assertVerdict(run(configAt(goodDir, {
      run_id: "aggregate-good",
      monolith: goodMono,
      modular: goodMod,
      out_dir: path.join(goodDir, "evidence"),
    })), path.join(goodDir, "evidence"), "GO", 0);
    assert(goodResult.verdict.children.at(-1).gate_id === "05" &&
      goodResult.verdict.children.at(-1).decision === "GO", "GO child decision missing");
    receipts.push({ decision: "GO", path: goodResult.evidencePath, sha256: goodResult.evidenceHash });

    const demo = path.join(ROOT, "examples", "demo");
    const noGoDir = path.join(temp, "no-go");
    const noGoResult = assertVerdict(run(configAt(noGoDir, {
      run_id: "aggregate-no-go",
      monolith: path.join(demo, "monolith.jsx"),
      modular: path.join(demo, "modular"),
      out_dir: path.join(noGoDir, "evidence"),
    })), path.join(noGoDir, "evidence"), "NO-GO", 1);
    assert(noGoResult.verdict.children.at(-1).gate_id === "05" &&
      noGoResult.verdict.children.at(-1).decision === "NO-GO",
      "NO-GO was not preserved across process boundary");
    receipts.push({ decision: "NO-GO", path: noGoResult.evidencePath, sha256: noGoResult.evidenceHash });

    const incompleteDir = path.join(temp, "incomplete");
    const incompleteResult = assertVerdict(run(configAt(incompleteDir, {
      run_id: "aggregate-missing-evidence",
      monolith: path.join(incompleteDir, "missing-monolith.js"),
      modular: goodMod,
      out_dir: path.join(incompleteDir, "evidence"),
    })), path.join(incompleteDir, "evidence"), "INCOMPLETE", 2);
    assert(/failed_without_proven_divergence/.test(incompleteResult.verdict.reason),
      "missing-evidence case did not fail closed");
    receipts.push({ decision: "INCOMPLETE", path: incompleteResult.evidencePath, sha256: incompleteResult.evidenceHash });

    console.log("AGGREGATE SELFTEST: PASS — GO/0, NO-GO/1, INCOMPLETE/2");
    for (const receipt of receipts) {
      console.log(`EVIDENCE ${receipt.decision}: path=${receipt.path} sha256=${receipt.sha256}`);
    }
  } finally {
    assert(contained(temp, TEMP_BASE), `refusing cleanup outside ${TEMP_BASE}: ${temp}`);
    fs.rmSync(temp, { recursive: true, force: true });
    assert(!fs.existsSync(temp), `temporary evidence cleanup failed: ${temp}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`AGGREGATE SELFTEST: FAIL — ${error.message}`);
  process.exitCode = 2;
}
