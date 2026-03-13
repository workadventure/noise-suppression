import { loadLiteRt } from "@litertjs/core";

class NoiseSuppressionImportCoreProcessor extends AudioWorkletProcessor {
  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.port.postMessage({
      type: "ready",
      hasLoadLiteRt: typeof loadLiteRt === "function",
      processorOptions: options.processorOptions ?? null,
    });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const inputChannel = inputs[0]?.[0];
    const outputChannel = outputs[0]?.[0];

    if (outputChannel) {
      if (inputChannel) {
        outputChannel.set(inputChannel);
      } else {
        outputChannel.fill(0);
      }
    }

    return true;
  }
}

registerProcessor(
  "noise-suppression-import-core",
  NoiseSuppressionImportCoreProcessor
);
