import {
  AUDIO_CONFIG,
  createNoiseSuppressionRuntime,
  type AudioConfig,
  type NoiseSuppressionModelDetails,
  type NoiseSuppressionModule,
  type NoiseSuppressionProfile,
  type NoiseSuppressionRuntimeOptions,
  type ProfileStageSummary,
} from "./runtime";
import {
  resolveBrowserCpuThreadCount,
  resolveDefaultLiteRtWasmRoot,
  resolveDefaultModel1Url,
  resolveDefaultModel2Url,
  resolveThreadSetting,
} from "./browser-runtime-options";

export interface NoiseSuppressionModuleOptions {
  liteRtWasmRoot?: string;
  model1Url?: string;
  model2Url?: string;
  threads?: boolean;
  numThreads?: number;
  logModelDetails?: boolean;
  enableProfiling?: boolean;
}

export type {
  AudioConfig,
  NoiseSuppressionModelDetails,
  NoiseSuppressionModule,
  NoiseSuppressionProfile,
  ProfileStageSummary,
} from "./runtime";

export async function createNoiseSuppressionModule(
  options: NoiseSuppressionModuleOptions = {}
): Promise<NoiseSuppressionModule> {
  const runtimeOptions: NoiseSuppressionRuntimeOptions = {
    liteRtWasmRoot: options.liteRtWasmRoot ?? resolveDefaultLiteRtWasmRoot(),
    model1Url: options.model1Url ?? resolveDefaultModel1Url(),
    model2Url: options.model2Url ?? resolveDefaultModel2Url(),
    threads: resolveThreadSetting(options.threads),
    numThreads: resolveBrowserCpuThreadCount(options.numThreads),
  };

  if (options.logModelDetails !== undefined) {
    runtimeOptions.logModelDetails = options.logModelDetails;
  }

  if (options.enableProfiling !== undefined) {
    runtimeOptions.enableProfiling = options.enableProfiling;
  }

  return createNoiseSuppressionRuntime(runtimeOptions);
}

export { AUDIO_CONFIG, createNoiseSuppressionRuntime };
export default createNoiseSuppressionModule;
