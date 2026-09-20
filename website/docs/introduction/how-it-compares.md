# How it compares

Positioning against the projects that solve overlapping problems. Competitor facts were
verified against their own repositories and registries; the date of that research is noted
per row. Our side is verified against this source tree.

## Summary

| Axis | Closest project | Who is stronger | Why |
| --- | --- | --- | --- |
| Server-side page composition | Podium (`@podium/layout`) | mixed | Podium is more mature and battle-tested; our scheduler (DAG + data dependencies + per-slot streaming) has no Podium equivalent. |
| Fragment HTTP host | `@podium/podlet` | Podium | Same job. Podium adds multi-language podlets and years of production. |
| Request context propagation | `@podium/context` | mixed | We carry more dimensions and validate with Zod; Podium lets you register custom parsers. We reach the same goal with `ctx.extensions`. |
| Registry + release channels | OpenComponents | mixed | OC is a real registry service with cross-team distribution. We are a JSON file — but with channels, promote/rollback and atomic conflict retry. |
| Fragment backend proxy | `@podium/proxy` | parity | Structural gap until recently; now implemented (`/_fragment/<fragment>/<target>/*`). |
| Client integration / version negotiation | Module Federation 2.0 | Module Federation | MF negotiates and loads a matching version. We only **detect** mismatch and decline to hydrate. |
| Task caching / affected | Nx, Turborepo | Nx | Nx infers the project graph and has remote caching. We run Turborepo for `build`/`test` plus a hand-written affected engine. |
| Deferred server rendering | Astro Server Islands | mixed | Astro is zero-config but passes props through the URL (2048-byte limit, POST fallback is uncacheable). We use a POST body and avoid that, at the cost of running a service. |
| Build gates / module boundaries | `@nx/enforce-module-boundaries`, size-limit, Lighthouse CI | mixed | Our rules are closer to the domain (orphan bus, bare `fetch`, hand-rolled fragment server); Nx's `tags`/`depConstraints` are more expressive; Lighthouse CI actually measures the web vitals we only declare. |
| Agent operability | — | us | No framework-level competitor. Nx and Module Federation have added AI documentation sections; neither turns agent-facing contracts into CI gates. |

## Where we are genuinely different

**Executable documentation as a gate.** `pnpm docs:test` extracts the fenced TypeScript
blocks out of every `AGENT.md` and runs them. 36 files, 41 executable blocks (plus 7 explicitly
marked `no-run`, counted separately in the report).
A stale example is a build failure, not a bug report. Neither Podium, Nx, Module Federation
nor OpenComponents does this.

**A contract-enforced interaction bus with an ACL.** Cross-fragment communication is
deliberately out of scope for Podium. Here each channel declares one publisher, an explicit
subscriber list and a Zod payload schema (`domains/trade-contracts/src/slices.ts`), and the
bus rejects an undeclared publish at runtime.

**Slot scheduling as a graph.** `dependsOn` plus `dataDependencies` produce topological
layers with per-slot timeouts, failure propagation to downstream slots, and — in streaming
mode — one promise per slot that flushes as soon as its own layer settles. Podium's layout
registers, fetches and concatenates.

## Where the honest answer is "use theirs"

- You need **browser-side** composition, independent deploys of *client* bundles, or runtime
  version negotiation → Module Federation.
- You need fragments written in .NET, PHP, Java or Go, published to a shared registry
  service consumed by other repositories → OpenComponents.
- You want the composition layer to be boring and proven, and you do not need a dependency
  graph between sections → Podium.
- You want the monorepo task graph, remote caching and generators to be someone else's
  problem → Nx.

## Research provenance

Competitor capabilities were verified on **2026-09-19** from the projects' own repositories,
documentation sites and npm registry metadata (`@podium/layout` 5.4.8, `oc` 0.50.64,
Module Federation 2.0 configuration reference, Nx run-tasks and enforce-module-boundaries,
Astro Server Islands guide). Competitor **documentation structure** was re-checked on
**2026-09-20** against `podium-lib/podium-lib.github.io/docs`,
`module-federation/core/apps/website-new/docs/en` and `nrwl/nx/astro-docs/src/content/docs`;
this documentation set follows the shape those three converge on.

Two things we could not verify and therefore do not assert: whether Podium has any
channel/canary concept, and whether the OpenComponents registry supports release channels.
Both appeared absent, but absence of evidence in a docs search is not evidence of absence.

Zalando's Tailor — the closest historical relative, and the origin of the "primary fragment
decides the status code" idea we implement as page health — was archived on 2022-12-05 with
no recommended successor.
