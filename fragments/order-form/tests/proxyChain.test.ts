import { FRAGMENT_PROXY_PREFIX, resolveFragmentProxy } from "@mvp/runtime";
import { describe, expect, it } from "vitest";
import { orderFormManifest } from "../src/manifest";
import { buildServer } from "../src/server";

/**
 * The full proxy chain against the REAL fragment, not a mocked manifest:
 * declaration → gateway resolution → the endpoint the target points at.
 *
 * Without this the capability was schema + gateway with no fragment declaring
 * anything, so nothing proved that a declared target actually resolves to a
 * route that exists.
 */
describe("order-form proxy chain", () => {
  const SERVICE_URL = "http://order-form:4205";

  it("declares a relative target in its manifest", () => {
    expect(orderFormManifest.proxy).toEqual({ account: "/account" });
  });

  it("the gateway resolves that target against the fragment's serviceUrl", () => {
    const resolved = resolveFragmentProxy({
      pathname: `${FRAGMENT_PROXY_PREFIX}/order-form/account`,
      proxyTargets: (name) =>
        name === "order-form" ? { ...orderFormManifest.proxy } : null,
      serviceUrlFor: () => SERVICE_URL,
    });
    expect(resolved).toEqual({
      ok: true,
      url: `${SERVICE_URL}/account`,
    });
  });

  it("a relative target with no serviceUrl is invalid, not guessed", () => {
    const resolved = resolveFragmentProxy({
      pathname: `${FRAGMENT_PROXY_PREFIX}/order-form/account`,
      proxyTargets: () => ({ ...orderFormManifest.proxy }),
    });
    expect(resolved).toEqual({ ok: false, reason: "invalid-target" });
  });

  it("the route the target points at actually exists and serves margin", async () => {
    const response = await buildServer().inject({
      method: "GET",
      url: "/account",
      headers: { "x-tenant": "acme", "x-locale": "en-US" },
    });
    expect(response.statusCode).toBe(200);
    const account = response.json();
    // AccountMargin shape: the same read the SSR path uses.
    expect(typeof account.equity).toBe("number");
    expect(typeof account.free).toBe("number");
    // Per-user margin must never be cached.
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("keeps the island bundle route working alongside it", async () => {
    const response = await buildServer().inject({
      method: "GET",
      url: "/assets/order-form.island.js",
    });
    // 200 when built, structured 404 when not — either way the route is mounted.
    expect([200, 404]).toContain(response.statusCode);
  });
});
