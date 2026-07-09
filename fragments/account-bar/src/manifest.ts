import { sourceIds } from "@mvp/data";
import { accountBarBudget } from "./budget";

/**
 * account-bar fragment manifest (A2-account). Mirrors the
 * `market-header/src/manifest.ts` shape and is validated by
 * {@link validateAccountBarManifest}.
 *
 * - `renderStrategy: "dynamic-ssr"`: the account bar is **request-time** (equity
 *   / margin usage / withdrawable resolve per SSR request) *and* realtime
 *   (margin patches live). There is no shared TTL — `cachePolicy.ttl = 0` — so
 *   every request re-reads the user-private account frame.
 * - `assets.js` lists `@mvp/trade-client` as a **shared dependency** (C2 /
 *   spine §11) so React/Radix bundle once; only the small island glue is
 *   fragment-owned. `@mvp/assets` dedupes the shared chunk across fragments.
 * - `dataDependencies` is the single C5 `account` id. This id is **shared** with
 *   `order-form` and `positions-table`: one `account` resolution feeds all three
 *   slots (spine §6), so the runtime coalesces the read (`duplicate-data-
 *   resolution` dedupe hint) instead of re-fetching per fragment.
 */
export const accountBarManifest = {
  name: "account-bar",
  owner: "trading-core",
  version: "0.1.0",
  renderMode: "ssr",
  renderStrategy: "dynamic-ssr",
  cachePolicy: {
    // Request-time + realtime: no shared TTL. Each SSR request re-reads the
    // user-private account frame; the island patches margin live on top.
    ttl: 0,
    tags: ["account", "account-bar"],
    vary: ["tenant", "props"],
  },
  endpoint: "/render",
  fallback:
    '<section data-fragment="account-bar" data-fallback="true">Account bar unavailable</section>',
  assets: {
    // Shared React runtime chunk (deduped by @mvp/assets) + the small island
    // glue this fragment owns.
    js: ["@mvp/trade-client", "/assets/account-bar.island.js"],
    css: ["/assets/account-bar.css"],
  },
  budget: accountBarBudget,
  consumes: { slices: ["trade.leverage"] },
  layoutHint: { shape: "panel" },
  // Shared `account` node (dedupe): order-form + positions-table read the same
  // id; the runtime resolves it once per SSR request.
  dataDependencies: [sourceIds.account],
  metadata: {
    category: "trading",
    description:
      "Request-time + realtime account bar: equity, margin usage, withdrawable, with leverage-driven margin preview",
  },
} as const;

export function validateAccountBarManifest(
  manifest = accountBarManifest,
): boolean {
  return Boolean(
    manifest.name &&
      manifest.owner &&
      manifest.version &&
      manifest.renderMode &&
      manifest.fallback &&
      manifest.assets &&
      manifest.budget &&
      Array.isArray(manifest.dataDependencies) &&
      manifest.dataDependencies.length > 0,
  );
}
