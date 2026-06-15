import { MicVAD, type RealTimeVADOptions } from "@ricky0123/vad-web";
import backgroundNoiseDetectorAudioWorkletProcessorModuleUrl from "virtual:background-noise-detector-audio-worklet-module-url";
import {
  defaultBackgroundNoiseDetectorBaseAssetPath,
  defaultBackgroundNoiseDetectorOnnxWasmBasePath,
} from "virtual:background-noise-detector-silero-assets";
import {
  BackgroundNoiseDetector,
  DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS,
  type BackgroundNoiseDetectorOptions,
} from "./background-noise/detector";
import { BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_DEV_MODULE_URL } from "./background-noise-worklet-dev-module-url";
import {
  BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME,
  type BackgroundNoiseDetectorAudioWorkletErrorMessage,
  type BackgroundNoiseDetectorAudioWorkletInboundMessage,
  type BackgroundNoiseDetectorAudioWorkletOutboundMessage,
  type BackgroundNoiseDetectorAudioWorkletProcessorOptions,
  type BackgroundNoiseDetectorAudioWorkletReadyMessage,
  type BackgroundNoiseDetectorSileroModel,
} from "./background-noise-worklet-shared";
import type { BackgroundNoiseDetectedMessage } from "./background-noise/detector";

interface AudioWorkletCapableContext extends AudioContext {
  readonly audioWorklet: AudioWorklet;
}

export interface BackgroundNoiseDetectorAudioWorkletOptions {
  moduleUrl?: string;
  readyTimeoutMs?: number;
  sileroModel?: BackgroundNoiseDetectorSileroModel;
  baseAssetPath?: string;
  onnxWASMBasePath?: string;
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  redemptionMs?: number;
  preSpeechPadMs?: number;
  minSpeechMs?: number;
  processorType?: RealTimeVADOptions["processorType"];
  triggerRms?: number;
  noisyRms?: number;
  analysisWindowMs?: number;
  maxSpeechFrameRatio?: number;
  maxVoiceFrameRatio?: number;
  speechProbabilityThreshold?: number;
  maxAverageSpeechProbability?: number;
  cooldownMs?: number;
}

export interface BackgroundNoiseDetectorAudioWorkletHandle {
  node: AudioWorkletNode;
  ready: Promise<BackgroundNoiseDetectorAudioWorkletReadyMessage>;
  moduleUrl: string;
  processorName: string;
  dispose(): void;
}

const DEFAULT_READY_TIMEOUT_MS = 30000;
const DEFAULT_SILERO_MODEL: BackgroundNoiseDetectorSileroModel = "v5";
const SILERO_SAMPLE_RATE = 16000;
const SILERO_FRAME_SAMPLES: Record<BackgroundNoiseDetectorSileroModel, number> = {
  v5: 512,
  legacy: 1536,
};
const moduleLoadCache = new WeakMap<AudioWorkletCapableContext, Map<string, Promise<void>>>();
const handleMessageTargets = new WeakMap<
  BackgroundNoiseDetectorAudioWorkletHandle,
  EventTarget
>();

function getModuleLoadPromise(
  context: AudioWorkletCapableContext,
  moduleUrl: string
): Promise<void> {
  let contextCache = moduleLoadCache.get(context);
  if (!contextCache) {
    contextCache = new Map<string, Promise<void>>();
    moduleLoadCache.set(context, contextCache);
  }

  const existing = contextCache.get(moduleUrl);
  if (existing) {
    return existing;
  }

  const loading = context.audioWorklet.addModule(moduleUrl);
  contextCache.set(moduleUrl, loading);
  return loading;
}

function isReadyMessage(
  value: BackgroundNoiseDetectorAudioWorkletOutboundMessage
): value is BackgroundNoiseDetectorAudioWorkletReadyMessage {
  return value.type === "ready";
}

function isErrorMessage(
  value: BackgroundNoiseDetectorAudioWorkletOutboundMessage
): value is BackgroundNoiseDetectorAudioWorkletErrorMessage {
  return value.type === "error";
}

function createReadyPromise(
  node: AudioWorkletNode,
  timeoutMs: number
): Promise<BackgroundNoiseDetectorAudioWorkletReadyMessage> {
  return new Promise<BackgroundNoiseDetectorAudioWorkletReadyMessage>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      reject(
        new Error("Timed out waiting for the background noise detector worklet to initialize.")
      );
    }, timeoutMs);

    const handleMessage = (
      event: MessageEvent<BackgroundNoiseDetectorAudioWorkletOutboundMessage>
    ) => {
      const message = event.data;

      if (isReadyMessage(message)) {
        cleanup();
        resolve(message);
        return;
      }

      if (isErrorMessage(message)) {
        cleanup();
        reject(new Error(message.message));
      }
    };

    const handleProcessorError = () => {
      cleanup();
      reject(new Error("The background noise detector AudioWorklet processor failed."));
    };

    const cleanup = () => {
      globalThis.clearTimeout(timeoutId);
      node.port.removeEventListener("message", handleMessage);
      node.removeEventListener("processorerror", handleProcessorError);
    };

    node.port.addEventListener("message", handleMessage);
    node.port.start();
    node.addEventListener("processorerror", handleProcessorError);
  });
}

export async function createBackgroundNoiseDetectorAudioWorklet(
  context: AudioWorkletCapableContext,
  options: BackgroundNoiseDetectorAudioWorkletOptions = {}
): Promise<BackgroundNoiseDetectorAudioWorkletHandle> {
  const moduleUrl = options.moduleUrl ?? backgroundNoiseDetectorAudioWorkletProcessorModuleUrl;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const sileroModel = options.sileroModel ?? DEFAULT_SILERO_MODEL;
  const frameSamples = SILERO_FRAME_SAMPLES[sileroModel];

  await getModuleLoadPromise(context, moduleUrl);

  const processorOptions: BackgroundNoiseDetectorAudioWorkletProcessorOptions = {
    frameSamples,
    frameDurationMs: (frameSamples / SILERO_SAMPLE_RATE) * 1000,
    sileroModel,
  };

  const node = new AudioWorkletNode(
    context,
    BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME,
    {
      channelCount: 1,
      channelCountMode: "explicit",
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions,
    }
  );

  const ready = createReadyPromise(node, readyTimeoutMs);
  const vadInput = context.createMediaStreamDestination();
  const detector = new BackgroundNoiseDetector(createDetectorOptions(options));
  const messageTarget = new EventTarget();
  const forwardProcessorMessage = (
    event: MessageEvent<BackgroundNoiseDetectorAudioWorkletOutboundMessage>
  ) => {
    dispatchMessage(messageTarget, event.data);
  };

  node.port.addEventListener("message", forwardProcessorMessage);
  node.port.start();
  node.connect(vadInput);

  let disposed = false;
  let vad: MicVAD | null = null;

  try {
    vad = await MicVAD.new({
      audioContext: context,
      baseAssetPath:
        options.baseAssetPath ?? defaultBackgroundNoiseDetectorBaseAssetPath,
      onnxWASMBasePath:
        options.onnxWASMBasePath ?? defaultBackgroundNoiseDetectorOnnxWasmBasePath,
      model: sileroModel,
      processorType: options.processorType ?? "AudioWorklet",
      startOnLoad: true,
      getStream: async () => vadInput.stream,
      pauseStream: async () => undefined,
      resumeStream: async () => vadInput.stream,
      onFrameProcessed: (probabilities, frame) => {
        if (disposed) {
          return;
        }

        const result = detector.processFrame(frame, {
          speechProbability: probabilities.isSpeech,
          durationMs: (frame.length / SILERO_SAMPLE_RATE) * 1000,
        });

        if (result.event !== null) {
          dispatchMessage(messageTarget, result.event);
        }
      },
      onSpeechStart: () => undefined,
      onSpeechRealStart: () => undefined,
      onSpeechEnd: () => undefined,
      onVADMisfire: () => undefined,
      ...createOptionalVadOptions(options),
    });

    await ready;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const errorMessage: BackgroundNoiseDetectorAudioWorkletErrorMessage = {
      type: "error",
      message,
    };

    if (stack) {
      errorMessage.stack = stack;
    }

    dispatchMessage(messageTarget, errorMessage);
    node.port.removeEventListener("message", forwardProcessorMessage);
    node.port.postMessage({ type: "dispose" } satisfies BackgroundNoiseDetectorAudioWorkletInboundMessage);
    node.disconnect();
    vadInput.disconnect();
    await vad?.destroy();
    throw error;
  }

  const handle: BackgroundNoiseDetectorAudioWorkletHandle = {
    node,
    ready,
    moduleUrl,
    processorName: BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME,
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      const message: BackgroundNoiseDetectorAudioWorkletInboundMessage = {
        type: "dispose",
      };
      node.port.postMessage(message);
      node.port.removeEventListener("message", forwardProcessorMessage);
      node.disconnect();
      vadInput.disconnect();
      detector.reset();
      void vad?.destroy().catch(() => undefined);
    },
  };

  handleMessageTargets.set(handle, messageTarget);
  return handle;
}

export function observeBackgroundNoiseDetectorAudioWorkletMessages(
  handle: BackgroundNoiseDetectorAudioWorkletHandle,
  listener: (message: BackgroundNoiseDetectorAudioWorkletOutboundMessage) => void
): () => void {
  const handleMessage = (
    event: MessageEvent<BackgroundNoiseDetectorAudioWorkletOutboundMessage>
  ) => {
    listener(event.data);
  };
  const messageTarget = handleMessageTargets.get(handle);

  if (messageTarget) {
    messageTarget.addEventListener("message", handleMessage as EventListener);
  } else {
    handle.node.port.addEventListener("message", handleMessage);
    handle.node.port.start();
  }

  return () => {
    if (messageTarget) {
      messageTarget.removeEventListener("message", handleMessage as EventListener);
    } else {
      handle.node.port.removeEventListener("message", handleMessage);
    }
  };
}

export function isBackgroundNoiseDetectedMessage(
  message: BackgroundNoiseDetectorAudioWorkletOutboundMessage
): message is BackgroundNoiseDetectedMessage {
  return message.type === "background-noise-detected";
}

export type {
  BackgroundNoiseDetectedMessage,
  BackgroundNoiseDetectorAudioWorkletErrorMessage,
  BackgroundNoiseDetectorAudioWorkletOutboundMessage,
  BackgroundNoiseDetectorAudioWorkletReadyMessage,
} from "./background-noise-worklet-shared";

export { BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME };
export { BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_DEV_MODULE_URL };

function createDetectorOptions(
  options: BackgroundNoiseDetectorAudioWorkletOptions
): BackgroundNoiseDetectorOptions {
  const detectorOptions: BackgroundNoiseDetectorOptions = {
    triggerRms:
      options.triggerRms ?? DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.triggerRms,
    noisyRms: options.noisyRms ?? DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.noisyRms,
    analysisWindowMs:
      options.analysisWindowMs ??
      DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.analysisWindowMs,
    maxSpeechFrameRatio:
      options.maxSpeechFrameRatio ??
      options.maxVoiceFrameRatio ??
      DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.maxSpeechFrameRatio,
    speechProbabilityThreshold:
      options.speechProbabilityThreshold ??
      options.positiveSpeechThreshold ??
      DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.speechProbabilityThreshold,
    maxAverageSpeechProbability:
      options.maxAverageSpeechProbability ??
      DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.maxAverageSpeechProbability,
    cooldownMs: options.cooldownMs ?? DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.cooldownMs,
  };

  return detectorOptions;
}

function createOptionalVadOptions(
  options: BackgroundNoiseDetectorAudioWorkletOptions
): Partial<RealTimeVADOptions> {
  const vadOptions: Partial<RealTimeVADOptions> = {};

  if (options.positiveSpeechThreshold !== undefined) {
    vadOptions.positiveSpeechThreshold = options.positiveSpeechThreshold;
  }

  if (options.negativeSpeechThreshold !== undefined) {
    vadOptions.negativeSpeechThreshold = options.negativeSpeechThreshold;
  }

  if (options.redemptionMs !== undefined) {
    vadOptions.redemptionMs = options.redemptionMs;
  }

  if (options.preSpeechPadMs !== undefined) {
    vadOptions.preSpeechPadMs = options.preSpeechPadMs;
  }

  if (options.minSpeechMs !== undefined) {
    vadOptions.minSpeechMs = options.minSpeechMs;
  }

  return vadOptions;
}

function dispatchMessage(
  target: EventTarget,
  message: BackgroundNoiseDetectorAudioWorkletOutboundMessage
): void {
  target.dispatchEvent(new MessageEvent("message", { data: message }));
}
