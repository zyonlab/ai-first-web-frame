# Release Model

This document describes the CI/CD release chain for the deployable units —
the shell gateway (`apps/shell-gateway`), every composed Next.js page
(`apps/page-*`), and every SSR fragment service (`fragments/*`) — and marks
each stage as implemented or planned. For the affected-computation rules
themselves (what narrows, what goes GLOBAL), [DELIVERY.md](./DELIVERY.md) is
the authoritative reference.

## Pipeline Overview

```
change on a branch
  |
  v
[1] CI verify (.github/workflows/ci.yml, job: verify)          IMPLEMENTED
      pnpm verify (13 gates): typecheck, lint, format, manifest-gen,
      docs:test, tests, build, 6 audits
  |
  v
[2] Affected detection (job: affected)                         IMPLEMENTED
      scripts/affected-graph.mts -> tools/release-tools/src/affected-graph.ts
      git diff paths seeded into the unit dependency graph
      (workspace packages + registry data + page manifests)
  |
  v  (push to main only)
[3] Docker build matrix (job: docker)                          IMPLEMENTED
      one build per affected unit
      tags: <unit>:<git-sha> and <unit>:latest
      pushed to $REGISTRY_URL only when registry credentials exist
  |
  v  (main push, or PR with 'e2e' label)
[4] Compose smoke + e2e (job: e2e)                             IMPLEMENTED (job skeleton; e2e specs owned separately)
      docker compose up -> scripts/docker-smoke.mts -> pnpm e2e
  |
  v
[5] Registry promotion                                          IMPLEMENTED (agent-run CLI; not CI-automated)
      scripts/promote-fragment.mts / rollback-fragment.mts move a
      fragment version between canary -> stable channels in the
      registry data (registry/registry.data.json, history in
      registry/releases.json), loaded by @mvp/registry; see
      docs/OPERATIONS.md steps 6-7
  |
  v
[6] Canary deploy via Argo Rollouts                             SKELETON
      infra/argo-rollouts/page-product-rollout.yaml
      traffic: 10% -> analysis -> 50% -> analysis -> 100%
  |
  v
[7] Metric-gated auto rollback                                  SKELETON
      infra/argo-rollouts/analysis-templates.yaml
      success-rate >= 99%, p95 latency <= 500ms
      blocked on the Next.js page apps exposing Prometheus /metrics
      (shell-gateway and all fragment services already do)
```

## Affected Detection

There is exactly ONE affected engine: the unit dependency graph. (A legacy
path-heuristic engine — `scripts/affected.mts` + `tools/release-tools/src/affected.ts`
— previously described here was deleted in PR #17 once CI, `deploy-affected`,
and the `@mvp/mcp` `affected` tool all converged on the graph engine.)

- CLI: `pnpm exec tsx scripts/affected-graph.mts [--base <ref>] [--json] [--github-output <file>]`
  (this is what `.github/workflows/ci.yml`'s `affected` job runs).
- Core logic (pure, unit tested): `tools/release-tools/src/affected-graph.ts`,
  over the unit graph built by `load-graph.ts` from the pnpm workspace,
  `registry/registry.data.json`, and each page's `manifest.slots.json`.
- Rules (summary — [DELIVERY.md](./DELIVERY.md) has the exhaustive
  narrow-vs-GLOBAL tables): a change in a workspace package seeds that
  package's transitive dependents; `registry/registry.data.json` /
  `registry/releases.json` diffs are content-parsed and seed only the
  changed fragment(s) plus their dependent pages (goal B1); `domains/*`
  changes seed their real consumers; `packages/registry/**` /
  `packages/routes/**` *code* changes, root config files, and unrecognized
  paths conservatively go GLOBAL; docs, infra manifests, CI config, e2e
  specs, and markdown affect nothing.
- Acceptance property: a fragment-only change produces a build matrix with
  only that fragment's image; a page-only change only that page's image; a
  registry promote/rollback rebuilds only the promoted fragment's dependents.

## Image Tagging and Push Gating

- Every affected unit is built as `<unit>:<git-sha>` (immutable release tag)
  plus `<unit>:latest` (convenience tag) on each main push.
- Builds run with `--provenance=false --sbom=false`, mirroring the
  documented local Docker constraint.
- Push happens only when the repository has registry configuration:
  - `vars.REGISTRY_URL` (GitHub Actions variable), e.g. `ghcr.io/<org>`
  - `secrets.REGISTRY_USERNAME`
  - `secrets.REGISTRY_PASSWORD`
  Without them, CI still builds images (validating the Dockerfiles) but
  skips login and push.

## Smoke Checks

`pnpm exec tsx scripts/docker-smoke.mts` polls the running Compose stack
(prerequisite: `docker compose -f infra/docker/docker-compose.yml up -d`):

- `/health` on shell-gateway (4100), promotion-banner (4201),
  recommendation-widget (4202).
- `/health` on the Next.js page apps too (page-home 4101, page-product
  4102 — every page ships `apps/page-*/app/health/route.ts`).
- Composed shell routes on 4100 (`/` and `/product/123`) including the
  `data-shell-gateway="true"` and rendered `data-page` markers.

It prints a JSON report to stdout and exits non-zero on timeout or failure.
Polling logic is unit tested in `tools/release-tools/src/smoke.ts`.

## Kubernetes Deployment

- All Deployments in `infra/k8s/` carry readiness and liveness probes and
  conservative resource requests/limits. Every service — fastify fragments
  and Next.js page apps alike — probes `/health`
  (pages: `apps/page-*/app/health/route.ts`).
- Image tags are parameterized through `infra/k8s/kustomization.yaml`.
  Manifests keep the `:dev` tag for local clusters; a release retargets a
  unit with:

  ```
  cd infra/k8s
  kustomize edit set image <unit>=$REGISTRY_URL/<unit>:$GIT_SHA
  kubectl apply -k .
  ```

  Validate offline with `kubectl kustomize infra/k8s`.

## Canary and Rollback

Target state: CI publishes `page-product:<git-sha>` -> promotion tooling
updates the rollout image (`kubectl argo rollouts set image page-product
page-product=$REGISTRY_URL/page-product:$GIT_SHA`) -> Argo Rollouts shifts
traffic 10% -> 50% -> 100%, running the `success-rate` and `latency-p95`
AnalysisTemplates between steps -> any failed analysis aborts the rollout
and Argo automatically returns traffic to the stable ReplicaSet.

Current boundary:

| Stage | Status |
| --- | --- |
| Canary steps (10/50/100) with analysis wiring | Implemented in manifests |
| AnalysisTemplates (success rate, p95 latency) | Skeleton; queries reference `http_requests_total` / `http_request_duration_seconds_bucket`, which shell-gateway and all fragment services already export at `/metrics` (`packages/observability/src/metrics.ts`) — only the Next.js page apps (including the rollout target page-product) lack a `/metrics` endpoint |
| Automatic trigger from CI to the cluster | Not implemented; no cluster credentials in CI |
| Prometheus deployment | Not part of this repo; templates default to `http://prometheus.monitoring.svc.cluster.local:9090` |

## Registry-level Release (packages, fragments, pages)

Packages release through internal package publishing. Pages and fragments
consume package versions and rebuild.

Fragments expose stable, canary, preview, and explicit versions through
`packages/registry` (`@mvp/registry`). Pages expose stable route entries through
`packages/routes` (`@mvp/routes`). Registry promotion and rollback scripts
(`scripts/promote-fragment.mts` and companions) are a separate workstream;
rollback is registry-driven for page and fragment traffic where possible,
while shell rollback uses the shell deployment controller (Rollout abort or
`kubectl rollout undo`).
