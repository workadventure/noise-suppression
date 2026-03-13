# ADR 0003: AudioWorklet Validation and LiteRT.js Loader Limitation

- Status: Accepted
- Date: 2026-03-13

## Context

After ADR 0002, the repository became a browser-only LiteRT.js package. The
next desired integration target was `AudioWorklet`.

That environment is more constrained than the page runtime:

- it does not expose `document`
- it does not expose the same global browser objects as `window`
- it disallows `import()` inside `AudioWorkletGlobalScope`
- it requires the processor module to be statically importable and loadable via
  `audioContext.audioWorklet.addModule(...)`

At the same time, the public package entrypoint in
[`src/index.ts`](../../src/index.ts) still contained browser-only assumptions:

- packaged asset resolution via `new URL(..., import.meta.url)`
- default thread-count detection via `navigator.hardwareConcurrency`
- top-level reliance on Vite-defined `__NOISE_SUPPRESSION_*` globals

Those assumptions are acceptable in the normal browser entrypoint, but they are
not suitable for direct use inside `AudioWorkletGlobalScope`.

## Decision

Do not treat direct LiteRT.js initialization inside `AudioWorkletGlobalScope`
as a supported capability yet.

Instead:

- keep a browser-oriented package entrypoint in [`src/index.ts`](../../src/index.ts)
- introduce a worklet-safe core runtime in [`src/runtime.ts`](../../src/runtime.ts)
  that requires explicit asset URLs
- validate worklet loading through Vite-emitted worklet URLs using
  `?worker&url`
- record LiteRT.js loader behavior as the current blocker

Until LiteRT.js can bootstrap its Wasm runtime without assuming either
`document` or `importScripts`, this package should not claim native
AudioWorklet support for the full denoiser runtime.

## Why

### 1. The worklet module loading path itself is viable

A validation harness was added in
[`demo/audio-worklet-validation.ts`](../../demo/audio-worklet-validation.ts)
to exercise four probes:

- a bare control processor
- a processor importing `@litertjs/core`
- a processor importing `fft.js`
- a processor initializing the full noise suppression runtime

The page now imports processor URLs through Vite using `?worker&url`, then
passes those URLs to `audioContext.audioWorklet.addModule(...)`.

That loading strategy works correctly.

### 2. The package entrypoint needed to be split

To make worklet validation meaningful, the runtime implementation was separated
from browser-only defaults:

- [`src/runtime.ts`](../../src/runtime.ts) now exposes
  `createNoiseSuppressionRuntime(...)`, which requires explicit
  `liteRtWasmRoot`, `model1Url`, and `model2Url`
- [`src/index.ts`](../../src/index.ts) remains the browser-friendly wrapper that
  keeps Vite asset resolution and thread defaults

This isolates environment-specific behavior and makes the core runtime
statically importable from a worklet processor.

### 3. The remaining failure is inside LiteRT.js itself

The validation produced a clear result:

- control processor: success
- `@litertjs/core` import probe: success
- `fft.js` import probe: success
- full LiteRT runtime init: failure

The failure occurs when the worklet calls
[`createNoiseSuppressionRuntime(...)`](../../src/runtime.ts#L501), which in turn
calls `loadLiteRt(...)`.

In Chrome, the full-init probe failed with:

- `ReferenceError: document is not defined`

The stack points into LiteRT.js’s own loader path, where it attempts to load
supporting scripts through DOM script injection when `importScripts` is not
available.

This means:

- the worklet itself is not the blocker
- Vite worklet bundling is not the blocker
- the repository’s runtime split is not the blocker
- LiteRT.js Wasm bootstrapping is the blocker

### 4. Dynamic import is not a viable fallback inside AudioWorklet

An earlier validation step attempted to work around the old browser entrypoint
by using `import()` inside the processor after seeding globals manually.

That failed with:

- `TypeError: import() is disallowed on WorkletGlobalScope`

So a worklet-compatible runtime must be statically importable from the start.

## Consequences

### Positive

- The repository now has a cleaner separation between:
  - browser entrypoint concerns
  - environment-neutral runtime logic
- AudioWorklet validation is now reproducible through dedicated demo files.
- The exact blocker has been narrowed to LiteRT.js loader behavior instead of
  vague worklet incompatibility.

### Negative

- Direct AudioWorklet support remains blocked.
- The package cannot currently advertise a fully supported
  `AudioWorkletProcessor` integration for the denoiser runtime.
- Further progress likely requires either:
  - patching/forking LiteRT.js loader behavior
  - upstream support from LiteRT.js for worklet-safe Wasm bootstrapping

## Alternatives Considered

### Keep using the browser entrypoint inside the worklet

Rejected because [`src/index.ts`](../../src/index.ts) intentionally contains
page-oriented asset resolution and browser-global assumptions.

### Use `import()` in the processor as a late-binding workaround

Rejected because `import()` is disallowed in `AudioWorkletGlobalScope`.

### Assume the issue was caused by Vite worklet loading

Rejected because the control, LiteRT import, and FFT import probes all loaded
correctly via the Vite-generated worklet URLs.

## Implementation Notes

This investigation introduced:

- a worklet-safe core runtime in [`src/runtime.ts`](../../src/runtime.ts)
- a browser wrapper entrypoint in [`src/index.ts`](../../src/index.ts)
- a validation processor in [`demo/audio-worklet-processor.ts`](../../demo/audio-worklet-processor.ts)
- additional worklet probes in:
  - [`demo/audio-worklet-control-processor.ts`](../../demo/audio-worklet-control-processor.ts)
  - [`demo/audio-worklet-import-core-processor.ts`](../../demo/audio-worklet-import-core-processor.ts)
  - [`demo/audio-worklet-import-fft-processor.ts`](../../demo/audio-worklet-import-fft-processor.ts)
- a validation page in
  [`audio-worklet-validation.html`](../../audio-worklet-validation.html) and
  [`demo/audio-worklet-validation.ts`](../../demo/audio-worklet-validation.ts)

Validation completed successfully for repository code changes with:

- `npm run typecheck`
- `npm run build`

## Follow-up Work

- evaluate whether LiteRT.js can be patched locally to load its Wasm support
  files in `AudioWorkletGlobalScope` without DOM access
- determine whether that patch is appropriate to carry in-repo or should be
  proposed upstream
- if LiteRT.js becomes worklet-safe, rerun the validation harness and measure
  realtime performance inside the actual worklet callback path
