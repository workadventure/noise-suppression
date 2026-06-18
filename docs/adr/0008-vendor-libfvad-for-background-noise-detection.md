# ADR 0008: Vendor libfvad for Background Noise Detection

- Status: Superseded by [ADR 0009](./0009-use-silero-vad-web-for-background-noise-detection.md)
- Date: 2026-06-12

This decision was implemented and evaluated, but libfvad classified the tested
loud noise-only fixtures as speech. ADR 0009 replaces it with Silero VAD, and
the vendored libfvad implementation has been removed.

## Context

We want to add a background-noise detector that can run when DTLN noise
suppression is disabled.

The detector should identify cases where microphone input is loud but likely not
speech, then emit a background-noise event so the application can recommend
enabling noise suppression.

This detector has different constraints from the existing DTLN AudioWorklet:

- it should run before the user enables noise suppression
- it must not load the DTLN LiteRT runtime or the DTLN model assets
- it should be cheap enough to start with WorkAdventure
- it should work in a separate AudioWorklet from the DTLN denoiser
- it only needs enough VAD accuracy to distinguish sustained non-speech noise
  from likely voice when combined with raw audio level

We considered several VAD implementation options.

`@ozymandiasthegreat/vad` is a small browser-compatible libfvad/WebRTC VAD
wrapper, but the package has not had a release since 2022 and the repository is
archived.

`@echogarden/fvad-wasm` is also small, but it has very low adoption and limited
release history.

`@ricky0123/vad-web` is actively maintained and uses Silero VAD through ONNX
Runtime Web. It should provide better VAD quality, but it adds a much larger
startup footprint. The package includes ONNX models around 1.8 MB to 2.3 MB
raw, and ONNX Runtime Web typically requires a multi-megabyte wasm backend.

`@picovoice/cobra-web` is actively maintained, but it requires a Picovoice
access key and would introduce a vendor service dependency for a basic local
detector.

`@jitsi/rnnoise-wasm` is closer to Jitsi's existing noisy-mic detection path,
but it would duplicate another denoising stack when this feature only needs VAD
plus raw audio-level detection.

## Decision

Vendor libfvad directly in this repository and build a small internal wrapper
for the background-noise detector worklet.

The detector will use libfvad/WebRTC VAD as a binary voice/no-voice classifier
and combine that result with raw input RMS over a time window.

The implementation should:

- keep the background-noise detector in a separate AudioWorklet from DTLN
- avoid importing LiteRT, DTLN models, or DTLN worklet code
- vendor the minimal libfvad wasm artifact and loader needed by the detector
- expose only this repository's own detector API to consumers
- keep the libfvad wrapper internal so we can replace the VAD backend later
- document the vendored source, license, and rebuild procedure

## Consequences

The detector startup footprint remains small and independent from the 17 MB DTLN
noise-suppression assets.

The repository takes ownership of a small vendored third-party artifact instead
of relying on abandoned npm wrappers. This means we must keep the source,
license, and rebuild process clear enough for future updates.

libfvad/WebRTC VAD returns a binary decision rather than a calibrated speech
probability. The background-noise detector must therefore rely on windowed
aggregation and raw RMS thresholds instead of treating the VAD result as a
confidence score.

This is less accurate than Silero VAD in difficult noisy environments, but it is
a better fit for a lightweight startup detector whose role is to recommend
noise suppression, not to perform precise speech segmentation.

If field results show too many false positives or false negatives, the internal
wrapper boundary lets us replace libfvad with a heavier backend such as Silero
without changing the public detector API.
