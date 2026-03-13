import FFT from "fft.js";

class NoiseSuppressionImportFftProcessor extends AudioWorkletProcessor {
  constructor(options: AudioWorkletNodeOptions) {
    super();
    const fft = new FFT(512);

    this.port.postMessage({
      type: "ready",
      hasFft: typeof fft.realTransform === "function",
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

registerProcessor("noise-suppression-import-fft", NoiseSuppressionImportFftProcessor);
