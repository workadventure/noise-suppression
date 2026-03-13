import {
  Tensor,
  getGlobalLiteRtPromise,
  loadAndCompile,
  loadLiteRt,
} from "@litertjs/core";

import FFT from "./vendor/fft.mjs";

const DTLN_BLOCK_LEN = 512;
const DTLN_BLOCK_SHIFT = 128;
const DTLN_FFT_OUT_SIZE = DTLN_BLOCK_LEN / 2 + 1;
const PROFILE_STAGES = [
  "fft",
  "magnitude",
  "model1_tensor",
  "model1_invoke",
  "model1_read",
  "mask",
  "ifft",
  "model2_tensor",
  "model2_invoke",
  "model2_read",
  "overlap_add",
  "infer_total",
  "denoise_total",
];

function defaultUrl(relativePath) {
  return new URL(relativePath, import.meta.url).toString();
}

function resolveThreadSetting(requested) {
  if (typeof requested === "boolean") {
    return requested;
  }

  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.crossOriginIsolated === "boolean" &&
    globalThis.crossOriginIsolated
  );
}

function resolveCpuThreadCount(requested) {
  if (Number.isFinite(requested) && requested > 0) {
    return Math.floor(requested);
  }

  const hardwareThreads =
    typeof navigator !== "undefined" &&
    Number.isFinite(navigator.hardwareConcurrency) &&
    navigator.hardwareConcurrency > 0
      ? navigator.hardwareConcurrency
      : 1;

  return Math.max(1, Math.min(4, hardwareThreads));
}

async function ensureLiteRtLoaded(wasmRoot, threads) {
  const existing = getGlobalLiteRtPromise();
  if (existing) {
    return existing;
  }

  return loadLiteRt(wasmRoot, { threads });
}

function shapeToArray(shape) {
  return Array.from(shape, (value) => Number(value));
}

function describeTensors(details) {
  return details.map((detail) => ({
    name: detail.name,
    index: detail.index,
    dtype: detail.dtype,
    shape: shapeToArray(detail.shape),
  }));
}

function collectModelDetails(compiledModel) {
  return {
    inputs: describeTensors(compiledModel.getInputDetails()),
    outputs: describeTensors(compiledModel.getOutputDetails()),
  };
}

function getExperimentalSyncRunner(compiledModel, label) {
  const runner = compiledModel.defaultSignature;
  if (!runner || typeof runner.runWithArray !== "function") {
    throw new Error(
      `LiteRT.js internal sync runner is unavailable for ${label}. ` +
        "This spike depends on internal APIs and needs updating."
    );
  }
  return runner;
}

function ensureFloat32Array(name, value) {
  if (!(value instanceof Float32Array)) {
    throw new TypeError(`${name} must be a Float32Array`);
  }
}

function deleteTensors(tensors) {
  for (const tensor of tensors) {
    tensor.delete();
  }
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function createProfileStore() {
  const timings = Object.create(null);
  for (const stage of PROFILE_STAGES) {
    timings[stage] = [];
  }

  return {
    inferCalls: 0,
    denoiseCalls: 0,
    timings,
  };
}

function recordTiming(profile, stage, durationMs) {
  profile.timings[stage].push(durationMs);
}

function summarizeSamples(samples) {
  if (!samples.length) {
    return {
      count: 0,
      totalMs: 0,
      meanMs: 0,
      p95Ms: 0,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
  );

  return {
    count: samples.length,
    totalMs,
    meanMs: totalMs / samples.length,
    p95Ms: sorted[p95Index],
  };
}

function summarizeProfile(profile) {
  const stages = Object.create(null);
  for (const stage of PROFILE_STAGES) {
    stages[stage] = summarizeSamples(profile.timings[stage]);
  }

  const inferTotalMs = stages.infer_total.totalMs || 0;
  const denoiseTotalMs = stages.denoise_total.totalMs || 0;

  for (const stage of PROFILE_STAGES) {
    const totalMs = stages[stage].totalMs;
    stages[stage].inferShare = inferTotalMs > 0 ? totalMs / inferTotalMs : 0;
    stages[stage].denoiseShare = denoiseTotalMs > 0 ? totalMs / denoiseTotalMs : 0;
  }

  return {
    inferCalls: profile.inferCalls,
    denoiseCalls: profile.denoiseCalls,
    stages,
  };
}

class LiteRtDtlnDenoiser {
  constructor(model1, model2, { profilingEnabled = false } = {}) {
    this.model1 = model1;
    this.model2 = model2;
    this.model1Runner = getExperimentalSyncRunner(model1, "model1");
    this.model2Runner = getExperimentalSyncRunner(model2, "model2");
    this.profilingEnabled = profilingEnabled;
    this.profile = createProfileStore();

    this.model1InputShapes = model1.getInputDetails().map((detail) => detail.shape);
    this.model2InputShapes = model2.getInputDetails().map((detail) => detail.shape);

    if (this.model1InputShapes.length !== 2 || this.model2InputShapes.length !== 2) {
      throw new Error("DTLN LiteRT spike expects two inputs per model");
    }

    this.fft = new FFT(DTLN_BLOCK_LEN);
    this.fftSpectrum = this.fft.createComplexArray();
    this.ifftComplex = this.fft.createComplexArray();

    this.inBuffer = new Float32Array(DTLN_BLOCK_LEN);
    this.outBuffer = new Float32Array(DTLN_BLOCK_LEN);
    this.states1 = new Float32Array(DTLN_BLOCK_LEN);
    this.states2 = new Float32Array(DTLN_BLOCK_LEN);
    this.inMag = new Float32Array(DTLN_FFT_OUT_SIZE);
    this.estimatedBlock = new Float32Array(DTLN_BLOCK_LEN);
  }

  denoise(samples, out) {
    ensureFloat32Array("inputSamples", samples);
    ensureFloat32Array("outputSamples", out);

    if (samples.length % DTLN_BLOCK_SHIFT !== 0) {
      throw new RangeError(
        `inputSamples length must be a multiple of ${DTLN_BLOCK_SHIFT}`
      );
    }

    if (out.length < samples.length) {
      throw new RangeError("outputSamples must be at least as large as inputSamples");
    }

    const totalStart = this.profilingEnabled ? nowMs() : 0;
    const numBlocks = samples.length / DTLN_BLOCK_SHIFT;

    for (let idx = 0; idx < numBlocks; idx++) {
      const offset = idx * DTLN_BLOCK_SHIFT;
      this.inBuffer.copyWithin(0, DTLN_BLOCK_SHIFT);
      this.inBuffer.set(
        samples.subarray(offset, offset + DTLN_BLOCK_SHIFT),
        DTLN_BLOCK_LEN - DTLN_BLOCK_SHIFT
      );

      this.infer();
      out.set(this.outBuffer.subarray(0, DTLN_BLOCK_SHIFT), offset);
    }

    if (this.profilingEnabled) {
      this.profile.denoiseCalls++;
      recordTiming(this.profile, "denoise_total", nowMs() - totalStart);
    }

    return false;
  }

  infer() {
    const inferStart = this.profilingEnabled ? nowMs() : 0;
    let stageStart = this.profilingEnabled ? inferStart : 0;

    this.fft.realTransform(this.fftSpectrum, this.inBuffer);
    if (this.profilingEnabled) {
      recordTiming(this.profile, "fft", nowMs() - stageStart);
      stageStart = nowMs();
    }

    for (let i = 0; i < DTLN_FFT_OUT_SIZE; i++) {
      const base = i * 2;
      this.inMag[i] = Math.hypot(
        this.fftSpectrum[base],
        this.fftSpectrum[base + 1]
      );
    }
    if (this.profilingEnabled) {
      recordTiming(this.profile, "magnitude", nowMs() - stageStart);
      stageStart = nowMs();
    }

    const model1Inputs = [
      new Tensor(this.inMag, this.model1InputShapes[0]),
      new Tensor(this.states1, this.model1InputShapes[1]),
    ];
    if (this.profilingEnabled) {
      recordTiming(this.profile, "model1_tensor", nowMs() - stageStart);
      stageStart = nowMs();
    }

    let model1Outputs;
    try {
      model1Outputs = this.model1Runner.runWithArray(model1Inputs);
    } finally {
      deleteTensors(model1Inputs);
    }
    if (this.profilingEnabled) {
      recordTiming(this.profile, "model1_invoke", nowMs() - stageStart);
      stageStart = nowMs();
    }

    const mask = model1Outputs[0].toTypedArray();
    const nextState1 = model1Outputs[1].toTypedArray();
    this.states1.set(nextState1);
    if (this.profilingEnabled) {
      recordTiming(this.profile, "model1_read", nowMs() - stageStart);
      stageStart = nowMs();
    }

    for (let i = 0; i < DTLN_FFT_OUT_SIZE; i++) {
      const base = i * 2;
      const gain = mask[i];
      this.fftSpectrum[base] *= gain;
      this.fftSpectrum[base + 1] *= gain;
    }
    if (this.profilingEnabled) {
      recordTiming(this.profile, "mask", nowMs() - stageStart);
      stageStart = nowMs();
    }

    deleteTensors(model1Outputs);

    this.fftSpectrum[1] = 0;
    this.fftSpectrum[(DTLN_FFT_OUT_SIZE - 1) * 2 + 1] = 0;
    this.fft.completeSpectrum(this.fftSpectrum);
    this.fft.inverseTransform(this.ifftComplex, this.fftSpectrum);

    for (let i = 0; i < DTLN_BLOCK_LEN; i++) {
      this.estimatedBlock[i] = this.ifftComplex[i * 2];
    }
    if (this.profilingEnabled) {
      recordTiming(this.profile, "ifft", nowMs() - stageStart);
      stageStart = nowMs();
    }

    const model2Inputs = [
      new Tensor(this.estimatedBlock, this.model2InputShapes[0]),
      new Tensor(this.states2, this.model2InputShapes[1]),
    ];
    if (this.profilingEnabled) {
      recordTiming(this.profile, "model2_tensor", nowMs() - stageStart);
      stageStart = nowMs();
    }

    let model2Outputs;
    try {
      model2Outputs = this.model2Runner.runWithArray(model2Inputs);
    } finally {
      deleteTensors(model2Inputs);
    }
    if (this.profilingEnabled) {
      recordTiming(this.profile, "model2_invoke", nowMs() - stageStart);
      stageStart = nowMs();
    }

    const outBlock = model2Outputs[0].toTypedArray();
    const nextState2 = model2Outputs[1].toTypedArray();
    this.states2.set(nextState2);
    deleteTensors(model2Outputs);
    if (this.profilingEnabled) {
      recordTiming(this.profile, "model2_read", nowMs() - stageStart);
      stageStart = nowMs();
    }

    this.outBuffer.copyWithin(0, DTLN_BLOCK_SHIFT);
    this.outBuffer.fill(0, DTLN_BLOCK_LEN - DTLN_BLOCK_SHIFT);

    for (let i = 0; i < DTLN_BLOCK_LEN; i++) {
      this.outBuffer[i] += outBlock[i];
    }

    if (this.profilingEnabled) {
      recordTiming(this.profile, "overlap_add", nowMs() - stageStart);
      this.profile.inferCalls++;
      recordTiming(this.profile, "infer_total", nowMs() - inferStart);
    }
  }

  getProfile() {
    return summarizeProfile(this.profile);
  }

  resetProfile() {
    this.profile = createProfileStore();
  }
}

/**
 * Experimental browser-only DTLN wrapper built on top of LiteRT.js.
 *
 * This keeps the existing factory + handle API shape, but it currently relies
 * on LiteRT.js internal sync runner methods to avoid changing dtln_denoise() to
 * async. Treat this file as a migration spike, not final packaging.
 */
export default async function createDtlnModule(options = {}) {
  const liteRtWasmRoot =
    options.liteRtWasmRoot ??
    defaultUrl("../../node_modules/@litertjs/core/wasm/");
  const model1Url =
    options.model1Url ?? defaultUrl("../../model/model_quant_1.tflite");
  const model2Url =
    options.model2Url ?? defaultUrl("../../model/model_quant_2.tflite");
  const threads = resolveThreadSetting(options.threads);
  const numThreads = resolveCpuThreadCount(options.numThreads);
  const profilingEnabled = options.enableProfiling === true;

  await ensureLiteRtLoaded(liteRtWasmRoot, threads);

  const compileOptions = {
    accelerator: "wasm",
    cpuOptions: {
      numThreads,
    },
  };

  const [model1, model2] = await Promise.all([
    loadAndCompile(model1Url, compileOptions),
    loadAndCompile(model2Url, compileOptions),
  ]);

  const modelDetails = {
    model1: collectModelDetails(model1),
    model2: collectModelDetails(model2),
    threads,
    numThreads,
    liteRtWasmRoot,
  };

  if (options.logModelDetails) {
    console.info("[dtln-litert] model details", modelDetails);
  }

  const handles = new Map();
  let nextHandle = 1;

  const module = {
    ready: null,
    modelDetails,
    dtln_create() {
      const handle = nextHandle++;
      handles.set(handle, new LiteRtDtlnDenoiser(model1, model2, { profilingEnabled }));
      return handle;
    },
    dtln_denoise(handle, inputSamples, outputSamples) {
      const denoiser = handles.get(handle);
      if (!denoiser) {
        throw new Error(`Unknown DTLN LiteRT handle: ${handle}`);
      }
      return denoiser.denoise(inputSamples, outputSamples);
    },
    dtln_stop(handle) {
      handles.delete(handle);
    },
    dtln_destroy(handle) {
      handles.delete(handle);
    },
    get_profile(handle) {
      const denoiser = handles.get(handle);
      if (!denoiser) {
        throw new Error(`Unknown DTLN LiteRT handle: ${handle}`);
      }
      return denoiser.getProfile();
    },
    reset_profile(handle) {
      const denoiser = handles.get(handle);
      if (!denoiser) {
        throw new Error(`Unknown DTLN LiteRT handle: ${handle}`);
      }
      denoiser.resetProfile();
    },
  };

  module.ready = Promise.resolve(module);
  return module;
}
