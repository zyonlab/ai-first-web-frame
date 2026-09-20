import { DataDependencySchema, type RequestContext } from "@mvp/contracts";
import {
  createDataKey,
  createMemorySubscriptionTransport,
  type DataSource,
  defineDataSource,
} from "@mvp/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountMarginSchema,
  accountSource,
  createTradeDataClient,
  FIXTURE_SEED,
  GLOBAL_SOURCE_IDS,
  mockTransportFor,
  normalizeSymbol,
  orderbookSource,
  parseSourceId,
  positionsSource,
  registryEntryFor,
  sourceIds,
  tickerSource,
  tradeSourceRegistry,
} from "./index";

const ctx: RequestContext = {
  traceId: "trace-sources",
  requestId: "req-sources",
  locale: "en-US",
  tenant: "tenant-a",
  featureFlags: {},
  experiment: { bucket: "a" },
  extensions: {},
  theme: "system",
  device: "desktop",
  user: { id: "user-1" },
  userAgent: "vitest",
  timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
};

// ---------------------------------------------------------------------------
// C5 — source id construction + registry
// ---------------------------------------------------------------------------

describe("source id registry (C5)", () => {
  it("builds canonical symbol-scoped ids", () => {
    expect(sourceIds.bookL2("btc")).toBe("book.l2.BTC");
    expect(sourceIds.ticker("eth")).toBe("ticker.ETH");
    expect(sourceIds.trades("BTC")).toBe("trades.BTC");
    expect(sourceIds.candles("btc", "1M")).toBe("candles.BTC.1m");
    expect(sourceIds.candlesHistory("btc", "5m")).toBe(
      "candles.history.BTC.5m",
    );
    expect(sourceIds.funding("sol")).toBe("funding.SOL");
    expect(sourceIds.symbolMeta("btc")).toBe("symbol.meta.BTC");
    expect(sourceIds.leverageTiers("btc")).toBe("leverage.tiers.BTC");
  });

  it("exposes stable global ids", () => {
    expect(sourceIds.positions).toBe("positions");
    expect(sourceIds.account).toBe("account");
    expect(sourceIds.marketsIndex).toBe("markets.index");
    expect(GLOBAL_SOURCE_IDS).toContain("session.wallet");
  });

  it("rejects empty symbol / interval", () => {
    expect(() => sourceIds.bookL2("  ")).toThrow();
    expect(() => sourceIds.candles("btc", "")).toThrow();
  });

  it("round-trips ids through parseSourceId", () => {
    expect(parseSourceId(sourceIds.bookL2("BTC"))).toEqual({
      kind: "book.l2",
      symbol: "BTC",
    });
    expect(parseSourceId(sourceIds.candles("ETH", "15m"))).toEqual({
      kind: "candles.live",
      symbol: "ETH",
      interval: "15m",
    });
    expect(parseSourceId(sourceIds.candlesHistory("ETH", "1h"))).toEqual({
      kind: "candles.history",
      symbol: "ETH",
      interval: "1h",
    });
    expect(parseSourceId("positions")).toEqual({ kind: "positions" });
    expect(parseSourceId("not-a-source")).toBeUndefined();
  });

  it("does not confuse candles.live with candles.history", () => {
    // history has an extra segment; the live regex must not swallow it.
    const parsed = parseSourceId(sourceIds.candles("BTC", "1m"));
    expect(parsed?.kind).toBe("candles.live");
  });

  it("registry entry lookup resolves by kind", () => {
    const entry = registryEntryFor(sourceIds.bookL2("BTC"));
    expect(entry?.kind).toBe("book.l2");
    expect(entry?.subscribable).toBe(true);
    expect(registryEntryFor("account")?.updateMode).toBe("request-time");
    expect(registryEntryFor("nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Freshness / privacy / cache validity against the contract
// ---------------------------------------------------------------------------

describe("source dependencies satisfy the contract (03 §1)", () => {
  const client = createTradeDataClient({ ctx });

  it("every source dependency parses through DataDependencySchema", () => {
    for (const symbol of ["BTC", "ETH"]) {
      for (const factory of [orderbookSource, tickerSource]) {
        const dep = factory(symbol).dependency;
        expect(() => DataDependencySchema.parse(dep)).not.toThrow();
      }
    }
  });

  it("realtime sources declare NO ttl (contract: realtime ≠ cache)", () => {
    const book = orderbookSource("BTC").dependency;
    expect(book.freshness).toBe("realtime");
    expect(book.cachePolicy).toBeUndefined();
    // A realtime dep WITH a ttl must be rejected by the schema.
    expect(() =>
      DataDependencySchema.parse({
        ...book,
        cachePolicy: { ttl: 5, tags: [], vary: [] },
      }),
    ).toThrow();
  });

  it("near-realtime funding carries funding tags", () => {
    expect(client).toBeDefined();
    const entry = registryEntryFor(sourceIds.funding("BTC"));
    expect(entry?.freshness).toBe("near-realtime");
    expect(entry?.invalidationTags).toContain("funding");
  });

  it("user-private realtime positions is never static and keys by user", () => {
    const dep = positionsSource().dependency;
    expect(dep.privacy).toBe("user-private");
    expect(dep.freshness).toBe("realtime");
    expect(() => DataDependencySchema.parse(dep)).not.toThrow();
    // user-private ⇒ createDataKey injects the user partition.
    const key = createDataKey(dep, ctx, { symbol: "BTC" });
    expect(key).toContain("user-1");
  });

  it("registry covers exactly the catalog kinds", () => {
    const kinds = new Set(tradeSourceRegistry.map((e) => e.kind));
    for (const k of [
      "book.l2",
      "trades",
      "ticker",
      "candles.live",
      "candles.history",
      "funding",
      "symbol.meta",
      "leverage.tiers",
      "positions",
      "orders",
      "account",
      "balances",
      "markets.index",
      "session.wallet",
    ]) {
      expect(kinds.has(k as never)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// C4 — read / subscribe via createTradeDataClient
// ---------------------------------------------------------------------------

describe("createTradeDataClient read + dedupe (C4)", () => {
  it("reads a near-realtime ticker snapshot", async () => {
    const client = createTradeDataClient({ ctx });
    const result = await client.readData(client.sourceIds.ticker("BTC"), {
      symbol: "BTC",
    });
    expect(result.source).toBe("loader");
    expect((result.data as { symbol: string }).symbol).toBe("BTC");
  });

  it("dedupes concurrent reads of the same key to ONE loader call (SSR pass)", async () => {
    // Wrap the ISR history source with a spy via extraSources.
    let calls = 0;
    const spied = symbolMetaSpy(() => {
      calls += 1;
    });
    const client = createTradeDataClient({ ctx, extraSources: [spied] });
    const [a, b] = await Promise.all([
      client.readData(spied.id, { symbol: "BTC" }),
      client.readData(spied.id, { symbol: "BTC" }),
    ]);
    expect(calls).toBe(1);
    // One is the real loader, the other is coalesced (pending) or cache.
    const sources = [a.source, b.source].sort();
    expect(sources).toContain("loader");
    expect(sources.some((s) => s === "pending" || s === "cache")).toBe(true);
  });

  it("caches an ISR source: second read within ttl is a cache hit", async () => {
    let calls = 0;
    const spied = symbolMetaSpy(() => {
      calls += 1;
    });
    const client = createTradeDataClient({ ctx, extraSources: [spied] });
    await client.readData(spied.id, { symbol: "BTC" });
    const second = await client.readData(spied.id, { symbol: "BTC" });
    expect(calls).toBe(1);
    expect(second.source).toBe("cache");
  });

  it("different symbols produce different cache keys (no cross-symbol reuse)", async () => {
    let btcCalls = 0;
    let ethCalls = 0;
    const btc = symbolMetaSpy(() => {
      btcCalls += 1;
    }, "spy.btc");
    const eth = symbolMetaSpy(() => {
      ethCalls += 1;
    }, "spy.eth");
    const client = createTradeDataClient({ ctx, extraSources: [btc, eth] });
    await client.readData(btc.id, { symbol: "BTC" });
    await client.readData(eth.id, { symbol: "ETH" });
    expect(btcCalls).toBe(1);
    expect(ethCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// H2 — opt-in payload validation (reference adoption: `account`)
// ---------------------------------------------------------------------------

describe("account responseSchema (H2 reference adoption)", () => {
  it("declares AccountMarginSchema and still loads the fixture snapshot", async () => {
    expect(accountSource().responseSchema).toBe(AccountMarginSchema);
    const client = createTradeDataClient({ ctx });
    const result = await client.readData(sourceIds.account);
    expect(AccountMarginSchema.safeParse(result.data).success).toBe(true);
  });

  it("rejects an upstream shape drift naming AccountMarginSchema", async () => {
    const base = accountSource();
    const drifted = {
      ...base,
      id: "account.drifted",
      dependency: { ...base.dependency, id: "account.drifted" },
      // Upstream drift: equity became a string.
      load: () => ({ equity: "1e5", used: 1, free: 1, maintenance: 1 }),
    } as DataSource<unknown, never>;
    const client = createTradeDataClient({ ctx, extraSources: [drifted] });
    await expect(client.readData("account.drifted")).rejects.toThrow(
      /"account\.drifted" response violates AccountMarginSchema — equity:/,
    );
  });
});

// A small ISR spy source reused across dedupe/cache tests.
function symbolMetaSpy(onLoad: () => void, id = "spy.meta") {
  return defineDataSource<{ symbol: string }, { symbol: string }>({
    id,
    dependency: {
      id,
      owner: "page",
      source: "api",
      freshness: "isr",
      privacy: "public",
      cachePolicy: { ttl: 300, tags: [id], vary: ["props"] },
      invalidationTags: [id],
      dependsOn: [],
    },
    load: (input) => {
      onLoad();
      return { symbol: input.params.symbol };
    },
  });
}

// ---------------------------------------------------------------------------
// Realtime subscription via mock transport
// ---------------------------------------------------------------------------

describe("realtime subscription through the mock transport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delivers frames only on change and stops after unsubscribe", async () => {
    const client = createTradeDataClient({ ctx });
    const received: unknown[] = [];
    const unsubscribe = client.subscribe(
      client.sourceIds.bookL2("BTC"),
      (event) => received.push(event.data),
      { params: { symbol: "BTC" }, intervalMs: 1000 },
    );

    // Delivery awaits writeSubscriptionCache, so flush microtasks via the async
    // timer advance.
    await vi.advanceTimersByTimeAsync(3000);
    expect(received.length).toBeGreaterThanOrEqual(1);
    const afterUnsub = received.length;
    unsubscribe();
    await vi.advanceTimersByTimeAsync(5000);
    expect(received.length).toBe(afterUnsub);
  });

  it("BTC and ETH subscriptions are isolated (different keys)", async () => {
    const client = createTradeDataClient({ ctx });
    const btc: unknown[] = [];
    const eth: unknown[] = [];
    const stopBtc = client.subscribe(
      client.sourceIds.trades("BTC"),
      (e) => btc.push(e.data),
      { params: { symbol: "BTC" }, intervalMs: 1000 },
    );
    const stopEth = client.subscribe(
      client.sourceIds.trades("ETH"),
      (e) => eth.push(e.data),
      { params: { symbol: "ETH" }, intervalMs: 1000 },
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(btc.length).toBeGreaterThan(0);
    expect(eth.length).toBeGreaterThan(0);
    // Frames carry their own symbol — no crossover.
    for (const frame of btc)
      expect((frame as { symbol: string }).symbol).toBe("BTC");
    for (const frame of eth)
      expect((frame as { symbol: string }).symbol).toBe("ETH");
    stopBtc();
    stopEth();
  });

  it("mockTransportFor returns undefined for non-transport sources", () => {
    expect(mockTransportFor(sourceIds.symbolMeta("BTC"))).toBeUndefined();
    expect(mockTransportFor(sourceIds.account)).toBeUndefined();
    expect(mockTransportFor(sourceIds.bookL2("BTC"))).toBeDefined();
  });

  it("explicit transport (memory) overrides the auto mock transport", async () => {
    const client = createTradeDataClient({ ctx });
    const transport = createMemorySubscriptionTransport();
    const received: unknown[] = [];
    const stop = client.subscribe(
      client.sourceIds.ticker("BTC"),
      (e) => received.push(e.data),
      { params: { symbol: "BTC" }, transport },
    );
    // Delivery is async (awaits writeSubscriptionCache); flush microtasks.
    transport.publish({ channel: "ticker.mark", symbol: "BTC", mark: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toHaveLength(1);
    // Identical frame is de-duped by subscribeData's lastSerialized guard.
    transport.publish({ channel: "ticker.mark", symbol: "BTC", mark: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toHaveLength(1);
    stop();
  });
});

describe("misc helpers", () => {
  it("normalizeSymbol uppercases and trims", () => {
    expect(normalizeSymbol("  btc ")).toBe("BTC");
  });
  it("fixture seed is exported for deterministic transports", () => {
    expect(FIXTURE_SEED).toBe(1337);
  });
});
