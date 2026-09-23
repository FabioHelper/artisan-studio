#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const ACTIVE_STATES = new Set(["planned", "approved", "extracting", "candidate_ready", "verifying"]);
const TRANSITIONS = {
  planned: ["approved", "INCOMPLETE"],
  approved: ["extracting", "INCOMPLETE"],
  extracting: ["candidate_ready", "INCOMPLETE"],
  candidate_ready: ["verifying", "INCOMPLETE"],
  verifying: ["GO", "NO-GO", "INCOMPLETE"],
  GO: ["archived"], "NO-GO": ["archived"], INCOMPLETE: ["archived"], archived: []
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const json = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const nonEmpty = (value) => typeof value === "string" && value.length > 0;
const sameSet = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item) => right.includes(item));
const fail = (reason) => ({ ok: false, decision: "INCOMPLETE", exit_code: 2, reason });
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function setPath(value, dotted, next, operation) {
  const parts = dotted.split(".");
  let cursor = value;
  for (let i = 0; i < parts.length - 1; i++) cursor = cursor[parts[i]];
  const key = parts.at(-1);
  if (operation === "delete") delete cursor[key]; else cursor[key] = next;
}

function materializeNegative(good, fixture) {
  if (fixture.raw) {
    try { return JSON.parse(fixture.raw); } catch { return null; }
  }
  const value = clone(good);
  for (const mutation of fixture.mutations || []) setPath(value, mutation[0], mutation[1], mutation[2]);
  return value;
}

function validateRegistrySchemaSurface(runSchema, registrySchema, registry) {
  const runRequired = ["family_id", "project_id", "run_id", "paths", "bindings", "attempts", "state_history", "profile_resolution", "gate_summary", "authority", "provenance", "gate_results", "final_decision"];
  assert(runSchema.$schema.endsWith("2020-12/schema") && runSchema.properties.schema_version.const === "1.0.0", "suite-run schema identity");
  assert(runRequired.every((key) => runSchema.required.includes(key) && own(runSchema.properties, key)), "suite-run schema missing required binding");
  assert(runSchema.properties.gate_results.items.$ref && runSchema.$defs.gateResult && runSchema.$defs.artifact, "suite-run gate/artifact shape unconstrained");
  assert(runSchema.properties.state_history.items.properties.state.enum.includes("archived"), "suite-run state history incomplete");
  assert(runSchema.properties.provenance.allOf && runSchema.$defs.dirtySnapshot.required.length === 14, "dirty snapshot is not complete");

  assert(registrySchema.properties.schema_version.const === "1.0.0" && registry.schema_version === "1.0.0", "registry identity");
  assert(registrySchema.additionalProperties === false && registrySchema.$defs.gate.required.includes("planted_negative_fixture"), "registry schema is not fail-closed");
  assert(JSON.stringify(registry.exit_meanings) === JSON.stringify({ "0": "GO", "1": "NO-GO", "2": "INCOMPLETE" }), "exit meanings");
  assert(registry.authority.suite_run_schema_owner === "parity-cab" && registry.authority.fact_writer === "transformer" && registry.authority.final_verdict_writer === "verifier", "authority");
  assert(sameSet(registry.authority.readers, ["transformer", "verifier", "artifact-system"]), "readers");
  assert(registry.publication.method === "atomic-temp-flush-rename" && registry.publication.current_pointer_advances_only_after === "schema-and-provenance-validation", "atomic publication");
  assert(registry.publication.completed_attempts_immutable && registry.publication.retry_creates_new_attempt_id && registry.publication.cancelled_attempt_late_writes === "reject", "attempt publication policy");
  assert(registry.profiles.custom.base_profile_required && registry.profiles.custom.forbid_empty_profile && registry.profiles.custom.forbid_unknown_gates && registry.profiles.custom.forbid_base_gate_exclusion && registry.profiles.custom.require_signed_not_applicable, "custom profile policy");

  const expectedIds = ["01", "02", "03", "04", "05b", "06", "07", "08", "09", "09b", "10", "11", "11b", "11c", "11d", "12", "13", "14", "15", "05"];
  assert(sameSet(Object.keys(registry.gate_catalog), expectedIds), "gate catalog coverage");
  const negatives = new Set();
  for (const [id, gate] of Object.entries(registry.gate_catalog)) {
    const fields = ["profile_status", "executable", "argv", "prerequisites", "applicability_predicate", "evidence_filename", "output_schema", "accepted_decisions", "minimum_observations", "planted_negative_fixture"];
    assert(fields.every((field) => own(gate, field)), `${id}: incomplete gate contract`);
    assert(["library", "web-app", "threejs"].every((profile) => own(gate.profile_status, profile)), `${id}: profile status incomplete`);
    assert(nonEmpty(gate.executable) && Array.isArray(gate.argv) && gate.argv.length && gate.prerequisites.length, `${id}: invocation/prerequisites`);
    assert(nonEmpty(gate.applicability_predicate.kind), `${id}: applicability is not machine-checkable`);
    assert(nonEmpty(gate.evidence_filename) && nonEmpty(gate.output_schema.kind) && gate.output_schema.version === "1.0.0", `${id}: evidence schema`);
    assert(gate.accepted_decisions.length && Number.isInteger(gate.minimum_observations) && gate.minimum_observations > 0, `${id}: verdict/observation policy`);
    assert(!negatives.has(gate.planted_negative_fixture), `${id}: planted negative is not gate-specific`);
    negatives.add(gate.planted_negative_fixture);
  }
  for (const profileName of ["library", "web-app", "threejs"]) {
    const profile = registry.profiles[profileName];
    assert(profile.required_gate_ids.length && profile.required_gate_ids.every((id) => registry.gate_catalog[id]), `${profileName}: missing required gate`);
    assert(profile.optional_gate_ids.every((id) => registry.gate_catalog[id]), `${profileName}: unknown optional gate`);
    for (const id of profile.required_gate_ids) assert(registry.gate_catalog[id].profile_status[profileName] === "required", `${profileName}/${id}: status mismatch`);
    for (const rule of profile.conditional_required) {
      assert(rule.predicate.kind === "signal_true" && nonEmpty(rule.predicate.signal), `${profileName}: prose applicability`);
      for (const id of rule.gate_ids) assert(registry.gate_catalog[id].profile_status[profileName] === "conditional", `${profileName}/${id}: conditional mismatch`);
    }
  }
  for (const id of ["12", "13", "14", "15"]) {
    assert(registry.gate_catalog[id].profile_status.threejs === "required", `${id}: Three.js gate not strict`);
    assert(registry.gate_catalog[id].prerequisites.includes("fixed-scene-clock-seed-camera-viewport-renderer"), `${id}: deterministic metadata missing`);
  }
}

function requiredForResolution(resolution, registry) {
  if (!resolution || !Array.isArray(resolution.required_gate_ids) || resolution.required_gate_ids.length === 0) return fail("empty_profile");
  const catalogIds = Object.keys(registry.gate_catalog);
  if (resolution.required_gate_ids.some((id) => !catalogIds.includes(id))) return fail("unknown_gate");
  if (resolution.profile === "custom") {
    const base = registry.profiles[resolution.base_profile];
    if (!base || resolution.required_gate_ids.length === 0) return fail("empty_profile");
    if (base.required_gate_ids.some((id) => !resolution.required_gate_ids.includes(id))) return fail("excluded_base_gate");
    return { ok: true, ids: resolution.required_gate_ids };
  }
  const profile = registry.profiles[resolution.profile];
  if (!profile || resolution.profile === "custom") return fail("unknown_profile");
  const ids = [...profile.required_gate_ids];
  for (const rule of profile.conditional_required) {
    if (resolution.applicability_signals?.[rule.predicate.signal]) for (const id of rule.gate_ids) if (!ids.includes(id)) ids.push(id);
  }
  if (!sameSet(ids, resolution.required_gate_ids) || !sameSet(profile.optional_gate_ids, resolution.optional_gate_ids || [])) return fail("profile_resolution_mismatch");
  return { ok: true, ids };
}

function validateRun(run, registry) {
  if (!run || typeof run !== "object" || Array.isArray(run)) return fail("corrupt_input");
  if (run.schema_version !== "1.0.0" || run.schema_kind !== "modularization-suite/suite-run") return fail("unknown_schema");
  if (![run.family_id, run.project_id, run.run_id, run.parent_run_id].every(nonEmpty)) return fail("missing_identity");
  if (!run.paths || !nonEmpty(run.paths.monolith_root) || !nonEmpty(run.paths.isolated_modular_target) || run.paths.monolith_root.toLowerCase() === run.paths.isolated_modular_target.toLowerCase()) return fail("unsafe_paths");

  const bindings = run.bindings;
  if (!bindings || !COMMIT.test(bindings.source_commit || "") || !COMMIT.test(bindings.target_commit || "") || ![bindings.source_tree_hash, bindings.target_tree_hash, bindings.config_hash].every((value) => HASH.test(value || ""))) return fail("invalid_bindings");
  if (!Array.isArray(bindings.toolchain) || !["transformer", "verifier"].every((role) => bindings.toolchain.some((tool) => tool.role === role && nonEmpty(tool.invoked_path) && COMMIT.test(tool.git_head || "") && nonEmpty(tool.package_version) && HASH.test(tool.content_hash || "")))) return fail("invalid_toolchain");

  const provenance = run.provenance;
  if (!provenance || !["committed", "dirty"].includes(provenance.snapshot_kind) || ![provenance.source_hash, provenance.candidate_hash, provenance.config_hash, provenance.toolchain_hash].every((value) => HASH.test(value || "")) || Number.isNaN(Date.parse(provenance.captured_at))) return fail("legacy_evidence");
  if (provenance.source_hash !== bindings.source_tree_hash || provenance.candidate_hash !== bindings.target_tree_hash || provenance.config_hash !== bindings.config_hash) return fail("provenance_binding_mismatch");
  if (provenance.snapshot_kind === "dirty") {
    const names = ["staged_hash", "unstaged_hash", "untracked_hash", "external_asset_hash", "dependency_lock_hash", "harness_hash", "build_output_hash", "served_artifact_hash", "browser_runtime_hash", "seed_hash", "clock_hash", "viewport_hash", "renderer_hash", "config_hash"];
    if (!provenance.dirty_snapshot || !names.every((name) => HASH.test(provenance.dirty_snapshot[name] || ""))) return fail("incomplete_dirty_snapshot");
  }

  if (!Array.isArray(run.attempts) || run.attempts.length === 0 || !run.attempt) return fail("missing_attempt");
  const attemptIds = new Set();
  for (let index = 0; index < run.attempts.length; index++) {
    const attempt = run.attempts[index];
    if (!nonEmpty(attempt.attempt_id) || attemptIds.has(attempt.attempt_id)) return fail("duplicate_attempt_id");
    attemptIds.add(attempt.attempt_id);
    if (attempt.sequence !== index + 1 || attempt.immutable !== true || !HASH.test(attempt.content_hash || "") || Number.isNaN(Date.parse(attempt.created_at))) return fail("attempt_not_immutable");
    if (index && attempt.parent_attempt_id !== run.attempts[index - 1].attempt_id) return fail("invalid_retry_parent");
  }
  const latestAttempt = run.attempts.at(-1);
  if (JSON.stringify(latestAttempt) !== JSON.stringify(run.attempt)) return fail("current_attempt_mismatch");
  if (latestAttempt.status === "cancelled" && run.state !== "INCOMPLETE" && run.state !== "archived") return fail("cancelled_attempt_late_write");

  if (!run.authority || run.authority.schema_owner !== "parity-cab" || run.authority.fact_writer !== "transformer" || run.authority.final_verdict_writer !== "verifier" || !sameSet(run.authority.readers, ["transformer", "verifier", "artifact-system"])) return fail("authority_mismatch");
  if (!Array.isArray(run.state_history) || run.state_history.length === 0 || run.state_history[0].state !== "planned" || run.state_history.at(-1).state !== run.state) return fail("invalid_state_history");
  for (let index = 0; index < run.state_history.length; index++) {
    const entry = run.state_history[index];
    if (entry.sequence !== index + 1 || Number.isNaN(Date.parse(entry.at))) return fail("invalid_state_history");
    if (index && !TRANSITIONS[run.state_history[index - 1].state]?.includes(entry.state)) return fail("invalid_state_transition");
    if (["verifying", "GO", "NO-GO"].includes(entry.state) && entry.writer !== "verifier") return fail("state_writer_mismatch");
    if (["planned", "approved", "extracting", "candidate_ready"].includes(entry.state) && entry.writer !== "transformer") return fail("state_writer_mismatch");
  }

  const resolution = requiredForResolution(run.profile_resolution, registry);
  if (!resolution.ok) return resolution;
  const required = resolution.ids;
  const declarations = new Map((run.profile_resolution.not_applicable_declarations || []).map((item) => [item.gate_id, item]));
  const gateResults = Array.isArray(run.gate_results) ? run.gate_results : [];
  const byGate = new Map();
  for (const result of gateResults) {
    if (!registry.gate_catalog[result.gate_id]) return fail("unknown_gate");
    if (byGate.has(result.gate_id)) return fail("duplicate_gate_result");
    byGate.set(result.gate_id, result);
  }
  for (const id of required) {
    const gate = registry.gate_catalog[id];
    const result = byGate.get(id);
    if (!result) return fail("missing_required_evidence");
    if (result.run_id !== run.run_id || result.attempt_id !== run.attempt.attempt_id || result.parent_run_id !== run.parent_run_id) return fail("stale_or_mixed_parent");
    if (result.status !== "completed" || result.applicability === "optional") return fail("required_gate_not_completed");
    if (result.decision === "not_applicable") {
      const declaration = declarations.get(id);
      if (!declaration || !HASH.test(declaration.approved_profile_hash || "") || !HASH.test(declaration.signature || "")) return fail("unsigned_not_applicable");
    }
    if (!gate.accepted_decisions.includes(result.decision)) return fail("unaccepted_gate_decision");
    if (result.decision !== "not_applicable" && (!Array.isArray(result.observations) || result.observations.length < gate.minimum_observations)) return fail("zero_or_insufficient_observations");

    const artifact = result.artifact;
    if (!artifact || !nonEmpty(artifact.path) || !HASH.test(artifact.sha256 || "") || Number.isNaN(Date.parse(artifact.captured_at))) return fail("corrupt_evidence");
    if (artifact.schema_kind !== gate.output_schema.kind || artifact.schema_version !== gate.output_schema.version) return fail("evidence_schema_mismatch");
    const filenamePattern = new RegExp("^" + gate.evidence_filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\{side\\}", "[^/\\\\]+") + "$");
    if (!filenamePattern.test(path.basename(artifact.path))) return fail("evidence_filename_mismatch");
    if (artifact.run_id !== run.run_id || artifact.attempt_id !== run.attempt.attempt_id || artifact.parent_run_id !== run.parent_run_id) return fail("stale_or_mixed_parent");
    if (artifact.source_hash !== provenance.source_hash || artifact.candidate_hash !== provenance.candidate_hash || artifact.config_hash !== provenance.config_hash) return fail("provenance_binding_mismatch");
    const verifier = bindings.toolchain.find((tool) => tool.role === "verifier");
    if (artifact.tool_hash !== verifier.content_hash) return fail("provenance_binding_mismatch");
    for (const prerequisite of gate.prerequisites) {
      if (registry.gate_catalog[prerequisite] && !byGate.has(prerequisite)) return fail("missing_prerequisite");
    }
  }

  const summary = run.gate_summary;
  if (!summary || !sameSet(summary.required, required) || !sameSet(summary.optional, run.profile_resolution.optional_gate_ids || [])) return fail("gate_summary_mismatch");
  const completed = gateResults.filter((item) => item.status === "completed").map((item) => item.gate_id);
  const failed = gateResults.filter((item) => item.status === "failed").map((item) => item.gate_id);
  const skipped = gateResults.filter((item) => item.status === "skipped").map((item) => item.gate_id);
  if (!sameSet(summary.completed, completed) || !sameSet(summary.failed, failed) || !sameSet(summary.skipped, skipped)) return fail("gate_summary_mismatch");

  const final = run.final_decision;
  if (!final || final.writer !== "verifier" || final.aggregate_gate_id !== "05" || !["GO", "NO-GO", "INCOMPLETE"].includes(final.decision) || Number.isNaN(Date.parse(final.at))) return fail("invalid_final_decision");
  const expectedExit = { GO: 0, "NO-GO": 1, INCOMPLETE: 2 }[final.decision];
  if (final.exit_code !== expectedExit || (run.state !== "archived" && run.state !== final.decision)) return fail("final_state_mismatch");
  const aggregate = byGate.get("05");
  if (!aggregate || aggregate.decision !== final.decision) return fail("aggregate_decision_mismatch");
  if (final.decision === "GO" && (required.some((id) => !byGate.has(id)) || summary.failed.length || summary.skipped.some((id) => required.includes(id)))) return fail("go_with_incomplete_evidence");
  if (ACTIVE_STATES.has(run.state)) return fail("nonfinal_state");
  return { ok: true, decision: final.decision, exit_code: final.exit_code };
}

function main() {
  const runSchema = json("schemas/suite-run.schema.json");
  const registrySchema = json("schemas/suite-profile-registry.schema.json");
  const registry = json("schemas/suite-profile-registry.v1.json");
  const fixtures = json("schemas/fixtures/suite-contract-fixtures.json");
  validateRegistrySchemaSurface(runSchema, registrySchema, registry);

  const positive = validateRun(fixtures.known_good, registry);
  assert(positive.ok && positive.decision === "GO" && positive.exit_code === 0, `known-good rejected: ${positive.reason}`);

  const outcomes = [];
  for (const [name, fixture] of Object.entries(fixtures.negative_cases)) {
    const result = validateRun(materializeNegative(fixtures.known_good, fixture), registry);
    assert(!result.ok && result.decision === "INCOMPLETE" && result.exit_code === 2, `${name}: accepted`);
    assert(result.reason === fixture.expected_reason, `${name}: expected ${fixture.expected_reason}, got ${result.reason}`);
    outcomes.push(`${name}=INCOMPLETE/2/${result.reason}`);
  }
  console.log("SUITE CONTRACT: PASS — known-good same-run fixture=GO/0");
  console.log(`NEGATIVE CONTROLS: PASS — ${outcomes.join(", ")}`);
}

try { main(); } catch (error) { console.error(`SUITE CONTRACT: INCOMPLETE — ${error.message}`); process.exit(2); }
