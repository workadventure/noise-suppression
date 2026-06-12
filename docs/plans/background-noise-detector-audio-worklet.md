# Background Noise Detector AudioWorklet Plan

- Status: Draft
- Date: 2026-06-12
- Owner: Codex

## Goal

Add a lightweight background-noise detector that can run when DTLN noise
suppression is disabled.

The detector should listen to microphone audio, detect sustained loud non-speech
input, and emit a typed `background-noise-detected` message so WorkAdventure can
recommend enabling noise suppression.

This feature must not load the existing DTLN AudioWorklet, LiteRT runtime, or
DTLN model assets. ADR 0008 records the VAD backend decision: vendor libfvad
directly and keep the detector backend replaceable behind an internal wrapper.

## Target Architecture

The new detector should be a separate AudioWorklet pipeline:

```text
microphone source
  -> BackgroundNoiseDetectorAudioWorkletNode
  -> destination or muted sink
```

The detector worklet should pass audio through unchanged. Applications can
therefore insert it into an existing graph or connect it to a muted `GainNode`
when they only need analysis.

The new code should not import from:

- `src/audio-worklet-processor.ts`
- `src/runtime.ts`
- `forks/litertjs-core`
- DTLN model files

Expected new source modules:

- `src/background-noise-worklet.ts`
- `src/background-noise-worklet-processor.ts`
- `src/background-noise-worklet-shared.ts`
- `src/background-noise/libfvad.ts`
- `src/background-noise/detector.ts`

Expected new package export:

- `@workadventure/noise-suppression/background-noise-worklet`

## Public API

Add a public browser entrypoint that mirrors the existing noise-suppression
AudioWorklet shape.

```typescript
export interface BackgroundNoiseDetectorAudioWorkletOptions {
  moduleUrl?: string;
  readyTimeoutMs?: number;
  vadMode?: "normal" | "low-bitrate" | "aggressive" | "very-aggressive";
  frameDurationMs?: 10 | 20 | 30;
  triggerRms?: number;
  noisyRms?: number;
  analysisWindowMs?: number;
  maxVoiceFrameRatio?: number;
  cooldownMs?: number;
}

export interface BackgroundNoiseDetectorAudioWorkletHandle {
  node: AudioWorkletNode;
  ready: Promise<BackgroundNoiseDetectorAudioWorkletReadyMessage>;
  moduleUrl: string;
  processorName: string;
  dispose(): void;
}
```

Default options:

- `vadMode`: `"aggressive"`
- `frameDurationMs`: `30`
- `triggerRms`: `0.01`
- `noisyRms`: `0.02`
- `analysisWindowMs`: `1500`
- `maxVoiceFrameRatio`: `0.2`
- `cooldownMs`: `15000`
- `readyTimeoutMs`: `30000`

Outbound messages:

```typescript
export interface BackgroundNoiseDetectorAudioWorkletReadyMessage {
  type: "ready";
  sampleRate: number;
  frameSamples: number;
}

export interface BackgroundNoiseDetectorAudioWorkletErrorMessage {
  type: "error";
  message: string;
  stack?: string;
}

export interface BackgroundNoiseDetectedMessage {
  type: "background-noise-detected";
  rms: number;
  rmsDb: number;
  voiceFrameRatio: number;
  windowMs: number;
}
```

Inbound messages:

```typescript
export interface BackgroundNoiseDetectorDisposeMessage {
  type: "dispose";
}
```

Also expose:

- `observeBackgroundNoiseDetectorAudioWorkletMessages(handle, listener)`
- `isBackgroundNoiseDetectedMessage(message)`

## Implementation Steps

### Step 1: Vendor libfvad

Goal:

- own the VAD artifact and wrapper instead of depending on abandoned npm
  wrappers

Tasks:

1. Add a vendored libfvad directory, for example:
   - `vendor/libfvad/`
2. Include:
   - upstream source snapshot or a clearly identified minimal source subset
   - generated wasm artifact used by the detector
   - upstream license and patent notice if present upstream
   - `README.md` with upstream URL, revision, build command, and update notes
3. Keep the built wasm small and detector-specific:
   - export only allocation/free functions
   - export `fvad_new`
   - export `fvad_free`
   - export `fvad_reset`
   - export `fvad_set_mode`
   - export `fvad_set_sample_rate`
   - export `fvad_process`
4. Add a rebuild script or documented command. Prefer a reproducible Docker or
   Emscripten command so future updates do not depend on a local machine setup.

Exit criterion:

- the repository contains enough source, license, and build metadata to justify
  and recreate the vendored wasm artifact.

### Step 2: Build an internal libfvad TypeScript wrapper

Goal:

- hide the vendored C/WASM API behind a small project-owned interface

Tasks:

1. Add `src/background-noise/libfvad.ts`.
2. Import the vendored wasm bytes using the existing `?bytes` mechanism or an
   equivalent Vite build helper.
3. Instantiate the wasm inside the AudioWorklet module.
4. Implement a `LibFvadVad` wrapper with:
   - constructor for `sampleRate`, `mode`, and `frameDurationMs`
   - `processFrame(frame: Float32Array): boolean`
   - `destroy()`
5. Convert `Float32Array` samples in `[-1, 1]` to signed 16-bit PCM before
   calling `fvad_process`.
6. Allocate the wasm input buffer once per detector instance and reuse it for
   every frame.
7. Reject unsupported sample rates before starting detection. libfvad accepts:
   - `8000`
   - `16000`
   - `32000`
   - `48000`
8. Derive frame sample counts from `sampleRate` and `frameDurationMs`:
   - 10 ms
   - 20 ms
   - 30 ms

Exit criterion:

- a unit-testable wrapper can return `true` for voice frames and `false` for
  non-voice frames without exposing raw wasm details to the worklet processor.

### Step 3: Implement the background-noise detector core

Goal:

- keep detection policy separate from AudioWorklet plumbing

Tasks:

1. Add `src/background-noise/detector.ts`.
2. Define an input frame result:
   - `isVoice`
   - `rms`
   - `rmsDb`
   - `durationMs`
3. Compute RMS over raw float PCM:
   - `sqrt(sum(sample * sample) / frame.length)`
4. Convert RMS to dBFS for diagnostics:
   - `20 * Math.log10(Math.max(rms, Number.MIN_VALUE))`
5. Start a candidate noise window when:
   - `isVoice === false`
   - `rms >= triggerRms`
6. While a candidate window is active, collect:
   - total frames
   - voice frames
   - RMS sum
   - elapsed frame duration
7. Emit one `BackgroundNoiseDetectedMessage` when:
   - elapsed duration is at least `analysisWindowMs`
   - average RMS is at least `noisyRms`
   - `voiceFrames / totalFrames <= maxVoiceFrameRatio`
8. Reset the candidate window after evaluation.
9. Apply `cooldownMs` after each emitted event.
10. Reset state on dispose and after long no-input gaps if that becomes
    observable in the worklet.

Exit criterion:

- the detector core can be tested with synthetic frame sequences without an
  AudioContext.

### Step 4: Add the AudioWorklet processor

Goal:

- run libfvad and the detector core in `AudioWorkletGlobalScope`

Tasks:

1. Add `src/background-noise-worklet-processor.ts`.
2. Register a new processor name:
   - `workadventure-background-noise-detector`
3. Accept `BackgroundNoiseDetectorAudioWorkletProcessorOptions` through
   `processorOptions`.
4. Initialize libfvad asynchronously in the constructor and post:
   - `ready` on success
   - `error` on failure
5. In `process(...)`:
   - copy input to output unchanged
   - return silence only when there is no input channel
   - keep returning `true` after errors so graph behavior remains stable
6. Buffer render quanta into full VAD frames.
7. Process as many complete frames as available in each callback.
8. Post `background-noise-detected` when the detector core emits an event.
9. On `dispose`:
   - destroy the VAD instance
   - clear buffers
   - stop posting events
10. Keep allocations out of the hot callback where practical:
    - reuse ring buffers
    - reuse frame arrays
    - reuse `Int16Array` conversion buffers in the libfvad wrapper

Exit criterion:

- a connected AudioWorklet can initialize, pass audio through, and emit detector
  messages without importing any DTLN or LiteRT code.

### Step 5: Add the browser entrypoint

Goal:

- expose a stable API for applications

Tasks:

1. Add `src/background-noise-worklet-shared.ts` for message and option types.
2. Add `src/background-noise-worklet.ts` with:
   - `createBackgroundNoiseDetectorAudioWorklet(...)`
   - `observeBackgroundNoiseDetectorAudioWorkletMessages(...)`
   - `isBackgroundNoiseDetectedMessage(...)`
3. Match the existing worklet module-load cache pattern from
   `src/audio-worklet.ts`.
4. Use a separate virtual module URL, not the DTLN worklet URL.
5. Add a `ready` promise that resolves on `ready` and rejects on `error`,
   `processorerror`, or timeout.
6. Add `dispose()` that posts `{ type: "dispose" }` and disconnects the node.

Exit criterion:

- consumers can import the detector without importing the DTLN worklet
  entrypoint.

### Step 6: Update package exports and Vite packaging

Goal:

- bundle the detector worklet independently in development and production

Tasks:

1. Add a package export:
   - `./background-noise-worklet`
2. Add the entry to Vite library build config.
3. Add a new virtual module for the detector worklet URL.
4. Add a new production worklet asset, for example:
   - `assets/background-noise-worklet-processor.js`
5. Add a new dev-server path, for example:
   - `/__background_noise_detector_audio_worklet_processor.js`
6. Generalize or duplicate the existing `audioWorkletBundlePlugin()` so it can
   build both processor bundles without cross-importing them.
7. Ensure the detector processor bundle includes only:
   - detector worklet code
   - libfvad wrapper
   - libfvad wasm bytes
8. Update `src/vite.ts` so consuming Vite dev servers can serve the detector
   worklet asset in the same way they currently serve the DTLN worklet asset.
9. Keep DTLN default assets isolated from the detector export.

Exit criterion:

- `npm run build` emits a separate detector worklet asset and importing
  `background-noise-worklet` does not emit or reference DTLN model assets.

### Step 7: Add a demo page

Goal:

- make manual tuning possible before WorkAdventure integration

Tasks:

1. Add a small demo entry under `demo/`.
2. Add an HTML page, for example:
   - `background-noise-worklet.html`
3. The demo should:
   - request microphone permission
   - create an `AudioContext`
   - create the detector worklet
   - connect the detector to a muted gain node or destination
   - display readiness, RMS, voice ratio, and event count
4. Add controls for tuning:
   - `vadMode`
   - `triggerRms`
   - `noisyRms`
   - `analysisWindowMs`
   - `maxVoiceFrameRatio`
   - `cooldownMs`

Exit criterion:

- a developer can test fan noise, keyboard noise, speech, and silence in a
  browser without modifying WorkAdventure.

### Step 8: Add automated tests

Goal:

- protect the detector behavior and bundling boundaries

Tasks:

1. Add detector-core tests for:
   - silence does not emit
   - sustained loud non-voice emits
   - voice-heavy windows do not emit
   - cooldown suppresses repeated events
   - window state resets after evaluation
2. Add libfvad wrapper tests if browser test setup can instantiate the wasm
   reliably.
3. Add browser AudioWorklet tests for:
   - worklet initializes
   - ready message is received
   - pass-through output remains finite
   - synthetic loud non-voice input emits an event
4. Add a build-output assertion or manual check that the detector import path
   does not include DTLN `.tflite` assets.

Exit criterion:

- the detector has both policy-level tests and at least one browser worklet
  initialization test.

### Step 9: Tune defaults

Goal:

- avoid noisy notifications in WorkAdventure

Tasks:

1. Start with conservative defaults from the public API section.
2. Use the demo to test:
   - silence
   - normal speech
   - laptop fan
   - keyboard noise
   - music
   - vacuum or loud external noise
3. Prefer false negatives over false positives for v1.
4. Keep thresholds configurable so WorkAdventure can tune without republishing
   the detector package.
5. Record final default rationale in the README or a follow-up ADR if the
   thresholds become product-significant.

Exit criterion:

- defaults are conservative enough for startup use and tunable by consumers.

### Step 10: Document consumer usage

Goal:

- make WorkAdventure integration clear

Tasks:

1. Update `README.md` with a short section:
   - when to use the background-noise detector
   - how it differs from DTLN noise suppression
   - sample code
2. Document that the detector should run when noise suppression is disabled.
3. Document that it emits recommendations only; it does not clean audio.
4. Document browser sample-rate requirements:
   - supported rates are `8000`, `16000`, `32000`, and `48000`
   - use `new AudioContext({ sampleRate: 16000 })` if the application wants a
     predictable supported rate
5. Document `dispose()` and cleanup expectations.

Exit criterion:

- a consumer can integrate the detector without reading the source.

## Validation Checklist

Run these before considering the feature complete:

1. `npm run typecheck`
2. `npm run build`
3. `npm run test:browser`
4. Manual demo test in Chrome with:
   - silence
   - speech
   - sustained non-speech noise
5. Inspect production build output to confirm:
   - detector worklet asset is separate
   - DTLN `.tflite` assets are not referenced by the detector entrypoint
   - LiteRT assets are not referenced by the detector entrypoint

## Risks

### libfvad accuracy

libfvad/WebRTC VAD is lightweight but less accurate than Silero in difficult
noise conditions. The detector should use conservative thresholds and expose
configuration knobs.

### Binary VAD output

libfvad returns a binary decision, not a probability. The detector should not
report confidence. Use `voiceFrameRatio` over a time window instead.

### Sample-rate support

AudioContext sample rates outside `8000`, `16000`, `32000`, or `48000` are not
supported by libfvad. The worklet should fail clearly rather than silently
misclassify audio.

### Worklet asset isolation

The detector only satisfies the startup-footprint goal if its entrypoint and
worklet bundle stay isolated from DTLN imports. This should be checked during
build validation.

## Acceptance Criteria

The feature is ready when:

- `@workadventure/noise-suppression/background-noise-worklet` is exported
- the detector worklet initializes without loading DTLN, LiteRT, or model
  assets
- sustained loud non-speech audio emits `background-noise-detected`
- normal speech does not usually emit `background-noise-detected`
- the detector can be disposed cleanly
- README usage docs and browser tests are in place
