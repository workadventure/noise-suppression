import type { PauseGateOptions } from "./pause-gate";

export const DEEPFILTERNET_AUDIO_WORKLET_PROCESSOR_NAME = "workadventure-deepfilternet";

/** DeepFilterNet3 runs at 48 kHz only. */
export const DEEPFILTERNET_SAMPLE_RATE = 48000;

export interface DeepFilterNetAudioWorkletProcessorOptions {
  wasmModule: WebAssembly.Module;
  modelBytes: ArrayBuffer;
  speechAttenuationDb: number;
  /** Absent: no pause gate, DeepFilterNet3 stays at `speechAttenuationDb`. */
  pauseGate: PauseGateOptions | undefined;
  bypassUntilReady: boolean;
}

export interface DeepFilterNetAudioWorkletReadyMessage {
  type: "ready";
  frameSamples: number;
}

export interface DeepFilterNetAudioWorkletErrorMessage {
  type: "error";
  message: string;
}

export interface DeepFilterNetAudioWorkletDisposeMessage {
  type: "dispose";
}

export type DeepFilterNetAudioWorkletOutboundMessage =
  | DeepFilterNetAudioWorkletReadyMessage
  | DeepFilterNetAudioWorkletErrorMessage;
