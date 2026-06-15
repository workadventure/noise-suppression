import "./audio-worklet-global-scope-shim";
import {
  BackgroundNoiseDetector,
  type BackgroundNoiseDetectorOptions,
} from "./background-noise/detector";
import {
  createLibFvadVad,
  getLibFvadFrameSamples,
  type LibFvadMode,
  type LibFvadVad,
} from "./background-noise/libfvad";
import {
  BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME,
  type BackgroundNoiseDetectorAudioWorkletErrorMessage,
  type BackgroundNoiseDetectorAudioWorkletFrameDurationMs,
  type BackgroundNoiseDetectorAudioWorkletInboundMessage,
  type BackgroundNoiseDetectorAudioWorkletProcessorOptions,
  type BackgroundNoiseDetectorAudioWorkletReadyMessage,
  type BackgroundNoiseDetectorAudioWorkletVadMode,
} from "./background-noise-worklet-shared";

interface ResolvedProcessorOptions {
  vadMode: BackgroundNoiseDetectorAudioWorkletVadMode;
  frameDurationMs: BackgroundNoiseDetectorAudioWorkletFrameDurationMs;
  detector: BackgroundNoiseDetectorOptions;
}

class Float32RingBuffer {
  private readonly storage: Float32Array;
  private readIndex = 0;
  private writeIndex = 0;
  private availableSamples = 0;

  constructor(size: number) {
    this.storage = new Float32Array(size);
  }

  availableRead(): number {
    return this.availableSamples;
  }

  availableWrite(): number {
    return this.storage.length - this.availableSamples;
  }

  push(source: Float32Array): void {
    if (source.length > this.availableWrite()) {
      throw new Error("Background noise detector ring buffer overflow.");
    }

    let remaining = source.length;
    let sourceOffset = 0;

    while (remaining > 0) {
      const chunk = Math.min(remaining, this.storage.length - this.writeIndex);
      this.storage.set(source.subarray(sourceOffset, sourceOffset + chunk), this.writeIndex);
      this.writeIndex = (this.writeIndex + chunk) % this.storage.length;
      this.availableSamples += chunk;
      remaining -= chunk;
      sourceOffset += chunk;
    }
  }

  pullInto(target: Float32Array): boolean {
    if (target.length > this.availableSamples) {
      return false;
    }

    let remaining = target.length;
    let targetOffset = 0;

    while (remaining > 0) {
      const chunk = Math.min(remaining, this.storage.length - this.readIndex);
      target.set(this.storage.subarray(this.readIndex, this.readIndex + chunk), targetOffset);
      this.readIndex = (this.readIndex + chunk) % this.storage.length;
      this.availableSamples -= chunk;
      remaining -= chunk;
      targetOffset += chunk;
    }

    return true;
  }

  clear(): void {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableSamples = 0;
  }
}

const DEFAULT_VAD_MODE: BackgroundNoiseDetectorAudioWorkletVadMode = "aggressive";
const DEFAULT_FRAME_DURATION_MS: BackgroundNoiseDetectorAudioWorkletFrameDurationMs = 30;

class BackgroundNoiseDetectorProcessor extends AudioWorkletProcessor {
  private vad: LibFvadVad | null = null;
  private detector: BackgroundNoiseDetector | null = null;
  private inputRing: Float32RingBuffer | null = null;
  private vadFrame: Float32Array | null = null;
  private frameDurationMs = DEFAULT_FRAME_DURATION_MS;
  private initFailed = false;
  private errorReported = false;
  private disposed = false;

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

    void this.initialize(processorOptions ?? {});
  }

  override process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const inputChannel = input[0];

    copyInputToOutput(input, output);

    if (!inputChannel) {
      fillOutputWithSilence(output);
      return true;
    }

    if (this.disposed || this.initFailed || this.vad === null || this.detector === null) {
      return true;
    }

    try {
      this.processInputChannel(inputChannel);
    } catch (error) {
      this.initFailed = true;
      this.reportError(error);
    }

    return true;
  }

  private async initialize(
    options: BackgroundNoiseDetectorAudioWorkletProcessorOptions
  ): Promise<void> {
    try {
      const resolvedOptions = resolveProcessorOptions(options);
      const frameSamples = getLibFvadFrameSamples(sampleRate, resolvedOptions.frameDurationMs);
      const detector = new BackgroundNoiseDetector(resolvedOptions.detector);
      const vad = await createLibFvadVad({
        sampleRate,
        mode: toLibFvadMode(resolvedOptions.vadMode),
        frameDurationMs: resolvedOptions.frameDurationMs,
      });

      if (this.disposed) {
        vad.destroy();
        detector.reset();
        return;
      }

      this.frameDurationMs = resolvedOptions.frameDurationMs;
      this.detector = detector;
      this.vad = vad;
      this.vadFrame = new Float32Array(frameSamples);
      this.inputRing = new Float32RingBuffer(Math.max(frameSamples * 2, 4096));

      const message: BackgroundNoiseDetectorAudioWorkletReadyMessage = {
        type: "ready",
        sampleRate,
        frameSamples,
      };
      this.port.postMessage(message);
    } catch (error) {
      this.initFailed = true;
      this.reportError(error);
    }
  }

  private handleMessage(message: BackgroundNoiseDetectorAudioWorkletInboundMessage): void {
    if (message.type === "dispose") {
      this.dispose();
    }
  }

  private dispose(): void {
    this.disposed = true;
    this.vad?.destroy();
    this.vad = null;
    this.detector?.reset();
    this.detector = null;
    this.inputRing?.clear();
    this.inputRing = null;
    this.vadFrame = null;
  }

  private processInputChannel(inputChannel: Float32Array): void {
    const inputRing = this.inputRing;
    const vadFrame = this.vadFrame;
    const vad = this.vad;
    const detector = this.detector;

    if (inputRing === null || vadFrame === null || vad === null || detector === null) {
      return;
    }

    inputRing.push(inputChannel);

    while (inputRing.availableRead() >= vadFrame.length) {
      if (!inputRing.pullInto(vadFrame)) {
        break;
      }

      const result = detector.processFrame(vadFrame, {
        isVoice: vad.processFrame(vadFrame),
        durationMs: this.frameDurationMs,
      });

      if (result.event !== null && !this.disposed) {
        this.port.postMessage(result.event);
      }
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

function resolveProcessorOptions(
  options: BackgroundNoiseDetectorAudioWorkletProcessorOptions
): ResolvedProcessorOptions {
  const detectorOptions: BackgroundNoiseDetectorOptions = {};

  if (options.triggerRms !== undefined) {
    detectorOptions.triggerRms = options.triggerRms;
  }

  if (options.noisyRms !== undefined) {
    detectorOptions.noisyRms = options.noisyRms;
  }

  if (options.analysisWindowMs !== undefined) {
    detectorOptions.analysisWindowMs = options.analysisWindowMs;
  }

  if (options.maxVoiceFrameRatio !== undefined) {
    detectorOptions.maxVoiceFrameRatio = options.maxVoiceFrameRatio;
  }

  if (options.cooldownMs !== undefined) {
    detectorOptions.cooldownMs = options.cooldownMs;
  }

  return {
    vadMode: options.vadMode ?? DEFAULT_VAD_MODE,
    frameDurationMs: options.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS,
    detector: detectorOptions,
  };
}

function toLibFvadMode(mode: BackgroundNoiseDetectorAudioWorkletVadMode): LibFvadMode {
  return mode === "normal" ? "quality" : mode;
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

function fillOutputWithSilence(output: Float32Array[]): void {
  for (const outputChannel of output) {
    outputChannel.fill(0);
  }
}

registerProcessor(
  BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME,
  BackgroundNoiseDetectorProcessor
);
