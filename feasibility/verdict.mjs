// Pure result logic, importable from Node (see web/selftest.mjs).
import { backendsOf } from '../lib/models.mjs';
export const LIMIT_MS = 2000;
/** Stages the estimator needs. Depth is informational only: the estimator does not use it (F-005). */
export const REQUIRED = ['segmentation', 'naming'];

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// go only if segmentation and naming both loaded and the sum of their median inference times is within the limit.
// Depth (or any other stage) is reported but never changes the verdict.
export function computeVerdict(stages) {
  const by = new Map(stages.map((s) => [s.stage, s]));
  const req = REQUIRED.map((k) => by.get(k));
  const allOk = req.every((s) => s?.ok);
  const total = req.reduce((t, s) => t + (s?.ok ? (s.infer_ms_median ?? 0) : 0), 0);
  const depth = by.get('depth');
  return { total_infer_ms: Math.round(total), verdict: allOk && total <= LIMIT_MS ? 'go' : 'no-go',
    ...(depth ? { depth_informational: { ok: !!depth.ok, infer_ms_median: depth.infer_ms_median ?? null } } : {}) };
}
/**
 * The results JSON the owner pastes. `schema` stays macrofy.feasibility/1: T-015 only ADDS fields (`storage` per stage, `failures`, and
 * `file`/`url` on crashed candidates).
 */
export function buildResults({ ua, webgpu, stages, crashedStage = null, crashes = [], storage = {}, failures = [] }) {
  return { schema: 'macrofy.feasibility/1', ua, webgpu, stages, ...computeVerdict(stages),
    tab_survived: crashedStage === null && crashes.length === 0,
    ...(crashedStage ? { crashed_stage: crashedStage } : {}),
    ...(crashes.length ? { crashed_candidates: crashes.map((c) => ({ stage: c.stage, model: c.candidate, backend: c.device, dtype: c.dtype, ...(c.url ? { file: c.file ?? null, url: c.url } : {}) })) } : {}),
    ...(Object.keys(storage).length ? { storage } : {}),
    ...(failures.length ? { failures } : {}) };
}

// ---------------------------------------------------------------- diagnostics (T-015)
const mb = (x) => (Number.isFinite(x) ? Math.round(x / 1e6) : null);
/** navigator.storage.estimate() and persisted() -> a small record (MB), recorded before each stage. Any argument may be missing. */
export const storageRecord = (estimate, persisted, error = null) => ({
  quota_mb: mb(estimate?.quota), usage_mb: mb(estimate?.usage), persisted: typeof persisted === 'boolean' ? persisted : null, ...(error ? { error } : {}) });

/** A failed attempt as recorded in the results: the error name and message and the file being fetched when it failed. */
export const failureRecord = (stage, a, err, fetching = null) => ({ stage, model: a.candidate, backend: a.device, dtype: a.dtype,
  error_name: String(err?.name || 'Error'), error_message: String(err?.message || err).slice(0, 300),
  file: fetching?.file ?? null, url: fetching?.url ?? null, ...(fetching?.inFlight?.length > 1 ? { in_flight: fetching.inFlight } : {}) });

// ---------------------------------------------------------------- one stage per page load, per-attempt crash resume (F-006)
// state = { v, stages: [result], running: {stage, candidate, device, dtype, file?, url?} | null, crashes: [running],
//           attempts: { stage: [text] }, tried: { stage: [attemptKey] }, storage: { stage: record }, failures: [record], finished }
// The unit is ONE ATTEMPT = (model, device, dtype). Each attempt is marked tried BEFORE it starts (and saved), so it runs at most once
// across page loads: whether it fails, succeeds or kills the tab, it is never repeated. A tab that died leaves `running` set; the next
// page load records that single attempt as crashed and continues the SAME stage with its next untried attempt. A stage ends only when
// every planned attempt has been tried, so the resume always terminates (the number of untried attempts strictly decreases).
// Each stage runs in a fresh page load so earlier models are freed.
export const STATE_VERSION = 3;
export const freshState = () => ({ v: STATE_VERSION, stages: [], running: null, crashes: [], attempts: {}, tried: {}, storage: {}, failures: [], finished: false });

/** A saved state of an older page version (no per-attempt record) is not resumable: start fresh. */
export const migrateState = (saved) => (saved && saved.v === STATE_VERSION ? { ...freshState(), ...saved } : freshState());

export const attemptKey = (model, device, dtype) => `${model}|${device}|${dtype}`;

/** Every attempt of a stage in order; WebGPU ones are dropped when the browser has no adapter. Returns [{ candidate, c, device, dtype, key }]. */
export function plannedAttempts(def, hasGpu) {
  const out = [];
  for (const c of def.candidates) for (const [device, dtype] of backendsOf(c)) {
    if (device === 'webgpu' && !hasGpu) continue;
    out.push({ c, candidate: c.id, device, dtype, key: attemptKey(c.id, device, dtype) });
  }
  return out;
}
/** The first attempt of the stage not tried yet, or null when the stage is exhausted. */
export const nextAttempt = (state, def, hasGpu) => plannedAttempts(def, hasGpu).find((a) => !(state.tried[def.stage] ?? []).includes(a.key)) ?? null;

/** Marks the attempt tried and running (call, then save, before touching the model). */
export const beginAttempt = (state, stage, a) => ({ ...state, running: { stage, candidate: a.candidate, device: a.device, dtype: a.dtype },
  tried: { ...state.tried, [stage]: [...new Set([...(state.tried[stage] ?? []), a.key])] } });

/** The fetching file of the running attempt (saved when it changes, so a killed tab still says where it died). */
export const noteFetching = (state, fetching) => (state.running ? { ...state, running: { ...state.running, file: fetching?.file ?? null, url: fetching?.url ?? null } } : state);

/** The running attempt finished (ok or failed): clear it. */
export const endAttempt = (state) => ({ ...state, running: null });

/** A failed attempt: text for failed_attempts and the structured record. */
export function recordFailure(state, stage, a, err, fetching = null) {
  const text = `${a.candidate} ${a.device}/${a.dtype}: ${String(err?.name || 'Error')}: ${String(err?.message || err).slice(0, 160)}${fetching?.url ? ` [${fetching.url}]` : ''}`;
  return { ...state, running: null, attempts: { ...state.attempts, [stage]: [...(state.attempts[stage] ?? []), text] },
    failures: [...state.failures, failureRecord(stage, a, err, fetching)] };
}

/** A tab that died mid-attempt: record that ATTEMPT as crashed and clear `running`. Pure; unchanged when nothing was running. */
export function recordCrash(state) {
  if (!state.running) return state;
  const r = state.running; const key = attemptKey(r.candidate, r.device, r.dtype);
  const text = `${r.candidate} ${r.device}/${r.dtype}: aba encerrada pelo Safari (tab survived: false)${r.url ? ` [${r.url}]` : ''}`;
  return { ...state, running: null, crashes: [...state.crashes, r],
    tried: { ...state.tried, [r.stage]: [...new Set([...(state.tried[r.stage] ?? []), key])] },
    attempts: { ...state.attempts, [r.stage]: [...(state.attempts[r.stage] ?? []), text] } };
}

export const recordStorage = (state, stage, rec) => ({ ...state, storage: { ...state.storage, [stage]: rec } });

/** The first stage of `defs` with no result yet, or null when all are done. */
export const nextStage = (state, defs) => defs.find((d) => !state.stages.some((s) => s.stage === d.stage)) ?? null;

/** A stage that produced no working attempt. */
export const failedStage = (stage, error, failed_attempts) => ({ stage, model: null, backend: null, bytes: 0, load_ms: null,
  cached_load_ms: null, infer_ms_median: null, ok: false, error, ...(failed_attempts?.length ? { failed_attempts } : {}) });
