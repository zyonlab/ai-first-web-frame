# OPERATIONS.md — Fragment lifecycle for AI consumers

Machine-actionable reference for the seven-step fragment lifecycle. Every
lifecycle script prints exactly one JSON object to stdout and sets
`process.exitCode` — parse stdout, do not scrape human text. All commands run
from the repo root with `pnpm` (never `npm`/`npx`/`yarn`).

Conventions used below:
- `?` on a flag/field = optional.
- JSON field types are TypeScript, taken directly from each script's result
  type in `scripts/*.mts`.
- "Exit" = `process.exitCode`, not necessarily an uncaught throw.

---

## 1. Scaffold

Creates a new fragment (or UI component) skeleton on disk. Does not touch the
registry or any manifest.

**Command**
```
pnpm --filter @mvp/create-component start -- <PascalCaseName> --type fragment
```
- `<PascalCaseName>` (positional, required) — must match `/^[A-Z][A-Za-z0-9]*$/`.
- `--type fragment|ui` (optional, default `ui`) — `fragment` creates
  `fragments/<kebab-name>/` (9 files: `src/server.ts`, `src/render.tsx`,
  `src/manifest.ts`, `src/budget.ts`, `src/fixtures.ts`,
  `src/render.test.tsx`, `package.json`, `Dockerfile`, `README.md`); `ui`
  creates `packages/ui/src/<Name>/` (8 files).
- `--force` (optional flag) — overwrite if any target file already exists
  (default: fail on collision).

**Result envelope** (`CreateComponentResult`, from
`tools/create-component/src/index.ts`)
```ts
{
  status: "created" | "failed";
  type: "ui" | "fragment";
  name: string;
  files: string[];       // workspace-relative paths written; [] on failure
  error?: string;         // present only when status === "failed"
}
```
Exit 0 on `"created"`, 1 on `"failed"`.

**Accept**: `"status": "created"` and `files.length === 9` (fragment) /
`=== 8` (ui).

**Failure recovery**: `"failed"` with a collision error means a file already
exists — pick a different name, pass `--force` only if you intend to
overwrite, or delete the stale directory first. A name-format error means the
positional arg was not PascalCase; no files are written in either case.

---

## 2. Implement + test (TDD)

Not a scripted step — hand-edit `fragments/<kebab-name>/src/render.tsx`,
extending `src/render.test.tsx` first (the scaffolded test already asserts
`render<Name>().html` contains the fragment's kebab name).

**Command**
```
pnpm --filter @mvp/fragment-<kebab-name> test
```
No JSON envelope — this is a plain Vitest run. Non-zero exit = failing
assertions; fix `render.tsx` (or the test, if the test itself was wrong)
until it is 0. There is no `--json` reporter wired for fragment tests; treat
exit code as the only machine signal.

**Failure recovery**: read the Vitest failure output for the assertion
message; do not proceed to step 3 until this exits 0.

---

## 3. Register

Writes (or updates) one fragment's entry in the fragment registry, and
optionally adds a docker-compose service for it.

**Command**
```
pnpm exec tsx scripts/register-fragment.mts \
  --name <kebab-name> --version <semver> --service-url <url> \
  [--manifest-url <url>] [--channel stable|canary|preview] \
  [--port <n>] [--with-compose]
```
- `--name`, `--version`, `--service-url` — required.
- `--manifest-url` — optional; registry entry stores it verbatim if given.
- `--channel` — optional, default `canary`.
- `--port` — optional; only meaningful with `--with-compose`. Without it, the
  port is taken from `--service-url`'s URL, or the compose file is scanned
  and the next free fragment port (from 4201) is allocated.
- `--with-compose` — optional flag; also patches
  `infra/docker/docker-compose.yml` with a new service block.

**Result envelope** (`RegisterResult`, from `scripts/register-fragment.mts`)
```ts
{
  status: "registered" | "failed";
  name: string;
  version?: string;
  channel?: string;
  action?: "added" | "updated" | "unchanged";  // registry mutation kind
  compose?: { service: string; port: number; action: "added" | "unchanged" };
  files: string[];       // registry.data.json (+ docker-compose.yml if --with-compose); [] on failure
  error?: string;
}
```
Exit 0 on `"registered"`, 1 on `"failed"`.

**Accept**: `"status": "registered"`. Idempotency check: rerun the exact same
command — `"status": "registered"` again but `"action": "unchanged"` and
`files: []` (nothing rewritten).

**Failure recovery**: missing required flags → `"failed"` with a usage
`error` string, no files touched. `--with-compose` with a taken `--port` →
`"failed"`; omit `--port` to let the script scan for a free one, or pick an
explicitly free port. Wrong registry state after a bad manual edit → fix by
re-running `register-fragment` with correct values (writer overwrites the
named fragment's entry) or `rollback-fragment` (step 7).

---

## 4. Mount

Adds (or removes) a slot entry in a page's `apps/<page>/src/manifest.slots.json`.
Does not touch the registry — only warns if the fragment is unregistered.
Does not wire the runtime fetch call; that is still a hand-edit of the page's
`src/fragmentSlots.ts` and tests after this step.

**Command**
```
pnpm exec tsx scripts/mount-slot.mts \
  --page <page-home|page-product> --slot <name> --fragment <fragment> \
  [--strategy static|ssg|isr|cached-ssr|dynamic-ssr] \
  [--channel stable|canary|preview] [--timeout-ms <n>] \
  [--props <json>] [--required]
```
Unmount form:
```
pnpm exec tsx scripts/mount-slot.mts --page <page> --slot <name> --remove
```
- `--page`, `--slot` — required in both forms.
- `--fragment` — required unless `--remove`.
- `--channel` — optional, default `stable` when mounting.
- `--strategy`, `--timeout-ms`, `--props` (JSON string, parsed), `--required`
  (boolean flag) — all optional.

**Result envelope** (`MountResult`, from `scripts/mount-slot.mts`)
```ts
{
  status: "mounted" | "removed" | "unchanged" | "failed";
  page: string;
  slot: string;
  action?: "added" | "updated" | "unchanged" | "removed";
  files: string[];       // apps/<page>/src/manifest.slots.json; [] if unchanged/failed
  warnings: string[];    // e.g. fragment not yet registered
  error?: string;
}
```
Exit 0 on anything except `"failed"` (1).

**Accept**: `"status": "mounted"` and `warnings: []`. A nonempty `warnings`
array is not a failure but must be resolved before the fragment is expected
to actually render (usually: run step 3 first).

**Failure recovery**: `"status": "failed"` with `error` naming the missing
slots file (page has no `manifest.slots.json`) or a malformed `--props` JSON
string — no files changed. Wrong slot mounted: rerun with `--remove` instead
of `--fragment ...` to undo, then remount correctly. After a successful
mount, still hand-wire the slot into `apps/<page>/src/fragmentSlots.ts`'s
fetch list and the page's tests — `mount-slot` only owns the manifest JSON.

---

## 5. Verify

Runs the full repo gate: typecheck, lint, format check, all tests, build, and
six audits (similarity, bundle, css, deps, optimizer, boundary). Writes a
machine-readable report; this is the step CI and `pnpm verify` both run.

**Command**
```
pnpm verify
```

**Report** (not stdout JSON — written to `reports/verify-report.json`)
```ts
{
  generatedAt: string;   // ISO timestamp
  results: Array<{
    command: string;             // e.g. "pnpm typecheck"
    status: "passed" | "failed";
    signal: string | null;
    durationMs: number;
    stdout: string;               // last 6000 chars
    stderr: string;               // last 6000 chars
  }>;
}
```
stdout during the run prints one `PASS <command>` / `FAIL <command>` line per
step. Exit 0 only if every step's `status === "passed"`.

**Accept**: process exit 0; `reports/verify-report.json`'s `results` array
has no entry with `"status": "failed"`.

**Failure recovery**: read the failing entry's `stdout`/`stderr` tail in the
report (or the console `FAIL <command>` line) to find which of the 11 steps
broke. Budget failures (`audit:bundle`/`audit:css`) require shrinking JS/CSS
or splitting the unit — see each unit's `budget.ts`. Similarity failures
(`audit:similarity`) mean reuse the flagged existing component instead of
adding a near-duplicate. Never ship with any step red.

---

## 6. Promote

Promotes a fragment's `canary` entry to `stable`, recording the prior stable
version in the registry's `versions` history and appending an entry to
`registry/releases.json`.

**Command**
```
pnpm exec tsx scripts/promote-fragment.mts --name <kebab-name>
```
(`--name` also accepts the bare positional form:
`promote-fragment.mts <kebab-name>`.)

**Result envelope** (`PromoteResult`, from `scripts/promote-fragment.mts`)
```ts
{
  status: "promoted" | "unchanged" | "failed";
  name: string;
  from?: string;          // previous stable version (rollback target)
  to?: string;             // newly promoted version
  files: string[];         // registry.data.json + releases.json; [] otherwise
  error?: string;
}
```
Exit 0 on `"promoted"` and `"unchanged"`; exit 1 only on `"failed"`.

**Accept**: `"status": "promoted"` with `from`/`to` matching the expected
previous/new stable versions.

**Failure recovery**: `"unchanged"` means there was no `canary` entry to
promote (nothing to do — not an error, but check `--name` spelling and that
step 3 registered a `canary` first). `"failed"` with `error` means the
fragment name itself is missing or malformed — no files written either way.

---

## 7. Rollback

Rolls a fragment's `stable` channel back to the version recorded at the last
promote (or an explicit `--to` version), appending a rollback entry to
`releases.json`.

**Command**
```
pnpm exec tsx scripts/rollback-fragment.mts --name <kebab-name> [--to <version>]
```

**Result envelope** (`RollbackResult`, from `scripts/rollback-fragment.mts`)
```ts
{
  status: "rolled-back" | "unchanged" | "failed";
  name: string;
  from?: string;           // stable version before rollback
  to?: string;              // version rolled back to
  files: string[];          // registry.data.json + releases.json; [] otherwise
  error?: string;
}
```
Exit 0 on `"rolled-back"` and `"unchanged"`; exit 1 only on `"failed"`.

**Accept**: `"status": "rolled-back"` with `to` equal to the expected target
version.

**Failure recovery**: `"unchanged"` means there is no recorded rollback
target for this fragment (no prior promote, or `--to` doesn't resolve to a
known release) — this is the "fails cleanly when no rollback target is
recorded" case; register/promote first, or pass an explicit `--to <version>`
that exists in `releases.json`. `"failed"` means the fragment name is
missing/malformed.

---

## Cross-cutting notes

- **Idempotency**: `register-fragment` and `mount-slot` are safe to rerun
  with identical arguments — both report `action: "unchanged"` (register) or
  `status: "unchanged"` (mount) instead of rewriting files.
- **No partial writes on failure**: every script above returns
  `"status": "failed"` (or, for mount/promote/rollback, `"unchanged"`)
  without writing any file when validation fails — safe to retry after fixing
  the input.
- **Registry/manifest are hand-edit-forbidden**: `registry/registry.data.json`,
  `registry/releases.json`, and `apps/<page>/src/manifest.slots.json`
  must only be mutated through the scripts above, never edited directly —
  they are Zod-validated on load (`FragmentRegistrySchema`) and manual edits
  risk producing a state these scripts then reject.
- **Env override convention**: `<FRAGMENT_NAME>_URL` (e.g. `PRICE_PANEL_URL`)
  rewrites a registered fragment's `serviceUrl`/`manifestUrl` at runtime
  without touching the registry file — use for local/staging overrides.
