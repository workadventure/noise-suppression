import type { BackgroundNoiseDetectedMessage } from "./background-noise/detector";

export const BACKGROUND_NOISE_DETECTOR_AUDIO_WORKLET_PROCESSOR_NAME =
  "workadventure-background-noise-detector";

export type BackgroundNoiseDetectorAudioWorkletVadMode =
  | "normal"
  | "low-bitrate"
  | "aggressive"
  | "very-aggressive";

export type BackgroundNoiseDetectorAudioWorkletFrameDurationMs = 10 | 20 | 30;

export interface BackgroundNoiseDetectorAudioWorkletProcessorOptions {
  vadMode?: BackgroundNoiseDetectorAudioWorkletVadMode;
  frameDurationMs?: BackgroundNoiseDetectorAudioWorkletFrameDurationMs;
  triggerRms?: number;
  noisyRms?: number;
  analysisWindowMs?: number;
  maxVoiceFrameRatio?: number;
  cooldownMs?: number;
}

export interface BackgroundNoiseDetectorAudioWorkletReadyMessage {
  type: "ready";
  sampleRate: number;
  frameSamples: number;
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
