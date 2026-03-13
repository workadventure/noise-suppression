# ADR 0001: Use LiteRT.js as the Default Browser Backend

- Status: Accepted
- Date: 2026-03-13

## Context

This project originally exposed a browser build based on the Rust/TFLite engine
compiled to WebAssembly with Emscripten.

That browser path was not meeting the realtime target for `dtln_denoise()`.
Measured in Chrome on a 512-sample frame:

- Rust/WASM browser backend: about `32.11 ms` mean, `37.40 ms` p95
- Realtime requirement: anything above `32 ms` is unsuitable

The Rust/WASM path was optimized first:

- reused FFT plans and scratch buffers instead of rebuilding them per call
- removed redundant phase reconstruction in the masking path
- reduced JS/wasm buffer-copy overhead in the browser wrapper

Those changes improved the WebAssembly build, but they did not change the main
browser conclusion: the browser-specific inference stack remained the dominant
cost and still risked missing the realtime budget.

At the same time, a LiteRT.js prototype was built using the same shipped
`.tflite` models:

- `model/model_quant_1.tflite`
- `model/model_quant_2.tflite`

The LiteRT.js prototype preserved the DTLN orchestration already implemented in
Rust:

- rolling 512-sample analysis window
- 128-sample hop processing
- FFT magnitude extraction
- first-model mask inference
- inverse FFT
- second-model time-domain refinement
- recurrent state handling
- overlap-add output reconstruction

## Decision

Use LiteRT.js as the default browser backend for this package.

Specifically:

- Keep the native Rust addon as the default Node.js backend.
- Route browser resolution to a dedicated browser entrypoint backed by
  LiteRT.js.
- Preserve the existing browser API shape:
  - `dtln_create()`
  - `dtln_denoise()`
  - `dtln_stop()`
  - `dtln_destroy()`
  - `ready`
- Enable LiteRT.js threads automatically when the page is cross-origin isolated
  (`COOP`/`COEP`).
- Keep the older Rust/WASM browser build available for comparison and migration
  work, but do not make it the default browser path.

## Why

### 1. LiteRT.js is materially faster in the browser

Using the same models and the same DTLN control flow, the LiteRT.js browser
backend outperformed the Rust/WASM browser backend by a wide margin.

Measured in Chrome on the same 512-sample seeded-noise frame:

- Rust/WASM browser backend: `32.11 ms` mean, `37.40 ms` p95
- LiteRT.js browser backend: `4.26 ms` mean, `6.10 ms` p95
- Output difference between both backends: about `9.69e-8` max absolute error

This indicates the change is a runtime/performance improvement, not an
algorithmic change.

### 2. The bottleneck is model execution, not FFT

Profiling the LiteRT.js browser path showed that most time is spent in model
invocation and adjacent tensor marshaling, not in FFT/IFFT math.

Representative profiled run:

- `model2_invoke`: about `44%`
- `model1_invoke`: about `37%`
- FFT + magnitude + IFFT combined: about `4%`

This made further FFT-focused browser optimization low leverage.

### 3. Browser threading works cleanly with LiteRT.js

Under cross-origin isolation, the LiteRT.js browser backend improved further.
Across repeated Chrome benchmark rounds:

- LiteRT.js, single-threaded under COI: `3.85 ms` mean of round means
- LiteRT.js, threaded under COI: `2.63 ms` mean of round means

This is roughly a `1.46x` speedup from threading alone.

### 4. The Rust/WASM pthread path is possible, but expensive to maintain

Investigation of a threaded Rust/Emscripten path found several structural
problems:

- Rust `wasm32-unknown-emscripten` stdlib needs to be rebuilt with the exact
  atomics/shared-memory flags used for the threaded link.
- The checked-in TFLite wasm prebuilt is effectively single-threaded and would
  need a separate pthread-enabled rebuild.
- The current Rust engine still hardcodes the TFLite thread count to `1`.
- Browser deployment would still require cross-origin isolation and additional
  threaded build packaging.

This is feasible, but it is a higher-complexity path than using LiteRT.js for
the browser runtime.

## Consequences

### Positive

- Browser realtime performance is now comfortably within the target budget.
- The browser runtime continues to use the existing `.tflite` models.
- Node.js keeps the native addon path, which remains the best fit for server and
  CLI use.
- Browser threads can be enabled automatically when the environment supports
  them.

### Negative

- The browser backend now depends on LiteRT.js runtime packaging.
- Best browser performance requires cross-origin isolation.
- The browser code path is now meaningfully different from the Node native path,
  so both need to be validated independently.
- TypeScript ergonomics are currently split:
  - root package types remain Node-oriented
  - browser-specific typings are exposed via the `./browser` entrypoint

## Alternatives Considered

### Continue optimizing the Rust/WASM browser backend

This was attempted first and produced useful wins, but not enough to justify
keeping it as the default browser runtime.

### Add pthreads to the Rust/WASM browser backend

This remains a valid future option, but it requires substantially more build and
packaging work than the LiteRT.js approach and still would need browser
cross-origin isolation.

### Replace the browser backend with TensorFlow.js

The TensorFlow.js WebAssembly performance strategy was useful as a reference,
but this project already operates on `.tflite` models and TFLite-style
inference. LiteRT.js is the closer fit.

## Implementation Notes

The accepted implementation introduces:

- a dedicated browser entrypoint
- browser-specific type definitions
- browser demos and benchmarks routed through the LiteRT.js entrypoint
- package metadata that keeps Node on the native loader while resolving browser
  builds to the LiteRT.js path

## Follow-up Work

- improve TypeScript ergonomics for browser consumers at the package root
- decide how long to keep the old Rust/WASM browser artifact in the repo
- document browser deployment requirements for threaded execution more explicitly
- add repeatable browser benchmarks to CI or release validation
