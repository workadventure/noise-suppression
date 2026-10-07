import "./audio-worklet-global-scope-shim";
import {
  initSync,
  df_create,
  df_get_frame_length,
  df_process_frame,
} from "../forks/deepfilternet/df.js";
import { Float32RingBuffer } from "./float32-ring-buffer";
import { PauseGate } from "./pause-gate";
import { PostGain } from "./post-gain";
import { LoadMonitor, LoadSampler } from "./load-monitor";
import {
  DEEPFILTERNET_AUDIO_WORKLET_PROCESSOR_NAME,
  DEEPFILTERNET_SAMPLE_RATE,
  type DeepFilterNetAudioWorkletDisposeMessage,
  type DeepFilterNetAudioWorkletErrorMessage,
  type DeepFilterNetAudioWorkletOverloadMessage,
  type DeepFilterNetAudioWorkletLoadReportMessage,
  type DeepFilterNetAudioWorkletProcessorOptions,
  type DeepFilterNetAudioWorkletReadyMessage,
} from "./deepfilternet-shared";

const RING_BUFFER_CAPACITY = 4096;

// performance is missing from some AudioWorkletGlobalScopes; Date.now() is coarser, but a 2 s sum averages it out.
const now: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

class DeepFilterNetProcessor extends AudioWorkletProcessor {
  private readonly bypassUntilReady: boolean;
  private state: number | undefined;
  private frameSamples = 0;
  private frame = new Float32Array(0);
  private pauseGate: PauseGate | undefined;
  private postGain: PostGain | undefined;
  private loadMonitor: LoadMonitor | undefined;
  private loadSampler: LoadSampler | undefined;
  private readonly inputRing = new Float32RingBuffer(RING_BUFFER_CAPACITY);
  private readonly outputRing = new Float32RingBuffer(RING_BUFFER_CAPACITY);

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const processorOptions = options.processorOptions as DeepFilterNetAudioWorkletProcessorOptions;
    this.bypassUntilReady = processorOptions.bypassUntilReady;
    this.port.onmessage = (event: MessageEvent<DeepFilterNetAudioWorkletDisposeMessage>) => {
      if (event.data.type === "dispose") {
        this.state = undefined;
      }
    };

    try {
      if (sampleRate !== DEEPFILTERNET_SAMPLE_RATE) {
        throw new Error(
          `DeepFilterNet3 needs a ${DEEPFILTERNET_SAMPLE_RATE} Hz AudioContext, got ${sampleRate} Hz.`
        );
      }
      initSync(processorOptions.wasmModule);
      this.state = df_create(new Uint8Array(processorOptions.modelBytes), processorOptions.speechAttenuationDb);
      this.frameSamples = df_get_frame_length(this.state);
      this.frame = new Float32Array(this.frameSamples);
      if (processorOptions.pauseGate) {
        this.pauseGate = new PauseGate(processorOptions.pauseGate);
      }
      if (processorOptions.postGain) {
        this.postGain = new PostGain(processorOptions.postGain);
      }
      if (processorOptions.maxLoad > 0) {
        // One window = 200 frames = 2 s of audio.
        this.loadMonitor = new LoadMonitor(200, (this.frameSamples / sampleRate) * 1000, processorOptions.maxLoad);
      }
      if (processorOptions.loadReportAfterMs > 0) {
        this.loadSampler = new LoadSampler(
          200,
          (this.frameSamples / sampleRate) * 1000,
          Math.max(1, Math.round(processorOptions.loadReportAfterMs / 2000))
        );
      }
      const ready: DeepFilterNetAudioWorkletReadyMessage = { type: "ready", frameSamples: this.frameSamples };
      this.port.postMessage(ready);
    } catch (error) {
      this.fail(error);
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) {
      return true;
    }
    if (!input) {
      output.fill(0);
      return true;
    }
    if (this.state === undefined) {
      // Not ready, failed or disposed: same contract as the DTLN worklet.
      if (this.bypassUntilReady) {
        output.set(input.subarray(0, output.length));
      } else {
        output.fill(0);
      }
      return true;
    }

    try {
      this.inputRing.push(input);
      while (this.inputRing.availableRead() >= this.frameSamples) {
        this.inputRing.pullInto(this.frame);
        const startedAt = now();
        const denoised = df_process_frame(this.state, this.frame);
        const gated = this.pauseGate ? this.pauseGate.process(denoised, this.frame) : denoised;
        this.outputRing.push(this.postGain ? this.postGain.process(gated) : gated);
        const elapsedMs = now() - startedAt;
        const overloadLoad = this.loadMonitor?.record(elapsedMs);
        const loadReport = this.loadSampler?.record(elapsedMs);
        if (loadReport) {
          const message: DeepFilterNetAudioWorkletLoadReportMessage = { type: "load-report", ...loadReport };
          this.port.postMessage(message);
        }
        if (overloadLoad !== undefined) {
          const overload: DeepFilterNetAudioWorkletOverloadMessage = { type: "overload", load: overloadLoad };
          this.port.postMessage(overload);
        }
      }
      // Underflow only happens in the first frame (480-sample frames, 128-sample quanta).
      if (!this.outputRing.pullInto(output)) {
        output.fill(0);
      }
    } catch (error) {
      this.fail(error);
      if (this.bypassUntilReady) {
        output.set(input.subarray(0, output.length));
      } else {
        output.fill(0);
      }
    }
    return true;
  }

  private fail(error: unknown): void {
    this.state = undefined;
    const message: DeepFilterNetAudioWorkletErrorMessage = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    this.port.postMessage(message);
  }
}

registerProcessor(DEEPFILTERNET_AUDIO_WORKLET_PROCESSOR_NAME, DeepFilterNetProcessor);
