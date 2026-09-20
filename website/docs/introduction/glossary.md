# Glossary

Terms as the code uses them. Where two words are easy to confuse, the distinction is spelled
out, because most integration mistakes in this system are vocabulary mistakes.

**Fragment** — an independently deployable SSR service that answers `POST /render` with HTML.
Lives in `fragments/<kebab-name>/`, runs on `@mvp/fragment-host`, owns one Dockerfile and one
port. 14 exist.

**Page** — a Next.js App Router app (`apps/page-*`) that declares slots and composes
fragments. 7 exist; 5 compose at least one slot.

**Shell gateway** — the single public origin (`:4100`). Resolves routes, proxies to page apps,
mounts fragment backend proxies, serves `robots.txt` / `sitemap.xml`, and turns a page health
marker into an HTTP status.

**Slot** — a named position in a page that a fragment fills. Declared in
`apps/<page>/src/manifest.slots.json`. 19 exist.

**Render strategy** — how a slot is produced: `static` | `ttl-cache` | `cached-ssr` |
`dynamic-ssr` (`RenderStrategySchema`).

**Release channel** — `stable` | `canary` | `preview` (`ReleaseChannelSchema`). A slot names a
channel; the registry resolves it to a concrete version and `serviceUrl` per request.

**`dependsOn` vs `dataDependencies`** — the single most confused pair.
`dependsOn` orders **slots relative to each other** (slot B renders after slot A). `dataDependencies`
names entries in the page's **data-source registry** that must resolve before the slot runs.
They feed the same topological scheduler but mean different things, and a slot with no
`dependsOn` is not therefore static — see [Known limitations](../known-limitations.md#f1).

**`dataDependencies` (fragment manifest) vs `subscriptions` (fragment manifest)** — the second
most confused pair. `dataDependencies` is what the fragment reads **once while server-rendering**.
`subscriptions` is what its browser panel holds **open**. They are deliberately separate:
`order-form` reads `account` at render time and subscribes to nothing.

**Source id / source template** — a data source is addressed by a normalized string
(`book.l2.BTC`, `positions`). A *template* carries `<param>` placeholders (`book.l2.<symbol>`)
which the page binds at mount time. Constructors live in `domains/trade-data/src/sourceIds.ts`;
never hand-format an id.

**Island** — a client component hydrated inside otherwise-static SSR markup. The fragment emits
the DOM plus an inline JSON snapshot; hydration proceeds only if the snapshot handshake passes.

**Live panel** — the non-React counterpart of an island: a server-rendered panel kept current by
folding subscription frames into in-place DOM patches. Ships from the fragment's `./live` export.

**Snapshot handshake** — the check that decides whether to hydrate. Four failure reasons:
`version-mismatch`, `contract-hash-mismatch`, `invalid-snapshot`, `invalid-props`
(`packages/islands/src/index.ts`). Failure means *SSR markup is left alone*, never a partial mount.

**Page health** — `ok` | `degraded` | `unhealthy`. A failed **optional** slot is `degraded` and
stays `200`; a failed **required** slot is `unhealthy` and the gateway answers `503`.

**Slice / channel** — a typed cross-fragment communication topic. One declared publisher, an
explicit subscriber list, a Zod payload schema. Publisher and subscriber ids are **logical
component ids, not fragment names** (`symbol-switcher` is an owner identity used by the page,
not a service).

**Minimum deployable unit** — a fragment, verified as such by `pnpm verify:unit --name <fragment>`.

**Gate** — one of the 14 commands `pnpm verify` runs (`scripts/verify.mts`). A gate either
passes or fails the build; advisory output is a **finding**, which does not.

**Unit (release tooling)** — a node in the affected graph: route, page, component, data source or
slice. Queried with `pnpm graph`.
