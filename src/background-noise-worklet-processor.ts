import "./audio-worklet-global-scope-shim";
import {
  BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME,
  type BackgroundNoiseDetectorAudioWorkletErrorMessage,
  type BackgroundNoiseDetectorAudioWorkletInboundMessage,
  type BackgroundNoiseDetectorAudioWorkletProcessorOptions,
  type BackgroundNoiseDetectorAudioWorkletReadyMessage,
  type BackgroundNoiseDetectorSileroModel,
} from "./background-noise-worklet-shared";

const DEFAULT_SILERO_MODEL: BackgroundNoiseDetectorSileroModel = "v5";
const DEFAULT_FRAME_SAMPLES = 512;
const SILERO_SAMPLE_RATE = 16000;

class BackgroundNoiseDetectorProcessor extends AudioWorkletProcessor {
  private disposed = false;
  private errorReported = false;

  constructor(options: AudioWorkletNodeOptions) {
    super();

    const processorOptions =
      options.processorOptions as
        | BackgroundNoiseDetectorAudioWorkletProcessorOptions
        | undefined;

    this.port.onmessage = (
      event: MessageEvent<BackgroundNoiseDetectorAudioWorkletInboundMessage>
    ) => {
      this.handleMessage(event.data);
    };

    this.postReady(processorOptions ?? {});
  }

  override process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];

    try {
      copyInputToOutput(input, output);
    } catch (error) {
      this.reportError(error);
    }

    return !this.disposed;
  }

  private postReady(options: BackgroundNoiseDetectorAudioWorkletProcessorOptions): void {
    const frameSamples = options.frameSamples ?? DEFAULT_FRAME_SAMPLES;
    const message: BackgroundNoiseDetectorAudioWorkletReadyMessage = {
      type: "ready",
      sampleRate,
      frameSamples,
      frameDurationMs: (frameSamples / SILERO_SAMPLE_RATE) * 1000,
      sileroModel: options.sileroModel ?? DEFAULT_SILERO_MODEL,
    };

    this.port.postMessage(message);
  }

  private handleMessage(message: BackgroundNoiseDetectorAudioWorkletInboundMessage): void {
    if (message.type === "dispose") {
      this.disposed = true;
    }
  }

  private reportError(error: unknown): void {
    if (this.errorReported || this.disposed) {
      return;
    }

    this.errorReported = true;
    const message: BackgroundNoiseDetectorAudioWorkletErrorMessage = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };

    if (error instanceof Error && error.stack) {
      message.stack = error.stack;
    }

    this.port.postMessage(message);
  }
}

function copyInputToOutput(input: Float32Array[], output: Float32Array[]): void {
  for (let channelIndex = 0; channelIndex < output.length; channelIndex++) {
    const outputChannel = output[channelIndex];
    if (!outputChannel) {
      continue;
    }

    const inputChannel = input[channelIndex];
    if (!inputChannel) {
      outputChannel.fill(0);
      continue;
    }

    if (inputChannel.length >= outputChannel.length) {
      outputChannel.set(inputChannel.subarray(0, outputChannel.length));
      continue;
    }

    outputChannel.set(inputChannel);
    outputChannel.fill(0, inputChannel.length);
  }
}

registerProcessor(
  BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME,
  BackgroundNoiseDetectorProcessor
);
