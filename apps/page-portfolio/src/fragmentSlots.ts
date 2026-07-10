import type { FragmentRegistry } from "@mvp/contracts";
import { createRequestTrace } from "@mvp/observability";
import { fragmentRegistry } from "@mvp/registry";
import { createRequestContext } from "@mvp/request-context";
import {
  executeFragmentSlots,
  type FragmentSlotDefinition,
  type FragmentSlotResult,
  type PageHealth,
  type SchedulerHint,
} from "@mvp/runtime";

/** Slot keys composed on the portfolio page. */
export type PortfolioSlotKey = "portfolioSummary" | "pnlChart";

export type PortfolioSlotDiagnostic = Pick<
  FragmentSlotResult,
  "source" | "strategy"
> & {
  status: FragmentSlotResult["status"];
  required: boolean;
};

export type PortfolioFragmentHtml = {
  /** Rendered (or null) HTML per slot; null → render the panel fallback. */
  slots: Record<PortfolioSlotKey, string | null>;
  diagnostics: Record<PortfolioSlotKey, PortfolioSlotDiagnostic>;
  scheduler: {
    health: PageHealth;
    hints: SchedulerHint[];
  };
  traceLog: string;
};

type FetchPortfolioFragmentSlotsOptions = {
  headers?: Headers;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Override the fragment registry (tests inject one; empty forces degrade). */
  registry?: FragmentRegistry;
};

const PORTFOLIO_SLOT_KEYS: PortfolioSlotKey[] = [
  "portfolioSummary",
  "pnlChart",
];

/**
 * The page-portfolio runtime slots array, factored out of
 * `fetchPortfolioFragmentSlots` so it can be diffed against
 * `manifest.slots.json` without making a real network call (refactor plan
 * §3.4 drift check; see `apps/page-portfolio/tests/manifestSync.test.ts`).
 */
export function buildPortfolioSlotDefinitions(
  timeoutMs = 200,
): FragmentSlotDefinition[] {
  return [
    {
      name: "portfolioSummary",
      fragment: "portfolio-summary",
      channel: "canary",
      strategy: "dynamic-ssr",
      timeoutMs,
      // Required: equity/margin/PnL is the page headline — if it fails the
      // page is reported degraded/unhealthy, not silently empty.
      required: true,
      cachePolicy: {
        ttl: 0,
        tags: ["portfolio", "account"],
        vary: ["tenant", "props"],
      },
    },
    {
      name: "pnlChart",
      fragment: "pnl-chart",
      channel: "canary",
      strategy: "isr",
      timeoutMs,
      // Optional: a missing chart degrades to a placeholder without failing
      // the page.
      required: false,
      cachePolicy: {
        ttl: 60,
        tags: ["portfolio", "pnl"],
        vary: ["tenant", "locale", "props"],
      },
    },
  ];
}

/**
 * Compose the portfolio page's two fragment slots through the runtime
 * scheduler (doc 01 §4.4):
 *
 * - `portfolioSummary` (fragment `portfolio-summary`) — request-time
 *   `dynamic-ssr`: equity / margin usage / PnL are user-private and must not be
 *   cached, so they render fresh per request. Required: it is the page headline,
 *   so its failure reports the page degraded/unhealthy rather than silently
 *   empty.
 * - `pnlChart` (fragment `pnl-chart`) — `isr`: the cumulative PnL series is
 *   cache-friendly (revalidated on an interval), so it renders via ISR.
 *   Optional: a missing chart degrades to a readable placeholder without
 *   failing the page.
 *
 * When a fragment is not yet registered (or its service is down) the slot
 * degrades to a readable fallback instead of breaking the page. Tests inject a
 * throwaway `registry` (including an empty `{ fragments: {} }` to force the
 * not-registered path) so the real `registry.data.json` is never touched.
 */
export async function fetchPortfolioFragmentSlots({
  headers,
  fetchImpl,
  timeoutMs = 200,
  registry = fragmentRegistry,
}: FetchPortfolioFragmentSlotsOptions = {}): Promise<PortfolioFragmentHtml> {
  const ctx = createRequestContext({ headers });
  const trace = createRequestTrace({
    traceId: ctx.traceId,
    requestId: ctx.requestId,
  });

  const execution = await executeFragmentSlots({
    registry,
    ctx,
    fetchImpl,
    timeoutMs,
    trace,
    onRequiredFailure: "fallback",
    slots: buildPortfolioSlotDefinitions(timeoutMs),
  });

  const slots = {} as Record<PortfolioSlotKey, string | null>;
  const diagnostics = {} as Record<PortfolioSlotKey, PortfolioSlotDiagnostic>;
  for (const key of PORTFOLIO_SLOT_KEYS) {
    const result = execution.slots[key];
    slots[key] = result.response.html;
    diagnostics[key] = toDiagnostic(result);
  }

  return {
    slots,
    diagnostics,
    scheduler: {
      health: execution.health,
      hints: execution.hints,
    },
    traceLog: trace.toDependencyGraphLog(),
  };
}

function toDiagnostic(result: FragmentSlotResult): PortfolioSlotDiagnostic {
  return {
    source: result.source,
    strategy: result.strategy,
    status: result.status,
    required: result.slot.required ?? false,
  };
}
