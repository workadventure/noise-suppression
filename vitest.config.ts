import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import viteConfig from "./vite.config.mjs";

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browserNames = ["chromium", "firefox", "webkit"] as const;
type BrowserName = (typeof browserNames)[number];

function isBrowserName(value: string): value is BrowserName {
  return browserNames.some((browserName) => browserName === value);
}

const requestedBrowser = process.env.VITEST_BROWSER;

if (requestedBrowser && !isBrowserName(requestedBrowser)) {
  throw new Error(
    `Unsupported VITEST_BROWSER value: ${requestedBrowser}. Expected one of ${browserNames.join(", ")}.`
  );
}

const selectedBrowsers: readonly BrowserName[] = requestedBrowser
  ? [requestedBrowser]
  : browserNames;

const chromiumLaunchOptions =
  chromiumExecutablePath && chromiumExecutablePath.length > 0
    ? {
        executablePath: chromiumExecutablePath,
      }
    : undefined;

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
        fileParallelism: false,
        browser: {
          enabled: true,
          headless: true,
          provider: playwright(),
          instances: selectedBrowsers.map((browser) =>
            browser === "chromium"
              ? {
                  browser,
                  provider: playwright({
                    launchOptions: chromiumLaunchOptions,
                  }),
                }
              : { browser }
          ),
        },
      },
    })
  );
});
