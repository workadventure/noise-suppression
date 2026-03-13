export type DenoiserHandle = number;

export interface LiteRtDtlnModuleOptions {
  liteRtWasmRoot?: string;
  model1Url?: string;
  model2Url?: string;
  threads?: boolean;
  numThreads?: number;
  logModelDetails?: boolean;
  enableProfiling?: boolean;
}

export interface LiteRtModelTensorDetails {
  name: string;
  index: number;
  dtype: string;
  shape: number[];
}

export interface LiteRtDtlnModelDetails {
  model1: {
    inputs: LiteRtModelTensorDetails[];
    outputs: LiteRtModelTensorDetails[];
  };
  model2: {
    inputs: LiteRtModelTensorDetails[];
    outputs: LiteRtModelTensorDetails[];
  };
  threads: boolean;
  numThreads: number;
  liteRtWasmRoot: string;
}

export interface LiteRtDtlnProfileStageSummary {
  count: number;
  totalMs: number;
  meanMs: number;
  p95Ms: number;
  inferShare: number;
  denoiseShare: number;
}

export interface LiteRtDtlnProfileSummary {
  inferCalls: number;
  denoiseCalls: number;
  stages: Record<string, LiteRtDtlnProfileStageSummary>;
}

export interface LiteRtDtlnModule {
  ready: Promise<LiteRtDtlnModule>;
  modelDetails: LiteRtDtlnModelDetails;
  dtln_create(): DenoiserHandle;
  dtln_denoise(
    denoiser: DenoiserHandle,
    inputSamples: Float32Array,
    outputSamples: Float32Array
  ): boolean;
  dtln_stop(denoiser: DenoiserHandle): void;
  dtln_destroy(denoiser: DenoiserHandle): void;
  get_profile(denoiser: DenoiserHandle): LiteRtDtlnProfileSummary;
  reset_profile(denoiser: DenoiserHandle): void;
}

export default function createDtlnModule(
  options?: LiteRtDtlnModuleOptions
): Promise<LiteRtDtlnModule>;
