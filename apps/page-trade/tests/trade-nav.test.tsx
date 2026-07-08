import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The trade page renders the shared `AppNav` inside its own React tree (it owns
 * the active symbol, so `currentPath`/`lastSymbol` deep-link Trade correctly).
 * This is what keeps hydration byte-consistent and fixes React #418. We mock the
 * fragment fetch + the client hydrator so the test focuses on the nav + theme.
 */

let cookieHeader = "";

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(cookieHeader ? { cookie: cookieHeader } : {}),
}));

// The client hydration boundary renders nothing server-side; stub it so the
// test doesn't pull the whole island/runtime graph.
vi.mock("../src/hydrate", () => ({
  TradeHydrator: () => null,
}));

vi.mock("../src/fragmentSlots", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/fragmentSlots")>();
  return {
    ...actual,
    fetchTradeFragmentSlots: async ({ symbol }: { symbol: string }) => ({
      symbol,
      slots: {},
      diagnostics: {},
      dataDiagnostics: {
        account: { firstRead: "loader", secondRead: "pending" },
      },
      scheduler: { health: "ok", hints: [] },
      traceLog: "trace",
    }),
  };
});

async function renderTradePage(symbol: string): Promise<string> {
  const { default: TradePage } = await import("../app/trade/[symbol]/page");
  const element = await TradePage({
    params: Promise.resolve({ symbol }),
  });
  return renderToStaticMarkup(element);
}

describe("page-trade — in-page AppNav", () => {
  beforeEach(() => {
    cookieHeader = "";
  });

  it("renders the shared nav with every primary link", async () => {
    const html = await renderTradePage("ETH");
    expect(html).toContain('data-shell-nav="true"');
    expect(html).toContain("MVP Perps");
    expect(html).toContain('href="/markets"');
    expect(html).toContain('href="/portfolio"');
    expect(html).toContain('href="/vaults"');
    expect(html).toContain('href="/referrals"');
  });

  it("deep-links Trade to the active symbol and marks it active", async () => {
    const html = await renderTradePage("ETH");
    expect(html).toContain('href="/trade/ETH"');
    expect(html).toMatch(/href="\/trade\/ETH"[^>]*aria-current="page"/);
  });

  it("reflects the theme cookie in the nav control", async () => {
    cookieHeader = "mvp_theme=dark";
    const html = await renderTradePage("BTC");
    // dark theme cycles to system on next toggle.
    expect(html).toContain("/_shell/theme?value=system");
  });
});
