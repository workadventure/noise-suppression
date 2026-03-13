import createNoiseSuppressionModule from "../src/index";
import "./styles.css";

function seededNoise(length: number, seed = 123456789): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (1664525 * state + 1013904223) >>> 0;
    out[i] = (state / 0xffffffff) * 2 - 1;
  }
  return out;
}

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
    <p class="eyebrow">LiteRT.js Browser Package</p>
    <h1>@workadventure/noise-suppression</h1>
    <p class="lead">
      Browser-only noise suppression built around the DTLN models and LiteRT.js.
      This demo loads the packaged runtime assets, compiles both models, and
      runs one synchronous denoise pass on a 512-sample frame.
    </p>
    <p class="status" id="status">Loading LiteRT.js and compiling models...</p>
  </section>
  <section class="panel-grid">
    <article class="panel">
      <h2>Runtime</h2>
      <div class="metrics" id="runtime-metrics"></div>
    </article>
    <article class="panel">
      <h2>Frame Timing</h2>
      <div class="metrics" id="timing-metrics"></div>
    </article>
  </section>
  <section class="details">
    <div class="panel">
      <h2>Model Details</h2>
      <pre id="details">Waiting for runtime...</pre>
    </div>
  </section>
`;

const status = document.querySelector<HTMLParagraphElement>("#status");
const runtimeMetrics = document.querySelector<HTMLDivElement>("#runtime-metrics");
const timingMetrics = document.querySelector<HTMLDivElement>("#timing-metrics");
const details = document.querySelector<HTMLPreElement>("#details");

if (!status || !runtimeMetrics || !timingMetrics || !details) {
  throw new Error("Missing expected demo elements");
}

try {
  const dtln = await createNoiseSuppressionModule({ logModelDetails: true });
  await dtln.ready;

  const handle = dtln.dtln_create();
  const input = seededNoise(512);
  const output = new Float32Array(512);

  const start = performance.now();
  dtln.dtln_denoise(handle, input, output);
  const elapsedMs = performance.now() - start;
  dtln.dtln_stop(handle);

  runtimeMetrics.innerHTML = [
    metric("Cross-origin isolated", globalThis.crossOriginIsolated ? "yes" : "no"),
    metric("LiteRT threads", dtln.modelDetails.threads ? "enabled" : "disabled"),
    metric("Configured CPU threads", String(dtln.modelDetails.numThreads)),
  ].join("");

  timingMetrics.innerHTML = [
    metric("Frame size", `${dtln.audioConfig.frameSize} samples`),
    metric("Frame duration", `${dtln.audioConfig.frameDuration} ms`),
    metric("Single frame time", `${elapsedMs.toFixed(3)} ms`),
  ].join("");

  details.textContent = JSON.stringify(dtln.modelDetails, null, 2);
  status.textContent = "Runtime ready.";
} catch (error) {
  console.error(error);
  status.textContent = `Failed to initialize runtime: ${String(error)}`;
  status.classList.add("error");
}
