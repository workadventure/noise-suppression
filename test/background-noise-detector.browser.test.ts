import { describe, expect, test } from "vitest";
import {
  BackgroundNoiseDetector,
  calculateRms,
  rmsToDbfs,
} from "../src/background-noise/detector";

const FRAME_DURATION_MS = 30;
const FRAME_SAMPLES = 480;

function createFrame(amplitude: number): Float32Array {
  return new Float32Array(FRAME_SAMPLES).fill(amplitude);
}

function processFrames(
  detector: BackgroundNoiseDetector,
  frameCount: number,
  amplitude: number,
  isVoice: (index: number) => boolean = () => false
) {
  return Array.from({ length: frameCount }, (_, index) =>
    detector.processFrame(createFrame(amplitude), {
      isVoice: isVoice(index),
      durationMs: FRAME_DURATION_MS,
    })
  );
}

describe("background noise detector", () => {
  test("computes frame RMS and dBFS", () => {
    expect(calculateRms(createFrame(0.02))).toBeCloseTo(0.02);
    expect(rmsToDbfs(0.02)).toBeCloseTo(-33.9794, 4);
    expect(rmsToDbfs(0)).toBeLessThan(-6000);
  });

  test("emits after sustained loud non-voice input", () => {
    const detector = new BackgroundNoiseDetector();
    const results = processFrames(detector, 50, 0.03);
    const events = results.flatMap((result) => (result.event === null ? [] : [result.event]));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "background-noise-detected",
      voiceFrameRatio: 0,
      activeFrameRatio: 1,
      windowMs: 1500,
      timestampMs: 1500,
    });
    expect(events[0]?.rms).toBeCloseTo(0.03);
    expect(events[0]?.rmsDb).toBeCloseTo(rmsToDbfs(0.03), 4);
  });

  test("does not emit when the candidate window has too much voice", () => {
    const detector = new BackgroundNoiseDetector();
    const results = processFrames(
      detector,
      50,
      0.03,
      (index) => index > 0 && index <= 11
    );

    expect(results.some((result) => result.event !== null)).toBe(false);
  });

  test("does not emit when the candidate average RMS is below the noise threshold", () => {
    const detector = new BackgroundNoiseDetector();
    const results = processFrames(detector, 50, 0.015);

    expect(results.some((result) => result.event !== null)).toBe(false);
  });

  test("applies cooldown after emitted events", () => {
    const detector = new BackgroundNoiseDetector({
      analysisWindowMs: 60,
      cooldownMs: 100,
    });

    const results = processFrames(detector, 7, 0.03);
    const events = results.flatMap((result) => (result.event === null ? [] : [result.event]));

    expect(events).toHaveLength(2);
    expect(events[0]?.timestampMs).toBe(60);
    expect(events[1]?.timestampMs).toBe(210);
  });

  test("validates options and rejects empty RMS frames", () => {
    expect(() => new BackgroundNoiseDetector({ maxVoiceFrameRatio: 1.1 })).toThrow(
      /maxVoiceFrameRatio must be between 0 and 1/
    );
    expect(() => calculateRms(new Float32Array())).toThrow(/empty audio frame/);
  });
});
