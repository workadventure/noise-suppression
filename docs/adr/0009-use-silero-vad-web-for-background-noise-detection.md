# ADR 0009: Use Silero VAD Web for Background Noise Detection

- Status: Accepted
- Date: 2026-06-15
- Supersedes: [ADR 0008: Vendor libfvad for Background Noise Detection](./0008-vendor-libfvad-for-background-noise-detection.md)

## Context

ADR 0008 selected a vendored libfvad/WebRTC VAD backend because it was small,
offline, and independent from the DTLN LiteRT runtime.

After implementing the first background-noise detector worklet and testing it
with synthetic/noise-only clips, libfvad proved to be a poor fit for this
feature. Native libfvad and the Wasm build both classified loud noise-only
samples as speech almost all the time:

- `clips/pure-noise.wav`: nearly 100% speech in every mode
- `clips/white-noise-15s.wav`: nearly 100% speech in every mode

This behavior is consistent with WebRTC VAD's design. It is an online,
energy-oriented VAD with adaptive foreground/background estimation and a
Gaussian mixture model over frequency sub-bands. It is useful for speech
activity in many real-time communication cases, but it can treat loud,
speech-band-like noise as active speech.

The background-noise detector needs the inverse signal: sustained loud input
that is probably not speech. A binary WebRTC-style VAD is therefore too weak for
this feature unless we add many heuristics around it.

## Decision

Replace the libfvad backend with a Silero VAD based backend, using
`@ricky0123/vad-web` as the first integration path.

`@ricky0123/vad-web` runs Silero VAD through ONNX Runtime Web and is maintained
as a browser-focused package. This gives us a speech probability signal instead
of a binary WebRTC VAD result.

The detector architecture should remain split from the DTLN denoiser:

- keep the background-noise detector as a separate public package entrypoint
- expose the detector as a stream-based API that accepts the `MediaStream` to
  analyze
- do not create a dedicated background-noise `AudioWorkletNode`
- run Silero/ONNX inference outside any custom AudioWorklet render thread
- combine speech probability, RMS, and sustained-window rules before emitting
  `background-noise-detected`

The first implementation may use `@ricky0123/vad-web` directly to reduce custom
model/runtime code. Its `MicVAD` API can accept a custom stream through
`getStream`, so callers can pass microphone streams directly, use
`HTMLMediaElement.captureStream()` where available, or mirror a Web Audio graph
into a `MediaStreamDestination` for clips and processed sources.

`@ricky0123/vad-web` may still use its own internal `vad-helper-worklet` when
`processorType` is `AudioWorklet`. That internal helper performs capture and
framing for Silero. We should not wrap it in our own pass-through detector
worklet.

## Consequences

The detector should be more robust to loud non-speech noise than libfvad,
because Silero is a neural VAD trained for broader noisy conditions and returns
a probability-like score.

Startup and package footprint will increase. The current npm package metadata
shows `@ricky0123/vad-web` is several megabytes unpacked and depends on
`onnxruntime-web`, whose package is much larger. We should lazy-load this path
only when the background-noise detector is enabled.

ONNX Runtime Web should not run inside any custom AudioWorklet hot path. With
the `@ricky0123/vad-web` integration, the package's internal helper worklet
posts framed audio and the main-thread VAD pipeline runs ONNX inference before
calling our `onFrameProcessed` hook.

The implementation needs a small latency budget. Silero operates on chunks
rather than individual 128-sample render quanta, so background-noise events
should remain windowed and advisory rather than instantaneous.

The existing libfvad vendored code can stay temporarily while the replacement
is built and compared. Once the Silero backend is validated against the demo
clips and browser tests, libfvad should be removed unless we intentionally keep
it as a fallback.
