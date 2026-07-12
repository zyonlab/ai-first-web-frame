# Monorepo Deployment

Monorepo does not mean one deployment. Every shell, page, and fragment (all 22 deployable units) has its own package, build target, and Dockerfile. Kubernetes manifests in `infra/k8s/` cover the full fleet: every unit gets a Deployment and a Service, with in-cluster wiring (`PAGE_<NAME>_URL` on shell-gateway, `<FRAGMENT>_URL` on each composed page) set explicitly so services dial cluster DNS instead of localhost defaults (see `docs/RELEASE_MODEL.md`, Kubernetes Deployment).

Shell release: change `apps/shell-gateway`, run affected tests and build, publish `shell-gateway:<sha>`, canary, then promote or roll back.

Page release: change a page app, run page SEO tests, budget tests, and build, publish only that page image, then adjust route-level rollout.

Fragment release: change a fragment service, run render contract tests and budget checks, publish only that fragment image, then update the fragment registry stable/canary channel.

Shared packages are published to an internal registry such as Verdaccio. Consumers rebuild before changes go live.
