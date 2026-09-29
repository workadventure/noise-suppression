// Algorithmic delay of a DeepFilterNet model (df_process_frame only): cross-correlate output with input.
// usage: node delay.mjs <wasmDir> <model.tar.gz>
// The input glides its f0: a periodic buzz would let the correlation lock one period off.
import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const [dir, model] = process.argv.slice(2);
const df = await import(pathToFileURL(path.join(dir, "df.js")).href);
df.initSync({ module: fs.readFileSync(path.join(dir, "df_bg.wasm")) });
const st = df.df_create(new Uint8Array(fs.readFileSync(model)), 100);
const N = 480, frames = 300, sr = 48000;
// Voice-like signal: harmonic buzz at 140 Hz with a 4 Hz syllable envelope
const x = new Float32Array(N * frames);
// f0 glides between 100 and 250 Hz: no fixed period, so the correlation has a single peak
let phase = 0;
for (let i = 0; i < x.length; i++) {
  const t = i / sr; const f0 = 175 + 75 * Math.sin(2 * Math.PI * 1.3 * t);
  phase += 2 * Math.PI * f0 / sr; let v = 0;
  for (let h = 1; h <= 20; h++) v += Math.sin(h * phase) / h;
  x[i] = 0.1 * v * Math.max(0, Math.sin(2 * Math.PI * 4 * t));
}
const y = new Float32Array(x.length);
for (let f = 0; f < frames; f++) y.set(df.df_process_frame(st, x.subarray(f * N, (f + 1) * N)), f * N);
let best = 0, bestLag = 0;
for (let lag = 0; lag < 4000; lag++) {
  let c = 0; for (let i = 20000; i < 120000; i++) c += x[i] * y[i + lag];
  if (c > best) { best = c; bestLag = lag; }
}
console.log(JSON.stringify({ delaySamples: bestLag, delayMs: +(bestLag / sr * 1000).toFixed(2) }));
