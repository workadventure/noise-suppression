# ADR 0005: Add Browser Automation Tests with Vitest and Playwright

- Status: Accepted
- Date: 2026-03-13
- Last updated: 2026-06-18

## Context

By ADR 0004, the repository had:

- a browser runtime in [`src/index.ts`](../../src/index.ts)
- a public AudioWorklet runtime in [`src/audio-worklet.ts`](../../src/audio-worklet.ts)
- validation and benchmark pages proving that both paths worked in a real
  browser

That was useful during development, but it left an important gap:

- the main browser runtime was only validated manually
- the AudioWorklet path was only validated manually
- GitHub Actions only ran `typecheck` and `build`

For this package, unit tests in a Node environment are not sufficient because
the critical behavior depends on browser-only APIs:

- Wasm loading through LiteRT.js
- `AudioContext`
- `AudioWorklet`
- cross-origin-isolated browser behavior

So the repository needed an automated browser test layer, not just more demo
pages.

## Decision

Add automated browser tests using Vitest Browser Mode with the Playwright
provider, and run those tests in CI.

The adopted structure is:

- Vitest browser configuration in [`vitest.config.ts`](../../vitest.config.ts)
- browser smoke tests in [`test/`](../../test)
- a dedicated npm script:
  [`test:browser`](../../package.json)
- GitHub Actions integration in
  [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)

These tests are intentionally smoke/integration tests, not performance tests.
Performance remains covered by the benchmark pages.

## Why

### 1. The important failure modes are browser-only

The high-value regressions for this package involve:

- failing to initialize LiteRT in the page runtime
- failing to initialize LiteRT in the AudioWorklet runtime
- failing to start worklet processing after processor initialization

Those cannot be covered meaningfully in a plain Node test runner.

### 2. Vitest Browser Mode fits the existing Vite project structure

The repository is already a Vite-based ESM library. Vitest Browser Mode reuses
the Vite pipeline directly, which means:

- the same module graph
- the same asset handling
- the same COOP/COEP-enabled server behavior from [`vite.config.mjs`](../../vite.config.mjs)

That keeps test setup aligned with the actual library runtime.

### 3. Playwright is the right browser provider for automation

The tests need a real browser engine plus reliable CI automation. The Playwright
provider gives that while staying integrated with Vitest Browser Mode.

It also lets the tests generate trusted user gestures. The AudioWorklet test
uses one to resume its `AudioContext`, matching browser autoplay policies
without a Chromium-specific launch flag.

### 4. CI needs to validate browser functionality, not just TypeScript and bundling

Passing `typecheck` and `build` was not enough once the package started relying
on real browser-only behavior.

Running the browser suite in CI makes regressions in:

- model loading
- LiteRT initialization
- AudioWorklet startup

fail early on pull requests.

## Implementation

### Vitest browser configuration

The browser test runner is configured in
[`vitest.config.ts`](../../vitest.config.ts).

Key points:

- it reuses the repository’s Vite config via `mergeConfig(...)`
- it enables Vitest Browser Mode
- it uses the Playwright provider
- it runs Chromium, Firefox, and WebKit headlessly
- it keeps the optional custom Chromium executable scoped to Chromium
- it runs the same AudioWorklet test in WebKit even though the statically
  bundled LiteRT Wasm build currently fails there because Playwright WebKit
  does not support relaxed SIMD

### Test cases

Two initial smoke tests were added.

Browser runtime test:

- [`test/browser-runtime.browser.test.ts`](../../test/browser-runtime.browser.test.ts)

This verifies:

- `createNoiseSuppressionModule(...)` initializes
- a `dtln_create()` / `dtln_denoise()` / `dtln_stop()` sequence works
- the output buffer contains finite non-zero values

AudioWorklet runtime test:

- [`test/audio-worklet.browser.test.ts`](../../test/audio-worklet.browser.test.ts)

This verifies:

- `createNoiseSuppressionAudioWorklet(...)` initializes
- the ready message is received
- `processing-started` is observed after connecting a source node

These are intentionally broad smoke tests rather than detailed numerical
correctness or performance assertions.

### Package scripts

[`package.json`](../../package.json) now includes:

- `test:browser`

That script runs Vitest in browser mode. Playwright-managed browser binaries
are used by default; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select a custom
Chromium binary when needed.

### TypeScript coverage

[`tsconfig.json`](../../tsconfig.json) now includes `test/**/*.ts` so the new
browser tests are checked by the existing strict TypeScript pass.

### GitHub Actions

The CI workflow in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
now:

- installs dependencies
- installs Playwright Chromium, Firefox, and WebKit with
  `npx playwright install --with-deps chromium firefox webkit`
- runs `npm run typecheck`
- runs `npm run test:browser`
- runs `npm run build`

## Results

The browser suite passes locally with:

- Chromium: browser runtime and AudioWorklet smoke tests
- Firefox: browser runtime and AudioWorklet smoke tests
- WebKit: browser runtime smoke test
- WebKit: AudioWorklet smoke test fails while compiling the relaxed-SIMD Wasm
  bundle

The WebKit failure is kept in the suite because it represents a real product
compatibility gap. Fixing it requires producing both standard and compatibility
worklet bundles, detecting relaxed SIMD support on the main thread, and loading
the matching bundle before constructing the worklet node.

## Consequences

### Positive

- The repository now has automated regression coverage for both public runtime
  entrypoints.
- CI validates actual browser behavior instead of only static analysis and
  bundling.
- AudioWorklet startup regressions now have a fast automated signal.

### Negative

- CI is slower because it must install a browser and run real browser tests.
- The test environment depends on Playwright and three browser binaries, which
  adds maintenance overhead compared with pure Node tests.
- CI remains failing on WebKit until the AudioWorklet can load a compatible Wasm
  bundle.
- These tests are smoke tests; they do not yet cover detailed output
  equivalence or timing regressions.

## Environment Notes

During local setup, Playwright could not launch the Snap-packaged Chromium
binary in this sandboxed environment.

To avoid that dependency, the repository prefers Playwright-managed browser
installations. A custom Chromium executable remains supported through
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

This is primarily an execution detail, not a product decision, but it is
important for reproducible local runs in constrained environments.

## Alternatives Considered

### Keep relying on manual validation pages only

Rejected because the project now has enough browser-only complexity to justify
automated regression testing.

### Use Node-only Vitest tests

Rejected because the important behavior depends on browser APIs that are not
faithfully represented in a Node test environment.

### Add performance thresholds to CI tests

Rejected for now because performance numbers are machine-dependent and would
make CI fragile. Benchmarks remain separate from pass/fail smoke tests.

## Validation

This setup was validated with:

- `npm run typecheck`
- `npm run test:browser -- --reporter=verbose`

## Follow-up Work

- add numerical-regression browser tests against fixed seeded inputs
- extend the AudioWorklet tests to cover more than just startup and first
  processing
- decide whether to add browser test coverage for threaded modes once the
  worklet fork supports bundled threaded LiteRT loading
