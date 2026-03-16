import { describe, expect, test } from "vitest";
import createNoiseSuppressionModule from "../src/index";

function seededNoise(length: number, seed = 123456789): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0;

  for (let i = 0; i < length; i++) {
    state = (1664525 * state + 1013904223) >>> 0;
    out[i] = (state / 0xffffffff) * 2 - 1;
  }

  return out;
}

function maxAbs(value: Float32Array): number {
  let max = 0;

  for (const sample of value) {
    max = Math.max(max, Math.abs(sample));
  }

  return max;
}

describe("browser runtime", () => {
  test("initializes and denoises a frame", async () => {
    const runtime = await createNoiseSuppressionModule({
      threads: false,
      numThreads: 1,
    });

    await runtime.ready;

    const handle = runtime.dtln_create();
    const input = seededNoise(512);
    const output = new Float32Array(512);

    runtime.dtln_denoise(handle, input, output);
    runtime.dtln_stop(handle);

    expect(runtime.modelDetails.model1.inputs).toHaveLength(2);
    expect(runtime.modelDetails.model2.inputs).toHaveLength(2);
    expect(Array.from(output).every(Number.isFinite)).toBe(true);
    expect(maxAbs(output)).toBeGreaterThan(0);
  });
});
