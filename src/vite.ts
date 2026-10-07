import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { NOISE_SUPPRESSION_AUDIO_WORKLET_DEV_MODULE_URL } from "./audio-worklet-dev-module-url";

export interface NoiseSuppressionAudioWorkletVitePluginOptions {
  moduleUrl?: string;
  processorPath?: string;
}

interface DevAsset {
  /** The `new URL(...)` expression the library build emits for this asset. */
  expression: string;
  devUrl: string;
  filePath: string;
  contentType: string;
}

function distPath(relativePath: string): string {
  return fileURLToPath(new URL(/* @vite-ignore */ relativePath, import.meta.url));
}

function urlExpression(assetPath: string): string {
  return `new URL("${assetPath}", import.meta.url).href`;
}

const DEEPFILTERNET_DEV_PREFIX = "/__workadventure_noise_suppression/deepfilternet/";

// Vite dev mode does not serve these package assets as raw files from the dependency, so the plugin serves them
// itself and points the entry at them.
const deepFilterNetAssets: DevAsset[] = [
  {
    expression: urlExpression("assets/deepfilternet-worklet-processor.js"),
    devUrl: `${DEEPFILTERNET_DEV_PREFIX}worklet-processor.js`,
    filePath: distPath("./assets/deepfilternet-worklet-processor.js"),
    contentType: "text/javascript",
  },
  {
    expression: urlExpression("assets/deepfilternet/df_bg.wasm"),
    devUrl: `${DEEPFILTERNET_DEV_PREFIX}df_bg.wasm`,
    filePath: distPath("./assets/deepfilternet/df_bg.wasm"),
    contentType: "application/wasm",
  },
  {
    expression: urlExpression("assets/deepfilternet/DeepFilterNet3_onnx.tar.gz"),
    devUrl: `${DEEPFILTERNET_DEV_PREFIX}DeepFilterNet3_onnx.tar.gz`,
    filePath: distPath("./assets/deepfilternet/DeepFilterNet3_onnx.tar.gz"),
    contentType: "application/gzip",
  },
];

export function noiseSuppressionAudioWorkletVitePlugin(
  options: NoiseSuppressionAudioWorkletVitePluginOptions = {},
): Plugin {
  const audioWorkletAssets: DevAsset[] = [
    {
      expression: urlExpression("assets/audio-worklet-processor.js"),
      devUrl: options.moduleUrl ?? NOISE_SUPPRESSION_AUDIO_WORKLET_DEV_MODULE_URL,
      filePath: options.processorPath ?? distPath("./assets/audio-worklet-processor.js"),
      contentType: "text/javascript",
    },
  ];
  const assetsByEntry = new Map<string, DevAsset[]>([
    [distPath("./audio-worklet.js"), audioWorkletAssets],
    [distPath("./deepfilternet.js"), deepFilterNetAssets],
  ]);

  return {
    name: "noise-suppression-audio-worklet",
    apply: "serve",
    config() {
      return {
        optimizeDeps: {
          exclude: [
            "@workadventure/noise-suppression",
            "@workadventure/noise-suppression/audio-worklet",
            "@workadventure/noise-suppression/deepfilternet",
          ],
        },
      };
    },
    configureServer(server: ViteDevServer) {
      for (const asset of [...audioWorkletAssets, ...deepFilterNetAssets]) {
        const serveAsset: Connect.NextHandleFunction = (_request, response, next) => {
          response.statusCode = 200;
          response.setHeader("Content-Type", asset.contentType);
          response.setHeader("Cache-Control", "no-cache");

          const stream = fs.createReadStream(asset.filePath);
          stream.on("error", next);
          stream.pipe(response);
        };

        server.middlewares.use(asset.devUrl, serveAsset);
      }
    },
    transform(code, id) {
      const assets = assetsByEntry.get(id.split("?")[0] ?? "");
      if (!assets) {
        return null;
      }

      let rewritten = code;
      for (const asset of assets) {
        if (!rewritten.includes(asset.expression)) {
          this.warn(`Could not rewrite ${asset.expression} for Vite dev mode.`);
          continue;
        }
        rewritten = rewritten.replace(asset.expression, JSON.stringify(asset.devUrl));
      }

      return { code: rewritten, map: null };
    },
  };
}
