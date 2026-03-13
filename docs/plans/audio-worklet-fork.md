# AudioWorklet LiteRT Fork Plan

- Status: Draft
- Date: 2026-03-13
- Owner: Codex

## Goal

Create a worklet-safe LiteRT runtime path for this repository so the DTLN
denoiser can run inside `AudioWorkletGlobalScope` without relying on:

- `document`
- `importScripts`
- runtime asset URL discovery inside the worklet

The immediate objective is not to publish a general-purpose LiteRT fork. The
first objective is to prove that a patched Pattern A style bootstrap works in
this repository with the shipped DTLN models.

## Current State

The repository already has:

- a browser-oriented wrapper entrypoint in [`src/index.ts`](../../src/index.ts)
- a worklet-safe core runtime in [`src/runtime.ts`](../../src/runtime.ts)
- an AudioWorklet validation page in
  [`audio-worklet-validation.html`](../../audio-worklet-validation.html)
- worklet probes in [`demo/`](../../demo)

The current validation result is:

- control AudioWorklet: works
- worklet importing `@litertjs/core`: works
- worklet importing `fft.js`: works
- full LiteRT initialization: fails with `ReferenceError: document is not defined`

The concrete blocker is LiteRT.js loader behavior, not Vite, not
`AudioWorkletGlobalScope` itself, and not the DTLN runtime code.

## Recommendation

Do the first implementation phase inside this repository.

Do not create a separate external fork repository yet.

Reasons:

- the technical viability of a patched worklet bootstrap is still unproven
- the current repo already contains the validation harness needed to test the work
- the repository-local fork can later be extracted cleanly if the approach works

## Proposed Repository Layout

Add the forked runtime under:

- [`forks/litertjs-core`](../../forks/litertjs-core)

Suggested layout:

- `forks/litertjs-core/src/`
- `forks/litertjs-core/vendor/`
- `forks/litertjs-core/README.md`

Suggested responsibility split:

- `forks/litertjs-core/src/loader/`
  Worklet-safe bootstrap code
- `forks/litertjs-core/src/runtime/`
  Minimal LiteRT runtime wrapper surface needed by this package
- `forks/litertjs-core/vendor/`
  Vendored upstream loader/runtime assets copied from `@litertjs/core`

The existing package runtime should continue to live in:

- [`src/index.ts`](../../src/index.ts)
- [`src/runtime.ts`](../../src/runtime.ts)

That keeps the application-facing code separate from the upstream-derived fork.

## Target Architecture

Use Pattern A from the Chrome AudioWorklet design-pattern article as the basis
for the fork.

Interpretation for this project:

- the processor module is loaded through `audioContext.audioWorklet.addModule(...)`
- the processor statically imports a worklet-safe LiteRT bootstrap
- the LiteRT bootstrap evaluates or instantiates the Emscripten loader inside
  `AudioWorkletGlobalScope`
- wasm bytes and model bytes are already packaged and explicitly supplied
- the processor registers only after the runtime can be initialized cleanly

Avoid Pattern B for the first implementation:

- LiteRT.js does not expose a public API to transfer a prepared runtime or a
  compiled `WebAssembly.Module`
- it adds cross-thread transfer complexity before proving the simpler path

## Design Constraints

### Functional constraints

- `AudioWorkletProcessor.process()` must remain synchronous
- keeping `dtln_denoise()` synchronous inside the worklet is preferable for
  latency, simplicity, and jitter control, but it is not a hard blocker
- an asynchronous denoise pipeline is acceptable if output is returned through
  an explicit output ring buffer during later `process()` calls
- model loading must not rely on URL resolution inside the worklet
- the 128-sample AudioWorklet callback and 512-sample DTLN frame mismatch still
  needs a ring-buffer adapter later

### Runtime constraints

- no dependency on `document`
- no dependency on `importScripts`
- no dependency on `import()` inside the worklet
- no assumption that `navigator.hardwareConcurrency` exists in the worklet

### Packaging constraints

- avoid `?raw` for `.wasm` or `.tflite` binary files
- use `Uint8Array` or `ArrayBuffer` for binary assets
- `?raw` is acceptable for text-based loader JavaScript if needed

## Implementation Strategy

### Phase 1: Vendor the minimum upstream surface

Goal:

- isolate the exact LiteRT code we need to patch without depending on the npm
  package loader path

Steps:

1. Copy the minimum required LiteRT runtime sources or built artifacts from:
   - `node_modules/@litertjs/core`
   - `node_modules/@litertjs/wasm-utils`
2. Record the upstream package version and copied files in
   `forks/litertjs-core/README.md`
3. Keep the first fork small:
   - only wasm backend support
   - only CPU path
   - no WebGPU work
   - no browser DOM helpers

Exit criterion:

- the repository no longer depends on `loadLiteRt()` from the stock package for
  the worklet prototype

### Phase 2: Replace the script-based loader

Goal:

- eliminate the `runScript()` requirement that currently assumes either
  `importScripts` or `document`

Steps:

1. Build a worklet-safe bootstrap entry that can obtain a `ModuleFactory`
   without DOM script injection
2. Prefer one of these approaches:
   - evaluate vendored loader JS text inside the worklet
   - or transform the loader into a normal importable module during vendoring
3. Pass wasm bytes explicitly through the bootstrap instead of file lookup
   wherever possible
4. If needed, provide a custom `instantiateWasm` or `wasmBinary` hook to the
   Emscripten module config

Exit criterion:

- LiteRT runtime creation succeeds in `AudioWorkletGlobalScope`

### Phase 3: Load models from bytes, not URLs

Goal:

- eliminate model-file URL dependence in the worklet path

Steps:

1. Bundle model assets as binary payloads suitable for `Uint8Array`
2. Feed those bytes into LiteRT model loading directly
3. Keep the main-thread browser entrypoint free to continue using URLs if that
   remains simpler outside worklets

Exit criterion:

- the worklet path can compile both DTLN models without issuing network fetches
  from inside the worklet

### Phase 4: Integrate with the existing DTLN runtime

Goal:

- swap the current validation-only worklet bootstrap for the real denoiser
  runtime

Steps:

1. Connect the forked LiteRT runtime to [`src/runtime.ts`](../../src/runtime.ts)
   or a worklet-specific adapter
2. Keep the worklet runtime explicit:
   - explicit wasm bytes or wasm bootstrap
   - explicit model bytes
   - explicit thread count
3. Ensure the worklet path does not pull in the browser entrypoint
   [`src/index.ts`](../../src/index.ts)
4. Prefer a synchronous denoise call path if the forked runtime can support it,
   but keep an asynchronous buffered design as an acceptable fallback

Exit criterion:

- a worklet processor can initialize the denoiser and run one successful
  512-sample denoise pass

### Phase 5: Add the AudioWorklet frame adapter

Goal:

- handle the 128-frame render quantum correctly

Steps:

1. Add an input ring buffer to collect 4 render quanta into one 512-sample DTLN
   frame
2. Add an output ring buffer to return processed audio back in 128-sample
   chunks
3. Decide startup behavior before the first full 512-sample frame is available:
   - silence
   - passthrough
4. Decide overflow/underrun behavior explicitly

Exit criterion:

- the processor can run continuously inside `process(...)` with correct block
  adaptation

### Phase 6: Benchmark and decide

Goal:

- determine whether the fork should be kept, extracted, or discarded

Steps:

1. Reuse and extend the validation harness to benchmark:
   - initialization time
   - single-frame denoise time
   - sustained worklet processing
2. Compare:
   - page-thread LiteRT runtime
   - AudioWorklet forked runtime
3. Confirm whether realtime behavior remains stable in the actual callback path

Decision gate:

- if performance and complexity are acceptable, promote the forked path
- if not, stop before externalizing the fork

## Deliverables

### Required for prototype success

- `forks/litertjs-core/` with documented upstream provenance
- a worklet-safe LiteRT bootstrap
- a validation page proving full runtime initialization in
  `AudioWorkletGlobalScope`
- a successful denoise call in the worklet

### Optional for first phase

- external GitHub fork
- npm publication of the fork
- threaded worklet execution
- generalized fork API suitable for other projects

## Risks

### Risk 1: Emscripten loader assumptions are deeper than `runScript()`

The generated loader may still contain implicit DOM- or worker-assumptions even
after replacing the first script-loading layer.

Mitigation:

- keep the prototype minimal and test each bootstrap step independently

### Risk 2: CSP may block eval-based bootstrap

If the fork relies on `eval` or `new Function`, some production environments
may reject it.

Mitigation:

- prefer transforming the loader into an importable module if feasible
- treat raw-text evaluation only as a prototype path

### Risk 3: Worklet performance may still regress

Even if loading works, sustained processing in the actual AudioWorklet callback
may perform worse than page-thread benchmarks suggest.

Mitigation:

- benchmark inside the worklet before promoting the path

### Risk 4: Threads may remain difficult

Even after worklet-safe bootstrap, threaded LiteRT runtime behavior may still
be constrained by browser support and worker semantics.

Mitigation:

- prove single-threaded worklet runtime first
- defer threaded worklet support until after base viability is established

## Validation Checklist

Prototype acceptance should be staged in this order:

1. worklet processor loads through Vite without registration failure
2. forked LiteRT bootstrap creates a runtime in `AudioWorkletGlobalScope`
3. both DTLN models compile from in-memory bytes
4. one denoise call succeeds in the worklet
5. the 128-to-512 frame adapter works in continuous processing
6. realtime performance is measured and documented

## Decision on External Forking

Only create an external fork repository after Phase 4 succeeds.

At that point:

1. create a dedicated repository for the fork
2. push the contents of `forks/litertjs-core/`
3. link it from:
   - `package.json`
   - `README.md`
   - ADRs / plan docs
4. decide whether to consume it via:
   - Git dependency
   - workspace package
   - published scoped package

Until then, the in-repo path should be treated as the source of truth.

## Suggested Execution Order for Another Codex Instance

If this plan is delegated, the recommended order is:

1. vendor the minimum LiteRT runtime into `forks/litertjs-core/`
2. replace the script-based loader with a worklet-safe bootstrap
3. prove runtime initialization in the existing validation harness
4. switch models to in-memory bytes
5. integrate the real DTLN runtime
6. add the ring-buffer adapter
7. benchmark and document the result

## Open Questions

- Can the generated Emscripten loader be transformed into an importable module
  cleanly enough to avoid eval-like techniques?
- Is carrying a repository-local fork acceptable long-term if upstream does not
  adopt worklet-safe loading?
- Should the worklet path remain an internal integration detail, or become part
  of the public package API?
