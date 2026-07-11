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

### `--type fragment` — `fragments/<kebab-name>/` (9 files)

`<kebab-name>` is `<PascalCaseName>` converted to kebab-case
(`toKebab`: inserts `-` between a lowercase/digit and an uppercase letter,
then lowercases). Files, in write order:

1. `src/server.ts` — re-exports `render<Name>` from `./render`.
2. `src/render.tsx` — `render<Name>()` returning
   `{ html, assets: { js: [], css: [] }, cache: { ttl, tags }, metadata: { name, version } }`
   with `html` containing a `data-fragment="<kebab-name>"` section — the
   render contract every fragment must satisfy.
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
5. `src/fixtures.ts` — a `basic` fixture (`{ ctx: {}, props: {} }`).
6. `src/render.test.tsx` — asserts `render<Name>().html` contains the kebab
   name; extend this first (TDD, `docs/OPERATIONS.md` step 2) before editing
   `render.tsx`.
7. `package.json` — `@mvp/fragment-<kebab-name>`, `"private": true`,
   `test`/`build`/`start` scripts, depends on `@mvp/contracts` + `fastify`.
8. `Dockerfile` — `node:22-alpine`, runs `dist/server.js`.
9. `README.md` — one-line stub.

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
  console.log(result.files); // 9 workspace-relative paths under fragments/price-panel/
} else {
  console.error(result.error); // e.g. a PascalCase violation or a file collision
}
```

CLI form, matching `docs/OPERATIONS.md` step 1:
```
pnpm --filter @mvp/create-component start -- PricePanel --type fragment
```
Accept: JSON output has `"status": "created"` and `files.length === 9`
(`=== 8` for `--type ui`).

## Accept

```
pnpm --filter @mvp/create-component test
```
Expected: Vitest exits 0. `tools/create-component/src/index.test.ts` covers
UI + fragment skeleton generation (including the layoutHint skeleton
assertion above), collision rejection without `--force`, and the PascalCase
name-format error.
