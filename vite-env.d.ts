/// <reference types="vite/client" />

declare module "*.mjs" {
  const moduleFactory: (moduleArg?: unknown) => Promise<unknown>;
  export default moduleFactory;
}

declare module "*?bytes" {
  const bytes: Uint8Array;
  export default bytes;
}

declare module "virtual:noise-suppression-audio-worklet-module-url" {
  const moduleUrl: string;
  export default moduleUrl;
}

declare module "virtual:noise-suppression-default-assets" {
  export const defaultLiteRtWasmRoot: string;
  export const defaultModel1Url: string;
  export const defaultModel2Url: string;
}
