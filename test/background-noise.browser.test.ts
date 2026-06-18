import { describe, expect, test } from "vitest";
import {
  createBackgroundNoiseDetector,
  isBackgroundNoiseDetectedMessage,
  observeBackgroundNoiseDetectorMessages,
} from "../src/background-noise";
import pureNoiseClipUrl from "../clips/pure-noise.wav?url";
import type {
  BackgroundNoiseDetectedMessage,
  BackgroundNoiseDetectorHandle,
  BackgroundNoiseDetectorOutboundMessage,
} from "../src/background-noise";

function waitForBackgroundNoiseDetected(
  detector: BackgroundNoiseDetectorHandle,
  timeoutMs = 15000
): Promise<BackgroundNoiseDetectedMessage> {
  return new Promise<BackgroundNoiseDetectedMessage>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      stopObserving();
      reject(new Error("Timed out waiting for background noise detector event."));
    }, timeoutMs);

    const stopObserving = observeBackgroundNoiseDetectorMessages(
      detector,
      (message: BackgroundNoiseDetectorOutboundMessage) => {
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

describe("background noise stream detector public API", () => {
  test("creates a detector handle and observes background noise events", async () => {
    const context = new AudioContext({ sampleRate: 16000 });
    const source = new ConstantSourceNode(context, { offset: 0 });
    const vadInput = context.createMediaStreamDestination();

    source.connect(vadInput);
    source.start();

    try {
      const detector = await createBackgroundNoiseDetector(context, vadInput.stream, {
        triggerRms: 0,
        noisyRms: 0,
        analysisWindowMs: 60,
        cooldownMs: 1000,
      });

      const ready = await detector.ready;
      const detected = waitForBackgroundNoiseDetected(detector);
      await context.resume();

      const event = await detected;

      expect(ready).toEqual({
        type: "ready",
        sampleRate: 16000,
        frameSamples: 512,
        frameDurationMs: 32,
        sileroModel: "v5",
      });
      expect(event).toMatchObject({
        type: "background-noise-detected",
        rms: 0,
        speechFrameRatio: 0,
        voiceFrameRatio: 0,
        activeFrameRatio: 1,
        windowMs: 64,
      });

      detector.dispose();
    } finally {
      source.stop();
      vadInput.disconnect();
      await context.close();
    }
  }, 20000);

  test("detects the pure-noise fixture as background noise", async () => {
    const context = new AudioContext({ sampleRate: 16000 });
    const response = await fetch(pureNoiseClipUrl);
    const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
    const source = new AudioBufferSourceNode(context, { buffer: audioBuffer });
    const vadInput = context.createMediaStreamDestination();
    let sourceStarted = false;

    source.connect(vadInput);

    try {
      const detector = await createBackgroundNoiseDetector(context, vadInput.stream);
      const detected = waitForBackgroundNoiseDetected(detector, 20000);

      source.start();
      sourceStarted = true;
      await context.resume();

      const event = await detected;

      expect(event.rms).toBeGreaterThan(0.02);
      expect(event.speechFrameRatio).toBeLessThanOrEqual(0.2);
      expect(event.averageSpeechProbability).toBeLessThanOrEqual(0.2);

      detector.dispose();
    } finally {
      if (sourceStarted) {
        source.stop();
      }
      vadInput.disconnect();
      await context.close();
    }
  }, 30000);
});
