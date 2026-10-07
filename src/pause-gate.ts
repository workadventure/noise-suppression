export interface PauseGateOptions {
  /** Extra attenuation applied in pauses, on top of the denoiser's own limit. */
  extraAttenuationDb: number;
  /** Output delay in frames, so the gate reopens before a word instead of after its first syllable. */
  lookaheadFrames: number;
  /** Frames the gate stays open after the last speech frame. */
  hangoverFrames: number;
  /** How fast the gate closes once the hangover is over. */
  releaseDbPerFrame: number;
  /** A frame is speech when its level exceeds the residual noise floor by this much... */
  speechAboveFloorDb: number;
  /**
   * ...and when the denoiser kept most of it: at most this much attenuation from its input. A keystroke is loud but
   * the model removes it (down to its limit), so it must not open the gate; speech goes through almost untouched.
   */
  maxSpeechAttenuationDb: number;
}

// The denoised frame lags its input by the model's delay (DeepFilterNet3: about 3 frames), so it is compared with
// the loudest of the recent input frames.
const INPUT_HISTORY_FRAMES = 4;

const DIGITAL_SILENCE_DB = -90;

/**
 * Attenuates the pauses of an already denoised signal, frame by frame.
 *
 * The denoiser runs at a gentle limit so speech keeps no gating artefacts; this gate removes up to
 * `extraAttenuationDb` more in pauses. Speech is detected on the denoised frames, where it stands far above the
 * residual noise whatever the noise type, and which the denoiser kept (so keystrokes and other noise bursts it removes
 * do not count). Output is delayed by `lookaheadFrames`, so the gate ramps open over those
 * frames and is fully open when the first speech frame comes out.
 */
export class PauseGate {
  private readonly queue: Float32Array[] = [];
  private gainDb = 0;
  private hangover = 0;
  private floorDb: number | undefined;
  private readonly inputLevelsDb: number[] = [];

  constructor(private readonly options: PauseGateOptions) {}

  /**
   * Takes one denoised frame and the input frame the denoiser was just given, and returns the gated frame from
   * `lookaheadFrames` earlier (silence at first).
   */
  process(frame: Float32Array, input: Float32Array): Float32Array {
    const {
      extraAttenuationDb,
      lookaheadFrames,
      hangoverFrames,
      releaseDbPerFrame,
      speechAboveFloorDb,
      maxSpeechAttenuationDb,
    } = this.options;

    const levelDb = levelOf(frame);
    this.inputLevelsDb.push(levelOf(input));
    if (this.inputLevelsDb.length > INPUT_HISTORY_FRAMES) {
      this.inputLevelsDb.shift();
    }
    const keptByDenoiser = levelDb - Math.max(...this.inputLevelsDb) > -maxSpeechAttenuationDb;
    // Residual noise floor: follows drops at once, rises 0.1 dB per frame. Digital silence (start-up, muted
    // microphone) is left out: a floor stuck at -120 dB would take seconds to climb back and hold the gate open.
    if (levelDb > DIGITAL_SILENCE_DB) {
      this.floorDb = Math.min(levelDb, (this.floorDb ?? levelDb) + 0.1);
      if (levelDb > this.floorDb + speechAboveFloorDb && keptByDenoiser) {
        this.hangover = lookaheadFrames + hangoverFrames;
      }
    }

    this.queue.push(frame.slice());
    if (this.queue.length <= lookaheadFrames) {
      return new Float32Array(frame.length);
    }
    const delayed = this.queue.shift()!;

    const fromDb = this.gainDb;
    if (this.hangover > 0) {
      this.hangover--;
      this.gainDb = Math.min(0, this.gainDb + extraAttenuationDb / Math.max(1, lookaheadFrames));
    } else {
      this.gainDb = Math.max(-extraAttenuationDb, this.gainDb - releaseDbPerFrame);
    }

    // Interpolate across the frame so gain changes never click.
    for (let i = 0; i < delayed.length; i++) {
      const db = fromDb + ((this.gainDb - fromDb) * i) / delayed.length;
      delayed[i]! *= 10 ** (db / 20);
    }
    return delayed;
  }
}

function levelOf(frame: Float32Array): number {
  let energy = 0;
  for (const sample of frame) {
    energy += sample * sample;
  }
  return 10 * Math.log10(energy / frame.length + 1e-12);
}
