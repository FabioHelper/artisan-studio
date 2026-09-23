#!/usr/bin/env node
// 12-pixel-diff.cjs — Visual fidelity gate (parity-cab Stage 12).
//
// Reads pixel captures from both sides' behavior traces (recorder's
// scrubPixelPresets step), decodes PNG dataURLs, runs pixelmatch +
// inline SSIM per preset, writes a SIJ verdict + per-preset PNG artifacts.
//
// Hash-verified incremental skip (Principle 9): verdict embeds
// input_fingerprint; re-runs on identical inputs skip in ~1ms instead of
// ~1-2s of decode+compare.
//
// Zero-trust: no LLM in the loop. Every claim is shell-reproducible.
// Provenance embedded: tool_hash, input_fingerprint, host_env_fingerprint,
// command_reproducer, per-PNG sha256.
//
// Exit codes: 0 PASS or WARN-with-data ; 1 FAIL ; 2 setup/fatal error.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { writeSIJ, loadConfig, parseArgs, artifactSystem, probeArtifactSystem } = require("./lib/sij.cjs");

const TOOL_VERSION = "1.0.0";
const TOOL_HASH = (() => {
  try {
    return execSync(`git hash-object "${__filename}"`, { encoding: "utf8" }).trim();
  } catch (_) { return "unknown"; }
})();

function sha256(input) {
  return crypto.createHash("sha256").update(typeof input === "string" ? input : input.toString("binary")).digest("hex");
}

// ─── Dependency loader (pixelmatch + pngjs) ────────────────────────────────
function loadDeps() {
  function tryRequire(name) {
    try { return require(name); } catch (_) { /* fall through */ }
    // Try project-local node_modules
    const projRoot = process.cwd();
    try { return require(path.join(projRoot, "node_modules", name)); } catch (_) {}
    return null;
  }
  let pixelmatch = tryRequire("pixelmatch");
  let pngjs = tryRequire("pngjs");
  if (pixelmatch && pixelmatch.default) pixelmatch = pixelmatch.default;
  if (!pixelmatch || !pngjs) {
    console.error("[pixel-diff] FATAL — pixelmatch + pngjs not installed.");
    console.error("  Install per-project: npm i -D pixelmatch pngjs");
    console.error("  pixelmatch: " + (pixelmatch ? "OK" : "MISSING"));
    console.error("  pngjs:      " + (pngjs      ? "OK" : "MISSING"));
    process.exit(2);
  }
  return { pixelmatch, PNG: pngjs.PNG };
}

// ─── Trace fetch (API-first, same pattern as 07-trace-diff) ────────────────
async function fetchSidePair(cfg, project) {
  const tracesDir = path.join(cfg.out_dir, "traces");
  const monoLocal = path.join(tracesDir, "monolith.json");
  const modLocal  = path.join(tracesDir, "modular.json");
  const apiUp = await probeArtifactSystem(cfg);
  if (apiUp) {
    const base = artifactSystem(cfg).sink;
    try {
      const [rMono, rMod] = await Promise.all([
        fetch(base + "/monolith?project=" + encodeURIComponent(project)),
        fetch(base + "/modular?project=" + encodeURIComponent(project)),
      ]);
      if (rMono.ok && rMod.ok) {
        const mono = await rMono.json();
        const mod  = await rMod.json();
        try {
          if (!fs.existsSync(tracesDir)) fs.mkdirSync(tracesDir, { recursive: true });
          fs.writeFileSync(monoLocal, JSON.stringify(mono, null, 2), "utf8");
          fs.writeFileSync(modLocal,  JSON.stringify(mod,  null, 2), "utf8");
        } catch (_) {}
        return { mono, mod, source: "artifact-system" };
      }
    } catch (_) {}
  }
  if (!fs.existsSync(monoLocal) || !fs.existsSync(modLocal)) {
    console.error("[pixel-diff] ERROR: traces not found in artifact-system or local fallback.");
    console.error("  Run 06-behavior-trace.cjs first.");
    process.exit(2);
  }
  return {
    mono: JSON.parse(fs.readFileSync(monoLocal, "utf8")),
    mod:  JSON.parse(fs.readFileSync(modLocal,  "utf8")),
    source: "local",
  };
}

// ─── PNG decode from dataURL ───────────────────────────────────────────────
function decodeDataURL(dataURL, PNG) {
  const comma = dataURL.indexOf(",");
  if (comma < 0) throw new Error("not a dataURL");
  const b64 = dataURL.slice(comma + 1);
  const buf = Buffer.from(b64, "base64");
  return PNG.sync.read(buf);
}

// ─── Scene-uniformity score (mechanizes manual pixel sampling) ─────────────
// Samples an 8×8 grid of pixels, quantizes each channel to 16 levels (4 bits),
// then computes:
//   - unique_ratio  = unique colors / sample count
//   - entropy_bits  = Shannon entropy of color distribution
//   - score         = mean of (unique_ratio, normalized entropy) → 0..1
// Low score = near-uniform image (likely render overflow / failure).
// This mechanizes the manual `gl.readPixels` sampling an LLM/human would
// otherwise do via puppeteer eval to diagnose "is this side actually
// rendering a scene or just emitting a solid color?".
function computeSceneUniformity(img) {
  const GRID = 8;
  const samples = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = Math.floor((i + 0.5) * img.width / GRID);
      const y = Math.floor((j + 0.5) * img.height / GRID);
      const idx = (y * img.width + x) * 4;
      // Quantize each channel to 16 levels (4 bits) to suppress noise
      const r = img.data[idx] >> 4;
      const g = img.data[idx + 1] >> 4;
      const b = img.data[idx + 2] >> 4;
      samples.push(`${r},${g},${b}`);
    }
  }
  const uniqueColors = new Set(samples);
  const uniqueRatio = uniqueColors.size / samples.length;
  const freq = {};
  for (const s of samples) freq[s] = (freq[s] || 0) + 1;
  let entropy = 0;
  for (const k of Object.keys(freq)) {
    const p = freq[k] / samples.length;
    entropy -= p * Math.log2(p);
  }
  const entropyMax = Math.log2(samples.length);
  const entropyNorm = entropyMax > 0 ? entropy / entropyMax : 0;
  const score = (uniqueRatio + entropyNorm) / 2;
  const interpretation =
    score < 0.15 ? "near_uniform_likely_render_failure" :
    score < 0.30 ? "low_diversity_suspect" :
    score < 0.60 ? "moderate_diversity" :
                   "high_diversity_normal_scene";
  return {
    sample_count: samples.length,
    unique_colors: uniqueColors.size,
    unique_ratio: Number(uniqueRatio.toFixed(3)),
    entropy_bits: Number(entropy.toFixed(3)),
    entropy_normalized: Number(entropyNorm.toFixed(3)),
    score: Number(score.toFixed(3)),
    interpretation,
  };
}

// ─── Byte-size signature (mechanizes manual `ls -la` of PNG files) ─────────
// PNG compression efficiency tracks image entropy: near-uniform frames
// compress small, varied scenes compress large. Cross-side ratio > 5x is a
// strong signal that ONE side rendered a near-uniform frame (overflow /
// failure) while the OTHER rendered a varied scene. Mechanizes the manual
// "wait, mono PNG is 22KB and mod PNG is 238KB at same resolution — that
// can't be right" diagnosis.
function computeByteSizeSignature(monoCap, modCap) {
  // Prefer explicit size_bytes if recorder set it; fall back to base64 length
  // estimate (base64 = ~4/3 bytes per source byte).
  function sizeOf(cap) {
    if (!cap) return 0;
    if (typeof cap.size_bytes === "number") return cap.size_bytes;
    if (typeof cap.dataURL === "string") {
      const comma = cap.dataURL.indexOf(",");
      const b64Len = comma >= 0 ? cap.dataURL.length - comma - 1 : cap.dataURL.length;
      return Math.floor(b64Len * 0.75);
    }
    return 0;
  }
  const monoBytes = sizeOf(monoCap);
  const modBytes  = sizeOf(modCap);
  if (!monoBytes || !modBytes) return null;
  const ratio = Math.max(monoBytes, modBytes) / Math.min(monoBytes, modBytes);
  const interpretation =
    ratio > 10 ? "severe_divergence_likely_render_failure_on_smaller_side" :
    ratio > 5  ? "high_divergence_suspect" :
    ratio > 2  ? "moderate_divergence" :
                 "normal_ratio";
  return {
    monolith_bytes: monoBytes,
    modular_bytes: modBytes,
    ratio: Number(ratio.toFixed(2)),
    smaller_side: monoBytes < modBytes ? "monolith" : "modular",
    interpretation,
  };
}

// ─── Inline SSIM (Wang et al. 2004 single-window, Rec.709 luminance) ───────
function computeSSIM(img1, img2) {
  if (img1.width !== img2.width || img1.height !== img2.height) return 0;
  const N = img1.width * img1.height;
  let sum1 = 0, sum2 = 0, sumSq1 = 0, sumSq2 = 0, sumProd = 0;
  const d1 = img1.data, d2 = img2.data;
  for (let i = 0; i < d1.length; i += 4) {
    const y1 = 0.2126 * d1[i] + 0.7152 * d1[i + 1] + 0.0722 * d1[i + 2];
    const y2 = 0.2126 * d2[i] + 0.7152 * d2[i + 1] + 0.0722 * d2[i + 2];
    sum1 += y1; sum2 += y2;
    sumSq1 += y1 * y1; sumSq2 += y2 * y2;
    sumProd += y1 * y2;
  }
  const mu1 = sum1 / N, mu2 = sum2 / N;
  const var1 = sumSq1 / N - mu1 * mu1;
  const var2 = sumSq2 / N - mu2 * mu2;
  const cov  = sumProd / N - mu1 * mu2;
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  return ((2 * mu1 * mu2 + C1) * (2 * cov + C2)) /
         ((mu1 * mu1 + mu2 * mu2 + C1) * (var1 + var2 + C2));
}

// ─── Input fingerprint (Principle 9 — Hash-verified incremental skip) ──────
function computeInputFingerprint(mono, mod, presets, toolHash) {
  function dataURLDigest(captures) {
    if (!captures || captures.skipped) return "skipped";
    return Object.keys(captures).sort().map(k => {
      const c = captures[k];
      return k + ":" + (c && c.dataURL ? sha256(c.dataURL) : "missing");
    }).join("|");
  }
  return sha256([
    sha256(dataURLDigest(mono.pixel_captures)),
    sha256(dataURLDigest(mod.pixel_captures)),
    sha256(JSON.stringify(presets)),
    toolHash,
  ].join("||"));
}

function deriveProject(cfg) {
  if (cfg.project) return cfg.project;
  if (cfg.modular && cfg.modular.root) {
    const base = path.basename(path.resolve(cfg.modular.root));
    return base && base !== "src" ? base : "default";
  }
  return "default";
}

async function uploadDiffIfArtifactSystemUp(cfg, doc, project) {
  if (!(await probeArtifactSystem(cfg))) return false;
  try {
    const url = artifactSystem(cfg).sink +
                "/diff?project=" + encodeURIComponent(project);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...doc, kind_alias: "pixel-diff" }),
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok) {
      console.log("[pixel-diff] uploaded verdict to artifact-system");
      return true;
    }
  } catch (_) {}
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg  = loadConfig(args.config || "parity.config.json");
  const project = deriveProject(cfg);
  const presets = Array.isArray(cfg.camera_presets) ? cfg.camera_presets : [];
  const verdictPath = path.join(cfg.out_dir, "pixel-diff.sij.json");

  // No presets → skip with warning verdict
  if (presets.length === 0) {
    writeSIJ(verdictPath, "pixel-diff", null, [
      { severity: "warn", kind: "no_camera_presets_defined",
        rationale: "Add camera_presets[] to parity.config.json to enable the visual gate." },
    ], { summary: { decision: "skipped", reason: "no_camera_presets" } });
    console.log("[pixel-diff] skipped — no camera_presets in parity.config.json");
    process.exit(0);
  }

  const { mono, mod, source } = await fetchSidePair(cfg, project);
  const monoP = mono.pixel_captures, modP = mod.pixel_captures;
  if (!monoP || !modP || monoP.skipped || modP.skipped) {
    writeSIJ(verdictPath, "pixel-diff", null, [
      { severity: "warn", kind: "pixel_captures_missing",
        monolith_present: !!(monoP && !monoP.skipped),
        modular_present:  !!(modP && !modP.skipped),
        rationale: "Run 06-behavior-trace.cjs with the recorder that includes scrubPixelPresets. Ensure parity.config.json has camera_presets[] AND the harness HTML injects window.__PIXEL_PRESETS." },
    ], { summary: { decision: "needs_recapture", reason: "captures_missing", source } });
    console.log("[pixel-diff] needs_recapture — pixel_captures missing on one or both sides (source=" + source + "). Re-run 06-behavior-trace.");
    process.exit(0);
  }

  // Principle 9: hash-verified incremental skip
  const fingerprint = computeInputFingerprint(mono, mod, presets, TOOL_HASH);
  if (fs.existsSync(verdictPath)) {
    try {
      const prior = JSON.parse(fs.readFileSync(verdictPath, "utf8"));
      if (prior.input_fingerprint === fingerprint &&
          prior.summary && prior.summary.decision !== "skipped" &&
          prior.summary.decision !== "fail-no-captures") {
        prior.last_verified_at = new Date().toISOString();
        fs.writeFileSync(verdictPath, JSON.stringify(prior, null, 2), "utf8");
        console.log(`[pixel-diff] noop — inputs unchanged (fingerprint=${fingerprint.slice(0, 12)}). Decision: ${prior.summary.decision}`);
        process.exit(prior.summary.decision === "fail" ? 1 : 0);
      }
    } catch (_) { /* prior unreadable → full run */ }
  }

  // Full run
  const { pixelmatch, PNG } = loadDeps();
  const pixelsDir = path.join(cfg.out_dir, "pixels");
  if (!fs.existsSync(pixelsDir)) fs.mkdirSync(pixelsDir, { recursive: true });

  const perPreset = [];
  let anyFail = false, anyWarn = false;
  let ssimMin = 1, ssimSum = 0;
  let diffPctMax = 0, diffPctSum = 0;
  let countCompared = 0;

  for (const preset of presets) {
    const name = preset.name || "unnamed";
    const monoCap = monoP[name];
    const modCap  = modP[name];
    if (!monoCap || !modCap || monoCap.error || modCap.error) {
      perPreset.push({
        name, decision: "fail",
        reason: "capture_missing_or_error",
        monolith: monoCap && monoCap.error ? { error: monoCap.error } : (monoCap ? "ok" : "missing"),
        modular:  modCap  && modCap.error  ? { error: modCap.error  } : (modCap  ? "ok" : "missing"),
      });
      anyFail = true;
      continue;
    }

    let imgMono, imgMod;
    try { imgMono = decodeDataURL(monoCap.dataURL, PNG); }
    catch (e) { perPreset.push({ name, decision: "fail", reason: "monolith_decode_error: " + e.message }); anyFail = true; continue; }
    try { imgMod  = decodeDataURL(modCap.dataURL,  PNG); }
    catch (e) { perPreset.push({ name, decision: "fail", reason: "modular_decode_error: "  + e.message }); anyFail = true; continue; }

    if (imgMono.width !== imgMod.width || imgMono.height !== imgMod.height) {
      perPreset.push({
        name, decision: "fail", reason: "dimension_mismatch",
        monolith_size: [imgMono.width, imgMono.height],
        modular_size:  [imgMod.width,  imgMod.height],
      });
      anyFail = true;
      continue;
    }

    const W = imgMono.width, H = imgMono.height;
    const totalPixels = W * H;
    const diffData = Buffer.alloc(imgMono.data.length);
    const mismatch = pixelmatch(imgMono.data, imgMod.data, diffData, W, H, { threshold: 0.1, includeAA: true });
    const diffPct  = (mismatch / totalPixels) * 100;
    const ssimVal  = computeSSIM(imgMono, imgMod);

    const monoFile = path.join(pixelsDir, `${name}-monolith.png`);
    const modFile  = path.join(pixelsDir, `${name}-modular.png`);
    const diffFile = path.join(pixelsDir, `${name}-diff.png`);
    fs.writeFileSync(monoFile, PNG.sync.write({ width: W, height: H, data: imgMono.data }));
    fs.writeFileSync(modFile,  PNG.sync.write({ width: W, height: H, data: imgMod.data  }));
    fs.writeFileSync(diffFile, PNG.sync.write({ width: W, height: H, data: diffData     }));

    const ssimThr = typeof preset.ssim_threshold === "number" ? preset.ssim_threshold : 0.95;
    const diffThr = typeof preset.diff_pct_max   === "number" ? preset.diff_pct_max   : 1.5;
    let decision;
    if (ssimVal >= ssimThr && diffPct <= diffThr) decision = "pass";
    else if (ssimVal >= (ssimThr - 0.03) && diffPct <= (diffThr * 1.5)) { decision = "warn"; anyWarn = true; }
    else { decision = "fail"; anyFail = true; }

    ssimMin = Math.min(ssimMin, ssimVal);
    ssimSum += ssimVal;
    diffPctMax = Math.max(diffPctMax, diffPct);
    diffPctSum += diffPct;
    countCompared++;

    // Mechanized diagnostic signals (v1.1): scene uniformity + byte-size sig.
    // These give the agent a no-eval-needed answer to "why is this preset
    // failing? did one side actually render the scene?" without manual
    // puppeteer pixel sampling or `ls -la` of PNG files.
    const monoUniformity = computeSceneUniformity(imgMono);
    const modUniformity  = computeSceneUniformity(imgMod);
    const byteSig = computeByteSizeSignature(monoCap, modCap);

    perPreset.push({
      name, decision,
      ssim: Number(ssimVal.toFixed(4)),
      diff_pct: Number(diffPct.toFixed(3)),
      mismatch_pixels: mismatch,
      total_pixels: totalPixels,
      resolution: [W, H],
      monolith_png:    path.relative(cfg.out_dir, monoFile).replace(/\\/g, "/"),
      monolith_sha256: sha256(monoCap.dataURL),
      modular_png:     path.relative(cfg.out_dir, modFile).replace(/\\/g, "/"),
      modular_sha256:  sha256(modCap.dataURL),
      diff_png:        path.relative(cfg.out_dir, diffFile).replace(/\\/g, "/"),
      diff_sha256:     sha256(diffData),
      threshold_used: { ssim: ssimThr, diff_pct: diffThr },
      scene_uniformity: {
        monolith: monoUniformity,
        modular:  modUniformity,
      },
      byte_size_signature: byteSig,
    });
  }

  const decision = anyFail ? "fail" : (anyWarn ? "warn" : "pass");
  const issues = perPreset.filter(p => p.decision !== "pass").map(p => {
    // Surface mechanized diagnostic signals in the issue's rationale, so the
    // agent reading the verdict gets the WHY without opening per-PNG.
    const mu = p.scene_uniformity && p.scene_uniformity.monolith;
    const md = p.scene_uniformity && p.scene_uniformity.modular;
    const bs = p.byte_size_signature;
    const uniformityHints = [];
    if (mu && mu.score < 0.15) uniformityHints.push(`monolith side rendered near-uniform frame (score=${mu.score}, interpretation=${mu.interpretation})`);
    if (md && md.score < 0.15) uniformityHints.push(`modular side rendered near-uniform frame (score=${md.score}, interpretation=${md.interpretation})`);
    if (bs && bs.ratio > 5) uniformityHints.push(`byte-size ratio ${bs.ratio}x — ${bs.smaller_side} side likely under-rendered (${bs.interpretation})`);
    const mechHint = uniformityHints.length
      ? ` Mechanized signals: ${uniformityHints.join(' · ')}.`
      : "";
    return {
      severity: p.decision === "fail" ? "high" : "med",
      kind: "pixel_diff_" + p.decision,
      preset: p.name,
      ssim: p.ssim,
      diff_pct: p.diff_pct,
      monolith_png: p.monolith_png,
      modular_png:  p.modular_png,
      diff_png:     p.diff_png,
      scene_uniformity: p.scene_uniformity,
      byte_size_signature: p.byte_size_signature,
      rationale: (p.decision === "fail"
        ? `Visual divergence on preset '${p.name}' (ssim=${p.ssim}, diff=${p.diff_pct}%). Check cross_pillar_joins: camera_state first, then materials/scene_config/renderer_config.`
        : `Visual warning on preset '${p.name}' — below failure threshold but above pass.`) + mechHint,
      explains_field: null,
    };
  });

  // Aggregate mechanized signals across presets for top-level visibility
  let minUniformity = 1;
  let maxByteRatio = 1;
  let uniformityFailureSide = null;
  for (const p of perPreset) {
    const mu = p.scene_uniformity && p.scene_uniformity.monolith;
    const md = p.scene_uniformity && p.scene_uniformity.modular;
    if (mu && mu.score < minUniformity) { minUniformity = mu.score; uniformityFailureSide = "monolith"; }
    if (md && md.score < minUniformity) { minUniformity = md.score; uniformityFailureSide = "modular"; }
    if (p.byte_size_signature && p.byte_size_signature.ratio > maxByteRatio) {
      maxByteRatio = p.byte_size_signature.ratio;
    }
  }

  const summary = {
    decision,
    ssim_min:     Number(ssimMin.toFixed(4)),
    ssim_mean:    countCompared > 0 ? Number((ssimSum / countCompared).toFixed(4)) : null,
    diff_pct_max: Number(diffPctMax.toFixed(3)),
    diff_pct_mean: countCompared > 0 ? Number((diffPctSum / countCompared).toFixed(3)) : null,
    presets_compared: countCompared,
    presets_configured: presets.length,
    // v1.1: mechanized diagnostic signals (no LLM/manual investigation needed)
    scene_uniformity_min: Number(minUniformity.toFixed(3)),
    scene_uniformity_failure_side: uniformityFailureSide,
    byte_size_ratio_max: Number(maxByteRatio.toFixed(2)),
  };

  const cross_pillar_joins = [{
    from: "pixel-diff",
    to: ["camera_state", "scene_config", "renderer_config", "materials"],
    explanation: "On pixel-diff FAIL/WARN, inspect in order: camera_state (preset applied correctly?), scene_config (fog/bg drift), renderer_config (toneMapping/colorSpace), then materials (PBR drift). Geometric/lighting position issues require manual inspection if none of the above explain.",
  }];

  const doc = {
    schema_version: "1.0.0",
    schema_kind: "parity-cab/pixel-diff",
    generated_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
    tool_version: TOOL_VERSION,
    tool_hash: TOOL_HASH,
    input_fingerprint: fingerprint,
    host_env_fingerprint: {
      node: process.version,
      platform: process.platform,
      cwd_hash: sha256(process.cwd()),
    },
    command_reproducer: `node "${__filename.replace(/\\/g, "/")}" --config parity.config.json`,
    trace_source: source,
    project,
    summary,
    per_preset: perPreset,
    cross_pillar_joins,
    issues,
  };

  fs.writeFileSync(verdictPath, JSON.stringify(doc, null, 2), "utf8");

  console.log(`[pixel-diff] decision=${decision} presets=${countCompared}/${presets.length} ssim_min=${summary.ssim_min} diff_pct_max=${summary.diff_pct_max}%`);
  for (const p of perPreset) {
    if (p.ssim !== undefined) {
      console.log(`  ${p.name}: ${p.decision} (ssim=${p.ssim}, diff=${p.diff_pct}%)`);
    } else {
      console.log(`  ${p.name}: ${p.decision} — ${p.reason}`);
    }
  }

  await uploadDiffIfArtifactSystemUp(cfg, doc, project);

  process.exit(decision === "fail" ? 1 : 0);
}

if (require.main === module) main().catch(e => { console.error("[pixel-diff] FATAL:", e && e.stack || e); process.exit(2); });
