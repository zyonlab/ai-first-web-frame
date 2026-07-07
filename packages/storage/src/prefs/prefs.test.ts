import type { RequestContext } from "@mvp/contracts";
import { createRequestContext } from "@mvp/request-context";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorageAdapter } from "../index";
import { createLayoutPrefs } from "./layout";
import {
  DEFAULT_LOCALE,
  readLocalePreference,
  resolveLocalePreference,
  writeLocalePreference,
} from "./locale";
import { createRecentSymbols } from "./recentSymbols";
import { createWatchlist } from "./watchlist";

function ctxFor(userId?: string): RequestContext {
  const base = createRequestContext({});
  return userId ? { ...base, user: { id: userId } } : base;
}

describe("locale preference", () => {
  it("round-trips under the fixed mvp_locale cookie name", () => {
    const { setCookie, cookieWrite } = writeLocalePreference("zh");
    expect(cookieWrite.name).toBe("mvp_locale");
    expect(setCookie.startsWith("mvp_locale=")).toBe(true);
    expect(readLocalePreference(setCookie.split(";")[0])).toBe("zh");
  });

  it("resolves cookie > Accept-Language > default", () => {
    // cookie wins
    expect(
      resolveLocalePreference({
        cookieHeader: "mvp_locale=zh",
        acceptLanguage: "en-US",
      }),
    ).toBe("zh");
    // no cookie -> negotiate header (q-weighted)
    expect(
      resolveLocalePreference({
        acceptLanguage: "fr;q=0.9, zh-CN;q=0.8, en;q=0.2",
      }),
    ).toBe("zh");
    // nothing -> default
    expect(resolveLocalePreference({})).toBe(DEFAULT_LOCALE);
  });

  it("normalizes BCP-47 tags and rejects unsupported languages", () => {
    expect(readLocalePreference("mvp_locale=zh")).toBe("zh");
    expect(readLocalePreference("mvp_locale=fr")).toBe(DEFAULT_LOCALE);
  });
});

describe("watchlist", () => {
  it("add is idempotent + uppercased; toggle + remove work", async () => {
    const wl = createWatchlist({ ctx: ctxFor("u1") });
    expect(await wl.add("btc")).toEqual(["BTC"]);
    expect(await wl.add("BTC")).toEqual(["BTC"]); // idempotent
    expect(await wl.add("eth")).toEqual(["BTC", "ETH"]);
    expect(await wl.has("eth")).toBe(true);
    expect(await wl.toggle("btc")).toEqual(["ETH"]); // present -> removed
    expect(await wl.remove("eth")).toEqual([]);
  });

  it("isolates partitions across users on a shared backend", async () => {
    const adapter = createMemoryStorageAdapter();
    const a = createWatchlist({ ctx: ctxFor("u1"), adapter });
    const b = createWatchlist({ ctx: ctxFor("u2"), adapter });
    await a.add("BTC");
    expect(await a.list()).toEqual(["BTC"]);
    expect(await b.list()).toEqual([]); // different user partition
  });
});

describe("recent symbols", () => {
  it("front-inserts, de-duplicates, and caps", async () => {
    const recent = createRecentSymbols({ ctx: ctxFor("u1"), maxSymbols: 3 });
    await recent.record("btc");
    await recent.record("eth");
    expect(await recent.record("sol")).toEqual(["SOL", "ETH", "BTC"]);
    // revisit moves to front, no duplicate
    expect(await recent.record("btc")).toEqual(["BTC", "SOL", "ETH"]);
    // cap drops the oldest
    expect(await recent.record("xrp")).toEqual(["XRP", "BTC", "SOL"]);
  });
});

describe("layout prefs", () => {
  it("writes, reads, and shallow-merges a blob (injected adapter)", async () => {
    const store = createLayoutPrefs({
      ctx: ctxFor("u1"),
      adapter: createMemoryStorageAdapter(),
    });
    await store.write({ bookCollapsed: true, columns: 3 });
    expect(await store.read()).toEqual({ bookCollapsed: true, columns: 3 });
    expect(await store.merge({ columns: 4 })).toEqual({
      bookCollapsed: true,
      columns: 4,
    });
  });
});

describe("policy safety", () => {
  it("watchlist is user-private and stays isolated for anonymous visitors", async () => {
    // anonymous (no user) falls back to a stable anon id, still partitioned.
    const adapter = createMemoryStorageAdapter();
    const anon = createWatchlist({ ctx: ctxFor(), adapter });
    await anon.add("BTC");
    const known = createWatchlist({ ctx: ctxFor("u1"), adapter });
    expect(await known.list()).toEqual([]);
  });
});
