import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Shared per-unit budget loader for the budget audits.
 *
 * Every fragment (`fragments/<name>/src/budget.ts`) and page
 * (`apps/<name>/src/budget.ts`) declares its own performance budget as a
 * single exported const (shape: `PerformanceBudgetSchema` in
 * `@mvp/contracts`). Historically those files were declarative only — the
 * bundle/css audits compared a root `budget.json` against a root `stats.json`
 * and NEITHER file existed, so every run passed on zero checks. This loader
 * makes the per-unit files the budget side of both gates: it dynamically
 * imports each `budget.ts` (the same way `tools/release-tools/load-graph.ts`
 * imports fragment manifests) and returns the declared ceilings.
 */

export type UnitScope = "component" | "fragment" | "page" | "shell";

const UNIT_SCOPES: readonly UnitScope[] = [
  "component",
  "fragment",
  "page",
  "shell",
];

export type UnitBudget = {
  scope: UnitScope;
  /** Unit name as declared in the budget file (e.g. "order-book"). */
  name: string;
  /** Repo-relative unit directory (posix), e.g. "fragments/order-book". */
  dir: string;
  jsBytes?: number;
  cssBytes?: number;
};

/** Directory groups scanned for `<group>/<unit>/src/budget.ts`. */
const UNIT_GROUPS = ["fragments", "apps"] as const;

function isBudgetLike(
  value: unknown,
): value is { scope: UnitScope; name: string } & Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    UNIT_SCOPES.includes((value as { scope?: UnitScope }).scope as UnitScope)
  );
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Loads every declared per-unit budget under `fragments/` and `apps/`. */
export async function loadUnitBudgets(root: string): Promise<UnitBudget[]> {
  const out: UnitBudget[] = [];
  for (const group of UNIT_GROUPS) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) {
      continue;
    }
    for (const unitDir of readdirSync(groupDir).sort()) {
      const budgetPath = join(groupDir, unitDir, "src", "budget.ts");
      if (!existsSync(budgetPath)) {
        continue;
      }
      const mod = (await import(pathToFileURL(budgetPath).href)) as Record<
        string,
        unknown
      >;
      const budget = Object.values(mod).find(isBudgetLike);
      if (!budget) {
        continue;
      }
      out.push({
        scope: budget.scope,
        name: budget.name,
        dir: `${group}/${unitDir}`,
        jsBytes: numeric(budget.jsBytes),
        cssBytes: numeric(budget.cssBytes),
      });
    }
  }
  return out;
}
