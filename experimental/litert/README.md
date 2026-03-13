# LiteRT.js Spike

This directory contains an experimental browser-only DTLN wrapper built on top
of LiteRT.js.

What it does:

- loads the existing `model_quant_1.tflite` and `model_quant_2.tflite` files
- compiles them with LiteRT.js in Wasm mode
- recreates the Rust DTLN orchestration in JavaScript
- preserves the current `dtln_create` / `dtln_denoise` / `dtln_stop` API shape

Important caveat:

- `dtln_denoise()` stays synchronous by calling LiteRT.js internal sync runner
  methods. That is acceptable for a spike, but it is not the final packaging
  strategy.

## Running the Demo

Serve the repo root over HTTP, then open `browser-demo-litert.html`.

Example:

```bash
python3 -m http.server 8000
```

Then visit:

```text
http://localhost:8000/browser-demo-litert.html
```

The demo uses an import map that points directly at `node_modules`, so no
bundler is required for the spike.
