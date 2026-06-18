import restaurantClipUrl from "../clips/restaurant_noisy.wav?url";
import helicopterClipUrl from "../clips/trump_vs_helicopter.wav?url";
import airConditioningClipUrl from "../clips/airconditioning.wav?url";
import dogBarkingClipUrl from "../clips/dog_barking_noisy.wav?url";
import pureNoiseClipUrl from "../clips/pure-noise.wav?url";
import whiteNoiseClipUrl from "../clips/white-noise-15s.wav?url";
import {
  createBackgroundNoiseDetector,
  isBackgroundNoiseDetectedMessage,
  observeBackgroundNoiseDetectorMessages,
  type BackgroundNoiseDetectorHandle,
  type BackgroundNoiseDetectorRuntimeOptions,
} from "../src/background-noise";
import "./styles.css";

type SourceMode = "microphone" | "clip";
type SileroModel = NonNullable<BackgroundNoiseDetectorRuntimeOptions["sileroModel"]>;

interface ActiveGraph {
  context: AudioContext;
  sourceMode: SourceMode;
  sourceNode: AudioNode;
  analyserNode: AnalyserNode;
  vadInput: MediaStreamAudioDestinationNode | undefined;
  outputGain: GainNode;
  detector: BackgroundNoiseDetectorHandle;
  stopMessages: () => void;
  animationFrameId: number;
  frameSamples: number;
  frameDurationMs: number;
  microphoneStream: MediaStream | undefined;
  bufferSource: AudioBufferSourceNode | undefined;
}

const clips = [
  { label: "Restaurant", url: restaurantClipUrl },
  { label: "Helicopter", url: helicopterClipUrl },
  { label: "Air conditioning", url: airConditioningClipUrl },
  { label: "Dog barking", url: dogBarkingClipUrl },
  { label: "Pure noise", url: pureNoiseClipUrl },
  { label: "White noise", url: whiteNoiseClipUrl },
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
      This demo runs the stream-based detector on microphone input or packaged
      clips, keeps microphone playback muted, and reports background-noise
      events from Silero speech probabilities plus RMS windows.
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
        <span>Mic feedback</span>
        <input id="microphone-feedback-input" type="checkbox">
      </label>

      <label class="stacked-control">
        <span>Silero model</span>
        <select id="silero-model-select">
          <option value="v5" selected>V5</option>
          <option value="legacy">Legacy</option>
        </select>
      </label>

      <label class="stacked-control">
        <span>Speech threshold</span>
        <input id="speech-threshold-input" type="number" min="0" max="1" step="0.01" value="0.3">
      </label>

      <label class="stacked-control">
        <span>Max speech ratio</span>
        <input id="max-speech-ratio-input" type="number" min="0" max="1" step="0.05" value="0.2">
      </label>

      <label class="stacked-control">
        <span>Max avg speech</span>
        <input id="max-average-speech-input" type="number" min="0" max="1" step="0.05" value="0.2">
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
const microphoneFeedbackInput = mustQuery<HTMLInputElement>("#microphone-feedback-input");
const sileroModelSelect = mustQuery<HTMLSelectElement>("#silero-model-select");
const speechThresholdInput = mustQuery<HTMLInputElement>("#speech-threshold-input");
const maxSpeechRatioInput = mustQuery<HTMLInputElement>("#max-speech-ratio-input");
const maxAverageSpeechInput = mustQuery<HTMLInputElement>("#max-average-speech-input");
const triggerRmsInput = mustQuery<HTMLInputElement>("#trigger-rms-input");
const noisyRmsInput = mustQuery<HTMLInputElement>("#noisy-rms-input");
const analysisWindowInput = mustQuery<HTMLInputElement>("#analysis-window-input");
const cooldownInput = mustQuery<HTMLInputElement>("#cooldown-input");
const startButton = mustQuery<HTMLButtonElement>("#start-button");
const stopButton = mustQuery<HTMLButtonElement>("#stop-button");
const runtimeMetrics = mustQuery<HTMLDivElement>("#runtime-metrics");
const inputMetrics = mustQuery<HTMLDivElement>("#input-metrics");
const eventMetrics = mustQuery<HTMLDivElement>("#event-metrics");
const messages = mustQuery<HTMLPreElement>("#messages");

let activeGraph: ActiveGraph | null = null;
let eventCount = 0;
let lastSpeechFrameRatio: number | null = null;

runtimeMetrics.innerHTML = [
  metric("Detector", "idle"),
  metric("Context", "idle"),
  metric("Sample rate", "-"),
].join("");
inputMetrics.innerHTML = [
  metric("Live RMS", "-"),
  metric("Live dBFS", "-"),
  metric("Last speech ratio", "-"),
].join("");
eventMetrics.innerHTML = [
  metric("Event count", "0"),
  metric("Last event RMS", "-"),
  metric("Avg speech", "-"),
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

function readDetectorOptions(): BackgroundNoiseDetectorRuntimeOptions {
  const speechProbabilityThreshold = finiteInputValue(
    speechThresholdInput,
    "Speech threshold"
  );

  return {
    sileroModel: sileroModelSelect.value as SileroModel,
    positiveSpeechThreshold: speechProbabilityThreshold,
    speechProbabilityThreshold,
    triggerRms: finiteInputValue(triggerRmsInput, "Trigger RMS"),
    noisyRms: finiteInputValue(noisyRmsInput, "Noisy RMS"),
    analysisWindowMs: finiteInputValue(analysisWindowInput, "Window ms"),
    maxSpeechFrameRatio: finiteInputValue(maxSpeechRatioInput, "Max speech ratio"),
    maxAverageSpeechProbability: finiteInputValue(
      maxAverageSpeechInput,
      "Max avg speech"
    ),
    cooldownMs: finiteInputValue(cooldownInput, "Cooldown ms"),
  };
}

function readSourceMode(): SourceMode {
  return sourceModeSelect.value === "clip" ? "clip" : "microphone";
}

function readOutputGain(sourceMode: SourceMode): number {
  if (sourceMode === "microphone") {
    return microphoneFeedbackInput.checked
      ? finiteInputValue(outputGainInput, "Output")
      : 0;
  }

  return finiteInputValue(outputGainInput, "Output");
}

function updateSourceControls(): void {
  const sourceMode = readSourceMode();
  const microphoneFeedbackEnabled =
    sourceMode === "microphone" && microphoneFeedbackInput.checked;
  clipSelect.disabled = sourceMode !== "clip";
  microphoneFeedbackInput.disabled = sourceMode !== "microphone";
  outputGainInput.disabled = sourceMode !== "clip" && !microphoneFeedbackEnabled;
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
        autoGainControl: true,
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
    metric("Last speech ratio", formatRatio(lastSpeechFrameRatio)),
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
    metric("Detector", "ready"),
    metric("Source", graph.sourceMode),
    metric("Context", graph.context.state),
    metric("Sample rate", `${graph.context.sampleRate} Hz`),
    metric("Frame samples", String(frameSamples)),
    metric("Frame duration", `${graph.frameDurationMs.toFixed(1)} ms`),
    metric("Output gain", graph.outputGain.gain.value.toFixed(2)),
  ].join("");
}

async function start(): Promise<void> {
  await stop();

  startButton.disabled = true;
  stopButton.disabled = false;
  messages.textContent = "No messages yet.";
  eventCount = 0;
  lastSpeechFrameRatio = null;
  eventMetrics.innerHTML = [
    metric("Event count", "0"),
    metric("Last event RMS", "-"),
    metric("Avg speech", "-"),
    metric("Active ratio", "-"),
  ].join("");

  let pendingContext: AudioContext | null = null;
  let pendingMicrophoneStream: MediaStream | null = null;
  let pendingSourceNode: AudioNode | null = null;
  let pendingBufferSource: AudioBufferSourceNode | null = null;
  let pendingAnalyserNode: AnalyserNode | null = null;
  let pendingOutputGain: GainNode | null = null;
  let pendingVadInput: MediaStreamAudioDestinationNode | null = null;
  let pendingDetector: BackgroundNoiseDetectorHandle | null = null;
  let pendingStopMessages: (() => void) | null = null;

  try {
    const options = readDetectorOptions();
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
    const vadInput =
      sourceMode === "clip" ? context.createMediaStreamDestination() : undefined;
    pendingVadInput = vadInput ?? null;
    const detectorStream = microphoneStream ?? vadInput?.stream;

    if (!detectorStream) {
      throw new Error("Could not create detector input stream.");
    }

    setStatus("Creating background noise detector...");
    const detector = await createBackgroundNoiseDetector(
      context,
      detectorStream,
      options
    );
    pendingDetector = detector;
    const stopMessages = observeBackgroundNoiseDetectorMessages(
      detector,
      (message) => {
        appendMessage(JSON.stringify(message, null, 2));

        if (!isBackgroundNoiseDetectedMessage(message)) {
          return;
        }

        eventCount += 1;
        lastSpeechFrameRatio = message.speechFrameRatio;
        eventMetrics.innerHTML = [
          metric("Event count", String(eventCount)),
          metric("Last event RMS", message.rms.toFixed(5)),
          metric("Avg speech", formatRatio(message.averageSpeechProbability)),
          metric("Active ratio", formatRatio(message.activeFrameRatio)),
        ].join("");
      }
    );
    pendingStopMessages = stopMessages;

    await context.resume();
    const readyMessage = await detector.ready;

    const graph: ActiveGraph = {
      context,
      sourceMode,
      sourceNode,
      analyserNode,
      vadInput,
      outputGain,
      detector,
      stopMessages,
      animationFrameId: 0,
      frameSamples: readyMessage.frameSamples,
      frameDurationMs: readyMessage.frameDurationMs,
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
    pendingVadInput = null;
    pendingDetector = null;
    pendingStopMessages = null;
    sourceNode.connect(analyserNode);
    if (vadInput) {
      sourceNode.connect(vadInput);
    }
    sourceNode.connect(outputGain).connect(context.destination);
    startRmsLoop(graph);
    updateRuntimeMetrics(graph, readyMessage.frameSamples);
    startButton.textContent = "Restart";
    setStatus(
      sourceMode === "microphone"
        ? "Detector ready. Make fan, keyboard, speech, and silence checks."
        : "Detector ready. The selected clip is looping through the detector."
    );
  } catch (error) {
    await stop();
    pendingStopMessages?.();
    pendingDetector?.dispose();
    pendingMicrophoneStream?.getTracks().forEach((track) => track.stop());
    pendingBufferSource?.stop();
    pendingSourceNode?.disconnect();
    pendingAnalyserNode?.disconnect();
    pendingVadInput?.disconnect();
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
  graph.detector.dispose();
  graph.bufferSource?.stop();
  graph.microphoneStream?.getTracks().forEach((track) => track.stop());
  graph.sourceNode.disconnect();
  graph.analyserNode.disconnect();
  graph.vadInput?.disconnect();
  graph.outputGain.disconnect();
  await graph.context.close();

  stopButton.disabled = true;
  startButton.textContent = "Start";
  runtimeMetrics.innerHTML = [
    metric("Detector", "idle"),
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

  if (!graph) {
    return;
  }

  graph.outputGain.gain.value = readOutputGain(graph.sourceMode);
  updateRuntimeMetrics(graph, graph.frameSamples);
});

microphoneFeedbackInput.addEventListener("change", () => {
  updateSourceControls();
  const graph = activeGraph;

  if (!graph || graph.sourceMode !== "microphone") {
    return;
  }

  graph.outputGain.gain.value = readOutputGain("microphone");
  updateRuntimeMetrics(graph, graph.frameSamples);
});

window.addEventListener("pagehide", () => {
  void stop();
});

updateSourceControls();
