// Averages the first input channel down to 16 kHz and posts 512-sample frames to the main thread, where Silero runs.
// The averaging is the one @ricky0123/vad-web used, which the detector thresholds were tuned against.
const TARGET_SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 512;

class BackgroundNoiseCaptureProcessor extends AudioWorkletProcessor {
  private readonly inputSamplesPerOutputSample = sampleRate / TARGET_SAMPLE_RATE;
  private pending: number[] = [];
  private stopped = false;

  constructor() {
    super();
    this.port.onmessage = () => {
      this.stopped = true;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (const sample of channel) {
        this.pending.push(sample);
      }
      while (this.pending.length >= FRAME_SAMPLES * this.inputSamplesPerOutputSample) {
        const frame = this.nextFrame();
        this.port.postMessage(frame, [frame.buffer]);
      }
    }
    return !this.stopped;
  }

  private nextFrame(): Float32Array {
    const frame = new Float32Array(FRAME_SAMPLES);
    let inputIndex = 0;
    for (let outputIndex = 0; outputIndex < FRAME_SAMPLES; outputIndex++) {
      const end = Math.min(this.pending.length, (outputIndex + 1) * this.inputSamplesPerOutputSample);
      let sum = 0;
      let count = 0;
      for (; inputIndex < end; inputIndex++) {
        sum += this.pending[inputIndex] ?? 0;
        count++;
      }
      frame[outputIndex] = sum / count;
    }
    this.pending = this.pending.slice(inputIndex);
    return frame;
  }
}

registerProcessor("workadventure-background-noise-capture", BackgroundNoiseCaptureProcessor);
