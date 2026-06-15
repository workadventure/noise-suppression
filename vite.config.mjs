import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build, defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const litertWasmUtilsAlias = path.resolve(rootDir, "forks/litertjs-wasm-utils/index.js");
const devAudioWorkletModulePath = "/__noise_suppression_audio_worklet_processor.js";
const devBackgroundNoiseDetectorAudioWorkletModulePath =
  "/__background_noise_detector_audio_worklet_processor.js";
const audioWorkletProcessorFileName = "assets/audio-worklet-processor.js";
const backgroundNoiseDetectorAudioWorkletProcessorFileName =
  "assets/background-noise-worklet-processor.js";
const audioWorkletModuleUrlVirtualId =
  "virtual:noise-suppression-audio-worklet-module-url";
const resolvedAudioWorkletModuleUrlVirtualId = `\0${audioWorkletModuleUrlVirtualId}`;
const backgroundNoiseDetectorAudioWorkletModuleUrlVirtualId =
  "virtual:background-noise-detector-audio-worklet-module-url";
const resolvedBackgroundNoiseDetectorAudioWorkletModuleUrlVirtualId = `\0${backgroundNoiseDetectorAudioWorkletModuleUrlVirtualId}`;
const defaultAssetsVirtualId = "virtual:noise-suppression-default-assets";
const resolvedDefaultAssetsVirtualId = `\0${defaultAssetsVirtualId}`;

const packagedLiteRtAssets = [
  "litert_wasm_compat_internal.js",
  "litert_wasm_compat_internal.mjs",
  "litert_wasm_compat_internal.wasm",
  "litert_wasm_internal.js",
  "litert_wasm_internal.mjs",
  "litert_wasm_internal.wasm",
  "litert_wasm_jspi_internal.js",
  "litert_wasm_jspi_internal.mjs",
  "litert_wasm_jspi_internal.wasm",
  "litert_wasm_threaded_internal.js",
  "litert_wasm_threaded_internal.mjs",
  "litert_wasm_threaded_internal.wasm",
].map((fileName) => ({
  source: path.resolve(rootDir, "forks/litertjs-core/wasm", fileName),
  fileName: `vendor/litert/${fileName}`,
}));

const packagedModelAssets = [
  {
    exportName: "defaultModel1Url",
    source: path.resolve(rootDir, "model/model_quant_1.tflite"),
    fileName: "assets/model_quant_1.tflite",
  },
  {
    exportName: "defaultModel2Url",
    source: path.resolve(rootDir, "model/model_quant_2.tflite"),
    fileName: "assets/model_quant_2.tflite",
  },
];

function bytesPlugin() {
  const bytesQuery = "?bytes";
  const virtualPrefix = "\0noise-suppression-bytes:";
  const loadBytesModule = (id) => {
    let file;

    if (id.startsWith(virtualPrefix)) {
      file = id.slice(virtualPrefix.length);
    } else if (id.endsWith(bytesQuery)) {
      file = id.slice(0, -bytesQuery.length);
    } else {
      return null;
    }

    const base64 = fs.readFileSync(file).toString("base64");

    return `
const base64 = ${JSON.stringify(base64)};

function decodeBase64(base64) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;

  const clean = base64.replace(/=+$/, "");
  const bytes = new Uint8Array((clean.length * 3) >> 2);
  let buffer = 0;
  let bits = 0;
  let out = 0;

  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | lookup[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (buffer >> bits) & 255;
    }
  }

  return bytes;
}

export default decodeBase64(base64);
`;
  };

  return {
    name: "noise-suppression-bytes",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith(bytesQuery)) {
        return null;
      }

      const sourceFile = source.slice(0, -bytesQuery.length);
      const resolved = await this.resolve(sourceFile, importer, {
        skipSelf: true,
      });
      const file =
        resolved?.id ??
        path.resolve(importer ? path.dirname(importer.split("?")[0]) : rootDir, sourceFile);

      return `${virtualPrefix}${file}`;
    },
    load(id) {
      return loadBytesModule(id);
    },
    transform(_code, id) {
      return loadBytesModule(id);
    },
  };
}

function audioWorkletBundlePlugin() {
  let bundledCodePromise;
  let backgroundNoiseDetectorBundledCodePromise;
  let command = "build";
  let audioWorkletAssetReferenceId;
  let backgroundNoiseDetectorAudioWorkletAssetReferenceId;

  return {
    name: "noise-suppression-audio-worklet-bundle",
    configResolved(config) {
      command = config.command;
    },
    resolveId(source) {
      if (source === audioWorkletModuleUrlVirtualId) {
        return resolvedAudioWorkletModuleUrlVirtualId;
      }

      if (source === backgroundNoiseDetectorAudioWorkletModuleUrlVirtualId) {
        return resolvedBackgroundNoiseDetectorAudioWorkletModuleUrlVirtualId;
      }

      return null;
    },
    async load(id) {
      if (id === resolvedAudioWorkletModuleUrlVirtualId) {
        if (command === "serve") {
          return `export default ${JSON.stringify(devAudioWorkletModulePath)};`;
        }

        bundledCodePromise ??= buildAudioWorkletDevBundle();
        audioWorkletAssetReferenceId ??= this.emitFile({
          type: "asset",
          fileName: audioWorkletProcessorFileName,
          source: await bundledCodePromise,
        });

        return `export default import.meta.ROLLUP_FILE_URL_${audioWorkletAssetReferenceId};`;
      }

      if (id === resolvedBackgroundNoiseDetectorAudioWorkletModuleUrlVirtualId) {
        if (command === "serve") {
          return `export default ${JSON.stringify(
            devBackgroundNoiseDetectorAudioWorkletModulePath
          )};`;
        }

        backgroundNoiseDetectorBundledCodePromise ??=
          buildBackgroundNoiseDetectorAudioWorkletDevBundle();
        backgroundNoiseDetectorAudioWorkletAssetReferenceId ??= this.emitFile({
          type: "asset",
          fileName: backgroundNoiseDetectorAudioWorkletProcessorFileName,
          source: await backgroundNoiseDetectorBundledCodePromise,
        });

        return `export default import.meta.ROLLUP_FILE_URL_${backgroundNoiseDetectorAudioWorkletAssetReferenceId};`;
      }

      return null;
    },
    configureServer(server) {
      server.middlewares.use(devAudioWorkletModulePath, async (_request, response, next) => {
        try {
          bundledCodePromise ??= buildAudioWorkletDevBundle();
          const bundledCode = await bundledCodePromise;

          response.statusCode = 200;
          response.setHeader("Content-Type", "text/javascript");
          response.end(bundledCode);
        } catch (error) {
          bundledCodePromise = undefined;
          next(error);
        }
      });

      server.middlewares.use(
        devBackgroundNoiseDetectorAudioWorkletModulePath,
        async (_request, response, next) => {
          try {
            backgroundNoiseDetectorBundledCodePromise ??=
              buildBackgroundNoiseDetectorAudioWorkletDevBundle();
            const bundledCode = await backgroundNoiseDetectorBundledCodePromise;

            response.statusCode = 200;
            response.setHeader("Content-Type", "text/javascript");
            response.end(bundledCode);
          } catch (error) {
            backgroundNoiseDetectorBundledCodePromise = undefined;
            next(error);
          }
        }
      );
    },
  };
}

function defaultAssetsPlugin() {
  let command = "build";

  return {
    name: "noise-suppression-default-assets",
    configResolved(config) {
      command = config.command;
    },
    resolveId(source) {
      if (source === defaultAssetsVirtualId) {
        return resolvedDefaultAssetsVirtualId;
      }

      return null;
    },
    load(id) {
      if (id !== resolvedDefaultAssetsVirtualId) {
        return null;
      }

      if (command === "serve") {
        return `
export const defaultLiteRtWasmRoot = "/forks/litertjs-core/wasm/";
export const defaultModel1Url = "/model/model_quant_1.tflite";
export const defaultModel2Url = "/model/model_quant_2.tflite";
`;
      }

      const liteRtAssetReferences = packagedLiteRtAssets.map((asset) =>
        this.emitFile({
          type: "asset",
          fileName: asset.fileName,
          source: fs.readFileSync(asset.source),
        })
      );

      const modelAssetReferences = new Map(
        packagedModelAssets.map((asset) => [
          asset.exportName,
          this.emitFile({
            type: "asset",
            fileName: asset.fileName,
            source: fs.readFileSync(asset.source),
          }),
        ])
      );

      return `
const liteRtAssetUrls = [
  ${liteRtAssetReferences.map((referenceId) => `import.meta.ROLLUP_FILE_URL_${referenceId}`).join(",\n  ")}
];

export const defaultLiteRtWasmRoot = new URL(".", liteRtAssetUrls[0]).toString();
export const defaultModel1Url = import.meta.ROLLUP_FILE_URL_${modelAssetReferences.get("defaultModel1Url")};
export const defaultModel2Url = import.meta.ROLLUP_FILE_URL_${modelAssetReferences.get("defaultModel2Url")};
`;
    },
  };
}

async function buildAudioWorkletDevBundle() {
  const result = await build({
    root: rootDir,
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    plugins: [
      bytesPlugin(),
      {
        name: "noise-suppression-audio-worklet-import-meta-url",
        transform(code, id) {
          if (!id.endsWith("/forks/litertjs-core/wasm/litert_wasm_internal.mjs")) {
            return null;
          }

          return code.replace(
            "var _scriptName = import.meta.url;",
            "var _scriptName = self.location.href;"
          );
        },
      },
    ],
    resolve: {
      alias: {
        "@litertjs/wasm-utils": litertWasmUtilsAlias,
      },
    },
    worker: {
      plugins: () => [bytesPlugin()],
    },
    build: {
      target: "es2022",
      write: false,
      minify: false,
      sourcemap: false,
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve(rootDir, "src/audio-worklet-processor.ts"),
        output: {
          format: "iife",
          inlineDynamicImports: true,
        },
      },
    },
  });

  const output = Array.isArray(result) ? result[0]?.output : result.output;
  const chunk = output?.find((item) => item.type === "chunk");

  if (!chunk || chunk.type !== "chunk") {
    throw new Error("Failed to build the AudioWorklet development bundle.");
  }

  return chunk.code;
}

async function buildBackgroundNoiseDetectorAudioWorkletDevBundle() {
  const result = await build({
    root: rootDir,
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    plugins: [bytesPlugin()],
    worker: {
      plugins: () => [bytesPlugin()],
    },
    build: {
      target: "es2022",
      write: false,
      minify: false,
      sourcemap: false,
      emptyOutDir: false,
      rollupOptions: {
        input: path.resolve(rootDir, "src/background-noise-worklet-processor.ts"),
        output: {
          format: "iife",
          inlineDynamicImports: true,
        },
      },
    },
  });

  const output = Array.isArray(result) ? result[0]?.output : result.output;
  const chunk = output?.find((item) => item.type === "chunk");

  if (!chunk || chunk.type !== "chunk") {
    throw new Error(
      "Failed to build the background noise detector AudioWorklet development bundle."
    );
  }

  return chunk.code;
}

export default defineConfig(({ command }) => {
  return {
    assetsInclude: ["**/*.tflite", "**/*.tflite?inline"],
    base: "./",
    plugins: [
      bytesPlugin(),
      defaultAssetsPlugin(),
      audioWorkletBundlePlugin(),
      ...(command === "serve"
        ? [
            viteStaticCopy({
              targets: [
                {
                  src: path.resolve(rootDir, "model/model_quant_1.tflite"),
                  dest: "assets",
                },
                {
                  src: path.resolve(rootDir, "model/model_quant_2.tflite"),
                  dest: "assets",
                },
                {
                  src: path.resolve(rootDir, "forks/litertjs-core/wasm/*"),
                  dest: "vendor/litert",
                },
              ],
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@litertjs/wasm-utils": litertWasmUtilsAlias,
      },
    },
    build: {
      lib: {
        entry: {
          index: path.resolve(rootDir, "src/index.ts"),
          "audio-worklet": path.resolve(rootDir, "src/audio-worklet.ts"),
          "background-noise-worklet": path.resolve(
            rootDir,
            "src/background-noise-worklet.ts"
          ),
          vite: path.resolve(rootDir, "src/vite.ts"),
        },
        name: "NoiseSuppression",
        formats: ["es"],
        fileName: (_format, entryName) => `${entryName}.js`,
      },
      target: "es2022",
      sourcemap: true,
      rollupOptions: {
        external: ["fft.js", "node:fs", "node:url"],
        output: {
          assetFileNames(assetInfo) {
            const originalFileName =
              assetInfo.originalFileNames?.[0] ?? assetInfo.name ?? "";

            if (originalFileName.endsWith(".tflite")) {
              return "assets/[name][extname]";
            }

            if (originalFileName.includes("forks/litertjs-core/wasm/")) {
              return "vendor/litert/[name][extname]";
            }

            return "assets/[name]-[hash][extname]";
          },
        },
      },
      emptyOutDir: true,
    },
    server: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
    preview: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },
  };
});
