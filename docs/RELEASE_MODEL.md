# Release Model

This document describes the CI/CD release chain for the five deployable
units (`shell-gateway`, `page-home`, `page-product`, `promotion-banner`,
`recommendation-widget`) and marks each stage as implemented or planned.

## Pipeline Overview

```
change on a branch
  |
  v
[1] CI verify (.github/workflows/ci.yml, job: verify)          IMPLEMENTED
      pnpm verify: typecheck, lint, format, tests, build, audits
  |
  v
[2] Affected detection (job: affected)                         IMPLEMENTED
      scripts/affected.mts -> tools/release-tools/src/affected.ts
      git diff paths + pnpm workspace dependency graph
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
[5] Registry promotion                                          PLANNED (separate workstream)
      scripts/promote-fragment.mts moves a fragment/page version
      between preview -> canary -> stable channels in
      packages/registry (@mvp/registry) / packages/routes (@mvp/routes)
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
      blocked on services exposing Prometheus /metrics
```

## Affected Detection

nx is configured in `nx.json` but not installed, so affected computation is
implemented directly on top of git and the pnpm workspace graph:

- `pnpm exec tsx scripts/affected.mts [--base <ref>] [--list] [--github-output <file>]`
- Core logic (pure, unit tested): `tools/release-tools/src/affected.ts`.
- Rules: files in a workspace package affect that package's transitive
  dependents; `packages/routes` (`@mvp/routes`) affects only `shell-gateway`;
  `packages/registry` (`@mvp/registry`) affects `shell-gateway`, `page-home`, and
  `page-product`; repo-global files (lockfile, root `package.json`,
  `tsconfig.base.json`, `.dockerignore`) affect all units; docs, infra
  manifests, CI config, e2e specs, and markdown affect none; unknown paths
  conservatively affect all units.
- Acceptance property: a fragment-only change produces a build matrix with
  only that fragment's image; a page-only change only that page's image.

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
- Rendered pages for the Next.js apps, which expose no `/health` route yet:
  page-home root (4101, marker `data-page="home"`) and the product demo page
  (4102, marker `data-page="product"`).
- Composed shell routes on 4100 (`/` and `/product/123`) including the
  `data-shell-gateway="true"` marker.

It prints a JSON report to stdout and exits non-zero on timeout or failure.
Polling logic is unit tested in `tools/release-tools/src/smoke.ts`.

## Kubernetes Deployment

- All Deployments in `infra/k8s/` carry readiness and liveness probes and
  conservative resource requests/limits. Fastify services probe `/health`;
  the Next.js page apps probe `/` until they expose `/health`.
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
| AnalysisTemplates (success rate, p95 latency) | Skeleton; queries reference `http_requests_total` / `http_request_duration_seconds_bucket`, which the services do not export yet (no `/metrics` endpoint, see GAP_ANALYSIS 2.4) |
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
