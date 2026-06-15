import { describe, expect, test } from "vitest";
import {
  createBackgroundNoiseDetectorAudioWorklet,
  isBackgroundNoiseDetectedMessage,
  observeBackgroundNoiseDetectorAudioWorkletMessages,
} from "../src/background-noise-worklet";
import type {
  BackgroundNoiseDetectedMessage,
  BackgroundNoiseDetectorAudioWorkletOutboundMessage,
} from "../src/background-noise-worklet";

function waitForBackgroundNoiseDetected(
  worklet: Awaited<ReturnType<typeof createBackgroundNoiseDetectorAudioWorklet>>,
  timeoutMs = 5000
): Promise<BackgroundNoiseDetectedMessage> {
  return new Promise<BackgroundNoiseDetectedMessage>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      stopObserving();
      reject(new Error("Timed out waiting for background noise detector event."));
    }, timeoutMs);

    const stopObserving = observeBackgroundNoiseDetectorAudioWorkletMessages(
      worklet,
      (message: BackgroundNoiseDetectorAudioWorkletOutboundMessage) => {
        if (!isBackgroundNoiseDetectedMessage(message)) {
          return;
        }

        window.clearTimeout(timeoutId);
        stopObserving();
        resolve(message);
      }
    );
  });
}

describe("background noise AudioWorklet public API", () => {
  test("creates a detector handle and observes background noise events", async () => {
    const context = new AudioContext({ sampleRate: 16000 });
    const source = new ConstantSourceNode(context, { offset: 0 });
    const sink = new GainNode(context, { gain: 0 });

    source.start();

    try {
      const worklet = await createBackgroundNoiseDetectorAudioWorklet(context, {
        frameDurationMs: 30,
        triggerRms: 0,
        noisyRms: 0,
        analysisWindowMs: 60,
        cooldownMs: 1000,
      });

      const ready = await worklet.ready;
      const detected = waitForBackgroundNoiseDetected(worklet);

      source.connect(worklet.node).connect(sink).connect(context.destination);
      await context.resume();

      const event = await detected;

      expect(ready).toEqual({
        type: "ready",
        sampleRate: 16000,
        frameSamples: 480,
      });
      expect(event).toMatchObject({
        type: "background-noise-detected",
        rms: 0,
        voiceFrameRatio: 0,
        activeFrameRatio: 1,
        windowMs: 60,
      });

      worklet.dispose();
    } finally {
      source.stop();
      await context.close();
    }
  });
});
