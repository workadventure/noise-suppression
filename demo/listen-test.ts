import restaurantClipUrl from "../clips/restaurant_noisy.wav?url";
import helicopterClipUrl from "../clips/trump_vs_helicopter.wav?url";
import airConditioningClipUrl from "../clips/airconditioning.wav?url";
import dogBarkingClipUrl from "../clips/dog_barking_noisy.wav?url";
import {
  createNoiseSuppressionAudioWorklet,
  isNoiseSuppressionProcessingStartedMessage,
  observeNoiseSuppressionAudioWorkletMessages,
  type NoiseSuppressionAudioWorkletHandle,
} from "../src/audio-worklet";
import "./styles.css";

type SourceMode = "microphone" | "clip" | "file";
type ProcessingMode = "bypass" | "denoise";

interface ActiveGraph {
  context: AudioContext;
  sourceNode: AudioNode;
  outputGain: GainNode;
  microphoneStream?: MediaStream;
  bufferSource?: AudioBufferSourceNode;
  worklet?: NoiseSuppressionAudioWorkletHandle;
  stopMessages?: () => void;
}

const clips = [
  { label: "Restaurant", url: restaurantClipUrl },
  { label: "Helicopter", url: helicopterClipUrl },
  { label: "Air conditioning", url: airConditioningClipUrl },
  { label: "Dog barking", url: dogBarkingClipUrl },
] as const;

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app container");
}

app.innerHTML = `
  <section class="hero">
    <p class="eyebrow">Listen Test</p>
    <h1>Noise suppression monitor</h1>
    <p class="lead">
      Route microphone or sample audio to local playback, then switch between
      direct output and the AudioWorklet denoiser.
    </p>
    <p class="status" id="status">Idle. Keep output low when monitoring a live microphone.</p>
  </section>

  <section class="listen-surface">
    <div class="listen-toolbar" aria-label="Listen test controls">
      <fieldset>
        <legend>Source</legend>
        <label><input type="radio" name="source-mode" value="microphone" checked> Microphone</label>
        <label><input type="radio" name="source-mode" value="clip"> Clip</label>
        <label><input type="radio" name="source-mode" value="file"> File</label>
      </fieldset>

      <fieldset>
        <legend>Processing</legend>
        <label><input type="radio" name="processing-mode" value="denoise" checked> Worklet</label>
        <label><input type="radio" name="processing-mode" value="bypass"> Bypass</label>
      </fieldset>

      <label class="stacked-control">
        <span>Clip</span>
        <select id="clip-select">
          ${clips.map((clip, index) => `<option value="${index}">${clip.label}</option>`).join("")}
        </select>
      </label>

      <label class="stacked-control">
        <span>File</span>
        <input id="file-input" type="file" accept="audio/*">
      </label>

      <label class="stacked-control gain-control">
        <span>Output</span>
        <input id="gain-input" type="range" min="0" max="1.5" value="0.45" step="0.01">
      </label>

      <div class="button-row">
        <button id="start-button" type="button">Start</button>
        <button id="stop-button" type="button" disabled>Stop</button>
      </div>
    </div>
  </section>

  <section class="panel-grid">
    <article class="panel">
      <h2>Runtime</h2>
      <div class="metrics" id="runtime-metrics"></div>
    </article>
    <article class="panel">
      <h2>Signal</h2>
      <div class="metrics" id="signal-metrics"></div>
    </article>
  </section>

  <section class="details">
    <div class="panel">
      <h2>Messages</h2>
      <pre id="messages">No messages yet.</pre>
    </div>
  </section>
`;

const statusElement = mustQuery<HTMLParagraphElement>("#status");
const startButton = mustQuery<HTMLButtonElement>("#start-button");
const stopButton = mustQuery<HTMLButtonElement>("#stop-button");
const clipSelect = mustQuery<HTMLSelectElement>("#clip-select");
const fileInput = mustQuery<HTMLInputElement>("#file-input");
const gainInput = mustQuery<HTMLInputElement>("#gain-input");
const runtimeMetrics = mustQuery<HTMLDivElement>("#runtime-metrics");
const signalMetrics = mustQuery<HTMLDivElement>("#signal-metrics");
const messages = mustQuery<HTMLPreElement>("#messages");

let activeGraph: ActiveGraph | null = null;

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
}

function selectedRadioValue<T extends string>(name: string): T {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);

  if (!input) {
    throw new Error(`Missing selected radio: ${name}`);
  }

  return input.value as T;
}

function metric(label: string, value: string): string {
  return `
    <div>
      <span class="metric-label">${label}</span>
      <span class="metric-value">${value}</span>
    </div>
  `;
}

function appendMessage(message: string): void {
  const current = messages.textContent ?? "";
  messages.textContent = current === "No messages yet." ? message : `${current}\n${message}`;
}

function setStatus(message: string, isError = false): void {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

async function createSource(
  context: AudioContext,
  sourceMode: SourceMode
): Promise<Pick<ActiveGraph, "sourceNode" | "microphoneStream" | "bufferSource">> {
  if (sourceMode === "microphone") {
    const microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    return {
      sourceNode: context.createMediaStreamSource(microphoneStream),
      microphoneStream,
    };
  }

  const audioBuffer = await loadAudioBuffer(context, sourceMode);
  const bufferSource = new AudioBufferSourceNode(context, {
    buffer: audioBuffer,
    loop: true,
  });
  bufferSource.start();

  return {
    sourceNode: bufferSource,
    bufferSource,
  };
}

async function loadAudioBuffer(
  context: AudioContext,
  sourceMode: SourceMode
): Promise<AudioBuffer> {
  if (sourceMode === "file") {
    const file = fileInput.files?.[0];

    if (!file) {
      throw new Error("Choose an audio file first.");
    }

    return context.decodeAudioData(await file.arrayBuffer());
  }

  const clip = clips[Number(clipSelect.value)] ?? clips[0];
  const response = await fetch(clip.url);

  if (!response.ok) {
    throw new Error(`Failed to load clip: ${response.status}`);
  }

  return context.decodeAudioData(await response.arrayBuffer());
}

async function connectGraph(graph: ActiveGraph, processingMode: ProcessingMode): Promise<void> {
  graph.sourceNode.disconnect();
  graph.outputGain.disconnect();

  if (processingMode === "denoise") {
    graph.worklet ??= await createNoiseSuppressionAudioWorklet(graph.context, {
      threads: false,
      numThreads: 1,
      bypassUntilReady: true,
    });

    graph.stopMessages ??= observeNoiseSuppressionAudioWorkletMessages(
      graph.worklet,
      (message) => {
        appendMessage(JSON.stringify(message, null, 2));

        if (isNoiseSuppressionProcessingStartedMessage(message)) {
          signalMetrics.innerHTML = [
            metric("Mode", "worklet"),
            metric("Processed quanta", String(message.processedQuanta)),
          ].join("");
        }
      }
    );

    const ready = await graph.worklet.ready;
    graph.sourceNode.connect(graph.worklet.node).connect(graph.outputGain).connect(graph.context.destination);
    runtimeMetrics.innerHTML = [
      metric("Worklet", "ready"),
      metric("CPU threads", String(ready.modelDetails.numThreads)),
      metric("Source rate", `${graph.context.sampleRate} Hz`),
    ].join("");
    return;
  }

  graph.sourceNode.connect(graph.outputGain).connect(graph.context.destination);
  signalMetrics.innerHTML = [metric("Mode", "bypass"), metric("Processed quanta", "-")].join("");
}

async function start(): Promise<void> {
  await stop();

  const sourceMode = selectedRadioValue<SourceMode>("source-mode");
  const processingMode = selectedRadioValue<ProcessingMode>("processing-mode");

  startButton.disabled = true;
  stopButton.disabled = false;
  setStatus("Starting audio graph...");
  messages.textContent = "No messages yet.";

  try {
    const context = new AudioContext({ sampleRate: 16000 });
    const outputGain = new GainNode(context, {
      gain: Number(gainInput.value),
    });
    const source = await createSource(context, sourceMode);

    activeGraph = {
      context,
      outputGain,
      ...source,
    };

    await context.resume();
    await connectGraph(activeGraph, processingMode);

    setStatus("Playing locally.");
    signalMetrics.innerHTML = [
      metric("Source", sourceMode),
      metric("Output gain", Number(gainInput.value).toFixed(2)),
    ].join("");
  } catch (error) {
    await stop();
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    startButton.disabled = false;
  }
}

async function stop(): Promise<void> {
  const graph = activeGraph;
  activeGraph = null;

  if (!graph) {
    stopButton.disabled = true;
    return;
  }

  graph.stopMessages?.();
  graph.worklet?.dispose();
  graph.bufferSource?.stop();
  graph.microphoneStream?.getTracks().forEach((track) => track.stop());
  graph.sourceNode.disconnect();
  graph.outputGain.disconnect();
  await graph.context.close();

  stopButton.disabled = true;
  setStatus("Stopped.");
}

startButton.addEventListener("click", () => {
  void start();
});

stopButton.addEventListener("click", () => {
  void stop();
});

gainInput.addEventListener("input", () => {
  if (activeGraph) {
    activeGraph.outputGain.gain.value = Number(gainInput.value);
  }

  signalMetrics.innerHTML = [
    metric("Output gain", Number(gainInput.value).toFixed(2)),
    metric("Context", activeGraph ? activeGraph.context.state : "idle"),
  ].join("");
});

document.querySelectorAll<HTMLInputElement>('input[name="processing-mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (!activeGraph) {
      return;
    }

    setStatus("Switching route...");
    void connectGraph(activeGraph, selectedRadioValue<ProcessingMode>("processing-mode"))
      .then(() => setStatus("Playing locally."))
      .catch((error: unknown) => {
        console.error(error);
        setStatus(error instanceof Error ? error.message : String(error), true);
      });
  });
});

window.addEventListener("pagehide", () => {
  void stop();
});
