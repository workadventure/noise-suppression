# ADR 0010: Run One DTLN Block Shift per Render Quantum

- Status: Accepted
- Date: 2026-09-23
- Supersedes: [ADR 0006: Buffer AudioWorklet Input and Output Around 512-Sample DTLN Frames](./0006-buffer-audio-worklet-input-and-output-around-512-sample-dtln-frames.md)

## Context

ADR 0006 made the worklet accumulate four 128-sample render quanta and call
`dtln_denoise()` once on 512 samples, on the assumption that 128-sample calls
changed DTLN's behavior.

That no longer holds. `NoiseSuppressionInstance.denoise()` is a streaming
implementation: it keeps the 512-sample input window, the overlap-add output
buffer and the LSTM states between calls, and processes its input one
`DTLN_BLOCK_SHIFT` (128 samples) at a time. Calling it with 4 × 128 samples
runs exactly the same four inferences as calling it with 512.

The 512-sample buffering had two costs:

- every fourth `process()` callback ran four inferences (eight LiteRT model
  invocations) while the other three ran none. At 16 kHz a render quantum is an
  8 ms deadline; the demo site measured a 7 ms maximum for one 512-sample call
  on Apple Silicon, so slower machines overrun it and the output glitches.
- about 24 ms of extra latency (three quanta of silence at start, then a
  permanently deeper output ring).

## Decision

Set `DENOISE_FRAME_SAMPLES` to 128 (one DTLN block shift, one render quantum).
The ring buffers stay, so render quanta of other sizes still work.

## Consequences

- Peak work per callback is divided by four; total work is unchanged.
- About 24 ms less latency.
- Output is bit-identical: `test/browser-runtime.browser.test.ts` checks that
  128-sample calls produce the same samples as 512-sample calls.
- Worklet benchmark timings are now per 128-sample call, so they are not
  comparable to ADR 0006 figures without multiplying by four.
