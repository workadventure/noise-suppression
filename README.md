# @workadventure/noise-suppression

[![npm version](https://img.shields.io/npm/v/@workadventure/noise-suppression)](https://www.npmjs.com/package/@workadventure/noise-suppression)
[![CI](https://github.com/workadventure/noise-suppression/actions/workflows/ci.yml/badge.svg)](https://github.com/workadventure/noise-suppression/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/@workadventure/noise-suppression)](https://www.npmjs.com/package/@workadventure/noise-suppression)
[![License](https://img.shields.io/github/license/workadventure/noise-suppression)](./LICENSE)
[![Test site](https://img.shields.io/badge/test_site-live-0f766e)](https://workadventure.github.io/noise-suppression/)

Browser-side noise suppression and noise-detection for realtime voice applications.

#### 👉 [Try noise suppression and noise detection in your browser](https://workadventure.github.io/noise-suppression/) 👈

This package provides two complementary tools for handling noisy microphone
input directly in the browser:

- **Noise suppression**, with a choice of two models:
  [DeepFilterNet3](#deepfilternet3) (48 kHz, recommended) and [DTLN](#dtln)
  (16 kHz). Each runs in an `AudioWorklet`
  node that sits between a microphone track and a WebRTC peer connection. See
  [Choose a model](#choose-a-model).
- **[Background noise detection](#detect-sustained-background-noise)** identifies
  sustained noise that is unlikely to contain speech, so an application can
  warn the user or suggest enabling noise suppression.

Use it when you want to:

- clean microphone audio before sending it to a WebRTC call
- detect when a user's microphone is picking up sustained background noise
- keep processing local to the browser

The package pre-bundles the assets required by both features and exposes
high-level browser APIs for adding them to an application.

The package is browser-only. It does not ship a native addon, Rust runtime, or
Node backend. If you are looking for server-side variants, take a look at
[hayatialikeles/dtln-rs](https://github.com/hayatialikeles/dtln-rs), which
this package was originally forked from.

## Installation

```bash
npm install @workadventure/noise-suppression
```

## Choose A Model

| | DeepFilterNet3 | DTLN |
| --- | --- | --- |
| Status | **recommended** | fallback |
| Entry point | `/deepfilternet` | `/audio-worklet` |
| `AudioContext` rate | 48 kHz | 16 kHz |
| Voice band kept | up to 24 kHz | up to 8 kHz |
| PESQ-WB / DNSMOS OVRL | 2.97 / 3.20 | 2.31 / 3.02 |
| Keystrokes removed (steady typing) | 45 dB (7.7 dB in the first 0.5 s) | 9 dB (2.7 dB in the first 0.5 s) |
| Delay added | 71 ms (51 ms with `pauseGateLookaheadFrames: 1`) | 48 ms |
| Model CPU on an Apple M4 | 2.7 % of a core | 1.9 % |
| Download | about 11 MB | about 6 MB |

PESQ-WB estimates wideband speech quality and DNSMOS OVRL the overall quality a
listener perceives; higher is better for both. The model CPU covers the model
only, not the worklet's buffering and pause gate.

- **DeepFilterNet3** is the default choice: it keeps the whole voice band and
  scores above DTLN on the reported perceptual measures, with a higher PESQ-WB on
  49 of 50 test clips, for a little more CPU.
- **DTLN** is the lightest and the smallest download. It sends nothing above
  8 kHz, so voices sound muffled, and it barely removes keystrokes. Use it as the
  fallback where DeepFilterNet3 cannot keep up (see `onOverload`).

DeepFilterNet3's low-latency model (DeepFilterNet3_ll) was evaluated and not
kept: same quality, three times the CPU and a 35 MB model. The same 20 ms
latency reduction is available with `pauseGateLookaheadFrames: 1`.

Numbers from the [engine benchmark](./docs/experiments/engine-benchmark/README.md).
Speed depends on the machine: run
[the benchmark page](https://workadventure.github.io/noise-suppression/engine-benchmark.html)
on the devices you target.

## Add Noise Suppression To A WebRTC Track

The most common WebRTC integration is:

1. capture the microphone with `getUserMedia`
2. route it through the noise suppression `AudioWorklet`
3. create a new processed `MediaStreamTrack`
4. pass that processed track to your `RTCPeerConnection`

```ts
import {
  createDeepFilterNetAudioWorklet,
  DEEPFILTERNET_SAMPLE_RATE,
} from "@workadventure/noise-suppression/deepfilternet";

const microphoneStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
  },
});

const context = new AudioContext({ sampleRate: DEEPFILTERNET_SAMPLE_RATE }); // 48000
await context.resume();

const source = context.createMediaStreamSource(microphoneStream);
const destination = context.createMediaStreamDestination();

const worklet = await createDeepFilterNetAudioWorklet(context);

source.connect(worklet.node).connect(destination);
await worklet.ready;

const [processedTrack] = destination.stream.getAudioTracks();

if (!processedTrack) {
  throw new Error("Noise suppression did not create an audio track.");
}

peerConnection.addTrack(processedTrack, destination.stream);

// When the call ends:
// worklet.dispose();
// source.disconnect();
// microphoneStream.getTracks().forEach((track) => track.stop());
// destination.stream.getTracks().forEach((track) => track.stop());
// await context.close();
```

With DTLN, import `createNoiseSuppressionAudioWorklet` from
`@workadventure/noise-suppression/audio-worklet` instead, and run the
`AudioContext` at `16000` Hz. Everything else is the same.

Turn the browser's own `noiseSuppression` off, as above, so that the package's
model is the only denoiser in the chain. Load the model only when the user turns
noise suppression on: creating the node downloads it.

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

To switch back to the raw microphone during a call, first
`await sender.replaceTrack(microphoneStream.getAudioTracks()[0]!)`, then dispose
the worklet and stop the processed tracks. Keep the microphone tracks running.

## DeepFilterNet3

[DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet) runs libDF, its
Rust implementation, compiled to Wasm by `scripts/build-deepfilternet-wasm.sh`
(see `forks/deepfilternet/`), in its own `AudioWorklet` processor.

`createDeepFilterNetAudioWorklet(context, options?)` returns:

- `node`: the `AudioWorkletNode` to insert in your Web Audio graph
- `ready`: resolves once the Wasm and the model are loaded, with the frame size
- `dispose()`: disconnects the node and stops processing. The model's Wasm
  memory is released when the `AudioContext` is closed: close it when you are
  done, rather than creating nodes again and again in the same context

It throws if the `AudioContext` does not run at 48 kHz.

Options, all optional:

| Option | Default | Meaning |
| --- | ---: | --- |
| `speechAttenuationDb` | `25` | Most the model may attenuate while someone speaks. Unlimited (`100`) gates the background to silence between words, which listeners hear as dropouts and a metallic background |
| `pauseAttenuationDb` | `45` | Attenuation reached in pauses, through a gate after the model. Set it to `speechAttenuationDb` or lower to disable the gate and its delay |
| `pauseGateLookaheadFrames` | `3` | Frames (10 ms each) the gate delays the output by, so it is open when a word starts. The gate ramps open over them. `1` cuts 20 ms of delay: the gate then ramps open over one 10 ms frame instead of three. Keep it above `minSpeechFrames` |
| `minSpeechFrames` | `1` | Consecutive speech frames the gate needs before opening. `2` keeps brief keystrokes the model lets through from opening it |
| `postGain` | `false` | Level the voice after the model (`true` or `Partial<PostGainOptions>`, defaults in `DEFAULT_POST_GAIN`). Meant to replace the browser's automatic gain control, which runs before the model and raises the noise too: set `autoGainControl: false` on the microphone when enabling it |
| `maxLoad` | `0.7` | Share of real time the model may use before `onOverload` fires; `0` disables the check |
| `onOverload` | | Called once, with the load, when two 2 s windows in a row exceed `maxLoad`. The node keeps running: switch to DTLN or to the raw microphone |
| `onLoadReport` | | `(report: LoadReport) => void`, called once for telemetry with `windows`, `medianLoad`, `p95Load`, `maxLoad` (share of real time per 2 s window), `slowFrames` (frames measured at 3 ms or more) and `frames` |
| `loadReportAfterMs` | `60000` | Processed audio before that report, rounded to 2 s windows (at least one). `0` disables it |
| `bypassUntilReady` | `true` | Pass the microphone through while the processor initializes and after it fails; otherwise silence |
| `readyTimeoutMs` | `30000` | Time `ready` waits, from the node's creation, before rejecting |
| `moduleUrl`, `wasmUrl`, `modelUrl` | packaged | Override the processor, Wasm or model URL |

The Wasm and the model are downloaded and compiled before the function returns
the node, so neither `bypassUntilReady` nor `readyTimeoutMs` covers that step, and
a download failure rejects the returned promise. Keep the current microphone route
until the node is created.

The gate detects speech from the denoised level and from how much the model
removed, so keystrokes alone do not open it. Its lookahead keeps the start of
words, but a word that starts during a keystroke can lose about 30 ms of its
attack. The whole chain adds 71 ms: 30 ms for the model, 10.7 ms to
reframe 128-sample quanta into 480-sample frames, and 30 ms of gate lookahead
(51 ms with `pauseGateLookaheadFrames: 1`, 41 ms without the gate). See
[ADR 0011](./docs/adr/0011-add-deepfilternet3-engine-with-pause-gate.md) and
[ADR 0012](./docs/adr/0012-deepfilternet3-overload-report-and-optional-post-processing.md).

Serve `DeepFilterNet3_onnx.tar.gz` as is. If the server adds
`Content-Encoding: gzip`, the browser inflates it; the package gzips it again,
at some CPU cost.

## DTLN

DTLN runs two small LiteRT.js models at 16 kHz.

```ts
import {
  createNoiseSuppressionAudioWorklet,
  observeNoiseSuppressionAudioWorkletMessages,
  isNoiseSuppressionProcessingStartedMessage,
} from "@workadventure/noise-suppression/audio-worklet";

// microphoneStream: the stream captured with getUserMedia, as above
const context = new AudioContext({ sampleRate: 16000 });
await context.resume();
const sourceNode = context.createMediaStreamSource(microphoneStream);
const destinationNode = context.createMediaStreamDestination();
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

### Requirements

- Use an `AudioContext` at `16000` Hz.
- Use one input and one output channel.
- Create or resume the `AudioContext` after a user gesture when the browser
  requires it.
- The default processor bundle embeds both DTLN models. The LiteRT Wasm is
  fetched separately from the packaged `dist/vendor/litert/` files: keep them
  when deploying, since `moduleUrl` only overrides the processor's URL.

The processor buffers four 128-sample render quanta into one 512-sample DTLN
frame, then writes the denoised samples back to an output ring buffer.

## Bundlers

The package is ESM-only and is intended for browser bundlers.

```ts
import { createDeepFilterNetAudioWorklet } from "@workadventure/noise-suppression/deepfilternet";
import { createNoiseSuppressionAudioWorklet } from "@workadventure/noise-suppression/audio-worklet";
```

In the normal worklet path, consumers should not need to configure model URLs,
Wasm URLs, or worklet processor URLs. Each entrypoint loads its packaged
processor bundle and models, resolved relative to the module.

If your application serves assets from a constrained location, you can override
the URLs:

```ts
const deepFilterNetContext = new AudioContext({ sampleRate: 48000 });
const deepFilterNet = await createDeepFilterNetAudioWorklet(deepFilterNetContext, {
  moduleUrl: "/assets/noise-suppression/deepfilternet-worklet-processor.js",
  wasmUrl: "/assets/noise-suppression/df_bg.wasm",
  modelUrl: "/assets/noise-suppression/DeepFilterNet3_onnx.tar.gz",
});

// or, for DTLN:
const dtlnContext = new AudioContext({ sampleRate: 16000 });
const dtln = await createNoiseSuppressionAudioWorklet(dtlnContext, {
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
import { defineConfig } from "vite";
import { noiseSuppressionAudioWorkletVitePlugin } from "@workadventure/noise-suppression/vite";

export default defineConfig({
  plugins: [noiseSuppressionAudioWorkletVitePlugin()],
});
```

The plugin serves the packaged worklet processors (and DeepFilterNet3's Wasm and
model) as raw files in dev and rewrites the package's default URLs to them.
Application code can keep calling `createNoiseSuppressionAudioWorklet()` or
`createDeepFilterNetAudioWorklet()` without dev-specific URL overrides.

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

## Advanced: Synchronous Frame API (DTLN)

The package also exposes the lower-level DTLN runtime API. This is useful for tests,
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
- `/engine-benchmark.html`: speed of the noise suppression models on this
  machine ([engine benchmark](./docs/experiments/engine-benchmark/README.md))

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
- `dist/deepfilternet.js`
- `dist/deepfilternet.d.ts`
- `dist/vite.js`
- `dist/vite.d.ts`
- `dist/background-noise.js`
- `dist/background-noise.d.ts`
- `dist/assets/audio-worklet-processor.js`
- `dist/assets/deepfilternet-worklet-processor.js`
- `dist/assets/*.tflite`
- `dist/assets/deepfilternet/*` (Wasm and model)
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
- DeepFilterNet3 runs libDF (Rust, tract inference) compiled to Wasm, in its own
  AudioWorklet processor; it shares the ring buffer and global-scope shims with
  the DTLN processor, not its runtime.

See [Architecture Decision Records](./docs/adr/README.md) for more background.
