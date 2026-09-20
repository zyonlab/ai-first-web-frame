import { describe, expect, it } from "vitest";
import {
  buildFragmentProxyUrl,
  FRAGMENT_PROXY_PREFIX,
  parseFragmentProxyPath,
  resolveFragmentProxy,
} from "./fragmentProxy";

describe("parseFragmentProxyPath", () => {
  it("splits fragment, target and the remaining path", () => {
    expect(
      parseFragmentProxyPath(
        `${FRAGMENT_PROXY_PREFIX}/order-form/quotes/BTC/1m`,
      ),
    ).toEqual({ fragment: "order-form", target: "quotes", rest: "BTC/1m" });
  });

  it("allows an empty remainder (the target root)", () => {
    expect(
      parseFragmentProxyPath(`${FRAGMENT_PROXY_PREFIX}/order-form/quotes`),
    ).toEqual({ fragment: "order-form", target: "quotes", rest: "" });
  });

  it("rejects anything that is not a complete fragment+target pair", () => {
    for (const path of [
      "/other/order-form/quotes",
      `${FRAGMENT_PROXY_PREFIX}/order-form`,
      `${FRAGMENT_PROXY_PREFIX}/`,
      FRAGMENT_PROXY_PREFIX,
    ]) {
      expect(parseFragmentProxyPath(path)).toBeNull();
    }
  });

  it("rejects traversal segments outright so the reason stays legible", () => {
    expect(
      parseFragmentProxyPath(
        `${FRAGMENT_PROXY_PREFIX}/order-form/../secrets/x`,
      ),
    ).toBeNull();
  });
});

describe("buildFragmentProxyUrl", () => {
  it("joins the remainder onto the declared base", () => {
    expect(
      buildFragmentProxyUrl("https://quotes.internal/v1", "BTC", "?limit=5"),
    ).toBe("https://quotes.internal/v1/BTC?limit=5");
  });

  it("targets the base itself — with no added trailing slash — for an empty remainder", () => {
    // `/account` and `/account/` are DIFFERENT routes in Fastify (200 vs 404),
    // so an empty remainder must not be turned into a directory request.
    expect(buildFragmentProxyUrl("https://quotes.internal/v1", "")).toBe(
      "https://quotes.internal/v1",
    );
    expect(
      buildFragmentProxyUrl("https://quotes.internal/v1", "", "?a=1"),
    ).toBe("https://quotes.internal/v1?a=1");
    // A base that genuinely IS a directory keeps its slash.
    expect(buildFragmentProxyUrl("https://quotes.internal/v1/", "")).toBe(
      "https://quotes.internal/v1/",
    );
  });

  it("resolves a root-relative target against the declaring fragment's serviceUrl", () => {
    expect(
      buildFragmentProxyUrl("/account", "", "", "http://order-form:4205"),
    ).toBe("http://order-form:4205/account");
    expect(
      buildFragmentProxyUrl(
        "/account",
        "history",
        "",
        "http://order-form:4205",
      ),
    ).toBe("http://order-form:4205/account/history");
    // Without a serviceUrl a relative target is unresolvable, never guessed.
    expect(buildFragmentProxyUrl("/account", "")).toBeNull();
    // And it still cannot escape the declared base.
    expect(
      buildFragmentProxyUrl(
        "/account",
        "../admin",
        "",
        "http://order-form:4205",
      ),
    ).toBeNull();
  });

  it("never escapes the declared base path", () => {
    // The target comes from a trusted manifest; the remainder comes from the
    // browser, so the base is the boundary that has to hold.
    expect(
      buildFragmentProxyUrl("https://quotes.internal/v1", "../admin"),
    ).toBeNull();
    expect(
      buildFragmentProxyUrl("https://quotes.internal/v1", "//evil.example/x"),
    ).toBeNull();
    expect(
      buildFragmentProxyUrl(
        "https://quotes.internal/v1",
        "https://evil.example/x",
      ),
    ).toBeNull();
  });

  it("refuses a non-http(s) or malformed target", () => {
    expect(buildFragmentProxyUrl("file:///etc/passwd", "x")).toBeNull();
    expect(buildFragmentProxyUrl("not a url", "x")).toBeNull();
  });
});

describe("resolveFragmentProxy", () => {
  const targets = (fragment: string) =>
    fragment === "order-form" ? { quotes: "https://quotes.internal/v1" } : null;

  it("resolves a declared target to an upstream URL", () => {
    expect(
      resolveFragmentProxy({
        pathname: `${FRAGMENT_PROXY_PREFIX}/order-form/quotes/BTC`,
        search: "?depth=10",
        proxyTargets: targets,
      }),
    ).toEqual({ ok: true, url: "https://quotes.internal/v1/BTC?depth=10" });
  });

  it("distinguishes unknown fragment from unknown target", () => {
    expect(
      resolveFragmentProxy({
        pathname: `${FRAGMENT_PROXY_PREFIX}/ghost/quotes`,
        proxyTargets: targets,
      }),
    ).toEqual({ ok: false, reason: "unknown-fragment" });
    expect(
      resolveFragmentProxy({
        pathname: `${FRAGMENT_PROXY_PREFIX}/order-form/nope`,
        proxyTargets: targets,
      }),
    ).toEqual({ ok: false, reason: "unknown-target" });
  });

  it("reports a non-proxy path rather than guessing", () => {
    expect(
      resolveFragmentProxy({ pathname: "/markets", proxyTargets: targets }),
    ).toEqual({ ok: false, reason: "not-a-proxy-path" });
  });

  it("reports an unusable declared target", () => {
    expect(
      resolveFragmentProxy({
        pathname: `${FRAGMENT_PROXY_PREFIX}/bad/t/x`,
        proxyTargets: () => ({ t: "ftp://nope/" }),
      }),
    ).toEqual({ ok: false, reason: "invalid-target" });
  });
});
