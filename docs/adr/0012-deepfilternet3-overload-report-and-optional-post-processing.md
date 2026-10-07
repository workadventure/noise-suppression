# ADR 0012: DeepFilterNet3 Reports Overload; Keystroke Filter and Post Gain Are Opt-In

- Status: Proposed
- Date: 2026-09-28

## Context

- A worklet that cannot keep up does not fail: it makes the audio crackle, and nothing tells the page. Building
  libDF with `+simd128` gave no speedup (tract 0.21.4 has no wasm SIMD matmul kernels; mean 0.44 vs 0.49 ms per
  10 ms frame on an M-series Mac), so a slow machine has no other safety net.
- The pause gate opens on any frame the model kept that stands above the floor. A keystroke the model only partly
  removed can be such a frame, for one or two frames.
- The browser's automatic gain control runs before the denoiser: it raises the room noise with a quiet voice, and
  the denoiser then removes less of it.

## Decision

- The processor times each frame and posts `{ type: "overload", load }` once when two 2 s windows in a row used
  more than `maxLoad` (default 0.7) of real time. It keeps running; `createDeepFilterNetAudioWorklet` takes an
  `onOverload` callback and leaves the decision (fall back to another processing) to the caller.
- `minSpeechFrames` (default 1, unchanged behaviour): consecutive speech frames the pause gate needs before opening.
  2 or 3 keeps one-frame clicks out; it must stay below the 3-frame lookahead, so the first syllable loses at most
  one frame of attack.
- `postGain` (default off): a slow level control after the denoiser and the gate (5 dB/s, +15/-10 dB, moves only
  on frames above -45 dBFS, per-frame ceiling at 0.9). Meant to replace the browser's AGC, to be turned off on the
  microphone by the caller.

Both options are opt-in until listening tests on a deployed WorkAdventure decide their defaults.

## Consequences

- `DeepFilterNetAudioWorkletOutboundMessage` gains an `overload` member; the ready promise ignores it.
- Timing uses `performance.now()` when the worklet scope has it, else `Date.now()` (1 ms resolution, averaged over
  200 frames).
