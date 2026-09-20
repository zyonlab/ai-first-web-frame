# @mvp/create-component — AGENT.md

## What this package is for

`@mvp/create-component` is the scaffolder that creates a new fragment or UI
component skeleton on disk — step 1 of the fragment lifecycle
(`docs/OPERATIONS.md`). It only writes files; it never touches the fragment
registry, a page's `manifest.slots.json`, or docker-compose (those are steps
3/4, `scripts/register-fragment.mts` / `scripts/mount-slot.mts`). Published
as a bin package (`create-component`) so it can be installed and run outside
this monorepo checkout, though in-repo it is always invoked through
`pnpm --filter @mvp/create-component start --`.

## Entry points

- `runCreateComponent(options?: CliOptions): CreateComponentResult` — the
  library entry point (`tools/create-component/src/index.ts`); `options`
  defaults to `parseArgs(process.argv.slice(2))` (`tools/_shared/args.ts`) so
  calling it with no arguments runs the CLI. Pass `options` explicitly (as the
  package's own tests do) to scaffold programmatically against a temp `root`
  without touching `process.argv`.

**Command (CLI)**
```
pnpm --filter @mvp/create-component start -- <PascalCaseName> --type fragment|ui [--force]
```
- `<PascalCaseName>` — positional, required; must match `/^[A-Z][A-Za-z0-9]*$/`
  or the call fails with `error: "Component name must be PascalCase"` before
  any file is touched.
- `--type fragment|ui` — optional; any value other than the literal string
  `"fragment"` is treated as `"ui"` (the default).
- `--force` — optional flag; overwrite target files that already exist
  (default: fail on the first collision, writing nothing).

**Result envelope** (`CreateComponentResult`, from
`tools/create-component/src/index.ts`)
```ts no-run
{
  status: "created" | "failed";
  type: "ui" | "fragment";
  name: string;
  files: string[];       // workspace-relative-from-root paths written; [] on failure
  error?: string;         // present only when status === "failed"
}
```
Exit 0 on `"created"`, 1 on `"failed"` (set on `process.exitCode` when run as
a CLI; the library call just returns the object without exiting).

### `--type fragment` — `fragments/<kebab-name>/` (11 files)

`<kebab-name>` is `<PascalCaseName>` converted to kebab-case
(`toKebab`: inserts `-` between a lowercase/digit and an uppercase letter,
then lowercases).

**The generated fragment runs as scaffolded** — it answers `/render`, builds to
`dist/server.js`, and boots. That was not true before: `server.ts` used to be a
two-line re-export with no Fastify and no routes, and the `Dockerfile` had no
`COPY`/install/build, so step 1's acceptance (`"status": "created"`) passed for a
service that could neither serve nor be imaged. Templates live in
`src/fragmentTemplate.ts` (pure string builders, one per file).

The default port is **allocated, not hard-coded**: `nextFragmentPort(root)` scans
every existing `fragments/*/src/server.ts` for its `DEFAULT_PORT` and returns the
first free value from 4201 — the same base `register-fragment --with-compose`
allocates from, so the scaffold and its compose service agree.

Files, in write order:

1. `src/server.ts` — the service: `buildServer(options)` delegating to
   `createFragmentServer()` from `@mvp/fragment-host` (which owns `GET /`,
   `/health`, `/ready`, `/metrics`, `/manifest`, `/assets`, `/budget` and
   `POST /render`), plus the `isProcessEntry` / `startFragmentServer` entry block.
2. `src/render.ts` — `render<Name>(request, { trace })` returning
   `{ statusCode, body }` where `body` is a `FragmentRenderResponse`, with a
   `metadata.fallback`-stamped degraded path for missing props.
3. `src/manifest.ts` — the fragment manifest, including the **layoutHint
   skeleton**: `layoutHint: { shape: "panel", minHeight: 120, fills: false }`
   with a comment telling the author/agent to "Adjust shape/minHeight/fills
   to this fragment's real rendered geometry" (`shape` is one of `"bar" |
   "ladder" | "table" | "chart" | "panel"`, see `LayoutHint` in
   `tools/release-tools/src/unit-graph.ts`). This is the machine-readable
   layout contract `scripts/mount-slot.mts` reads (via
   `tools/release-tools/src/layout-advisories.ts`) to warn when a fragment is
   mounted with no layoutHint at all — the scaffolder always seeds a
   (placeholder) one so that warning never fires for a freshly-scaffolded
   fragment, only for hand-written manifests that strip it back out.
4. `src/budget.ts` — `loadDefaultBudget("fragment", "<kebab-name>")`.
5. `src/fixtures.ts` — `basic` and `degraded` request fixtures with a REAL
   `ctx` (`locale`/`tenant`). The old `{ ctx: {} }` placeholder could not pass
   the strict `FragmentRenderRequestSchema` pass the host runs.
6. `src/render.test.ts` — asserts the 200 path renders the fragment root and the
   degraded path stamps `metadata.fallback`; extend this first (TDD,
   `docs/OPERATIONS.md` step 2).
7. `tests/server.test.ts` — asserts `/health` reports the manifest `version` and
   `POST /render` returns the rendered fragment.
8. `package.json` — `@mvp/fragment-<kebab-name>`, `"private": true`,
   `dev`/`start`/`build`/`test`/`typecheck` scripts, depends on
   `@mvp/contracts`, `@mvp/fragment-host`, `@mvp/observability`,
   `@mvp/request-context` and `fastify`.
9. `tsconfig.json` — extends the repo base; this is what makes the new unit
   visible to `pnpm typecheck` (`scripts/tsgo-typecheck.mts` discovers projects
   by that file, so a fragment without one is silently unchecked).
10. `Dockerfile` — `node:22-alpine`, `COPY . .` + `pnpm install --frozen-lockfile`
    + `pnpm --filter @mvp/fragment-<kebab-name>... build`, `EXPOSE <port>`, and a
    `start` CMD — the same shape as the 14 live fragments.
11. `README.md` — how to test/build/run the unit alone and how to register,
    mount and promote it.

### `--type ui` — `packages/ui/src/<Name>/` (8 files)

1. `<Name>.tsx` — `{Name}({ label }: {Name}Props)` returning `<span>{label}</span>`.
2. `metadata.ts` — `<name>Metadata = metadata("<Name>", "<Name> UI component")`.
3. `budget.ts` — `<name>Budget = componentBudget("<Name>")`.
4. `fixtures.ts` — a `basic` fixture (`{ label: "<Name>" }`).
5. `<Name>.test.tsx` — renders with `label="<Name>"` and asserts the text is
   present (React Testing Library).
6. `<Name>.module.css` — a `.root { display: inline-flex; }` stub.
7. `README.md` — one-line stub.
8. `index.ts` — re-exports the component, its `Props` type, metadata, budget,
   and fixtures.

## Collision behavior

Before writing anything, both modes compute the full file list and check
`existsSync` on each. If any target file already exists **and** `--force` was
not passed, the call fails immediately with `files: []` and
`error: "<absolute-path> already exists"` — nothing is written, not even the
other, non-colliding files. Pass `--force` only when you intend to overwrite
every listed file for that name (it does not selectively skip the files that
already exist; every file in the type's list is rewritten). To scaffold a
different fragment/component under the same name after an aborted attempt,
either delete the partial directory or rerun with `--force`.

## Example

```ts no-run
import { runCreateComponent } from "@mvp/create-component";
// (in-repo: import { runCreateComponent } from "../../tools/create-component/src/index";)

const result = runCreateComponent({
  root: "/path/to/repo",
  positional: ["PricePanel"],
  type: "fragment",
  ci: false,
  warnOnly: false,
  force: false,
});

if (result.status === "created") {
  console.log(result.files); // 11 paths under fragments/price-panel/
} else {
  console.error(result.error); // e.g. a PascalCase violation or a file collision
}
```

### Executable example (pure templates, no file I/O)

The call above is `no-run` because it writes a directory. The templates it
writes are pure functions, so what the generated unit actually contains is
verifiable directly — this block is executed by `pnpm docs:test`:

```ts
import {
  fragmentDockerfile,
  fragmentFixtures,
  fragmentPackageJson,
  fragmentRender,
  fragmentServer,
} from "@mvp/create-component/fragmentTemplate";

const input = {
  name: "PricePanel",
  kebab: "price-panel",
  camel: "pricePanel",
  port: 4203,
};

// The server is a real service built on the shared fragment host.
const server = fragmentServer(input);
if (!server.includes('from "@mvp/fragment-host"')) {
  throw new Error("scaffolded server must use the shared host");
}
if (!server.includes("createFragmentServer(")) {
  throw new Error("scaffolded server must create a server");
}
if (!server.includes("const DEFAULT_PORT = 4203;")) {
  throw new Error("scaffolded server must pin the allocated port");
}

// Render returns the { statusCode, body } shape the host calls, with a
// metadata-stamped degraded path.
const render = fragmentRender(input);
if (!render.includes("statusCode: number; body: FragmentRenderResponse")) {
  throw new Error("render must return the host's contract shape");
}
if (!render.includes("fallback: true")) {
  throw new Error("render must stamp metadata.fallback on the degraded path");
}

// The Dockerfile can actually build an image.
const dockerfile = fragmentDockerfile(input);
for (const line of [
  "COPY . .",
  "pnpm install --frozen-lockfile",
  "pnpm --filter @mvp/fragment-price-panel... build",
  "EXPOSE 4203",
]) {
  if (!dockerfile.includes(line)) throw new Error(`Dockerfile missing: ${line}`);
}

// Dependencies match what the generated code imports.
const pkg = JSON.parse(fragmentPackageJson(input)) as {
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};
if (pkg.dependencies["@mvp/fragment-host"] !== "workspace:*") {
  throw new Error("package.json must depend on the fragment host");
}
if (pkg.scripts.start !== "node dist/server.js") {
  throw new Error("package.json must expose a start script");
}

// Fixtures pass the strict render-request envelope (a bare `{}` ctx does not).
const fixtures = fragmentFixtures(input);
if (!fixtures.includes('locale: "en-US"') || !fixtures.includes('tenant: "default"')) {
  throw new Error("fixtures must carry a real request context");
}
```

CLI form, matching `docs/OPERATIONS.md` step 1:
```
pnpm --filter @mvp/create-component start -- PricePanel --type fragment
```
Accept: JSON output has `"status": "created"` and `files.length === 11`
(`=== 8` for `--type ui`).

## Accept

```
pnpm --filter @mvp/create-component test
```
Expected: Vitest exits 0. `tools/create-component/src/index.test.ts` covers
UI + fragment skeleton generation (including the layoutHint skeleton
assertion above), collision rejection without `--force`, and the PascalCase
name-format error.
