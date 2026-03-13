import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

function runtimeExpression(relativePath) {
  return JSON.stringify(relativePath);
}

export default defineConfig(({ command }) => {
  const isBuild = command === "build";

  return {
    define: {
      __NOISE_SUPPRESSION_LITERT_WASM_ROOT__: isBuild
        ? runtimeExpression("./vendor/litert/")
        : JSON.stringify("/vendor/litert/"),
      __NOISE_SUPPRESSION_MODEL1_URL__: isBuild
        ? runtimeExpression("./assets/model_quant_1.tflite")
        : JSON.stringify("/assets/model_quant_1.tflite"),
      __NOISE_SUPPRESSION_MODEL2_URL__: isBuild
        ? runtimeExpression("./assets/model_quant_2.tflite")
        : JSON.stringify("/assets/model_quant_2.tflite"),
    },
    plugins: [
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
            src: path.resolve(rootDir, "node_modules/@litertjs/core/wasm/*"),
            dest: "vendor/litert",
          },
        ],
      }),
    ],
    build: {
      lib: {
        entry: {
          index: path.resolve(rootDir, "src/index.ts"),
          "audio-worklet": path.resolve(rootDir, "src/audio-worklet.ts"),
        },
        name: "NoiseSuppression",
        formats: ["es"],
        fileName: (_format, entryName) => `${entryName}.js`,
      },
      target: "es2022",
      sourcemap: true,
      rollupOptions: {
        external: ["fft.js"],
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
