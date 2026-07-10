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
      "@mvp/islands": pathFromRoot("./packages/islands/src/index.ts"),
      // Trade-demo patch-only fragment entry points (pure DOM-patch functions,
      // page-trade bundles them into the realtime hydration layer).
      "@mvp/fragment-order-book/patch": pathFromRoot(
        "./fragments/order-book/src/ladder.ts",
      ),
      "@mvp/fragment-trades-feed/patch": pathFromRoot(
        "./fragments/trades-feed/src/patch.ts",
      ),
      "@mvp/fragment-positions-table/patch": pathFromRoot(
        "./fragments/positions-table/src/patch.ts",
      ),
      // Trade-demo island entry points (source `.tsx`, page-trade bundles them).
      "@mvp/fragment-order-form/island": pathFromRoot(
        "./fragments/order-form/src/island.tsx",
      ),
      "@mvp/fragment-market-header/island": pathFromRoot(
        "./fragments/market-header/src/island.tsx",
      ),
      "@mvp/fragment-account-bar/island": pathFromRoot(
        "./fragments/account-bar/src/island.tsx",
      ),
      "@mvp/fragment-chart-panel/island": pathFromRoot(
        "./fragments/chart-panel/src/island.tsx",
      ),
      "@mvp/observability": pathFromRoot(
        "./packages/observability/src/index.ts",
      ),
      "@mvp/optimizer": pathFromRoot("./packages/optimizer/src/index.ts"),
      "@mvp/registry": pathFromRoot("./packages/registry/src/index.ts"),
      "@mvp/request": pathFromRoot("./packages/request/src/index.ts"),
      "@mvp/request-context": pathFromRoot(
        "./packages/request-context/src/index.ts",
      ),
      "@mvp/routes": pathFromRoot("./packages/routes/src/index.ts"),
      "@mvp/runtime": pathFromRoot("./packages/runtime/src/index.ts"),
      "@mvp/storage": pathFromRoot("./packages/storage/src/index.ts"),
      "@mvp/store": pathFromRoot("./packages/store/src/index.ts"),
      "@mvp/trade-chart": pathFromRoot("./domains/trade-chart/src/index.ts"),
      "@mvp/trade-contracts": pathFromRoot(
        "./domains/trade-contracts/src/index.ts",
      ),
      "@mvp/trade-data": pathFromRoot("./domains/trade-data/src/index.ts"),
      "@mvp/trade-prefs": pathFromRoot("./domains/trade-prefs/src/index.ts"),
      "@mvp/trade-theme": pathFromRoot("./domains/trade-theme/src/index.ts"),
      "@mvp/ui/AppNav": pathFromRoot("./packages/ui/src/AppNav/index.ts"),
      "@mvp/ui/shadcn": pathFromRoot("./packages/ui/src/shadcn/index.ts"),
      "@mvp/ui": pathFromRoot("./packages/ui/src/index.ts"),
      "@mvp/workers": pathFromRoot("./packages/workers/src/index.ts"),
    },
  },
  // The page apps set `jsx: "preserve"` in their tsconfig (Next.js owns the JSX
  // transform in the real build). Under Vitest we transpile the same `.tsx`
  // ourselves, so force the automatic JSX runtime here — otherwise esbuild falls
  // back to the classic transform and SSR-rendering a layout/page throws
  // "React is not defined". This matches the `react-jsx` mode packages already use.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    globals: true,
    environment: "happy-dom",
    // v8 coverage is only reliable with process isolation: collecting V8
    // coverage from worker threads is a known source of hangs, so pin the
    // forks pool instead of relying on the default.
    pool: "forks",
    include: [
      "domains/**/*.test.ts",
      "domains/**/*.test.tsx",
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "tools/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "fragments/**/*.test.ts",
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
