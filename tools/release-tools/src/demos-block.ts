/**
 * Pure generator/differ for the machine-readable block in `docs/DEMOS.md`
 * (refactor plan §6). The block is the per-page capability table sourced from
 * each `apps/page-<name>/src/manifest.ts` `demonstrates` array; the loader/CLI
 * lives in `scripts/verify-demos.mts` (all I/O + dynamic imports there, the
 * transform stays pure and unit-tested here — same split as `load-graph.ts`
 * vs `unit-graph.ts`).
 *
 * Design rule this enforces (repo meta-lesson): hand-maintained declarative
 * surfaces rot within one merge cycle; only generated-or-executed surfaces
 * stay true. DEMOS.md's table already went stale once the same day it was
 * hand-verified, so the table is now generated and `pnpm verify:demos`
 * (a `pnpm verify` gate) fails when it drifts from the manifests.
 */

export type PageDemosEntry = {
  /** Page app directory name, e.g. "page-home". */
  page: string;
  /** The manifest's declared route, e.g. "/product/:id". */
  route: string;
  /** The manifest's `demonstrates` array ([] when the field is absent). */
  demonstrates: string[];
};

export const DEMOS_BLOCK_BEGIN = "<!-- BEGIN GENERATED: demonstrates -->";
export const DEMOS_BLOCK_END = "<!-- END GENERATED: demonstrates -->";

export class MissingDemosMarkersError extends Error {}

/**
 * Renders the generated block (markers included). Deterministic: pages are
 * sorted by name, so the block is byte-stable for a given set of manifests.
 * Pages that declare no `demonstrates` (the slotless page-vaults /
 * page-referrals) get an explicit "(none declared)" row instead of silently
 * disappearing — absence is information.
 */
export function renderDemosBlock(entries: PageDemosEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.page.localeCompare(b.page));
  const rows = sorted.map((entry) => {
    const demonstrates =
      entry.demonstrates.length === 0
        ? "_(no demonstrated capabilities declared)_"
        : entry.demonstrates.map((value) => `\`${value}\``).join(", ");
    return `| \`${entry.page}\` | \`${entry.route}\` | ${demonstrates} |`;
  });
  return [
    DEMOS_BLOCK_BEGIN,
    "<!-- Generated from each apps/page-*/src/manifest.ts `demonstrates` array.",
    "     Do not edit by hand. Regenerate:",
    "       pnpm exec tsx scripts/verify-demos.mts --write",
    "     Freshness gate (wired into `pnpm verify`):",
    "       pnpm verify:demos -->",
    "",
    "| Page | Route | `demonstrates` |",
    "| --- | --- | --- |",
    ...rows,
    DEMOS_BLOCK_END,
  ].join("\n");
}

/**
 * Extracts the current generated block (markers included) from a DEMOS.md
 * document, or null when the markers are absent/malformed.
 */
export function extractDemosBlock(document: string): string | null {
  const begin = document.indexOf(DEMOS_BLOCK_BEGIN);
  const end = document.indexOf(DEMOS_BLOCK_END);
  if (begin === -1 || end === -1 || end < begin) return null;
  return document.slice(begin, end + DEMOS_BLOCK_END.length);
}

/**
 * Returns the document with its generated block replaced by `block`,
 * leaving all hand-written prose outside the markers byte-identical.
 * Throws {@link MissingDemosMarkersError} when the markers are missing or
 * out of order — a doc without markers must fail loudly, not be appended to.
 */
export function replaceDemosBlock(document: string, block: string): string {
  const current = extractDemosBlock(document);
  if (current === null) {
    throw new MissingDemosMarkersError(
      `docs/DEMOS.md must contain the markers "${DEMOS_BLOCK_BEGIN}" and "${DEMOS_BLOCK_END}" (in that order)`,
    );
  }
  return document.replace(current, block);
}

export type DemosBlockFreshness =
  | { status: "fresh" }
  | { status: "stale"; expected: string; actual: string | null };

/**
 * Pure staleness comparison used by `verify-demos --check`: "fresh" iff the
 * on-document block is byte-identical to what {@link renderDemosBlock} would
 * produce right now. A document without markers (`actual === null`) is
 * always stale.
 */
export function checkDemosBlockFreshness(
  expectedBlock: string,
  document: string,
): DemosBlockFreshness {
  const actual = extractDemosBlock(document);
  if (actual === expectedBlock) return { status: "fresh" };
  return { status: "stale", expected: expectedBlock, actual };
}
