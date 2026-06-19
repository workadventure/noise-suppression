import { describe, expect, test } from "vitest";
import {
  createNoiseSuppressionAudioWorklet,
  isNoiseSuppressionProcessingStartedMessage,
  observeNoiseSuppressionAudioWorkletMessages,
} from "../src/audio-worklet";
import { resumeAudioContext } from "./resume-audio-context";

function waitForProcessingStart(
  worklet: Awaited<ReturnType<typeof createNoiseSuppressionAudioWorklet>>,
  timeoutMs = 15000
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      stopObserving();
      reject(new Error("Timed out waiting for worklet processing to start."));
    }, timeoutMs);

    const stopObserving = observeNoiseSuppressionAudioWorkletMessages(worklet, (message) => {
      if (isNoiseSuppressionProcessingStartedMessage(message)) {
        window.clearTimeout(timeoutId);
        stopObserving();
        resolve(message.processedQuanta);
      }
    });
  });
}

describe("audio worklet runtime", () => {
  test("initializes and starts processing", async () => {
    const context = new AudioContext({ sampleRate: 16000 });
    const source = new ConstantSourceNode(context, { offset: 0.25 });
    const sink = new GainNode(context, { gain: 0 });

    source.start();
    await resumeAudioContext(context);

    try {
      const worklet = await createNoiseSuppressionAudioWorklet(context, {
        numThreads: 1,
      });

      const ready = await worklet.ready;
      const processingStarted = waitForProcessingStart(worklet);

      source.connect(worklet.node).connect(sink).connect(context.destination);

      const processedQuanta = await processingStarted;

      expect(ready.modelDetails.model1.inputs).toHaveLength(2);
      expect(ready.modelDetails.model2.inputs).toHaveLength(2);
      expect(processedQuanta).toBeGreaterThan(0);

      worklet.dispose();
    } finally {
      source.stop();
      await context.close();
    }
  });
});
