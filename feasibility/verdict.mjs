// Pure result logic, importable from Node (see web/selftest.mjs).
export const LIMIT_MS = 2000;

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// go only if every expected stage loaded and the summed median inference time is within the limit.
export function computeVerdict(stages, expected = 3) {
  const total = stages.filter((s) => s.ok).reduce((t, s) => t + (s.infer_ms_median ?? 0), 0);
  const allOk = stages.length >= expected && stages.every((s) => s.ok);
  return { total_infer_ms: Math.round(total), verdict: allOk && total <= LIMIT_MS ? 'go' : 'no-go' };
}

export function buildResults({ ua, webgpu, stages, crashedStage = null }) {
  return { schema: 'macrofy.feasibility/1', ua, webgpu, stages, ...computeVerdict(stages),
    tab_survived: crashedStage === null, ...(crashedStage ? { crashed_stage: crashedStage } : {}) };
}
