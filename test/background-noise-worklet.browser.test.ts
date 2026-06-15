import { describe, expect, test } from "vitest";
import {
  createBackgroundNoiseDetectorAudioWorklet,
  isBackgroundNoiseDetectedMessage,
  observeBackgroundNoiseDetectorAudioWorkletMessages,
} from "../src/background-noise-worklet";
import pureNoiseClipUrl from "../clips/pure-noise.wav?url";
import type {
  BackgroundNoiseDetectedMessage,
  BackgroundNoiseDetectorAudioWorkletOutboundMessage,
} from "../src/background-noise-worklet";

function waitForBackgroundNoiseDetected(
  worklet: Awaited<ReturnType<typeof createBackgroundNoiseDetectorAudioWorklet>>,
  timeoutMs = 15000
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

      worklet.dispose();
    } finally {
      source.stop();
      await context.close();
    }
  }, 20000);

  test("detects the pure-noise fixture as background noise", async () => {
    const context = new AudioContext({ sampleRate: 16000 });
    const response = await fetch(pureNoiseClipUrl);
    const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
    const source = new AudioBufferSourceNode(context, { buffer: audioBuffer });
    const sink = new GainNode(context, { gain: 0 });
    let sourceStarted = false;

    try {
      const worklet = await createBackgroundNoiseDetectorAudioWorklet(context);
      const detected = waitForBackgroundNoiseDetected(worklet, 20000);

      source.connect(worklet.node).connect(sink).connect(context.destination);
      source.start();
      sourceStarted = true;
      await context.resume();

      const event = await detected;

      expect(event.rms).toBeGreaterThan(0.02);
      expect(event.speechFrameRatio).toBeLessThanOrEqual(0.2);
      expect(event.averageSpeechProbability).toBeLessThanOrEqual(0.2);

      worklet.dispose();
    } finally {
      if (sourceStarted) {
        source.stop();
      }
      await context.close();
    }
  }, 30000);
});
