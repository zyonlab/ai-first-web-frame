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
  type FragmentSlotsExecution,
  type PageHealth,
  type SchedulerHint,
} from "@mvp/runtime";
import { fragmentSlots as generatedTradeSlots } from "./fragmentSlots.gen";

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
  /** Per-slot resolved HTML; null → render the panel fallback. */
  html: Record<TradeSlotKey, string | null>;
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
  // Raw scheduler output, keyed by slot name — feeds `<FragmentSlot>`
  // (`@mvp/runtime/react`) directly so `app/trade/[symbol]/page.tsx` never
  // hand-writes a per-slot `dangerouslySetInnerHTML` block (refactor plan
  // §3.3). Added additively, mirroring page-home's wrapper.
  execution: FragmentSlotsExecution;
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
 * The page-trade runtime slots array. The static shape (fragment, channel,
 * strategy, cachePolicy, dataDependencies, required) is generated from
 * `manifest.slots.json` by `scripts/mount-slot.mts` (refactor plan §3.2 — see
 * `./fragmentSlots.gen.ts`, regenerate via `pnpm exec tsx
 * scripts/mount-slot.mts --page page-trade --slot <name> --fragment
 * <fragment> [...flags]`).
 *
 * Unlike page-home, every slot on this page also needs a per-request value —
 * `props.symbol`, the active route symbol — that genuinely cannot be captured
 * as a manifest fact (it varies per request, not per deployment). This is a
 * new escape hatch beyond what page-home's wrapper needed: `mount-slot`
 * registered only the STATIC portion of each slot (fragment/channel/strategy/
 * timeoutMs/required/cachePolicy/dataDependencies — no `--props`), and this
 * function merges the per-request `timeoutMs` override and `props` onto every
 * generated slot before scheduling. `timeoutMs` is also kept as a per-request
 * override (tests pass a short timeout to keep failure cases fast), mirroring
 * page-home's pattern. None of this page's slots use strategy "static", so
 * every generated slot gets both overrides unconditionally.
 *
 * Factored out of `fetchTradeFragmentSlots` so it can be diffed against
 * `manifest.slots.json` without making a real network call (refactor plan
 * §3.4 drift check; see `apps/page-trade/tests/manifestSync.test.ts`) — the
 * drift check only compares fragment/channel/strategy/timeoutMs/required, so
 * it's unaffected by how `props` is threaded in. A default symbol keeps the
 * drift check callable with no arguments.
 */
export function buildTradeSlotDefinitions(
  timeoutMs = 200,
  props: { symbol: string } = { symbol: "BTC" },
): FragmentSlotDefinition[] {
  return generatedTradeSlots.map((slot) => ({ ...slot, timeoutMs, props }));
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
    html,
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
    execution,
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
