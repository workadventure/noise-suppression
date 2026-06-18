# Plan: Replace libfvad with Silero VAD Web for Background Noise Detection

## Goal

Replace the current libfvad/WebRTC VAD backend with a Silero VAD backend for the
background-noise detector.

The public feature remains the same: detect sustained loud non-speech input and
emit `background-noise-detected`.

ADR 0009 records the backend decision: use `@ricky0123/vad-web` as the first
Silero/ONNX Runtime Web integration path.

## Constraints

- Keep this detector independent from the DTLN noise-suppression worklet.
- Expose the detector as a stream-based API; callers provide the `MediaStream`
  to analyze.
- Do not create a dedicated background-noise `AudioWorkletNode`.
- Do not run ONNX Runtime Web inference inside any custom
  `AudioWorkletProcessor.process`.
- Lazy-load Silero assets only when the background-noise detector is used.
- Preserve microphone pass-through behavior.
- Keep demo clip playback available for repeatable tuning.

## Target Architecture

Use a two-part pipeline:

1. Main thread API
   - accepts an `AudioContext`, a `MediaStream`, and detector options
   - initializes `@ricky0123/vad-web`
   - runs the `BackgroundNoiseDetector` aggregation from `onFrameProcessed`
   - exposes a detector handle and event observer API

2. `@ricky0123/vad-web`
   - loads Silero and ONNX Runtime Web assets
   - uses the supplied stream via `getStream`
   - may use its own internal `vad-helper-worklet` to capture and frame audio
   - returns speech probability and framed audio through callbacks

Callers own graph wiring. Microphone streams can be passed directly. Web Audio
sources such as demo clips can be mirrored into a `MediaStreamDestination` and
passed to the detector without creating our own pass-through worklet.

## Step 1: Add the Silero Dependency Experiment

1. Install `@ricky0123/vad-web`.
2. Confirm the exact transitive `onnxruntime-web` version and asset files.
3. Inspect the package exports and determine whether it exposes a lower-level
   API that accepts audio frames directly.
4. Record the package footprint in the implementation notes:
   - JavaScript bundle size
   - ONNX model size
   - ONNX Wasm backend size
5. Add a small local script or browser test page that loads the package without
   a dedicated detector AudioWorklet.

Acceptance checks:

- package installs cleanly
- Vite can resolve the package
- a minimal browser page can initialize the VAD
- Silero assets are not loaded by unrelated entrypoints

## Step 2: Define the Internal VAD Backend Interface

1. Add an internal backend abstraction, for example:
   - `src/background-noise/vad-backend.ts`
2. Model the backend around speech probability, not binary voice activity:
   - `processChunk(audio, sampleRate, timestampMs)`
   - returns `speechProbability`, `startMs`, `durationMs`
3. Keep backend-specific options internal:
   - Silero threshold
   - positive/negative hysteresis
   - model asset path
   - ONNX Runtime asset path
4. Update detector types to distinguish:
   - raw audio level
   - speech probability
   - background-noise window state

Acceptance checks:

- the detector core can be unit-tested with fake probability sequences
- libfvad-specific types do not leak into the public API

## Step 3: Build the Stream VAD Integration

1. Add a public stream entrypoint, for example:
   - `src/background-noise.ts`
2. Initialize `@ricky0123/vad-web` with:
   - the caller-provided `AudioContext`
   - `getStream` returning the caller-provided `MediaStream`
   - package model and ONNX Runtime asset paths
3. Configure Silero model options and speech thresholds.
4. Forward `onFrameProcessed` frames and speech probabilities into
   `BackgroundNoiseDetector`.
5. Keep stream lifecycle ownership with the caller; disposing the detector must
   not stop microphone tracks that the caller provided.

Acceptance checks:

- detector initializes once and exposes a `ready` promise
- detector returns probability-driven background-noise events for sample clips
- initialization errors reject the creation promise
- disposing the detector destroys the `MicVAD` instance without stopping caller
  streams

## Step 4: Remove the Dedicated AudioWorklet Protocol

1. Delete the custom background-noise `AudioWorkletProcessor`.
2. Delete the custom background-noise worklet message protocol.
3. Delete the pass-through node API.
4. Route Web Audio sources that are not already streams through
   `MediaStreamDestination` at the caller/demo layer.
5. Let `@ricky0123/vad-web` handle frame capture internally.

Acceptance checks:

- no custom background-noise worklet bundle is emitted
- no background-noise pass-through processor remains
- no `validateXXX` methods are called inside `processFrame`

## Step 5: Replace Detector Aggregation Logic

1. Change detector input from `isVoice` to `speechProbability`.
2. Keep RMS thresholds:
   - `triggerRms`
   - `noisyRms`
3. Add probability thresholds:
   - `maxSpeechProbability`
   - optional `speechProbabilitySmoothing`
4. Emit an event only when a sustained window is:
   - loud enough
   - mostly low speech probability
   - not inside cooldown
5. Include probability metrics in the event payload:
   - average speech probability
   - max speech probability
   - active frame ratio
   - noisy frame ratio
6. Update tests to cover:
   - loud silence/noise emits
   - speech-like probability suppresses events
   - cooldown suppresses repeated events
   - mixed windows respect thresholds

Acceptance checks:

- pure noise fixture emits a background-noise event
- white-noise fixture emits a background-noise event
- speech fixture does not emit with default thresholds

## Step 6: Update the Public Entrypoint

1. Replace `createBackgroundNoiseDetectorAudioWorklet` with
   `createBackgroundNoiseDetector(context, stream, options)`.
2. Add optional asset path configuration if required:
   - `baseAssetPath`
   - `onnxWasmBasePath`
3. Ensure consumers do not need to import `@ricky0123/vad-web` directly.
4. Keep an observer helper for detector messages.
5. Update message type guards for the new probability fields.
6. Document lazy loading and expected asset footprint.

Acceptance checks:

- TypeScript consumers use the new stream-based API
- package exports remain browser-only
- non-background-noise entrypoints do not bundle Silero assets

## Step 7: Update Vite Packaging

1. Ensure ONNX Wasm/model assets are emitted and addressable in:
   - local Vite dev server
   - package build
   - browser tests
2. Remove the custom background-noise worklet virtual module behavior.
3. Verify the package output includes only the assets needed by this feature.
4. Add README notes for serving the ONNX Wasm/model assets.

Acceptance checks:

- `npm run build` succeeds
- generated package files can initialize the detector in browser tests
- DTLN worklet output is unchanged

## Step 8: Update the Demo Page

1. Replace VAD mode controls with Silero controls:
   - max speech probability
   - smoothing/hysteresis if used
2. Show live probability metrics:
   - current speech probability
   - average probability in current window
   - last event probability summary
3. Keep the source selector:
   - microphone
   - packaged clips
4. Include the existing noise fixtures:
   - `clips/pure-noise.wav`
   - `clips/white-noise-15s.wav`
5. Add a clear loading state while ONNX/Silero assets initialize.

Acceptance checks:

- pure noise clip triggers an event
- white noise clip triggers an event
- speech/noisy speech clips show probability activity
- microphone output remains muted

## Step 9: Add Browser Tests

1. Add fake-backend detector unit tests for probability aggregation.
2. Add worker protocol tests where practical.
3. Add browser tests that initialize the real Silero backend.
4. Run fixtures through the detector:
   - pure noise
   - white noise
   - existing noisy speech clips
5. Assert only high-confidence behavior:
   - noise-only clips emit at least one background-noise event
   - speech clips produce higher speech probability than noise-only clips

Acceptance checks:

- `npm run typecheck`
- `npm run build`
- `npm run test:browser`
- `git diff --check`

## Step 10: Remove or Quarantine libfvad

Status: Completed.

After Silero passes the fixture tests:

1. Remove libfvad from the background-noise hot path.
2. Delete libfvad wrapper tests or replace them with backend-interface tests.
3. Remove `vendor/libfvad` if no fallback is desired.
4. Update ADR 0008 with a short note pointing to ADR 0009.
5. Update the old background-noise plan to say it was superseded.

Acceptance checks:

- no libfvad import remains in background-noise runtime code
- package build no longer emits libfvad Wasm unless explicitly retained
- docs point readers to ADR 0009 for the active backend decision

Implementation result:

- libfvad is absent from the runtime and package build
- the wrapper and its browser tests were deleted
- the complete `vendor/libfvad` tree was deleted
- ADR 0008 is marked as superseded by ADR 0009

## Risks

### Package API Fit

`@ricky0123/vad-web` may be optimized for its own microphone pipeline. If it
does not expose the frame-level API we need, use it as a reference and integrate
Silero ONNX Runtime Web directly behind our backend interface.

### Bundle Size

Silero and ONNX Runtime Web are much heavier than libfvad. The detector must be
lazy-loaded and should not affect the DTLN denoiser or package consumers that do
not opt into background-noise detection.

### Threading

ONNX inference must stay outside any custom AudioWorklet render thread. The
`@ricky0123/vad-web` helper may still use an internal worklet for frame capture,
but the package invokes ONNX Runtime Web from its JavaScript VAD pipeline.

### Browser Compatibility

ONNX Runtime Web has multiple execution backends and Wasm asset requirements.
The implementation should start with the plain Wasm backend and avoid requiring
WebGPU, SharedArrayBuffer, or cross-origin isolation.
