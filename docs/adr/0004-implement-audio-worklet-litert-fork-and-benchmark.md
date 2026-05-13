# ADR 0004: Implement AudioWorklet LiteRT Fork and Benchmark

- Status: Superseded by [ADR 0007](./0007-use-litert-esm-fork-for-audioworklet.md)
- Date: 2026-03-13

## Context

ADR 0003 established two important facts:

- the `AudioWorklet` loading path itself works in this repository
- stock LiteRT.js does not initialize inside `AudioWorkletGlobalScope` because
  its Wasm loader assumes either `document` or `importScripts`

At that point, the repository had:

- a browser-oriented package entrypoint in [`src/index.ts`](../../src/index.ts)
- a worklet-safe core runtime in [`src/runtime.ts`](../../src/runtime.ts)
- a validation harness proving that the remaining blocker was LiteRT.js loader
  behavior

The next step was to determine whether a repository-local fork could make the
DTLN runtime actually usable inside an `AudioWorkletProcessor`, and whether the
worklet path remained fast enough for realtime use.

## Decision

Implement a repository-local LiteRT fork for the `AudioWorklet` path and ship a
dedicated public worklet entrypoint.

The chosen design is:

- keep the regular browser runtime in [`src/index.ts`](../../src/index.ts)
- vendor a minimal LiteRT fork under
  [`forks/litertjs-core`](../../forks/litertjs-core)
- bootstrap the worklet runtime from bundled loader source plus in-memory Wasm
  and model bytes
- expose a public main-thread helper in
  [`src/audio-worklet.ts`](../../src/audio-worklet.ts)
- keep denoising synchronous inside `process(...)` once initialization is
  complete
- benchmark `dtln_denoise()` from inside the processor rather than from the
  main thread

This uses the “Pattern A” direction from the Chrome AudioWorklet design-pattern
article: the processor module is loaded directly by `audioWorklet.addModule(...)`
and initializes its own Wasm runtime inside `AudioWorkletGlobalScope`.

## Why

### 1. The package needed a worklet-specific bootstrap, not just a validation harness

The earlier validation work proved that the repository code was no longer the
blocking factor. The missing piece was a worklet-safe LiteRT bootstrap that:

- did not rely on `document`
- did not rely on `importScripts`
- did not rely on `import()` inside the worklet
- did not rely on URL-based asset lookup inside the processor

So the correct next step was an explicit fork, not another probe.

### 2. The LiteRT fork could be kept narrow

The repository does not need a general-purpose LiteRT fork. It only needs the
minimum surface required by the DTLN browser runtime:

- Wasm backend only
- CPU execution only
- the model compilation and tensor APIs already used by [`src/runtime.ts`](../../src/runtime.ts)
- a worklet-safe loader entry for bundled Wasm bytes

That made a repo-local fork a practical short-term solution.

### 3. Main-thread asset resolution is the cleanest boundary

The worklet should not discover assets for itself. The adopted boundary is:

- the main thread resolves and fetches the `.tflite` models and Wasm binary
- the main thread adds the processor module through Vite’s emitted worker URL
- the processor receives raw bytes through `processorOptions`

That keeps the processor deterministic and avoids environment-specific asset
machinery in `AudioWorkletGlobalScope`.

### 4. Worklet timing must be measured in the processor

Once the runtime moves into `AudioWorkletGlobalScope`, timing from the main
thread is no longer a useful proxy for the actual render-thread cost.

The benchmark therefore times `dtln_denoise()` directly inside
[`src/audio-worklet-processor.ts`](../../src/audio-worklet-processor.ts) and
returns aggregated results through the message port.

## Implementation

### Repository-local LiteRT fork

The fork lives in [`forks/litertjs-core`](../../forks/litertjs-core) and is
based on the built upstream LiteRT artifacts already used by the package.

The fork adds a bundled-assets initialization path in
[`forks/litertjs-core/index.js`](../../forks/litertjs-core/index.js):

- `loadLiteRtFromBundledAssets(loaderSource, wasmBinary, options)`

That path:

- evaluates the vendored Emscripten loader script directly
- builds the LiteRT Wasm module from in-memory bytes
- creates the LiteRT runtime without DOM script injection

The fork also patches a few browser-global assumptions that are invalid inside
the worklet:

- `TextDecoder`
- `URL`
- `GPUBuffer`

### Public AudioWorklet API

The public worklet entrypoint is
[`src/audio-worklet.ts`](../../src/audio-worklet.ts).

It exposes:

- `createNoiseSuppressionAudioWorklet(...)`
- `observeNoiseSuppressionAudioWorkletMessages(...)`
- `runNoiseSuppressionAudioWorkletBenchmark(...)`

This helper:

- resolves packaged assets on the main thread
- fetches the model and Wasm bytes
- loads the processor module through Vite’s `?worker&url` output
- creates the `AudioWorkletNode`
- waits for the processor to confirm readiness

The processor itself lives in
[`src/audio-worklet-processor.ts`](../../src/audio-worklet-processor.ts).

It:

- initializes the forked LiteRT runtime asynchronously
- creates the DTLN handle once ready
- runs synchronous `dtln_denoise()` calls from `process(...)`
- supports a benchmark command channel over `port.postMessage(...)`

Shared worklet message and option types live in
[`src/audio-worklet-shared.ts`](../../src/audio-worklet-shared.ts).

### Browser/runtime refactor

The browser-specific asset and thread defaults were moved into
[`src/browser-runtime-options.ts`](../../src/browser-runtime-options.ts) so the
regular browser entrypoint and the worklet entrypoint can share the same
resolution logic without pulling page-only behavior directly into the
processor.

### Demo and validation pages

This work introduced:

- a public worklet demo in [`audio-worklet.html`](../../audio-worklet.html) and
  [`demo/audio-worklet-demo.ts`](../../demo/audio-worklet-demo.ts)
- an updated validation page in
  [`audio-worklet-validation.html`](../../audio-worklet-validation.html) and
  [`demo/audio-worklet-validation.ts`](../../demo/audio-worklet-validation.ts)
- a dedicated worklet benchmark page in
  [`audio-worklet-benchmark.html`](../../audio-worklet-benchmark.html) and
  [`demo/audio-worklet-benchmark.ts`](../../demo/audio-worklet-benchmark.ts)

### Package/build changes

The package now exports a dedicated subpath:

- `@workadventure/noise-suppression/audio-worklet`

This is wired through [`package.json`](../../package.json) and the Vite library
build in [`vite.config.mjs`](../../vite.config.mjs).

## Results

### Functional result

The worklet path now initializes successfully and processes audio inside
`AudioWorkletGlobalScope`.

The validation page confirms:

- the public helper loads the processor module
- the processor initializes the forked LiteRT runtime
- the DTLN models compile successfully inside the worklet
- the processor reaches `process(...)` and reports `processing-started`

### Benchmark result

The worklet benchmark was run with:

- `40` warmup calls
- `300` measured calls
- single-threaded worklet mode

Measured from inside the processor:

- mean `dtln_denoise()`: `0.963 ms`
- p95 `dtln_denoise()`: `2.000 ms`
- min: `0.000 ms`
- max: `3.000 ms`

For the current `128`-sample render quantum, that corresponds to an approximate
`512`-sample equivalent of:

- mean: `3.853 ms`
- p95: `8.000 ms`

These measurements indicate that the worklet path remains comfortably under the
32 ms realtime budget.

## Consequences

### Positive

- The package now has a real `AudioWorklet` integration path instead of only a
  validation harness.
- The processor no longer depends on DOM-specific LiteRT loading behavior.
- The public API cleanly separates:
  - normal browser use
  - worklet use
- The repository can now benchmark render-thread cost directly instead of
  inferring it from the page runtime.

### Negative

- The worklet path depends on a repository-local LiteRT fork.
- The packaged worklet entrypoint is large because it bundles the forked loader
  path and supporting runtime code.
- The worklet benchmark currently uses `Date.now()` granularity rather than a
  higher-resolution timer.

## Limitations

### 1. `performance.now()` was still unavailable inside the worklet

The benchmark page was served under COOP/COEP and the page itself was confirmed
to be `crossOriginIsolated === true`.

However, a direct worklet probe showed that this Chrome setup still does not
expose `globalThis.performance` inside `AudioWorkletGlobalScope`.

So the worklet benchmark in
[`src/audio-worklet-processor.ts`](../../src/audio-worklet-processor.ts) falls
back to `Date.now()`.

That makes the current measurements useful but coarse. In particular:

- minima can report `0 ms`
- per-call timing is quantized to roughly millisecond resolution

### 2. Threaded bundled LiteRT loading is not supported yet in the worklet fork

The benchmark page attempted both:

- single-threaded worklet mode
- threaded worklet mode

The single-threaded benchmark completed successfully.

The threaded benchmark is still blocked by the current fork and reports:

- `Threaded bundled LiteRT loading is not supported yet in the worklet fork.`

So this ADR only records a valid single-threaded worklet benchmark result.

## Alternatives Considered

### Continue using stock LiteRT.js in the worklet

Rejected because ADR 0003 already identified the LiteRT loader itself as the
blocking factor.

### Keep AudioWorklet support private and avoid a public API

Rejected because the integration was already stable enough to deserve an
explicit main-thread helper, and consumers should not need to know about the
forked loader details.

### Benchmark from the page instead of from `process(...)`

Rejected because that would not measure the real render-thread execution cost.

## Validation

This work was validated with:

- `npm run typecheck`
- `npm run build`
- the public worklet validation page
- the public worklet demo page
- the dedicated worklet benchmark page

## Follow-up Work

- improve benchmark precision by batching timing work or introducing a
  higher-resolution timing strategy that does not rely on
  `AudioWorkletGlobalScope.performance`
- investigate threaded bundled LiteRT loading for the worklet fork
- reduce the size of the packaged worklet entrypoint
- decide whether the repo-local LiteRT fork should remain internal or be split
  into a dedicated external fork
