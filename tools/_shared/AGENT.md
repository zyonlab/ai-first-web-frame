# tools/_shared — AGENT.md

## What this package is for

`tools/_shared` is the shared source library behind every audit/scaffold tool
under `tools/*` (bundle/css budget checks, dependency audit, similarity check,
boundary check, create-component). It is **not a workspace package** — there is
no `package.json` and no `@mvp/*` name; each tool imports these modules
relatively (from a tool's `src/index.ts` the specifier is
`../../_shared/<module>`). Six modules, all side-effect-free on import:

- `args.ts` — the one CLI flag parser every tool shares.
- `report.ts` — pass/warn/fail status math, `reports/` writers, CI exit codes.
- `budgets.ts` — the per-unit `src/budget.ts` loader both budget gates use.
- `text.ts` — tokenizing + similarity math (Jaccard, Levenshtein, casing).
- `fs.ts` — workspace-root discovery, filtered file walking, JSON I/O.
- `code.ts` — regex-heuristic source analysis (imports, `"use client"`,
  browser globals) built on comment/string stripping.

## Entry points

- `parseArgs(argv: string[]): CliOptions` (`args.ts`) — parses the shared flag
  set `--ci`, `--warn-only`, `--force`, `--threshold <n>`, `--root <dir>`,
  `--scope <s>`, `--type <s>`, `--budget <path>`, `--stats <path>`,
  `--css <path>` (both `--flag value` and `--flag=value` forms); everything
  else lands in `positional`. No validation, no exit — bad numbers become
  `NaN` for the caller to handle.
- `statusFromCounts(failures: number, warnings = 0): CheckStatus` (`report.ts`)
  — `"fail"` if any failure, else `"warn"` if any warning, else `"pass"`.
- `exitCodeFor(status: CheckStatus, ci: boolean, warnOnly: boolean): number`
  (`report.ts`) — 1 only for `status === "fail" && ci && !warnOnly`; every
  other combination is 0 (audits only gate CI, and `--warn-only` demotes).
- `writeReports(root: string, baseName: string, json: unknown, markdown: string): void`
  (`report.ts`) — writes `<root>/reports/<baseName>.json` + `.md` (creates
  `reports/`, ensures a trailing newline on the markdown).
- `loadUnitBudgets(root: string): Promise<UnitBudget[]>` (`budgets.ts`) —
  dynamically imports every `fragments/<unit>/src/budget.ts` and
  `apps/<unit>/src/budget.ts`, picks the first exported const with a `name`
  and a valid `scope` (`"component" | "fragment" | "page" | "shell"`), and
  returns `{ scope, name, dir, jsBytes?, cssBytes? }` rows. This made the
  per-unit budget files the real budget side of both budget gates
  (historically they had zero consumers).
- `tokenize` / `uniqueTokens` / `jaccard(left, right): number` /
  `normalizedNameSimilarity(left, right): number` / `pascalCase` / `kebabCase`
  (`text.ts`) — pure string/set math; `jaccard` of two empty sets is 1;
  `normalizedNameSimilarity` is 1 − Levenshtein/maxLen on lowercased input.
- `findWorkspaceRoot(start = process.cwd()): string` (`fs.ts`) — walks up to
  the nearest `pnpm-workspace.yaml` (falls back to `start`).
- `walkFiles(root: string, predicate: (path: string) => boolean): string[]`
  (`fs.ts`) — recursive, sorted; skips `node_modules`, `.git`, `dist`,
  `dist-browser`, `.next`, `coverage`. Plus `readJson`/`writeJson`/`writeText`/
  `ensureDir`/`toPosix`/`relativePosix`/`fileExists`.
- `stripCommentsAndStrings(source: string): string` (`code.ts`) — blanks
  comment bodies and string-literal contents (newlines and delimiters kept,
  `${...}` interpolations kept — they are code) so word-boundary heuristics
  match only real code. Import specifiers get blanked too, so never feed the
  result to `parseImports`. Regex literals are not modeled: `//` inside one
  blanks the rest of that line (conservative miss, never a false flag).
- `browserGlobals(source: string): string[]` (`code.ts`) — which of `window`,
  `document`, `localStorage` appear as words in the **stripped** source.
- `parseImports(source: string): string[]` (`code.ts`) — sorted unique
  specifiers from `import`/`export ... from`/dynamic `import()` (regex-based,
  runs on the raw source).
- `hasUseClient(source: string): boolean` (`code.ts`) — true only when
  `"use client"` is the first statement of the file.
- `jsxShape(source)` / `classNames(source)` (`code.ts`) — JSX tag names and
  `className` string tokens, for the similarity fingerprint.

## Error taxonomy

No custom error types. `parseArgs`/`statusFromCounts`/`exitCodeFor` and all of
`text.ts`/`code.ts` never throw. `fs.ts` helpers propagate raw Node `fs`
errors (`ENOENT` on a missing `readJson` path); `loadUnitBudgets` propagates
any error thrown while importing a `budget.ts` module (a broken budget file
fails the calling audit loudly instead of being skipped).

## Example

The imports below are written for where `docs:test` executes this snippet
(`tools/_shared/.docs-test-tmp/`, one level under this directory). From a
tool's own `src/`, the same modules are `../../_shared/<module>`.

```ts
import { parseArgs } from "../args";
import { exitCodeFor, statusFromCounts } from "../report";
import { browserGlobals, hasUseClient, stripCommentsAndStrings } from "../code";
import { jaccard, kebabCase, normalizedNameSimilarity } from "../text";

// The shared CLI contract every tools/* entry point parses.
const options = parseArgs(["--ci", "--threshold", "0.9", "--root=/tmp/x", "Extra"]);
if (!options.ci || options.threshold !== 0.9) throw new Error("flag parsing");
if (options.root !== "/tmp/x") throw new Error("--root=value form");
if (options.positional[0] !== "Extra") throw new Error("positional passthrough");

// Status + exit-code semantics shared by every audit: failures beat warnings,
// and only --ci without --warn-only turns a fail into exit 1.
if (statusFromCounts(0, 0) !== "pass") throw new Error("pass");
if (statusFromCounts(0, 2) !== "warn") throw new Error("warn");
if (statusFromCounts(1, 2) !== "fail") throw new Error("fail beats warn");
if (exitCodeFor("fail", true, false) !== 1) throw new Error("ci gate");
if (exitCodeFor("fail", true, true) !== 0) throw new Error("--warn-only demotes");
if (exitCodeFor("fail", false, false) !== 0) throw new Error("non-ci never exits 1");

// Comment/string stripping: the word "window" in a comment or a log string is
// NOT a browser-global usage; a real `window.location` is.
const commentOnly = `// close the window when done\nconst label = "window seat";`;
if (browserGlobals(commentOnly).length !== 0) throw new Error("false positive");
if (browserGlobals("const href = window.location.href;").join() !== "window")
  throw new Error("real usage must flag");
if (!stripCommentsAndStrings("const a = `x${document.title}y`;").includes("document"))
  throw new Error("template interpolations stay code");

// "use client" must be the FIRST statement to count.
if (!hasUseClient(`"use client";\nexport const a = 1;`)) throw new Error("directive");
if (hasUseClient(`import x from "y";\n"use client";`)) throw new Error("late directive");

// Similarity math used by component-similarity-check.
if (jaccard(["a", "b"], ["b", "c"]) !== 1 / 3) throw new Error("jaccard");
if (normalizedNameSimilarity("OrderBook", "orderbook") !== 1) throw new Error("case-insensitive");
if (kebabCase("PricePanel") !== "price-panel") throw new Error("kebab");
```

## Accept

```
pnpm exec vitest run tools/create-component
```
Expected: Vitest exits 0. `tools/_shared` has no test files of its own; its
behavior is covered through its consumers — `tools/create-component/src/index.test.ts`
exercises `parseArgs`/casing/fs helpers, and every `pnpm audit:*` tool test
(`tools/*/src/index.test.ts`, run by `pnpm test`) exercises `report.ts`,
`budgets.ts`, `text.ts`, and `code.ts` end to end.
