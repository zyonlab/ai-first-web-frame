import { describe, expect, it } from "vitest";
import {
  buildDependentsIndex,
  computeAffected,
  DEPLOYABLE_UNITS,
  normalizePath,
  packageForPath,
  parseWorkspacePackage,
  toGithubMatrix,
  type WorkspacePackage,
} from "./affected";

/** Fixture graph mirroring the real repository shape. */
const packages: WorkspacePackage[] = [
  {
    name: "@mvp/contracts",
    dir: "packages/contracts",
    workspaceDependencies: [],
  },
  {
    name: "@mvp/design-tokens",
    dir: "packages/design-tokens",
    workspaceDependencies: [],
  },
  {
    name: "@mvp/ui",
    dir: "packages/ui",
    workspaceDependencies: ["@mvp/contracts", "@mvp/design-tokens"],
  },
  {
    name: "@mvp/request-context",
    dir: "packages/request-context",
    workspaceDependencies: ["@mvp/contracts"],
  },
  {
    name: "@mvp/runtime",
    dir: "packages/runtime",
    workspaceDependencies: ["@mvp/contracts", "@mvp/request-context"],
  },
  {
    name: "@mvp/shell-gateway",
    dir: "apps/shell-gateway",
    workspaceDependencies: [
      "@mvp/contracts",
      "@mvp/request-context",
      "@mvp/runtime",
    ],
  },
  {
    name: "@mvp/page-home",
    dir: "apps/page-home",
    workspaceDependencies: ["@mvp/contracts", "@mvp/runtime", "@mvp/ui"],
  },
  {
    name: "@mvp/page-product",
    dir: "apps/page-product",
    workspaceDependencies: ["@mvp/contracts", "@mvp/runtime", "@mvp/ui"],
  },
  {
    name: "@mvp/fragment-promotion-banner",
    dir: "fragments/promotion-banner",
    workspaceDependencies: ["@mvp/contracts", "@mvp/request-context"],
  },
  {
    name: "@mvp/fragment-recommendation-widget",
    dir: "fragments/recommendation-widget",
    workspaceDependencies: ["@mvp/contracts", "@mvp/request-context"],
  },
  {
    name: "@mvp/dependency-audit",
    dir: "tools/dependency-audit",
    workspaceDependencies: [],
  },
];

const unitNames = (files: string[]) =>
  computeAffected(files, packages, DEPLOYABLE_UNITS).units.map(
    (unit) => unit.unit,
  );

describe("normalizePath", () => {
  it("normalizes separators and strips leading ./", () => {
    expect(normalizePath("./apps\\page-home\\src\\a.ts")).toBe(
      "apps/page-home/src/a.ts",
    );
  });
});

describe("parseWorkspacePackage", () => {
  it("extracts only workspace-protocol dependencies", () => {
    const pkg = parseWorkspacePackage("apps/page-home", {
      name: "@mvp/page-home",
      dependencies: {
        "@mvp/ui": "workspace:*",
        next: "^15.3.4",
      },
      devDependencies: { "@mvp/contracts": "workspace:^" },
    });
    expect(pkg).toEqual({
      name: "@mvp/page-home",
      dir: "apps/page-home",
      workspaceDependencies: ["@mvp/contracts", "@mvp/ui"],
    });
  });

  it("returns undefined for unnamed packages", () => {
    expect(parseWorkspacePackage("apps/x", {})).toBeUndefined();
  });
});

describe("buildDependentsIndex", () => {
  it("includes the package itself and transitive dependents", () => {
    const index = buildDependentsIndex(packages);
    expect(index.get("@mvp/design-tokens")).toEqual(
      new Set([
        "@mvp/design-tokens",
        "@mvp/ui",
        "@mvp/page-home",
        "@mvp/page-product",
      ]),
    );
  });

  it("handles dependency cycles without infinite loops", () => {
    const cyclic: WorkspacePackage[] = [
      { name: "a", dir: "packages/a", workspaceDependencies: ["b"] },
      { name: "b", dir: "packages/b", workspaceDependencies: ["a"] },
    ];
    const index = buildDependentsIndex(cyclic);
    expect(index.get("a")).toEqual(new Set(["a", "b"]));
    expect(index.get("b")).toEqual(new Set(["a", "b"]));
  });
});

describe("packageForPath", () => {
  it("matches the longest owning directory", () => {
    const owner = packageForPath("apps/page-home/src/render.ts", packages);
    expect(owner?.name).toBe("@mvp/page-home");
  });

  it("returns undefined for paths outside any package", () => {
    expect(packageForPath("platform/route-registry/src/x.ts", packages)).toBe(
      undefined,
    );
  });
});

describe("computeAffected", () => {
  it("maps a fragment source change to only that fragment", () => {
    expect(unitNames(["fragments/promotion-banner/src/server.ts"])).toEqual([
      "promotion-banner",
    ]);
  });

  it("propagates shared package changes to dependent units only", () => {
    expect(unitNames(["packages/ui/src/Button/index.tsx"])).toEqual([
      "page-home",
      "page-product",
    ]);
  });

  it("propagates transitive shared package changes", () => {
    expect(unitNames(["packages/design-tokens/src/index.ts"])).toEqual([
      "page-home",
      "page-product",
    ]);
  });

  it("marks every unit for a contracts change", () => {
    expect(unitNames(["packages/contracts/src/index.ts"])).toEqual([
      "shell-gateway",
      "page-home",
      "page-product",
      "promotion-banner",
      "recommendation-widget",
    ]);
  });

  it("maps platform route-registry changes to shell-gateway only", () => {
    expect(unitNames(["platform/route-registry/src/registry.ts"])).toEqual([
      "shell-gateway",
    ]);
  });

  it("maps platform fragment-registry changes to shell and pages", () => {
    expect(unitNames(["platform/fragment-registry/src/registry.ts"])).toEqual([
      "shell-gateway",
      "page-home",
      "page-product",
    ]);
  });

  it("ignores docs, infra, CI, and markdown changes", () => {
    const result = computeAffected(
      [
        "docs/RELEASE_MODEL.md",
        ".github/workflows/ci.yml",
        "infra/k8s/page-home.yaml",
        "apps/page-home/README.md",
        "e2e/smoke.spec.ts",
        "scripts/affected.mts",
      ],
      packages,
      DEPLOYABLE_UNITS,
    );
    expect(result.units).toEqual([]);
    expect(result.matchedAll).toBe(false);
  });

  it("ignores tool package changes via the dependency graph", () => {
    expect(unitNames(["tools/dependency-audit/src/index.ts"])).toEqual([]);
  });

  it("marks all units when the lockfile changes", () => {
    const result = computeAffected(
      ["pnpm-lock.yaml"],
      packages,
      DEPLOYABLE_UNITS,
    );
    expect(result.units).toHaveLength(5);
    expect(result.matchedAll).toBe(true);
  });

  it("treats unknown root paths conservatively as affecting all units", () => {
    const result = computeAffected(
      ["some-new-root-config.json"],
      packages,
      DEPLOYABLE_UNITS,
    );
    expect(result.units).toHaveLength(5);
    expect(result.matchedAll).toBe(true);
  });

  it("includes a Dockerfile change for the owning unit", () => {
    expect(unitNames(["apps/shell-gateway/Dockerfile"])).toEqual([
      "shell-gateway",
    ]);
  });

  it("deduplicates files and records reasons", () => {
    const result = computeAffected(
      [
        "apps/page-home/src/render.ts",
        "apps/page-home/src/render.ts",
        "packages/ui/src/index.ts",
      ],
      packages,
      DEPLOYABLE_UNITS,
    );
    expect(result.changedFiles).toEqual([
      "apps/page-home/src/render.ts",
      "packages/ui/src/index.ts",
    ]);
    const pageHome = result.units.find((unit) => unit.unit === "page-home");
    expect(pageHome?.reasons).toEqual([
      "unit source changed: apps/page-home/src/render.ts",
      "workspace dependency @mvp/ui changed: packages/ui/src/index.ts",
    ]);
    expect(result.changedPackages).toEqual(["@mvp/page-home", "@mvp/ui"]);
  });

  it("returns an empty result for no changes", () => {
    const result = computeAffected([], packages, DEPLOYABLE_UNITS);
    expect(result.units).toEqual([]);
    expect(result.matchedAll).toBe(false);
  });
});

describe("toGithubMatrix", () => {
  it("produces a matrix include payload", () => {
    const result = computeAffected(
      ["fragments/recommendation-widget/src/server.ts"],
      packages,
      DEPLOYABLE_UNITS,
    );
    expect(toGithubMatrix(result)).toEqual({
      include: [
        {
          unit: "recommendation-widget",
          dir: "fragments/recommendation-widget",
          dockerfile: "fragments/recommendation-widget/Dockerfile",
        },
      ],
    });
  });
});
