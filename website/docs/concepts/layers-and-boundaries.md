# Layers and boundaries

Three layers, one direction, enforced by config rather than by review.

```
apps/ + fragments/     layer:product    may depend on anything
domains/               layer:domain     may depend on domain + framework
packages/              layer:framework  may depend only on framework
```

## The rule is declarative

`dependency-audit.json`:

```json
{
  "tags": {
    "packages/*":  ["layer:framework"],
    "domains/*":   ["layer:domain"],
    "apps/*":      ["layer:product"],
    "fragments/*": ["layer:product"]
  },
  "depConstraints": [
    { "sourceTag": "layer:framework", "onlyDependOnLibsWithTags": ["layer:framework"] },
    { "sourceTag": "layer:domain",    "onlyDependOnLibsWithTags": ["layer:domain", "layer:framework"] },
    { "sourceTag": "layer:product",   "onlyDependOnLibsWithTags": ["*"] }
  ]
}
```

Modelled on `@nx/enforce-module-boundaries`. A violation is `layer-constraint-violation` from
`audit:deps`. Fix the import, or change the constraint deliberately — do not add a tag to dodge it.

## Why the framework layer may not import a domain

`@mvp/contracts` is framework. If business vocabulary could land there, then "add an A/B bucket to
the request context" would mean editing a framework package — and every consumer inherits your
product's nouns.

That pressure is real, which is why there is a designed escape hatch instead of a rule people
quietly break: `ctx.extensions` (a validated string record, propagated as `x-mvp-ctx-<name>`)
takes the dimension without widening the schema. `domain-code-in-framework-package` is the audit
rule that catches the other route.

## Sibling isolation

Two more rules stop the horizontal leaks that a monorepo invites:

- `page-importing-another-page` / `cross-page-import` — page apps are separate deployables; one
  importing another's internals silently couples two release cycles.
- `fragment-importing-page-code` — a fragment that reaches into a page is no longer independently
  deployable, whatever the manifest claims.

## Server / client

A second audit (`audit:boundary`) covers the direction the layer rule cannot see:

| Code | Meaning |
| --- | --- |
| `server-imports-client-module` | a server file pulls in a `"use client"` module |
| `server-browser-global` | a server file touches `document` / `window` / `localStorage` |
| `page-use-client` | a page component marked `"use client"` when it need not be |
| `large-client-component` | advisory (`warn`) size guideline for a client component |

`audit:deps` adds `server-safe-browser-global` for framework packages: a `packages/*` file that
touches a browser global without `"use client"` fails. That is why `@mvp/runtime/live` — which is
browser-only by nature — is a separate export carrying `"use client"`, rather than something
bolted onto the main entry.

## Sharing across fragments

A fragment shares code by publishing an **export subpath**, not by importing a sibling:

| Subpath | Purpose | Example |
| --- | --- | --- |
| `./patch` | pure frame → patch logic, no DOM | `@mvp/fragment-order-book/patch` |
| `./live` | the browser live panel | `@mvp/fragment-order-book/live` |
| `./island` | the React island component | `@mvp/fragment-order-form/island` |
| `./manifest` | manifest for consumers that need it | `@mvp/fragment-market-header/manifest` |
| `./render` | the render function, for a composing test | `@mvp/fragment-order-form/render` |

Pure logic in `./patch`, DOM in `./live`, React in `./island` — that split is what keeps a
fragment's JS budget honest, because a page can pull the pure half without dragging React in.
