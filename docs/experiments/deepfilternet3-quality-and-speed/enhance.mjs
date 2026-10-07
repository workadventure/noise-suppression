// Denoise every <in>/*.f32 (48 kHz mono float32) with the libDF wasm, frame by frame like the worklet.
// usage: node enhance.mjs <wasmDir> <model.tar.gz> <attenLimDb> <inDir> <outDir>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [wasmDir, model, attenLim, inDir, outDir] = process.argv.slice(2);
const df = await import(pathToFileURL(path.join(wasmDir, "df.js")).href);
df.initSync({ module: fs.readFileSync(path.join(wasmDir, "df_bg.wasm")) });
const modelBytes = new Uint8Array(fs.readFileSync(model));
fs.mkdirSync(outDir, { recursive: true });

for (const file of fs.readdirSync(inDir).filter((f) => f.endsWith(".f32"))) {
    const buf = fs.readFileSync(path.join(inDir, file));
    const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    // A fresh state per file, as the worklet has per call; limit as in production (or 100 = none)
    const st = df.df_create(modelBytes, Number(attenLim));
    const n = df.df_get_frame_length(st);
    const frames = Math.ceil(x.length / n) + 4; // flush the model delay
    const y = new Float32Array(frames * n);
    const frame = new Float32Array(n);
    for (let f = 0; f < frames; f++) {
        frame.fill(0);
        frame.set(x.subarray(f * n, Math.min((f + 1) * n, x.length)));
        y.set(df.df_process_frame(st, frame), f * n);
    }
    fs.writeFileSync(path.join(outDir, file), Buffer.from(y.buffer));
}
console.log(`done ${outDir}`);
