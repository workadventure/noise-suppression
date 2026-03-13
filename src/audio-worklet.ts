import bundledLiteRtWasmUrl from "../forks/litertjs-core/wasm/litert_wasm_internal.wasm?url";
import processorModuleUrl from "./audio-worklet-processor.ts?worker&url";
import {
  resolveBrowserCpuThreadCount,
  resolveDefaultModel1Url,
  resolveDefaultModel2Url,
  resolveThreadSetting,
} from "./browser-runtime-options";
import {
  NOISE_SUPPRESSION_AUDIO_WORKLET_PROCESSOR_NAME,
  type NoiseSuppressionAudioWorkletBenchmarkCompleteMessage,
  type NoiseSuppressionAudioWorkletBenchmarkOptions,
  type NoiseSuppressionAudioWorkletErrorMessage,
  type NoiseSuppressionAudioWorkletInboundMessage,
  type NoiseSuppressionAudioWorkletOutboundMessage,
  type NoiseSuppressionAudioWorkletProcessingStartedMessage,
  type NoiseSuppressionAudioWorkletProcessorOptions,
  type NoiseSuppressionAudioWorkletReadyMessage,
} from "./audio-worklet-shared";

interface AudioWorkletCapableContext extends BaseAudioContext {
  readonly audioWorklet: AudioWorklet;
}

export interface NoiseSuppressionAudioWorkletOptions {
  moduleUrl?: string;
  liteRtWasmUrl?: string;
  model1Url?: string;
  model2Url?: string;
  threads?: boolean;
  numThreads?: number;
  bypassUntilReady?: boolean;
  readyTimeoutMs?: number;
}

export interface NoiseSuppressionAudioWorkletHandle {
  node: AudioWorkletNode;
  ready: Promise<NoiseSuppressionAudioWorkletReadyMessage>;
  moduleUrl: string;
  processorName: string;
  dispose(): void;
}

const DEFAULT_READY_TIMEOUT_MS = 30000;
const moduleLoadCache = new WeakMap<AudioWorkletCapableContext, Map<string, Promise<void>>>();

function getModuleLoadPromise(
  context: AudioWorkletCapableContext,
  moduleUrl: string
): Promise<void> {
  let contextCache = moduleLoadCache.get(context);
  if (!contextCache) {
    contextCache = new Map<string, Promise<void>>();
    moduleLoadCache.set(context, contextCache);
  }

  const existing = contextCache.get(moduleUrl);
  if (existing) {
    return existing;
  }

  const loading = context.audioWorklet.addModule(moduleUrl);
  contextCache.set(moduleUrl, loading);
  return loading;
}

async function fetchBinaryAsset(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset ${url}: ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function isReadyMessage(
  value: NoiseSuppressionAudioWorkletOutboundMessage
): value is NoiseSuppressionAudioWorkletReadyMessage {
  return value.type === "ready";
}

function isErrorMessage(
  value: NoiseSuppressionAudioWorkletOutboundMessage
): value is NoiseSuppressionAudioWorkletErrorMessage {
  return value.type === "error";
}

function isBenchmarkCompleteMessage(
  value: NoiseSuppressionAudioWorkletOutboundMessage
): value is NoiseSuppressionAudioWorkletBenchmarkCompleteMessage {
  return value.type === "benchmark-complete";
}

function createReadyPromise(
  node: AudioWorkletNode,
  timeoutMs: number
): Promise<NoiseSuppressionAudioWorkletReadyMessage> {
  return new Promise<NoiseSuppressionAudioWorkletReadyMessage>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the noise suppression worklet to initialize."));
    }, timeoutMs);

    const handleMessage = (event: MessageEvent<NoiseSuppressionAudioWorkletOutboundMessage>) => {
      const message = event.data;

      if (isReadyMessage(message)) {
        cleanup();
        resolve(message);
        return;
      }

      if (isErrorMessage(message)) {
        cleanup();
        reject(new Error(message.message));
      }
    };

    const handleProcessorError = () => {
      cleanup();
      reject(new Error("The noise suppression AudioWorklet processor failed."));
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

export async function createNoiseSuppressionAudioWorklet(
  context: AudioWorkletCapableContext,
  options: NoiseSuppressionAudioWorkletOptions = {}
): Promise<NoiseSuppressionAudioWorkletHandle> {
  const moduleUrl = options.moduleUrl ?? processorModuleUrl;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const threads = resolveThreadSetting(options.threads);
  const numThreads = resolveBrowserCpuThreadCount(options.numThreads);
  const bypassUntilReady = options.bypassUntilReady ?? true;
  const model1Url = options.model1Url ?? resolveDefaultModel1Url();
  const model2Url = options.model2Url ?? resolveDefaultModel2Url();
  const liteRtWasmUrl = options.liteRtWasmUrl ?? bundledLiteRtWasmUrl;

  const assetPromises = [
    fetchBinaryAsset(model1Url),
    fetchBinaryAsset(model2Url),
    fetchBinaryAsset(liteRtWasmUrl),
  ] as const;

  const [assetResults] = await Promise.all([
    Promise.all(assetPromises),
    getModuleLoadPromise(context, moduleUrl),
  ]);
  const [model1Data, model2Data, liteRtWasmBinary] = assetResults;

  const processorOptions: NoiseSuppressionAudioWorkletProcessorOptions = {
    liteRtWasmBinary,
    model1Data,
    model2Data,
    threads,
    numThreads,
    bypassUntilReady,
  };

  const node = new AudioWorkletNode(
    context,
    NOISE_SUPPRESSION_AUDIO_WORKLET_PROCESSOR_NAME,
    {
      channelCount: 1,
      channelCountMode: "explicit",
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions,
    }
  );

  const ready = createReadyPromise(node, readyTimeoutMs);

  return {
    node,
    ready,
    moduleUrl,
    processorName: NOISE_SUPPRESSION_AUDIO_WORKLET_PROCESSOR_NAME,
    dispose(): void {
      const message: NoiseSuppressionAudioWorkletInboundMessage = {
        type: "dispose",
      };
      node.port.postMessage(message);
      node.disconnect();
    },
  };
}

export function observeNoiseSuppressionAudioWorkletMessages(
  handle: NoiseSuppressionAudioWorkletHandle,
  listener: (message: NoiseSuppressionAudioWorkletOutboundMessage) => void
): () => void {
  const handleMessage = (event: MessageEvent<NoiseSuppressionAudioWorkletOutboundMessage>) => {
    listener(event.data);
  };

  handle.node.port.addEventListener("message", handleMessage);
  handle.node.port.start();

  return () => {
    handle.node.port.removeEventListener("message", handleMessage);
  };
}

export function isNoiseSuppressionProcessingStartedMessage(
  message: NoiseSuppressionAudioWorkletOutboundMessage
): message is NoiseSuppressionAudioWorkletProcessingStartedMessage {
  return message.type === "processing-started";
}

export async function runNoiseSuppressionAudioWorkletBenchmark(
  handle: NoiseSuppressionAudioWorkletHandle,
  options: NoiseSuppressionAudioWorkletBenchmarkOptions = {}
): Promise<NoiseSuppressionAudioWorkletBenchmarkCompleteMessage> {
  const warmupIterations = options.warmupIterations ?? 40;
  const benchmarkIterations = options.benchmarkIterations ?? 300;

  await handle.ready;

  return new Promise<NoiseSuppressionAudioWorkletBenchmarkCompleteMessage>(
    (resolve, reject) => {
      const handleMessage = (
        event: MessageEvent<NoiseSuppressionAudioWorkletOutboundMessage>
      ) => {
        const message = event.data;

        if (isBenchmarkCompleteMessage(message)) {
          cleanup();
          resolve(message);
          return;
        }

        if (isErrorMessage(message)) {
          cleanup();
          reject(new Error(message.message));
        }
      };

      const handleProcessorError = () => {
        cleanup();
        reject(new Error("The noise suppression AudioWorklet processor failed."));
      };

      const cleanup = () => {
        handle.node.port.removeEventListener("message", handleMessage);
        handle.node.removeEventListener("processorerror", handleProcessorError);
      };

      handle.node.port.addEventListener("message", handleMessage);
      handle.node.port.start();
      handle.node.addEventListener("processorerror", handleProcessorError);

      const message: NoiseSuppressionAudioWorkletInboundMessage = {
        type: "start-benchmark",
        warmupIterations,
        benchmarkIterations,
      };
      handle.node.port.postMessage(message);
    }
  );
}

export type {
  NoiseSuppressionAudioWorkletBenchmarkCompleteMessage,
  NoiseSuppressionAudioWorkletBenchmarkOptions,
  NoiseSuppressionAudioWorkletErrorMessage,
  NoiseSuppressionAudioWorkletOutboundMessage,
  NoiseSuppressionAudioWorkletProcessingStartedMessage,
  NoiseSuppressionAudioWorkletReadyMessage,
} from "./audio-worklet-shared";

export { NOISE_SUPPRESSION_AUDIO_WORKLET_PROCESSOR_NAME };
