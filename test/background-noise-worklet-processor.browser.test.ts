import { describe, expect, test } from "vitest";
import processorUrl from "../src/background-noise-worklet-processor.ts?worker&url";
import {
  BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME,
  type BackgroundNoiseDetectorAudioWorkletOutboundMessage,
  type BackgroundNoiseDetectorAudioWorkletReadyMessage,
} from "../src/background-noise-worklet-shared";

function createBackgroundNoiseDetectorNode(
  context: BaseAudioContext,
  processorOptions: AudioWorkletNodeOptions["processorOptions"] = {}
): AudioWorkletNode {
  return new AudioWorkletNode(
    context,
    BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME,
    {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions,
    }
  );
}

function waitForWorkletMessage<T extends BackgroundNoiseDetectorAudioWorkletOutboundMessage>(
  node: AudioWorkletNode,
  predicate: (message: BackgroundNoiseDetectorAudioWorkletOutboundMessage) => message is T,
  timeoutMs = 5000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for background noise worklet message."));
    }, timeoutMs);

    const handleMessage = (
      event: MessageEvent<BackgroundNoiseDetectorAudioWorkletOutboundMessage>
    ) => {
      const message = event.data;

      if (message.type === "error") {
        cleanup();
        reject(new Error(message.message));
        return;
      }

      if (predicate(message)) {
        cleanup();
        resolve(message);
      }
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      node.port.removeEventListener("message", handleMessage);
    };

    node.port.addEventListener("message", handleMessage);
    node.port.start();
  });
}

function isReadyMessage(
  message: BackgroundNoiseDetectorAudioWorkletOutboundMessage
): message is BackgroundNoiseDetectorAudioWorkletReadyMessage {
  return message.type === "ready";
}

describe("background noise AudioWorklet processor", () => {
  test("passes audio through unchanged", async () => {
    const context = new OfflineAudioContext(1, 512, 16000);
    await context.audioWorklet.addModule(processorUrl);

    const source = new ConstantSourceNode(context, { offset: 0.25 });
    const node = createBackgroundNoiseDetectorNode(context);

    source.connect(node).connect(context.destination);
    source.start(0);

    const renderedBuffer = await context.startRendering();
    const output = renderedBuffer.getChannelData(0);

    expect(output[0]).toBeCloseTo(0.25, 5);
    expect(output[output.length - 1]).toBeCloseTo(0.25, 5);
  });

  test("posts Silero frame metadata when initialized", async () => {
    const context = new AudioContext({ sampleRate: 16000 });
    await context.audioWorklet.addModule(processorUrl);

    const node = createBackgroundNoiseDetectorNode(context, {
      frameSamples: 512,
      sileroModel: "v5",
    });

    try {
      const readyMessage = await waitForWorkletMessage(node, isReadyMessage);

      expect(readyMessage).toEqual({
        type: "ready",
        sampleRate: 16000,
        frameSamples: 512,
        frameDurationMs: 32,
        sileroModel: "v5",
      });
    } finally {
      node.port.postMessage({ type: "dispose" });
      await context.close();
    }
  });
});
