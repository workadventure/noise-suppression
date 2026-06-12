# Vendored libfvad

This directory contains the minimal libfvad/WebRTC VAD source and build output
needed by the background-noise detector AudioWorklet.

## Upstream

- Upstream repository: <https://github.com/dpirch/libfvad>
- Vendored revision: `532ab666c20d3cfda38bca63abbb0f152706c369`
- Vendored revision date: `2024-02-19 23:02:06 +0100`
- Upstream summary: standalone extraction of the WebRTC voice activity detector

The vendored source intentionally excludes upstream examples, tests,
autotools/CMake packaging, and distribution metadata that are not needed for
the browser AudioWorklet build.

## License

The upstream license files are preserved in this directory:

- `LICENSE`
- `PATENTS`
- `AUTHORS`

Keep these files with any source or binary updates.

## Files

- `include/fvad.h`: public C API used by the wasm wrapper
- `src/`: minimal libfvad C source subset required to build the VAD engine
- `Makefile`: Emscripten build recipe
- `dist/libfvad.js`: generated Emscripten ES module loader
- `dist/libfvad.wasm`: generated WebAssembly binary

## Exported Wasm Surface

The build exports only the functions needed by the detector:

- `_malloc`
- `_free`
- `_fvad_new`
- `_fvad_free`
- `_fvad_reset`
- `_fvad_set_mode`
- `_fvad_set_sample_rate`
- `_fvad_process`

`cwrap` is exported from the Emscripten runtime for wrapper convenience. The
future TypeScript wrapper may call the exported functions directly instead.

## Rebuild

The host machine does not need a local Emscripten installation if Docker is
available.

From the repository root:

```bash
docker run --rm \
  -v "$PWD/vendor/libfvad:/src" \
  -w /src \
  emscripten/emsdk:3.1.74 \
  make clean all
```

Or, with `emcc` installed locally:

```bash
make -C vendor/libfvad clean all
```

After rebuilding, verify that only `dist/libfvad.js` and `dist/libfvad.wasm`
changed unless the upstream source was intentionally updated.

## Update Procedure

1. Clone or fetch <https://github.com/dpirch/libfvad>.
2. Copy the minimal files under `include/` and `src/` from the selected
   upstream revision.
3. Update the upstream revision metadata in this README.
4. Rebuild `dist/libfvad.js` and `dist/libfvad.wasm`.
5. Confirm `LICENSE`, `PATENTS`, and `AUTHORS` are still current.
