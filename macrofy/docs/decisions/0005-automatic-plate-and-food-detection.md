# ADR 0005: Automatic plate and food detection — segment everything, then decide what is food

Status: Accepted

Date: 2026-09-29 · Task: T-014 · Builds on [ADR 0003](0003-no-model-training.md), [ADR 0004](0004-pwa-first-on-iphone-16e.md)

## Context

T-013's tap-to-outline flow (tap the plate rim, then each food) is a calibration workbench, not a
product. Goal G-5 allows at most one confirmation tap per typical plate. Market leaders are
zero-tap but under-count by about 33%, so Macrofy must be just as effortless and also more
accurate. Constraints: pretrained, commercially licensed models only; on-device in Safari on the
iPhone 16e; no LiDAR or AR.

## Decision

Automatic mode is the default. Tap mode stays as a correction tool and a calibration oracle.

1. **Encode once.** Run the SAM 2.1-tiny image encoder once per photo. Each extra point prompt
   then costs only a decoder pass (a few milliseconds each on phone NPUs, measured on Android).
2. **Plate.** Prompt a coarse point grid over the image. Pick the largest mask that is
   ellipse-shaped (low normalized ellipse-fit residual) and covers the image centre region. The
   ellipse gives the scale, using the default registered plate (last used) or a typical-plate
   prior with a wider range. A failure falls back to one rim tap.
3. **Foods.** Prompt a denser grid inside the plate ellipse. Keep a mask if:
   - it has high predicted IoU;
   - its area is between 0.5% and 85% of the plate;
   - it is not a near-duplicate of a better mask (IoU > 0.7);

   Resolve overlaps by predicted IoU, then merge adjacent fragments that SigLIP gives the same
   name.
4. **Food vs non-food.** Score each mask crop with SigLIP against the vocabulary names plus
   non-food labels ("prato vazio", "talher", "guardanapo", "copo", "mesa"). Drop masks whose best
   label is non-food.
5. **One confirmation screen**, prefilled with the top-1 names. The user taps only to fix a name,
   merge or split, remove, or add a missed item with a tap.
6. **Fallback, if the grid is too slow on the 16e:** an open-vocabulary detector (OWL-ViT/OWLv2,
   Apache-2.0, `zero-shot-object-detection` in transformers.js) prompts "comida" / "prato" for
   boxes, and SAM refines each box. T-012 and T-014's timing decide.

## Consequences

- Zero taps by default meets G-5, and T-008's gate enforces it.
- Accuracy cost versus tap mode is measured on the benchmark using tap-mode outlines as the
  oracle, not assumed.
- Grid density trades time for recall. It is tuned on the owner's phone.
