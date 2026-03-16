import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import viteConfig from "./vite.config.mjs";

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

const launchOptions =
  chromiumExecutablePath && chromiumExecutablePath.length > 0
    ? {
        executablePath: chromiumExecutablePath,
        args: ["--autoplay-policy=no-user-gesture-required"],
      }
    : {
        args: ["--autoplay-policy=no-user-gesture-required"],
      };

export default defineConfig((env) => {
  const resolvedViteConfig =
    typeof viteConfig === "function"
      ? viteConfig({
          command: "serve",
          mode: env.mode,
        })
      : viteConfig;

  return mergeConfig(
    resolvedViteConfig,
    defineConfig({
      test: {
        include: ["test/**/*.browser.test.ts"],
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({
            launchOptions,
          }),
          instances: [{ browser: "chromium" }],
        },
      },
    })
  );
});
