// Drives engine-benchmark.html (served by the repository's Vite dev server) in a Playwright browser.
//   node run.mjs speed [rounds] [chromium|webkit|firefox]   → results/speed-<browser>.json
//   node run.mjs render <inDir> <outDir> [config…]           → <outDir>/<config>/<name>.f32 + <outDir>/render.json
// render takes 48 kHz mono float32 files and writes each output at its engine's rate (16 or 48 kHz), through the
// shipped AudioWorklet; configs are the keys of RENDER_CONFIGS in demo/engine-benchmark.ts (default: all). Files
// already rendered are kept, so adding a config only renders that config.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const [command, ...args] = process.argv.slice(2);
const browsers = { chromium, webkit, firefox };

const server = await createServer({ configFile: path.join(repo, "vite.config.mjs"), root: repo, logLevel: "error", server: { hmr: false, watch: null } });
await server.listen();
const url = `${server.resolvedUrls.local[0]}engine-benchmark.html`;
const browserName = command === "speed" ? (args[1] ?? "chromium") : "chromium";
const browser = await browsers[browserName].launch();

// Runs `run(page)` in a fresh browser context, so a fresh renderer process: a reload keeps the process, and with it
// the Wasm memory of every worklet instance created so far (OfflineAudioContexts cannot be closed)
async function inFreshPage(run) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(error));
    await page.goto(url);
    await page.waitForFunction(() => window.engineBenchmark !== undefined);
    return await run(page);
  } finally {
    await context.close();
  }
}
const { engines, configs } = await inFreshPage((page) =>
  page.evaluate(() => ({
    engines: Object.keys(window.engineBenchmark.ENGINES),
    configs: Object.keys(window.engineBenchmark.RENDER_CONFIGS),
  }))
);

try {
  if (command === "speed") {
    const rounds = Number(args[0] ?? 5);
    const runs = [];
    for (let round = 0; round < rounds; round++) {
      for (const engine of engines) {
        runs.push(await inFreshPage((page) => page.evaluate((id) => window.engineBenchmark.measureSpeed(id), engine)));
        console.error(`round ${round + 1} ${engine}: ${runs.at(-1).meanMs.toFixed(3)} ms mean`);
      }
    }
    const browserVersion = `${browserName} ${browser.version()}`;
    fs.mkdirSync(path.join(here, "results"), { recursive: true });
    fs.writeFileSync(path.join(here, `results/speed-${browserName}.json`), JSON.stringify({ browserVersion, runs }, null, 1));
    console.log(`results/speed-${browserName}.json`);
  } else if (command === "render") {
    const [inDir, outDir] = args.slice(0, 2).map((dir) => path.resolve(dir));
    const files = fs.readdirSync(inDir).filter((file) => file.endsWith(".f32")).sort();
    const statsFile = path.join(outDir, "render.json");
    const stats = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, "utf8")) : [];
    for (const engine of args.length > 2 ? args.slice(2) : configs) {
      fs.mkdirSync(path.join(outDir, engine), { recursive: true });
      for (const file of files) {
        if (fs.existsSync(path.join(outDir, engine, file))) {
          continue;
        }
        const input = `/${path.relative(repo, path.join(inDir, file))}`;
        const result = await inFreshPage((page) => page.evaluate(
          async ({ id, input }) => {
            const samples = new Float32Array(await (await fetch(input)).arrayBuffer());
            const { output, sampleRate, readyMs, realTimeFactor } = await window.engineBenchmark.renderThroughWorklet(
              id,
              samples,
              48000
            );
            const bytes = new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
            let binary = "";
            for (let i = 0; i < bytes.length; i += 0x8000) {
              binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            }
            return { output: btoa(binary), sampleRate, readyMs, realTimeFactor };
          },
          { id: engine, input }
        ));
        fs.writeFileSync(path.join(outDir, engine, file), Buffer.from(result.output, "base64"));
        stats.push({ engine, file, sampleRate: result.sampleRate, readyMs: result.readyMs, realTimeFactor: result.realTimeFactor });
        fs.writeFileSync(statsFile, JSON.stringify(stats, null, 1));
      }
      console.error(`rendered ${files.length} files with ${engine}`);
    }
  } else {
    throw new Error("usage: node run.mjs speed [rounds] [browser] | render <inDir> <outDir> [config…]");
  }
} finally {
  await browser.close();
  await server.close();
}
