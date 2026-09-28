import { describe, expect, test } from "vitest";
import { LoadMonitor } from "../src/load-monitor";
import { PauseGate, type PauseGateOptions } from "../src/pause-gate";
import { DEFAULT_POST_GAIN, PostGain } from "../src/post-gain";

const FRAME = 480;
const GATE: PauseGateOptions = {
  extraAttenuationDb: 20,
  lookaheadFrames: 3,
  hangoverFrames: 10,
  releaseDbPerFrame: 0.6,
  speechAboveFloorDb: 10,
  maxSpeechAttenuationDb: 15,
};

function seededNoise(length: number, amplitude: number, seed: number): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (1664525 * state + 1013904223) >>> 0;
    out[i] = ((state / 0xffffffff) * 2 - 1) * amplitude;
  }
  return out;
}

function tone(length: number, amplitude: number, offset = 0): Float32Array {
  return Float32Array.from({ length }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * (i + offset)) / 48000));
}

function levelDb(samples: Float32Array): number {
  let energy = 0;
  for (const sample of samples) {
    energy += sample * sample;
  }
  return 10 * Math.log10(energy / samples.length + 1e-12);
}

/** Feeds a quiet floor, then one frame loud enough to count as speech every 15 frames: a click the model kept. */
function lastFrameWithClicks(gate: PauseGate): Float32Array {
  let last: Float32Array = new Float32Array(FRAME);
  for (let i = 0; i < 300; i++) {
    const frame = i % 15 === 0 ? tone(FRAME, 0.3) : seededNoise(FRAME, 0.001, i + 1);
    last = gate.process(frame, frame);
  }
  return last;
}

describe("PauseGate minSpeechFrames", () => {
  test("a single-frame click the model kept opens the default gate", () => {
    const last = lastFrameWithClicks(new PauseGate(GATE));
    // Open or releasing: well above the fully closed level.
    expect(levelDb(last)).toBeGreaterThan(levelDb(seededNoise(FRAME, 0.001, 300)) - 15);
  });

  test("with minSpeechFrames 2, single-frame clicks leave the gate closed", () => {
    const last = lastFrameWithClicks(new PauseGate({ ...GATE, minSpeechFrames: 2 }));
    expect(levelDb(last)).toBeLessThan(levelDb(seededNoise(FRAME, 0.001, 300)) - 18);
  });

  test("with minSpeechFrames 2, speech still comes out at full level", () => {
    const gate = new PauseGate({ ...GATE, minSpeechFrames: 2 });
    for (let i = 0; i < 200; i++) {
      const floor = seededNoise(FRAME, 0.001, i + 1);
      gate.process(floor, floor);
    }
    const outputs = Array.from({ length: 6 }, (_, i) => {
      const frame = tone(FRAME, 0.5, i * FRAME);
      return gate.process(frame, frame);
    });
    // Two frames to decide, then the ramp over the lookahead: only the first speech frame (out at index 3) is still
    // ramping; the next one comes out at full level. Each output is compared with its own input frame.
    expect(levelDb(outputs[3]!)).toBeLessThan(levelDb(tone(FRAME, 0.5, 0)) - 0.5);
    expect(levelDb(outputs[4]!)).toBeCloseTo(levelDb(tone(FRAME, 0.5, FRAME)), 1);
  });
});

describe("PostGain", () => {
  test("raises quiet speech towards the target, slowly", () => {
    const postGain = new PostGain();
    const quiet = () => tone(FRAME, 0.02); // about -37 dBFS
    postGain.process(quiet());
    expect(postGain.currentGainDb).toBeCloseTo(DEFAULT_POST_GAIN.adaptDbPerFrame, 5);

    for (let i = 0; i < 1000; i++) {
      postGain.process(quiet());
    }
    expect(postGain.currentGainDb).toBeCloseTo(DEFAULT_POST_GAIN.targetDb - levelDb(quiet()), 1);
  });

  test("does not move on frames below the speech threshold, so the residual noise is not pumped up", () => {
    const postGain = new PostGain();
    for (let i = 0; i < 500; i++) {
      postGain.process(seededNoise(FRAME, 0.001, i + 1)); // about -65 dBFS
    }
    expect(postGain.currentGainDb).toBe(0);
  });

  test("never lets a frame exceed the ceiling", () => {
    const postGain = new PostGain();
    for (let i = 0; i < 1000; i++) {
      postGain.process(tone(FRAME, 0.02));
    }
    const loud = postGain.process(tone(FRAME, 0.8));
    expect(Math.max(...loud.map(Math.abs))).toBeLessThanOrEqual(DEFAULT_POST_GAIN.ceiling + 1e-6);
  });
});

describe("LoadMonitor", () => {
  const frameMs = 10;

  test("ignores one slow window", () => {
    const monitor = new LoadMonitor(10, frameMs, 0.7);
    const reports = [...Array(10).fill(9), ...Array(20).fill(1)].map((ms: number) => monitor.record(ms));
    expect(reports.every((report) => report === undefined)).toBe(true);
  });

  test("reports two slow windows in a row, once", () => {
    const monitor = new LoadMonitor(10, frameMs, 0.7);
    const reports = Array.from({ length: 40 }, () => monitor.record(8)).filter((report) => report !== undefined);
    expect(reports).toEqual([0.8]);
  });
});
