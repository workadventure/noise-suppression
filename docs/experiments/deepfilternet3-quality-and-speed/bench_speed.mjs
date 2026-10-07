// Per-frame cost of df_process_frame on real noisy speech (a raw float32 file at 48 kHz), after a 2 s warm-up.
// usage: node bench_speed.mjs <wasmDir> <model.tar.gz> <speech.f32>
// Measure on speech, not on synthetic noise: libDF's (former) default stage skipping made white noise far cheaper.
import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const [dir, modelPath, input] = process.argv.slice(2);
const df = await import(pathToFileURL(path.join(dir, "df.js")).href);
const wasmBytes = fs.readFileSync(path.join(dir, "df_bg.wasm"));
try { df.initSync({ module: wasmBytes }); } catch { df.initSync(wasmBytes); } // old glue: positional
const st = df.df_create(new Uint8Array(fs.readFileSync(modelPath)), 25);
const n = df.df_get_frame_length(st);
const buf = fs.readFileSync(input); const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const frames = Math.floor(x.length / n); const times = [];
for (let f = 0; f < frames; f++) { const t = performance.now(); df.df_process_frame(st, x.subarray(f * n, (f + 1) * n)); if (f >= 200) times.push(performance.now() - t); }
times.sort((a, b) => a - b); const mean = times.reduce((s, v) => s + v, 0) / times.length;
console.log(JSON.stringify({ meanMs: +mean.toFixed(3), p95Ms: +times[Math.floor(0.95 * (times.length - 1))].toFixed(3), maxMs: +times[times.length - 1].toFixed(3) }));
