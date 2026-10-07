import "./audio-worklet-global-scope-shim";
import {
  initSync,
  df_create,
  df_get_frame_length,
  df_process_frame,
} from "../forks/deepfilternet/df.js";
import { Float32RingBuffer } from "./float32-ring-buffer";
import { PauseGate } from "./pause-gate";
import {
  DEEPFILTERNET_AUDIO_WORKLET_PROCESSOR_NAME,
  DEEPFILTERNET_SAMPLE_RATE,
  type DeepFilterNetAudioWorkletDisposeMessage,
  type DeepFilterNetAudioWorkletErrorMessage,
  type DeepFilterNetAudioWorkletProcessorOptions,
  type DeepFilterNetAudioWorkletReadyMessage,
} from "./deepfilternet-shared";

const RING_BUFFER_CAPACITY = 4096;

class DeepFilterNetProcessor extends AudioWorkletProcessor {
  private readonly bypassUntilReady: boolean;
  private state: number | undefined;
  private frameSamples = 0;
  private frame = new Float32Array(0);
  private pauseGate: PauseGate | undefined;
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
        const denoised = df_process_frame(this.state, this.frame);
        this.outputRing.push(this.pauseGate ? this.pauseGate.process(denoised, this.frame) : denoised);
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
