import createNoiseSuppressionModule, {
  type NoiseSuppressionModelDetails,
  type NoiseSuppressionModuleOptions,
  type NoiseSuppressionProfile,
} from "../src/index";

export interface TimingSummary {
  count: number;
  totalMs: number;
  meanMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

export interface BenchmarkResult {
  label: string;
  initMs: number;
  timings: TimingSummary;
  output: Float32Array;
  profile: NoiseSuppressionProfile | null;
  modelDetails: NoiseSuppressionModelDetails;
}

export interface BenchmarkOptions {
  label?: string;
  warmupIterations?: number;
  benchmarkIterations?: number;
  moduleOptions?: NoiseSuppressionModuleOptions;
  input?: Float32Array;
}

export function seededNoise(length: number, seed = 123456789): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (1664525 * state + 1013904223) >>> 0;
    out[i] = (state / 0xffffffff) * 2 - 1;
  }
  return out;
}

export function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  );
  return sorted[index] ?? 0;
}

export function summarizeTimings(samples: readonly number[]): TimingSummary {
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  return {
    count: samples.length,
    totalMs,
    meanMs: totalMs / samples.length,
    p95Ms: percentile(samples, 0.95),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
  };
}

export function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs(a[i]! - b[i]!));
  }
  return max;
}

export async function benchmarkNoiseSuppression(
  options: BenchmarkOptions = {}
): Promise<BenchmarkResult> {
  const warmupIterations = options.warmupIterations ?? 40;
  const benchmarkIterations = options.benchmarkIterations ?? 300;
  const moduleOptions = options.moduleOptions ?? {};
  const input = options.input ?? seededNoise(512);

  const initStart = performance.now();
  const module = await createNoiseSuppressionModule(moduleOptions);
  await module.ready;
  const initMs = performance.now() - initStart;

  const handle = module.dtln_create();
  const output = new Float32Array(input.length);

  for (let i = 0; i < warmupIterations; i++) {
    module.dtln_denoise(handle, input, output);
  }

  const timings: number[] = [];
  for (let i = 0; i < benchmarkIterations; i++) {
    const start = performance.now();
    module.dtln_denoise(handle, input, output);
    timings.push(performance.now() - start);
  }

  const profile = moduleOptions.enableProfiling === true ? module.get_profile(handle) : null;

  module.dtln_stop(handle);

  return {
    label: options.label ?? "benchmark",
    initMs,
    timings: summarizeTimings(timings),
    output: new Float32Array(output),
    profile,
    modelDetails: module.modelDetails,
  };
}

export function formatProfileSummary(profile: NoiseSuppressionProfile): string {
  const stages = Object.entries(profile.stages)
    .filter(([name]) => !name.endsWith("_total"))
    .sort((a, b) => b[1].totalMs - a[1].totalMs);

  return [
    `denoise calls: ${profile.denoiseCalls}`,
    `infer calls: ${profile.inferCalls}`,
    `mean dtln_denoise: ${profile.stages.denoise_total.meanMs.toFixed(3)} ms`,
    `p95 dtln_denoise: ${profile.stages.denoise_total.p95Ms.toFixed(3)} ms`,
    `mean infer: ${profile.stages.infer_total.meanMs.toFixed(3)} ms`,
    "",
    ...stages.map(
      ([name, stage]) =>
        `${name.padEnd(14)} mean=${stage.meanMs.toFixed(3)} ms  ` +
        `p95=${stage.p95Ms.toFixed(3)} ms  ` +
        `share=${(stage.inferShare * 100).toFixed(1)}%`
    ),
  ].join("\n");
}

export function formatTimingSummary(result: BenchmarkResult): string {
  return [
    `${result.label}`,
    `  init: ${result.initMs.toFixed(3)} ms`,
    `  mean: ${result.timings.meanMs.toFixed(3)} ms`,
    `  p95:  ${result.timings.p95Ms.toFixed(3)} ms`,
    `  min:  ${result.timings.minMs.toFixed(3)} ms`,
    `  max:  ${result.timings.maxMs.toFixed(3)} ms`,
  ].join("\n");
}
