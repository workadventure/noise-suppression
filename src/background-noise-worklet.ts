import backgroundNoiseDetectorAudioWorkletProcessorModuleUrl from "virtual:background-noise-detector-audio-worklet-module-url";
import { DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS } from "./background-noise/detector";
import { BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_DEV_MODULE_URL } from "./background-noise-worklet-dev-module-url";
import {
  BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME,
  type BackgroundNoiseDetectorAudioWorkletErrorMessage,
  type BackgroundNoiseDetectorAudioWorkletFrameDurationMs,
  type BackgroundNoiseDetectorAudioWorkletInboundMessage,
  type BackgroundNoiseDetectorAudioWorkletOutboundMessage,
  type BackgroundNoiseDetectorAudioWorkletProcessorOptions,
  type BackgroundNoiseDetectorAudioWorkletReadyMessage,
  type BackgroundNoiseDetectorAudioWorkletVadMode,
} from "./background-noise-worklet-shared";
import type { BackgroundNoiseDetectedMessage } from "./background-noise/detector";

interface AudioWorkletCapableContext extends BaseAudioContext {
  readonly audioWorklet: AudioWorklet;
}

export interface BackgroundNoiseDetectorAudioWorkletOptions {
  moduleUrl?: string;
  readyTimeoutMs?: number;
  vadMode?: BackgroundNoiseDetectorAudioWorkletVadMode;
  frameDurationMs?: BackgroundNoiseDetectorAudioWorkletFrameDurationMs;
  triggerRms?: number;
  noisyRms?: number;
  analysisWindowMs?: number;
  maxVoiceFrameRatio?: number;
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
const DEFAULT_VAD_MODE: BackgroundNoiseDetectorAudioWorkletVadMode = "aggressive";
const DEFAULT_FRAME_DURATION_MS: BackgroundNoiseDetectorAudioWorkletFrameDurationMs = 30;
const moduleLoadCache = new WeakMap<AudioWorkletCapableContext, Map<string, Promise<void>>>();

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

  await getModuleLoadPromise(context, moduleUrl);

  const processorOptions: BackgroundNoiseDetectorAudioWorkletProcessorOptions = {
    vadMode: options.vadMode ?? DEFAULT_VAD_MODE,
    frameDurationMs: options.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS,
    triggerRms:
      options.triggerRms ?? DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.triggerRms,
    noisyRms: options.noisyRms ?? DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.noisyRms,
    analysisWindowMs:
      options.analysisWindowMs ??
      DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.analysisWindowMs,
    maxVoiceFrameRatio:
      options.maxVoiceFrameRatio ??
      DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.maxVoiceFrameRatio,
    cooldownMs: options.cooldownMs ?? DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS.cooldownMs,
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

  return {
    node,
    ready,
    moduleUrl,
    processorName: BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME,
    dispose(): void {
      const message: BackgroundNoiseDetectorAudioWorkletInboundMessage = {
        type: "dispose",
      };
      node.port.postMessage(message);
      node.disconnect();
    },
  };
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

  handle.node.port.addEventListener("message", handleMessage);
  handle.node.port.start();

  return () => {
    handle.node.port.removeEventListener("message", handleMessage);
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
