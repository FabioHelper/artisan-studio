# ADR 0002: Geometry-first, on-device food weight and macro estimation

Status: Proposed

Date: 2026-09-28 · Task: T-002 · Evidence: [research report](<../../research/reports/Camera food weight and macro estimation.md>)

## Context

The owner's goal: point the phone camera at a food or meal and get the most likely real weight of
each item plus protein, carbs, fat and kcal, with the lowest achievable error and no paid LLM API
spend. Research (six angles, 51 citations) found:

- **Portion (grams) is the dominant error, and it is a geometry problem.** VLMs miss food weight by
  about 36–37% and under-count more as portions grow. Depth or metric scale roughly halves the
  error: Nutrition5k's calorie error drops from 26.1% to 16.5% when depth is added.
- **Market leaders under-count by about 33%** (252–345 kcal and about 30 g fat per meal, NIH
  2026 abstract). Their error is a systematic bias, which a weighed benchmark can measure and
  correct.
- **Realistic targets:**

  | Mode | Per-meal kcal error |
  |---|---|
  | One photo with trained geometry | 20–30% |
  | With phone depth | 15–20% |
  | With one-tap confirmation of items and oil | 12–15% |

  No source supports under 10% from a single photo.
- **On Brazilian plates, the nutrition lookup adds as much error as the camera.** Most of it
  comes from hidden oil and a missing cooking state.

## Decision

1. **No LLM on the critical path.**
   - The core pipeline runs on-device with commercially licensed open models:
     - RF-DETR-Seg and SAM 2.1-tiny for item masks;
     - a SigLIP 2 / CLIP embedding classifier trained on Brazilian classes for labels;
     - Depth Anything V2-Small for relative depth.
   - Latency is about 150–300 ms per plate.
   - Non-commercial and AGPL models are excluded.
2. **Metric scale comes from the AR session.** ARKit/ARCore camera poses and the table plane set
   the scale, with LiDAR fused on iPhone Pro models. The plate diameter or a card is the
   fallback. Geometric volume feeds a learned mass head; it is not trusted raw.
3. **Native apps** (Swift + ARKit + Core ML; Kotlin + ARCore + LiteRT). A web app cannot use
   LiDAR or AR poses on iPhone, so it is a demo only.
4. **Nutrition data:**
   - TACO (bundled with citation) plus USDA FDC/FNDDS (CC0).
   - Densities are derived from FNDDS portion weights.
   - Every food class is mapped by hand to a nutrient entry with mandatory facets: state,
     method and default oil.
   - A TBCA license is pursued for as-eaten Brazilian preparations.
5. **One-tap confirmation** of items and cooking oil using fixed choices, never free gram entry.
   The app shows calibrated (conformal) ranges, not a single confident number.
6. **An optional cheap VLM**, only if Phase-2 recognition falls short: a confidence-gated Gemini
   Flash-Lite call for long-tail labels and hidden-fat flags, never for grams. Cost is about
   $0.6 per 1,000 calls, or about $5–13/month per 1,000 daily users when gated.
7. **Benchmark first.** A 300-meal weighed Brazilian benchmark (150 for calibration and 150
   locked for testing) gates every phase, judged on the upper bound of the 95% confidence
   interval:

   | Phase | Meal kcal error | Other conditions |
   |---|---|---|
   | 1 | ≤30% | bias within ±10% |
   | 2 | ≤20% | fat bias within ±15% |
   | 3 | ≤15% | — |

## Consequences

- Zero marginal cost per photo. Accuracy depends on scale quality and data mapping, not on
  model size.
- Two apps to build, plus model conversion for Core ML and LiteRT.
- The first real work is weighing meals, not coding the app. Without the benchmark, no accuracy
  claim is allowed.
- Open risks:
  - Single-frame AR-plane scale error at plate distance is unmeasured; it is the first Phase-0
    experiment.
  - TBCA licensing.
  - Some model-weight licenses need re-checking on their model cards.
