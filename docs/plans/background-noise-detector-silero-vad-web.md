# Plan: Replace libfvad with Silero VAD Web for Background Noise Detection

## Goal

Replace the current libfvad/WebRTC VAD backend with a Silero VAD backend for the
background-noise detector AudioWorklet.

The public feature remains the same: detect sustained loud non-speech input and
emit `background-noise-detected`.

ADR 0009 records the backend decision: use `@ricky0123/vad-web` as the first
Silero/ONNX Runtime Web integration path.

## Constraints

- Keep this detector independent from the DTLN noise-suppression worklet.
- Keep the public background-noise detector entrypoint stable where possible.
- Do not run ONNX Runtime Web inference directly in `AudioWorkletProcessor.process`.
- Keep the AudioWorklet render path allocation-light.
- Lazy-load Silero assets only when the background-noise detector is used.
- Preserve microphone pass-through behavior.
- Keep demo clip playback available for repeatable tuning.

## Target Architecture

Use a three-part pipeline:

1. Main thread API
   - creates the `AudioWorkletNode`
   - creates a dedicated VAD Worker
   - wires messages between the worklet, worker, and consumer
   - exposes the existing detector handle and event observer API

2. AudioWorkletProcessor
   - receives microphone or clip audio
   - copies input to output
   - computes cheap per-frame metrics such as RMS
   - buffers/resamples audio into Silero-sized chunks if needed
   - posts framed audio chunks to the main thread
   - receives speech-probability decisions from the main thread
   - runs window aggregation and emits `background-noise-detected`

3. VAD Worker
   - loads `@ricky0123/vad-web` or the package's lower-level Silero utilities
   - initializes ONNX Runtime Web assets
   - accepts mono `Float32Array` audio chunks
   - returns speech probability and chunk timing metadata

If `@ricky0123/vad-web` is too tightly coupled to its own microphone pipeline,
adapt or vendor the minimal lower-level Silero model code instead of forcing the
whole `MicVAD` abstraction into this worklet.

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
   the existing AudioWorklet.

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

## Step 3: Build the VAD Worker

1. Add a dedicated worker entrypoint, for example:
   - `src/background-noise-vad-worker.ts`
2. Implement a strict worker message protocol:
   - `init`
   - `ready`
   - `process-chunk`
   - `speech-probability`
   - `error`
   - `dispose`
3. Transfer audio buffers instead of cloning where possible.
4. Load `@ricky0123/vad-web` lazily inside the worker.
5. Configure ONNX Runtime Web asset paths so Vite packaging works both in dev
   and package builds.
6. Add a request id or chunk sequence id so delayed worker responses can be
   matched to the right audio window.

Acceptance checks:

- worker initializes once and reports `ready`
- worker returns probability results for sample clips
- worker errors are propagated to the public handle
- disposing the detector terminates the worker

## Step 4: Update the AudioWorklet Message Protocol

1. Keep audio pass-through in the processor.
2. Replace libfvad frame processing with chunk capture for Silero.
3. Add processor-to-main messages:
   - `vad-chunk`
   - `background-noise-detected`
   - `ready`
   - `error`
4. Add main-to-processor messages:
   - `speech-probability`
   - `set-options`
   - `dispose`
5. Avoid per-render-quantum allocations in `process`.
6. Reuse ring buffers for chunk assembly.
7. Keep `process` independent from async initialization failures.

Acceptance checks:

- no ONNX or package logic is imported by the processor bundle
- worklet continues passing audio while VAD is initializing
- no `validateXXX` methods are called inside `processFrame` or `process`

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

1. Keep `createBackgroundNoiseDetectorAudioWorklet` as the main API.
2. Add optional asset path configuration if required:
   - `vadAssetBasePath`
   - `onnxWasmBasePath`
3. Ensure consumers do not need to import `@ricky0123/vad-web` directly.
4. Keep `observeBackgroundNoiseDetectorAudioWorkletMessages`.
5. Update message type guards for the new probability fields.
6. Document lazy loading and expected asset footprint.

Acceptance checks:

- existing TypeScript consumers still compile, except for intentional option
  additions
- package exports remain browser-only
- non-background-noise entrypoints do not bundle Silero assets

## Step 7: Update Vite Packaging

1. Add a worker build path for the VAD Worker.
2. Ensure ONNX Wasm/model assets are emitted and addressable in:
   - local Vite dev server
   - package build
   - browser tests
3. Keep the existing virtual worklet module behavior.
4. Verify the package output includes only the assets needed by this feature.
5. Add README notes for serving the ONNX Wasm/model assets.

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

ONNX inference must stay off the AudioWorklet render thread. Worker latency is
acceptable because this feature emits advisory background-noise events over
sustained windows.

### Browser Compatibility

ONNX Runtime Web has multiple execution backends and Wasm asset requirements.
The implementation should start with the plain Wasm backend and avoid requiring
WebGPU, SharedArrayBuffer, or cross-origin isolation.
