# ADR 0013: Build DeepFilterNet3 With tract 0.21.18 and Wasm SIMD

- Status: Superseded by ADR 0014 (its speed-up did not hold on real speech)
- Date: 2026-09-28

## Context

libDF pins tract `^0.21.4`, whose tract-linalg has no wasm kernels: building with `+simd128` alone emitted SIMD
opcodes but gave no speedup (0.44 vs 0.49 ms mean per 10 ms frame, Node, M-series Mac). A slow machine is the main
risk of DeepFilterNet3 in a worklet (the budget is a 2.67 ms render quantum at 48 kHz).

- tract-linalg 0.21.6+ has a `simd128` f32 4x4 matmul kernel (`src/wasm.rs`).
- tract 0.21.5/0.21.6 fail at `df_create` on DeepFilterNet3 ("Patch created duplicate name ... /convt3/Conv.bias");
  0.21.18 loads it.
- 0.21.18 uses ndarray 0.16 (libDF uses 0.15) and renamed `Graph::symbol_table` to `symbols`.
- tract 0.22/0.23 would be a larger port, not attempted.

## Decision

`scripts/build-deepfilternet-wasm.sh` patches the pinned DeepFilterNet commit before building: tract `^0.21.18`,
libDF's ndarray imports switched to `tract_core::ndarray` in `tract.rs` and `wasm.rs`, `symbols` for
`symbol_table`, and `RUSTFLAGS="-C target-feature=+simd128"`.

## Consequences

> **Correction (2026-09-29).** The figures below were measured on white noise, on which libDF's default stage
> skipping (see #20) left most of the model unrun. On 20 s of real noisy speech, with both stages always run, the
> per-frame mean is 1.05 ms on tract 0.21.4 and 0.99 ms on tract 0.21.18 + SIMD: **no meaningful gain**. The SIMD
> kernel exists but does not matter at this tract version; tract 0.23.8 (ADR 0014) is where the speed-up is.

- Per frame, same machine, 7 alternated runs: mean 0.833 -> 0.639 ms (-23 %), median 0.743 -> 0.554 ms (-25 %),
  p95 1.207 -> 0.985 ms (-18 %). Of that, about -15 % is tract 0.21.18 itself and -12 % the SIMD kernel.
- Output is bit-identical to the 0.21.4 build (240,000 samples, max difference 0): the kernel vectorizes across
  outputs without reordering the sums.
- The wasm grows from 9.0 MB to 10.3 MB.
- Wasm SIMD is required: Chrome 91, Firefox 89, Safari 16.4 and later. Older browsers fail at compile time, which
  callers already handle as a load failure (WorkAdventure falls back to the browser's noise suppression). A
  non-SIMD fallback binary would double the download; not done.
