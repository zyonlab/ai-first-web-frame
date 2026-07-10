import { defineConfig } from "tsdown";

/**
 * Config for the C3 spike's shared vendor chunk
 * (docs/ARCHITECTURE_REFACTOR_PLAN.md §4.3.3).
 *
 * tsdown's default (like tsup's) is to treat every bare `node_modules`
 * specifier as external — correct for building a library, but the opposite
 * of what this build needs: these entry files exist SPECIFICALLY to inline
 * `react`/`react-dom`/`@mvp/trade-contracts`/`@mvp/ui/shadcn` into a
 * self-hosted static asset. `noExternal: true` forces every resolvable
 * dependency to bundle; multi-entry + rolldown's automatic code-splitting
 * then factors the code `react.ts` and `react-dom-client.ts` share (react-dom
 * imports `react` internally) into one common chunk both entries import via
 * a relative path — so the browser only ever loads ONE copy of react,
 * whether reached via the `"react"` import-map key or as a transitive dep of
 * `"react-dom/client"`.
 *
 * `noExternal: () => true` (not the boolean shorthand `true` — confirmed by
 * reading tsdown's own `ExternalPlugin` source, that literal form only
 * matches an id via `===`, so `true` never matches a string id and silently
 * falls through to tsdown's normal "externalize every `dependencies`/
 * `peerDependencies` entry" default) forces every resolvable import in this
 * config's entry graph to bundle, including third-party transitives
 * (Radix, `class-variance-authority`, `zod`, ...) — this vendor chunk is
 * meant to be fully self-contained.
 */
export default defineConfig({
  entry: [
    "vendor-src/react.ts",
    "vendor-src/react-jsx-runtime.ts",
    "vendor-src/react-dom-client.ts",
    "vendor-src/trade-contracts.ts",
    "vendor-src/ui-shadcn.ts",
  ],
  format: "esm",
  platform: "browser",
  outDir: "public/spike-vendor",
  dts: false,
  clean: true,
  noExternal: () => true,
  minify: true,
  // React/react-dom branch dev-mode warnings on `process.env.NODE_ENV` at
  // runtime; without this define they ship (and pay for) the full
  // development build. A real rollout would also need this set for every
  // per-fragment bundle, not just the vendor chunk (documented in the C3
  // spike findings).
  define: { "process.env.NODE_ENV": '"production"' },
});
