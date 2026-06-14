export interface BackgroundNoiseDetectorOptions {
  triggerRms?: number;
  noisyRms?: number;
  analysisWindowMs?: number;
  maxVoiceFrameRatio?: number;
  cooldownMs?: number;
}

export interface ResolvedBackgroundNoiseDetectorOptions {
  triggerRms: number;
  noisyRms: number;
  analysisWindowMs: number;
  maxVoiceFrameRatio: number;
  cooldownMs: number;
}

export interface BackgroundNoiseDetectorFrameInput {
  isVoice: boolean;
  durationMs: number;
  timestampMs?: number;
}

export interface BackgroundNoiseDetectorFrameResult {
  isVoice: boolean;
  rms: number;
  rmsDb: number;
  durationMs: number;
}

export interface BackgroundNoiseDetectedMessage {
  type: "background-noise-detected";
  rms: number;
  rmsDb: number;
  voiceFrameRatio: number;
  activeFrameRatio: number;
  windowMs: number;
  timestampMs: number;
}

export interface BackgroundNoiseDetectorProcessResult {
  frame: BackgroundNoiseDetectorFrameResult;
  event: BackgroundNoiseDetectedMessage | null;
}

interface CandidateWindow {
  totalFrames: number;
  voiceFrames: number;
  activeFrames: number;
  rmsSum: number;
  durationMs: number;
}

export const DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS: ResolvedBackgroundNoiseDetectorOptions = {
  triggerRms: 0.01,
  noisyRms: 0.02,
  analysisWindowMs: 1500,
  maxVoiceFrameRatio: 0.2,
  cooldownMs: 15000,
};

export class BackgroundNoiseDetector {
  readonly options: ResolvedBackgroundNoiseDetectorOptions;

  private candidateWindow: CandidateWindow | null = null;
  private lastEventTimestampMs: number | null = null;
  private elapsedMs = 0;

  constructor(options: BackgroundNoiseDetectorOptions = {}) {
    this.options = resolveBackgroundNoiseDetectorOptions(options);
  }

  processFrame(
    frame: Float32Array,
    input: BackgroundNoiseDetectorFrameInput
  ): BackgroundNoiseDetectorProcessResult {
    const durationMs = input.durationMs;
    const timestampMs = this.resolveTimestampMs(durationMs, input.timestampMs);
    const rms = calculateRms(frame);
    const result: BackgroundNoiseDetectorFrameResult = {
      isVoice: input.isVoice,
      rms,
      rmsDb: rmsToDbfs(rms),
      durationMs,
    };

    if (this.isCoolingDown(timestampMs)) {
      this.candidateWindow = null;
      return { frame: result, event: null };
    }

    if (this.candidateWindow === null) {
      if (result.isVoice || result.rms < this.options.triggerRms) {
        return { frame: result, event: null };
      }

      this.candidateWindow = createCandidateWindow();
    }

    collectCandidateFrame(this.candidateWindow, result, this.options.triggerRms);

    if (this.candidateWindow.durationMs < this.options.analysisWindowMs) {
      return { frame: result, event: null };
    }

    const event = this.evaluateCandidateWindow(this.candidateWindow, timestampMs);
    this.candidateWindow = null;

    if (event !== null) {
      this.lastEventTimestampMs = timestampMs;
    }

    return { frame: result, event };
  }

  reset(): void {
    this.candidateWindow = null;
    this.lastEventTimestampMs = null;
    this.elapsedMs = 0;
  }

  private resolveTimestampMs(durationMs: number, timestampMs: number | undefined): number {
    if (timestampMs !== undefined) {
      this.elapsedMs = timestampMs;
      return this.elapsedMs;
    }

    this.elapsedMs += durationMs;
    return this.elapsedMs;
  }

  private isCoolingDown(timestampMs: number): boolean {
    return (
      this.lastEventTimestampMs !== null &&
      timestampMs - this.lastEventTimestampMs < this.options.cooldownMs
    );
  }

  private evaluateCandidateWindow(
    candidateWindow: CandidateWindow,
    timestampMs: number
  ): BackgroundNoiseDetectedMessage | null {
    const rms = candidateWindow.rmsSum / candidateWindow.totalFrames;
    const voiceFrameRatio = candidateWindow.voiceFrames / candidateWindow.totalFrames;

    if (rms < this.options.noisyRms || voiceFrameRatio > this.options.maxVoiceFrameRatio) {
      return null;
    }

    return {
      type: "background-noise-detected",
      rms,
      rmsDb: rmsToDbfs(rms),
      voiceFrameRatio,
      activeFrameRatio: candidateWindow.activeFrames / candidateWindow.totalFrames,
      windowMs: candidateWindow.durationMs,
      timestampMs,
    };
  }
}

export function resolveBackgroundNoiseDetectorOptions(
  options: BackgroundNoiseDetectorOptions = {}
): ResolvedBackgroundNoiseDetectorOptions {
  const resolved = {
    ...DEFAULT_BACKGROUND_NOISE_DETECTOR_OPTIONS,
    ...options,
  };

  validateNonNegativeFiniteNumber(resolved.triggerRms, "triggerRms");
  validateNonNegativeFiniteNumber(resolved.noisyRms, "noisyRms");
  validatePositiveFiniteNumber(resolved.analysisWindowMs, "analysisWindowMs");
  validateRatio(resolved.maxVoiceFrameRatio, "maxVoiceFrameRatio");
  validateNonNegativeFiniteNumber(resolved.cooldownMs, "cooldownMs");

  return resolved;
}

export function calculateRms(frame: Float32Array): number {
  if (frame.length === 0) {
    throw new Error("Cannot calculate RMS for an empty audio frame.");
  }

  let sum = 0;
  for (let index = 0; index < frame.length; index++) {
    const sample = frame[index] ?? 0;
    if (Number.isFinite(sample)) {
      sum += sample * sample;
    }
  }

  return Math.sqrt(sum / frame.length);
}

export function rmsToDbfs(rms: number): number {
  return 20 * Math.log10(Math.max(rms, Number.MIN_VALUE));
}

function createCandidateWindow(): CandidateWindow {
  return {
    totalFrames: 0,
    voiceFrames: 0,
    activeFrames: 0,
    rmsSum: 0,
    durationMs: 0,
  };
}

function collectCandidateFrame(
  candidateWindow: CandidateWindow,
  result: BackgroundNoiseDetectorFrameResult,
  triggerRms: number
): void {
  candidateWindow.totalFrames++;
  candidateWindow.voiceFrames += result.isVoice ? 1 : 0;
  candidateWindow.activeFrames += result.rms >= triggerRms ? 1 : 0;
  candidateWindow.rmsSum += result.rms;
  candidateWindow.durationMs += result.durationMs;
}

function validateRatio(value: number, name: string): number {
  validateFiniteNumber(value, name);

  if (value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1.`);
  }

  return value;
}

function validatePositiveFiniteNumber(value: number, name: string): number {
  validateFiniteNumber(value, name);

  if (value <= 0) {
    throw new Error(`${name} must be greater than 0.`);
  }

  return value;
}

function validateNonNegativeFiniteNumber(value: number, name: string): number {
  validateFiniteNumber(value, name);

  if (value < 0) {
    throw new Error(`${name} must be greater than or equal to 0.`);
  }

  return value;
}

function validateFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite.`);
  }

  return value;
}
