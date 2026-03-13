const DEFAULT_LITERT_WASM_ROOT = __NOISE_SUPPRESSION_LITERT_WASM_ROOT__;
const DEFAULT_MODEL1_URL = __NOISE_SUPPRESSION_MODEL1_URL__;
const DEFAULT_MODEL2_URL = __NOISE_SUPPRESSION_MODEL2_URL__;

export function resolveAssetUrl(assetPath: string): string {
  if (/^(https?:)?\/\//.test(assetPath) || assetPath.startsWith("/")) {
    return assetPath;
  }

  return new URL(assetPath, import.meta.url).toString();
}

export function resolveThreadSetting(requested: boolean | undefined): boolean {
  if (typeof requested === "boolean") {
    return requested;
  }

  return (
    typeof globalThis.crossOriginIsolated === "boolean" &&
    globalThis.crossOriginIsolated
  );
}

export function resolveBrowserCpuThreadCount(requested: number | undefined): number {
  if (Number.isFinite(requested) && requested !== undefined && requested > 0) {
    return Math.floor(requested);
  }

  const hardwareThreads =
    typeof navigator !== "undefined" &&
    Number.isFinite(navigator.hardwareConcurrency) &&
    navigator.hardwareConcurrency > 0
      ? navigator.hardwareConcurrency
      : 1;

  return Math.max(1, Math.min(4, hardwareThreads));
}

export function resolveDefaultLiteRtWasmRoot(): string {
  return resolveAssetUrl(DEFAULT_LITERT_WASM_ROOT);
}

export function resolveDefaultModel1Url(): string {
  return resolveAssetUrl(DEFAULT_MODEL1_URL);
}

export function resolveDefaultModel2Url(): string {
  return resolveAssetUrl(DEFAULT_MODEL2_URL);
}
