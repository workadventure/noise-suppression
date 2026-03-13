import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.NOISE_SUPPRESSION_BENCH_PORT ?? 4174);

const server = await createServer({
  root: rootDir,
  server: {
    host: "127.0.0.1",
    port,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});

await server.listen();

console.log(`Benchmark server listening on http://127.0.0.1:${port}`);
console.log(`Manual harness: http://127.0.0.1:${port}/browser-benchmark-litert-manual.html`);
console.log(`Profile benchmark: http://127.0.0.1:${port}/browser-benchmark-litert.html`);
console.log(`Thread compare: http://127.0.0.1:${port}/browser-benchmark-compare.html`);
