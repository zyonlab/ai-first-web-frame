# Fragment backend proxy

The channel a hydrated island uses to reach its own backend, without CORS and without leaking
the fragment's service address to the browser.

## The problem

A fragment can reach its backend during SSR — it is a server, it has `@mvp/request`. Its
hydrated island cannot: the browser knows only the public origin, and the fragment's
`serviceUrl` is internal (and must stay internal). Before this existed there was no standard
channel at all.

## Declaring one

In the fragment's `src/manifest.ts`:

```ts
proxy: {
  account: "/account",                          // relative: resolved against this fragment's serviceUrl
  rates:   "https://rates.internal.example/v2", // absolute: a shared or third-party backend
}
```

`FragmentManifestSchema.proxy` accepts either an absolute `http(s)` URL or a **root-relative
path**. The relative form is a deliberate departure from `@podium/proxy`: a fragment's own
endpoint lives at a different host per environment, and an absolute self-target would have to be
env-interpolated into a static manifest.

## What the gateway mounts

```
/_fragment/<fragment>/<target>/*   ->   <resolved base>/*
```

So the island calls `/_fragment/order-form/account` on the page's own origin. Same origin, no
CORS, and the real service address never reaches the browser.

All HTTP methods are forwarded (`server.all`). The request body is forwarded as-is rather than
re-serialized as JSON — an early version did `JSON.stringify(request.body ?? {})`, which
corrupted text and form bodies.

## The declared base is the boundary

Pure resolution logic lives in `packages/runtime/src/fragmentProxy.ts`:

```ts
parseFragmentProxyPath(pathname)       // -> {fragment, target, rest} | null
buildFragmentProxyUrl(base, rest, search, serviceUrl)
resolveFragmentProxy(options)          // the whole decision
```

A remainder that would escape the declared base is **rejected**, not normalized. A target is
reachable only if the manifest declares it.

One subtlety worth knowing if you write against these functions: an empty remainder must not
append a trailing slash. Fastify routes `/account` and `/account/` separately, so
`/_fragment/order-form/account` and `/_fragment/order-form/account/` are different requests and
only one of them is the one you declared.

Timeout: `SHELL_FRAGMENT_PROXY_TIMEOUT_MS`.
