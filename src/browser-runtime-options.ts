import {
  defaultLiteRtWasmRoot,
  defaultLiteRtWasmInternalUrl,
  defaultLiteRtWasmCompatUrl,
  defaultModel1Url,
  defaultModel2Url,
} from "virtual:noise-suppression-default-assets";

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
  return defaultLiteRtWasmRoot;
}

export function resolveLiteRtWasmUrl(variant: "relaxed" | "compat"): string {
  return variant === "compat" ? defaultLiteRtWasmCompatUrl : defaultLiteRtWasmInternalUrl;
}

export function resolveDefaultModel1Url(): string {
  return defaultModel1Url;
}

export function resolveDefaultModel2Url(): string {
  return defaultModel2Url;
}
