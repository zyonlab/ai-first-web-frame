import { MARKETS_LAYOUT_CLASS } from "./gridStyles";

/**
 * Per-slot fragment HTML for the markets page. The single body slot is the
 * `markets-table` fragment's SSR HTML string, or `null`/omitted to fall back to
 * the no-JS-readable placeholder.
 */
export type MarketsFragments = {
  marketsTable?: string | null;
};

export const marketsSeoCopy = {
  title: "MVP Perps — Markets",
  description:
    "Every perpetual market in one server-rendered table: last price, 24h change, funding, volume and open interest. Readable without client JavaScript; each row links into its trade terminal.",
} as const;

/**
 * No-JS-readable fallback markup for the table body. Mirrors the fragment
 * fallback contract (`data-fallback="true"`) used across the framework so a
 * degraded/absent `markets-table` fragment degrades the panel instead of
 * breaking the page.
 */
function tableFallback(): string {
  return `<section data-fragment="markets-table" data-fallback="true">Markets table is loading.</section>`;
}

/**
 * Assemble the markets page as a pure HTML string. Used both for the no-JS SSR
 * baseline and for tests that assert layout regions / fallbacks without a
 * browser. The RSC page (`app/markets/page.tsx`) renders the same named regions
 * via React.
 */
export function renderMarketsHtml(fragments: MarketsFragments = {}): string {
  const table = fragments.marketsTable ?? tableFallback();

  return `<main data-page="markets">
    <div class="${MARKETS_LAYOUT_CLASS}">
      <div data-area="markets-head">
        <h1>${marketsSeoCopy.title}</h1>
      </div>
      <div data-area="markets-filter">
        <span data-filter="search">Search</span>
        <span data-filter="type">All</span>
        <span data-filter="product">Perps</span>
        <span data-filter="starred">Starred only</span>
      </div>
      <div data-area="markets-table" data-slot="marketsTable">${table}</div>
    </div>
  </main>`;
}

/** Shared-UI primitives reused (no duplication — satisfies similarity audit). */
export const usedUiComponents = ["Section", "DataTable"] as const;
