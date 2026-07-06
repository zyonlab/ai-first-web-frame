import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSimilarityCheck } from "./index";

function tempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `mvp-similarity-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

describe("component-similarity-check", () => {
  it("detects highly similar components", () => {
    const root = tempRoot("similar");
    write(join(root, "pnpm-workspace.yaml"), "packages:\n  - tools/*\n");
    write(
      join(root, "packages/ui/src/ProductBadge/metadata.ts"),
      'export const metadata = { name: "ProductBadge", category: "badge" };\n',
    );
    write(
      join(root, "packages/ui/src/ProductBadge/ProductBadge.tsx"),
      'import styles from "./ProductBadge.module.css"; type ProductBadgeProps = { label: string; tone?: string }; export function ProductBadge(props: ProductBadgeProps) { return <span className="badge primary">{props.label}</span>; }\n',
    );
    write(
      join(root, "packages/ui/src/ProductPill/metadata.ts"),
      'export const metadata = { name: "ProductPill", category: "badge" };\n',
    );
    write(
      join(root, "packages/ui/src/ProductPill/ProductPill.tsx"),
      'import styles from "./ProductPill.module.css"; type ProductPillProps = { label: string; tone?: string }; export function ProductPill(props: ProductPillProps) { return <span className="badge primary">{props.label}</span>; }\n',
    );

    const report = runSimilarityCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      threshold: 0.7,
      positional: [],
    });
    expect(report.status).toBe("fail");
    expect(report.matches).toHaveLength(1);
    expect(report.matches[0].score).toBeGreaterThanOrEqual(0.7);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not report unrelated components", () => {
    const root = tempRoot("different");
    write(join(root, "pnpm-workspace.yaml"), "packages:\n  - tools/*\n");
    write(
      join(root, "packages/ui/src/Badge/Badge.tsx"),
      "type BadgeProps = { label: string }; export function Badge(p: BadgeProps) { return <span>{p.label}</span>; }\n",
    );
    write(
      join(root, "packages/ui/src/Grid/Grid.tsx"),
      "type GridProps = { items: number[] }; export function Grid(p: GridProps) { return <section>{p.items.map((item) => <article>{item}</article>)}</section>; }\n",
    );

    const report = runSimilarityCheck({
      ci: true,
      warnOnly: false,
      force: false,
      root,
      threshold: 0.9,
      positional: [],
    });
    expect(report.status).toBe("pass");
    expect(report.matches).toHaveLength(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("writes a stable report shape and warn-only can be handled without changing status", () => {
    const root = tempRoot("report");
    write(join(root, "pnpm-workspace.yaml"), "packages:\n  - tools/*\n");
    write(
      join(root, "packages/ui/src/A/A.tsx"),
      'export function A() { return <div className="x">A</div>; }\n',
    );
    write(
      join(root, "packages/ui/src/B/B.tsx"),
      'export function B() { return <div className="x">A</div>; }\n',
    );

    const report = runSimilarityCheck({
      ci: true,
      warnOnly: true,
      force: false,
      root,
      threshold: 0.5,
      positional: [],
    });
    const json = JSON.parse(
      readFileSync(join(root, "reports/similarity-report.json"), "utf8"),
    );
    expect(Object.keys(json)).toEqual([
      "tool",
      "status",
      "threshold",
      "checkedFiles",
      "matches",
    ]);
    expect(report.status).toBe("fail");
    expect(
      readFileSync(join(root, "reports/similarity-report.md"), "utf8"),
    ).toContain("Component Similarity Report");
    rmSync(root, { recursive: true, force: true });
  });
});
