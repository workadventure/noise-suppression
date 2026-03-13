declare const __NOISE_SUPPRESSION_LITERT_WASM_ROOT__: string;
declare const __NOISE_SUPPRESSION_MODEL1_URL__: string;
declare const __NOISE_SUPPRESSION_MODEL2_URL__: string;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;

  constructor(options?: unknown);

  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;
