# ADR 0014: Build DeepFilterNet3 With tract 0.23

- Status: Proposed
- Date: 2026-09-29
- Supersedes: the tract version choice of ADR 0013 (wasm SIMD stays)

## Context

ADR 0013 moved the DeepFilterNet3 build to tract 0.21.18 with wasm SIMD (-23 % per frame). tract 0.23.8 is the
current release. libDF (pinned DeepFilterNet commit) targets the 0.21 API, so 0.23 needs a port.

Users also notice the voice delay of the whole chain (~91 ms in WorkAdventure). The low-latency model
`DeepFilterNet3_ll` would cut 20 ms but cost about twice the compute on 0.21, too close to the 2.67 ms render
quantum; faster inference is what could make it viable.

## Decision

- The build script applies `scripts/deepfilternet-tract-0.23.patch` to the pinned DeepFilterNet commit instead of
  editing it with Python. The patch drops `default-model` (as before), pins tract `=0.23.8`, ports `libDF/src/tract.rs`
  to the 0.23 API (plain array views, `TValue` as a tensor, `SimpleState` from `tract_core::internal`, outputs
  selected by outlet label since `with_output_names` is gone) and enables getrandom 0.4's `wasm_js` backend, which
  tract 0.23 pulls in through rand 0.10.
- The script pins `js-sys` 0.3.95 and `wasm-bindgen` 0.2.118 (getrandom 0.4 needs js-sys >= 0.3.77).
- The glue of that wasm-bindgen creates a `TextEncoder` at module evaluation: the AudioWorkletGlobalScope shim gains
  a small UTF-8 `TextEncoder` (only `encode`; the glue polyfills `encodeInto`).
- The worklet calls `initSync({ module })`, the non-deprecated form.

## Consequences

Same machine, Node (V8), 7 alternated runs, per 10 ms frame and for `df_create` (which blocks the audio thread):

| Build | mean | median | p95 | df_create |
|---|---|---|---|---|
| tract 0.21.4 | 0.406 ms | 0.380 ms | 0.519 ms | 387 ms |
| tract 0.21.18 + SIMD (ADR 0013) | 0.303 ms | 0.279 ms | 0.401 ms | 328 ms |
| tract 0.23.8 + SIMD | 0.158 ms | 0.125 ms | 0.304 ms | 207 ms |

- Output is not bit-identical any more but within float rounding: max difference 1.9e-7 over 240,000 samples
  (129 dB below the signal). Delay unchanged (30 ms).
- `DeepFilterNet3_ll` drops from 0.686 to 0.215 ms per frame (cheaper than today's DeepFilterNet3 on 0.21.4), making
  it a candidate for a -20 ms option; its quality is still to be measured.
- The wasm grows from 10.3 MB (ADR 0013) to 14.6 MB.
- Measured on an Apple Silicon Mac only; x86 (SSE 128-bit) not measured.
