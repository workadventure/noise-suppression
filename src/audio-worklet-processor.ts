import { createNoiseSuppressionRuntime, type NoiseSuppressionModule } from "./runtime";
import {
  NOISE_SUPPRESSION_AUDIO_WORKLET_PROCESSOR_NAME,
  type NoiseSuppressionAudioWorkletBenchmarkCompleteMessage,
  type NoiseSuppressionAudioWorkletErrorMessage,
  type NoiseSuppressionAudioWorkletInboundMessage,
  type NoiseSuppressionAudioWorkletProcessorOptions,
  type NoiseSuppressionAudioWorkletProcessingStartedMessage,
  type NoiseSuppressionAudioWorkletReadyMessage,
} from "./audio-worklet-shared";
import liteRtLoaderSource from "../forks/litertjs-core/wasm/litert_wasm_internal.js?raw";

interface BenchmarkState {
  warmupRemaining: number;
  benchmarkRemaining: number;
  timings: number[];
}

function nowMs(): number {
  if (
    typeof globalThis.performance !== "undefined" &&
    typeof globalThis.performance.now === "function"
  ) {
    return globalThis.performance.now();
  }

  return Date.now();
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  );
  return sorted[index] ?? 0;
}

function summarizeTimings(samples: readonly number[]) {
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

class NoiseSuppressionProcessor extends AudioWorkletProcessor {
  private readonly bypassUntilReady: boolean;
  private denoiserModule: NoiseSuppressionModule | null = null;
  private denoiserHandle: number | null = null;
  private initFailed = false;
  private errorReported = false;
  private processedQuanta = 0;
  private processingStartedReported = false;
  private benchmarkState: BenchmarkState | null = null;

  constructor(options: AudioWorkletNodeOptions) {
    super();

    const processorOptions =
      options.processorOptions as NoiseSuppressionAudioWorkletProcessorOptions;

    this.bypassUntilReady = processorOptions.bypassUntilReady;
    this.port.onmessage = (
      event: MessageEvent<NoiseSuppressionAudioWorkletInboundMessage>
    ) => {
      this.handleMessage(event.data);
    };
    void this.initialize(processorOptions);
  }

  override process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const inputChannel = inputs[0]?.[0];
    const outputChannel = outputs[0]?.[0];

    if (!outputChannel) {
      return true;
    }

    if (!inputChannel) {
      outputChannel.fill(0);
      return true;
    }

    if (this.initFailed || this.denoiserModule === null || this.denoiserHandle === null) {
      if (this.bypassUntilReady) {
        outputChannel.set(inputChannel);
      } else {
        outputChannel.fill(0);
      }

      return true;
    }

    try {
      const startMs = nowMs();
      this.denoiserModule.dtln_denoise(
        this.denoiserHandle,
        inputChannel,
        outputChannel
      );
      const elapsedMs = nowMs() - startMs;
      this.processedQuanta++;
      this.recordBenchmarkTiming(elapsedMs, inputChannel.length);

      if (!this.processingStartedReported) {
        this.processingStartedReported = true;
        const message: NoiseSuppressionAudioWorkletProcessingStartedMessage = {
          type: "processing-started",
          processedQuanta: this.processedQuanta,
        };
        this.port.postMessage(message);
      }
    } catch (error) {
      this.initFailed = true;

      if (this.bypassUntilReady) {
        outputChannel.set(inputChannel);
      } else {
        outputChannel.fill(0);
      }

      this.reportError(error);
    }

    return true;
  }

  private async initialize(
    options: NoiseSuppressionAudioWorkletProcessorOptions
  ): Promise<void> {
    try {
      const module = await createNoiseSuppressionRuntime({
        liteRtWasmRoot: "bundled://litert",
        liteRtLoaderSource,
        liteRtWasmBinary: options.liteRtWasmBinary,
        model1Data: options.model1Data,
        model2Data: options.model2Data,
        threads: options.threads,
        numThreads: options.numThreads,
      });

      await module.ready;

      this.denoiserModule = module;
      this.denoiserHandle = module.dtln_create();

      const message: NoiseSuppressionAudioWorkletReadyMessage = {
        type: "ready",
        modelDetails: module.modelDetails,
      };
      this.port.postMessage(message);
    } catch (error) {
      this.initFailed = true;
      this.reportError(error);
    }
  }

  private handleMessage(message: NoiseSuppressionAudioWorkletInboundMessage): void {
    if (message.type === "dispose") {
      this.dispose();
      return;
    }

    if (message.type === "start-benchmark") {
      this.benchmarkState = {
        warmupRemaining: message.warmupIterations,
        benchmarkRemaining: message.benchmarkIterations,
        timings: [],
      };
    }
  }

  private dispose(): void {
    if (this.denoiserModule !== null && this.denoiserHandle !== null) {
      this.denoiserModule.dtln_stop(this.denoiserHandle);
    }

    this.denoiserModule = null;
    this.denoiserHandle = null;
  }

  private reportError(error: unknown): void {
    if (this.errorReported) {
      return;
    }

    this.errorReported = true;
    const message: NoiseSuppressionAudioWorkletErrorMessage = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };

    if (error instanceof Error && error.stack) {
      message.stack = error.stack;
    }

    this.port.postMessage(message);
  }

  private recordBenchmarkTiming(elapsedMs: number, frameSamples: number): void {
    if (this.benchmarkState === null) {
      return;
    }

    if (this.benchmarkState.warmupRemaining > 0) {
      this.benchmarkState.warmupRemaining--;
      return;
    }

    if (this.benchmarkState.benchmarkRemaining <= 0) {
      return;
    }

    this.benchmarkState.timings.push(elapsedMs);
    this.benchmarkState.benchmarkRemaining--;

    if (this.benchmarkState.benchmarkRemaining > 0) {
      return;
    }

    const message: NoiseSuppressionAudioWorkletBenchmarkCompleteMessage = {
      type: "benchmark-complete",
      frameSamples,
      summary: summarizeTimings(this.benchmarkState.timings),
    };

    this.benchmarkState = null;
    this.port.postMessage(message);
  }
}

registerProcessor(
  NOISE_SUPPRESSION_AUDIO_WORKLET_PROCESSOR_NAME,
  NoiseSuppressionProcessor
);
