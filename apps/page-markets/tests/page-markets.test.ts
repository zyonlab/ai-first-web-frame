import type { FragmentRegistry } from "@mvp/contracts";
import { clearFragmentCache } from "@mvp/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as healthGet } from "../app/health/route";
import { marketsPageBudget } from "../src/budget";
import { fetchMarketsFragmentSlots } from "../src/fragmentSlots";
import { MARKETS_LAYOUT_CLASS } from "../src/gridStyles";
import {
  marketsPageManifest,
  validateMarketsPageManifest,
} from "../src/manifest";
import { metadata } from "../src/metadata";
import {
  marketsSeoCopy,
  renderMarketsHtml,
  usedUiComponents,
} from "../src/render";

/**
 * The markets-table fragment is registered by the integrator; tests inject a
 * throwaway registry so the composition path is exercised without touching
 * `registry.data.json`. Port 4212 is the next free host after the trade
 * fragments (4203–4211).
 */
const MARKETS_TABLE_PORT = "4212";

const TEST_REGISTRY: FragmentRegistry = {
  fragments: {
    "markets-table": {
      canary: {
        version: "0.1.0",
        serviceUrl: `http://localhost:${MARKETS_TABLE_PORT}`,
        manifestUrl: `http://localhost:${MARKETS_TABLE_PORT}/manifest`,
      },
    },
  },
};

/** Sample markets-table SSR HTML with rows deep-linking into /trade/:symbol. */
const SAMPLE_TABLE_HTML =
  '<section data-fragment="markets-table">' +
  "<table><tbody>" +
  '<tr><td>BTC</td><td>64,117.5</td><td><a href="/trade/BTC">Trade</a></td></tr>' +
  '<tr><td>ETH</td><td>3,398.7</td><td><a href="/trade/ETH">Trade</a></td></tr>' +
  '<tr><td>SOL</td><td>142.10</td><td><a href="/trade/SOL">Trade</a></td></tr>' +
  "</tbody></table></section>";

function portOf(url: string): string {
  const match = url.match(/:(\d+)\//);
  return match?.[1] ?? "";
}

/** Mock fetch returning the markets-table sample HTML for the canary port. */
function makeMarketsFetch(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const port = portOf(String(url));
    if (port !== MARKETS_TABLE_PORT) throw new Error(`unexpected port ${port}`);
    return new Response(
      JSON.stringify({
        html: SAMPLE_TABLE_HTML,
        assets: { js: [], css: [] },
        cache: { ttl: 5, tags: ["markets-table"] },
        metadata: { name: "markets-table", version: "0.1.0" },
      }),
    );
  }) as typeof fetch;
}

describe("page-markets", () => {
  beforeEach(() => {
    clearFragmentCache();
  });

  it("SSR HTML is no-JS readable and carries SEO copy", () => {
    const html = renderMarketsHtml();
    expect(html).toContain('data-page="markets"');
    expect(html).toContain(marketsSeoCopy.title);
    // No fragment data present -> readable, no-JS fallback (not a hard blank).
    expect(html).toContain("Markets table is loading.");
  });

  it("renders the markets layout regions from 01-ui-layout.md §5", () => {
    const html = renderMarketsHtml();
    for (const area of ["markets-head", "markets-filter", "markets-table"]) {
      expect(html).toContain(`data-area="${area}"`);
    }
    expect(html).toContain(`class="${MARKETS_LAYOUT_CLASS}"`);
    expect(html).toContain('data-slot="marketsTable"');
  });

  it("renders live table HTML with /trade/:symbol row links when provided", () => {
    const html = renderMarketsHtml({ marketsTable: SAMPLE_TABLE_HTML });
    expect(html).toContain('href="/trade/BTC"');
    expect(html).toContain('href="/trade/ETH"');
    // Fallback text is gone once the fragment resolved.
    expect(html).not.toContain("Markets table is loading.");
  });

  it("metadata includes title and description", () => {
    expect(metadata).toMatchObject({
      title: marketsPageManifest.seo.title,
      description: marketsPageManifest.seo.description,
    });
    expect(marketsSeoCopy.title).toBe(marketsPageManifest.seo.title);
  });

  it("page manifest passes validation and lists 1 required slot", () => {
    expect(validateMarketsPageManifest()).toBe(true);
    expect(marketsPageManifest.slots).toHaveLength(1);
    const slot = marketsPageManifest.slots[0];
    expect(slot.name).toBe("marketsTable");
    expect(slot.fragment).toBe("markets-table");
    expect(slot.channel).toBe("canary");
    expect(slot.strategy).toBe("cached-ssr");
    expect(slot.required).toBe(true);
  });

  it("declares page budget within 180KB JS / 50KB CSS and UI usage", () => {
    expect(marketsPageBudget.scope).toBe("page");
    expect(marketsPageBudget.jsBytes).toBeLessThanOrEqual(180000);
    expect(marketsPageBudget.cssBytes).toBeLessThanOrEqual(50000);
    expect(usedUiComponents).toContain("DataTable");
  });

  it("health route returns page-markets ok", async () => {
    const res = await healthGet();
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      service: "page-markets",
    });
  });

  it("composes the markets-table slot through the registry render endpoint", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return makeMarketsFetch()(url);
    }) as typeof fetch;

    const result = await fetchMarketsFragmentSlots({
      registry: TEST_REGISTRY,
      fetchImpl,
      headers: new Headers({ "x-trace-id": "trace-markets" }),
    });

    // The single markets-table canary port was hit at /render.
    expect(calls.map(portOf)).toEqual([MARKETS_TABLE_PORT]);
    expect(calls[0]).toContain("/render");

    expect(result.slots.marketsTable).toContain('href="/trade/BTC"');
    expect(result.diagnostics.marketsTable).toMatchObject({
      status: "ok",
      strategy: "cached-ssr",
      required: true,
    });
    expect(result.scheduler.health).toBe("ok");
    expect(Array.isArray(result.scheduler.hints)).toBe(true);
    expect(result.traceLog).toContain("runtime.fetchFragmentSlots");
    expect(result.traceLog).toContain("slot:marketsTable");
  });

  it("degrades readably when markets-table is not registered", async () => {
    // Inject an empty registry so the required slot is unresolved -> readable
    // fallback + unhealthy, without throwing. (The real registry now HAS
    // markets-table registered, so the not-registered path is forced here.)
    const result = await fetchMarketsFragmentSlots({
      registry: { fragments: {} },
      fetchImpl: makeMarketsFetch(),
      timeoutMs: 20,
    });

    expect(result.diagnostics.marketsTable.status).toBe("fallback");
    expect(result.slots.marketsTable).toContain('data-fallback="true"');
    expect(result.scheduler.health).toBe("unhealthy");
  });

  it("degrades (not breaks) when the markets-table fragment fetch fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("markets-table down");
    }) as typeof fetch;

    const result = await fetchMarketsFragmentSlots({
      registry: TEST_REGISTRY,
      fetchImpl,
      timeoutMs: 20,
    });

    expect(result.diagnostics.marketsTable.status).toBe("fallback");
    expect(result.slots.marketsTable).toContain('data-fallback="true"');
    expect(result.scheduler.health).toBe("unhealthy");
  });

  it("full page HTML renders fetched table content into the table region", async () => {
    const result = await fetchMarketsFragmentSlots({
      registry: TEST_REGISTRY,
      fetchImpl: makeMarketsFetch(),
    });
    const html = renderMarketsHtml({ marketsTable: result.slots.marketsTable });

    expect(html).toContain('data-page="markets"');
    expect(html).toContain('href="/trade/BTC"');
    expect(html).toContain('data-area="markets-table"');
  });
});
