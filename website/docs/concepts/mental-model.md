# Mental model

Four ideas. If these land, the rest of the API reads as obvious.

## 1. A page is a composition of services, not a build artifact

The page app owns layout and slot names. It does not own the sections. Each section is an HTTP
service that could be redeployed while the page keeps running, because the page resolves
`serviceUrl` and version out of a registry on every request.

The practical consequence: "ship a change to the order book" means build one image, register a
version, promote a channel. It does not mean rebuild the trade page.

## 2. Declarations live with the thing they describe

A fragment declares its own version, fallback, assets, budget, backend proxy targets, SSR data
dependencies and browser subscriptions — in its own `src/manifest.ts`, published at
`GET /manifest`.

A page declares only what it alone knows: which slots exist, which fragment and channel fills
each, per-slot timeouts and cache policy, and the parameter values (which symbol is active).

Whenever those two lists disagree about who owns a fact, the fragment wins. That is what makes
independent deployment real: the realtime refactor moved ~470 lines out of the trade page into
the three fragments, and the payoff is that *changing what a fragment subscribes to now needs no
page change at all*.

## 3. Failure is local and declared

Every boundary has a declared degraded form. A slot has `manifest.fallback`. A dependency failure
marks downstream slots `skipped-dependency` rather than attempting them. An island whose snapshot
does not match is *not hydrated*, leaving valid server-rendered markup.

The only failure that changes the HTTP status is a **required** slot failing, which the gateway
turns into `503`. Everything else is a `200` with less on the page.

Nothing in this system responds to a broken part by producing a half-built version of it. That is
the rule the version handshake exists to enforce.

## 4. If it matters, it is checked by a command

The repository's position is that a convention nobody can run is a comment. So:

- boundaries are Zod schemas, and 6 of them are also emitted as JSON Schema;
- layering is a declarative config the audit enforces;
- "a fragment is deployable on its own" is `pnpm verify:unit`;
- manifest↔code drift is structurally impossible (codegen) *and* checked (`verify:manifest-gen`);
- documentation examples are executed (`docs:test`).

The corollary, and the reason [Known limitations](../known-limitations.md) exists as a first-class
page: anything declared but **not** checked should be treated as aspiration. Five of the eleven
performance-budget fields are in that category.

## How the pieces map to packages

| Concern | Package |
| --- | --- |
| Contracts for every boundary | `@mvp/contracts` |
| Slot scheduling, caching, streaming, proxy resolution, SEO, live panels | `@mvp/runtime` |
| The one fragment HTTP host | `@mvp/fragment-host` |
| Registry resolution + lifecycle mutations + slot codegen | `@mvp/registry` |
| Route registry | `@mvp/routes` |
| Data sources, cache adapters, subscriptions, freshness | `@mvp/data` |
| Contract-checked HTTP client | `@mvp/request` |
| Request context + serialization | `@mvp/request-context` |
| Island hydration + snapshot handshake | `@mvp/islands` |
| Interaction bus + mutations | `@mvp/interaction` |
| Client slice store | `@mvp/store` |
| Tokens, themes, components | `@mvp/design-tokens`, `@mvp/design-system`, `@mvp/ui` |
| Traces, metrics, OTLP export | `@mvp/observability` |
| Advisory optimizer findings | `@mvp/optimizer` |
| Agent tooling (MCP) | `@mvp/mcp` |
