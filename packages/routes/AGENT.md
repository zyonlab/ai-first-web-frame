# @mvp/routes — AGENT.md

## What this package is for

`@mvp/routes` is a small, static route registry mapping shell-gateway URL
paths (with `:param` segments) to the page service that serves them, plus a
path-matcher. It moved into the workspace from `platform/route-registry` in
the P1 re-layering phase. The registry is a single hard-coded array (no data
file, no CLI, no mutation API — unlike `@mvp/registry`); page service URLs are
each overridable via one `process.env.PAGE_<ID>_URL` per route, read once at
module load. Use it in `apps/shell-gateway` to resolve an incoming request
path to the page service that should render it.

## Entry points

- `routeRegistry: RouteRegistry` — the module-level registry
  (`{ routes: RouteEntry[] }`), currently seven routes (`home`, `product`,
  `trade`, `markets`, `portfolio`, `vaults`, `referrals`), each
  `RouteEntry = { id: "home" | "product" | string, path: string, page:
  string, serviceUrl: string, channel: ReleaseChannel }`
  (`ReleaseChannel = "stable" | "canary" | "preview"`, a package-local type,
  not re-exported from `@mvp/contracts`). `serviceUrl` for each route defaults
  to `http://localhost:<port>` and is overridden by
  `process.env.PAGE_<ID>_URL` (e.g. `PAGE_HOME_URL`, `PAGE_TRADE_URL`).
- `matchRoute(pathname: string, registry?: RouteRegistry = routeRegistry): RouteEntry | null`
  — exact-path match first, then `matchesPathPattern` for `:param` routes
  (e.g. `/trade/:symbol` matches `/trade/BTC-USD`); `null` if nothing
  matches.
- `matchesPathPattern(pattern: string, pathname: string): boolean` — segment-
  by-segment matcher: a literal pattern with no `:` requires an exact string
  match; otherwise every segment must either start with `:` (wildcard) or
  equal the corresponding path segment, and segment counts must match.
- `validateRouteRegistry(registry: RouteRegistry): boolean` — structural
  sanity check (`routes` is an array; every entry has a string `id`, a
  `path` starting with `/`, a `page` starting with `@mvp/`, an `http`-
  prefixed `serviceUrl`, and `channel` in `["stable", "canary", "preview"]`).
  Not schema-driven (no Zod involved) and returns a boolean rather than
  issues — unlike `@mvp/registry`'s Zod-backed fragment registry validation.

## Error taxonomy

This package defines no custom error classes and throws nothing. Every
function is pure and total: `matchRoute` returns `null` on no match,
`validateRouteRegistry` returns `false` on an invalid shape. There is no I/O
and no schema-parse path that can throw.

## Example

```ts
import { matchRoute, validateRouteRegistry, routeRegistry } from "@mvp/routes";

if (!validateRouteRegistry(routeRegistry)) {
  throw new Error("route registry is malformed");
}

const route = matchRoute("/trade/BTC-USD");
if (!route) {
  // 404 — no page owns this path
} else {
  console.log(route.page, route.serviceUrl); // "@mvp/page-trade" "http://localhost:4103"
}
```

## Accept

```
pnpm --filter @mvp/routes test
```
Expected: Vitest exits 0. `packages/routes/src/registry.test.ts` covers exact
and `:param` path matching against the built-in route list.
