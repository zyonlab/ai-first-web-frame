import { defineConfig } from "vitest/config";
import { buildWorkspaceAliases } from "./scripts/workspaceAliases.mts";

/**
 * `@mvp/*` specifiers resolve to `src/`, not `dist/`, so tests run without a
 * prior build. The map is DERIVED from every workspace package's
 * `package.json#exports` (see scripts/workspaceAliases.mts) instead of being
 * hand-maintained here: the previous hand-written list was ~110 lines, had to be
 * edited whenever a package or a fragment subpath was added, carried
 * domain-specific entries in a repo-root config, and had no gate proving it was
 * complete.
 */
export default defineConfig({
  resolve: {
    alias: buildWorkspaceAliases(),
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
