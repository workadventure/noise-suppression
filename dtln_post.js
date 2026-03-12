const DTLN_SAMPLE_BLOCK_SIZE = 512;
const DTLN_SIZEOF_FLOAT32 = 4;
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

// Export interface that matches the node plugin.
let DtlnPlugin = {
  ready,
  dtln_create: () => {
    return Module._dtln_create_wasm();
  },
  dtln_stop: (handle) => Module._dtln_destroy_wasm(handle),
  dtln_destroy: (handle) => Module._dtln_destroy_wasm(handle),
  dtln_denoise: (handle, input, output) => {
    const heap = getHeapF32();
    let audioBufferPtr = Module._dtln_get_audio_buffer(handle) / DTLN_SIZEOF_FLOAT32;
    heap.set(input, audioBufferPtr);
    Module._dtln_denoise_wasm(handle);
    output.set(heap.subarray(audioBufferPtr, audioBufferPtr + DTLN_SAMPLE_BLOCK_SIZE));
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
