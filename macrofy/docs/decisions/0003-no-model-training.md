# ADR 0003: Pretrained models only — calibrate, don't train

Status: Accepted

Date: 2026-09-28 · Amends: [ADR 0002](0002-geometry-first-food-estimation.md) decisions 1–2

## Context

The owner does not want to train models from scratch. Instead: use the best available pretrained
models and verify the values by weighing. ADR 0002 still had three light training steps: a
classifier head for Brazilian classes, fine-tuning of the segmenter, and a learned
volume-to-mass head.

## Decision

1. **Naming the food takes no training.** Zero-shot SigLIP 2 text prompts in Portuguese and
   English, plus k-nearest-neighbour matching against a reference gallery of labelled photos.
   Adding a food means adding photos to the gallery. The gallery is built only from the
   calibration split, never from the locked test split.
2. **Outlining items takes no training.** Pretrained SAM 2.1-tiny (class-agnostic masks) is used
   as-is. RF-DETR-Seg fine-tuning is dropped.
3. **Grams come from physics plus calibration.**
   - Grams = volume × density (derived from FNDDS) × a per-food-group correction factor.
   - The correction factors, and the conformal ranges, are fitted on the owner's weighed
     calibration meals.
   - These are a handful of numbers per food group, not model weights.
4. **Depth stays pretrained:** Depth Anything V2-Small and ARKit/LiDAR.
5. **Revisit condition.** A trained component may be proposed in a new ADR only if the benchmark
   shows a gate cannot be met without it, and only with an estimate of the gain.

## Consequences

- No training infrastructure or GPU budget. Improvements come from better gallery photos,
  densities and calibration.
- Recognition quality of zero-shot + k-NN on Brazilian dishes is unproven, so T-010 measures it
  before the MVP depends on it.
- Your weighings remain essential, for measurement and calibration rather than for training.
