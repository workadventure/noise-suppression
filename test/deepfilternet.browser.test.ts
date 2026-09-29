import { describe, expect, test } from "vitest";
import { createDeepFilterNetAudioWorklet, DEEPFILTERNET_SAMPLE_RATE } from "../src/deepfilternet";
import { PauseGate, type PauseGateOptions } from "../src/pause-gate";
import cleanVoiceClipUrl from "../clips/clean-voice.wav?url";

const FRAME = 480;
const GATE: PauseGateOptions = {
  extraAttenuationDb: 20,
  lookaheadFrames: 3,
  hangoverFrames: 10,
  releaseDbPerFrame: 0.6,
  speechAboveFloorDb: 10,
  maxSpeechAttenuationDb: 15,
};

function seededNoise(length: number, amplitude: number, seed = 123456789): Float32Array {
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

/** A frame the denoiser let through untouched: [denoised, input]. */
function kept(frame: Float32Array): [Float32Array, Float32Array] {
  return [frame, frame];
}

/** Synthetic keystrokes: a decaying broadband click, a plastic resonance and a low thud, 4 to 10 per second. */
function keystrokes(length: number, rate: number, seed = 42): Float32Array {
  const out = new Float32Array(length);
  let state = seed;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 0xffffffff);
  const addKey = (start: number, amplitude: number) => {
    const ring = 2000 + 2000 * random();
    const thud = 120 + 80 * random();
    for (let i = 0; i < 0.05 * rate && start + i < length; i++) {
      const t = i / rate;
      const click = (random() * 2 - 1) * Math.exp(-t / 0.004);
      const tone = Math.sin(2 * Math.PI * ring * t) * Math.exp(-t / 0.01);
      const low = Math.sin(2 * Math.PI * thud * t) * Math.exp(-t / 0.015);
      out[start + i]! += amplitude * (0.6 * click + 0.4 * tone + 0.5 * low);
    }
  };
  for (let t = 0; t < length / rate; t += 0.1 + 0.15 * random()) {
    addKey(Math.round(t * rate), 0.15 + 0.25 * random());
    addKey(Math.round((t + 0.06 + 0.04 * random()) * rate), 0.05 + 0.07 * random()); // key release
  }
  return out;
}

function bestLag(reference: Float32Array, delayed: Float32Array, maxLag: number): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let i = 0; i + lag < delayed.length && i < reference.length; i += 1) {
      score += reference[i]! * delayed[i + lag]!;
    }
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

function levelDb(samples: Float32Array): number {
  let energy = 0;
  for (const sample of samples) {
    energy += sample * sample;
  }
  return 10 * Math.log10(energy / samples.length + 1e-12);
}

describe("PauseGate", () => {
  test("delays the signal by the lookahead", () => {
    const gate = new PauseGate(GATE);
    const outputs = Array.from({ length: 4 }, (_, i) => gate.process(...kept(tone(FRAME, 0.5, i * FRAME))));

    expect(outputs.slice(0, 3).every((frame) => frame.every((sample) => sample === 0))).toBe(true);
    expect(levelDb(outputs[3]!)).toBeGreaterThan(-20);
  });

  test("attenuates long pauses by the extra attenuation", () => {
    const gate = new PauseGate(GATE);
    let last: Float32Array = new Float32Array(FRAME);
    for (let i = 0; i < 200; i++) {
      last = gate.process(...kept(seededNoise(FRAME, 0.01, i + 1)));
    }

    expect(levelDb(last)).toBeCloseTo(levelDb(seededNoise(FRAME, 0.01, 200)) - 20, 0);
  });

  test("stays closed on bursts the denoiser removed, such as keystrokes", () => {
    const gate = new PauseGate(GATE);
    let last: Float32Array = new Float32Array(FRAME);
    for (let i = 0; i < 200; i++) {
      // Every 15 frames a burst far above the residual floor, but 25 dB below what came in: noise the model removed.
      const denoised = seededNoise(FRAME, i % 15 === 0 ? 0.2 : 0.001, i + 1);
      last = gate.process(denoised, denoised.map((sample) => sample * 18));
    }

    expect(levelDb(last)).toBeLessThan(levelDb(seededNoise(FRAME, 0.001, 200)) - 15);
  });

  test("still closes when the signal starts with digital silence", () => {
    const gate = new PauseGate(GATE);
    for (let i = 0; i < 20; i++) {
      gate.process(...kept(new Float32Array(FRAME)));
    }
    let last: Float32Array = new Float32Array(FRAME);
    for (let i = 0; i < 60; i++) {
      last = gate.process(...kept(seededNoise(FRAME, 0.01, i + 1)));
    }

    expect(levelDb(last)).toBeLessThan(levelDb(seededNoise(FRAME, 0.01, 60)) - 15);
  });

  test("is fully open when the first speech frame comes out after a pause", () => {
    const gate = new PauseGate(GATE);
    for (let i = 0; i < 200; i++) {
      gate.process(...kept(seededNoise(FRAME, 0.001, i + 1)));
    }
    const speech = tone(FRAME, 0.5);
    const outputs = [speech, ...Array.from({ length: 3 }, (_, i) => tone(FRAME, 0.5, (i + 1) * FRAME))].map((frame) =>
      gate.process(...kept(frame))
    );

    // The speech frame entered 3 frames ago: it must come out at full level, with no ramp left.
    expect(levelDb(outputs[3]!)).toBeCloseTo(levelDb(speech), 1);
  });
});

describe("DeepFilterNet3 AudioWorklet", () => {
  test("rejects a context that does not run at 48 kHz", async () => {
    const context = new OfflineAudioContext(1, 16000, 16000);

    await expect(createDeepFilterNetAudioWorklet(context)).rejects.toThrow("48000 Hz");
  });

  async function denoise(
    input: Float32Array,
    model: "standard" | "low-latency" = "standard",
  ): Promise<{ output: Float32Array; frameSamples: number }> {
    const context = new OfflineAudioContext(1, input.length, DEEPFILTERNET_SAMPLE_RATE);
    const handle = await createDeepFilterNetAudioWorklet(context, { bypassUntilReady: false, model });
    const { frameSamples } = await handle.ready;
    const buffer = new AudioBuffer({
      length: input.length,
      sampleRate: DEEPFILTERNET_SAMPLE_RATE,
      numberOfChannels: 1,
    });
    buffer.getChannelData(0).set(input);
    const source = new AudioBufferSourceNode(context, { buffer });
    source.connect(handle.node).connect(context.destination);
    source.start();
    const output = (await context.startRendering()).getChannelData(0);
    handle.dispose();
    return { output, frameSamples };
  }

  async function loadVoice(): Promise<Float32Array> {
    const decoder = new OfflineAudioContext(1, 1, DEEPFILTERNET_SAMPLE_RATE);
    const bytes = await (await fetch(cleanVoiceClipUrl)).arrayBuffer();
    return (await decoder.decodeAudioData(bytes)).getChannelData(0);
  }

  test("reports its measured load once through onLoadReport", async () => {
    const seconds = 5;
    const context = new OfflineAudioContext(1, seconds * DEEPFILTERNET_SAMPLE_RATE, DEEPFILTERNET_SAMPLE_RATE);
    let resolveReport: (report: unknown) => void = () => {};
    const reported = new Promise((resolve) => {
      resolveReport = resolve;
    });
    const reports: unknown[] = [];
    const handle = await createDeepFilterNetAudioWorklet(context, {
      bypassUntilReady: false,
      loadReportAfterMs: 4000,
      onLoadReport: (report) => {
        reports.push(report);
        resolveReport(report);
      },
    });
    await handle.ready;
    const buffer = new AudioBuffer({
      length: seconds * DEEPFILTERNET_SAMPLE_RATE,
      sampleRate: DEEPFILTERNET_SAMPLE_RATE,
      numberOfChannels: 1,
    });
    buffer.getChannelData(0).set(seededNoise(seconds * DEEPFILTERNET_SAMPLE_RATE, 0.05));
    const source = new AudioBufferSourceNode(context, { buffer });
    source.connect(handle.node).connect(context.destination);
    source.start();
    await context.startRendering();
    const report = (await reported) as { windows: number; frames: number; medianLoad: number };
    handle.dispose();

    // 4 s = two 2 s windows of 200 frames
    expect(reports).toHaveLength(1);
    expect(report.windows).toBe(2);
    expect(report.frames).toBe(400);
    expect(report.medianLoad).toBeGreaterThanOrEqual(0);
  });

  // Model (~40 ms) + pause gate lookahead (30 ms).
  const DELAY_SAMPLES = 3360;

  test("leaves clean speech untouched", async () => {
    const voice = await loadVoice();
    const { output, frameSamples } = await denoise(voice);

    expect(frameSamples).toBe(480);
    expect(output.every(Number.isFinite)).toBe(true);
    const voiceOut = output.subarray(DELAY_SAMPLES);
    expect(levelDb(voiceOut)).toBeCloseTo(levelDb(voice.subarray(0, voiceOut.length)), 0);
  });

  test("the low-latency model keeps clean speech, 20 ms earlier", async () => {
    const voice = await loadVoice();
    const standard = await denoise(voice);
    const lowLatency = await denoise(voice, "low-latency");

    // Same windowing and gate, no model lookahead: 2 frames (960 samples) earlier.
    expect(bestLag(voice, lowLatency.output, 4000)).toBe(bestLag(voice, standard.output, 4000) - 960);
    const voiceOut = lowLatency.output.subarray(DELAY_SAMPLES - 960);
    expect(levelDb(voiceOut)).toBeCloseTo(levelDb(voice.subarray(0, voiceOut.length)), 0);
  });

  test("removes keystrokes beyond its speech limit when nobody talks", async () => {
    const rate = DEEPFILTERNET_SAMPLE_RATE;
    const typing = keystrokes(4 * rate, rate);
    const { output } = await denoise(typing);

    // Once the gate has closed: more than the 25 dB speech limit, because keystrokes no longer open it.
    const range = [rate * 1.5, rate * 3.9] as const;
    expect(levelDb(typing.subarray(...range)) - levelDb(output.subarray(...range))).toBeGreaterThan(35);
  });

  test("removes noise in pauses and keeps speech in noise", async () => {
    const rate = DEEPFILTERNET_SAMPLE_RATE;
    const voice = await loadVoice();
    // 2 s of noise only, then the voice over the same noise (white noise, ~16 dB below the voice).
    const noise = seededNoise(2 * rate + voice.length, 0.02);
    const input = noise.map((sample, i) => (i < 2 * rate ? sample : sample + voice[i - 2 * rate]!));
    const { output } = await denoise(input);

    // Noise only, once the model and the pause gate have settled (the gate needs ~0.45 s to close):
    // 25 dB limit + 20 dB gate.
    const noiseRange = [rate * 1.5, rate * 1.95] as const;
    expect(levelDb(noise.subarray(...noiseRange)) - levelDb(output.subarray(...noiseRange))).toBeGreaterThan(35);
    // White noise overlaps the whole voice spectrum, so the model trades a few dB of speech for it (4-5 dB here,
    // with or without the gate).
    const voiceOut = output.subarray(2 * rate + DELAY_SAMPLES);
    expect(levelDb(voice.subarray(0, voiceOut.length)) - levelDb(voiceOut)).toBeLessThan(6);
  });
});
