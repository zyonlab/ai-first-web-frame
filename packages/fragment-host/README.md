# @mvp/fragment-host

The shared HTTP host every SSR fragment service runs on: one implementation of
`GET /` · `/health` · `/ready` · `/metrics` · `/manifest` · `/assets` ·
`/budget` and `POST /render`, plus the per-fragment metrics registry and trace
export pipeline.

A fragment's `src/server.ts` is a ~20-line adapter over
`createFragmentServer()`. See [AGENT.md](./AGENT.md).
