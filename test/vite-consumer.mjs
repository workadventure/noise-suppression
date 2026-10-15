// Installs the built package into a throwaway Vite app, with and without the package plugin, then runs the
// background-noise detector on white noise from the dev server and from a production build: asset URLs have to survive
// all four without any bundler configuration.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build, createServer, preview } from "vite";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const consumerRoot = await fs.mkdtemp(path.join(packageRoot, ".vite-consumer-"));
const installedPackageRoot = path.join(
  consumerRoot,
  "node_modules/@workadventure/noise-suppression",
);
let browser;

async function detectWhiteNoise(url) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.result !== undefined, null, {
    timeout: 30000,
  });
  const result = await page.evaluate(() => document.documentElement.dataset.result);
  await page.close();
  if (pageErrors.length > 0) {
    throw pageErrors[0];
  }
  if (result !== "background-noise-detected") {
    throw new Error(`${url}: ${result}`);
  }
}

try {
  await fs.mkdir(installedPackageRoot, { recursive: true });
  await Promise.all([
    fs.cp(path.join(packageRoot, "dist"), path.join(installedPackageRoot, "dist"), {
      recursive: true,
    }),
    fs.copyFile(
      path.join(packageRoot, "package.json"),
      path.join(installedPackageRoot, "package.json"),
    ),
    fs.writeFile(
      path.join(consumerRoot, "index.html"),
      '<script type="module" src="./main.js"></script>',
    ),
    fs.writeFile(
      path.join(consumerRoot, "main.js"),
      `import {
  createBackgroundNoiseDetector,
  isBackgroundNoiseDetectedMessage,
  observeBackgroundNoiseDetectorMessages,
} from "@workadventure/noise-suppression/background-noise";

try {
  // The browser's own rate (48 kHz, usually), so the capture processor resamples.
  const context = new AudioContext();
  await context.resume();
  const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * 0.2;
  const source = context.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const destination = context.createMediaStreamDestination();
  source.connect(destination);
  source.start();

  const detector = await createBackgroundNoiseDetector(context, destination.stream);
  observeBackgroundNoiseDetectorMessages(detector, (message) => {
    if (isBackgroundNoiseDetectedMessage(message)) {
      document.documentElement.dataset.result = message.type;
      detector.dispose();
    }
  });
} catch (error) {
  document.documentElement.dataset.result = String(error);
}
`,
    ),
  ]);

  const { noiseSuppressionAudioWorkletVitePlugin } = await import(
    path.join(installedPackageRoot, "dist/vite.js")
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });

  for (const plugins of [[], [noiseSuppressionAudioWorkletVitePlugin()]]) {
    const config = {
      root: consumerRoot,
      configFile: false,
      logLevel: "error",
      plugins,
      server: { host: "127.0.0.1", port: 0 },
      preview: { host: "127.0.0.1", port: 0 },
    };

    const devServer = await createServer(config);
    try {
      await devServer.listen();
      await detectWhiteNoise(devServer.resolvedUrls.local[0]);
    } finally {
      await devServer.close();
    }

    await build(config);
    const previewServer = await preview(config);
    try {
      await detectWhiteNoise(previewServer.resolvedUrls.local[0]);
    } finally {
      await new Promise((resolve) => previewServer.httpServer.close(resolve));
    }
  }
} finally {
  await browser?.close();
  await fs.rm(consumerRoot, { recursive: true, force: true });
}
