// Pure result logic, importable from Node (see web/selftest.mjs).
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

export function buildResults({ ua, webgpu, stages, crashedStage = null, crashes = [] }) {
  return { schema: 'macrofy.feasibility/1', ua, webgpu, stages, ...computeVerdict(stages),
    tab_survived: crashedStage === null && crashes.length === 0,
    ...(crashedStage ? { crashed_stage: crashedStage } : {}),
    ...(crashes.length ? { crashed_candidates: crashes.map((c) => ({ stage: c.stage, model: c.candidate, backend: c.device, dtype: c.dtype })) } : {}) };
}

// ---------------------------------------------------------------- one stage per page load, resume after a killed tab
// state = { stages: [result], running: {stage, candidate, device, dtype} | null, crashes: [running], attempts: { stage: [text] }, finished }
// Each stage runs in a fresh page load (the page reloads between stages) so earlier models are freed. The state is saved before each
// attempt; if the tab dies, the next page load finds `running` still set, records that CANDIDATE as crashed and moves on to the next
// candidate of the same stage, not to the next stage.

export const freshState = () => ({ stages: [], running: null, crashes: [], attempts: {}, finished: false });

/** A tab that died mid-attempt: record the crashed candidate and clear `running`. Returns a new state (unchanged when nothing was running). */
export function recordCrash(state) {
  if (!state.running) return state;
  const r = state.running; const text = `${r.candidate} ${r.device}/${r.dtype}: aba encerrada pelo Safari (tab survived: false)`;
  return { ...state, running: null, crashes: [...state.crashes, r], attempts: { ...state.attempts, [r.stage]: [...(state.attempts[r.stage] ?? []), text] } };
}

/** The first stage of `defs` with no result yet, or null when all are done. */
export const nextStage = (state, defs) => defs.find((d) => !state.stages.some((s) => s.stage === d.stage)) ?? null;

/** The candidates of a stage that have not crashed the tab. */
export const candidatesLeft = (state, def) => def.candidates.filter((c) => !state.crashes.some((k) => k.stage === def.stage && k.candidate === c.id));

/** A stage that produced no working candidate. */
export const failedStage = (stage, error, failed_attempts) => ({ stage, model: null, backend: null, bytes: 0, load_ms: null,
  cached_load_ms: null, infer_ms_median: null, ok: false, error, ...(failed_attempts?.length ? { failed_attempts } : {}) });
