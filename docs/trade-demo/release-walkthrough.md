# Release walkthrough — canary → promote → rollback

This is the materialized "one fragment pair" demo called for in
[`ARCHITECTURE_REFACTOR_PLAN.md` §6](../ARCHITECTURE_REFACTOR_PLAN.md) (the
`canary → promote → rollback walkthrough with releases.json history` row) and
tracked as `W3-B` in [`REMEDIATION_PLAN.md`](../REMEDIATION_PLAN.md). Before
this walkthrough, `registry/releases.json` was `{ "releases": [] }` — the
walkthrough had never actually been run. Everything below is the literal
output of running the real CLI scripts once, in order, against this repo's
`registry/registry.data.json` and `registry/releases.json`. Nothing here is
invented or hand-edited; see "How to reproduce" at the end to re-run it
yourself.

## Fragment chosen: `promotion-banner`

`promotion-banner` was picked because, uniquely among the fragments already in
`registry/registry.data.json`, it had both a `stable` **and** a `canary`
channel populated before this walkthrough started:

```json
"promotion-banner": {
  "stable": {
    "version": "0.1.0",
    "serviceUrl": "http://localhost:4201",
    "manifestUrl": "http://localhost:4201/manifest"
  },
  "canary": {
    "version": "0.2.0-beta.1",
    "serviceUrl": "http://localhost:4201",
    "manifestUrl": "http://localhost:4201/manifest"
  }
}
```

That is exactly the precondition `promote-fragment.mts` needs: a `canary`
entry to promote and an existing `stable` entry to record as the rollback
target.

## Step 1 — Promote canary to stable

Command (see [`OPERATIONS.md` §6](../OPERATIONS.md)):

```
pnpm exec tsx scripts/promote-fragment.mts --name promotion-banner
```

Real output:

```json
{
  "status": "promoted",
  "name": "promotion-banner",
  "from": "0.1.0",
  "to": "0.2.0-beta.1",
  "files": [
    "registry/registry.data.json",
    "registry/releases.json"
  ]
}
```

`from` is the prior stable version (`0.1.0`), `to` is the version that was
in `canary` and just became the new `stable` (`0.2.0-beta.1`). Exit code was
`0`.

### Resulting `registry/registry.data.json` (promotion-banner entry)

The `canary` field is gone (promote consumes it), `stable` now points at
`0.2.0-beta.1`, and both versions are preserved in the immutable `versions`
history map:

```json
"promotion-banner": {
  "stable": {
    "version": "0.2.0-beta.1",
    "serviceUrl": "http://localhost:4201",
    "manifestUrl": "http://localhost:4201/manifest"
  },
  "versions": {
    "0.1.0": {
      "version": "0.1.0",
      "serviceUrl": "http://localhost:4201",
      "manifestUrl": "http://localhost:4201/manifest"
    },
    "0.2.0-beta.1": {
      "version": "0.2.0-beta.1",
      "serviceUrl": "http://localhost:4201",
      "manifestUrl": "http://localhost:4201/manifest"
    }
  }
}
```

### Resulting `registry/releases.json` (first record)

```json
{
  "releases": [
    {
      "unit": "fragment",
      "name": "promotion-banner",
      "version": "0.2.0-beta.1",
      "channel": "stable",
      "rollbackTo": "0.1.0",
      "smokeTests": [],
      "releasedAt": "2026-07-11T01:51:49.265Z"
    }
  ]
}
```

The record carries `rollbackTo: "0.1.0"` — this is the value
`rollback-fragment.mts` reads by default when no explicit `--to` is given, so
the rollback in step 2 does not require re-specifying the version by hand.

## Step 2 — Roll stable back

Command, deliberately **without** `--to` so it exercises the "uses the
recorded `rollbackTo`" path (see [`OPERATIONS.md` §7](../OPERATIONS.md)):

```
pnpm exec tsx scripts/rollback-fragment.mts --name promotion-banner
```

Real output:

```json
{
  "status": "rolled-back",
  "name": "promotion-banner",
  "from": "0.2.0-beta.1",
  "to": "0.1.0",
  "files": [
    "registry/registry.data.json",
    "registry/releases.json"
  ]
}
```

`from` is the stable version immediately before the rollback
(`0.2.0-beta.1`, i.e. the version step 1 just promoted), `to` is `0.1.0` —
resolved purely from the `rollbackTo` recorded on the most recent release
entry for `promotion-banner`, not passed on the command line. Exit code was
`0`.

### Resulting `registry/registry.data.json` (promotion-banner entry)

`stable` is back to `0.1.0`; the `versions` history still retains both
entries (immutable, append-only — nothing is deleted by a rollback):

```json
"promotion-banner": {
  "stable": {
    "version": "0.1.0",
    "serviceUrl": "http://localhost:4201",
    "manifestUrl": "http://localhost:4201/manifest"
  },
  "versions": {
    "0.1.0": { "version": "0.1.0", "serviceUrl": "http://localhost:4201", "manifestUrl": "http://localhost:4201/manifest" },
    "0.2.0-beta.1": { "version": "0.2.0-beta.1", "serviceUrl": "http://localhost:4201", "manifestUrl": "http://localhost:4201/manifest" }
  }
}
```

### Resulting `registry/releases.json` (chained record)

```json
{
  "releases": [
    {
      "unit": "fragment",
      "name": "promotion-banner",
      "version": "0.2.0-beta.1",
      "channel": "stable",
      "rollbackTo": "0.1.0",
      "smokeTests": [],
      "releasedAt": "2026-07-11T01:51:49.265Z"
    },
    {
      "unit": "fragment",
      "name": "promotion-banner",
      "version": "0.1.0",
      "channel": "stable",
      "smokeTests": [],
      "releasedAt": "2026-07-11T01:51:53.687Z"
    }
  ]
}
```

`releases.json` is append-only: the promote record from step 1 is still
present, and the rollback appends a second record chained to it (same
`name`/`unit`, `version` matching the promote record's `rollbackTo`). This is
the full history an AI agent (or human) needs to reconstruct "what changed,
when, and how to undo it" for this fragment without consulting anything but
the JSON file.

## Step 3 — Restore the canary channel

`applyPromoteFragment` deletes the `canary` entry once it is promoted (by
design — a promoted canary has become the new stable, so the channel is
empty until the next candidate is cut). After step 2, `promotion-banner` had
`stable: 0.1.0` and **no** `canary` entry. `packages/registry/src/registry.test.ts`
asserts `promotion-banner` always exposes a live `canary` channel at
`0.2.0-beta.1` — that assertion reads `registry/registry.data.json` directly
as fixture data, so `pnpm test` caught the gap immediately
(`resolves canary channel` and `applies env overrides to service and manifest
URLs` both failed with the canary channel now `undefined`).

This is the normal next step of the real lifecycle, not a special-case
patch: cut a new canary via `register-fragment.mts` (step 3 of the lifecycle
in [`OPERATIONS.md`](../OPERATIONS.md)), same version, through the CLI only:

```
pnpm exec tsx scripts/register-fragment.mts --name promotion-banner --version 0.2.0-beta.1 --service-url http://localhost:4201 --channel canary
```

Real output:

```json
{
  "status": "registered",
  "name": "promotion-banner",
  "version": "0.2.0-beta.1",
  "channel": "canary",
  "action": "updated",
  "files": [
    "registry/registry.data.json"
  ]
}
```

`action: "updated"` (not `"added"`) because `0.2.0-beta.1` already existed in
`promotion-banner`'s `versions` history with identical values from step 1 —
the W1-C immutability guard in `applyRegisterFragment` compares the
incoming entry against the existing `versions[0.2.0-beta.1]` record via
`deepEqual` and accepts it because nothing about that version's data
changed; only the `canary` channel pointer itself was set. Had any field
(`serviceUrl`, `manifestUrl`, `assetsUrl`) differed from the recorded
version, this call would have failed instead of silently overwriting
history. This step only touches `registry/registry.data.json` —
`register-fragment.mts` does not append to `releases.json`.

`promotion-banner` is now byte-for-byte back to its pre-walkthrough
`stable`/`canary` shape, with the addition of a genuine `versions` history
entry for `0.2.0-beta.1` (already implied by the promote step) and the two
`releases.json` records from steps 1–2 as permanent history.

## What this proves

- `promote-fragment.mts` and `rollback-fragment.mts` both work end to end
  against real registry state, not just in unit tests.
- `releases.json` accumulates a genuine, ordered history — the promote
  record's `rollbackTo` is exactly what the subsequent rollback consumed by
  default, with no `--to` argument and no hand-editing.
- The registry's `versions` map is append-only across a promote+rollback
  cycle (`W1-C`'s immutability guarantee): both `0.1.0` and `0.2.0-beta.1`
  remain recorded after the fragment's `stable` pointer moved twice, and
  re-registering the same version with identical values in step 3 is
  accepted (`"updated"`, channel pointer only) rather than silently
  rewriting version history.
- After the full three-step walkthrough, `promotion-banner`'s `stable` and
  `canary` channels match their pre-walkthrough values exactly — the
  observable, permanent artifact of the exercise is `releases.json`'s two
  new records (promote + rollback), which is the point: the registry state
  a consumer resolves against is unchanged, but the release history an
  agent or operator would consult to answer "what happened to this
  fragment and how would I undo it" now has real content instead of being
  empty.

## How to reproduce

Both scripts require `packages/contracts`' build output to exist first
(`pnpm exec tsx` resolves `@mvp/contracts` via its published `dist/`, not
`src/`, from `packages/registry/src/mutations.ts`):

```
pnpm --filter @mvp/contracts build
pnpm exec tsx scripts/promote-fragment.mts --name promotion-banner
pnpm exec tsx scripts/rollback-fragment.mts --name promotion-banner
```

Re-running the exact sequence above from a state where `promotion-banner` is
`stable: 0.1.0` with no `canary` will make the promote step report
`"status": "unchanged"` (there is no `canary` entry to promote) — that is
expected; register a new `canary` version first (see
[`OPERATIONS.md` §3](../OPERATIONS.md)) to run the walkthrough again.
