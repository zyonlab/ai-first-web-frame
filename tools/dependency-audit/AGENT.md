# @mvp/dependency-audit — AGENT.md

## What this package is for

`@mvp/dependency-audit` is the `pnpm audit:deps` gate (one of `pnpm verify`'s
six audits): the repo's import-hygiene and layering police. It audits
package.json dependency versions across the workspace and every source file
under `apps/`, `fragments/`, and `packages/` (tests excluded) for the
architecture rules that keep units independently deployable. All source
checks are **regex heuristics, not an AST** — but since PR #30 the
word-boundary checks (`browserGlobals`, raw `fetch(`) run on
`stripCommentsAndStrings`'d source (`tools/_shared/code.ts`), so the word
"window" in a doc comment or `fetch(` in a log string never false-flags.

Issue codes (severity):

- `duplicated-package-version` (fail) — one dependency at two versions across
  workspace package.json files (deps + devDeps + peerDeps).
- `forbidden-package` (fail) / `large-package` (warn) — from config (below).
- `page-importing-another-page` + `cross-page-import` (both fail, emitted
  together) — `apps/page-x` importing `apps/page-y` / `@mvp/page-y`.
- `fragment-importing-page-code` (fail) — a fragment importing `apps/page-*`
  or `@mvp/page-*`.
- `raw-fetch-in-business-code` (fail) — `fetch(` in real code under
  `apps/page-*/(app|src)/` or `fragments/*/src/` (the `CLAUDE.md` hard rule:
  use `@mvp/request` / `@mvp/data`).
- `server-safe-browser-global` (fail) — `window`/`document`/`localStorage`
  as words in real code of a non-`"use client"` file under `packages/`,
  except allowlisted browser-capable prefixes (default
  `packages/storage/`, `packages/islands/` — wrapping browser APIs is their
  job).
- `client-only-dependency-in-server` (fail) — a file without leading
  `"use client"` importing a client-only package (default `framer-motion`,
  `@react-three/fiber`, `gsap`) or a local `"use client"` module. Exception:
  a Next page app (`apps/page-*`) server component importing a **local**
  island — that is the App Router boundary; fragments/shell (fastify) and
  `packages/` still fail.
- `domain-code-in-framework-package` (fail) — layering (refactor plan §2.1,
  goal B3): `packages/**` importing `domains/`, `apps/`, or `fragments/`
  code, by relative target or by package name. The `KNOWN_LEAKS` allowlist
  is deliberately empty since P1/P2 — new leaks must fail, not get added.
- `island-bus-without-escape-hatch` (fail) — a `fragments/*/src/island.tsx`
  calling `createInteractionBus(` without a `bus?:` prop or `props.bus`
  escape hatch, which would orphan it from cross-island publishes (plan
  §4.3.2; see the `injectedBus ?? createInteractionBus(...)` pattern).

Config: optional root `dependency-audit.json`
(`{ forbiddenPackages, clientOnlyPackages, browserCapablePackages, largePackages }`);
absent keys fall back to the defaults above.

## Entry points

- `runDependencyAudit(options?: CliOptions): DependencyReport` — the
  CLI/library entry (`options` defaults to `parseArgs(process.argv.slice(2))`
  from `tools/_shared/args.ts`); writes `reports/dependency-report.json` +
  `.md` and returns the report. Status: any fail-severity issue → `"fail"`,
  else any warn → `"warn"`, else `"pass"`.
- `DependencyReport` — `{ tool: "dependency-audit", status, issues }` with
  issues sorted by `code:file:packageName`; each issue is
  `{ code, severity: "warn" | "fail", file?, packageName?, detail }`.

**Command (CLI)**
```
pnpm audit:deps                 # = pnpm --filter @mvp/dependency-audit start -- --ci
```
Flags: `--ci` (exit 1 on fail), `--warn-only` (never exit 1), `--root <dir>`.

## Error taxonomy

- No custom error types: every rule violation is an in-band `issues` entry,
  never a throw. A missing `dependency-audit.json` means defaults.
- Raw `fs`/JSON errors (unreadable source, malformed package.json) propagate
  and fail the run loudly.
- Exit code (CLI): 1 only for `status === "fail"` with `--ci` and without
  `--warn-only`. `large-package` alone yields `"warn"` (exit 0 even in CI).

## Example

`runDependencyAudit` scans a repo root and writes `reports/` files, so the
executable example exercises the heuristic core it is built on —
`tools/_shared/code.ts`, imported relatively exactly as `src/index.ts` does —
including the PR #30 comment/string stripping that keeps the regexes honest.

```ts
import type { DependencyReport } from "@mvp/dependency-audit";
import {
  browserGlobals,
  hasUseClient,
  parseImports,
  stripCommentsAndStrings,
} from "../../_shared/code";

// The raw-fetch heuristic exactly as the audit applies it.
const hasRawFetch = (source: string) =>
  /\bfetch\s*\(/.test(stripCommentsAndStrings(source));

const innocent = [
  `// NOTE: never call fetch("/api/x") here — use @mvp/request instead`,
  `const hint = "prefetch( is not a real call either";`,
  `import { createRequestClient } from "@mvp/request";`,
  `export const client = createRequestClient({ baseUrl: "/api" });`,
].join("\n");
if (hasRawFetch(innocent))
  throw new Error("fetch( in comments/strings must not flag (PR #30 rule)");
if (!hasRawFetch(`const res = await fetch("/api/markets");`))
  throw new Error("a real raw fetch call must flag");

// server-safe-browser-global: words in real code only.
if (browserGlobals(`// resize the window on drop`).length !== 0)
  throw new Error("'window' in a comment is not a browser-global usage");
if (browserGlobals(`export const width = window.innerWidth;`).join() !== "window")
  throw new Error("real window usage must be reported");

// The "use client" boundary the client-only-dependency rule keys on:
// the directive only counts as the FIRST statement.
if (!hasUseClient(`"use client";\nimport { motion } from "framer-motion";`))
  throw new Error("client file");
if (hasUseClient(`import { motion } from "framer-motion";\n"use client";`))
  throw new Error("a late directive is still a server file");

// Import extraction feeding the page/fragment layering rules (runs on RAW
// source — specifiers are string literals, so never on stripped source).
const imports = parseImports(
  `import { z } from "zod";\nexport { renderX } from "./render";\nconst m = await import("@mvp/page-home");`,
);
if (imports.join() !== "./render,@mvp/page-home,zod")
  throw new Error(`sorted unique specifiers, got: ${imports.join()}`);

// The report shape consumers read from reports/dependency-report.json.
const issue: DependencyReport["issues"][number] = {
  code: "raw-fetch-in-business-code",
  severity: "fail",
  file: "fragments/order-book/src/data.ts",
  detail: "business code must use @mvp/request or @mvp/data instead of raw fetch",
};
if (issue.severity !== "fail") throw new Error("raw fetch is fail-tier");
```

## Accept

```
pnpm audit:deps
```
Expected: exit 0 with status `"pass"` or `"warn"` (warn = large-package
advisories only); writes `reports/dependency-report.json` and
`reports/dependency-report.md`. Unit tests:
`pnpm --filter @mvp/dependency-audit test` (`src/index.test.ts` covers every
issue code, the comment/string-stripping non-flag + still-flags cases, the
local-island exception, the empty `KNOWN_LEAKS` regression guard, and the
island bus escape-hatch rule).
