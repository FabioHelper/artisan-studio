#!/usr/bin/env node
// run-all.cjs — Authoritative process boundary for the existing parity pipeline.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const here = __dirname;
const root = path.resolve(here, "..");
const rawArgs = process.argv.slice(2);
const exitFor = { GO: 0, "NO-GO": 1, INCOMPLETE: 2 };

// This is deliberately the pre-WP2B execution sequence. WP2B owns deriving
// profile-required stages and validating their individual evidence contracts.
// CAB is last so its child result is never silently ignored by this boundary.
const steps = [
  { gate_id: "01-monolith", script: "01-inventory.cjs", extra: ["--side", "monolith"] },
  { gate_id: "01-modular", script: "01-inventory.cjs", extra: ["--side", "modular"] },
  { gate_id: "02", script: "02-classify.cjs" },
  { gate_id: "03", script: "03-diff.cjs" },
  { gate_id: "04", script: "04-rfc-gen.cjs" },
  { gate_id: "05b", script: "05b-scaffold-check.cjs" },
  { gate_id: "11", script: "11-ast-xray.cjs" },
  { gate_id: "12", script: "12-pixel-diff.cjs" },
  { gate_id: "05", script: "05-cab-gate.cjs" },
];

function argValue(name) {
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] : undefined;
}

function configContext() {
  const supplied = argValue("--config") || "parity.config.json";
  const configPath = path.resolve(process.cwd(), supplied);
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const configDir = path.dirname(configPath);
    return {
      config_path: configPath,
      out_dir: path.resolve(configDir, cfg.out_dir || ".parity"),
      run_id: argValue("--run") || argValue("--run-id") || cfg.run_id || `aggregate-${process.pid}-${Date.now()}`,
      profile: argValue("--profile") || cfg.profile || "library",
      config_error: null,
    };
  } catch (error) {
    return {
      config_path: configPath,
      out_dir: path.join(path.dirname(configPath), ".parity"),
      run_id: argValue("--run") || argValue("--run-id") || `aggregate-${process.pid}-${Date.now()}`,
      profile: argValue("--profile") || "library",
      config_error: error.message,
    };
  }
}

function readJson(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, "utf8")), error: null };
  } catch (error) {
    return { value: null, error: error.message };
  }
}

function evidenceSnapshot(step, outDir) {
  // Only CAB's established verdict is authoritative in WP2A. Other child
  // decisions are recorded when their existing output exposes one; WP2B will
  // bind every required gate to the frozen registry and suite-run contract.
  const files = {
    "05": "cab-verdict.json",
    "05b": "scaffold-check.sij.json",
    "11": "ast-xray.sij.json",
    "12": "pixel-diff.sij.json",
  };
  const filename = files[step.gate_id];
  if (!filename) return { exists: false, path: null, sha256: null };
  const evidencePath = path.join(outDir, filename);
  if (!fs.existsSync(evidencePath)) return { exists: false, path: evidencePath, sha256: null };
  try {
    return {
      exists: true,
      path: evidencePath,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(evidencePath)).digest("hex"),
    };
  } catch {
    return { exists: true, path: evidencePath, sha256: null };
  }
}

function childEvidence(step, outDir, before, runId) {
  const snapshot = evidenceSnapshot(step, outDir);
  if (!snapshot.path) return { decision: null, evidence_path: null, evidence_error: null };
  const evidencePath = snapshot.path;
  if (!snapshot.exists) return { decision: null, evidence_path: evidencePath, evidence_error: "missing" };
  if (before.exists && before.sha256 === snapshot.sha256) {
    return { decision: null, evidence_path: evidencePath, evidence_error: "stale: child did not replace prior evidence" };
  }
  const parsed = readJson(evidencePath);
  if (parsed.error) return { decision: null, evidence_path: evidencePath, evidence_error: `malformed: ${parsed.error}` };
  const evidenceRunId = parsed.value.run_id || (parsed.value.summary && parsed.value.summary.run_id);
  if (evidenceRunId && evidenceRunId !== runId) {
    return { decision: null, evidence_path: evidencePath, evidence_error: `mixed-run: expected ${runId}, got ${evidenceRunId}` };
  }
  const rawDecision = step.gate_id === "05" ? parsed.value.decision : parsed.value.summary && parsed.value.summary.decision;
  return { decision: typeof rawDecision === "string" ? rawDecision : null, evidence_path: evidencePath, evidence_error: rawDecision ? null : "malformed: decision missing" };
}

function normalizeKnownDecision(gateId, decision) {
  if (gateId === "05") {
    if (decision === "GO") return "GO";
    if (decision === "NO-GO") return "NO-GO";
    return "INCOMPLETE";
  }
  if (decision === "fail" || decision === "FAIL") return "NO-GO";
  return null;
}

function writeVerdict(context, children, decision, reason) {
  fs.mkdirSync(context.out_dir, { recursive: true });
  const verdictPath = path.join(context.out_dir, "aggregate-verdict.sij.json");
  const verdict = {
    schema_version: "1.0.0",
    schema_kind: "parity-cab/aggregate-verdict",
    generated_at: new Date().toISOString(),
    invoked: { root, path: path.resolve(__filename), executable: process.execPath, argv: [path.resolve(__filename), ...rawArgs], shell: false },
    config_path: context.config_path,
    run_id: context.run_id,
    profile: context.profile,
    children,
    decision,
    exit_code: exitFor[decision],
    reason,
  };
  fs.writeFileSync(verdictPath, JSON.stringify(verdict, null, 2), "utf8");
  console.log(`[aggregate] decision=${decision} exit=${exitFor[decision]} run_id=${context.run_id} profile=${context.profile} -> ${verdictPath}`);
  return exitFor[decision];
}

function main() {
  const context = configContext();
  const children = [];
  if (context.config_error) return writeVerdict(context, children, "INCOMPLETE", `config_unavailable: ${context.config_error}`);

  for (const step of steps) {
    const scriptPath = path.join(here, step.script);
    const argv = [scriptPath, ...rawArgs, ...(step.extra || [])];
    console.log(`\n==> ${process.execPath} ${argv.join(" ")}`);
    const before = evidenceSnapshot(step, context.out_dir);
    const result = spawnSync(process.execPath, argv, { stdio: "inherit", shell: false });
    const evidence = childEvidence(step, context.out_dir, before, context.run_id);
    const child = {
      gate_id: step.gate_id, executable: process.execPath, argv, shell: false,
      exit_code: Number.isInteger(result.status) ? result.status : 2,
      signal: result.signal || null, decision: evidence.decision,
      evidence_path: evidence.evidence_path, evidence_error: evidence.evidence_error,
      spawn_error: result.error ? result.error.message : null,
    };
    children.push(child);

    if (result.error || result.status === null) return writeVerdict(context, children, "INCOMPLETE", `child_${step.gate_id}_failed_without_proven_divergence`);
    const known = normalizeKnownDecision(step.gate_id, child.decision);
    if (known === "NO-GO" && result.status === 1) return writeVerdict(context, children, "NO-GO", `child_${step.gate_id}_reported_divergence`);
    if (result.status !== 0) return writeVerdict(context, children, "INCOMPLETE", `child_${step.gate_id}_failed_without_proven_divergence`);
    if (step.gate_id === "05" && (known !== "GO" || child.evidence_error)) return writeVerdict(context, children, "INCOMPLETE", "final_cab_evidence_missing_or_malformed");
  }

  const finalChild = children.at(-1);
  if (!finalChild || finalChild.gate_id !== "05" || finalChild.decision !== "GO") return writeVerdict(context, children, "INCOMPLETE", "final_cab_evidence_missing_or_malformed");
  return writeVerdict(context, children, "GO", "all_executed_children_reported_go");
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`[aggregate] INCOMPLETE: ${error && error.stack || error}`);
  try {
    process.exitCode = writeVerdict(configContext(), [], "INCOMPLETE", `aggregate_exception: ${error.message}`);
  } catch (writeError) {
    console.error(`[aggregate] could not write INCOMPLETE verdict: ${writeError.message}`);
    process.exitCode = 2;
  }
}
