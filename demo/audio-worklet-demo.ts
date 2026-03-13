import {
  createNoiseSuppressionAudioWorklet,
  isNoiseSuppressionProcessingStartedMessage,
  observeNoiseSuppressionAudioWorkletMessages,
} from "../src/audio-worklet";
import "./styles.css";

function metric(label: string, value: string): string {
  return `
    <div>
      <span class="metric-label">${label}</span>
      <span class="metric-value">${value}</span>
    </div>
  `;
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app container");
}

app.innerHTML = `
  <section class="hero">
    <p class="eyebrow">AudioWorklet Demo</p>
    <h1>Noise suppression in the render thread</h1>
    <p class="lead">
      This page uses the public AudioWorklet entrypoint, initializes the forked
      LiteRT bootstrap inside <code>AudioWorkletGlobalScope</code>, and starts
      processing on a live constant source.
    </p>
    <p class="status" id="status">Waiting to start AudioWorklet initialization...</p>
    <p>
      <button id="start-button" type="button">Start worklet</button>
    </p>
  </section>
  <section class="panel-grid">
    <article class="panel">
      <h2>Runtime</h2>
      <div class="metrics" id="runtime-metrics"></div>
    </article>
    <article class="panel">
      <h2>State</h2>
      <div class="metrics" id="state-metrics"></div>
    </article>
  </section>
  <section class="details">
    <div class="panel">
      <h2>Messages</h2>
      <pre id="messages">No messages yet.</pre>
    </div>
  </section>
`;

const status = document.querySelector<HTMLParagraphElement>("#status");
const startButton = document.querySelector<HTMLButtonElement>("#start-button");
const runtimeMetrics = document.querySelector<HTMLDivElement>("#runtime-metrics");
const stateMetrics = document.querySelector<HTMLDivElement>("#state-metrics");
const messages = document.querySelector<HTMLPreElement>("#messages");

if (!status || !startButton || !runtimeMetrics || !stateMetrics || !messages) {
  throw new Error("Missing expected AudioWorklet demo elements");
}

const statusElement = status;
const startButtonElement = startButton;
const runtimeMetricsElement = runtimeMetrics;
const stateMetricsElement = stateMetrics;
const messagesElement = messages;

function appendMessage(message: string): void {
  const current = messagesElement.textContent ?? "";
  messagesElement.textContent =
    current === "No messages yet." ? message : `${current}\n${message}`;
}

startButtonElement.addEventListener("click", () => {
  startButtonElement.disabled = true;
  void startDemo();
});

async function startDemo(): Promise<void> {
  try {
    statusElement.textContent = "Creating AudioContext and initializing worklet...";

    const context = new AudioContext({ sampleRate: 16000 });
    const source = new ConstantSourceNode(context, { offset: 0 });
    source.start();
    await context.resume();
    appendMessage("AudioContext resumed.");

    const worklet = await createNoiseSuppressionAudioWorklet(context, {
      threads: false,
      numThreads: 1,
    });

    appendMessage(`Module URL: ${worklet.moduleUrl}`);

    const stopObserving = observeNoiseSuppressionAudioWorkletMessages(
      worklet,
      (message) => {
        appendMessage(JSON.stringify(message, null, 2));

        if (isNoiseSuppressionProcessingStartedMessage(message)) {
          stateMetricsElement.innerHTML = [
            metric("Processing", "started"),
            metric("Processed quanta", String(message.processedQuanta)),
          ].join("");
        }
      }
    );

    const readyMessage = await worklet.ready;

    runtimeMetricsElement.innerHTML = [
      metric("Cross-origin isolated", globalThis.crossOriginIsolated ? "yes" : "no"),
      metric("LiteRT threads", readyMessage.modelDetails.threads ? "enabled" : "disabled"),
      metric("Configured CPU threads", String(readyMessage.modelDetails.numThreads)),
    ].join("");

    source.connect(worklet.node).connect(context.destination);
    statusElement.textContent = "AudioWorklet ready and connected.";

    worklet.node.addEventListener("processorerror", () => {
      stopObserving();
      statusElement.textContent = "AudioWorklet processor error.";
      statusElement.classList.add("error");
    });
  } catch (error) {
    console.error(error);
    statusElement.textContent = `Failed to initialize AudioWorklet: ${String(error)}`;
    statusElement.classList.add("error");
    startButtonElement.disabled = false;
  }
}
