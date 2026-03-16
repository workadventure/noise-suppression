# ADR 0006: Buffer AudioWorklet Input and Output Around 512-Sample DTLN Frames

- Status: Accepted
- Date: 2026-03-13

## Context

ADR 0004 introduced a functional `AudioWorklet` integration and an internal
benchmark for the worklet path.

That implementation had an important flaw:

- [`src/audio-worklet-processor.ts`](../../src/audio-worklet-processor.ts)
  called `dtln_denoise()` directly from each `process(...)` callback
- `AudioWorkletProcessor.process(...)` typically receives `128` samples per
  render quantum
- the DTLN runtime is designed around `512`-sample frames

This meant the worklet processor was not following the expected buffering
pattern from Chrome’s AudioWorklet guidance. It also meant the earlier
worklet-side benchmark did not measure the real `dtln_denoise(512)` execution
path.

Source:

- https://developer.chrome.com/blog/audio-worklet-design-pattern

## Decision

Adopt an explicit input/output ring-buffer design inside the worklet processor.

The processor now:

- accumulates incoming render quanta in an input ring buffer
- invokes `dtln_denoise()` only when `512` input samples are available
- writes the `512` processed samples into an output ring buffer
- drains output samples back to the current render quantum

This matches the Chrome AudioWorklet design-pattern guidance for handling a
processing block size that is larger than the engine render quantum.

## Why

### 1. The previous processor behavior was semantically wrong

The issue was not only one of performance measurement. The processor contract
itself was incorrect.

Running `dtln_denoise()` on `128`-sample blocks changed the effective runtime
behavior instead of faithfully adapting the `512`-sample DTLN algorithm to the
worklet environment.

### 2. The worklet needs an explicit latency tradeoff

The correct design introduces a small, intentional startup delay:

- the processor needs four `128`-sample render quanta to assemble one
  `512`-sample DTLN frame

That latency is expected and preferable to pretending that a partial frame is a
valid denoise input.

### 3. The benchmark must measure real denoise calls

Once the processor is buffered correctly, benchmark timings should correspond to
actual `dtln_denoise(512)` calls, not to per-quantum callbacks or scaled
estimates.

## Implementation

### Worklet processor buffering

[`src/audio-worklet-processor.ts`](../../src/audio-worklet-processor.ts) now
contains:

- a small `Float32RingBuffer` implementation
- an input ring buffer
- an output ring buffer
- reusable `Float32Array(512)` input/output work buffers

The `processQuantum(...)` path:

1. appends the current input quantum to the input ring buffer
2. runs `dtln_denoise()` while at least `512` input samples are available
3. enqueues each `512`-sample result into the output ring buffer
4. drains one render quantum into the worklet output buffer
5. outputs silence until enough denoised samples are available

The processor no longer assumes that the render quantum must always be hardcoded
to `128`, although current browser behavior still reports `128` in practice.

### Benchmark contract update

[`src/audio-worklet-shared.ts`](../../src/audio-worklet-shared.ts) now reports
both:

- `frameSamples`
- `renderQuantumSamples`

This makes the benchmark protocol explicit about what is being timed versus what
the worklet engine is delivering.

[`demo/audio-worklet-benchmark.ts`](../../demo/audio-worklet-benchmark.ts) was
updated accordingly:

- it now reports the render quantum size and denoise frame size separately
- it reports timings directly as `dtln_denoise(512)` timings
- it no longer extrapolates a `128`-sample timing into a fake `512`-sample
  equivalent

### Documentation update

[`README.md`](../../README.md) now states that the worklet path buffers four
render quanta into a `512`-sample DTLN frame and drains a matching output ring
buffer.

## Results

### Functional result

The worklet path now matches the expected block-size adaptation model for DTLN:

- render quanta are buffered on input
- denoise is executed on full `512`-sample frames
- processed output is buffered and drained back to the engine quantum size

This fixes the earlier mismatch between the `AudioWorklet` callback shape and
the denoiser frame contract.

### Updated benchmark result

The worklet benchmark was rerun through
[`audio-worklet-benchmark.html`](../../audio-worklet-benchmark.html) after the
buffering correction.

Single-threaded result:

- init: `226.325 ms`
- render quantum: `128` samples
- denoise frame: `512` samples
- mean `dtln_denoise(512)`: `3.020 ms`
- p95 `dtln_denoise(512)`: `6.000 ms`
- min: `2.000 ms`
- max: `13.000 ms`

Threaded mode is still unavailable in the current worklet fork and reports:

- `Threaded bundled LiteRT loading is not supported yet in the worklet fork.`

## Consequences

### Positive

- The `AudioWorklet` path now adapts block sizes correctly.
- The worklet benchmark now measures the real denoise unit of work.
- The library behavior is now aligned with the Chrome AudioWorklet design
  guidance.

### Negative

- The corrected implementation introduces expected buffering latency before the
  first denoised output becomes available.
- The earlier worklet benchmark figures from ADR 0004 should no longer be used
  as the authoritative result.

## Limitations

- Worklet-side timing still falls back to `Date.now()` in this environment
  because `performance.now()` is not available inside
  `AudioWorkletGlobalScope`.
- Threaded bundled LiteRT loading in the worklet fork is still not implemented.

