import { defineConfig, devices } from "@playwright/test";

// The e2e suite expects the demo stack to be running already
// (shell-gateway on 4100, page apps on 4101/4102, fragments on 4201/4202).
// See e2e/README.md for how to start it. No webServer block on purpose:
// locally `pnpm dev` owns the stack, in CI the docker smoke script does.
export default defineConfig({
  testDir: "./e2e",
  // Keep Playwright specs (*.spec.ts) separate from Vitest unit tests
  // that may live under e2e/unit/**/*.test.ts.
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  reporter: [["html", { outputFolder: "reports/playwright" }], ["list"]],
  use: {
    baseURL: "http://127.0.0.1:4100",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "no-js",
      use: { ...devices["Desktop Chrome"], javaScriptEnabled: false },
      // API-only contract tests do not involve a browser page, so running
      // them twice adds nothing.
      testIgnore: "**/fragments-api.spec.ts",
    },
  ],
});
