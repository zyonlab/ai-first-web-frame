# Release channels

`stable` | `canary` | `preview`. A slot names a channel; the registry resolves it to a version and
a `serviceUrl` **per request**, so going live with a new fragment build needs no page rebuild.

## The registry file

`registry/registry.data.json`, validated on load by `FragmentRegistrySchema`:

```json
{
  "fragments": {
    "promotion-banner": {
      "stable":  { "version": "0.1.0", "serviceUrl": "http://localhost:4201",
                   "manifestUrl": "http://localhost:4201/manifest" },
      "canary":  { "version": "0.2.0-beta.1", "serviceUrl": "http://localhost:4201", "…": "…" },
      "versions": { "0.1.0": { "…": "…" } }
    }
  }
}
```

`versions` is the history that makes rollback possible. `registry/releases.json` is an
append-only log of promotions.

Never hand-edit either file. Use the CLIs — they write atomically behind an advisory lock with an
optimistic content-hash check, and print `{"status":"conflict","retry":true}` instead of
clobbering a concurrent change.

## The rollout

```sh
# 1. deploy the image (your platform's job)
# 2. point canary at the new version
pnpm exec tsx scripts/register-fragment.mts --name order-book --version 0.2.0 \
  --service-url http://order-book.internal --channel canary
# 3. confirm WHICH build is answering
curl -s http://order-book.internal/health   # {"status":"ok","version":"0.2.0",…}
# 4. promote
pnpm exec tsx scripts/promote-fragment.mts --name order-book
# 5. if wrong, go back
pnpm exec tsx scripts/rollback-fragment.mts --name order-book
```

Step 3 is the point of having `/health` report the manifest version: a rollout can verify the
deployed artifact before promoting the channel that production reads.

## Repointing without a registry write

`<FRAGMENT_NAME>_URL` overrides the target at runtime — `ORDER_BOOK_URL`, `PRICE_PANEL_URL`
(`fragmentEnvVarName` uppercases and replaces non-alphanumerics). The value must parse as a URL or
registry load throws with the offending variable named.

The override rewrites `serviceUrl` and `manifestUrl`. It does **not** rewrite `assetsUrl` —
[F2](../known-limitations.md#f2).

## Resolution

```ts
import { resolveFragment } from "@mvp/runtime";
resolveFragment(registry, "order-book", "canary");   // by channel
resolveFragment(registry, "order-book", "0.1.0");    // by exact version
// -> { version, serviceUrl, manifestUrl } | null
```

`null` means not registered on that channel. A slot pointing at a channel the fragment does not
have resolves to the slot's fallback — quietly. There is no build-time check that every slot's
channel exists in the registry.

## State of the demo

Worth knowing before you take the lifecycle at face value: **12 of the 14 fragments have only a
`canary` entry.** Only `promotion-banner` (stable + canary) and `recommendation-widget` (stable)
carry `stable`, and every `page-trade`, `page-markets` and `page-portfolio` slot mounts
`channel: "canary"`. The promote path is exercised on 2 of 14 units
([F6](../known-limitations.md#f6)). `recommendation-widget` additionally has no `versions`
history, so `rollback-fragment` correctly refuses it for lack of a recorded target.
