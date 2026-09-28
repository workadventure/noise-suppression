import type { PauseGateOptions } from "./pause-gate";
import type { PostGainOptions } from "./post-gain";

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
  /** Absent: no level control after the denoiser. */
  postGain: PostGainOptions | undefined;
  /**
   * Share of real time the denoiser may spend, measured over 2 s windows, before the processor reports an overload.
   * 0 disables the check.
   */
  maxLoad: number;
}

export interface DeepFilterNetAudioWorkletReadyMessage {
  type: "ready";
  frameSamples: number;
}

export interface DeepFilterNetAudioWorkletErrorMessage {
  type: "error";
  message: string;
}

/**
 * The denoiser spent more than `maxLoad` of real time for two windows in a row: the machine cannot keep up and the
 * audio will crackle. Sent once; the processor keeps running, what to do is the caller's decision.
 */
export interface DeepFilterNetAudioWorkletOverloadMessage {
  type: "overload";
  /** Share of real time spent in the last window. */
  load: number;
}

export interface DeepFilterNetAudioWorkletDisposeMessage {
  type: "dispose";
}

export type DeepFilterNetAudioWorkletOutboundMessage =
  | DeepFilterNetAudioWorkletReadyMessage
  | DeepFilterNetAudioWorkletErrorMessage
  | DeepFilterNetAudioWorkletOverloadMessage;
