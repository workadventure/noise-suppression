# Repository-Local LiteRT Fork

- Upstream package: `@litertjs/core`
- Upstream version: `2.0.0`
- Date vendored: `2026-03-13`

## Purpose

This directory contains the minimum repository-local fork surface needed to
prototype AudioWorklet-safe LiteRT initialization.

The current blocker in stock LiteRT.js is its wasm bootstrap path:

- `loadLiteRt()` uses a script-loader helper
- that helper requires either `importScripts()` or `document`
- `AudioWorkletGlobalScope` provides neither

## Contents

- `index.js`
  copied from `node_modules/@litertjs/core/dist/index.js` and patched with
  `loadLiteRtFromBundledAssets(...)`
- `index.d.ts`
  copied from `node_modules/@litertjs/core/dist/index.d.ts` and patched to
  declare the bundled-assets loader
- `wasm/litert_wasm_internal.js`
  copied from `node_modules/@litertjs/core/wasm/litert_wasm_internal.js`
- `wasm/litert_wasm_internal.wasm`
  copied from `node_modules/@litertjs/core/wasm/litert_wasm_internal.wasm`

## Scope

This fork is intentionally narrow:

- CPU / wasm path only
- no work on WebGPU support
- no work on threaded bootstrap yet
- only the runtime surface needed by this repository
