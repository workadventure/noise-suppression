# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for significant
technical decisions in this repository.

## Conventions

- File names use a zero-padded numeric prefix: `0001-short-title.md`
- New ADRs should be appended with the next available number
- Each ADR should include at least:
  - status
  - date
  - context
  - decision
  - consequences

## Index

- [ADR 0001: Use LiteRT.js as the Default Browser Backend](./0001-use-litert-js-for-browser-backend.md)
- [ADR 0002: Migrate to a Browser-Only Vite Package](./0002-migrate-to-browser-only-vite-package.md)
- [ADR 0003: AudioWorklet Validation and LiteRT.js Loader Limitation](./0003-audio-worklet-validation-and-litert-loader-limitation.md)
- [ADR 0004: Implement AudioWorklet LiteRT Fork and Benchmark](./0004-implement-audio-worklet-litert-fork-and-benchmark.md)
- [ADR 0005: Add Browser Automation Tests with Vitest and Playwright](./0005-add-browser-automation-tests-with-vitest-and-playwright.md)
- [ADR 0006: Buffer AudioWorklet Input and Output Around 512-Sample DTLN Frames](./0006-buffer-audio-worklet-input-and-output-around-512-sample-dtln-frames.md)
