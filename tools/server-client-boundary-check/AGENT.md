# @mvp/server-client-boundary-check — AGENT.md

## What this package is for

`@mvp/server-client-boundary-check` is the `pnpm audit:boundary` gate (one of
`pnpm verify`'s six audits): it polices the server/client component boundary
across `packages/ui`, `apps/`, and `fragments/` source files (tests and
generated output — `.next/`, `dist/`, `dist-browser/`,
`public/spike-vendor/` — excluded). A file is "client" iff `"use client"` is
its **first statement** (`hasUseClient` from `tools/_shared/code.ts`);
everything else is treated as server code. Like `dependency-audit`, the
checks are regex heuristics, and the browser-global check runs on
comment/string-stripped source so prose never false-flags.

Issue codes (severity):

- `server-browser-global` (fail) — a server file using `window` / `document`
  / `localStorage` as words in real code.
- `server-imports-client-module` (fail) — a server file importing a
  client-only npm package (`framer-motion`, `@react-three/fiber`, `gsap` —
  fixed list, not configurable here) or a local module whose resolved file
  starts with `"use client"`. Exception: a Next page app (`apps/page-*`)
  server component importing a **local** island — that is the App Router
  boundary the bundler owns; fastify fragments/shell still fail.
- `large-client-component` (warn) — a client file over 200 lines or 10,000
  bytes (split the island).
- `page-use-client` (warn) — a top-level `"use client"` on a `page.*` /
  `layout.*` file (keep pages/layouts server-side; push interactivity into
  islands).

Overlap note: `dependency-audit` also checks browser globals (for
`packages/**` broadly, with a browser-capable allowlist) and client-only
imports; this audit is the boundary-focused pass over the UI/product
surfaces and adds the size and page/layout rules.

## Entry points

- `runBoundaryCheck(options?: CliOptions): BoundaryReport` — the CLI/library
  entry (`options` defaults to `parseArgs(process.argv.slice(2))` from
  `tools/_shared/args.ts`); writes
  `reports/server-client-boundary-report.json` + `.md` and returns the
  report. Status: any fail issue → `"fail"`, else any warn → `"warn"`, else
  `"pass"`.
- `BoundaryReport` — `{ tool: "server-client-boundary-check", status,
  checkedFiles: string[], issues }`; issues sorted by `severity:code:file`,
  each `{ code, severity: "warn" | "fail", file, detail }`.

**Command (CLI)**
```
pnpm audit:boundary             # = pnpm --filter @mvp/server-client-boundary-check start -- --ci
```
Flags: `--ci` (exit 1 on fail), `--warn-only` (never exit 1), `--root <dir>`.

## Error taxonomy

- No custom error types: every violation is an in-band `issues` entry.
- Raw `fs` errors (unreadable source file) propagate and fail the run loudly.
- Exit code (CLI): 1 only for `status === "fail"` with `--ci` and without
  `--warn-only`; the two warn-tier codes alone yield `"warn"` (exit 0 even
  in CI).

## Example

`runBoundaryCheck` scans a repo root and writes `reports/` files, so the
executable example exercises the classification core it is built on
(`tools/_shared/code.ts`, imported relatively exactly as `src/index.ts`
does) plus the report's status math.

```ts
import type { BoundaryReport } from "@mvp/server-client-boundary-check";
import { browserGlobals, hasUseClient } from "../../_shared/code";
import { statusFromCounts } from "../../_shared/report";

// The boundary test: "use client" must be the file's first statement.
const island = `"use client";\nexport function Ticker() { return window.location.pathname; }`;
const server = `import { renderToString } from "react-dom/server";\n// window sizing notes\nexport const html = renderToString(null);`;
const leaky = `export function width() { return document.body.clientWidth; }`;

if (!hasUseClient(island)) throw new Error("island is a client file");
if (hasUseClient(server)) throw new Error("no directive -> server file");

// server-browser-global fires only for real code in server files.
if (browserGlobals(server).length !== 0)
  throw new Error("'window' in a comment must not flag");
if (browserGlobals(leaky).join() !== "document")
  throw new Error("real document usage in a server file must flag");
// Client files may use browser globals freely — the audit never inspects them
// for globals; it only size-checks them (large-client-component, warn).

const issues: BoundaryReport["issues"] = [
  {
    code: "server-browser-global",
    severity: "fail",
    file: "fragments/order-book/src/render.tsx",
    detail: "server file uses document",
  },
  {
    code: "page-use-client",
    severity: "warn",
    file: "apps/page-home/app/page.tsx",
    detail: "page/layout should avoid top-level use client",
  },
];
const status = statusFromCounts(
  issues.filter((i) => i.severity === "fail").length,
  issues.filter((i) => i.severity === "warn").length,
);
if (status !== "fail") throw new Error("fail-tier issue gates the audit");
if (statusFromCounts(0, 1) !== "warn")
  throw new Error("warn-only issues never gate CI");
```

## Accept

```
pnpm audit:boundary
```
Expected: exit 0 with status `"pass"` or `"warn"`; writes
`reports/server-client-boundary-report.json` and
`reports/server-client-boundary-report.md`. Unit tests:
`pnpm --filter @mvp/server-client-boundary-check test` (`src/index.test.ts`
covers browser-global detection in server files, client-only import leakage
incl. the local-island exception, the size warning, and the page/layout
directive warning).
