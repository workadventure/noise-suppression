import createLibFvadModule from "../../vendor/libfvad/dist/libfvad.js";
import libFvadWasmBinary from "../../vendor/libfvad/dist/libfvad.wasm?bytes";

export const LIBFVAD_SAMPLE_RATES = [8000, 16000, 32000, 48000] as const;
export const LIBFVAD_FRAME_DURATIONS_MS = [10, 20, 30] as const;

export type LibFvadSampleRate = (typeof LIBFVAD_SAMPLE_RATES)[number];
export type LibFvadFrameDurationMs = (typeof LIBFVAD_FRAME_DURATIONS_MS)[number];

export type LibFvadMode =
  | "quality"
  | "low-bitrate"
  | "aggressive"
  | "very-aggressive"
  | 0
  | 1
  | 2
  | 3;

export interface LibFvadVadOptions {
  sampleRate: number;
  mode: LibFvadMode;
  frameDurationMs: number;
}

interface LibFvadModuleFactoryOptions {
  wasmBinary: Uint8Array;
  print?: (message: string) => void;
  printErr?: (message: string) => void;
}

export interface LibFvadModule {
  HEAP16: Int16Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _fvad_new(): number;
  _fvad_free(handle: number): void;
  _fvad_reset(handle: number): void;
  _fvad_set_mode(handle: number, mode: number): number;
  _fvad_set_sample_rate(handle: number, sampleRate: number): number;
  _fvad_process(handle: number, framePtr: number, frameLength: number): number;
}

type CreateLibFvadModule = (
  options?: LibFvadModuleFactoryOptions
) => Promise<LibFvadModule>;

const createModule = createLibFvadModule as CreateLibFvadModule;
const BYTES_PER_INT16_SAMPLE = 2;

let modulePromise: Promise<LibFvadModule> | null = null;

export function isLibFvadSampleRate(sampleRate: number): sampleRate is LibFvadSampleRate {
  return LIBFVAD_SAMPLE_RATES.includes(sampleRate as LibFvadSampleRate);
}

export function isLibFvadFrameDurationMs(
  frameDurationMs: number
): frameDurationMs is LibFvadFrameDurationMs {
  return LIBFVAD_FRAME_DURATIONS_MS.includes(frameDurationMs as LibFvadFrameDurationMs);
}

export function getLibFvadFrameSamples(
  sampleRate: number,
  frameDurationMs: number
): number {
  assertLibFvadSampleRate(sampleRate);
  assertLibFvadFrameDurationMs(frameDurationMs);

  return (sampleRate * frameDurationMs) / 1000;
}

export function loadLibFvadModule(): Promise<LibFvadModule> {
  modulePromise ??= createModule({
    wasmBinary: libFvadWasmBinary,
  });

  return modulePromise;
}

export async function createLibFvadVad(options: LibFvadVadOptions): Promise<LibFvadVad> {
  validateLibFvadVadOptions(options);
  return new LibFvadVad(await loadLibFvadModule(), options);
}

export class LibFvadVad {
  readonly sampleRate: LibFvadSampleRate;
  readonly frameDurationMs: LibFvadFrameDurationMs;
  readonly frameSamples: number;
  readonly mode: number;

  private handle: number | null = null;
  private framePtr: number | null = null;

  constructor(
    private readonly module: LibFvadModule,
    options: LibFvadVadOptions
  ) {
    validateLibFvadVadOptions(options);

    this.sampleRate = options.sampleRate;
    this.frameDurationMs = options.frameDurationMs;
    this.frameSamples = getLibFvadFrameSamples(options.sampleRate, options.frameDurationMs);
    this.mode = normalizeLibFvadMode(options.mode);

    const handle = module._fvad_new();
    if (handle === 0) {
      throw new Error("Failed to allocate libfvad VAD instance.");
    }

    try {
      if (module._fvad_set_sample_rate(handle, this.sampleRate) !== 0) {
        throw new Error(`libfvad rejected sample rate ${this.sampleRate}.`);
      }

      if (module._fvad_set_mode(handle, this.mode) !== 0) {
        throw new Error(`libfvad rejected VAD mode ${this.mode}.`);
      }

      const framePtr = module._malloc(this.frameSamples * BYTES_PER_INT16_SAMPLE);
      if (framePtr === 0) {
        throw new Error("Failed to allocate libfvad input frame.");
      }

      this.handle = handle;
      this.framePtr = framePtr;
    } catch (error) {
      module._fvad_free(handle);
      throw error;
    }
  }

  processFrame(frame: Float32Array): boolean {
    const handle = this.requireHandle();
    const framePtr = this.requireFramePtr();

    if (frame.length !== this.frameSamples) {
      throw new Error(
        `libfvad expected ${this.frameSamples} samples, received ${frame.length}.`
      );
    }

    const heap = this.module.HEAP16;
    const heapOffset = framePtr >> 1;

    for (let index = 0; index < frame.length; index++) {
      heap[heapOffset + index] = floatToInt16Pcm(frame[index] ?? 0);
    }

    const result = this.module._fvad_process(handle, framePtr, this.frameSamples);
    if (result < 0) {
      throw new Error("libfvad failed to process the audio frame.");
    }

    return result === 1;
  }

  reset(): void {
    this.module._fvad_reset(this.requireHandle());
  }

  destroy(): void {
    if (this.framePtr !== null) {
      this.module._free(this.framePtr);
      this.framePtr = null;
    }

    if (this.handle !== null) {
      this.module._fvad_free(this.handle);
      this.handle = null;
    }
  }

  private requireHandle(): number {
    if (this.handle === null) {
      throw new Error("libfvad VAD instance has been destroyed.");
    }

    return this.handle;
  }

  private requireFramePtr(): number {
    if (this.framePtr === null) {
      throw new Error("libfvad input frame has been destroyed.");
    }

    return this.framePtr;
  }
}

function validateLibFvadVadOptions(options: LibFvadVadOptions): asserts options is {
  sampleRate: LibFvadSampleRate;
  mode: LibFvadMode;
  frameDurationMs: LibFvadFrameDurationMs;
} {
  assertLibFvadSampleRate(options.sampleRate);
  assertLibFvadFrameDurationMs(options.frameDurationMs);
  normalizeLibFvadMode(options.mode);
}

function assertLibFvadSampleRate(sampleRate: number): asserts sampleRate is LibFvadSampleRate {
  if (!isLibFvadSampleRate(sampleRate)) {
    throw new Error(
      `Unsupported libfvad sample rate ${sampleRate}. Supported sample rates: ${LIBFVAD_SAMPLE_RATES.join(
        ", "
      )}.`
    );
  }
}

function assertLibFvadFrameDurationMs(
  frameDurationMs: number
): asserts frameDurationMs is LibFvadFrameDurationMs {
  if (!isLibFvadFrameDurationMs(frameDurationMs)) {
    throw new Error(
      `Unsupported libfvad frame duration ${frameDurationMs}ms. Supported durations: ${LIBFVAD_FRAME_DURATIONS_MS.join(
        ", "
      )}ms.`
    );
  }
}

function normalizeLibFvadMode(mode: LibFvadMode): number {
  if (typeof mode === "number") {
    if (mode >= 0 && mode <= 3 && Number.isInteger(mode)) {
      return mode;
    }

    throw new Error("Unsupported libfvad mode. Supported numeric modes: 0, 1, 2, 3.");
  }

  switch (mode) {
    case "quality":
      return 0;
    case "low-bitrate":
      return 1;
    case "aggressive":
      return 2;
    case "very-aggressive":
      return 3;
    default:
      throw new Error(
        "Unsupported libfvad mode. Supported modes: quality, low-bitrate, aggressive, very-aggressive."
      );
  }
}

function floatToInt16Pcm(sample: number): number {
  if (!Number.isFinite(sample)) {
    return 0;
  }

  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}
