import { MicVAD, type RealTimeVADOptions } from "@ricky0123/vad-web";
import {
  defaultBackgroundNoiseDetectorBaseAssetPath,
  defaultBackgroundNoiseDetectorOnnxWasmBasePath,
} from "virtual:background-noise-detector-silero-assets";
import {
  BackgroundNoiseDetector,
  DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS,
  type BackgroundNoiseDetectorOptions,
} from "./background-noise/detector";
import type { BackgroundNoiseDetectedMessage } from "./background-noise/detector";

export type BackgroundNoiseDetectorSileroModel = "v5" | "legacy";

export interface BackgroundNoiseDetectorRuntimeOptions {
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

export interface BackgroundNoiseDetectorReadyMessage {
  type: "ready";
  sampleRate: number;
  frameSamples: number;
  frameDurationMs: number;
  sileroModel: BackgroundNoiseDetectorSileroModel;
}

export interface BackgroundNoiseDetectorErrorMessage {
  type: "error";
  message: string;
  stack?: string;
}

export type BackgroundNoiseDetectorOutboundMessage =
  | BackgroundNoiseDetectorReadyMessage
  | BackgroundNoiseDetectorErrorMessage
  | BackgroundNoiseDetectedMessage;

export interface BackgroundNoiseDetectorHandle {
  ready: Promise<BackgroundNoiseDetectorReadyMessage>;
  dispose(): void;
}

const DEFAULT_SILERO_MODEL: BackgroundNoiseDetectorSileroModel = "v5";
const SILERO_SAMPLE_RATE = 16000;
const SILERO_FRAME_SAMPLES: Record<BackgroundNoiseDetectorSileroModel, number> = {
  v5: 512,
  legacy: 1536,
};
const handleMessageTargets = new WeakMap<BackgroundNoiseDetectorHandle, EventTarget>();

export async function createBackgroundNoiseDetector(
  context: AudioContext,
  stream: MediaStream,
  options: BackgroundNoiseDetectorRuntimeOptions = {}
): Promise<BackgroundNoiseDetectorHandle> {
  const sileroModel = options.sileroModel ?? DEFAULT_SILERO_MODEL;
  const frameSamples = SILERO_FRAME_SAMPLES[sileroModel];
  const detector = new BackgroundNoiseDetector(createDetectorOptions(options));
  const messageTarget = new EventTarget();
  let disposed = false;

  const vad = await MicVAD.new({
    audioContext: context,
    baseAssetPath:
      options.baseAssetPath ?? defaultBackgroundNoiseDetectorBaseAssetPath,
    onnxWASMBasePath:
      options.onnxWASMBasePath ?? defaultBackgroundNoiseDetectorOnnxWasmBasePath,
    model: sileroModel,
    processorType: options.processorType ?? "AudioWorklet",
    startOnLoad: true,
    getStream: async () => stream,
    pauseStream: async () => undefined,
    resumeStream: async () => stream,
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

  const readyMessage: BackgroundNoiseDetectorReadyMessage = {
    type: "ready",
    sampleRate: SILERO_SAMPLE_RATE,
    frameSamples,
    frameDurationMs: (frameSamples / SILERO_SAMPLE_RATE) * 1000,
    sileroModel,
  };

  const handle: BackgroundNoiseDetectorHandle = {
    ready: Promise.resolve(readyMessage),
    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;
      detector.reset();
      void vad.destroy().catch(() => undefined);
    },
  };

  handleMessageTargets.set(handle, messageTarget);
  return handle;
}

export function observeBackgroundNoiseDetectorMessages(
  handle: BackgroundNoiseDetectorHandle,
  listener: (message: BackgroundNoiseDetectorOutboundMessage) => void
): () => void {
  const messageTarget = handleMessageTargets.get(handle);

  if (!messageTarget) {
    return () => undefined;
  }

  const handleMessage = (event: Event) => {
    listener((event as CustomEvent<BackgroundNoiseDetectorOutboundMessage>).detail);
  };

  messageTarget.addEventListener("message", handleMessage);

  return () => {
    messageTarget.removeEventListener("message", handleMessage);
  };
}

export function isBackgroundNoiseDetectedMessage(
  message: BackgroundNoiseDetectorOutboundMessage
): message is BackgroundNoiseDetectedMessage {
  return message.type === "background-noise-detected";
}

export type { BackgroundNoiseDetectedMessage };

function createDetectorOptions(
  options: BackgroundNoiseDetectorRuntimeOptions
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
  options: BackgroundNoiseDetectorRuntimeOptions
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
  message: BackgroundNoiseDetectorOutboundMessage
): void {
  target.dispatchEvent(new CustomEvent("message", { detail: message }));
}
