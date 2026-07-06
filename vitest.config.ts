import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pathFromRoot = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mvp/assets": pathFromRoot("./packages/assets/src/index.ts"),
      "@mvp/contracts": pathFromRoot("./packages/contracts/src/index.ts"),
      "@mvp/data": pathFromRoot("./packages/data/src/index.ts"),
      "@mvp/design-system": pathFromRoot(
        "./packages/design-system/src/index.ts",
      ),
      "@mvp/design-tokens": pathFromRoot(
        "./packages/design-tokens/src/index.ts",
      ),
      "@mvp/interaction": pathFromRoot("./packages/interaction/src/index.ts"),
      "@mvp/trade-client": pathFromRoot("./packages/trade-client/src/index.ts"),
      "@mvp/observability": pathFromRoot(
        "./packages/observability/src/index.ts",
      ),
      "@mvp/optimizer": pathFromRoot("./packages/optimizer/src/index.ts"),
      "@mvp/request": pathFromRoot("./packages/request/src/index.ts"),
      "@mvp/request-context": pathFromRoot(
        "./packages/request-context/src/index.ts",
      ),
      "@mvp/runtime": pathFromRoot("./packages/runtime/src/index.ts"),
      "@mvp/storage": pathFromRoot("./packages/storage/src/index.ts"),
      "@mvp/ui": pathFromRoot("./packages/ui/src/index.ts"),
      "@mvp/workers": pathFromRoot("./packages/workers/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    // v8 coverage is only reliable with process isolation: collecting V8
    // coverage from worker threads is a known source of hangs, so pin the
    // forks pool instead of relying on the default.
    pool: "forks",
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "tools/**/*.test.ts",
      "apps/**/*.test.ts",
      "fragments/**/*.test.ts",
      "platform/**/*.test.ts",
      "e2e/unit/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // Keep report output in one gitignored directory at the repo root.
      reportsDirectory: "./coverage",
      // NOTE: do not add an explicit `coverage.include` here. With Vitest 4
      // the default only remaps files imported during the test run; forcing
      // include globs makes the provider parse never-imported files (e.g.
      // scaffold/demo .tsx sources) and the remap step fails with a Rollup
      // PARSE_ERROR on them.
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        "e2e/**",
        "scripts/**",
        "infra/**",
        "**/*.config.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
