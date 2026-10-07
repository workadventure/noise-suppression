import deepFilterNetWorkletModuleUrl from "virtual:deepfilternet-audio-worklet-module-url";
import {
  defaultDeepFilterNetModelUrl,
  defaultDeepFilterNetWasmUrl,
} from "virtual:deepfilternet-default-assets";
import {
  DEEPFILTERNET_AUDIO_WORKLET_PROCESSOR_NAME,
  DEEPFILTERNET_SAMPLE_RATE,
  type DeepFilterNetAudioWorkletDisposeMessage,
  type DeepFilterNetAudioWorkletOutboundMessage,
  type DeepFilterNetAudioWorkletProcessorOptions,
  type DeepFilterNetAudioWorkletReadyMessage,
} from "./deepfilternet-shared";

interface AudioWorkletCapableContext extends BaseAudioContext {
  readonly audioWorklet: AudioWorklet;
}

export interface DeepFilterNetAudioWorkletOptions {
  /**
   * Most DeepFilterNet3 may attenuate while someone speaks. Unlimited (100) gates the background to silence between
   * words, which sounds like dropouts; 25 keeps a faint, steady background. Default 25.
   */
  speechAttenuationDb?: number;
  /**
   * Attenuation reached in pauses, through a pause gate after DeepFilterNet3 (adds 30 ms of latency). Set it to
   * `speechAttenuationDb` or less to disable the gate. Default 45.
   */
  pauseAttenuationDb?: number;
  /** Pass the microphone through while loading, and after a failure (otherwise silence). Default true. */
  bypassUntilReady?: boolean;
  readyTimeoutMs?: number;
  moduleUrl?: string;
  wasmUrl?: string;
  modelUrl?: string;
}

export interface DeepFilterNetAudioWorkletHandle {
  node: AudioWorkletNode;
  ready: Promise<DeepFilterNetAudioWorkletReadyMessage>;
  dispose(): void;
}

const DEFAULT_SPEECH_ATTENUATION_DB = 25;
const DEFAULT_PAUSE_ATTENUATION_DB = 45;
const DEFAULT_READY_TIMEOUT_MS = 30000;

const moduleLoadCache = new WeakMap<AudioWorkletCapableContext, Map<string, Promise<void>>>();
const wasmModuleCache = new Map<string, Promise<WebAssembly.Module>>();
const modelBytesCache = new Map<string, Promise<ArrayBuffer>>();

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let promise = cache.get(key);
  if (!promise) {
    promise = load().catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, promise);
  }
  return promise;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

// libDF wants the .tar.gz bytes. A server that sends it with `Content-Encoding: gzip` (Vite's dev server does) makes
// the browser hand over the inflated .tar, which libDF rejects with an opaque panic: gzip it again in that case.
async function ensureGzipped(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    return bytes;
  }
  const gzipped = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(gzipped).arrayBuffer();
}

function loadModule(context: AudioWorkletCapableContext, moduleUrl: string): Promise<void> {
  let contextCache = moduleLoadCache.get(context);
  if (!contextCache) {
    contextCache = new Map();
    moduleLoadCache.set(context, contextCache);
  }
  let loading = contextCache.get(moduleUrl);
  if (!loading) {
    loading = context.audioWorklet.addModule(moduleUrl);
    contextCache.set(moduleUrl, loading);
  }
  return loading;
}

function createReadyPromise(
  node: AudioWorkletNode,
  timeoutMs: number
): Promise<DeepFilterNetAudioWorkletReadyMessage> {
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the DeepFilterNet3 worklet to initialize."));
    }, timeoutMs);

    const handleMessage = (event: MessageEvent<DeepFilterNetAudioWorkletOutboundMessage>) => {
      cleanup();
      if (event.data.type === "ready") {
        resolve(event.data);
      } else {
        reject(new Error(event.data.message));
      }
    };
    const handleProcessorError = () => {
      cleanup();
      reject(new Error("The DeepFilterNet3 AudioWorklet processor failed."));
    };
    const cleanup = () => {
      globalThis.clearTimeout(timeoutId);
      node.port.removeEventListener("message", handleMessage);
      node.removeEventListener("processorerror", handleProcessorError);
    };

    node.port.addEventListener("message", handleMessage);
    node.port.start();
    node.addEventListener("processorerror", handleProcessorError);
  });
}

/**
 * Creates a DeepFilterNet3 noise suppression node. The context must run at 48 kHz (`DEEPFILTERNET_SAMPLE_RATE`):
 * unlike DTLN, DeepFilterNet3 keeps the whole voice band, up to 24 kHz.
 */
export async function createDeepFilterNetAudioWorklet(
  context: AudioWorkletCapableContext,
  options: DeepFilterNetAudioWorkletOptions = {}
): Promise<DeepFilterNetAudioWorkletHandle> {
  if (context.sampleRate !== DEEPFILTERNET_SAMPLE_RATE) {
    throw new Error(
      `DeepFilterNet3 needs a ${DEEPFILTERNET_SAMPLE_RATE} Hz AudioContext, got ${context.sampleRate} Hz.`
    );
  }

  const moduleUrl = options.moduleUrl ?? deepFilterNetWorkletModuleUrl;
  const wasmUrl = options.wasmUrl ?? defaultDeepFilterNetWasmUrl;
  const modelUrl = options.modelUrl ?? defaultDeepFilterNetModelUrl;
  const speechAttenuationDb = options.speechAttenuationDb ?? DEFAULT_SPEECH_ATTENUATION_DB;
  const pauseAttenuationDb = options.pauseAttenuationDb ?? DEFAULT_PAUSE_ATTENUATION_DB;

  const [, wasmModule, modelBytes] = await Promise.all([
    loadModule(context, moduleUrl),
    cached(wasmModuleCache, wasmUrl, async () => WebAssembly.compile(await fetchBytes(wasmUrl))),
    cached(modelBytesCache, modelUrl, async () => ensureGzipped(await fetchBytes(modelUrl))),
  ]);

  const processorOptions: DeepFilterNetAudioWorkletProcessorOptions = {
    wasmModule,
    // Structured clone copies it, so the cached bytes stay usable for the next node.
    modelBytes,
    speechAttenuationDb,
    pauseGate:
      pauseAttenuationDb > speechAttenuationDb
        ? {
            extraAttenuationDb: pauseAttenuationDb - speechAttenuationDb,
            lookaheadFrames: 3, // 30 ms
            hangoverFrames: 10, // 100 ms
            releaseDbPerFrame: 0.6, // 60 dB/s
            speechAboveFloorDb: 10,
            // DeepFilterNet3 removes keystrokes down to its limit (speechAttenuationDb); speech loses a few dB.
            maxSpeechAttenuationDb: Math.min(15, speechAttenuationDb - 5),
          }
        : undefined,
    bypassUntilReady: options.bypassUntilReady ?? true,
  };

  const node = new AudioWorkletNode(context, DEEPFILTERNET_AUDIO_WORKLET_PROCESSOR_NAME, {
    channelCount: 1,
    channelCountMode: "explicit",
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions,
  });

  return {
    node,
    ready: createReadyPromise(node, options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS),
    dispose(): void {
      const message: DeepFilterNetAudioWorkletDisposeMessage = { type: "dispose" };
      node.port.postMessage(message);
      node.disconnect();
    },
  };
}

export { DEEPFILTERNET_SAMPLE_RATE };
export type { DeepFilterNetAudioWorkletReadyMessage };
