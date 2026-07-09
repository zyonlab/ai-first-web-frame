# dev-harness — single-component dev (Phase 3)

Run ONE fragment in isolation with its contract-mocked world — no full stack.
Implements `docs/AI_NATIVE_DEVX.md` §4.

## Run

```bash
pnpm dev:component order-book            # themed preview on :4300
pnpm dev:component order-form --port 4321
pnpm dev:component order-form --json     # print the mock-world spec, no server
```

The preview shows the fragment's real SSR (POSTed from its running service's
`/render`) inside the dark design-system theme, in a pane sized to its
`layoutHint`, next to the **contract-mocked world** derived from its manifest:

- **Consumes — slices** (inject-to-drive), each with its seeded C3 initial value.
- **Consumes — data sources** (mock-fed by `@mvp/data`'s deterministic transport).
- **Produces — slices** (observe).

So you can see + reason about a component and exactly what to mock/inject/observe
without standing up the other 21 services. Requires the one fragment's service
running (`docker compose up <name>` or its package `start`).

## Pieces

- `src/mock-world.ts` — pure `describeMockWorld(manifest)` → the isolated-dev
  spec (seed / mock / inject / observe). Unit-tested.
- `src/harness-page.ts` — pure HTML generator for the preview. Unit-tested.
- `scripts/dev-component.mts` — the CLI/dev server.

## Next (Phase 3b)

Interactive drive — mounting the fragment's island in the browser and wiring the
inject buttons to a live shared store/bus — needs a client bundler (not yet in
the toolchain). The same drive is available headlessly today via each fragment's
island tests. See `docs/AI_NATIVE_DEVX.md`.
