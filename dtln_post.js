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

function getProfile(handle) {
  return {
    denoiseCalls: Module._dtln_profile_denoise_calls_wasm(handle),
    inferCalls: Module._dtln_profile_infer_calls_wasm(handle),
    denoiseTotalMs: Module._dtln_profile_denoise_total_ms_wasm(handle),
    blockPrepMs: Module._dtln_profile_block_prep_ms_wasm(handle),
    outputCopyMs: Module._dtln_profile_output_copy_ms_wasm(handle),
    inferTotalMs: Module._dtln_profile_infer_total_ms_wasm(handle),
    fftForwardMs: Module._dtln_profile_fft_forward_ms_wasm(handle),
    magnitudeMs: Module._dtln_profile_magnitude_ms_wasm(handle),
    model1CopyMs: Module._dtln_profile_model1_copy_ms_wasm(handle),
    model1InvokeMs: Module._dtln_profile_model1_invoke_ms_wasm(handle),
    maskMs: Module._dtln_profile_mask_ms_wasm(handle),
    ifftMs: Module._dtln_profile_ifft_ms_wasm(handle),
    normalizeMs: Module._dtln_profile_normalize_ms_wasm(handle),
    model2CopyMs: Module._dtln_profile_model2_copy_ms_wasm(handle),
    model2InvokeMs: Module._dtln_profile_model2_invoke_ms_wasm(handle),
    overlapAddMs: Module._dtln_profile_overlap_add_ms_wasm(handle),
  };
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
  dtln_profile_reset: (handle) => {
    Module._dtln_reset_profile_wasm(handle);
  },
  dtln_profile_get: (handle) => getProfile(handle),
};

Module.ready = ready;
Module.DtlnPlugin = DtlnPlugin;
Module.dtln_create = DtlnPlugin.dtln_create;
Module.dtln_stop = DtlnPlugin.dtln_stop;
Module.dtln_destroy = DtlnPlugin.dtln_destroy;
Module.dtln_denoise = DtlnPlugin.dtln_denoise;
Module.dtln_profile_reset = DtlnPlugin.dtln_profile_reset;
Module.dtln_profile_get = DtlnPlugin.dtln_profile_get;

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
