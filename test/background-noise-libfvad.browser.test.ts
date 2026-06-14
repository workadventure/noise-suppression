import { describe, expect, test } from "vitest";
import { createLibFvadVad, getLibFvadFrameSamples } from "../src/background-noise/libfvad";

describe("libfvad wrapper", () => {
  test("returns false for a silent frame", async () => {
    const vad = await createLibFvadVad({
      sampleRate: 16000,
      mode: "aggressive",
      frameDurationMs: 30,
    });

    try {
      expect(vad.frameSamples).toBe(480);
      expect(vad.processFrame(new Float32Array(vad.frameSamples))).toBe(false);
    } finally {
      vad.destroy();
    }
  });

  test("rejects unsupported sample rates and frame durations", async () => {
    expect(() => getLibFvadFrameSamples(44100, 30)).toThrow(
      /Unsupported libfvad sample rate 44100/
    );

    await expect(
      createLibFvadVad({
        sampleRate: 16000,
        mode: "aggressive",
        frameDurationMs: 25,
      })
    ).rejects.toThrow(/Unsupported libfvad frame duration 25ms/);
  });
});
