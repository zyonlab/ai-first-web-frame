# @mvp/registry — AGENT.md

## What this package is for

`@mvp/registry` is the core lifecycle-mutation library for the fragment
registry, page slot manifests, and docker-compose service definitions — the
engine the `scripts/register-fragment.mts` / `mount-slot.mts` /
`promote-fragment.mts` / `rollback-fragment.mts` CLIs wrap. It owns: the
registry data model (channels `stable`/`canary`/`preview` + an append-only
`versions` history, `@mvp/contracts`'s `FragmentRegistrySchema`), pure
mutation functions for register/promote/rollback that never write to disk
themselves, an atomic-write/advisory-lock/optimistic-concurrency file utility
every mutation goes through (refactor plan §4.2 — parallel agents are the
normal case, not the edge case), page-manifest slot mount/unmount +
manifest-vs-runtime drift detection, docker-compose service-block
read/append helpers, manifest→runtime codegen for `fragmentSlots.gen.ts`, and
small CLI-arg-parsing helpers shared by the lifecycle scripts. This package
moved into the workspace from the old `platform/fragment-registry` in the P1
re-layering phase; `registry.data.json`/`releases.json` stay outside package
source, at the repo-root `registry/` directory, and are loaded via an
explicit relative path (`registry.ts`'s `import registryData from
"../../../registry/registry.data.json"`) — they are deployment state, not
package source. Use this package from lifecycle scripts/tooling, not from
runtime request paths (`@mvp/runtime` reads the built `fragmentRegistry`
object directly, not this package's mutation API).

## Entry points

### Registry read model (`registry.ts`)

- `fragmentRegistry: FragmentRegistry` — the module-level registry built at
  import time from `registry/registry.data.json` (env-overridden per
  fragment, see below). `FragmentRegistry = { fragments: Record<string,
  FragmentChannels> }`, `FragmentChannels = Partial<Record<ReleaseChannel,
  FragmentVersion>> & { versions?: Record<string, FragmentVersion> }`,
  `FragmentVersion = { version: string, serviceUrl: string, manifestUrl:
  string }`.
- `buildFragmentRegistry(data?: unknown = registryData, env?: Record<string, string | undefined> = process.env): FragmentRegistry`
  — parses `data` through `FragmentRegistrySchema` and, for every fragment,
  applies an env override (`fragmentEnvVarName(name)`, e.g.
  `PRICE_PANEL_URL`) that rewrites `serviceUrl`/`manifestUrl` (to
  `${override}/manifest`) on every channel and pinned version. Call with
  explicit `data`/`env` in tests instead of relying on the module-level
  singleton.
- `fragmentEnvVarName(name: string): string` — `"price-panel"` →
  `"PRICE_PANEL_URL"` (non-alphanumeric runs become `_`, uppercased,
  `_URL`-suffixed).
- `resolveFragment(name: string, versionOrChannel?: ReleaseChannel | string = "stable", registry?: FragmentRegistry = fragmentRegistry): FragmentVersion | null`
  — resolves by channel name, by an exact pinned version key in
  `entry.versions`, or by scanning the three channels for a matching
  `.version`; `null` if the fragment or version isn't found.
- `validateFragmentRegistry(registry: FragmentRegistry): boolean` —
  non-throwing `FragmentRegistrySchema.safeParse(...).success` check.

### Mutations (`mutations.ts`) — pure, no I/O

- `applyRegisterFragment(data: FragmentRegistryData, input: RegisterFragmentInput): RegistryMutation`
  — `input: { name, version, serviceUrl, manifestUrl?, channel? = "canary" }`.
  Validates `name` is kebab-case, `version` is non-empty, `serviceUrl` is
  `http(s)://`, and `channel` is a valid `ReleaseChannel`; writes the channel
  entry AND appends/overwrites `versions[version]` (OpenComponents-style
  immutable version history — refactor plan §5). Returns
  `{ registry, changed, action: "added" | "updated" | "unchanged" }`
  (idempotent: rerunning with identical inputs reports `"unchanged"`).
- `applyPromoteFragment(data: FragmentRegistryData, name: string, now?: Date = new Date()): ReleaseMutation`
  — moves `entry.canary` to `entry.stable`, records the previous stable into
  `versions` history, deletes `entry.canary`, and returns a `ReleaseRecord`
  (`ReleaseManifestSchema` shape + `releasedAt`) carrying `rollbackTo` set to
  the previous stable version. No-op (`changed: false, release: null`) if
  canary's version already equals stable's.
- `applyRollbackFragment(data: FragmentRegistryData, releases: ReleaseRecord[], name: string, toVersion?: string, now?: Date = new Date()): ReleaseMutation`
  — rolls `entry.stable` back to `toVersion`, or (if omitted) the
  `rollbackTo` recorded on the most recent matching stable release in
  `releases`; the target version must already exist in `entry.versions`. Also
  a no-op if the target already equals current stable.
- `loadRegistryData(path: string): LoadedRegistry` / `saveRegistryData(path, data, expectedHash): void`
  and `loadReleases(path: string): LoadedReleases` / `saveReleases(path, file, expectedHash): void`
  — the file-level load/save pair for `registry.data.json` /
  `releases.json`; `LoadedRegistry = { data: FragmentRegistryData, hash: string }`
  (same for `LoadedReleases`/`ReleasesFile = { releases: ReleaseRecord[] }`).
  `loadRegistryData` throws if the file is missing; `loadReleases` returns
  `{ releases: [] }` instead. Always pass the `hash` captured at load time
  back into the matching save call so a concurrent writer surfaces as
  `FileConflictError` instead of silently overwriting.

### Atomic file I/O (`atomic-file.ts`)

- `writeFileAtomic(path: string, content: string, options?: AtomicWriteOptions): void`
  — `options: { expectedHash?, lockTimeoutMs? = 2000, staleLockMs? = 10000, retryDelayMs? = 25 }`.
  Acquires a `<path>.lock` advisory sentinel (stealing locks older than
  `staleLockMs`, retrying every `retryDelayMs` up to `lockTimeoutMs`), checks
  `expectedHash` against the current on-disk hash if given, writes to a
  same-directory temp file, and atomically renames it over `path`.
- `loadFileWithHash(path: string): LoadedFile` — `{ content: string | null,
  hash: string }`; `hash` is `MISSING_FILE_HASH` ("missing") when the file
  doesn't exist.
- `hashContent(content: string | null): string` — sha256 hex digest (or
  `MISSING_FILE_HASH`); the function `loadFileWithHash`/mutation savers use to
  compute/compare hashes.
- `isRetryableWriteError(error: unknown): error is FileConflictError | FileLockTimeoutError`
  — the predicate lifecycle scripts use to map a caught error onto
  `{ status: "conflict", retry: true }` instead of a hard failure.

### Slots (`slots.ts`)

- `validatePageSlots(slots: unknown): { valid: boolean, errors: string[] }` —
  validates an array against `PageManifestSchema`'s slot element schema
  (passthrough, so a `reserved: true` marker survives).
- `applyMountSlot(slots: unknown[], slot: PageSlot): SlotsMutation` —
  upserts a slot by `name` (parses/normalizes it first, dropping `undefined`
  fields), re-validates the whole resulting array, and throws a plain `Error`
  if that validation fails. Returns
  `{ slots, changed, action: "added" | "updated" | "unchanged" }`.
- `applyUnmountSlot(slots: unknown[], name: string): SlotsMutation` — removes
  the slot with matching `name`; `action` is `"removed"` or `"unchanged"`.
- `checkFragmentRegistered(registry: { fragments: Record<string, unknown> }, fragment: string, allowUnregistered: boolean): FragmentRegistrationCheck`
  — the A3 mount gate: `{ ok: false, error }` for an unregistered fragment
  unless `allowUnregistered` is `true`, in which case it returns
  `{ ok: true, warnings: [...] }` instead of silently proceeding.
- `diffManifestAgainstRuntime(manifestSlots: unknown, runtimeSlots: RuntimeSlotContract[]): string[]`
  — pure drift comparison between a page's declarative `manifest.slots.json`
  and its actual hand-wired/generated runtime slots array, applying the same
  defaults `@mvp/runtime` applies for omitted fields (`channel: "stable"`,
  `strategy: "dynamic-ssr"`, `required: false`, `timeoutMs: 200`). A
  `reserved: true` manifest slot that also appears in `runtimeSlots` is
  drift; a manifest slot missing from `runtimeSlots` (or vice versa) is
  drift; a field-value mismatch is drift. Returns human-readable messages,
  empty array when in sync.

### Codegen (`codegen.ts`)

- `generateFragmentSlotsSource(page: string, manifestSlots: unknown): string`
  — the pure manifest→TypeScript transform behind `fragmentSlots.gen.ts`:
  parses every slot through the manifest slot schema (throwing
  `InvalidManifestSlotsError` on an invalid manifest instead of generating
  bad code), excludes `reserved: true` slots, and emits a
  `FragmentSlotDefinition[]` literal (field order matching `@mvp/runtime`'s
  type) under a "GENERATED FILE — do not edit by hand" header. Output is
  unformatted; the caller (`scripts/mount-slot.mts`) runs it through biome
  before writing/diffing.
- `checkFragmentSlotsGenFileFreshness(expectedSource: string, actualSource: string | null): GenFileFreshness`
  — `{ status: "fresh" }` iff `actualSource === expectedSource`, else
  `{ status: "stale", expected, actual }` (a missing file, `actual === null`,
  is always stale). Backs `mount-slot --check`.
- **`InvalidManifestSlotsError`** (class, extends `Error`) — thrown by
  `generateFragmentSlotsSource` when `manifestSlots` isn't an array or a slot
  fails schema validation.

### Compose (`compose.ts`)

- `listComposeHostPorts(text: string): number[]` — scans a docker-compose
  YAML string for `- "PORT:PORT"` host-port mappings.
- `nextFragmentPort(text: string, start?: number = 4201): number` — first
  unused port at or above `start`, per `register-fragment --with-compose`'s
  port-allocation convention.
- `hasComposeService(text: string, name: string): boolean` — regex check for
  a top-level `  <name>:` service block.
- `renderComposeService(name: string, port: number): string` — renders a new
  service block (`build.context: ../..`, `dockerfile:
  fragments/<name>/Dockerfile`, port mapping, `PORT` env var).
- `addComposeService(text: string, { name, port }): ComposeMutation` —
  appends `renderComposeService(...)` unless the service already exists
  (`changed: false`); throws a plain `Error` if `port` is already used by
  another service.

### CLI arg helpers (`cli.ts`)

- `parseCliArgs(argv: string[]): CliArgs` — `{ flags: Record<string, string | boolean>, positional: string[] }`;
  `--flag value` / `--flag=value` / bare `--flag` (boolean `true`)
  conventions, `--` is skipped.
- `stringFlag(args: CliArgs, name: string): string | undefined` /
  `booleanFlag(args: CliArgs, name: string): boolean` — typed accessors over
  `args.flags`.

## Error taxonomy

- **`FileConflictError`** (`atomic-file.ts`, `retry: true`) — thrown by
  `writeFileAtomic` when `expectedHash` is given and the on-disk content hash
  has changed since load (a concurrent writer beat you to it); lifecycle
  scripts catch this via `isRetryableWriteError` and report
  `{ status: "conflict", retry: true }`.
- **`FileLockTimeoutError`** (`atomic-file.ts`, `retry: true`) — thrown by
  `writeFileAtomic` when the advisory `<path>.lock` sentinel could not be
  acquired within `lockTimeoutMs` (another writer holds it and hasn't gone
  stale); also retryable via `isRetryableWriteError`.
- **`InvalidManifestSlotsError`** (`codegen.ts`) — thrown by
  `generateFragmentSlotsSource` on a non-array or schema-invalid
  `manifestSlots` input.
- **Plain `Error`** — `applyRegisterFragment` (bad name/version/serviceUrl/
  channel), `applyPromoteFragment`/`applyRollbackFragment` (fragment not
  registered, no canary to promote, no stable to roll back, no rollback
  target recorded, target version not in `versions` history),
  `applyMountSlot` (post-mutation slot-array validation failure),
  `loadRegistryData` (file not found), and `addComposeService` (port
  collision) all throw an untyped `Error` with a human-readable message —
  these are caller/input bugs, not distinguished by a dedicated class. Script
  callers pattern-match on `isRetryableWriteError` first and treat everything
  else as a hard `{ status: "failed", error: message }`.

## Example

```ts
import {
  loadRegistryData,
  saveRegistryData,
  applyRegisterFragment,
  applyPromoteFragment,
  isRetryableWriteError,
  checkFragmentRegistered,
} from "@mvp/registry";

const registryPath = "registry/registry.data.json";
const loaded = loadRegistryData(registryPath);

const mutation = applyRegisterFragment(loaded.data, {
  name: "price-panel",
  version: "0.1.0",
  serviceUrl: "http://localhost:4203",
  channel: "canary",
});

if (mutation.changed) {
  try {
    saveRegistryData(registryPath, mutation.registry, loaded.hash);
  } catch (error) {
    if (isRetryableWriteError(error)) {
      console.error("conflict, retry:", error.message);
    } else {
      throw error;
    }
  }
}

// Mount-time gate (refactor plan A3): refuse to mount an unregistered fragment.
const check = checkFragmentRegistered(mutation.registry, "price-panel", false);
if (!check.ok) throw new Error(check.error);

// Promote canary -> stable once ready.
const promotion = applyPromoteFragment(mutation.registry, "price-panel");
console.log(promotion.release?.rollbackTo); // previous stable version, if any
```

## Accept

```
pnpm --filter @mvp/registry test
```
Expected: Vitest exits 0. Coverage spans
`packages/registry/src/{atomic-file,cli,codegen,compose,mutations,registry,slots}.test.ts`
— atomic write/lock/conflict behavior, register/promote/rollback mutation
idempotency and version-history immutability, drift detection defaults,
codegen output/freshness-check parity, compose port allocation, and env-var
override resolution.
