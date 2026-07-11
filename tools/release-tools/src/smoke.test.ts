import { describe, expect, it } from "vitest";
import {
  createDefaultSmokeChecks,
  evaluateCheck,
  type HttpFetcher,
  runSmokeSuite,
  type SmokeCheck,
} from "./smoke";

const check = (overrides: Partial<SmokeCheck> = {}): SmokeCheck => ({
  id: "test-check",
  url: "http://localhost:4100/health",
  expectStatus: 200,
  expectSubstrings: ['"status":"ok"'],
  ...overrides,
});

describe("createDefaultSmokeChecks", () => {
  it("covers all five services plus composed shell routes", () => {
    const checks = createDefaultSmokeChecks();
    expect(checks.map((entry) => entry.id)).toEqual([
      "shell-gateway-health",
      "promotion-banner-health",
      "recommendation-widget-health",
      "page-home-health",
      "page-product-health",
      "shell-home-composed",
      "shell-product-composed",
    ]);
    for (const entry of checks) {
      expect(entry.url).toMatch(/^http:\/\/localhost:\d{4}\//);
      expect(entry.expectStatus).toBe(200);
      expect(entry.expectSubstrings.length).toBeGreaterThan(0);
    }
  });

  it("supports a custom host", () => {
    const [first] = createDefaultSmokeChecks("smoke-host");
    expect(first.url).toBe("http://smoke-host:4100/health");
  });
});

describe("evaluateCheck", () => {
  it("passes when status and substrings match", () => {
    const result = evaluateCheck(check(), {
      status: 200,
      body: '{"status":"ok","service":"shell-gateway"}',
    });
    expect(result).toEqual({ ok: true, missingSubstrings: [] });
  });

  it("fails on unexpected status", () => {
    const result = evaluateCheck(check(), { status: 502, body: "" });
    expect(result.ok).toBe(false);
    expect(result.missingSubstrings).toEqual(['"status":"ok"']);
  });

  it("reports missing marker substrings", () => {
    const result = evaluateCheck(
      check({
        expectSubstrings: ['data-page="home"', 'data-shell-gateway="true"'],
      }),
      { status: 200, body: '<main data-page="home"></main>' },
    );
    expect(result.ok).toBe(false);
    expect(result.missingSubstrings).toEqual(['data-shell-gateway="true"']);
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
      [check({ expectSubstrings: ['data-shell-gateway="true"'] })],
      fetcher,
      { timeoutMs: 1, intervalMs: 5, sleep: async () => {} },
    );

    expect(suite.ok).toBe(false);
    expect(suite.checks[0].status).toBe(200);
    expect(suite.checks[0].missingSubstrings).toEqual([
      'data-shell-gateway="true"',
    ]);
  });
});
