import {
  createNoiseSuppressionAudioWorklet,
  runNoiseSuppressionAudioWorkletBenchmark,
  type NoiseSuppressionAudioWorkletBenchmarkCompleteMessage,
  type NoiseSuppressionAudioWorkletOptions,
} from "../src/audio-worklet";

interface BenchmarkCaseResult {
  label: string;
  initMs: number;
  frameSamples: number;
  threads: boolean;
  numThreads: number;
  summary: NoiseSuppressionAudioWorkletBenchmarkCompleteMessage["summary"];
}

interface BenchmarkCaseError {
  label: string;
  error: string;
}

function formatBenchmarkCase(result: BenchmarkCaseResult): string {
  const equivalent512MeanMs = result.summary.meanMs * (512 / result.frameSamples);
  const equivalent512P95Ms = result.summary.p95Ms * (512 / result.frameSamples);

  return [
    result.label,
    `  init: ${result.initMs.toFixed(3)} ms`,
    `  frame samples: ${result.frameSamples}`,
    `  mean dtln_denoise: ${result.summary.meanMs.toFixed(3)} ms`,
    `  p95 dtln_denoise:  ${result.summary.p95Ms.toFixed(3)} ms`,
    `  min dtln_denoise:  ${result.summary.minMs.toFixed(3)} ms`,
    `  max dtln_denoise:  ${result.summary.maxMs.toFixed(3)} ms`,
    `  equivalent 512 mean: ${equivalent512MeanMs.toFixed(3)} ms`,
    `  equivalent 512 p95:  ${equivalent512P95Ms.toFixed(3)} ms`,
    `  threads: ${result.threads ? "enabled" : "disabled"} (${result.numThreads})`,
  ].join("\n");
}

async function runBenchmarkCase(
  label: string,
  options: NoiseSuppressionAudioWorkletOptions
): Promise<BenchmarkCaseResult> {
  const context = new AudioContext({ sampleRate: 16000 });
  const source = new ConstantSourceNode(context, { offset: 0 });
  const sink = new GainNode(context, { gain: 0 });

  source.start();
  await context.resume();

  try {
    const initStart = performance.now();
    const worklet = await createNoiseSuppressionAudioWorklet(context, options);
    const readyMessage = await worklet.ready;
    const initMs = performance.now() - initStart;

    source.connect(worklet.node).connect(sink).connect(context.destination);

    const benchmark = await runNoiseSuppressionAudioWorkletBenchmark(worklet, {
      warmupIterations: 40,
      benchmarkIterations: 300,
    });

    worklet.dispose();

    return {
      label,
      initMs,
      frameSamples: benchmark.frameSamples,
      threads: readyMessage.modelDetails.threads,
      numThreads: readyMessage.modelDetails.numThreads,
      summary: benchmark.summary,
    };
  } finally {
    source.stop();
    await context.close();
  }
}

const status = document.getElementById("status");
const startButton = document.getElementById("start-button");
const summary = document.getElementById("summary");
const details = document.getElementById("details");

if (!(status instanceof HTMLParagraphElement)) {
  throw new Error("Missing #status element");
}

if (!(startButton instanceof HTMLButtonElement)) {
  throw new Error("Missing #start-button element");
}

if (!(summary instanceof HTMLPreElement)) {
  throw new Error("Missing #summary element");
}

if (!(details instanceof HTMLPreElement)) {
  throw new Error("Missing #details element");
}

const statusElement = status;
const startButtonElement = startButton;
const summaryElement = summary;
const detailsElement = details;

async function run(): Promise<void> {
  try {
    startButtonElement.disabled = true;
    const results: BenchmarkCaseResult[] = [];
    const errors: BenchmarkCaseError[] = [];

    statusElement.textContent = "Running single-threaded AudioWorklet benchmark...";
    results.push(
      await runBenchmarkCase("single-threaded worklet", {
        threads: false,
        numThreads: 1,
      })
    );

    if (globalThis.crossOriginIsolated) {
      statusElement.textContent = "Running threaded AudioWorklet benchmark...";
      try {
        results.push(
          await runBenchmarkCase("threaded worklet", {
            threads: true,
            numThreads: 4,
          })
        );
      } catch (error) {
        errors.push({
          label: "threaded worklet",
          error: String(error),
        });
      }
    }

    summaryElement.textContent = results.map(formatBenchmarkCase).join("\n\n");
    detailsElement.textContent = JSON.stringify(
      {
        results,
        errors,
      },
      null,
      2
    );
    statusElement.textContent =
      errors.length === 0
        ? "AudioWorklet benchmark complete."
        : "AudioWorklet benchmark complete with limitations. See details.";
  } catch (error) {
    console.error(error);
    statusElement.textContent = `Benchmark failed: ${String(error)}`;
    startButtonElement.disabled = false;
  }
}

statusElement.textContent = "Ready to benchmark the AudioWorklet path.";
startButtonElement.addEventListener("click", () => {
  void run();
});
