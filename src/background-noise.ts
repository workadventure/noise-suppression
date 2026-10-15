import * as ort from "onnxruntime-web/wasm";
import sileroModelUrl from "virtual:background-noise-detector-silero-model-url";
import captureProcessorSource from "virtual:background-noise-capture-processor-source";
import {
  BackgroundNoiseDetector,
  type BackgroundNoiseDetectorOptions,
} from "./background-noise/detector";
import type { BackgroundNoiseDetectedMessage } from "./background-noise/detector";

export type BackgroundNoiseDetectorSileroModel = "v5";

export type BackgroundNoiseDetectorRuntimeOptions = BackgroundNoiseDetectorOptions;

export interface BackgroundNoiseDetectorReadyMessage {
  type: "ready";
  sampleRate: number;
  frameSamples: number;
  frameDurationMs: number;
  sileroModel: BackgroundNoiseDetectorSileroModel;
}

export interface BackgroundNoiseDetectorErrorMessage {
  type: "error";
  message: string;
  stack?: string;
}

export type BackgroundNoiseDetectorOutboundMessage =
  | BackgroundNoiseDetectorReadyMessage
  | BackgroundNoiseDetectorErrorMessage
  | BackgroundNoiseDetectedMessage;

export interface BackgroundNoiseDetectorHandle {
  ready: Promise<BackgroundNoiseDetectorReadyMessage>;
  dispose(): void;
}

const SILERO_SAMPLE_RATE = 16000;
const SILERO_FRAME_SAMPLES = 512;
const CAPTURE_PROCESSOR_NAME = "workadventure-background-noise-capture";
const handleMessageTargets = new WeakMap<BackgroundNoiseDetectorHandle, EventTarget>();

// The capture processor ships inside this module and loads from a blob: URL, so there is no worklet file for a
// bundler to rename or inline. A page with a Content-Security-Policy must allow blob: in script-src. One URL for the
// page's lifetime: AudioWorklet loads a URL once per context, a second registerProcessor() would throw.
let captureProcessorUrl: string | undefined;

export async function createBackgroundNoiseDetector(
  context: AudioContext,
  stream: MediaStream,
  options: BackgroundNoiseDetectorRuntimeOptions = {}
): Promise<BackgroundNoiseDetectorHandle> {
  const detector = new BackgroundNoiseDetector(options);
  const messageTarget = new EventTarget();

  // Silero is small: one thread, so ONNX Runtime never spawns workers.
  ort.env.wasm.numThreads = 1;
  const [session] = await Promise.all([
    fetch(sileroModelUrl)
      .then((response) => response.arrayBuffer())
      .then((model) => ort.InferenceSession.create(model)),
    context.audioWorklet.addModule(
      (captureProcessorUrl ??= URL.createObjectURL(
        new Blob([captureProcessorSource], { type: "text/javascript" })
      ))
    ),
  ]);

  let state: ort.Tensor = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new ort.Tensor("int64", [BigInt(SILERO_SAMPLE_RATE)]);
  let disposed = false;
  // Frames run one after the other: each one needs the state the previous one left.
  let inference = Promise.resolve();

  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, CAPTURE_PROCESSOR_NAME);
  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const frame = event.data;
    inference = inference
      .then(async () => {
        if (disposed) {
          return;
        }
        const output = await session.run({
          input: new ort.Tensor("float32", frame, [1, frame.length]),
          state,
          sr,
        });
        state = output["stateN"] as ort.Tensor;
        const result = detector.processFrame(frame, {
          speechProbability: (output["output"] as ort.Tensor).data[0] as number,
          durationMs: (frame.length / SILERO_SAMPLE_RATE) * 1000,
        });
        if (result.event !== null && !disposed) {
          dispatchMessage(messageTarget, result.event);
        }
      })
      .catch((error: unknown) => {
        console.error("Background noise detection failed on a frame", error);
      });
  };
  source.connect(capture);

  const readyMessage: BackgroundNoiseDetectorReadyMessage = {
    type: "ready",
    sampleRate: SILERO_SAMPLE_RATE,
    frameSamples: SILERO_FRAME_SAMPLES,
    frameDurationMs: (SILERO_FRAME_SAMPLES / SILERO_SAMPLE_RATE) * 1000,
    sileroModel: "v5",
  };

  const handle: BackgroundNoiseDetectorHandle = {
    ready: Promise.resolve(readyMessage),
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      detector.reset();
      source.disconnect();
      capture.port.postMessage("stop");
      capture.port.onmessage = null;
      void inference.then(() => session.release()).catch(() => undefined);
    },
  };

  handleMessageTargets.set(handle, messageTarget);
  return handle;
}

export function observeBackgroundNoiseDetectorMessages(
  handle: BackgroundNoiseDetectorHandle,
  listener: (message: BackgroundNoiseDetectorOutboundMessage) => void
): () => void {
  const messageTarget = handleMessageTargets.get(handle);

  if (!messageTarget) {
    return () => undefined;
  }

  const handleMessage = (event: Event) => {
    listener((event as CustomEvent<BackgroundNoiseDetectorOutboundMessage>).detail);
  };

  messageTarget.addEventListener("message", handleMessage);

  return () => {
    messageTarget.removeEventListener("message", handleMessage);
  };
}

export function isBackgroundNoiseDetectedMessage(
  message: BackgroundNoiseDetectorOutboundMessage
): message is BackgroundNoiseDetectedMessage {
  return message.type === "background-noise-detected";
}

export type { BackgroundNoiseDetectedMessage };

function dispatchMessage(
  target: EventTarget,
  message: BackgroundNoiseDetectorOutboundMessage
): void {
  target.dispatchEvent(new CustomEvent("message", { detail: message }));
}
