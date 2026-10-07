// Benchmark of the three engines on the machine running the page, plus the hooks docs/experiments/engine-benchmark
// drives with Playwright to measure their quality.
import initDeepFilterNet, { df_create, df_process_frame } from "../forks/deepfilternet/df.js";
import { defaultDeepFilterNetModelUrl, defaultDeepFilterNetWasmUrl } from "virtual:deepfilternet-default-assets";
import { createNoiseSuppressionAudioWorklet } from "../src/audio-worklet";
import { createDeepFilterNetAudioWorklet, type DeepFilterNetAudioWorkletOptions } from "../src/deepfilternet";
import { createNoiseSuppressionModule } from "../src/index";
import restaurantClipUrl from "../clips/restaurant_noisy.wav?url";

export type EngineId = "dtln" | "deepfilternet";

interface Engine {
  label: string;
  sampleRate: number;
  /** Samples the worklet processes at once: the work of its busiest render quantum. */
  stepSamples: number;
  /**
   * Time the worklet has for that work: the render quantum it runs in. DeepFilterNet computes a 10 ms frame inside
   * one 128-sample quantum at 48 kHz; DTLN buffers four quanta and runs its four 128-sample shifts in the fourth
   * (512 samples, ADR 0006), inside one 128-sample quantum at 16 kHz.
   */
  deadlineMs: number;
}

export const ENGINES: Record<EngineId, Engine> = {
  dtln: { label: "DTLN", sampleRate: 16000, stepSamples: 512, deadlineMs: 8 },
  deepfilternet: { label: "DeepFilterNet3", sampleRate: 48000, stepSamples: 480, deadlineMs: 128 / 48 },
};

export interface SpeedResult {
  engine: EngineId;
  /** Main thread: download (or HTTP cache), compile and create, until the first step can run. */
  loadMs: number;
  steps: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  deadlineMs: number;
  /** Share of one core the model needs: mean step time / audio duration of a step. */
  cpuShare: number;
}

async function decodeClip(url: string, sampleRate: number, seconds: number): Promise<Float32Array> {
  const decoder = new OfflineAudioContext(1, 1, sampleRate);
  const clip = (await decoder.decodeAudioData(await (await fetch(url)).arrayBuffer())).getChannelData(0);
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i += clip.length) {
    out.set(clip.subarray(0, Math.min(clip.length, out.length - i)), i);
  }
  return out;
}

// A dev server sending the model with `Content-Encoding: gzip` hands over the inflated .tar, which libDF rejects:
// gzip it again then, as src/deepfilternet.ts does
async function fetchModel(url: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return bytes;
  }
  const gzipped = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(gzipped).arrayBuffer());
}

/** Returns a function running one model step on `step` samples, after loading the model on the main thread. */
async function loadStep(engine: EngineId): Promise<(input: Float32Array) => void> {
  if (engine === "dtln") {
    // Single-threaded, as in the worklet (the dev server is cross-origin isolated, which would enable threads)
    const module = await createNoiseSuppressionModule({ threads: false });
    await module.ready;
    const denoiser = module.dtln_create();
    const output = new Float32Array(ENGINES.dtln.stepSamples);
    return (input) => module.dtln_denoise(denoiser, input, output);
  }
  await initDeepFilterNet({ module_or_path: defaultDeepFilterNetWasmUrl });
  const state = df_create(await fetchModel(defaultDeepFilterNetModelUrl), 25);
  return (input) => df_process_frame(state, input);
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))] ?? 0;
}

/** Times every model step on `seconds` of real noisy speech (restaurant clip), after a 2 s warm-up. */
export async function measureSpeed(engine: EngineId, seconds = 20): Promise<SpeedResult> {
  const { sampleRate, stepSamples, deadlineMs } = ENGINES[engine];
  const input = await decodeClip(restaurantClipUrl, sampleRate, seconds + 2);
  const loadStart = performance.now();
  const step = await loadStep(engine);
  const loadMs = performance.now() - loadStart;
  const warmupSteps = Math.round((2 * sampleRate) / stepSamples);
  const times: number[] = [];
  for (let offset = 0; offset + stepSamples <= input.length; offset += stepSamples) {
    const start = performance.now();
    step(input.subarray(offset, offset + stepSamples));
    const elapsed = performance.now() - start;
    if (offset >= warmupSteps * stepSamples) {
      times.push(elapsed);
    }
  }
  times.sort((a, b) => a - b);
  const meanMs = times.reduce((sum, value) => sum + value, 0) / times.length;
  return {
    engine,
    loadMs,
    steps: times.length,
    meanMs,
    p95Ms: percentile(times, 0.95),
    maxMs: times[times.length - 1] ?? 0,
    deadlineMs,
    cpuShare: meanMs / ((stepSamples / sampleRate) * 1000),
  };
}

/** What `renderThroughWorklet` can run: each engine with its defaults, and DeepFilterNet3 with its gate retuned. */
export const RENDER_CONFIGS = {
  dtln: { engine: "dtln" },
  deepfilternet: { engine: "deepfilternet" },
  "deepfilternet-gate-off": { engine: "deepfilternet", options: { pauseAttenuationDb: 25 } },
  "deepfilternet-lookahead-1": { engine: "deepfilternet", options: { pauseGateLookaheadFrames: 1 } },
} satisfies Record<string, { engine: EngineId; options?: DeepFilterNetAudioWorkletOptions }>;
export type RenderConfigId = keyof typeof RENDER_CONFIGS;

export interface RenderResult {
  output: Float32Array;
  sampleRate: number;
  /** Time to `ready` of the shipped AudioWorklet node. */
  readyMs: number;
  /** Rendering time / audio duration, through the shipped AudioWorklet in an OfflineAudioContext. */
  realTimeFactor: number;
}

/** Runs `input` through the engine's shipped AudioWorklet, with the options of `configId`. */
export async function renderThroughWorklet(
  configId: RenderConfigId,
  input: Float32Array,
  inputSampleRate: number
): Promise<RenderResult> {
  const config: { engine: EngineId; options?: DeepFilterNetAudioWorkletOptions } = RENDER_CONFIGS[configId];
  const { engine } = config;
  const { sampleRate } = ENGINES[engine];
  // One extra second flushes the engine's delay
  const length = Math.ceil((input.length / inputSampleRate) * sampleRate) + sampleRate;
  const context = new OfflineAudioContext(1, length, sampleRate);
  const readyStart = performance.now();
  const handle =
    engine === "dtln"
      ? await createNoiseSuppressionAudioWorklet(context, { bypassUntilReady: false })
      : await createDeepFilterNetAudioWorklet(context, {
          ...config.options,
          bypassUntilReady: false,
          maxLoad: 0,
        });
  await handle.ready;
  const readyMs = performance.now() - readyStart;
  const buffer = new AudioBuffer({ length: input.length, sampleRate: inputSampleRate, numberOfChannels: 1 });
  buffer.getChannelData(0).set(input);
  const source = new AudioBufferSourceNode(context, { buffer });
  source.connect(handle.node).connect(context.destination);
  source.start();
  const renderStart = performance.now();
  const output = (await context.startRendering()).getChannelData(0);
  const realTimeFactor = (performance.now() - renderStart) / ((length / sampleRate) * 1000);
  handle.dispose();
  return { output, sampleRate, readyMs, realTimeFactor };
}

declare global {
  interface Window {
    engineBenchmark: {
      ENGINES: typeof ENGINES;
      RENDER_CONFIGS: typeof RENDER_CONFIGS;
      measureSpeed: typeof measureSpeed;
      renderThroughWorklet: typeof renderThroughWorklet;
    };
  }
}
window.engineBenchmark = { ENGINES, RENDER_CONFIGS, measureSpeed, renderThroughWorklet };

// Page UI: three rounds, engines alternated, median of the rounds per engine
const ROUNDS = 3;
const status = document.querySelector<HTMLElement>("#status");
const table = document.querySelector<HTMLTableSectionElement>("#results tbody");
const json = document.querySelector<HTMLTextAreaElement>("#json");
const runButton = document.querySelector<HTMLButtonElement>("#run");

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function runAll(): Promise<void> {
  if (!status || !table || !json || !runButton) {
    return;
  }
  runButton.disabled = true;
  table.replaceChildren();
  const rounds: SpeedResult[] = [];
  const engines = Object.keys(ENGINES) as EngineId[];
  for (let round = 1; round <= ROUNDS; round++) {
    for (const engine of engines) {
      status.textContent = `Round ${round}/${ROUNDS}: ${ENGINES[engine].label}…`;
      rounds.push(await measureSpeed(engine));
    }
  }
  const summary = engines.map((engine) => {
    const runs = rounds.filter((result) => result.engine === engine);
    const pick = (key: "meanMs" | "p95Ms" | "maxMs" | "cpuShare") => median(runs.map((run) => run[key]));
    return {
      engine,
      // Later rounds reuse what the first one loaded: only the first load is a cold one
      loadMs: runs[0]?.loadMs ?? 0,
      meanMs: pick("meanMs"),
      p95Ms: pick("p95Ms"),
      maxMs: pick("maxMs"),
      deadlineMs: ENGINES[engine].deadlineMs,
      cpuShare: pick("cpuShare"),
    };
  });
  for (const row of summary) {
    const tr = document.createElement("tr");
    const cells = [
      ENGINES[row.engine].label,
      `${row.loadMs.toFixed(0)} ms`,
      `${row.meanMs.toFixed(2)} ms`,
      `${row.p95Ms.toFixed(2)} ms`,
      `${row.maxMs.toFixed(2)} ms`,
      `${row.deadlineMs.toFixed(2)} ms`,
      `${((row.p95Ms / row.deadlineMs) * 100).toFixed(0)} %`,
      `${(row.cpuShare * 100).toFixed(1)} %`,
    ];
    tr.append(...cells.map((text) => Object.assign(document.createElement("td"), { textContent: text })));
    table.append(tr);
  }
  json.value = JSON.stringify(
    { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, rounds: ROUNDS, summary },
    null,
    2
  );
  status.textContent = "Done. Copy the JSON below to share the result.";
  runButton.disabled = false;
}

runButton?.addEventListener("click", () => {
  runAll().catch((error: unknown) => {
    if (status) {
      status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (runButton) {
      runButton.disabled = false;
    }
  });
});
