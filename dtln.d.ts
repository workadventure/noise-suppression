/**
 * TypeScript definitions for the ESM/WebAssembly build of dtln-rs.
 */

/**
 * Opaque numeric handle returned by the WebAssembly runtime.
 */
export type DenoiserHandle = number;

/**
 * Optional module initialization overrides passed through to the generated
 * Emscripten factory.
 */
export interface DtlnModuleOptions {
  arguments?: string[];
  noFSInit?: boolean;
  noInitialRun?: boolean;
  onAbort?: (reason: unknown) => void;
  postRun?: Array<() => void>;
  preInit?: Array<() => void>;
  preRun?: Array<() => void>;
  print?: (...args: unknown[]) => void;
  printErr?: (...args: unknown[]) => void;
  thisProgram?: string;
  wasmBinary?: ArrayBuffer | Uint8Array;
  [key: string]: unknown;
}

/**
 * Runtime API exposed by the DTLN WebAssembly module.
 */
export interface DtlnPlugin {
  /**
   * Resolves once the DTLN wrapper is fully attached to the module instance.
   */
  ready: Promise<DtlnPlugin>;

  /**
   * Creates a new DTLN denoiser instance.
   */
  dtln_create(): DenoiserHandle;

  /**
   * Processes one 512-sample mono frame at 16kHz.
   */
  dtln_denoise(
    denoiser: DenoiserHandle,
    inputSamples: Float32Array,
    outputSamples: Float32Array
  ): boolean;

  /**
   * Resets internal profiling counters for a denoiser instance.
   */
  dtln_profile_reset(denoiser: DenoiserHandle): void;

  /**
   * Returns aggregated timing data collected inside the wasm engine.
   */
  dtln_profile_get(denoiser: DenoiserHandle): DtlnProfile;

  /**
   * Stops and frees a denoiser instance.
   */
  dtln_stop(denoiser: DenoiserHandle): void;

  /**
   * Alias of `dtln_stop`.
   */
  dtln_destroy(denoiser: DenoiserHandle): void;
}

export interface DtlnProfile {
  denoiseCalls: number;
  inferCalls: number;
  denoiseTotalMs: number;
  blockPrepMs: number;
  outputCopyMs: number;
  inferTotalMs: number;
  fftForwardMs: number;
  magnitudeMs: number;
  model1CopyMs: number;
  model1InvokeMs: number;
  maskMs: number;
  ifftMs: number;
  normalizeMs: number;
  model2CopyMs: number;
  model2InvokeMs: number;
  overlapAddMs: number;
}

/**
 * Emscripten module instance with the DTLN plugin API attached.
 */
export interface DtlnModule extends DtlnPlugin {
  DtlnPlugin: DtlnPlugin;
}

/**
 * Creates and initializes the DTLN ESM/WebAssembly module.
 */
declare function createDtlnModule(
  moduleArg?: DtlnModuleOptions
): Promise<DtlnModule>;

export default createDtlnModule;
