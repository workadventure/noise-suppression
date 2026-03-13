import model1Url from "../model/model_quant_1.tflite?url";
import model2Url from "../model/model_quant_2.tflite?url";
import liteRtWasmUrl from "../forks/litertjs-core/wasm/litert_wasm_internal.wasm?url";
import {
  createNoiseSuppressionAudioWorklet,
  isNoiseSuppressionProcessingStartedMessage,
  observeNoiseSuppressionAudioWorkletMessages,
} from "../src/audio-worklet";
import controlProcessorUrl from "./audio-worklet-control-processor.ts?worker&url";
import importCoreProcessorUrl from "./audio-worklet-import-core-processor.ts?worker&url";
import importFftProcessorUrl from "./audio-worklet-import-fft-processor.ts?worker&url";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app container");
}

app.innerHTML = `
  <section class="hero">
    <p class="eyebrow">AudioWorklet Validation</p>
    <h1>LiteRT.js initialization in AudioWorkletGlobalScope</h1>
    <p class="lead">
      This page runs three AudioWorklet probes: a bare processor, a processor
      that imports <code>@litertjs/core</code>, a processor that imports
      <code>fft.js</code>, and the public AudioWorklet entrypoint that loads the
      full denoiser from bundled bytes on the main thread.
    </p>
    <p class="status" id="status">Waiting to start validation...</p>
    <p>
      <button id="start-button" type="button">Run validation</button>
    </p>
  </section>
  <section class="panel-grid">
    <article class="panel">
      <h2>Environment</h2>
      <div class="metrics" id="environment"></div>
    </article>
    <article class="panel">
      <h2>Messages</h2>
      <pre id="messages">No messages yet.</pre>
    </article>
  </section>
`;

const status = document.querySelector<HTMLParagraphElement>("#status");
const startButton = document.querySelector<HTMLButtonElement>("#start-button");
const environment = document.querySelector<HTMLDivElement>("#environment");
const messages = document.querySelector<HTMLPreElement>("#messages");

if (!status || !startButton || !environment || !messages) {
  throw new Error("Missing expected validation elements");
}

const statusElement = status;
const startButtonElement = startButton;
const environmentElement = environment;
const messagesElement = messages;

function appendMessage(message: string): void {
  const current = messagesElement.textContent ?? "";
  messagesElement.textContent =
    current === "No messages yet." ? message : `${current}\n${message}`;
}

function metric(label: string, value: string): string {
  return `
    <div>
      <span class="metric-label">${label}</span>
      <span class="metric-value">${value}</span>
    </div>
  `;
}

environmentElement.innerHTML = [
  metric("Cross-origin isolated", globalThis.crossOriginIsolated ? "yes" : "no"),
  metric("Model 1 URL", model1Url),
  metric("Model 2 URL", model2Url),
  metric("LiteRT Wasm asset", liteRtWasmUrl),
].join("");

async function startValidation(): Promise<void> {
  startButtonElement.disabled = true;
  statusElement.textContent = "Creating AudioContext and running AudioWorklet probes...";
  appendMessage("Starting validation.");

  try {
    const context = new AudioContext({ sampleRate: 16000 });
    const source = new ConstantSourceNode(context, { offset: 0 });
    source.connect(context.destination);
    source.start();
    await context.resume();
    appendMessage("AudioContext resumed.");

    await runProbe(context, source, {
      label: "control",
      moduleUrl: controlProcessorUrl,
      processorName: "noise-suppression-control",
      processorOptions: {
        liteRtWasmRoot: "/vendor/litert/",
      },
    });

    await runProbe(context, source, {
      label: "import-core",
      moduleUrl: importCoreProcessorUrl,
      processorName: "noise-suppression-import-core",
      processorOptions: {
        liteRtWasmRoot: "/vendor/litert/",
      },
    });

    await runProbe(context, source, {
      label: "import-fft",
      moduleUrl: importFftProcessorUrl,
      processorName: "noise-suppression-import-fft",
      processorOptions: {
        liteRtWasmRoot: "/vendor/litert/",
      },
    });

    await runPublicWorkletProbe(context, source);

    statusElement.textContent =
      "All AudioWorklet probes completed. Inspect the messages for initialization and processing status.";
  } catch (error) {
    console.error(error);
    appendMessage(String(error));
    statusElement.textContent = `Validation failed before worklet init: ${String(error)}`;
    statusElement.classList.add("error");
    startButtonElement.disabled = false;
  }
}

interface ProbeConfig {
  label: string;
  moduleUrl: string;
  processorName: string;
  processorOptions: Record<string, unknown>;
}

async function runProbe(
  context: AudioContext,
  source: ConstantSourceNode,
  config: ProbeConfig
): Promise<void> {
  appendMessage(`[${config.label}] loading module: ${config.moduleUrl}`);
  await context.audioWorklet.addModule(config.moduleUrl);
  appendMessage(`[${config.label}] module loaded.`);

  const node = new AudioWorkletNode(context, config.processorName, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: config.processorOptions,
  });

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`[${config.label}] timed out waiting for worklet message`));
    }, 10000);

    node.port.onmessage = (event: MessageEvent<unknown>) => {
      appendMessage(`[${config.label}] ${JSON.stringify(event.data, null, 2)}`);
      window.clearTimeout(timeoutId);
      source.connect(node).connect(context.destination);
      resolve();
    };

    node.onprocessorerror = (event: Event) => {
      window.clearTimeout(timeoutId);
      reject(new Error(`[${config.label}] processorerror: ${event.type}`));
    };
  });
}

async function runPublicWorkletProbe(
  context: AudioContext,
  source: ConstantSourceNode
): Promise<void> {
  appendMessage("[full-init] creating public AudioWorklet handle.");

  const worklet = await createNoiseSuppressionAudioWorklet(context, {
    liteRtWasmUrl,
    model1Url,
    model2Url,
    threads: false,
    numThreads: 1,
  });

  appendMessage(`[full-init] module loaded: ${worklet.moduleUrl}`);

  const processingStarted = new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      stopObserving();
      reject(new Error("[full-init] timed out waiting for processing to start"));
    }, 10000);

    const stopObserving = observeNoiseSuppressionAudioWorkletMessages(
      worklet,
      (message) => {
        if (isNoiseSuppressionProcessingStartedMessage(message)) {
          appendMessage(`[full-init] ${JSON.stringify(message, null, 2)}`);
          window.clearTimeout(timeoutId);
          stopObserving();
          resolve();
        }
      }
    );
  });

  source.connect(worklet.node).connect(context.destination);

  const readyMessage = await worklet.ready;
  appendMessage(`[full-init] ${JSON.stringify(readyMessage, null, 2)}`);
  await processingStarted;
}

startButtonElement.addEventListener("click", () => {
  void startValidation();
});
