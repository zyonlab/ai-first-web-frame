import { describe, expect, it } from "vitest";
import {
  createDefaultSmokeChecks,
  deriveSmokeChecks,
  evaluateCheck,
  type HttpFetcher,
  runSmokeSuite,
  type SmokeCheck,
  type SmokeFragmentRegistryData,
  type SmokeRouteRegistryData,
} from "./smoke";

const check = (overrides: Partial<SmokeCheck> = {}): SmokeCheck => ({
  id: "test-check",
  url: "http://localhost:4100/health",
  expectStatus: 200,
  expectSubstrings: ['"status":"ok"'],
  ...overrides,
});

const ALL_FRAGMENTS = [
  "promotion-banner",
  "recommendation-widget",
  "market-header",
  "order-book",
  "order-form",
  "trades-feed",
  "account-bar",
  "positions-table",
  "open-orders",
  "funding-bar",
  "chart-panel",
  "markets-table",
  "portfolio-summary",
  "pnl-chart",
];

const ALL_PAGES = [
  "home",
  "product",
  "trade",
  "markets",
  "portfolio",
  "vaults",
  "referrals",
];

describe("deriveSmokeChecks", () => {
  const registry: SmokeFragmentRegistryData = {
    fragments: {
      "stable-only": { stable: { serviceUrl: "http://localhost:4201" } },
      "canary-only": { canary: { serviceUrl: "http://localhost:4203" } },
      "stable-and-canary": {
        stable: { serviceUrl: "http://localhost:4202" },
        canary: { serviceUrl: "http://localhost:9999" },
      },
      unresolvable: {},
    },
  };
  const routes: SmokeRouteRegistryData = {
    routes: [
      { id: "home", serviceUrl: "http://localhost:4101" },
      { id: "trade", serviceUrl: "http://localhost:4103" },
    ],
  };

  it("derives fragment health checks from the stable-or-canary serviceUrl", () => {
    const checks = deriveSmokeChecks(registry, routes);
    const byId = new Map(checks.map((entry) => [entry.id, entry]));
    expect(byId.get("stable-only-health")?.url).toBe(
      "http://localhost:4201/health",
    );
    expect(byId.get("canary-only-health")?.url).toBe(
      "http://localhost:4203/health",
    );
    // stable wins over canary when both channels exist
    expect(byId.get("stable-and-canary-health")?.url).toBe(
      "http://localhost:4202/health",
    );
    // entries with no resolvable channel produce no check
    expect(byId.has("unresolvable-health")).toBe(false);
  });

  it("derives page health checks from route serviceUrls with page markers", () => {
    const checks = deriveSmokeChecks(registry, routes);
    const trade = checks.find((entry) => entry.id === "page-trade-health");
    expect(trade?.url).toBe("http://localhost:4103/health");
    expect(trade?.expectSubstrings).toEqual(['"status":"ok"', "page-trade"]);
  });

  /**
   * The composed shell checks are the reason this exists. The gateway is a
   * transparent proxy (058f13b): it returns the page's HTML verbatim and injects
   * no marker, so only a header it stamps proves the request went through it.
   * This pins that the suite asks for the header and does NOT ask for the
   * long-removed `data-shell-gateway` marker — the drift that made docker-smoke
   * contradict the gateway's own unit test and both e2e specs.
   */
  it("requires the gateway trace header, not a body marker, on composed routes", () => {
    const checks = deriveSmokeChecks(registry, routes);
    for (const id of ["shell-home-composed", "shell-product-composed"]) {
      const composed = checks.find((entry) => entry.id === id);
      expect(composed?.expectHeaders).toEqual(["x-trace-id"]);
      expect(composed?.expectSubstrings.join(" ")).not.toContain(
        "data-shell-gateway",
      );
    }
  });

  it("keeps the shell health and composed shell-route marker checks", () => {
    const ids = deriveSmokeChecks(registry, routes).map((entry) => entry.id);
    expect(ids[0]).toBe("shell-gateway-health");
    expect(ids.slice(-2)).toEqual([
      "shell-home-composed",
      "shell-product-composed",
    ]);
  });

  it("applies the host override to every derived and fixed url", () => {
    const checks = deriveSmokeChecks(registry, routes, "smoke-host");
    for (const entry of checks) {
      expect(entry.url).toMatch(/^http:\/\/smoke-host:\d{4}\//);
    }
  });
});

describe("createDefaultSmokeChecks", () => {
  it("covers the full fleet: shell, all 14 fragments, all 7 pages, composed routes", () => {
    const checks = createDefaultSmokeChecks();
    expect(checks.map((entry) => entry.id)).toEqual([
      "shell-gateway-health",
      ...ALL_FRAGMENTS.map((name) => `${name}-health`),
      ...ALL_PAGES.map((id) => `page-${id}-health`),
      "shell-home-composed",
      "shell-product-composed",
    ]);
    expect(checks).toHaveLength(1 + 14 + 7 + 2);
    for (const entry of checks) {
      expect(entry.url).toMatch(/^http:\/\/localhost:\d{4}\//);
      expect(entry.expectStatus).toBe(200);
      expect(entry.expectSubstrings.length).toBeGreaterThan(0);
    }
  });

  it("supports a custom host", () => {
    const checks = createDefaultSmokeChecks("smoke-host");
    expect(checks[0].url).toBe("http://smoke-host:4100/health");
    for (const entry of checks) {
      expect(entry.url).toMatch(/^http:\/\/smoke-host:\d{4}\//);
    }
  });
});

describe("evaluateCheck", () => {
  it("passes when status and substrings match", () => {
    const result = evaluateCheck(check(), {
      status: 200,
      body: '{"status":"ok","service":"shell-gateway"}',
    });
    expect(result).toEqual({
      ok: true,
      missingSubstrings: [],
      missingHeaders: [],
    });
  });

  it("fails on unexpected status", () => {
    const result = evaluateCheck(check(), { status: 502, body: "" });
    expect(result.ok).toBe(false);
    expect(result.missingSubstrings).toEqual(['"status":"ok"']);
  });

  it("reports missing marker substrings", () => {
    const result = evaluateCheck(
      check({
        expectSubstrings: ['data-page="home"', 'data-absent-marker="1"'],
      }),
      { status: 200, body: '<main data-page="home"></main>' },
    );
    expect(result.ok).toBe(false);
    expect(result.missingSubstrings).toEqual(['data-absent-marker="1"']);
  });
});

describe("expectHeaders", () => {
  it("fails when an expected header is absent or empty", () => {
    const absent = evaluateCheck(
      check({ expectSubstrings: [], expectHeaders: ["x-trace-id"] }),
      { status: 200, body: "", headers: { "content-type": "text/html" } },
    );
    expect(absent.ok).toBe(false);
    expect(absent.missingHeaders).toEqual(["x-trace-id"]);

    const blank = evaluateCheck(
      check({ expectSubstrings: [], expectHeaders: ["x-trace-id"] }),
      { status: 200, body: "", headers: { "x-trace-id": "   " } },
    );
    expect(blank.ok).toBe(false);
    expect(blank.missingHeaders).toEqual(["x-trace-id"]);
  });

  it("passes on a present header, matching case-insensitively", () => {
    const result = evaluateCheck(
      check({ expectSubstrings: [], expectHeaders: ["X-Trace-Id"] }),
      { status: 200, body: "", headers: { "x-trace-id": "trace-1" } },
    );
    expect(result).toEqual({
      ok: true,
      missingSubstrings: [],
      missingHeaders: [],
    });
  });
});

describe("runSmokeSuite", () => {
  const immediateSleep = async () => {};

  it("passes once services become healthy and retries only failing checks", async () => {
    let attempts = 0;
    const fetcher: HttpFetcher = async (url) => {
      if (url.endsWith("/health")) {
        attempts += 1;
        if (attempts < 3) throw new Error("connection refused");
        return { status: 200, body: '{"status":"ok"}' };
      }
      return { status: 200, body: 'data-page="home"' };
    };

    const suite = await runSmokeSuite(
      [
        check({ id: "health", expectSubstrings: ['"status":"ok"'] }),
        check({
          id: "page",
          url: "http://localhost:4101/",
          expectSubstrings: ['data-page="home"'],
        }),
      ],
      fetcher,
      { timeoutMs: 60_000, intervalMs: 1, sleep: immediateSleep },
    );

    expect(suite.ok).toBe(true);
    const health = suite.checks.find((entry) => entry.id === "health");
    const page = suite.checks.find((entry) => entry.id === "page");
    expect(health?.attempts).toBe(3);
    expect(page?.attempts).toBe(1);
  });

  it("fails with captured errors when the deadline is reached", async () => {
    let clock = 0;
    const fetcher: HttpFetcher = async () => {
      throw new Error("connection refused");
    };

    const suite = await runSmokeSuite([check()], fetcher, {
      timeoutMs: 10,
      intervalMs: 5,
      sleep: async () => {},
      now: () => {
        clock += 4;
        return clock;
      },
    });

    expect(suite.ok).toBe(false);
    expect(suite.checks[0].ok).toBe(false);
    expect(suite.checks[0].error).toBe("connection refused");
    expect(suite.checks[0].attempts).toBeGreaterThanOrEqual(1);
  });

  it("fails when a marker string is missing at the deadline", async () => {
    const fetcher: HttpFetcher = async () => ({
      status: 200,
      body: "<html>no marker here</html>",
    });

    const suite = await runSmokeSuite(
      [check({ expectSubstrings: ['data-absent-marker="1"'] })],
      fetcher,
      { timeoutMs: 1, intervalMs: 5, sleep: async () => {} },
    );

    expect(suite.ok).toBe(false);
    expect(suite.checks[0].status).toBe(200);
    expect(suite.checks[0].missingSubstrings).toEqual([
      'data-absent-marker="1"',
    ]);
  });
});
