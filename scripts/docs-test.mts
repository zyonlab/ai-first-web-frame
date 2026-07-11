/**
 * docs:test — execute every AGENT.md fenced TypeScript snippet (refactor
 * plan §7). Walks every `AGENT.md` under apps/domains/fragments/packages/tools,
 * extracts fenced ```ts/```typescript/```tsx blocks, and runs them for real
 * through Vitest (not just typecheck) so a copy-pasted example that no longer
 * matches the real exports fails the same way a broken test would.
 *
 * Resolution strategy: packages are not built during a standalone
 * `pnpm docs:test` run (no `dist/`), so `@mvp/*` bare specifiers can't resolve
 * through each package's own `package.json#exports` (those point at `dist/`).
 * Instead this script derives a Vite `resolve.alias` map straight from every
 * workspace package's `package.json#exports` keys, pointed at the matching
 * `src/` file — the same trick `vitest.config.ts` uses for its own alias
 * list, just computed generically so every documented subpath (not only the
 * ones existing tests happen to import) resolves.
 *
 * Continuation blocks: a handful of AGENT.md files (e.g. packages/runtime)
 * deliberately build one running example across multiple fenced blocks
 * ("same inputs as above") rather than repeating declarations. Per-file
 * concatenation (in document order) honors that without inventing code that
 * isn't in the docs. Each package's blocks are concatenated into ONE Vitest
 * file, so the pass/fail granularity this script reports is per-AGENT.md
 * (== per-package), matching how the docs are meant to be read.
 *
 * Snippets that are genuinely non-executable (pseudo-code/type shapes,
 * snippets with real network/filesystem side effects unsafe to run in CI, or
 * snippets that no longer match real exports) are opted out via a
 * ```ts no-run fence-info marker — see the PR description for the exact list
 * and justification for each; this script never rewrites snippet content.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["apps", "domains", "fragments", "packages", "tools"];
const EXECUTABLE_LANGS = new Set(["ts", "typescript", "tsx"]);

type FencedBlock = {
  lang: string;
  noRun: boolean;
  source: string;
};

type PackageResult = {
  agentMd: string;
  package: string | null;
  status: "pass" | "fail" | "skipped";
  executableBlocks: number;
  noRunBlocks: number;
  error?: string;
};

// ---------------------------------------------------------------------------
// 1. Discover AGENT.md files
// ---------------------------------------------------------------------------

function discoverAgentMdFiles(): string[] {
  const files: string[] = [];
  for (const groupRoot of ROOTS) {
    const groupDir = join(root, groupRoot);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const agentMd = join(groupDir, name, "AGENT.md");
      if (existsSync(agentMd)) files.push(agentMd);
    }
  }
  return files.sort();
}

// ---------------------------------------------------------------------------
// 2. Extract fenced ```ts/```typescript/```tsx blocks
// ---------------------------------------------------------------------------

function extractFencedBlocks(markdown: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const fenceRe = /^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;
  let match: RegExpExecArray | null = fenceRe.exec(markdown);
  while (match !== null) {
    const info = match[1].trim();
    const tokens = info.split(/\s+/).filter(Boolean);
    const lang = (tokens[0] ?? "").toLowerCase();
    const noRun = tokens.slice(1).includes("no-run");
    blocks.push({ lang, noRun, source: match[2] });
    match = fenceRe.exec(markdown);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// 3. Build a `@mvp/*` -> src file alias map from every workspace package's
//    package.json#exports, so bare-specifier imports in doc snippets resolve
//    without requiring a prior `pnpm build`.
// ---------------------------------------------------------------------------

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function buildAliasMap(): Record<string, string> {
  const aliases: Record<string, string> = {};

  for (const groupRoot of ROOTS) {
    const groupDir = join(root, groupRoot);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const pkgDir = join(groupDir, name);
      const pkgJsonPath = join(pkgDir, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      let pkgJson: { name?: string; exports?: unknown };
      try {
        pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      } catch {
        continue;
      }
      const pkgName = pkgJson.name;
      if (!pkgName?.startsWith("@mvp/")) continue;

      // Root entry point: "@mvp/<name>" -> src/index.ts(x)
      const rootSrc = firstExisting([
        join(pkgDir, "src/index.ts"),
        join(pkgDir, "src/index.tsx"),
      ]);
      if (rootSrc) aliases[pkgName] = rootSrc;

      // Subpath entry points, derived from package.json#exports keys.
      const exportsField = pkgJson.exports;
      if (exportsField && typeof exportsField === "object") {
        for (const key of Object.keys(
          exportsField as Record<string, unknown>,
        )) {
          if (key === ".") continue;
          if (!key.startsWith("./")) continue;
          const subpath = key.slice(2); // drop "./"
          const candidateSrc = firstExisting([
            join(pkgDir, `src/${subpath}.ts`),
            join(pkgDir, `src/${subpath}.tsx`),
            join(pkgDir, `src/${subpath}/index.ts`),
            join(pkgDir, `src/${subpath}/index.tsx`),
          ]);
          if (candidateSrc) aliases[`${pkgName}/${subpath}`] = candidateSrc;
        }
      }
    }
  }

  // Vite's object-form `resolve.alias` prefix-matches string keys (an id
  // matching `"<key>/..."` gets rewritten too, not just an exact `id ===
  // key`), so a shorter key like "@mvp/ui" must not be checked before a
  // longer, more specific one like "@mvp/ui/AppNav" — otherwise the shorter
  // alias wins and the resolved path gets a bogus "/AppNav" suffix appended.
  // Re-insert keys longest-first so specific subpaths always win.
  const ordered: Record<string, string> = {};
  for (const key of Object.keys(aliases).sort((a, b) => b.length - a.length)) {
    ordered[key] = aliases[key];
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// 4. Generate one concatenated Vitest file per AGENT.md (package), run them
//    all in a single Vitest invocation, then clean up.
// ---------------------------------------------------------------------------

function packageDisplayName(agentMdPath: string): string | null {
  const pkgJsonPath = join(dirname(agentMdPath), "package.json");
  if (!existsSync(pkgJsonPath)) return null;
  try {
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    return pkgJson.name ?? null;
  } catch {
    return null;
  }
}

// Defensive sweep: an earlier crashed/interrupted run (or a debug run with
// DOCS_TEST_KEEP_TMP set) can leave a stale `.docs-test-tmp` dir behind. The
// vitest `include` glob below matches any such directory regardless of which
// package generated it in *this* run, so a stale leftover would silently get
// re-executed and misattributed. Clear all of them before generating fresh
// ones.
function sweepStaleTempDirs() {
  for (const groupRoot of ROOTS) {
    const groupDir = join(root, groupRoot);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const stale = join(groupDir, name, ".docs-test-tmp");
      if (existsSync(stale)) rmSync(stale, { recursive: true, force: true });
    }
  }
  // Same self-healing for the scratch config dir (see below) in case a prior
  // run was killed (SIGKILL) before its `finally` block could run.
  rmSync(join(root, "reports/.docs-test-scratch"), {
    recursive: true,
    force: true,
  });
}
sweepStaleTempDirs();

const agentMdFiles = discoverAgentMdFiles();
const perFile = agentMdFiles.map((agentMdPath) => {
  const markdown = readFileSync(agentMdPath, "utf8");
  const blocks = extractFencedBlocks(markdown);
  const executable = blocks.filter(
    (block) => EXECUTABLE_LANGS.has(block.lang) && !block.noRun,
  );
  const noRun = blocks.filter(
    (block) => EXECUTABLE_LANGS.has(block.lang) && block.noRun,
  );
  return { agentMdPath, executable, noRunCount: noRun.length };
});

const runnable = perFile.filter((entry) => entry.executable.length > 0);

// Per-package temp dirs (so Node's module resolution walking up from the
// generated test file finds that package's own node_modules symlinks for
// bare deps like "react"/"zod" the snippet imports transitively).
const tempDirs: string[] = [];
const testFiles: string[] = [];

for (const entry of runnable) {
  const pkgDir = dirname(entry.agentMdPath);
  const tempDir = join(pkgDir, ".docs-test-tmp");
  mkdirSync(tempDir, { recursive: true });
  tempDirs.push(tempDir);

  const body = entry.executable
    .map((block) => block.source.trimEnd())
    .join("\n\n");
  const label = relative(root, entry.agentMdPath);
  const fileContent = `${body}\n\ntest(${JSON.stringify(`AGENT.md examples execute: ${label}`)}, () => {});\n`;

  const testFile = join(tempDir, "agent-md.test.tsx");
  writeFileSync(testFile, fileContent);
  testFiles.push(testFile);
}

const report: {
  tool: string;
  generatedAt: string;
  status: "pass" | "fail";
  packages: PackageResult[];
} = {
  tool: "docs-test",
  generatedAt: new Date().toISOString(),
  status: "pass",
  packages: [],
};

function cleanup() {
  if (process.env.DOCS_TEST_KEEP_TMP) return;
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (testFiles.length === 0) {
  for (const entry of perFile) {
    report.packages.push({
      agentMd: relative(root, entry.agentMdPath),
      package: packageDisplayName(entry.agentMdPath),
      status: "skipped",
      executableBlocks: 0,
      noRunBlocks: entry.noRunCount,
    });
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 0;
} else {
  const aliases = buildAliasMap();

  let scratchDir = "";
  try {
    // Scratch config/output dir lives inside the repo (under `reports/`,
    // where other lifecycle scripts already write generated artifacts)
    // rather than the OS temp dir, so Node's module resolution walking up
    // from the config file can find this repo's own node_modules/vitest — an
    // OS-tmp config file can't see it at all. Always removed in `finally`
    // below (and self-healed by `sweepStaleTempDirs` on the next run if a
    // hard kill ever skips that).
    const scratchParent = join(root, "reports", ".docs-test-scratch");
    mkdirSync(scratchParent, { recursive: true });
    scratchDir = mkdtempSync(join(scratchParent, "run-"));
    const configPath = join(scratchDir, "vitest.docs-test.config.mts");
    const outputPath = join(scratchDir, "results.json");

    const configSource = `
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: ${JSON.stringify(aliases, null, 2)},
  },
  esbuild: {
    jsx: "automatic",
  },
  test: {
    root: ${JSON.stringify(root)},
    globals: true,
    environment: "happy-dom",
    include: ["**/.docs-test-tmp/**/*.test.tsx"],
    pool: "forks",
  },
});
`;
    writeFileSync(configPath, configSource);

    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "--config",
        configPath,
        "--reporter",
        "json",
        "--outputFile",
        outputPath,
      ],
      { cwd: root, encoding: "utf8" },
    );

    if (process.env.DOCS_TEST_DEBUG) {
      console.error("=== vitest stdout ===\n", result.stdout);
      console.error("=== vitest stderr ===\n", result.stderr);
    }

    let vitestJson: {
      testResults?: Array<{
        name: string;
        status: string;
        message?: string;
        assertionResults?: Array<{
          status: string;
          failureMessages?: string[];
        }>;
      }>;
    } = {};
    if (existsSync(outputPath)) {
      try {
        vitestJson = JSON.parse(readFileSync(outputPath, "utf8"));
      } catch {
        vitestJson = {};
      }
    }

    const byTestFile = new Map(
      (vitestJson.testResults ?? []).map((entry) => [entry.name, entry]),
    );

    for (const entry of perFile) {
      const isRunnable = entry.executable.length > 0;
      if (!isRunnable) {
        report.packages.push({
          agentMd: relative(root, entry.agentMdPath),
          package: packageDisplayName(entry.agentMdPath),
          status: "skipped",
          executableBlocks: 0,
          noRunBlocks: entry.noRunCount,
        });
        continue;
      }

      const pkgDir = dirname(entry.agentMdPath);
      const testFile = join(pkgDir, ".docs-test-tmp", "agent-md.test.tsx");
      const vitestResult = byTestFile.get(testFile);

      const passed =
        vitestResult?.status === "passed" ||
        (result.status === 0 && vitestResult === undefined);

      const failureMessages = (vitestResult?.assertionResults ?? [])
        .flatMap((assertion) => assertion.failureMessages ?? [])
        .join("\n");

      report.packages.push({
        agentMd: relative(root, entry.agentMdPath),
        package: packageDisplayName(entry.agentMdPath),
        status: passed ? "pass" : "fail",
        executableBlocks: entry.executable.length,
        noRunBlocks: entry.noRunCount,
        ...(passed
          ? {}
          : {
              error:
                vitestResult?.message || failureMessages || "vitest run failed",
            }),
      });
    }

    if (
      result.status !== 0 &&
      !report.packages.some((p) => p.status === "fail")
    ) {
      // vitest exited non-zero but we couldn't attribute it to a specific
      // package (e.g. a config-level crash) — surface it at the top level.
      report.packages.push({
        agentMd: "(vitest run)",
        package: null,
        status: "fail",
        executableBlocks: 0,
        noRunBlocks: 0,
        error: (
          result.stderr ||
          result.stdout ||
          "vitest exited non-zero"
        ).slice(-4000),
      });
    }
  } finally {
    cleanup();
    if (scratchDir && !process.env.DOCS_TEST_KEEP_TMP) {
      rmSync(scratchDir, { recursive: true, force: true });
    } else if (scratchDir) {
      console.error("scratchDir kept at:", scratchDir);
    }
  }

  report.status = report.packages.every((entry) => entry.status !== "fail")
    ? "pass"
    : "fail";

  mkdirSync(join(root, "reports"), { recursive: true });
  writeFileSync(
    join(root, "reports/docs-test-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "pass" ? 0 : 1;
}
