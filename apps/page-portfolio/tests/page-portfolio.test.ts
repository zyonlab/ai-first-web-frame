import type { FragmentRegistry } from "@mvp/contracts";
import { clearFragmentCache } from "@mvp/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as healthGet } from "../app/health/route";
import { portfolioPageBudget } from "../src/budget";
import { fetchPortfolioFragmentSlots } from "../src/fragmentSlots";
import { PORTFOLIO_LAYOUT_CLASS } from "../src/gridStyles";
import {
  portfolioPageManifest,
  validatePortfolioPageManifest,
} from "../src/manifest";
import { metadata } from "../src/metadata";
import {
  portfolioSeoCopy,
  renderPortfolioHtml,
  usedUiComponents,
} from "../src/render";

/**
 * The portfolio-summary + pnl-chart fragments are registered by the integrator;
 * tests inject a throwaway registry so the composition path is exercised
 * without touching `registry.data.json`. Ports 4213/4214 are the next free hosts
 * after the markets fragment (4212).
 */
const SUMMARY_PORT = "4213";
const CHART_PORT = "4214";

const TEST_REGISTRY: FragmentRegistry = {
  fragments: {
    "portfolio-summary": {
      canary: {
        version: "0.1.0",
        serviceUrl: `http://localhost:${SUMMARY_PORT}`,
        manifestUrl: `http://localhost:${SUMMARY_PORT}/manifest`,
      },
    },
    "pnl-chart": {
      canary: {
        version: "0.1.0",
        serviceUrl: `http://localhost:${CHART_PORT}`,
        manifestUrl: `http://localhost:${CHART_PORT}/manifest`,
      },
    },
  },
};

const SAMPLE_SUMMARY_HTML =
  '<section data-fragment="portfolio-summary">' +
  "<dl><dt>Equity</dt><dd>12,480.20</dd>" +
  "<dt>Margin usage</dt><dd>34%</dd>" +
  "<dt>PnL</dt><dd>+157.05</dd></dl></section>";

const SAMPLE_CHART_HTML =
  '<section data-fragment="pnl-chart">' +
  '<svg role="img" aria-label="Cumulative PnL"></svg></section>';

function portOf(url: string): string {
  const match = url.match(/:(\d+)\//);
  return match?.[1] ?? "";
}

/** Mock fetch returning each portfolio fragment's sample HTML by port. */
function makePortfolioFetch(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const port = portOf(String(url));
    const html =
      port === SUMMARY_PORT
        ? SAMPLE_SUMMARY_HTML
        : port === CHART_PORT
          ? SAMPLE_CHART_HTML
          : null;
    if (html === null) throw new Error(`unexpected port ${port}`);
    return new Response(
      JSON.stringify({
        html,
        assets: { js: [], css: [] },
        cache: {
          ttl: 5,
          tags: [port === SUMMARY_PORT ? "portfolio-summary" : "pnl-chart"],
        },
        metadata: {
          name: port === SUMMARY_PORT ? "portfolio-summary" : "pnl-chart",
          version: "0.1.0",
        },
      }),
    );
  }) as typeof fetch;
}

describe("page-portfolio", () => {
  beforeEach(() => {
    clearFragmentCache();
  });

  it("SSR HTML is no-JS readable and carries SEO copy", () => {
    const html = renderPortfolioHtml();
    expect(html).toContain('data-page="portfolio"');
    expect(html).toContain(portfolioSeoCopy.title);
    // No fragment data present -> readable, no-JS fallbacks (not a hard blank).
    expect(html).toContain("Portfolio summary is loading.");
    expect(html).toContain("PnL chart is loading.");
  });

  it("renders the portfolio layout regions from 01-ui-layout.md §4.4", () => {
    const html = renderPortfolioHtml();
    for (const area of [
      "portfolio-head",
      "portfolio-summary",
      "portfolio-chart",
      "portfolio-holdings",
    ]) {
      expect(html).toContain(`data-area="${area}"`);
    }
    expect(html).toContain(`class="${PORTFOLIO_LAYOUT_CLASS}"`);
    expect(html).toContain('data-slot="portfolioSummary"');
    expect(html).toContain('data-slot="pnlChart"');
  });

  it("renders live fragment HTML into both slots when provided", () => {
    const html = renderPortfolioHtml({
      portfolioSummary: SAMPLE_SUMMARY_HTML,
      pnlChart: SAMPLE_CHART_HTML,
    });
    expect(html).toContain("12,480.20");
    expect(html).toContain('aria-label="Cumulative PnL"');
    // Fallback text is gone once the fragments resolved.
    expect(html).not.toContain("Portfolio summary is loading.");
    expect(html).not.toContain("PnL chart is loading.");
  });

  it("metadata includes title and description", () => {
    expect(metadata).toMatchObject({
      title: portfolioPageManifest.seo.title,
      description: portfolioPageManifest.seo.description,
    });
    expect(portfolioSeoCopy.title).toBe(portfolioPageManifest.seo.title);
  });

  it("page manifest passes validation and lists 2 slots", () => {
    expect(validatePortfolioPageManifest()).toBe(true);
    expect(portfolioPageManifest.slots).toHaveLength(2);

    const summary = portfolioPageManifest.slots[0];
    expect(summary.name).toBe("portfolioSummary");
    expect(summary.fragment).toBe("portfolio-summary");
    expect(summary.strategy).toBe("dynamic-ssr");
    expect(summary.required).toBe(true);

    const chart = portfolioPageManifest.slots[1];
    expect(chart.name).toBe("pnlChart");
    expect(chart.fragment).toBe("pnl-chart");
    expect(chart.strategy).toBe("ttl-cache");
    expect(chart.required).toBe(false);
  });

  it("declares page budget within 180KB JS / 50KB CSS and UI usage", () => {
    expect(portfolioPageBudget.scope).toBe("page");
    expect(portfolioPageBudget.jsBytes).toBeLessThanOrEqual(180000);
    expect(portfolioPageBudget.cssBytes).toBeLessThanOrEqual(50000);
    expect(usedUiComponents).toContain("DataTable");
  });

  it("health route returns page-portfolio ok", async () => {
    const res = await healthGet();
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      service: "page-portfolio",
    });
  });

  it("composes both slots through the registry render endpoint", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return makePortfolioFetch()(url);
    }) as typeof fetch;

    const result = await fetchPortfolioFragmentSlots({
      registry: TEST_REGISTRY,
      fetchImpl,
      headers: new Headers({ "x-trace-id": "trace-portfolio" }),
    });

    // Both canary ports were hit at /render.
    const ports = calls.map(portOf).sort();
    expect(ports).toEqual([SUMMARY_PORT, CHART_PORT].sort());
    expect(calls.every((c) => c.includes("/render"))).toBe(true);

    expect(result.slots.portfolioSummary).toContain("12,480.20");
    expect(result.slots.pnlChart).toContain('aria-label="Cumulative PnL"');
    expect(result.diagnostics.portfolioSummary).toMatchObject({
      status: "ok",
      strategy: "dynamic-ssr",
      required: true,
    });
    expect(result.diagnostics.pnlChart).toMatchObject({
      status: "ok",
      strategy: "ttl-cache",
      required: false,
    });
    expect(result.scheduler.health).toBe("ok");
    expect(Array.isArray(result.scheduler.hints)).toBe(true);
    expect(result.traceLog).toContain("runtime.fetchFragmentSlots");
    expect(result.traceLog).toContain("slot:portfolioSummary");
    expect(result.traceLog).toContain("slot:pnlChart");
  });

  it("degrades readably when fragments are not registered (empty registry)", async () => {
    // Inject an empty registry so both slots are unresolved -> readable
    // fallback; the required summary makes the page unhealthy without throwing.
    const result = await fetchPortfolioFragmentSlots({
      registry: { fragments: {} },
      fetchImpl: makePortfolioFetch(),
      timeoutMs: 20,
    });

    expect(result.diagnostics.portfolioSummary.status).toBe("fallback");
    expect(result.slots.portfolioSummary).toContain('data-fallback="true"');
    expect(result.diagnostics.pnlChart.status).toBe("fallback");
    expect(result.slots.pnlChart).toContain('data-fallback="true"');
    // Required summary unresolved -> page unhealthy.
    expect(result.scheduler.health).toBe("unhealthy");
  });

  it("degrades (not breaks) when a fragment fetch fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("portfolio fragment down");
    }) as typeof fetch;

    const result = await fetchPortfolioFragmentSlots({
      registry: TEST_REGISTRY,
      fetchImpl,
      timeoutMs: 20,
    });

    expect(result.diagnostics.portfolioSummary.status).toBe("fallback");
    expect(result.slots.portfolioSummary).toContain('data-fallback="true"');
    expect(result.diagnostics.pnlChart.status).toBe("fallback");
    expect(result.slots.pnlChart).toContain('data-fallback="true"');
    expect(result.scheduler.health).toBe("unhealthy");
  });

  it("full page HTML renders fetched fragment content into both regions", async () => {
    const result = await fetchPortfolioFragmentSlots({
      registry: TEST_REGISTRY,
      fetchImpl: makePortfolioFetch(),
    });
    const html = renderPortfolioHtml({
      portfolioSummary: result.slots.portfolioSummary,
      pnlChart: result.slots.pnlChart,
    });

    expect(html).toContain('data-page="portfolio"');
    expect(html).toContain("12,480.20");
    expect(html).toContain('data-area="portfolio-summary"');
    expect(html).toContain('data-area="portfolio-chart"');
  });
});
