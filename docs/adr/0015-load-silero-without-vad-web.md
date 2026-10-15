# ADR 0015: Load Silero Without vad-web

- Status: Proposed
- Date: 2026-10-15
- Supersedes: the `@ricky0123/vad-web` integration of ADR 0009 (Silero VAD stays)

## Context

`MicVAD` builds every asset URL as `baseAssetPath + "<file name>"`, and ONNX
Runtime Web did the same with `onnxWASMBasePath`. The package derived both
folders from the first of its `new URL("vendor/…", import.meta.url)` files.

A consumer's bundler rewrites those URLs one by one: it hashes the file names,
and Vite inlines the 2.5 kB worklet as a `data:` URL. The folders then point at
nothing, so the detector failed in every production build of WorkAdventure,
while it worked under `vite dev`. The dev server needed `optimizeDeps` changes
too, because vad-web is CommonJS. The package also copied ONNX Runtime's Wasm at
build time while the consumer resolved ONNX Runtime's JavaScript at install time,
so the two could drift apart.

## Decision

- Give every file its own exact URL, like the DTLN and DeepFilterNet3 models:
  `model/silero_vad_v5.onnx` is emitted as `assets/silero_vad_v5.onnx`.
- Depend on `onnxruntime-web` and import `onnxruntime-web/wasm`. Its ESM build
  locates its Wasm with its own `new URL(…, import.meta.url)`, which bundlers
  handle, and the JavaScript and Wasm come from one install. One thread, so it
  never spawns workers.
- Replace `MicVAD` with a small capture worklet that keeps vad-web's averaging
  resampler (the thresholds were tuned on its frames) and posts 512-sample
  frames. It ships as a string inside `background-noise.js` and loads from a
  `blob:` URL: no file for a bundler to rename or inline. Pages with a CSP must
  allow `blob:` in `script-src`.
- Run Silero v5 directly (`input`, `state`, `sr`), one frame after the other.
- Drop the legacy Silero model and the options that only drove vad-web
  (`sileroModel`, `processorType`, `baseAssetPath`, `onnxWASMBasePath`, and the
  speech-segment options, which never affected detection).

## Consequences

This entry needs no bundler configuration, with or without the package Vite
plugin. The package no longer ships every ONNX Runtime variant (about 80 MB):
the consumer's bundler emits the one Wasm that `onnxruntime-web/wasm` loads.

`test/vite-consumer.mjs` installs the built package in a Vite app, with and
without the plugin, and runs the detector on white noise from the dev server and
from a production build.
