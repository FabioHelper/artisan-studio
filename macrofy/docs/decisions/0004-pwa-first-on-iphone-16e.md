# ADR 0004: PWA first on the owner's iPhone 16e, scale from registered plates

Status: Accepted

Date: 2026-09-28 · Amends: [ADR 0002](0002-geometry-first-food-estimation.md) decisions 2–3

## Context

The owner has an iPhone 16e, no Mac, and no Apple Developer Program membership, and wants zero
spending for now.

- **No Xcode.** Without a Mac, Xcode is unavailable, so a native ARKit/Core ML app cannot be
  built locally or signed for normal use.
- **No LiDAR.** The iPhone 16e has a single rear camera and no LiDAR. The depth-sensor advantage
  in ADR 0002 does not apply to it.
- **The browser can run the models.** Safari 26 ships WebGPU, and the pretrained models in
  ADR 0003 (Depth Anything V2-Small, SAM 2.1-tiny, SigLIP 2) have ONNX exports usable from
  transformers.js / ONNX Runtime Web. Web apps get no AR poses on iOS.

## Decision

1. **The product runs as a PWA in Safari on the owner's iPhone 16e** for Phases 0–1.
   - All inference is on-device, using WebGPU with a WASM fallback.
   - It is served from free HTTPS static hosting.
   - The same PWA is the benchmark capture tool: photos, per-item weights, and export in the
     benchmark manifest format.
2. **Metric scale comes from a registered plate.**
   - The owner measures each plate or bowl diameter once with a ruler.
   - The app fits the rim ellipse, which gives scale and camera tilt.
   - Monocular relative depth is anchored to the plate plane.
   - A card is the fallback reference.
   - This replaces the unknown-plate prior (about 10.7% diameter error) with a measured one.
     T-007 measures what error remains.
3. **Native iOS is deferred**, not dropped. Models stay in ONNX so they convert to Core ML later.
   The free path is noted but not planned: an unsigned build from a GitHub Actions macOS runner,
   installed with a free Apple ID via Sideloadly or AltStore (re-signed every 7 days). Native
   returns in a new ADR if the PWA fails a gate because of scale or performance, or once a
   developer account exists.
4. **Feasibility first.** T-012 measures model load time, memory and latency in Safari on the
   16e before any pipeline work depends on it.

## Consequences

- Zero cost, and the owner can use it today. No Mac is needed at any point in Phases 0–1.
- There are no AR poses or LiDAR. Scale accuracy rests on plate registration and rim fitting,
  so a plate that has not been registered falls back to a card or a coarse prior.
- Browser memory limits may force smaller or quantized model variants; T-012 decides.
