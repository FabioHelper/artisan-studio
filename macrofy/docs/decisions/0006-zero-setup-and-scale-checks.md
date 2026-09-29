# ADR 0006: Zero setup — no ruler, no protocol; occasional scale checks calibrate

Status: Accepted

Date: 2026-09-29 · Amends: [ADR 0002](0002-geometry-first-food-estimation.md) decision 7, [ADR 0004](0004-pwa-first-on-iphone-16e.md) decision 2

## Context

The owner's words: "I simply point my camera to the food and it comes up with its details and
macros. Manual work with a ruler is not good. The only comparison I'm willing to make is checking
with a real scale and a calorie app afterwards."

Measuring plates with a ruler, registering plates, and following a 300-meal, 8-week weighing
protocol are all setup work the product must not require.

## Decision

1. **Zero setup.** The camera goes straight to the result. No plate registration, no ruler, no
   taps required. Taps are available only to correct, as in ADR 0005.
2. **Scale without a ruler.**
   - Plate diameter comes from a typical-plate prior, stored in `priors.json` as an assumption,
     with its wider scale uncertainty carried into the ranges.
   - Plate registration becomes an optional, hidden refinement.
3. **Scale checks are the calibration and the benchmark.**
   - After an estimate, the owner may tap "Conferir com balança" and enter the kitchen-scale grams
     per item, or for the whole plate.
   - He may also enter an optional reading from another calorie app, for comparison only; it is
     not truth.
   - Each check stores the estimate and the truth.
   - From the checks, the app learns a per-user correction automatically: a global
     scale/portion factor first, per food group once there is enough data. The ranges are then
     calibrated conformally.
4. **Accuracy claims** come only from scale checks. The app shows the error with a 95%
   confidence interval, computed by the existing evaluation engine, and it tightens as checks
   accumulate. Phase gates require a minimum number of checks instead of a fixed protocol.
5. **Dropped:** the 300-meal protocol task (T-006) and the ruler-based plate-scale experiment
   (T-007).

## Consequences

- The only effort the owner ever makes is optional weighing.
- Without a ruler, LiDAR or AR, scale error is larger (about ±10–15% linear, ±20–30% area) until
  scale checks calibrate it. The ranges must say so honestly.
- Evidence arrives more slowly and less systematically than with a protocol. The confidence
  intervals make that visible instead of hiding it.
