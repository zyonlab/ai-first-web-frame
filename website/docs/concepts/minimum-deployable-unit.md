# Minimum deployable unit

The claim is that a fragment ships on its own. This page is what makes it checkable rather than
architectural.

## The executable form of the claim

```sh
pnpm verify:unit --name order-book
```

What it does, in order:

1. builds only that unit's dependency closure — `pnpm --filter @mvp/fragment-order-book... build`
   → `dist/server.js`;
2. boots the built artifact (not the source);
3. asserts `/health`, `/ready` and `/manifest` all report the **same manifest version**;
4. asserts `POST /render`-backed output carries that version;
5. checks the unit's registry channels.

JSON envelope out; exit 0 only when every step passed. Flags: `--name`, `--port`, `--filter`,
`--skip-build`. Statuses: `ok` · `passed` · `skipped` · `failed`.

Step 3 is the load-bearing one. If `/health` reported a hardcoded string, a rollout could not tell
which build answered, and "deploy then promote" would be faith rather than procedure.

## The packaging form

One Dockerfile per fragment, `fragments/<name>/Dockerfile`, with `EXPOSE <port>`. Any registry or
orchestrator can build and run it. Deployment itself is deliberately not implemented here —
every organisation already has one.

## Going live without a page rebuild

```
build image  ->  register-fragment --channel canary  ->  check /health version  ->  promote-fragment
```

Pages resolve `serviceUrl` and version from `registry/registry.data.json` **per request**, so no
page artifact changes. `<FRAGMENT_NAME>_URL` repoints a fragment at runtime without even a
registry write.

`rollback-fragment` restores the version recorded at promote time.

## What "independent" does and does not cover

**Covered.** Server-side markup, data access, CSS, fallback, budget, backend proxy targets, SSR
data dependencies, browser subscriptions, and the version those are published under. All of it is
in the fragment, all of it reaches the page through the registry and `GET /manifest`.

**Not covered — and this is the honest boundary:**

- **Client code must be statically imported by the page.** A React island is registered in the
  page's island registry; a live panel is listed in the page's panel array. There is no runtime
  module loading, so adding a *new* interactive fragment is a two-line page change. Changing what
  an existing one does — including what it subscribes to — is not.
- **Island assets do not follow an env override.** `<FRAGMENT>_URL` moves `serviceUrl` and
  `manifestUrl` but not `assetsUrl` ([F2](../known-limitations.md#f2)).
- **Shared vendor is the page's.** A fragment's `jsBytes` is measured with `react`/`@mvp/*`
  external. Two fragments cannot independently choose incompatible React versions; the repository
  enforces a single declared range.
- **Nothing exercises a non-Node fragment.** The `POST /render` contract is language-neutral and
  the JSON Schemas are published for exactly that reason, but there is no non-Node fragment in the
  tree, so treat multi-language as untested rather than supported.

## Counting

22 deployable units: 1 shell gateway, 7 page apps, 14 fragment services. Ports 4100, 4101–4107,
4201–4214 — see [reference/ports](../reference/ports.md).
