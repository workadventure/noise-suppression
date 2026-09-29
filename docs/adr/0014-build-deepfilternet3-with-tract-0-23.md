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

Per 10 ms frame on 20 s of **real noisy speech** (VoiceBank+DEMAND), both stages always run (#20), same machine
(Apple Silicon), Node (V8), 5 alternated runs; `df_create` (which blocks the audio thread) over 7 runs:

| Build | DeepFilterNet3 mean | p95 | DeepFilterNet3_ll mean | df_create (DFN3) |
|---|---|---|---|---|
| tract 0.21.4 | 1.05 ms | 1.22 ms | 2.67 ms | 387 ms |
| tract 0.21.18 + SIMD (ADR 0013) | 0.99 ms | 1.23 ms | 2.77 ms | 328 ms |
| tract 0.23.8 + SIMD | **0.33 ms** | **0.45 ms** | **1.00 ms** | 207 ms |

> **Correction (2026-09-29).** The first version of this ADR gave 0.406 / 0.303 / 0.158 ms, measured on white noise,
> on which libDF's default stage skipping (fixed in #20) left most of the model unrun. The ratio for tract 0.23.8 held
> up (~3× faster); the gain attributed to 0.21.18 did not.

- Output is not bit-identical any more but within float rounding: max difference 1.9e-7 over 240,000 samples
  (129 dB below the signal). Delay unchanged (30 ms).
- `DeepFilterNet3_ll` drops from 2.67 to 1.00 ms per frame, about what DeepFilterNet3 costs on tract 0.21.4 today,
  making it a candidate for a -20 ms option. With both stages always run its quality matches DeepFilterNet3
  (PESQ-WB 3.18 vs 3.22, DNSMOS OVRL 3.24 for both, see #20).
- The wasm grows from 10.3 MB (ADR 0013) to 14.6 MB.
- Measured on an Apple Silicon Mac only; x86 (SSE 128-bit) not measured.
