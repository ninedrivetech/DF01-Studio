import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const edgeInstalled =
  process.platform === "win32" &&
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].some(existsSync);
const port = Number(process.env.PLAYWRIGHT_PORT ?? 1420);

export default defineConfig({
  testDir: "../tests",
  outputDir: "../test-results",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: fileURLToPath(new URL("../playwright-report", import.meta.url)),
    }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    channel: edgeInstalled ? "msedge" : undefined,
    viewport: { width: 1440, height: 960 },
    locale: "zh-CN",
    reducedMotion: "reduce",
    actionTimeout: 8_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    cwd: root,
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
