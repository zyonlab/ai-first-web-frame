# Post-Audit Remediation Plan — Parallel-Agent Task Document

> Created 2026-07-10 from a code-level acceptance audit of the P0–P5 refactor
> (see [ARCHITECTURE_REFACTOR_PLAN.md](ARCHITECTURE_REFACTOR_PLAN.md)). Every
> finding below was verified against actual code, NOT against that doc's own
> "Status:" notes — several of those notes overstate what landed. Treat this
> document as the source of truth for what remains.
>
> **Audience: executing agents.** Each task section is self-contained — you do
> not need any prior conversation context. Read the Global Rules, claim ONE
> task, stay inside its Owned Files, and follow its acceptance gate exactly.

## Global rules (every task, no exceptions)

1. **Workflow: branch → PR, never push to main.** Create the branch named in
   your task, commit there, push the branch, and open a PR with
   `gh pr create --base main`. End every commit message with
   `Co-Authored-By: Claude <noreply@anthropic.com>`.
2. **pnpm only** (never npm/npx/yarn). TDD: write the failing test first where
   the task adds behavior. Biome formatting (`pnpm check` must pass). New code
   and comments in English.
3. **The verify gate, measured honestly.** Before opening your PR run:
   ```
   pnpm verify > /tmp/<task-id>-verify.log 2>&1; echo "REAL_EXIT=$?"
   ```
   `REAL_EXIT=0` is required. NEVER pipe `pnpm verify` through `tail`/`head`
   (it masks the exit code) and never run two verifies concurrently (they
   corrupt shared `reports/` files).
4. **Known flake:** `scripts/verify.mts` gives the `pnpm build` step a hard
   120s budget. Under heavy host load (other agents building in parallel) a
   healthy build takes ~170s and the gate fails with every other gate green
   and `durationMs` ≈ 120000. If you see exactly that signature: check
   `ps aux` for concurrent builds, wait, re-run once, and say so in your PR.
   Do not "fix" verify.mts.
5. **Stay inside your Owned Files list.** If you believe a file outside your
   list must change, STOP and report why in your final message instead of
   editing it — another agent may own it. Generated artifacts
   (`*.tsbuildinfo`, `reports/*`) must never be committed; `git checkout --`
   them before committing.
6. **Honesty over completion.** A documented partial result ("X works, Y is
   blocked because Z") is worth more than a forced green. Never weaken a test
   to pass a gate.
7. Read `CLAUDE.md` (repo root) before starting — it is current and accurate
   (unlike some other docs, which Wave 1 Task D exists to fix).

## Execution order

- **Wave 1**: tasks A–F run in PARALLEL (verified-disjoint file sets). Merge
  each PR as it goes green.
- **Wave 2**: start only after ALL Wave 1 PRs are merged (W2 tasks touch files
  Wave 1 owns). Tasks A–D run in parallel.
- **Wave 3**: optional, after Wave 2.

| Task | Owned files (exclusive) |
| --- | --- |
| W1-A | `tools/release-tools/src/**`, `scripts/affected.mts`, `scripts/affected-graph.mts`, `.github/workflows/ci.yml` |
| W1-B | `packages/assets/package.json`, `packages/workers/package.json`, `.changeset/config.json` |
| W1-C | `packages/registry/src/mutations.ts` + its test file |
| W1-D | `docs/OPERATIONS.md`, `packages/runtime/AGENT.md`, `packages/mcp/AGENT.md` (new), `tools/create-component/AGENT.md` (new), `llms.txt` |
| W1-E | `packages/islands/src/**`, `packages/contracts/src/index.ts` (additive schema only) |
| W1-F | `e2e/**` |
| W2-A | `scripts/verify-runtime.mts`, `scripts/deploy-affected.mts`, `tools/runtime-gate/**` |
| W2-B | `packages/contracts/src/index.ts` (demonstrates field), `apps/*/src/manifest.ts`, new docs index file, `llms.txt` (append) |
| W2-C | new `scripts/docs-test.mts`, `scripts/verify.mts` (add gate), root `package.json` (add script) |
| W2-D | `apps/*/src/manifest.slots.json`, `apps/*/src/fragmentSlots.gen.ts` (via CLI regen only) |
| W3-A | `apps/page-{product,markets,portfolio,trade}/src/fragmentSlots.ts` + their `page.tsx` |
| W3-B | `registry/releases.json`, `registry/registry.data.json` (via CLI only) |

---

## WAVE 1

### W1-A — Fix the affected engine: model `domains/`, converge the two engines

Branch: `fix/affected-domains-and-convergence`. Severity: **highest — silent
under-build**.

**Problem 1 (silent under-build).** `tools/release-tools/src/affected-graph.ts`'s
`seedsFromPaths` has no branch for `domains/**`. `load-graph.ts` scans only
`fragments/` , `apps/`, `packages/` — domain packages (`domains/trade-contracts`,
`trade-data`, `trade-prefs`, `trade-theme`, `trade-chart`) never become graph
units. Consequence, verified: a change touching only
`domains/trade-contracts/src/index.ts` produces `seeds=[]`, `global=false` →
EMPTY affected set → the fragments that import that contract are NOT rebuilt or
redeployed. That is worse than over-building.

Fix: model `domains/*` packages as units in `load-graph.ts` (read each
`domains/*/package.json` name + its `@mvp/*` deps, same as `packages/` handling),
add a `domains/` branch to `seedsFromPaths` that seeds the domain unit, and make
sure `affectedClosure`'s reverse-dependency BFS pulls in every fragment/app
whose `package.json` depends on that `@mvp/trade-*` package. TDD: write the
failing test first ("a domains/trade-contracts path seeds trade-contracts and
its closure includes order-form + page-trade"), then fix. Also add a regression
guard test: an unknown top-level directory (e.g. `newthing/file.ts`) must NOT
silently produce an empty seed — decide the safe behavior (GLOBAL) and test it.

**Problem 2 (two engines, split brain).** Two affected engines coexist and are
used by DIFFERENT consumers: `.github/workflows/ci.yml` (~line 69) calls the
OLD heuristic `scripts/affected.mts` (`tools/release-tools/src/affected.ts`),
while `scripts/deploy-affected.mts` uses the NEW graph engine
(`scripts/affected-graph.mts` / `affected-graph.ts`). Same diff → two different
answers.

Fix: switch `ci.yml` to the graph engine (check what output shape CI consumes —
the old script supports `--github-output`; port that flag to
`affected-graph.mts` if CI needs it, matching its existing JSON output
conventions). Then either delete the old engine (`scripts/affected.mts` +
`tools/release-tools/src/affected.ts` + its tests) or, if anything else still
imports it (grep first), leave it with a deprecation header comment and file
a note in your PR. Prefer deletion if nothing breaks.

Acceptance: `pnpm exec vitest run tools/release-tools` green including your new
tests; full verify gate (Global Rule 3); PR describes the before/after CI
behavior.

### W1-B — Close the npm publish-set leak

Branch: `fix/publish-set-leak`. Small task.

`packages/assets` and `packages/workers` are workspace packages that are
neither `"private": true` nor in `.changeset/config.json`'s `ignore` list, and
carry none of the publish-readiness fields (license/files/publishConfig) the
other 17 packages got. If anyone runs `pnpm release` (changeset publish), these
two unprepared packages get published.

Fix: read both packages briefly to confirm they are internal-only (they are not
in ARCHITECTURE_REFACTOR_PLAN.md §2.3's published list). Then EITHER mark both
`"private": true` (preferred — matches `tools/release-tools`'s approach) OR add
both names to the changesets `ignore` array. Do both if you want belt and
suspenders. Do not add publish fields — they are not meant to publish.

Acceptance: `pnpm exec changeset status 2>&1` (or a dry inspection of the
config) shows neither package in the publishable set; full verify gate.

### W1-C — Enforce registry version immutability

Branch: `fix/registry-version-immutability`.

`packages/registry/src/mutations.ts` (~line 77, `applyRegisterFragment`):
`entry.versions = { ...entry.versions, [input.version]: entryVersion }`
silently OVERWRITES an existing `versions[x]` record when the same version is
re-registered with different values (different serviceUrl, etc.). The
architecture plan §5 claims append-only immutability was adopted; it was not —
there is no guard and no test (verified by grep).

Fix (TDD): re-registering an existing name+version with IDENTICAL values stays
idempotent (`action: "unchanged"` — this already works via deepEqual, keep it).
Re-registering an existing name+version with DIFFERENT values must be REFUSED:
return the standard failure envelope (`status:"failed"`, exit 1, no write) with
an error naming the conflict and telling the agent to bump the version instead.
Check how `applyPromoteFragment`/`applyRollbackFragment` write to `versions`
too — promote records the previous stable into `versions`; make sure your guard
doesn't break promote/rollback flows (their writes are legitimate history
appends; only conflicting REWRITES of an existing version key must be blocked).
Extend `packages/registry/src/mutations.test.ts` with: identical re-register →
unchanged; conflicting re-register → failed, file unwritten; promote/rollback
still green.

Acceptance: `pnpm exec vitest run packages/registry` green; full verify gate.

### W1-D — Refresh the stale AI-consumer docs

Branch: `docs/refresh-agent-surfaces`. This framework's consumers are AI
agents; these docs are its primary interface, and they are behind the code.

1. **`docs/OPERATIONS.md` is stale (pre-P2).** Its Mount section still says the
   runtime fetch "is still a hand-edit of the page's src/fragmentSlots.ts" —
   false since P2. Rewrite the Mount step to document the current flow: mount
   regenerates `apps/<page>/src/fragmentSlots.gen.ts`; `--check` mode verifies
   freshness (exit 1 when stale); `pnpm verify:manifest-gen` runs it for every
   page inside `pnpm verify`; flags now include `--props`, `--cache-policy`,
   `--data-dependencies`, `--static-html`, `--allow-unregistered`. Also add
   `--assets-url` to the Register step's flag list. Source of truth: read
   `scripts/mount-slot.mts` + `scripts/register-fragment.mts` usage strings and
   CLAUDE.md's lifecycle section (which IS current) — then verify each command
   you document by running its `--check`/usage path yourself.
2. **`packages/runtime/AGENT.md` is stale (pre-P4).** It documents only the
   barrier API. Add the streaming API from `packages/runtime/src/index.ts`:
   `streamFragmentSlots` (exact signature, ~line 348), `FragmentSlotStreamHandle`
   (~line 312), and the `@mvp/runtime/react` subpath's `<FragmentSlot>` +
   `<FragmentSlotStream>` components (`packages/runtime/src/react.tsx`) — with
   one copy-paste example each and an `Accept:` command, matching the file's
   existing section structure exactly. Copy real signatures from source; do not
   paraphrase.
3. **`packages/mcp/AGENT.md` does not exist** but is advertised in that
   package's `files` array (silently dropped from the tarball). Write it,
   following the structure of `packages/registry/AGENT.md`: what the package is
   (MCP stdio server exposing `query_registry` + the lifecycle tools), entry
   points (read `packages/mcp/src/tools.ts` for the real tool list and input
   schemas, including `mount_slot`'s `check` flag), error taxonomy, one
   end-to-end example (the JSON-RPC `initialize` → `tools/call query_registry`
   flow from `packages/mcp/README.md`), `Accept:` = `pnpm --filter @mvp/mcp test`.
4. **`tools/create-component/AGENT.md` does not exist.** Write it (published
   bin package): scaffold commands for ui vs fragment mode, the JSON result
   envelope, the layoutHint skeleton it now generates, collision behavior
   (`--force`). Source: `tools/create-component/src/index.ts`. Add `"AGENT.md"`
   to that package's `files` array (this one file edit is allowed even though
   package.json is outside the default docs set — it is required for the doc to
   ship).
5. **`llms.txt`**: append entries for the two new AGENT.md files, matching the
   existing one-line format.

Acceptance: every signature/flag you document verified against source (grep the
export before writing it); `pnpm check` green; full verify gate (docs-only
changes should make this trivial, but run it).

### W1-E — Schema-validate island snapshots (close the A2 silent fallback)

Branch: `fix/island-snapshot-validation`.

`packages/islands/src/index.ts` `readIslandSnapshot` (~lines 178–203) parses
the inline `data-island-props` JSON with `JSON.parse` + typeof checks, casts
`props` unvalidated, and — on malformed JSON or non-object — silently returns
`{ props: {} }`. Goal A2 ("never silent fallback") explicitly forbids this: a
corrupted snapshot currently hydrates the island with empty props instead of
degrading explicitly.

Fix (TDD): define an `IslandSnapshotSchema` Zod schema (put it in
`packages/contracts/src/index.ts` next to the other schemas, export it, and
have `@mvp/islands` consume it — check first whether `@mvp/islands` already
depends on `@mvp/contracts`; if adding that dependency is disproportionate,
defining the schema locally in the islands package with zod is acceptable,
state your choice in the PR). On parse/validation failure the behavior must
mirror the existing version-mismatch path: SKIP hydration entirely (leave SSR
HTML), emit the structured `console.warn`, and invoke the same
`configureIslandRuntime` mismatch/error callback (extend its payload with a
`reason: "invalid-snapshot" | "version-mismatch"` discriminator if needed —
additive, keep backward compat). A snapshot that is merely MISSING optional
fields (no version — old fragments) must still hydrate as today. Update
`packages/islands/src/index.test.ts`: malformed JSON → no hydration + callback
fired; valid snapshot → unchanged behavior; version-absent snapshot →
unchanged behavior.

Acceptance: `pnpm exec vitest run packages/islands` green; full verify gate.

### W1-F — e2e strict-content mode

Branch: `fix/e2e-strict-mode`.

`e2e/shell-home.spec.ts` accepts fallback strings as passing content
(`/Limited time offer|…|Featured offers are loading|Promotion unavailable/`), so
a fully-degraded page (every fragment down) passes e2e. Same pattern in the
other shell specs.

Fix: keep the existing lenient assertions as the default (they are deliberate —
fallback IS acceptable page behavior), and add a STRICT tier: when
`E2E_STRICT=1` is set, the same specs must assert live content only (fallback
strings become failures). Implement via a small helper (e.g.
`expectFragmentContent(locator, { live, fallback })` reading the env var) used
across `e2e/shell-home.spec.ts` and `e2e/shell-product.spec.ts` — do not fork
the spec files. Document the toggle in `e2e/README.md`. Note in the PR that
running e2e needs the full stack up (see that README) — if you cannot run the
suite in your environment, say so explicitly and rely on making the code change
minimal + reviewed; do NOT claim you ran what you didn't.

Acceptance: `pnpm check`/typecheck green; e2e run evidence OR an explicit
statement it wasn't runnable; full verify gate (e2e is not part of verify, so
this mainly proves no collateral damage).

---

## WAVE 2 — start only after ALL Wave 1 PRs are merged

### W2-A — Generalize `verify:runtime` (manifest-driven, no hand-kept URL map)

Branch: `fix/verify-runtime-generalization`.

Current state (verified): `scripts/verify-runtime.mts` defaults to
`http://localhost:4100/trade/BTC`, measures only `[data-area]` panes (only the
trade page emits them), and its interaction check is hardcoded to the
order-book→order-form flow. `scripts/deploy-affected.mts` maps pages to URLs
via a hand-maintained `PAGE_URL` record and SILENTLY SKIPS unmapped pages. The
architecture plan's P4 note claims this was generalized — it was not.

Fix: derive the page→URL map from the pages themselves instead of a hand-kept
record — each `apps/page-*/src/manifest.ts` has a `route`; ports live in each
package.json's dev script (`-p 410x`) or centralize a small exported map ONCE
next to the manifests (your call; no silent skips either way: an affected page
with no derivable URL must FAIL the deploy step with a clear error, not skip).
Make the layout-fit check meaningful beyond trade: instead of requiring
`[data-area]`, fall back to measuring each `[data-fragment]` section's
rendered box (the attribute every page emits) with the same void-threshold
logic in `tools/runtime-gate/src/checks.ts`; keep the `[data-area]` pane logic
when present. Keep the orderbook interaction check but make it conditional on
the target page actually containing an order-book (already half-true — make it
explicit, and report `skipped` rather than silently passing). Update
`tools/runtime-gate` unit tests for the new fallback measurement.

Acceptance: `pnpm exec vitest run tools/runtime-gate` green;
`pnpm verify:runtime --url http://localhost:4101/` (page-home standalone, if
you can bring it up) produces real measurements rather than "no panes" no-ops —
if you cannot run servers in your environment, prove the logic via unit tests
and say so; full verify gate.

### W2-B — Demo capability index (`demonstrates` field) + release-history walkthrough

Branch: `feat/demo-capability-index`.

The plan's §6 contract — each demo page declares `demonstrates: [...]` and an
index tells an AI reader which page proves which capability — was never
implemented (verified: the field exists nowhere).

Fix:
1. Add an optional `demonstrates: z.array(z.string())` to `PageManifestSchema`
   in `packages/contracts/src/index.ts` (additive).
2. Populate it in all 5 composed pages' `apps/*/src/manifest.ts` with honest
   values, e.g. page-home: `["composition:static+ttl-cache+dynamic-ssr",
   "streaming:suspense-per-slot", "fallback-isolation", "trace-panel"]`;
   page-trade: `["dag-scheduling", "cross-island-interaction:typed-bus",
   "island-version-handshake", "layout-hints", "runtime-island-assets:spike"]`;
   page-product: `["ttl-cache-freshness", "reserved-slots"]`; page-markets /
   page-portfolio accordingly. Verify each claim against the page's actual
   code before writing it — do not copy this list blindly.
3. Write `docs/DEMOS.md`: a table page → capabilities → key files, generated
   content verified by hand against the manifests; add it to `llms.txt`.
4. Confirm the field surfaces through the pages' `/manifest` route (check how
   `manifest.ts` is served; if slots/seo already flow through, demonstrates
   should come for free — verify, don't assume).

Acceptance: typecheck + `pnpm exec vitest run packages/contracts` green (add a
schema test); full verify gate.

### W2-C — docs-test: execute AGENT.md snippets in CI

Branch: `feat/docs-test`.

§7 promised every AGENT.md fenced snippet runs in CI; no such mechanism exists.
Depends on W1-D (docs must be fresh first).

Fix: write `scripts/docs-test.mts` (tsx): walk `packages/*/AGENT.md`, extract
fenced ` ```ts `/` ```typescript ` blocks, and typecheck-execute each one —
pragmatic approach: write each block to a temp file inside the owning package
(so its imports resolve via workspace aliases), run `tsx --eval` or a vitest
in-memory pass over it, and report per-file pass/fail with the standard
`{status, files, error}` JSON envelope the repo's other scripts use. Snippets
that are intentionally non-executable (pseudo-code, shell) must be skippable
via an explicit marker (` ```ts no-run ` fence info string) — add the marker to
any AGENT.md snippet that genuinely can't run, sparingly, and justify each in
the PR. Wire a `docs:test` root script and add it to `scripts/verify.mts`'s
gate list. Expect this task to FIND broken snippets — fixing a snippet to match
real exports is in scope; changing source code to match a wrong snippet is not.

Acceptance: `pnpm docs:test` exits 0 with a per-package report; full verify
gate now includes the new gate, still `REAL_EXIT=0`.

### W2-D — Retire the `isr` literal from live manifests

Branch: `fix/isr-literal-codemod`.

`"isr"` (deprecated alias of `ttl-cache`, name-collides with Next.js ISR) is
still the live value in 3 slot manifests: `apps/page-portfolio/src/manifest.slots.json`,
`apps/page-trade/src/manifest.slots.json` (chart slot), `apps/page-product/src/manifest.slots.json`.

Fix: change each to `"ttl-cache"` — but do it THROUGH the CLI, not by hand
(repo rule: registry/manifest edits go through scripts): re-run
`pnpm exec tsx scripts/mount-slot.mts --page <page> --slot <slot> --fragment
<fragment> --channel <ch> --strategy ttl-cache --timeout-ms 200 [existing
flags…]` with each slot's CURRENT other values (read them from the manifest
first — cache-policy/props/data-dependencies must be passed through unchanged
or they'll be dropped; verify with `git diff` that ONLY the strategy changed
and the `.gen.ts` regenerated consistently). Each page's `manifestSync` test
and `verify:manifest-gen` must stay green. Do NOT remove `"isr"` from
`RenderStrategySchema` (other tasks own contracts; the alias stays for
backward compat — note this remaining step in your PR as a future major-version
item).

Acceptance: grep shows no `"strategy": "isr"` left under `apps/`;
`pnpm verify:manifest-gen` green; full verify gate.

---

## WAVE 3 — optional, after Wave 2

### W3-A — Roll streaming out to the remaining 4 pages

Branch: `feat/streaming-rollout`. Pattern to copy: `apps/page-home/src/fragmentSlots.ts`
+ `apps/page-home/app/page.tsx` (streamFragmentSlots + per-slot
`<Suspense><FragmentSlotStream/></Suspense>` + aggregate-fed diagnostics
boundary). Apply to page-product, page-markets, page-portfolio, then
page-trade LAST and most carefully (its hydration/tradeStore wiring reads the
execution result — read `hydrate.tsx`/`tradeStore.ts` consumers before touching
the return shape; keep all existing fields additive-only). Preserve every
`data-*` attribute and fallback markup byte-for-byte; every existing test must
pass unchanged. If page-trade proves risky, ship the other three and report.

### W3-B — Materialize a promote/rollback walkthrough

Branch: `feat/release-walkthrough`. `registry/releases.json` is empty — the §6
"canary → promote → rollback walkthrough" was never materialized. Run the real
lifecycle: promote one low-risk fragment (e.g. `promotion-banner`, which has
both stable+canary), verify `releases.json` gained a record with `rollbackTo`,
then roll it back, verify the chained record. Commit the resulting registry
state + a short `docs/trade-demo/release-walkthrough.md` (or append to
OPERATIONS.md) narrating the real JSON envelopes you observed. All changes via
the CLI scripts only — never hand-edit the JSON.

---

## Deliberately NOT in this plan

- Removing the `isr` value from `RenderStrategySchema` (breaking; future major).
- Promoting the C3 import-map spike beyond order-form (needs the go/no-go
  decision documented in ARCHITECTURE_REFACTOR_PLAN.md §4.3.3).
- Moving design-system's buy/sell/up/down tokens and packages/data's trade
  mock transport out of framework packages (real B3 leaks, but they are inlined
  values with wide blast radius — needs a design decision on where they land;
  flagged, not scheduled).
- Actually publishing to npm (owner's manual action; everything stays dry-run).
