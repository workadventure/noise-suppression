# ADR 0002: Migrate to a Browser-Only Vite Package

- Status: Accepted
- Date: 2026-03-13

## Context

ADR 0001 established that LiteRT.js should become the default browser backend
because it substantially outperformed the Rust/Emscripten browser path.

After that change, the repository still carried two unrelated packaging models:

- a Rust/native Node.js addon toolchain
- a browser LiteRT.js runtime

That split was no longer justified for the target product direction.

The repository still contained:

- Rust sources and Cargo metadata
- native addon loaders and install scripts
- Emscripten/Wasm glue files
- Docker and static-linking instructions for native builds
- package metadata shaped around mixed Node/browser delivery

At the same time, the actual desired deliverable had become much simpler:

- a browser-only package
- no Rust runtime
- no native addon
- an ESM-first API
- a library build suitable for modern frontend tooling

## Decision

Convert the repository into a standalone browser package named
`@workadventure/noise-suppression`.

Specifically:

- remove Rust, Cargo, native-addon, and Emscripten-specific repository concerns
- make the package browser-only
- make the package ESM-only
- use Vite as the library build system
- publish only built browser artifacts and package metadata needed at runtime
- keep the LiteRT.js + DTLN implementation as the core runtime
- keep benchmark files in the repository and adapt them to the new browser-only
  structure

## Why

### 1. The repository should match the actual runtime strategy

Once the browser path stopped using Rust, the mixed architecture became mostly
historical baggage. Keeping the native toolchain in the same package increased
maintenance cost without serving the current product direction.

### 2. Browser distribution is simpler as a dedicated package

A browser-only package avoids:

- native install steps
- prebuilt binary management
- Cargo toolchain requirements
- platform-specific loader logic
- confusing dual runtime behavior

### 3. ESM is the right default for the target environment

The new package targets browser bundlers and modern frontend apps. ESM aligns
with LiteRT.js, Vite, and the intended browser integration model.

### 4. Vite provides the right build/development model

The package needs to:

- build an ESM library
- copy the LiteRT.js Wasm runtime assets
- copy the DTLN `.tflite` model files
- support browser dev/preview flows
- support cross-origin isolation headers for threaded LiteRT.js benchmarking

Vite handles this well with minimal custom tooling.

## Consequences

### Positive

- The repository now reflects the actual runtime architecture.
- Package consumers get a simpler browser-focused API.
- The build is easier to understand and maintain.
- The library output now cleanly includes:
  - `dist/index.js`
  - `dist/index.d.ts`
  - packaged model assets
  - packaged LiteRT.js Wasm assets
- Local development and benchmark flows now use the same Vite-based runtime
  model as the library itself.

### Negative

- The repository no longer supports the previous native Node.js addon workflow.
- Historical Node/Rust docs and code had to be removed.
- Some benchmark artifacts needed semantic redefinition because the old Rust/Wasm
  browser runtime no longer exists.
- The current implementation still relies on LiteRT.js internal synchronous
  runner APIs to preserve synchronous `dtln_denoise()`.

## Alternatives Considered

### Keep a mixed Rust/Node/browser repository

Rejected because the package direction is now browser-only, and the mixed setup
would preserve cost and complexity without a matching runtime need.

### Keep the package mixed but publish a separate browser subpath

Rejected because it still leaves the repository and package metadata centered on
an architecture that is no longer the intended product.

### Switch to a different build system

Possible, but Vite already matches the requirements well for:

- ESM library builds
- static asset copying
- browser development
- preview/benchmark hosting

## Implementation Notes

The migration introduced:

- package rename to `@workadventure/noise-suppression`
- `type: "module"` package metadata
- Vite library config in [`vite.config.mjs`](../../vite.config.mjs)
- new runtime entrypoint in [`src/index.ts`](../../src/index.ts)
- strict TypeScript build with generated declarations in [`dist/index.d.ts`](../../dist/index.d.ts)
- Vite demo entrypoints in [`index.html`](../../index.html) and
  [`demo/main.ts`](../../demo/main.ts)
- benchmark helpers adapted to the browser-only architecture

The migration removed:

- Cargo manifests and Rust sources
- native addon wrappers and related install scripts
- Emscripten/Wasm wrapper files
- native-build-specific docs and Docker instructions

## Follow-up Work

- decide whether to keep the old `dtln_*` API names or rename the public surface
  to a package-specific naming scheme
- add tests around the Vite-built browser bundle
- refine benchmark pages further now that they compare browser runtime modes
  rather than old architecture variants
- evaluate whether the LiteRT.js synchronous internal API dependency can be
  reduced or isolated further
