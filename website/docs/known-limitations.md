# Known limitations

Everything here was found by reading the source tree and running the gates, not by reading the
internal docs. Each entry names the file that proves it. Nothing in this list is a hypothetical.

The list is ordered by what would hurt first, and each entry says who it hurts: **AX** an AI agent
working in the repository, **DX** a human developer, **OPS** someone running it, **DOCS** a claim
that is not true as stated.

---

<a id="f1"></a>
## F1 · The optimizer advises statically rendering the realtime order book — AX, high

`reports/optimization-findings.json` currently contains 10 findings of the form:

> `static-slot-book` · "Slot **book** has no declared dependencies and may not need dynamic SSR."
> · recommendation: "Change the slot strategy to static, ttl-cache, or cached-ssr if its content is
> deterministic."

The 10 slots include `book`, `trades`, `orderForm`, `positions`, `openOrders` and `accountBar` —
the realtime trading panels. Acting on the recommendation breaks them.

**Why it happens** — three links, all verifiable:

1. `tools/optimization-audit/src/index.ts:55` calls
   `createOptimizationFindings({ slots, traces })`. `dataDependencies` is never passed.
2. `packages/optimizer/src/index.ts:461-468` — `findStaticSlotCandidates` has a guard that would
   have suppressed exactly these:
   `dependencies.some(d => d.privacy === "user-private" || d.freshness === "realtime" || d.freshness === "client-local")`.
   Because the input is always `[]`, the guard is always false.
3. `packages/optimizer/src/index.ts:470-474` — the surviving condition is
   `(slot.strategy ?? "dynamic-ssr") === "dynamic-ssr" && (slot.dependsOn ?? []).length === 0`.
   `dependsOn` is **inter-slot ordering**. `book` has no `dependsOn` because no other slot waits on
   it, not because it is static.

Underneath both is the same structural issue: the fragments *do* declare their data
(`fragments/order-book/src/manifest.ts:30` → `dataDependencies: ["book.l2.<symbol>"]`), the
optimizer reads the page side, and nothing reconciles the two.

**Severity for an agent.** These findings are `info`, so the gate passes and a human skims past
them. An agent reading `reports/optimization-findings.json` sees a structured `recommendation`
field on 10 of 19 slots and has no signal that it is wrong.

**Fix shape.** Pass the fragment-declared dependencies into the audit input, and key the rule on
declared freshness rather than on `dependsOn`.

---

<a id="f2"></a>
## F2 · `<FRAGMENT>_URL` moves the service but not its island assets — OPS, medium

`packages/registry/src/registry.ts` — `withOverride()` rewrites `serviceUrl` and `manifestUrl`
from the env override and passes `assetsUrl` through **unchanged**. The code says so itself:

> "Not rewritten relative to the overridden host … a real rollout needs `assetsUrl` to derive from
> the same override, not just `serviceUrl`."

So pointing a fragment at another host still loads its island JavaScript from wherever it was
registered. Affects the one fragment that has `assetsUrl` today: `order-form` on `canary`.

Since the env override is the documented way to repoint a fragment without a registry write, this
undercuts that path for any fragment serving its own island bundle.

---

<a id="f3"></a>
## F3 · ~~Three env vars are declared and read nowhere~~ — FIXED

`turbo.json` `globalPassThroughEnv` listed `REGISTRY_URL`, `REGISTRY_USERNAME` and
`REGISTRY_PASSWORD`, which a repository-wide search showed were read **nowhere**. They implied an
authenticated remote-registry integration that does not exist, and an operator could reasonably
have set them and expected an effect.

Removed. `globalPassThroughEnv` is now `SHELL_URL`, `PAGE_*_URL`, `*_URL`,
`RECENTLY_VIEWED_COOKIE_SECRET` — all of which are read. Kept on this page as a record of the
class of rot to watch for: a passthrough env declaration costs nothing to add and nothing warns
when it stops (or never starts) being used.

---

<a id="f4"></a>
## F4 · Two CLI flags exist only in code — AX, medium

The authoritative flag list for each lifecycle script is the allowlist it passes to
`unknownFlagError`. Compared against the operations manual:

| Script | Flag in code | In `CLAUDE.md`? |
| --- | --- | --- |
| `mount-slot` | `--depends-on` | no |
| `register-fragment` | `--manifest-url` | no |
| `register-fragment` | `--assets-url` | no |

`--depends-on` is the only way to declare slot ordering from the CLI, and slot ordering is one of
the framework's distinguishing features. An agent that only reads the manual cannot discover it,
and will instead hand-edit the manifest — which the same manual forbids.

(The full sets are in [reference/cli](reference/cli.md), taken from the allowlists.)

---

<a id="f5"></a>
## F5 · The gateway's own HTTP surface is undocumented — DX, medium

`apps/shell-gateway/src/server.ts` serves `/manifest/routes`, `/manifest/fragments`,
`/_shell/theme` and `/_shell/locale` (lines 239–252). None of the four appears in `CLAUDE.md` or
anywhere in `docs/`.

`/manifest/fragments` in particular is the fastest way to debug a misrouted slot, because it
returns the registry **after** env overrides are applied. It is written up in
[reference/http-endpoints](reference/http-endpoints.md) for the first time here.

---

<a id="f6"></a>
## F6 · The promote path is exercised on 2 of 14 fragments — OPS, medium

`registry/registry.data.json`: only `promotion-banner` (stable + canary) and
`recommendation-widget` (stable) have a `stable` entry. The other 12 are `canary`-only, and every
slot on `page-trade`, `page-markets` and `page-portfolio` mounts `channel: "canary"`.

Two consequences:

- The documented `canary → stable` lifecycle is demonstrated on 2 units, not 14. Treat the promote
  and rollback paths as lightly exercised.
- A slot naming a channel the fragment does not have resolves to the slot's **fallback, silently**.
  There is no build-time check that every slot's channel exists in the registry — which would be a
  cheap gate to add, and would have caught this.

`recommendation-widget` additionally has no `versions` history, so `rollback-fragment` correctly
refuses it for lack of a recorded target.

---

<a id="f7"></a>
## F7 · Two of the seven pages compose nothing — DOCS, low

`apps/page-referrals/src/manifest.slots.json` and `apps/page-vaults/src/manifest.slots.json` are
both `[]`. "Seven pages composing fragments" overstates it: five compose, 19 slots total.

Their 102 KB first-load JS against a 110 KB budget is therefore framework baseline with **7.5 KB
of headroom** — adding one island to either needs a budget change.

---

<a id="f8"></a>
## F8 · `dev:*` scripts exist for 4 of 22 units — DX, low

Root `package.json` has `dev:shell`, `dev:page-home`, `dev:page-product`,
`dev:fragment:promotion-banner`, `dev:fragment:recommendation-widget`. There is no
`dev:page-trade`, despite `page-trade` being the nine-slot demo everything else is explained
through.

`pnpm --filter @mvp/page-trade dev` works fine — the scripts are a half-finished convenience, and
their partial presence implies the filter form is a fallback rather than the norm.

---

<a id="f9"></a>
## F9 · `pnpm verify` runs its 14 gates strictly sequentially — DX, low

`scripts/verify.mts:51` — `commands.map(({cmd, args}) => spawnSync(...))`. The six audits are
independent of each other and of `test`/`build`, and none of them overlaps.

Latency, not correctness; a warm run is around 32s so it rarely hurts. Worth knowing before
someone concludes the gates are inherently slow.

---

<a id="f10"></a>
## F10 · Four islands exceed the size guideline and nothing owns it — DX, low

`reports/server-client-boundary-report.json` carries four open `large-client-component` issues at
severity `warn`:

- `apps/page-trade/src/hydrate.tsx`
- `fragments/chart-panel/src/island.tsx`
- `fragments/market-header/src/island.tsx`
- `fragments/order-form/src/island.tsx`

`warn` does not fail the gate, the guideline has no number in any `budget.ts`, and no unit owns the
warning. It is a permanent yellow light: either give it a budget field so it can fail, or drop the
rule.

---

<a id="f11"></a>
## F11 · Five of eleven budget fields have no gate anywhere — DOCS, medium

`PerformanceBudgetSchema` defines 11 ceilings. What actually enforces them:

| Enforcement | Fields |
| --- | --- |
| Gated by `pnpm verify` | `jsBytes`, `cssBytes` |
| Gated only by `pnpm verify:runtime` (needs a live URL, **not** a verify gate) | `maxTTFBMs`, `maxLCPMs`, `maxCLS` |
| Runtime-only, acknowledged unmeasurable | `rscPayloadBytes` |
| **No gate anywhere** | `maxNetworkRequests`, `maxINPMs`, `maxFragmentLatencyMs`, `maxRenderMs`, `maxMemoryMB` |

The blanket claim "performance budgets are hard gates: exceeding component/fragment/page budgets
fails `pnpm verify`" is true of 2 fields out of 11.

To be fair to the tooling: `audit:bundle` is explicit about its own scope — its report carries an
`unmeasured` array with a `reason` per skip, and a `notes` entry stating that runtime-only metrics
are not gated. The gap is between the schema and the gates, and between the gates and the summary
prose.

The sharpest instance: every one of the 14 fragments declares `maxFragmentLatencyMs` and
`maxRenderMs` — the two most operationally meaningful numbers a fragment has — and nothing reads
either. Also, every page declares `maxINPMs: 200` while the runtime gate implements LCP, CLS and
TTFB checks and no INP check at all.

---

<a id="f12"></a>
## F12 · ~~The scaffold file count is stated as 9 in three places and 11 in three others~~ — FIXED

The scaffolder writes **11** files (`tools/create-component/src/index.ts`, `createFragment`):
`src/{server,render,manifest,budget,fixtures,render.test}.ts`, `tests/server.test.ts`,
`package.json`, `tsconfig.json`, `Dockerfile`, `README.md`.

| Says 11 (correct) | Says 9 (stale) |
| --- | --- |
| `CLAUDE.md:48` | `packages/mcp/src/tools.ts:72` — the **MCP tool description** |
| `tools/create-component/AGENT.md:49` | `docs/AI_NATIVE_DEVX.md:215` |
| `docs/OPERATIONS.md:27` | `docs/trade-demo/07-deployment-examples.md:56` |

The wrong number was in the one place an AI agent reads by default: the MCP tool description is
what a tool listing shows. `CLAUDE.md` states the accept criterion as `files.length === 11`, so an
agent that trusted the tool description and asserted 9 would fail a check the manual defines
correctly.

All three stale sites are now corrected to 11. `tools/create-component/src/fragmentTemplate.ts:7`
still says 9 and is left alone deliberately — that comment narrates the *old* broken scaffold
(which emitted 9 files and could neither answer `/render` nor build an image) and is correct in
context.

Worth keeping on this page because the underlying gap remains: **nothing checks that a count
asserted in prose matches what the scaffolder emits.** The scaffolder's own test does not assert a
total, so the next divergence will be just as silent.

---

<a id="f13"></a>
## F13 · The interaction ACL is not validated against reality — DX, low

`domains/trade-contracts/src/slices.ts:164` lists `order-preview` as a subscriber of
`trade.order-draft`. `order-preview` appears nowhere else in the repository — no fragment, no
island, no owner id.

Nothing checks that a declared publisher or subscriber id corresponds to something that exists, so
the ACL can drift from the system it governs. Contrast with the live-panel contract, where
`apps/page-trade/src/liveContract.test.ts` fails the build for exactly this class of drift.

A related trap that is *not* a defect but reliably confuses people: publisher and subscriber ids
are **logical component ids, not fragment names**. `symbol-switcher` is an owner identity used in
`apps/page-trade/src/hydrate.tsx:173`, not a service under `fragments/`.

---

<a id="f14"></a>
## F14 · The render contract has two tiers and the tier is thrown away — OPS, medium

`parseFragmentRenderRequest` (`packages/contracts/src/index.ts`) tries the strict
`FragmentRenderRequestSchema`, falls back to `FragmentRenderRequestEnvelopeSchema` (where `ctx` is
`.partial().optional()`), and returns `strict: boolean` saying which tier matched. Only if both
fail does it return `ok: false`.

Verified live: `POST /render` with `{"ctx":{"locale":"en-US","tenant":"default"}}` — a context
missing the required `traceId`, `requestId`, `featureFlags` and `timestamp` — answers **200 with
real HTML**.

The two-tier design is reasonable. The problem is that **nothing reads `strict`**: a
repository-wide search finds no consumer outside tests. `packages/fragment-host/src/index.ts:209`
destructures the result, uses `parsed.ok` and `parsed.request`, and ignores `parsed.strict` — no
log line, no response header, no metric label.

Consequence: in production you cannot tell whether your pages are sending valid contexts or
silently degrading to the lenient tier — which means a page that quietly stopped propagating
`traceId` looks identical to one that works, while every downstream trace loses its parent.

One counter label would fix it.

---

<a id="f15"></a>
## F15 · A declared interaction channel is invisible to the dependency graph — DX, low

`tradeSliceContracts` declares 7 channels. `pnpm graph` reports **6** slice units. The missing one
is `trade.book-grouping`.

`tools/release-tools/src/unit-graph.ts:178-184` builds slice nodes by upserting from each fragment
manifest's `consumes.slices` / `produces.slices`. No manifest mentions `trade.book-grouping`, so it
has no node and no edges — and the affected engine therefore cannot know that changing that
channel's payload affects `order-book`.

Same shape as [F1](#f1): two sides declare related facts (the authoritative contract list, and the
manifest convention fields) and no gate compares them. Those manifest fields are also outside
`FragmentManifestSchema`, so nothing validates their spelling either.

---

## Things that look like limitations and are not

Worth stating, because each one gets reported as a bug:

- **An island silently not hydrating.** That is the version handshake working. Four distinct
  reasons are reported to `onSnapshotMismatch`; the SSR markup is deliberately left intact.
- **No runtime version negotiation.** A deliberate scope choice, and the main axis on which
  Module Federation is stronger. We detect and decline; we never load a different remote.
- **The page still statically imports each island and live panel.** There is no runtime module
  loading in this repository. Adding a *new* interactive fragment is a two-line page change;
  changing what an existing one does is not.
- **`/health` and `/ready` return identical payloads.** One handler serves both. If you need
  liveness and readiness to differ, that is a gap to close, not a subtlety.
- **The page-health signal is a hidden `<div>`, not a `<meta>`.** Deliberate: it is a gateway
  signal, not document metadata. React 19 *would* hoist a `<meta>` into `<head>`, which is exactly
  where a degradation marker should not be.
- **`reports/` keeps changing.** Machine output, rewritten by every `pnpm verify`. The
  hand-written reports are in `docs/reports/`.

## How to use this page

If you are evaluating: F1, F11 and F14 are the ones that would change a decision — one advisory
tool that is wrong, one claim broader than its implementation, one observability hole at the main
boundary. None of them is a design dead end; all three are a day of work each.

If you are an agent working here: read F1 before acting on any optimizer recommendation, and F4
before concluding a flag does not exist.

F3 and F12 are marked FIXED and kept rather than deleted, because the *mechanism* that let each
one happen is still there — an undeclared-env-var drift has no warning, and no test compares a
documented file count against what the scaffolder writes.
