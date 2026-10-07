export interface PostGainOptions {
  /** Speech level the gain steers towards, in dBFS (RMS of a 10 ms frame). */
  targetDb: number;
  /** Most the gain may add, for a quiet or distant microphone. */
  maxGainDb: number;
  /** Most the gain may remove, for a hot microphone. */
  minGainDb: number;
  /** Frames quieter than this are not speech and do not move the gain: the residual noise must not be pumped up. */
  speechThresholdDb: number;
  /** How fast the gain follows the speech level. Slow on purpose: a level control, not a compressor. */
  adaptDbPerFrame: number;
  /** Peak ceiling after the gain, as a linear amplitude. */
  ceiling: number;
}

export const DEFAULT_POST_GAIN: PostGainOptions = {
  targetDb: -23,
  maxGainDb: 15,
  minGainDb: -10,
  speechThresholdDb: -45,
  adaptDbPerFrame: 0.05, // 5 dB per second
  ceiling: 0.9,
};

/**
 * Levels the denoised voice, frame by frame, in place of the browser's automatic gain control (which runs before the
 * denoiser and raises the noise along with the voice). The gain only moves on speech frames, and a frame whose peak
 * would exceed the ceiling is scaled down for that frame alone, so nothing clips.
 */
export class PostGain {
  private gainDb = 0;

  constructor(private readonly options: PostGainOptions = DEFAULT_POST_GAIN) {}

  get currentGainDb(): number {
    return this.gainDb;
  }

  process(frame: Float32Array): Float32Array {
    const { targetDb, maxGainDb, minGainDb, speechThresholdDb, adaptDbPerFrame, ceiling } = this.options;
    let energy = 0;
    let peak = 0;
    for (const sample of frame) {
      energy += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const levelDb = 10 * Math.log10(energy / frame.length + 1e-12);

    const fromDb = this.gainDb;
    if (levelDb > speechThresholdDb) {
      const wantedDb = Math.min(maxGainDb, Math.max(minGainDb, targetDb - levelDb));
      const step = Math.max(-adaptDbPerFrame, Math.min(adaptDbPerFrame, wantedDb - this.gainDb));
      this.gainDb += step;
    }

    // Keep the loudest sample of this frame under the ceiling.
    const limit = peak > 0 ? ceiling / peak : Infinity;
    for (let i = 0; i < frame.length; i++) {
      const gain = Math.min(10 ** ((fromDb + ((this.gainDb - fromDb) * i) / frame.length) / 20), limit);
      frame[i]! *= gain;
    }
    return frame;
  }
}
