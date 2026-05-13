# ADR 0007: Use LiteRT ESM Fork for AudioWorklet

- Status: Accepted
- Date: 2026-05-11

## Context

ADR 0004 introduced a repository-local LiteRT fork that loaded the Emscripten
glue source inside `AudioWorkletGlobalScope`.

That proved the DTLN runtime could run in an `AudioWorkletProcessor`, but the
bootstrap depended on evaluating JavaScript source passed into the processor.
That is fragile under content security policies and is not a good long-term
loading boundary.

A newer LiteRT fork now emits ESM artifacts and supports the intended package
shape:

```typescript
import createLiteRtWasm from "@litertjs/core/wasm/litert_wasm_internal.mjs";

await loadLiteRt(createLiteRtWasm);
```

## Decision

Replace the old vendored LiteRT upstream fork with the new ESM dist artifacts:

- remove `vendor/LiteRT-upstream`
- replace `forks/litertjs-core` with
  `/home/dan/projects/LiteRT/litert/js/packages/core/dist`
- vendor the matching `@litertjs/wasm-utils` dist under
  `forks/litertjs-wasm-utils`
- statically import `litert_wasm_internal.mjs` in
  `src/audio-worklet-processor.ts`
- import the LiteRT Wasm and DTLN model files with `?bytes` inside the
  processor module
- pass the Emscripten module factory into `loadLiteRt(...)`

The worklet no longer receives model or Wasm bytes from the main thread. The
processor bundle owns those bytes, and the module factory is wrapped only to
pass `wasmBinary`, avoiding URL-based Wasm discovery inside the processor.

## Consequences

The AudioWorklet path no longer evaluates generated JavaScript source at
runtime.

The worklet path still needs a few runtime guards because Chrome's
`AudioWorkletGlobalScope` does not expose every browser global assumed by the
generated Emscripten glue. Those shims live in
`src/audio-worklet-global-scope-shim.ts` and are loaded before the LiteRT ESM
factory.

The public LiteRT `SignatureRunner.run(...)` API is asynchronous. The audio
render callback cannot await, so `src/runtime.ts` continues to use the
underlying compiled-model `run(...)` path synchronously and fails explicitly if
LiteRT returns an actual promise there.

Vite's dev server injects page-oriented helpers into unbundled module graphs,
which is not valid inside an AudioWorklet. The Vite config therefore builds the
processor as a bundled module for both development and production. A small
`?bytes` plugin turns `.wasm` and `.tflite` files into `Uint8Array` imports.

## Validation

This change was validated with:

- `npm run typecheck`
- `npm run build`
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run test:browser -- test/audio-worklet.browser.test.ts`
