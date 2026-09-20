import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchCallsWithoutSignal, runDependencyAudit } from "./index";

function tempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `mvp-deps-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

describe("dependency-audit", () => {
  it("detects duplicated dependency versions and forbidden dependency", () => {
    const root = tempRoot("packages");
    write(
      join(root, "dependency-audit.json"),
      JSON.stringify({ forbiddenPackages: ["left-pad"] }),
    );
    write(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { react: "18.3.1", "left-pad": "1.3.0" },
      }),
    );
    write(
      join(root, "packages/ui/package.json"),
      JSON.stringify({ dependencies: { react: "17.0.2" } }),
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some(
        (issue) =>
          issue.code === "duplicated-package-version" &&
          issue.packageName === "react",
      ),
    ).toBe(true);
    expect(
      report.issues.some(
        (issue) =>
          issue.code === "forbidden-package" &&
          issue.packageName === "left-pad",
      ),
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("detects page-to-page and fragment-to-page imports", () => {
    const root = tempRoot("imports");
    write(
      join(root, "apps/page-home/src/home.ts"),
      'import "@mvp/page-product";\n',
    );
    write(
      join(root, "fragments/promo/src/render.tsx"),
      'import "@mvp/page-home";\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some(
        (issue) => issue.code === "page-importing-another-page",
      ),
    ).toBe(true);
    expect(
      report.issues.some(
        (issue) => issue.code === "fragment-importing-page-code",
      ),
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("detects browser globals in server-safe packages and client-only leakage", () => {
    const root = tempRoot("server");
    write(
      join(root, "packages/ui/src/client.tsx"),
      '"use client";\nexport const Client = () => null;\n',
    );
    write(
      join(root, "packages/ui/src/server.tsx"),
      'import { Client } from "./client";\nexport const width = window.innerWidth;\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some(
        (issue) => issue.code === "server-safe-browser-global",
      ),
    ).toBe(true);
    expect(
      report.issues.some(
        (issue) => issue.code === "client-only-dependency-in-server",
      ),
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not flag browser-global or fetch words in comments and strings", () => {
    const root = tempRoot("heuristic-fp");
    // The regression that motivated this: a doc comment saying "deprecation
    // window" in a server-safe package failed audit:deps (2026-07-11).
    write(
      join(root, "packages/contracts/src/index.ts"),
      [
        "// The alias was retired after the deprecation window closed.",
        "/* Also fine in block comments: window, document, localStorage. */",
        'export const label = "resize the window";',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source intentionally contains template syntax
        "export const hint = `document says: fetch( later via ${label}`;",
        "export const ok = 1;",
        "",
      ].join("\n"),
    );
    write(
      join(root, "apps/page-home/src/data.ts"),
      [
        "// Never call fetch() directly here — use @mvp/request instead.",
        'export const msg = "fetch(url) is forbidden in business code";',
        "export const load = () => msg;",
        "",
      ].join("\n"),
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some(
        (issue) => issue.code === "server-safe-browser-global",
      ),
    ).toBe(false);
    expect(
      report.issues.some(
        (issue) => issue.code === "raw-fetch-in-business-code",
      ),
    ).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("still flags real browser-global and fetch usage next to innocent comments", () => {
    const root = tempRoot("heuristic-tp");
    write(
      join(root, "packages/ui/src/measure.ts"),
      [
        "// Reading the window size is a real browser dependency:",
        "export const width = window.innerWidth;",
        "",
      ].join("\n"),
    );
    write(
      join(root, "apps/page-home/src/data.ts"),
      [
        "// fetch( in this comment must not mask the real call below.",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source intentionally contains template syntax
        "export const load = () => fetch(`https://api.example.test/${1}`);",
        "",
      ].join("\n"),
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some(
        (issue) => issue.code === "server-safe-browser-global",
      ),
    ).toBe(true);
    expect(
      report.issues.some(
        (issue) => issue.code === "raw-fetch-in-business-code",
      ),
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("detects raw fetch in page and fragment business code", () => {
    const root = tempRoot("raw-fetch");
    write(
      join(root, "apps/page-home/src/data.ts"),
      'export async function load() { return fetch("https://api.example.test"); }\n',
    );
    write(
      join(root, "fragments/promo/src/render.ts"),
      'export async function render() { return fetch("https://api.example.test"); }\n',
    );
    write(
      join(root, "apps/shell-gateway/src/server.ts"),
      'export async function proxy() { return fetch("http://page-home:4101"); }\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.filter(
        (issue) => issue.code === "raw-fetch-in-business-code",
      ),
    ).toHaveLength(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a stable report shape", () => {
    const root = tempRoot("report");
    write(join(root, "package.json"), JSON.stringify({ dependencies: {} }));
    runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const json = JSON.parse(
      readFileSync(join(root, "reports/dependency-report.json"), "utf8"),
    );
    expect(Object.keys(json)).toEqual(["tool", "status", "issues"]);
    expect(
      readFileSync(join(root, "reports/dependency-report.md"), "utf8"),
    ).toContain("Dependency Audit Report");
    rmSync(root, { recursive: true, force: true });
  });

  it("allows a Next page-app server component to import a local client island but not a fragment", () => {
    const root = tempRoot("island");
    write(
      join(root, "apps/page-home/app/Island.tsx"),
      '"use client";\nexport function Island() { return null; }\n',
    );
    write(
      join(root, "apps/page-home/app/page.tsx"),
      'import { Island } from "./Island";\nexport default function Page() { return null; }\n',
    );
    write(
      join(root, "fragments/promo/src/Island.tsx"),
      '"use client";\nexport function Island() { return null; }\n',
    );
    write(
      join(root, "fragments/promo/src/server.ts"),
      'import { Island } from "./Island";\nexport const server = Island;\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const clientOnly = report.issues.filter(
      (issue) => issue.code === "client-only-dependency-in-server",
    );
    expect(clientOnly).toHaveLength(1);
    expect(clientOnly[0].file).toBe("fragments/promo/src/server.ts");
    rmSync(root, { recursive: true, force: true });
  });

  it("fails a non-allowlisted framework package importing domain/product code", () => {
    const root = tempRoot("layering-fail");
    write(
      join(root, "domains/some-domain/package.json"),
      JSON.stringify({ name: "@mvp/some-domain" }),
    );
    write(
      join(root, "domains/some-domain/src/index.ts"),
      "export const thing = 1;\n",
    );
    write(
      join(root, "packages/some-pkg/src/index.ts"),
      'import { thing } from "@mvp/some-domain";\nexport { thing };\n',
    );
    write(
      join(root, "packages/other-pkg/src/index.ts"),
      'import { relThing } from "../../../domains/some-domain/src/index";\nexport { relThing };\n',
    );
    write(
      join(root, "apps/page-home/package.json"),
      JSON.stringify({ name: "@mvp/page-home" }),
    );
    write(
      join(root, "packages/uses-app/src/index.ts"),
      'import { helper } from "@mvp/page-home";\nexport { helper };\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const layering = report.issues.filter(
      (issue) => issue.code === "domain-code-in-framework-package",
    );
    expect(
      layering.some((issue) => issue.file === "packages/some-pkg/src/index.ts"),
    ).toBe(true);
    expect(
      layering.some(
        (issue) => issue.file === "packages/other-pkg/src/index.ts",
      ),
    ).toBe(true);
    expect(
      layering.some((issue) => issue.file === "packages/uses-app/src/index.ts"),
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("no longer allowlists the former trade-domain leaks now that Phase P1/P2 moved them out", () => {
    const root = tempRoot("layering-allowlist-closed");
    write(
      join(root, "domains/trade-chart/package.json"),
      JSON.stringify({ name: "@mvp/trade-chart" }),
    );
    write(
      join(root, "domains/trade-chart/src/index.ts"),
      "export const chart = 1;\n",
    );
    // These are the exact paths the KNOWN_LEAKS allowlist used to cover
    // (packages/trade-client and packages/interaction/src/trade were closed in
    // Phase P1; packages/data's trade source registry, packages/storage's
    // trade prefs, and packages/design-system's trade theme helper were closed
    // in Phase P2 — see docs/ARCHITECTURE_REFACTOR_PLAN.md §2.2 Moves C/D/E).
    // KNOWN_LEAKS is now empty, so importing domain code from any of these
    // locations must be caught, not silently suppressed — proving the
    // allowlist was fully narrowed rather than just left stale.
    write(
      join(root, "packages/data/src/sources/tradeClient.ts"),
      'import { chart } from "@mvp/trade-chart";\nexport { chart };\n',
    );
    write(
      join(root, "packages/data/src/index.ts"),
      'import { chart } from "@mvp/trade-chart";\nexport { chart };\n',
    );
    write(
      join(root, "packages/storage/src/prefs/watchlist.ts"),
      'import { chart } from "@mvp/trade-chart";\nexport { chart };\n',
    );
    write(
      join(root, "packages/design-system/src/themes.ts"),
      'import { chart } from "@mvp/trade-chart";\nexport { chart };\n',
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const layering = report.issues.filter(
      (issue) => issue.code === "domain-code-in-framework-package",
    );
    expect(layering.map((issue) => issue.file).sort()).toEqual([
      "packages/data/src/index.ts",
      "packages/data/src/sources/tradeClient.ts",
      "packages/design-system/src/themes.ts",
      "packages/storage/src/prefs/watchlist.ts",
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags a fragment island.tsx that calls createInteractionBus with no bus escape hatch (§4.3.2)", () => {
    const root = tempRoot("island-bus-bare");
    write(
      join(root, "fragments/orphan-widget/src/island.tsx"),
      [
        '"use client";',
        'import { createInteractionBus } from "@mvp/interaction";',
        "export function OrphanWidgetIsland() {",
        "  const bus = createInteractionBus({ contracts: {} });",
        "  return null;",
        "}",
        "",
      ].join("\n"),
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const busIssues = report.issues.filter(
      (issue) => issue.code === "island-bus-without-escape-hatch",
    );
    expect(busIssues.map((issue) => issue.file)).toEqual([
      "fragments/orphan-widget/src/island.tsx",
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("passes a fragment island.tsx that declares the bus? escape hatch", () => {
    const root = tempRoot("island-bus-escape-hatch");
    write(
      join(root, "fragments/good-widget/src/island.tsx"),
      [
        '"use client";',
        'import { createInteractionBus, type InteractionBus } from "@mvp/interaction";',
        'import { useMemo } from "react";',
        "export function GoodWidgetIsland(props: { bus?: InteractionBus }) {",
        "  const injectedBus = props.bus;",
        "  const bus = useMemo(",
        "    () => injectedBus ?? createInteractionBus({ contracts: {} }),",
        "    [injectedBus],",
        "  );",
        "  return null;",
        "}",
        "",
      ].join("\n"),
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some(
        (issue) => issue.code === "island-bus-without-escape-hatch",
      ),
    ).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not flag an island.tsx that never calls createInteractionBus at all (e.g. order-form's deps-only pattern)", () => {
    const root = tempRoot("island-bus-no-bus-call");
    write(
      join(root, "fragments/deps-only-widget/src/island.tsx"),
      [
        '"use client";',
        "export function DepsOnlyWidgetIsland(props: { deps: { store: unknown } }) {",
        "  return null;",
        "}",
        "",
      ].join("\n"),
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some(
        (issue) => issue.code === "island-bus-without-escape-hatch",
      ),
    ).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("flags gateway fetch calls that pass no abort signal", () => {
    const root = tempRoot("gateway-fetch");
    write(
      join(root, "apps/shell-gateway/package.json"),
      JSON.stringify({ name: "@mvp/shell-gateway", dependencies: {} }),
    );
    write(
      join(root, "apps/shell-gateway/src/server.ts"),
      [
        "export async function proxy(url: string) {",
        "  const response = await fetch(url, { headers: {} });",
        "  return response.text();",
        "}",
        "",
      ].join("\n"),
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const issue = report.issues.find(
      (item) => item.code === "fetch-without-timeout",
    );
    expect(issue?.severity).toBe("fail");
    expect(issue?.file).toBe("apps/shell-gateway/src/server.ts");
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts a gateway fetch that carries an abort signal", () => {
    const root = tempRoot("gateway-fetch-ok");
    write(
      join(root, "apps/shell-gateway/package.json"),
      JSON.stringify({ name: "@mvp/shell-gateway", dependencies: {} }),
    );
    write(
      join(root, "apps/shell-gateway/src/server.ts"),
      [
        "export async function proxy(url: string) {",
        "  const response = await fetch(url, {",
        "    headers: {},",
        "    signal: AbortSignal.timeout(5000),",
        "  });",
        "  return response.text();",
        "}",
        "",
      ].join("\n"),
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some((item) => item.code === "fetch-without-timeout"),
    ).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("auditDeclarativeLayering (tags + depConstraints)", () => {
  const CONFIG = {
    tags: {
      "packages/*": ["layer:framework"],
      "domains/*": ["layer:domain"],
      "apps/*": ["layer:product"],
    },
    depConstraints: [
      {
        sourceTag: "layer:framework",
        onlyDependOnLibsWithTags: ["layer:framework"],
      },
      {
        sourceTag: "layer:domain",
        onlyDependOnLibsWithTags: ["layer:domain", "layer:framework"],
      },
      { sourceTag: "layer:product", onlyDependOnLibsWithTags: ["*"] },
    ],
  };

  function layeredRoot(name: string): string {
    const root = tempRoot(name);
    write(join(root, "dependency-audit.json"), JSON.stringify(CONFIG, null, 2));
    write(
      join(root, "packages/runtime/package.json"),
      JSON.stringify({ name: "@mvp/runtime", dependencies: {} }),
    );
    write(
      join(root, "domains/trade-data/package.json"),
      JSON.stringify({ name: "@mvp/trade-data", dependencies: {} }),
    );
    write(
      join(root, "apps/page-home/package.json"),
      JSON.stringify({ name: "@mvp/page-home", dependencies: {} }),
    );
    return root;
  }

  const run = (root: string) =>
    runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });

  it("fails a framework package that imports the domain layer", () => {
    const root = layeredRoot("layer-down");
    write(
      join(root, "packages/runtime/src/index.ts"),
      'import { tradeSources } from "@mvp/trade-data";\nexport const x = tradeSources;\n',
    );
    const issue = run(root).issues.find(
      (item) => item.code === "layer-constraint-violation",
    );
    expect(issue?.severity).toBe("fail");
    expect(issue?.file).toBe("packages/runtime/src/index.ts");
    // The message names both sides' tags, like Nx's does.
    expect(issue?.detail).toContain("layer:framework");
    expect(issue?.detail).toContain("layer:domain");
    rmSync(root, { recursive: true, force: true });
  });

  it("allows the domain layer to import the framework layer", () => {
    const root = layeredRoot("layer-up-ok");
    write(
      join(root, "domains/trade-data/src/index.ts"),
      'import { createDataClient } from "@mvp/runtime";\nexport const x = createDataClient;\n',
    );
    expect(
      run(root).issues.some(
        (item) => item.code === "layer-constraint-violation",
      ),
    ).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("leaves a `*` constrained layer unrestricted", () => {
    const root = layeredRoot("layer-star");
    write(
      join(root, "apps/page-home/src/index.ts"),
      'import { a } from "@mvp/trade-data";\nimport { b } from "@mvp/runtime";\nexport const x = [a, b];\n',
    );
    expect(
      run(root).issues.some(
        (item) => item.code === "layer-constraint-violation",
      ),
    ).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("matches a relative import that crosses a layer", () => {
    const root = layeredRoot("layer-relative");
    write(
      join(root, "packages/runtime/src/index.ts"),
      'import { x } from "../../../domains/trade-data/src/index";\nexport const y = x;\n',
    );
    write(
      join(root, "domains/trade-data/src/index.ts"),
      "export const x = 1;\n",
    );
    expect(
      run(root).issues.some(
        (item) => item.code === "layer-constraint-violation",
      ),
    ).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("falls back to the hard-coded three-layer check with no config", () => {
    const root = tempRoot("layer-no-config");
    write(
      join(root, "packages/runtime/package.json"),
      JSON.stringify({ name: "@mvp/runtime", dependencies: {} }),
    );
    write(
      join(root, "domains/trade-data/package.json"),
      JSON.stringify({ name: "@mvp/trade-data", dependencies: {} }),
    );
    write(
      join(root, "packages/runtime/src/index.ts"),
      'import { x } from "@mvp/trade-data";\nexport const y = x;\n',
    );
    const codes = run(root).issues.map((item) => item.code);
    expect(codes).toContain("domain-code-in-framework-package");
    expect(codes).not.toContain("layer-constraint-violation");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("auditFragmentServerHost", () => {
  it("fails a fragment that hand-rolls its own server", () => {
    const root = tempRoot("hand-rolled-server");
    write(
      join(root, "fragments/rogue/package.json"),
      JSON.stringify({ name: "@mvp/fragment-rogue", dependencies: {} }),
    );
    write(
      join(root, "fragments/rogue/src/server.ts"),
      [
        'import Fastify from "fastify";',
        "export function buildServer() {",
        "  const server = Fastify({ logger: false });",
        '  server.get("/health", async () => ({ status: "ok" }));',
        "  return server;",
        "}",
        "",
      ].join("\n"),
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    const issue = report.issues.find(
      (item) => item.code === "fragment-server-not-hosted",
    );
    expect(issue?.severity).toBe("fail");
    expect(issue?.file).toBe("fragments/rogue/src/server.ts");
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts a fragment server that delegates to the shared host", () => {
    const root = tempRoot("hosted-server");
    write(
      join(root, "fragments/tidy/package.json"),
      JSON.stringify({ name: "@mvp/fragment-tidy", dependencies: {} }),
    );
    write(
      join(root, "fragments/tidy/src/server.ts"),
      [
        'import { createFragmentServer } from "@mvp/fragment-host";',
        "export function buildServer() {",
        "  return createFragmentServer({});",
        "}",
        "",
      ].join("\n"),
    );
    const report = runDependencyAudit({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      positional: [],
    });
    expect(
      report.issues.some((item) => item.code === "fragment-server-not-hosted"),
    ).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("fetchCallsWithoutSignal", () => {
  it("counts only real calls that omit a signal", () => {
    expect(fetchCallsWithoutSignal("await fetch(url)")).toBe(1);
    expect(
      fetchCallsWithoutSignal("await fetch(url, { signal: ac.signal })"),
    ).toBe(0);
    expect(
      fetchCallsWithoutSignal(
        "await fetch(url, {\n  headers: h,\n  signal: AbortSignal.timeout(5),\n})",
      ),
    ).toBe(0);
    // A commented-out or quoted call is not a network call.
    expect(fetchCallsWithoutSignal("// await fetch(url)")).toBe(0);
    expect(fetchCallsWithoutSignal('const s = "fetch(url)";')).toBe(0);
  });
});
