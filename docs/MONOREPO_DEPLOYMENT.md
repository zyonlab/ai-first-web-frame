# Monorepo Deployment

Monorepo does not mean one deployment. Every shell, page, and fragment has its own package, build target, Dockerfile, and deployment example.

Shell release: change `apps/shell-gateway`, run affected tests and build, publish `shell-gateway:<sha>`, canary, then promote or roll back.

Page release: change a page app, run page SEO tests, budget tests, and build, publish only that page image, then adjust route-level rollout.

Fragment release: change a fragment service, run render contract tests and budget checks, publish only that fragment image, then update the fragment registry stable/canary channel.

Shared packages are published to an internal registry such as Verdaccio. Consumers rebuild before changes go live.
