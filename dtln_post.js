const DTLN_SAMPLE_BLOCK_SIZE = 512;
const DTLN_SIZEOF_FLOAT32 = 4;
const wasmBufferStates = new Map();
let resolveReady;
const ready = new Promise((resolve) => {
  resolveReady = resolve;
});

function getHeapF32() {
  if (typeof HEAPF32 !== "undefined") {
    return HEAPF32;
  }

  if (typeof Module !== "undefined" && Module.HEAPF32) {
    return Module.HEAPF32;
  }

  throw new Error("DTLN WebAssembly memory is not initialized");
}

function getHandleState(handle) {
  const heap = getHeapF32();
  const cached = wasmBufferStates.get(handle);

  if (cached && cached.heapBuffer === heap.buffer) {
    return cached;
  }

  const audioBufferPtr = Module._dtln_get_audio_buffer(handle) / DTLN_SIZEOF_FLOAT32;
  const state = {
    audioBufferPtr,
    heapBuffer: heap.buffer,
    view: heap.subarray(audioBufferPtr, audioBufferPtr + DTLN_SAMPLE_BLOCK_SIZE),
  };

  wasmBufferStates.set(handle, state);
  return state;
}

// Export interface that matches the node plugin.
let DtlnPlugin = {
  ready,
  dtln_create: () => {
    const handle = Module._dtln_create_wasm();
    getHandleState(handle);
    return handle;
  },
  dtln_stop: (handle) => {
    wasmBufferStates.delete(handle);
    return Module._dtln_destroy_wasm(handle);
  },
  dtln_destroy: (handle) => {
    wasmBufferStates.delete(handle);
    return Module._dtln_destroy_wasm(handle);
  },
  dtln_denoise: (handle, input, output) => {
    const heap = getHeapF32();
    const state = getHandleState(handle);
    heap.set(input, state.audioBufferPtr);
    Module._dtln_denoise_wasm(handle);
    output.set(state.view);
    return false;
  },
};

Module.ready = ready;
Module.DtlnPlugin = DtlnPlugin;
Module.dtln_create = DtlnPlugin.dtln_create;
Module.dtln_stop = DtlnPlugin.dtln_stop;
Module.dtln_destroy = DtlnPlugin.dtln_destroy;
Module.dtln_denoise = DtlnPlugin.dtln_denoise;

const resolvePluginReady = () => {
  if (resolveReady) {
    resolveReady(DtlnPlugin);
  }
  DtlnPlugin.postRun && DtlnPlugin.postRun.forEach((fn) => fn());
};

if (typeof runtimeInitialized !== "undefined" && runtimeInitialized) {
  resolvePluginReady();
} else {
  Module.postRun = Module.postRun || [];
  Module.postRun.push(resolvePluginReady);
}
