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

- `/listen-test.html`: microphone, sample clip, or local file playback with a
  worklet/bypass switch
- `/audio-worklet.html`: minimal AudioWorklet initialization demo
- `/audio-worklet-validation.html`: validation page for the worklet runtime
- `/browser-benchmark-litert.html`: LiteRT benchmark page
- `/browser-benchmark-compare.html`: single-threaded vs threaded comparison

The Vite dev server is configured with COOP and COEP headers so
cross-origin-isolated runtime experiments are possible during local development.

## Build And Test

```bash
npm run typecheck
npm run build
npm run test:browser
```

The library build writes:

- `dist/index.js`
- `dist/index.d.ts`
- `dist/audio-worklet.js`
- `dist/audio-worklet.d.ts`
- `dist/assets/audio-worklet-processor.js`
- `dist/assets/*.tflite`
- `dist/vendor/litert/*`

## Architecture Notes

- The worklet path uses the repository-local [LiteRT ESM fork](https://github.com/moufmouf/LiteRT/tree/esm-module) and passes bundled
  Wasm bytes to the Emscripten module factory.
- The bundled worklet path currently runs LiteRT single-threaded.
- The lower-level frame API currently depends on LiteRT.js internal synchronous
  runner APIs to keep `dtln_denoise()` synchronous.
- Threaded LiteRT experiments require cross-origin isolation in production.

See [Architecture Decision Records](./docs/adr/README.md) for more background.
