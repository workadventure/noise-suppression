import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { NOISE_SUPPRESSION_AUDIO_WORKLET_DEV_MODULE_URL } from "./audio-worklet-dev-module-url";

export interface NoiseSuppressionAudioWorkletVitePluginOptions {
  moduleUrl?: string;
  processorPath?: string;
}

const defaultProcessorPath = fileURLToPath(
  new URL(
    /* @vite-ignore */ "./assets/audio-worklet-processor.js",
    import.meta.url,
  ),
);
const audioWorkletEntryPath = fileURLToPath(
  new URL(/* @vite-ignore */ "./audio-worklet.js", import.meta.url),
);
const defaultProcessorUrlExpression =
  'new URL("assets/audio-worklet-processor.js", import.meta.url).href';

export function noiseSuppressionAudioWorkletVitePlugin(
  options: NoiseSuppressionAudioWorkletVitePluginOptions = {},
): Plugin {
  const moduleUrl =
    options.moduleUrl ?? NOISE_SUPPRESSION_AUDIO_WORKLET_DEV_MODULE_URL;
  const processorPath = options.processorPath ?? defaultProcessorPath;

  return {
    name: "noise-suppression-audio-worklet",
    apply: "serve",
    config() {
      return {
        optimizeDeps: {
          exclude: [
            "@workadventure/noise-suppression",
            "@workadventure/noise-suppression/audio-worklet",
          ],
        },
      };
    },
    configureServer(server: ViteDevServer) {
      const serveProcessor: Connect.NextHandleFunction = (
        _request,
        response,
        next,
      ) => {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/javascript");
        response.setHeader("Cache-Control", "no-cache");

        const stream = fs.createReadStream(processorPath);
        stream.on("error", next);
        stream.pipe(response);
      };

      server.middlewares.use(moduleUrl, serveProcessor);
    },
    transform(code, id) {
      if (id.split("?")[0] !== audioWorkletEntryPath) {
        return null;
      }

      if (!code.includes(defaultProcessorUrlExpression)) {
        this.warn(
          "Could not rewrite the noise suppression AudioWorklet processor URL for Vite dev mode.",
        );
        return null;
      }

      return {
        code: code.replace(
          defaultProcessorUrlExpression,
          JSON.stringify(moduleUrl),
        ),
        map: null,
      };
    },
  };
}
