import restaurantClipUrl from "../clips/restaurant_noisy.wav?url";
import helicopterClipUrl from "../clips/trump_vs_helicopter.wav?url";
import airConditioningClipUrl from "../clips/airconditioning.wav?url";
import dogBarkingClipUrl from "../clips/dog_barking_noisy.wav?url";
import pureNoiseClipUrl from "../clips/pure-noise.wav?url";
import {
  createBackgroundNoiseDetectorAudioWorklet,
  isBackgroundNoiseDetectedMessage,
  observeBackgroundNoiseDetectorAudioWorkletMessages,
  type BackgroundNoiseDetectorAudioWorkletHandle,
  type BackgroundNoiseDetectorAudioWorkletOptions,
} from "../src/background-noise-worklet";
import "./styles.css";

type SourceMode = "microphone" | "clip";
type VadMode = NonNullable<BackgroundNoiseDetectorAudioWorkletOptions["vadMode"]>;

interface ActiveGraph {
  context: AudioContext;
  sourceMode: SourceMode;
  sourceNode: AudioNode;
  analyserNode: AnalyserNode;
  outputGain: GainNode;
  worklet: BackgroundNoiseDetectorAudioWorkletHandle;
  stopMessages: () => void;
  animationFrameId: number;
  frameSamples: number;
  microphoneStream: MediaStream | undefined;
  bufferSource: AudioBufferSourceNode | undefined;
}

const clips = [
  { label: "Restaurant", url: restaurantClipUrl },
  { label: "Helicopter", url: helicopterClipUrl },
  { label: "Air conditioning", url: airConditioningClipUrl },
  { label: "Dog barking", url: dogBarkingClipUrl },
  { label: "Pure noise", url: pureNoiseClipUrl },
] as const;

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app container");
}

app.innerHTML = `
  <section class="hero">
    <p class="eyebrow">Background Noise Detector</p>
    <h1>Detect loud non-speech input</h1>
    <p class="lead">
      This demo runs the standalone detector AudioWorklet on microphone input
      or packaged clips, keeps microphone playback muted, and reports
      background-noise events from the render thread.
    </p>
    <p class="status" id="status">Idle. Start a source to tune detector thresholds.</p>
  </section>

  <section class="listen-surface">
    <div class="listen-toolbar background-noise-controls" aria-label="Background noise detector controls">
      <label class="stacked-control">
        <span>Source</span>
        <select id="source-mode-select">
          <option value="microphone" selected>Microphone</option>
          <option value="clip">Clip</option>
        </select>
      </label>

      <label class="stacked-control">
        <span>Clip</span>
        <select id="clip-select">
          ${clips.map((clip, index) => `<option value="${index}">${clip.label}</option>`).join("")}
        </select>
      </label>

      <label class="stacked-control">
        <span>Output</span>
        <input id="output-gain-input" type="range" min="0" max="1" value="0.35" step="0.01">
      </label>

      <label class="stacked-control">
        <span>VAD mode</span>
        <select id="vad-mode-select">
          <option value="normal">Normal</option>
          <option value="low-bitrate">Low bitrate</option>
          <option value="aggressive" selected>Aggressive</option>
          <option value="very-aggressive">Very aggressive</option>
        </select>
      </label>

      <label class="stacked-control">
        <span>Trigger RMS</span>
        <input id="trigger-rms-input" type="number" min="0" max="1" step="0.001" value="0.01">
      </label>

      <label class="stacked-control">
        <span>Noisy RMS</span>
        <input id="noisy-rms-input" type="number" min="0" max="1" step="0.001" value="0.02">
      </label>

      <label class="stacked-control">
        <span>Window ms</span>
        <input id="analysis-window-input" type="number" min="30" step="100" value="1500">
      </label>

      <label class="stacked-control">
        <span>Max voice ratio</span>
        <input id="max-voice-ratio-input" type="number" min="0" max="1" step="0.05" value="0.2">
      </label>

      <label class="stacked-control">
        <span>Cooldown ms</span>
        <input id="cooldown-input" type="number" min="0" step="1000" value="15000">
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
      <h2>Input</h2>
      <div class="metrics" id="input-metrics"></div>
    </article>
    <article class="panel">
      <h2>Events</h2>
      <div class="metrics" id="event-metrics"></div>
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
const sourceModeSelect = mustQuery<HTMLSelectElement>("#source-mode-select");
const clipSelect = mustQuery<HTMLSelectElement>("#clip-select");
const outputGainInput = mustQuery<HTMLInputElement>("#output-gain-input");
const vadModeSelect = mustQuery<HTMLSelectElement>("#vad-mode-select");
const triggerRmsInput = mustQuery<HTMLInputElement>("#trigger-rms-input");
const noisyRmsInput = mustQuery<HTMLInputElement>("#noisy-rms-input");
const analysisWindowInput = mustQuery<HTMLInputElement>("#analysis-window-input");
const maxVoiceRatioInput = mustQuery<HTMLInputElement>("#max-voice-ratio-input");
const cooldownInput = mustQuery<HTMLInputElement>("#cooldown-input");
const startButton = mustQuery<HTMLButtonElement>("#start-button");
const stopButton = mustQuery<HTMLButtonElement>("#stop-button");
const runtimeMetrics = mustQuery<HTMLDivElement>("#runtime-metrics");
const inputMetrics = mustQuery<HTMLDivElement>("#input-metrics");
const eventMetrics = mustQuery<HTMLDivElement>("#event-metrics");
const messages = mustQuery<HTMLPreElement>("#messages");

let activeGraph: ActiveGraph | null = null;
let eventCount = 0;
let lastVoiceFrameRatio: number | null = null;

runtimeMetrics.innerHTML = [
  metric("Worklet", "idle"),
  metric("Context", "idle"),
  metric("Sample rate", "-"),
].join("");
inputMetrics.innerHTML = [
  metric("Live RMS", "-"),
  metric("Live dBFS", "-"),
  metric("Last voice ratio", "-"),
].join("");
eventMetrics.innerHTML = [
  metric("Event count", "0"),
  metric("Last event RMS", "-"),
  metric("Active ratio", "-"),
].join("");

function mustQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }

  return element;
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

function finiteInputValue(input: HTMLInputElement, label: string): number {
  if (!Number.isFinite(input.valueAsNumber)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return input.valueAsNumber;
}

function readWorkletOptions(): BackgroundNoiseDetectorAudioWorkletOptions {
  return {
    vadMode: vadModeSelect.value as VadMode,
    triggerRms: finiteInputValue(triggerRmsInput, "Trigger RMS"),
    noisyRms: finiteInputValue(noisyRmsInput, "Noisy RMS"),
    analysisWindowMs: finiteInputValue(analysisWindowInput, "Window ms"),
    maxVoiceFrameRatio: finiteInputValue(maxVoiceRatioInput, "Max voice ratio"),
    cooldownMs: finiteInputValue(cooldownInput, "Cooldown ms"),
  };
}

function readSourceMode(): SourceMode {
  return sourceModeSelect.value === "clip" ? "clip" : "microphone";
}

function readOutputGain(sourceMode: SourceMode): number {
  if (sourceMode === "microphone") {
    return 0;
  }

  return finiteInputValue(outputGainInput, "Output");
}

function updateSourceControls(): void {
  const sourceMode = readSourceMode();
  clipSelect.disabled = sourceMode !== "clip";
  outputGainInput.disabled = sourceMode !== "clip";
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
      bufferSource: undefined,
    };
  }

  const clip = clips[Number(clipSelect.value)] ?? clips[0];
  const response = await fetch(clip.url);

  if (!response.ok) {
    throw new Error(`Failed to load clip: ${response.status}`);
  }

  const audioBuffer = await context.decodeAudioData(await response.arrayBuffer());
  const bufferSource = new AudioBufferSourceNode(context, {
    buffer: audioBuffer,
    loop: true,
  });
  bufferSource.start();

  return {
    sourceNode: bufferSource,
    microphoneStream: undefined,
    bufferSource,
  };
}

function rmsToDbfs(rms: number): string {
  if (rms <= 0) {
    return "-Infinity";
  }

  return (20 * Math.log10(rms)).toFixed(1);
}

function formatRatio(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function updateInputMetrics(rms: number): void {
  inputMetrics.innerHTML = [
    metric("Live RMS", rms.toFixed(5)),
    metric("Live dBFS", `${rmsToDbfs(rms)} dB`),
    metric("Last voice ratio", formatRatio(lastVoiceFrameRatio)),
  ].join("");
}

function calculateAnalyserRms(samples: Float32Array): number {
  let squareSum = 0;

  for (const sample of samples) {
    squareSum += sample * sample;
  }

  return Math.sqrt(squareSum / samples.length);
}

function startRmsLoop(graph: ActiveGraph): void {
  const samples = new Float32Array(graph.analyserNode.fftSize);

  const tick = () => {
    if (activeGraph !== graph) {
      return;
    }

    graph.analyserNode.getFloatTimeDomainData(samples);
    updateInputMetrics(calculateAnalyserRms(samples));
    graph.animationFrameId = window.requestAnimationFrame(tick);
  };

  tick();
}

function updateRuntimeMetrics(graph: ActiveGraph, frameSamples: number): void {
  runtimeMetrics.innerHTML = [
    metric("Worklet", "ready"),
    metric("Source", graph.sourceMode),
    metric("Context", graph.context.state),
    metric("Sample rate", `${graph.context.sampleRate} Hz`),
    metric("Frame samples", String(frameSamples)),
    metric("Output gain", graph.outputGain.gain.value.toFixed(2)),
  ].join("");
}

async function start(): Promise<void> {
  await stop();

  startButton.disabled = true;
  stopButton.disabled = false;
  messages.textContent = "No messages yet.";
  eventCount = 0;
  lastVoiceFrameRatio = null;
  eventMetrics.innerHTML = [
    metric("Event count", "0"),
    metric("Last event RMS", "-"),
    metric("Active ratio", "-"),
  ].join("");

  let pendingContext: AudioContext | null = null;
  let pendingMicrophoneStream: MediaStream | null = null;
  let pendingSourceNode: AudioNode | null = null;
  let pendingBufferSource: AudioBufferSourceNode | null = null;
  let pendingAnalyserNode: AnalyserNode | null = null;
  let pendingOutputGain: GainNode | null = null;
  let pendingWorklet: BackgroundNoiseDetectorAudioWorkletHandle | null = null;
  let pendingStopMessages: (() => void) | null = null;

  try {
    const options = readWorkletOptions();
    const sourceMode = readSourceMode();
    setStatus(sourceMode === "microphone" ? "Requesting microphone permission..." : "Loading clip...");

    const context = new AudioContext({ sampleRate: 16000 });
    pendingContext = context;

    const source = await createSource(context, sourceMode);
    const { sourceNode, microphoneStream, bufferSource } = source;
    pendingSourceNode = sourceNode;
    pendingMicrophoneStream = microphoneStream ?? null;
    pendingBufferSource = bufferSource ?? null;
    const analyserNode = new AnalyserNode(context, {
      fftSize: 2048,
      smoothingTimeConstant: 0.15,
    });
    pendingAnalyserNode = analyserNode;
    const outputGain = new GainNode(context, {
      gain: readOutputGain(sourceMode),
    });
    pendingOutputGain = outputGain;

    setStatus("Creating background noise detector worklet...");
    const worklet = await createBackgroundNoiseDetectorAudioWorklet(context, options);
    pendingWorklet = worklet;
    const stopMessages = observeBackgroundNoiseDetectorAudioWorkletMessages(
      worklet,
      (message) => {
        appendMessage(JSON.stringify(message, null, 2));

        if (!isBackgroundNoiseDetectedMessage(message)) {
          return;
        }

        eventCount += 1;
        lastVoiceFrameRatio = message.voiceFrameRatio;
        eventMetrics.innerHTML = [
          metric("Event count", String(eventCount)),
          metric("Last event RMS", message.rms.toFixed(5)),
          metric("Active ratio", formatRatio(message.activeFrameRatio)),
        ].join("");
      }
    );
    pendingStopMessages = stopMessages;

    await context.resume();
    const readyMessage = await worklet.ready;

    const graph: ActiveGraph = {
      context,
      sourceMode,
      sourceNode,
      analyserNode,
      outputGain,
      worklet,
      stopMessages,
      animationFrameId: 0,
      frameSamples: readyMessage.frameSamples,
      microphoneStream,
      bufferSource,
    };

    activeGraph = graph;
    pendingContext = null;
    pendingMicrophoneStream = null;
    pendingSourceNode = null;
    pendingBufferSource = null;
    pendingAnalyserNode = null;
    pendingOutputGain = null;
    pendingWorklet = null;
    pendingStopMessages = null;
    sourceNode.connect(analyserNode);
    sourceNode.connect(worklet.node).connect(outputGain).connect(context.destination);
    startRmsLoop(graph);
    updateRuntimeMetrics(graph, readyMessage.frameSamples);
    startButton.textContent = "Restart";
    setStatus(
      sourceMode === "microphone"
        ? "Detector ready. Make fan, keyboard, speech, and silence checks."
        : "Detector ready. The selected clip is looping through the worklet."
    );

    worklet.node.addEventListener("processorerror", () => {
      setStatus("AudioWorklet processor error.", true);
    });
  } catch (error) {
    await stop();
    pendingStopMessages?.();
    pendingWorklet?.dispose();
    pendingMicrophoneStream?.getTracks().forEach((track) => track.stop());
    pendingBufferSource?.stop();
    pendingSourceNode?.disconnect();
    pendingAnalyserNode?.disconnect();
    pendingOutputGain?.disconnect();

    if (pendingContext && pendingContext.state !== "closed") {
      await pendingContext.close();
    }

    console.error(error);
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

  window.cancelAnimationFrame(graph.animationFrameId);
  graph.stopMessages();
  graph.worklet.dispose();
  graph.bufferSource?.stop();
  graph.microphoneStream?.getTracks().forEach((track) => track.stop());
  graph.sourceNode.disconnect();
  graph.analyserNode.disconnect();
  graph.outputGain.disconnect();
  await graph.context.close();

  stopButton.disabled = true;
  startButton.textContent = "Start";
  runtimeMetrics.innerHTML = [
    metric("Worklet", "idle"),
    metric("Context", "closed"),
    metric("Sample rate", "-"),
  ].join("");
  setStatus("Stopped.");
}

startButton.addEventListener("click", () => {
  void start();
});

stopButton.addEventListener("click", () => {
  void stop();
});

sourceModeSelect.addEventListener("change", () => {
  updateSourceControls();

  if (activeGraph) {
    void start();
  }
});

clipSelect.addEventListener("change", () => {
  if (activeGraph?.sourceMode === "clip") {
    void start();
  }
});

outputGainInput.addEventListener("input", () => {
  const graph = activeGraph;

  if (!graph || graph.sourceMode !== "clip") {
    return;
  }

  graph.outputGain.gain.value = readOutputGain("clip");
  updateRuntimeMetrics(graph, graph.frameSamples);
});

window.addEventListener("pagehide", () => {
  void stop();
});

updateSourceControls();
