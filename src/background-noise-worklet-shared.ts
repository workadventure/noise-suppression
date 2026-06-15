import type { BackgroundNoiseDetectedMessage } from "./background-noise/detector";

export type { BackgroundNoiseDetectedMessage } from "./background-noise/detector";

export const BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME =
  "workadventure-background-noise-detector";

export type BackgroundNoiseDetectorSileroModel = "v5" | "legacy";

export interface BackgroundNoiseDetectorAudioWorkletProcessorOptions {
  frameSamples?: number;
  frameDurationMs?: number;
  sileroModel?: BackgroundNoiseDetectorSileroModel;
}

export interface BackgroundNoiseDetectorAudioWorkletReadyMessage {
  type: "ready";
  sampleRate: number;
  frameSamples: number;
  frameDurationMs: number;
  sileroModel: BackgroundNoiseDetectorSileroModel;
}

export interface BackgroundNoiseDetectorAudioWorkletErrorMessage {
  type: "error";
  message: string;
  stack?: string;
}

export interface BackgroundNoiseDetectorAudioWorkletDisposeMessage {
  type: "dispose";
}

export type BackgroundNoiseDetectorAudioWorkletInboundMessage =
  BackgroundNoiseDetectorAudioWorkletDisposeMessage;

export type BackgroundNoiseDetectorAudioWorkletOutboundMessage =
  | BackgroundNoiseDetectorAudioWorkletReadyMessage
  | BackgroundNoiseDetectorAudioWorkletErrorMessage
  | BackgroundNoiseDetectedMessage;
