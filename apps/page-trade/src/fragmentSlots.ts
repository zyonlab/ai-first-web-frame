import {
  createDataClient,
  type DataReadResult,
  defineDataSource,
} from "@mvp/data";
import {
  createRequestTrace,
  type RequestTraceSnapshot,
} from "@mvp/observability";
import { fragmentRegistry } from "@mvp/registry";
import { createRequestContext } from "@mvp/request-context";
import {
  executeFragmentSlots,
  type FragmentSlotDefinition,
  type FragmentSlotResult,
  type PageHealth,
  type SchedulerHint,
} from "@mvp/runtime";

/**
 * Shared `account` data node (doc 02 §4): `order-form`, `positions-table`, and
 * `account-bar` all depend on it, so the scheduler resolves it once and both
 * dependent slots gate behind the single read. This deliberately exercises the
 * runtime's `duplicate-data-resolution` dedupe (as page-home does for
 * featured-content).
 */
const ACCOUNT_DATA_ID = "trade-account";

/** Slot keys composed on the trade page (one per registered canary fragment). */
export type TradeSlotKey =
  | "marketHeader"
  | "chart"
  | "book"
  | "trades"
  | "orderForm"
  | "positions"
  | "openOrders"
  | "accountBar"
  | "fundingBar";

export type TradeSlotDiagnostic = Pick<
  FragmentSlotResult,
  "source" | "strategy"
> & {
  status: FragmentSlotResult["status"];
  required: boolean;
};

export type TradeFragmentHtml = {
  symbol: string;
  /** Rendered (or null) HTML per slot; null → render the panel fallback. */
  slots: Record<TradeSlotKey, string | null>;
  diagnostics: Record<TradeSlotKey, TradeSlotDiagnostic>;
  dataDiagnostics: {
    account: {
      firstRead: string;
      secondRead: string;
    };
  };
  scheduler: {
    health: PageHealth;
    hints: SchedulerHint[];
  };
  traceLog: string;
  /** Structured span/edge snapshot for the diagnostics waterfall drawer. */
  traceSnapshot: RequestTraceSnapshot;
};

type FetchTradeFragmentSlotsOptions = {
  symbol?: string;
  headers?: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** Normalize a route symbol param (`eth` → `ETH`); default to BTC. */
export function normalizeSymbol(symbol: string | undefined | null): string {
  const trimmed = (symbol ?? "").trim();
  return (trimmed === "" ? "BTC" : trimmed).toUpperCase();
}

/**
 * The page-trade runtime slots array, factored out of
 * `fetchTradeFragmentSlots` so it can be diffed against
 * `manifest.slots.json` without making a real network call (refactor plan
 * §3.4 drift check; see `apps/page-trade/tests/manifestSync.test.ts`). `props`
 * only
 * carries the per-request symbol and is outside the manifest-comparable
 * contract, so a default symbol is fine for the drift check.
 */
export function buildTradeSlotDefinitions(
  timeoutMs = 200,
  props: { symbol: string } = { symbol: "BTC" },
): FragmentSlotDefinition[] {
  return [
    {
      name: "marketHeader",
      fragment: "market-header",
      channel: "canary",
      strategy: "cached-ssr",
      timeoutMs,
      // Required: the header carries mark/oracle/funding — if it fails the
      // page is reported unhealthy, not merely degraded.
      required: true,
      props,
      cachePolicy: {
        ttl: 5,
        tags: ["ticker", "trade"],
        vary: ["tenant", "locale", "props"],
      },
    },
    {
      name: "chart",
      fragment: "chart-panel",
      channel: "canary",
      strategy: "isr",
      timeoutMs,
      required: false,
      props,
      cachePolicy: {
        ttl: 60,
        tags: ["candles", "trade"],
        vary: ["locale", "props"],
      },
    },
    {
      name: "book",
      fragment: "order-book",
      channel: "canary",
      strategy: "dynamic-ssr",
      timeoutMs,
      required: false,
      props,
    },
    {
      name: "trades",
      fragment: "trades-feed",
      channel: "canary",
      strategy: "dynamic-ssr",
      timeoutMs,
      required: false,
      props,
    },
    {
      name: "orderForm",
      fragment: "order-form",
      channel: "canary",
      strategy: "dynamic-ssr",
      timeoutMs,
      required: false,
      // Shares the account read with positions + account-bar.
      dataDependencies: [ACCOUNT_DATA_ID],
      props,
    },
    {
      name: "positions",
      fragment: "positions-table",
      channel: "canary",
      strategy: "dynamic-ssr",
      timeoutMs,
      required: false,
      dataDependencies: [ACCOUNT_DATA_ID],
      props,
    },
    {
      name: "openOrders",
      fragment: "open-orders",
      channel: "canary",
      strategy: "dynamic-ssr",
      timeoutMs,
      required: false,
      props,
    },
    {
      name: "accountBar",
      fragment: "account-bar",
      channel: "canary",
      strategy: "dynamic-ssr",
      timeoutMs,
      required: false,
      dataDependencies: [ACCOUNT_DATA_ID],
      props,
    },
    {
      name: "fundingBar",
      fragment: "funding-bar",
      channel: "canary",
      strategy: "cached-ssr",
      timeoutMs,
      required: false,
      props,
      cachePolicy: {
        ttl: 30,
        tags: ["funding", "trade"],
        vary: ["locale", "props"],
      },
    },
  ];
}

export async function fetchTradeFragmentSlots({
  symbol,
  headers,
  fetchImpl,
  timeoutMs = 200,
}: FetchTradeFragmentSlotsOptions = {}): Promise<TradeFragmentHtml> {
  const activeSymbol = normalizeSymbol(symbol);
  const ctx = createRequestContext({ headers });
  const trace = createRequestTrace({
    traceId: ctx.traceId,
    requestId: ctx.requestId,
  });

  const accountSource = defineDataSource({
    id: ACCOUNT_DATA_ID,
    dependency: {
      id: ACCOUNT_DATA_ID,
      owner: "page",
      source: "server-function",
      freshness: "request-time",
      privacy: "user-private",
      cachePolicy: {
        ttl: 0,
        tags: ["trade", "account"],
        vary: ["tenant", "props"],
      },
      invalidationTags: ["trade:account"],
      dependsOn: [],
    },
    load: async () => ({
      equity: "12,480.20",
      marginUsed: "34%",
      withdrawable: "8,110.00",
    }),
  });
  const dataClient = createDataClient({ ctx, trace, sources: [accountSource] });

  // Shared read result for the account node: two concurrent reads prove
  // request-level dedupe (second observes the first read's in-flight loader).
  const accountReads: {
    first: DataReadResult<{ equity: string }> | null;
    second: DataReadResult<{ equity: string }> | null;
  } = { first: null, second: null };

  const props = { symbol: activeSymbol } as const;

  const execution = await executeFragmentSlots({
    registry: fragmentRegistry,
    ctx,
    fetchImpl,
    timeoutMs,
    trace,
    onRequiredFailure: "fallback",
    dataDependencies: [{ id: ACCOUNT_DATA_ID, dependsOn: [] }],
    resolveData: async (id) => {
      if (id !== ACCOUNT_DATA_ID)
        throw new Error(`unknown data dependency "${id}"`);
      const [first, second] = await Promise.all([
        dataClient.readData<{ equity: string }>(ACCOUNT_DATA_ID, {
          route: "trade",
        }),
        dataClient.readData<{ equity: string }>(ACCOUNT_DATA_ID, {
          route: "trade",
        }),
      ]);
      accountReads.first = first;
      accountReads.second = second;
      return first.data;
    },
    slots: buildTradeSlotDefinitions(timeoutMs, props),
  });

  const slots = execution.slots;
  const keys: TradeSlotKey[] = [
    "marketHeader",
    "chart",
    "book",
    "trades",
    "orderForm",
    "positions",
    "openOrders",
    "accountBar",
    "fundingBar",
  ];

  const html = {} as Record<TradeSlotKey, string | null>;
  const diagnostics = {} as Record<TradeSlotKey, TradeSlotDiagnostic>;
  for (const key of keys) {
    const result = slots[key];
    html[key] = result.response.html;
    diagnostics[key] = toDiagnostic(result);
  }

  return {
    symbol: activeSymbol,
    slots: html,
    diagnostics,
    dataDiagnostics: {
      account: {
        firstRead: accountReads.first?.source ?? "loader",
        secondRead: accountReads.second?.source ?? "pending",
      },
    },
    scheduler: {
      health: execution.health,
      hints: execution.hints,
    },
    traceLog: trace.toDependencyGraphLog(),
    traceSnapshot: trace.toJSON(),
  };
}

function toDiagnostic(result: FragmentSlotResult): TradeSlotDiagnostic {
  return {
    source: result.source,
    strategy: result.strategy,
    status: result.status,
    required: result.slot.required ?? false,
  };
}
