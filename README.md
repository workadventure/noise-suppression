# @workadventure/noise-suppression

Browser-side noise suppression for realtime voice applications.

This package runs the DTLN speech denoising models in the browser with
LiteRT.js. Its primary integration path is an `AudioWorklet` that can sit
between a microphone track and a WebRTC peer connection.

Use it when you want to:

- clean microphone audio before sending it to a WebRTC call
- keep processing local to the browser

The package makes it as easy as possible to embed noise suppression by
pre-bundling all the required assets in one AudioWorklet.

The package is browser-only. It does not ship a native addon, Rust runtime, or
Node backend. If you are looking for server-side variants, take a look at
[hayatialikeles/dtln-rs](https://github.com/hayatialikeles/dtln-rs), which
this package was originally forked from.

## Installation

```bash
npm install @workadventure/noise-suppression
```

## Add Noise Suppression To A WebRTC Track

The most common WebRTC integration is:

1. capture the microphone with `getUserMedia`
2. route it through the noise suppression `AudioWorklet`
3. create a new processed `MediaStreamTrack`
4. pass that processed track to your `RTCPeerConnection`

```ts
import {
  createNoiseSuppressionAudioWorklet,
} from "@workadventure/noise-suppression/audio-worklet";

const microphoneStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
  },
});

const context = new AudioContext({ sampleRate: 16000 });
await context.resume();

const source = context.createMediaStreamSource(microphoneStream);
const destination = context.createMediaStreamDestination();

const worklet = await createNoiseSuppressionAudioWorklet(context, {
  bypassUntilReady: true,
});

source.connect(worklet.node).connect(destination);
await worklet.ready;

const [processedTrack] = destination.stream.getAudioTracks();

if (!processedTrack) {
  throw new Error("Noise suppression did not create an audio track.");
}

peerConnection.addTrack(processedTrack, destination.stream);

// When the call ends or when you switch back to the raw microphone:
// worklet.dispose();
// source.disconnect();
// microphoneStream.getTracks().forEach((track) => track.stop());
// destination.stream.getTracks().forEach((track) => track.stop());
// await context.close();
```

For an existing call, replace the current microphone track instead:

```ts
const sender = peerConnection
  .getSenders()
  .find((candidate) => candidate.track?.kind === "audio");

if (!sender) {
  throw new Error("No audio sender found.");
}

await sender.replaceTrack(processedTrack);
```

## AudioWorklet API

```ts
import {
  createNoiseSuppressionAudioWorklet,
  observeNoiseSuppressionAudioWorkletMessages,
  isNoiseSuppressionProcessingStartedMessage,
} from "@workadventure/noise-suppression/audio-worklet";

const context = new AudioContext({ sampleRate: 16000 });
const worklet = await createNoiseSuppressionAudioWorklet(context);

const stopObserving = observeNoiseSuppressionAudioWorkletMessages(
  worklet,
  (message) => {
    if (isNoiseSuppressionProcessingStartedMessage(message)) {
      console.log("Noise suppression started.");
    }
  }
);

await worklet.ready;
sourceNode.connect(worklet.node).connect(destinationNode);

// Later:
stopObserving();
worklet.dispose();
```

`createNoiseSuppressionAudioWorklet(context, options?)` returns:

- `node`: the `AudioWorkletNode` to insert in your Web Audio graph
- `ready`: resolves after LiteRT.js and the DTLN models are initialized
- `moduleUrl`: the processor module URL that was loaded
- `processorName`: the registered processor name
- `dispose()`: disconnects the node and stops the denoiser instance

Options:

```ts
interface NoiseSuppressionAudioWorkletOptions {
  moduleUrl?: string;
  threads?: boolean;
  numThreads?: number;
  bypassUntilReady?: boolean;
  readyTimeoutMs?: number;
}
```

Defaults:

- `moduleUrl`: the bundled worklet processor from this package
- `threads`: `false`
- `numThreads`: based on browser CPU count when available
- `bypassUntilReady`: `true`
- `readyTimeoutMs`: `30000`

With `bypassUntilReady: true`, microphone audio passes through while the worklet
initializes. With `false`, the worklet outputs silence until the denoiser is
ready.

The bundled worklet path currently targets single-threaded LiteRT execution.
Keep `threads` unset or `false` unless you are testing a custom worklet bundle
that supports threaded Wasm loading.

## Runtime Requirements

- Use an `AudioContext` at `16000` Hz for DTLN processing.
- Use one input and one output channel.
- Create or resume the `AudioContext` after a user gesture when the browser
  requires it.
- For microphone capture, disable the browser's built-in `noiseSuppression` if
  you want this package to be the only denoiser in the chain.
- The default worklet bundle includes the LiteRT Wasm bytes and the two DTLN
  model files, so the worklet path does not need the application to host those
  files separately.

The processor buffers four 128-sample render quanta into one 512-sample DTLN
frame, then writes the denoised samples back to an output ring buffer.

## Bundlers

The package is ESM-only and is intended for browser bundlers.

```ts
import { createNoiseSuppressionAudioWorklet } from "@workadventure/noise-suppression/audio-worklet";
```

In the normal worklet path, consumers should not need to configure model URLs,
Wasm URLs, or worklet processor URLs. The distributed `audio-worklet` entrypoint
loads the packaged processor bundle.

If your application serves assets from a constrained location, you can override
the worklet processor URL:

```ts
const worklet = await createNoiseSuppressionAudioWorklet(context, {
  moduleUrl: "/assets/noise-suppression/audio-worklet-processor.js",
});
```

### Vite Dev Server

Vite can transform JavaScript loaded through `audioWorklet.addModule()` in dev
mode. The transformed module may import Vite's client runtime, which is not
available inside an `AudioWorkletGlobalScope`.

Add the package Vite plugin:

```ts
// vite.config.ts
import { noiseSuppressionAudioWorkletVitePlugin } from "@workadventure/noise-suppression/vite";

export default defineConfig({
  plugins: [noiseSuppressionAudioWorkletVitePlugin()],
});
```

The plugin serves the packaged worklet processor as raw JavaScript in dev and
rewrites the package's default AudioWorklet URL to that raw endpoint. Application
code can keep calling `createNoiseSuppressionAudioWorklet()` without a
dev-specific `moduleUrl` override.

## Detect Sustained Background Noise

The background-noise detector identifies sustained input that is loud but
unlikely to contain speech. It can be used to suggest enabling noise suppression
when a user has a noisy microphone.

The detector uses Silero VAD through `@ricky0123/vad-web`. It analyzes a supplied
`MediaStream` but does not modify the stream, play it, or enable DTLN noise
suppression.

```ts
import {
  createBackgroundNoiseDetector,
  isBackgroundNoiseDetectedMessage,
  observeBackgroundNoiseDetectorMessages,
} from "@workadventure/noise-suppression/background-noise";

const microphoneStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
  },
});

const context = new AudioContext({ sampleRate: 16000 });
await context.resume();

const detector = await createBackgroundNoiseDetector(
  context,
  microphoneStream
);

const stopObserving = observeBackgroundNoiseDetectorMessages(
  detector,
  (message) => {
    if (isBackgroundNoiseDetectedMessage(message)) {
      console.log("Sustained background noise detected", message);
      // Offer to enable noise suppression here.
    }
  }
);

await detector.ready;

// Later:
stopObserving();
detector.dispose();
microphoneStream.getTracks().forEach((track) => track.stop());
await context.close();
```

`createBackgroundNoiseDetector(context, stream, options?)` returns a promise for
a detector handle:

- `ready`: resolves with the Silero model, sample rate, frame size, and frame
  duration
- `dispose()`: stops VAD processing and releases its internal resources

The creation promise rejects if the Silero model, helper worklet, or ONNX Runtime
cannot be initialized.

The caller retains ownership of the supplied stream. Calling `dispose()` does
not stop its tracks or close the `AudioContext`.

### Detection Rules

The detector starts a candidate window when a frame exceeds `triggerRms` and is
not classified as speech. It emits `background-noise-detected` only when the
complete window remains loud enough and stays below both configured speech
limits.

Detector options and defaults:

| Option | Default | Meaning |
| --- | ---: | --- |
| `triggerRms` | `0.01` | Minimum frame RMS needed to start a candidate window |
| `noisyRms` | `0.02` | Minimum average RMS required to emit an event |
| `analysisWindowMs` | `1500` | Sustained-noise window duration |
| `speechProbabilityThreshold` | `0.3` | Probability at which a frame counts as speech |
| `maxSpeechFrameRatio` | `0.75` | Maximum ratio of speech frames in the window |
| `maxAverageSpeechProbability` | `0.5` | Maximum average speech probability in the window |
| `cooldownMs` | `15000` | Minimum delay between emitted events |
| `sileroModel` | `"v5"` | Silero model; `"legacy"` is also available |
| `processorType` | `"AudioWorklet"` | Frame-capture mechanism used internally by `vad-web` |

The Silero integration also forwards `positiveSpeechThreshold`,
`negativeSpeechThreshold`, `redemptionMs`, `preSpeechPadMs`, and `minSpeechMs`
to `@ricky0123/vad-web`. In most integrations, tune the detector-level rules
first and leave these VAD-specific options unchanged.

A `background-noise-detected` message contains:

```ts
interface BackgroundNoiseDetectedMessage {
  type: "background-noise-detected";
  rms: number;
  rmsDb: number;
  speechFrameRatio: number;
  voiceFrameRatio: number;
  averageSpeechProbability: number;
  maxSpeechProbability: number;
  activeFrameRatio: number;
  windowMs: number;
  timestampMs: number;
}
```

`voiceFrameRatio` is currently an alias of `speechFrameRatio`.

### Analyze Another Audio Source

The detector accepts any `MediaStream`, not only a microphone stream. To analyze
an existing Web Audio graph, mirror its source into a
`MediaStreamAudioDestinationNode`:

```ts
const detectorInput = context.createMediaStreamDestination();
sourceNode.connect(detectorInput);

const detector = await createBackgroundNoiseDetector(
  context,
  detectorInput.stream
);
```

Connecting a node to `detectorInput` does not play it through the speakers. Add a
separate connection to `context.destination` only when playback is intended.

### Silero And ONNX Assets

The background-noise detector is a separate package entrypoint. Applications
that only import the noise-suppression APIs do not initialize Silero or ONNX
Runtime Web.

The package includes the Silero model, the VAD helper worklet, and ONNX Runtime
Web assets under `dist/vendor/`. Their default URLs are resolved relative to the
`background-noise.js` module. A deployment must preserve those files and serve
`.js`, `.mjs`, `.wasm`, and `.onnx` files with appropriate MIME types and CORS
headers.

For deployments that copy these assets elsewhere, override both base paths:

```ts
const detector = await createBackgroundNoiseDetector(context, stream, {
  baseAssetPath: "/assets/noise-detector/silero/",
  onnxWASMBasePath: "/assets/noise-detector/onnxruntime/",
});
```

The package does not expose a dedicated background-noise `AudioWorkletNode`.
With the default `processorType`, `@ricky0123/vad-web` still uses its own small
helper worklet for audio capture and framing; Silero inference runs outside the
audio render callback.

## Advanced: Synchronous Frame API

The package also exposes the lower-level runtime API. This is useful for tests,
benchmarks, offline processing, or custom pipelines where you already manage
512-sample mono frames.

```ts
import createNoiseSuppressionModule from "@workadventure/noise-suppression";

const noiseSuppression = await createNoiseSuppressionModule();
await noiseSuppression.ready;

const handle = noiseSuppression.dtln_create();
const input = new Float32Array(512);
const output = new Float32Array(512);

noiseSuppression.dtln_denoise(handle, input, output);
noiseSuppression.dtln_stop(handle);
```

Audio contract:

- sample rate: `16000`
- channels: `1`
- frame size: `512`
- frame duration: `32 ms`
- sample format: `Float32Array`

`dtln_denoise` accepts input lengths that are multiples of `128`, but the
realtime target is the standard 512-sample frame.

Frame API options:

```ts
interface NoiseSuppressionModuleOptions {
  liteRtWasmRoot?: string;
  model1Url?: string;
  model2Url?: string;
  threads?: boolean;
  numThreads?: number;
  logModelDetails?: boolean;
  enableProfiling?: boolean;
}
```

The frame API uses packaged LiteRT.js Wasm and model assets by default. It
enables LiteRT.js threads automatically when `crossOriginIsolated === true`,
unless you pass `threads: false`.

## Local Development

```bash
npm install
npm run dev
```

Useful local pages:

- `/`: landing page linking to all local test pages
- `/runtime.html`: runtime initialization and single-frame smoke test
- `/listen-test.html`: microphone, sample clip, or local file playback with a
  worklet/bypass switch
- `/audio-worklet.html`: minimal AudioWorklet initialization demo
- `/background-noise.html`: microphone or sample clip background-noise
  detector tuning demo
- `/audio-worklet-validation.html`: validation page for the worklet runtime
- `/audio-worklet-benchmark.html`: real-time AudioWorklet benchmark
- `/browser-benchmark-litert.html`: LiteRT benchmark page
- `/browser-benchmark-compare.html`: single-threaded vs threaded comparison
- `/browser-benchmark-litert-manual.html`: DevTools benchmark helper harness

The Vite dev server is configured with COOP and COEP headers so
cross-origin-isolated runtime experiments are possible during local development.

The same pages are deployed from `main` to
[GitHub Pages](https://workadventure.github.io/noise-suppression/). GitHub Pages
does not provide the COOP and COEP headers required by threaded LiteRT, so the
hosted runtime comparison is limited to the single-threaded path.

## Build And Test

```bash
npm run typecheck
npm run build
npm run build:pages
npm run test:browser
```

The Pages build writes the compiled multi-page test site to `pages-dist/`.

The library build writes:

- `dist/index.js`
- `dist/index.d.ts`
- `dist/audio-worklet.js`
- `dist/audio-worklet.d.ts`
- `dist/background-noise.js`
- `dist/background-noise.d.ts`
- `dist/assets/audio-worklet-processor.js`
- `dist/assets/*.tflite`
- `dist/vendor/litert/*`
- `dist/vendor/silero/*`
- `dist/vendor/onnxruntime/*`

## Architecture Notes

- The worklet path uses the repository-local [LiteRT ESM fork](https://github.com/moufmouf/LiteRT/tree/esm-module) and passes bundled
  Wasm bytes to the Emscripten module factory.
- The bundled worklet path currently runs LiteRT single-threaded.
- The lower-level frame API currently depends on LiteRT.js internal synchronous
  runner APIs to keep `dtln_denoise()` synchronous.
- Threaded LiteRT experiments require cross-origin isolation in production.
- The background-noise detector uses Silero VAD and is independent from the DTLN
  denoiser.

See [Architecture Decision Records](./docs/adr/README.md) for more background.
