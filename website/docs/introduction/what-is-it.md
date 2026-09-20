# What is it

A framework for building one web page out of many independently deployed server-rendered
services, with the composition rules expressed as schemas rather than conventions.

## The problem it addresses

A large product page is usually owned by several teams, but shipped as one artifact. Any
change means rebuilding and redeploying the whole page, and one slow or broken section
takes the page with it.

The alternative — browser-side micro-frontends — moves the composition into the client and
pays for it in JavaScript and in first paint. That trade is wrong for a page that must be
indexable and fast on first load.

This framework composes on the **server**. Each section is an HTTP service that answers
`POST /render` with HTML; the page fetches them in parallel, streams them as they settle,
and substitutes a declared fallback for any that fails.

## The three claims

**1. A fragment is the minimum deployable unit — and that is executable.**

`pnpm verify:unit --name <fragment>` builds only that unit's dependency closure, boots the
built artifact, and asserts that `/health`, `/ready` and `/manifest` all report the same
manifest version, and that `POST /render` output carries it. Each fragment has its own
Dockerfile. Going live with a new version needs no page rebuild: pages resolve
`serviceUrl` and version from `registry/registry.data.json` per request.

See [Minimum deployable unit](../concepts/minimum-deployable-unit.md).

**2. Every boundary is a schema, not a convention.**

35 Zod schemas in `packages/contracts/src/index.ts` cover the render request/response
envelope, both manifest kinds, the registry file, the request context, island snapshots,
performance budgets and the data-dependency descriptors. Six of them are also exported as
pre-generated JSON Schema so a non-TypeScript consumer can validate the same contracts.

See [Contracts first](../concepts/contracts-first.md).

**3. The repository is addressable by an agent, not just by a human.**

Eight MCP tools (`packages/mcp/src/tools.ts`) expose the lifecycle. Every lifecycle CLI
prints a JSON envelope with a `status` field and writes nothing on failure. Every
`packages/*` and `domains/*` directory ships an `AGENT.md` whose fenced TypeScript examples
are **executed** by `pnpm docs:test` inside `pnpm verify` — 36 files, 41 executable blocks — so
a documented example that stops working fails CI.

See [AI setup](../getting-started/ai-setup.md).

## What it is not

- **Not a client-side micro-frontend runtime.** There is no runtime module loading and no
  version negotiation. An island whose SSR snapshot does not match the page's expected
  version is *not* hydrated (four distinct mismatch reasons); it is never loaded from a
  different remote. If you need runtime remote loading, you want Module Federation.
- **Not a registry service.** The fragment registry is a JSON file in the repository
  (`registry/registry.data.json`) mutated by CLIs with atomic writes and an advisory lock.
  It gives you channels, promotion and rollback, but not cross-repository distribution.
- **Not a deployment system.** It produces one image per unit and a registry that can be
  repointed per fragment at runtime. Rolling those images out is left to your platform.
- **Not language-agnostic.** A fragment is a Node service built on `@mvp/fragment-host`.
  The wire format (`POST /render` → `{html, assets, …}`) is language-neutral, but nothing in
  the repository exercises a non-Node fragment.

## Shape of a request

1. Browser hits the gateway (`:4100`), which resolves the route from `@mvp/routes` and
   proxies to the owning page app.
2. The page app reads its slots from `src/manifest.slots.json` (via a generated
   `fragmentSlots.gen.ts`) and calls `executeFragmentSlots` / `streamFragmentSlots`.
3. The scheduler topologically layers slots and data dependencies, runs each layer in
   parallel, applies a per-slot timeout, and skips any slot whose dependency failed.
4. Each slot resolves to a fragment version through the registry channel, then to an HTTP
   `POST /render`. Cache policy can serve it from a bounded in-process cache instead.
5. The page renders a health marker; the gateway maps a failed **required** slot to `503`.
6. In the browser, islands hydrate only where the snapshot handshake passes, and declared
   realtime panels subscribe through `@mvp/runtime/live`.

Each step is a guide: [page composition](../guides/page-composition.md),
[slot scheduling](../guides/slot-scheduling.md),
[fallbacks and page health](../guides/fallbacks-and-page-health.md),
[islands](../guides/islands-and-hydration.md),
[realtime](../guides/realtime-subscriptions.md).
