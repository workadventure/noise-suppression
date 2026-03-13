import {
  Tensor,
  getGlobalLiteRtPromise,
  loadAndCompile,
  loadLiteRt,
  loadLiteRtFromBundledAssets,
  type CompileOptions,
  type CompiledModel,
  type DType,
  type SignatureRunner,
  type TensorDetails,
  type TypedArray as LiteRtTypedArray,
} from "../forks/litertjs-core/index.js";
import FFT from "fft.js";

const DTLN_BLOCK_LEN = 512;
const DTLN_BLOCK_SHIFT = 128;
const DTLN_FFT_OUT_SIZE = DTLN_BLOCK_LEN / 2 + 1;
const PROFILE_STAGES = [
  "fft",
  "magnitude",
  "model1_tensor",
  "model1_invoke",
  "model1_read",
  "mask",
  "ifft",
  "model2_tensor",
  "model2_invoke",
  "model2_read",
  "overlap_add",
  "infer_total",
  "denoise_total",
] as const;

type ProfileStageName = (typeof PROFILE_STAGES)[number];

interface InternalSyncSignatureRunner extends SignatureRunner {
  runWithArray(input: Tensor[]): Tensor[];
}

interface ModelTensorDetails {
  name: string;
  index: number;
  dtype: DType;
  shape: number[];
}

export interface NoiseSuppressionRuntimeOptions {
  liteRtWasmRoot: string;
  model1Url?: string;
  model2Url?: string;
  liteRtLoaderSource?: string;
  liteRtWasmBinary?: Uint8Array;
  model1Data?: Uint8Array;
  model2Data?: Uint8Array;
  threads?: boolean;
  numThreads?: number;
  logModelDetails?: boolean;
  enableProfiling?: boolean;
}

export interface NoiseSuppressionModelDetails {
  model1: {
    inputs: ModelTensorDetails[];
    outputs: ModelTensorDetails[];
  };
  model2: {
    inputs: ModelTensorDetails[];
    outputs: ModelTensorDetails[];
  };
  threads: boolean;
  numThreads: number;
  liteRtWasmRoot: string;
}

export interface ProfileStageSummary {
  count: number;
  totalMs: number;
  meanMs: number;
  p95Ms: number;
  inferShare: number;
  denoiseShare: number;
}

export interface NoiseSuppressionProfile {
  inferCalls: number;
  denoiseCalls: number;
  stages: Record<ProfileStageName, ProfileStageSummary>;
}

export interface AudioConfig {
  sampleRate: 16000;
  channels: 1;
  frameSize: 512;
  frameDuration: 32;
}

export interface NoiseSuppressionModule {
  ready: Promise<NoiseSuppressionModule>;
  modelDetails: NoiseSuppressionModelDetails;
  audioConfig: AudioConfig;
  dtln_create(): number;
  dtln_denoise(
    denoiser: number,
    inputSamples: Float32Array,
    outputSamples: Float32Array
  ): boolean;
  dtln_stop(denoiser: number): void;
  dtln_destroy(denoiser: number): void;
  get_profile(denoiser: number): NoiseSuppressionProfile;
  reset_profile(denoiser: number): void;
  dtln_profile_get(denoiser: number): NoiseSuppressionProfile;
  dtln_profile_reset(denoiser: number): void;
}

interface ProfileStore {
  inferCalls: number;
  denoiseCalls: number;
  timings: Record<ProfileStageName, number[]>;
}

const AUDIO_CONFIG: AudioConfig = {
  sampleRate: 16000,
  channels: 1,
  frameSize: DTLN_BLOCK_LEN,
  frameDuration: 32,
};

function resolveCpuThreadCount(requested: number | undefined): number {
  if (Number.isFinite(requested) && requested !== undefined && requested > 0) {
    return Math.floor(requested);
  }

  return 1;
}

async function ensureLiteRtLoaded(options: {
  wasmRoot: string;
  loaderSource?: string;
  wasmBinary?: Uint8Array;
  threads: boolean;
}): Promise<unknown> {
  const existing = getGlobalLiteRtPromise();
  if (existing) {
    return existing;
  }

  if (options.loaderSource && options.wasmBinary) {
    return loadLiteRtFromBundledAssets(options.loaderSource, options.wasmBinary, {
      threads: options.threads,
    });
  }

  return loadLiteRt(options.wasmRoot, { threads: options.threads });
}

function shapeToArray(shape: Int32Array): number[] {
  return Array.from(shape, (value) => Number(value));
}

function describeTensors(details: readonly TensorDetails[]): ModelTensorDetails[] {
  return details.map((detail) => ({
    name: detail.name,
    index: detail.index,
    dtype: detail.dtype,
    shape: shapeToArray(detail.shape),
  }));
}

function collectModelDetails(compiledModel: CompiledModel) {
  return {
    inputs: describeTensors(compiledModel.getInputDetails()),
    outputs: describeTensors(compiledModel.getOutputDetails()),
  };
}

function getSyncRunner(
  compiledModel: CompiledModel,
  label: string
): InternalSyncSignatureRunner {
  const runner = (
    compiledModel as unknown as {
      defaultSignature?: InternalSyncSignatureRunner;
    }
  ).defaultSignature;

  if (!runner || typeof runner.runWithArray !== "function") {
    throw new Error(
      `LiteRT.js internal sync runner is unavailable for ${label}. ` +
        "This package currently depends on that API to keep dtln_denoise synchronous."
    );
  }

  return runner;
}

function ensureFloat32Array(name: string, value: unknown): asserts value is Float32Array {
  if (!(value instanceof Float32Array)) {
    throw new TypeError(`${name} must be a Float32Array`);
  }
}

function deleteTensors(tensors: readonly Tensor[]): void {
  for (const tensor of tensors) {
    tensor.delete();
  }
}

function nowMs(): number {
  return performance.now();
}

function createProfileStore(): ProfileStore {
  const timings = Object.fromEntries(
    PROFILE_STAGES.map((stage) => [stage, [] as number[]])
  ) as Record<ProfileStageName, number[]>;

  return {
    inferCalls: 0,
    denoiseCalls: 0,
    timings,
  };
}

function recordTiming(profile: ProfileStore, stage: ProfileStageName, durationMs: number): void {
  profile.timings[stage].push(durationMs);
}

function summarizeSamples(samples: readonly number[]): Omit<ProfileStageSummary, "inferShare" | "denoiseShare"> {
  if (samples.length === 0) {
    return {
      count: 0,
      totalMs: 0,
      meanMs: 0,
      p95Ms: 0,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
  );

  return {
    count: samples.length,
    totalMs,
    meanMs: totalMs / samples.length,
    p95Ms: sorted[p95Index] ?? 0,
  };
}

function summarizeProfile(profile: ProfileStore): NoiseSuppressionProfile {
  const stages = Object.create(null) as Record<ProfileStageName, ProfileStageSummary>;

  for (const stage of PROFILE_STAGES) {
    stages[stage] = {
      ...summarizeSamples(profile.timings[stage]),
      inferShare: 0,
      denoiseShare: 0,
    };
  }

  const inferTotalMs = stages.infer_total.totalMs;
  const denoiseTotalMs = stages.denoise_total.totalMs;

  for (const stage of PROFILE_STAGES) {
    const totalMs = stages[stage].totalMs;
    stages[stage].inferShare = inferTotalMs > 0 ? totalMs / inferTotalMs : 0;
    stages[stage].denoiseShare = denoiseTotalMs > 0 ? totalMs / denoiseTotalMs : 0;
  }

  return {
    inferCalls: profile.inferCalls,
    denoiseCalls: profile.denoiseCalls,
    stages,
  };
}

function asFloat32Array(name: string, value: LiteRtTypedArray): Float32Array {
  if (!(value instanceof Float32Array)) {
    throw new TypeError(`${name} must resolve to Float32Array`);
  }

  return value;
}

function createComplexBuffer(fft: FFT): Float32Array {
  return fft.createComplexArray() as unknown as Float32Array;
}

class NoiseSuppressionInstance {
  private readonly model1Runner: InternalSyncSignatureRunner;
  private readonly model2Runner: InternalSyncSignatureRunner;
  private readonly profilingEnabled: boolean;
  private profile: ProfileStore;
  private readonly model1InputShapes: Int32Array[];
  private readonly model2InputShapes: Int32Array[];
  private readonly fft: FFT;
  private readonly fftSpectrum: Float32Array;
  private readonly ifftComplex: Float32Array;
  private readonly inBuffer: Float32Array;
  private readonly outBuffer: Float32Array;
  private readonly states1: Float32Array;
  private readonly states2: Float32Array;
  private readonly inMag: Float32Array;
  private readonly estimatedBlock: Float32Array;

  constructor(
    model1: CompiledModel,
    model2: CompiledModel,
    options: { profilingEnabled?: boolean } = {}
  ) {
    this.model1Runner = getSyncRunner(model1, "model1");
    this.model2Runner = getSyncRunner(model2, "model2");
    this.profilingEnabled = options.profilingEnabled === true;
    this.profile = createProfileStore();

    this.model1InputShapes = model1.getInputDetails().map((detail) => detail.shape);
    this.model2InputShapes = model2.getInputDetails().map((detail) => detail.shape);

    if (this.model1InputShapes.length !== 2 || this.model2InputShapes.length !== 2) {
      throw new Error("Expected exactly two inputs for each DTLN model");
    }

    this.fft = new FFT(DTLN_BLOCK_LEN);
    this.fftSpectrum = createComplexBuffer(this.fft);
    this.ifftComplex = createComplexBuffer(this.fft);

    this.inBuffer = new Float32Array(DTLN_BLOCK_LEN);
    this.outBuffer = new Float32Array(DTLN_BLOCK_LEN);
    this.states1 = new Float32Array(DTLN_BLOCK_LEN);
    this.states2 = new Float32Array(DTLN_BLOCK_LEN);
    this.inMag = new Float32Array(DTLN_FFT_OUT_SIZE);
    this.estimatedBlock = new Float32Array(DTLN_BLOCK_LEN);
  }

  denoise(samples: Float32Array, out: Float32Array): boolean {
    ensureFloat32Array("inputSamples", samples);
    ensureFloat32Array("outputSamples", out);

    if (samples.length % DTLN_BLOCK_SHIFT !== 0) {
      throw new RangeError(
        `inputSamples length must be a multiple of ${DTLN_BLOCK_SHIFT}`
      );
    }

    if (out.length < samples.length) {
      throw new RangeError("outputSamples must be at least as large as inputSamples");
    }

    const totalStart = this.profilingEnabled ? nowMs() : 0;
    const numBlocks = samples.length / DTLN_BLOCK_SHIFT;

    for (let idx = 0; idx < numBlocks; idx++) {
      const offset = idx * DTLN_BLOCK_SHIFT;
      this.inBuffer.copyWithin(0, DTLN_BLOCK_SHIFT);
      this.inBuffer.set(
        samples.subarray(offset, offset + DTLN_BLOCK_SHIFT),
        DTLN_BLOCK_LEN - DTLN_BLOCK_SHIFT
      );

      this.infer();
      out.set(this.outBuffer.subarray(0, DTLN_BLOCK_SHIFT), offset);
    }

    if (this.profilingEnabled) {
      this.profile.denoiseCalls++;
      recordTiming(this.profile, "denoise_total", nowMs() - totalStart);
    }

    return false;
  }

  getProfile(): NoiseSuppressionProfile {
    return summarizeProfile(this.profile);
  }

  resetProfile(): void {
    this.profile = createProfileStore();
  }

  private infer(): void {
    const inferStart = this.profilingEnabled ? nowMs() : 0;
    let stageStart = this.profilingEnabled ? inferStart : 0;

    this.fft.realTransform(this.fftSpectrum, this.inBuffer);
    if (this.profilingEnabled) {
      recordTiming(this.profile, "fft", nowMs() - stageStart);
      stageStart = nowMs();
    }

    for (let i = 0; i < DTLN_FFT_OUT_SIZE; i++) {
      const base = i * 2;
      this.inMag[i] = Math.hypot(this.fftSpectrum[base]!, this.fftSpectrum[base + 1]!);
    }

    if (this.profilingEnabled) {
      recordTiming(this.profile, "magnitude", nowMs() - stageStart);
      stageStart = nowMs();
    }

    const model1Inputs: Tensor[] = [
      Tensor.fromTypedArray(this.inMag, this.model1InputShapes[0]),
      Tensor.fromTypedArray(this.states1, this.model1InputShapes[1]),
    ];

    if (this.profilingEnabled) {
      recordTiming(this.profile, "model1_tensor", nowMs() - stageStart);
      stageStart = nowMs();
    }

    let model1Outputs: Tensor[];
    try {
      model1Outputs = this.model1Runner.runWithArray(model1Inputs);
    } finally {
      deleteTensors(model1Inputs);
    }

    if (this.profilingEnabled) {
      recordTiming(this.profile, "model1_invoke", nowMs() - stageStart);
      stageStart = nowMs();
    }

    const mask = asFloat32Array("model1 mask output", model1Outputs[0]!.toTypedArray());
    const nextState1 = asFloat32Array(
      "model1 state output",
      model1Outputs[1]!.toTypedArray()
    );
    this.states1.set(nextState1);

    if (this.profilingEnabled) {
      recordTiming(this.profile, "model1_read", nowMs() - stageStart);
      stageStart = nowMs();
    }

    for (let i = 0; i < DTLN_FFT_OUT_SIZE; i++) {
      const base = i * 2;
      const gain = mask[i]!;
      this.fftSpectrum[base]! *= gain;
      this.fftSpectrum[base + 1]! *= gain;
    }

    if (this.profilingEnabled) {
      recordTiming(this.profile, "mask", nowMs() - stageStart);
      stageStart = nowMs();
    }

    deleteTensors(model1Outputs);

    this.fftSpectrum[1] = 0;
    this.fftSpectrum[(DTLN_FFT_OUT_SIZE - 1) * 2 + 1] = 0;
    this.fft.completeSpectrum(this.fftSpectrum);
    this.fft.inverseTransform(this.ifftComplex, this.fftSpectrum);

    for (let i = 0; i < DTLN_BLOCK_LEN; i++) {
      this.estimatedBlock[i] = this.ifftComplex[i * 2]!;
    }

    if (this.profilingEnabled) {
      recordTiming(this.profile, "ifft", nowMs() - stageStart);
      stageStart = nowMs();
    }

    const model2Inputs: Tensor[] = [
      Tensor.fromTypedArray(this.estimatedBlock, this.model2InputShapes[0]),
      Tensor.fromTypedArray(this.states2, this.model2InputShapes[1]),
    ];

    if (this.profilingEnabled) {
      recordTiming(this.profile, "model2_tensor", nowMs() - stageStart);
      stageStart = nowMs();
    }

    let model2Outputs: Tensor[];
    try {
      model2Outputs = this.model2Runner.runWithArray(model2Inputs);
    } finally {
      deleteTensors(model2Inputs);
    }

    if (this.profilingEnabled) {
      recordTiming(this.profile, "model2_invoke", nowMs() - stageStart);
      stageStart = nowMs();
    }

    const outBlock = asFloat32Array("model2 output", model2Outputs[0]!.toTypedArray());
    const nextState2 = asFloat32Array(
      "model2 state output",
      model2Outputs[1]!.toTypedArray()
    );
    this.states2.set(nextState2);
    deleteTensors(model2Outputs);

    if (this.profilingEnabled) {
      recordTiming(this.profile, "model2_read", nowMs() - stageStart);
      stageStart = nowMs();
    }

    this.outBuffer.copyWithin(0, DTLN_BLOCK_SHIFT);
    this.outBuffer.fill(0, DTLN_BLOCK_LEN - DTLN_BLOCK_SHIFT);

    for (let i = 0; i < DTLN_BLOCK_LEN; i++) {
      const current = this.outBuffer[i] ?? 0;
      this.outBuffer[i] = current + outBlock[i]!;
    }

    if (this.profilingEnabled) {
      recordTiming(this.profile, "overlap_add", nowMs() - stageStart);
      this.profile.inferCalls++;
      recordTiming(this.profile, "infer_total", nowMs() - inferStart);
    }
  }
}

export async function createNoiseSuppressionRuntime(
  options: NoiseSuppressionRuntimeOptions
): Promise<NoiseSuppressionModule> {
  const liteRtWasmRoot = options.liteRtWasmRoot;
  const model1Source = options.model1Data ?? options.model1Url;
  const model2Source = options.model2Data ?? options.model2Url;
  const threads = options.threads === true;
  const numThreads = resolveCpuThreadCount(options.numThreads);
  const profilingEnabled = options.enableProfiling === true;

  if (!model1Source) {
    throw new Error("Missing model1 source. Provide model1Url or model1Data.");
  }

  if (!model2Source) {
    throw new Error("Missing model2 source. Provide model2Url or model2Data.");
  }

  if (!options.liteRtLoaderSource && !liteRtWasmRoot) {
    throw new Error(
      "Missing LiteRT runtime source. Provide liteRtWasmRoot or bundled loader assets."
    );
  }

  const liteRtLoadOptions: {
    wasmRoot: string;
    loaderSource?: string;
    wasmBinary?: Uint8Array;
    threads: boolean;
  } = {
    wasmRoot: liteRtWasmRoot,
    threads,
  };

  if (options.liteRtLoaderSource !== undefined) {
    liteRtLoadOptions.loaderSource = options.liteRtLoaderSource;
  }

  if (options.liteRtWasmBinary !== undefined) {
    liteRtLoadOptions.wasmBinary = options.liteRtWasmBinary;
  }

  await ensureLiteRtLoaded(liteRtLoadOptions);

  const compileOptions: CompileOptions = {
    accelerator: "wasm",
    cpuOptions: {
      numThreads,
    },
  };

  const [model1, model2] = await Promise.all([
    loadAndCompile(model1Source, compileOptions),
    loadAndCompile(model2Source, compileOptions),
  ]);

  const modelDetails: NoiseSuppressionModelDetails = {
    model1: collectModelDetails(model1),
    model2: collectModelDetails(model2),
    threads,
    numThreads,
    liteRtWasmRoot,
  };

  if (options.logModelDetails) {
    console.info("[noise-suppression] model details", modelDetails);
  }

  const handles = new Map<number, NoiseSuppressionInstance>();
  let nextHandle = 1;

  const getDenoiser = (handle: number): NoiseSuppressionInstance => {
    const denoiser = handles.get(handle);
    if (!denoiser) {
      throw new Error(`Unknown noise suppression handle: ${handle}`);
    }

    return denoiser;
  };

  const module: NoiseSuppressionModule = {
    ready: Promise.resolve(undefined as unknown as NoiseSuppressionModule),
    modelDetails,
    audioConfig: AUDIO_CONFIG,
    dtln_create(): number {
      const handle = nextHandle++;
      handles.set(handle, new NoiseSuppressionInstance(model1, model2, { profilingEnabled }));
      return handle;
    },
    dtln_denoise(handle: number, inputSamples: Float32Array, outputSamples: Float32Array) {
      return getDenoiser(handle).denoise(inputSamples, outputSamples);
    },
    dtln_stop(handle: number): void {
      handles.delete(handle);
    },
    dtln_destroy(handle: number): void {
      handles.delete(handle);
    },
    get_profile(handle: number): NoiseSuppressionProfile {
      return getDenoiser(handle).getProfile();
    },
    reset_profile(handle: number): void {
      getDenoiser(handle).resetProfile();
    },
    dtln_profile_get(handle: number): NoiseSuppressionProfile {
      return getDenoiser(handle).getProfile();
    },
    dtln_profile_reset(handle: number): void {
      getDenoiser(handle).resetProfile();
    },
  };

  module.ready = Promise.resolve(module);
  return module;
}

export { AUDIO_CONFIG };
export default createNoiseSuppressionRuntime;
