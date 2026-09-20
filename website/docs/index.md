# ai-first-web-frame

An SSR-first micro-frontend framework where **a fragment is the unit of deployment** and
**every contract is machine-checkable**.

A page is a composition of independently deployed HTTP services. Each service owns its
markup, its data, its budget and its release channel. The page names slots; the framework
resolves each slot against a registry per request, runs them as a dependency graph, and
degrades slot-by-slot when one fails.

```
browser ── shell-gateway :4100 ── page app :4101-4107 ── fragment service :4201-4214
                                   (Next.js App Router)   (Fastify, one per unit)
```

## What is actually in the box

Counts below are from the repository, not from a roadmap:

| Thing | Count | Where |
| --- | --- | --- |
| Deployable units | 22 | 1 gateway + 7 page apps + 14 fragment services |
| Workspace packages | 55 | `apps/` `fragments/` `domains/` `packages/` `tools/` |
| Exported Zod schemas | 35 | `packages/contracts/src/index.ts` (+ 6 pre-generated JSON Schemas) |
| Composed slots | 19 | across 5 pages (`page-referrals` and `page-vaults` compose none) |
| Verification gates | 14 | `scripts/verify.mts` |
| Machine-readable rule codes | 18 | `reference/diagnostics.md` |
| MCP tools for agents | 8 | `packages/mcp/src/tools.ts` |

## Start here

- New to it: [What is it](introduction/what-is-it.md) → [Quick start](getting-started/quick-start.md)
- Building a fragment: [Your first fragment](getting-started/your-first-fragment.md)
- Driving it with an AI agent: [AI setup](getting-started/ai-setup.md)
- Evaluating it: [How it compares](introduction/how-it-compares.md) and
  [Known limitations](known-limitations.md) — read both.

## Reading these docs locally

```sh
pnpm docs:serve           # http://localhost:4301
pnpm docs:serve --open    # and open a browser
```

Zero dependencies and no build step: one script renders the Markdown on request.
URLs mirror the file paths, so every relative link in the source works unchanged.

## A note on these docs

Every factual claim here was checked against the source tree, and paths are cited so you
can re-check. Where the implementation is narrower than the idea, the docs say so inline
rather than in a footnote — and everything that is declared but not enforced, or documented
but not true, is collected in [Known limitations](known-limitations.md).
