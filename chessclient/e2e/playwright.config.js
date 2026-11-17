const { defineConfig } = require("@playwright/test");
const fs = require("node:fs");
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "*.spec.js",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (fs.existsSync(edge) ? edge : undefined),
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
