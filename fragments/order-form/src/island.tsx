"use client";

import {
  createMockMatchingEngine,
  type HoveredPricePayload,
  type OrderDraftPricePayload,
  TRADE_HOVERED_PRICE,
  TRADE_LEVERAGE,
  TRADE_ORDER_DRAFT,
  TRADE_ORDER_DRAFT_PRICE,
  type TradeSlices,
} from "@mvp/interaction";
import type { TradeStore } from "@mvp/trade-client";
import { Slider } from "@mvp/ui/shadcn";
import { useEffect, useMemo, useState } from "react";
import {
  changeLeverage,
  foldOrderbookPrice,
  isDraftSubmittable,
  type OrderFormDraft,
  type OrderType,
  setOrderType,
  setReduceOnly,
  setSide,
  setSize,
  toPlaceOrderInput,
} from "./islandLogic";
import { submitOrder } from "./placeOrderFlow";
import type { OrderFormIslandProps } from "./render";

/**
 * The `order-form` island (contract C2 mount target).
 *
 * Mounted by `@mvp/trade-client` `mountIsland(el, { props, slice })` on the
 * `data-island="orderForm"` node the fragment emits (P3 does the real DOM
 * mount; P2 ships the component + pure-logic tests). It:
 *
 *  - subscribes to `trade.order-draft.price` (from an order-book row click) and
 *    folds it into the local draft via `foldOrderbookPrice`
 *    (frozen `applyOrderbookPrice`);
 *  - subscribes to `trade.hovered-price` (order-book hover) for a soft price
 *    hint on limit orders;
 *  - on a leverage-slider change, uses `changeLeverage` (frozen
 *    `applyLeverageChange`) to broadcast `trade.leverage` AND re-publish the
 *    full `trade.order-draft`;
 *  - on any draft change (side/type/size/reduce-only) re-publishes
 *    `trade.order-draft`;
 *  - on submit, runs the frozen `placeOrder` mutation through `submitOrder`
 *    (mock matching engine + `resolveUserTags({user})` inside `invalidate`).
 *
 * The store + data client are injected (never constructed here) so the island
 * stays SSR/test friendly and the page owns the single shared store/client.
 */
export type OrderFormIslandDeps = {
  /** Shared client store (from `createTradeStore(tradeStoreContracts, ...)`). */
  store: TradeStore<TradeSlices>;
  /** `ctx.user.id` used to resolve `{user}` invalidation tags. */
  userId: string;
  /**
   * Invalidates RESOLVED cache tags — wire to
   * `tradeDataClient.mutateData(resolvedTags)`. Optional in tests.
   */
  invalidate?: (resolvedTags: string[]) => void | Promise<void>;
  /** Injectable matching engine (defaults to the deterministic mock). */
  engine?: ReturnType<typeof createMockMatchingEngine>;
};

export type OrderFormIslandComponentProps = OrderFormIslandProps & {
  slice?: string;
  deps: OrderFormIslandDeps;
};

/** Publishes the full draft on `trade.order-draft` (order-form is sole writer). */
async function publishDraft(
  store: TradeStore<TradeSlices>,
  draft: OrderFormDraft,
): Promise<void> {
  await store.set(TRADE_ORDER_DRAFT, {
    side: draft.side,
    price: draft.price,
    size: draft.size,
    leverage: draft.leverage,
    reduceOnly: draft.reduceOnly,
  });
}

export function OrderFormIsland({
  symbol,
  draft: initialDraft,
  account,
  deps,
}: OrderFormIslandComponentProps) {
  const { store, userId } = deps;
  const engine = useMemo(
    () => deps.engine ?? createMockMatchingEngine(),
    [deps.engine],
  );
  const [draft, setDraft] = useState<OrderFormDraft>(initialDraft);
  const [ack, setAck] = useState<string | null>(null);

  // Subscribe to order-book price clicks -> fold into the draft + re-publish.
  useEffect(() => {
    const unsubPrice = store.subscribe(
      TRADE_ORDER_DRAFT_PRICE,
      (payload: OrderDraftPricePayload) => {
        setDraft((current) => {
          const next = foldOrderbookPrice(current, payload);
          void publishDraft(store, next);
          return next;
        });
      },
    );
    const unsubHover = store.subscribe(
      TRADE_HOVERED_PRICE,
      (_payload: HoveredPricePayload) => {
        // Hover is a soft hint only; the draft is committed on click, so no
        // draft mutation here. Kept wired for the price-hint UI affordance.
      },
    );
    return () => {
      unsubPrice();
      unsubHover();
    };
  }, [store]);

  function commit(next: OrderFormDraft) {
    setDraft(next);
    void publishDraft(store, next);
  }

  function onLeverage(value: number) {
    const { payload, draft: next } = changeLeverage(draft, value);
    setDraft(next);
    // Broadcast leverage (account-bar subscribes) AND re-publish the draft.
    void store.set(TRADE_LEVERAGE, payload);
    void publishDraft(store, next);
  }

  async function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!isDraftSubmittable(draft)) return;
    const input = toPlaceOrderInput(symbol, draft);
    const outcome = await submitOrder(input, {
      mutate: engine.place,
      userId,
      invalidate: deps.invalidate ?? (() => {}),
    });
    setAck(`${outcome.result.status} (${outcome.result.orderId})`);
  }

  const submittable = isDraftSubmittable(draft);

  return (
    <form className="of-form" data-of-form onSubmit={onSubmit}>
      <div className="of-side" role="tablist" aria-label="Order side">
        <button
          type="button"
          role="tab"
          aria-selected={draft.side === "buy"}
          data-side="buy"
          onClick={() => commit(setSide(draft, "buy"))}
        >
          Buy
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={draft.side === "sell"}
          data-side="sell"
          onClick={() => commit(setSide(draft, "sell"))}
        >
          Sell
        </button>
      </div>

      <div className="of-type" role="tablist" aria-label="Order type">
        {(["market", "limit"] as OrderType[]).map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={draft.type === type}
            data-type={type}
            onClick={() => commit(setOrderType(draft, type))}
          >
            {type === "market" ? "Market" : "Limit"}
          </button>
        ))}
      </div>

      {draft.type === "limit" ? (
        <label className="of-field of-price" data-of-price>
          <span>Price</span>
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={draft.price ?? ""}
            onChange={(e) =>
              commit({
                ...draft,
                price:
                  e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
        </label>
      ) : null}

      <label className="of-field of-size">
        <span>Size</span>
        <input
          type="number"
          step="any"
          inputMode="decimal"
          value={draft.size ?? ""}
          onChange={(e) =>
            commit(
              setSize(
                draft,
                e.target.value === "" ? undefined : Number(e.target.value),
              ),
            )
          }
        />
      </label>

      <div className="of-field of-leverage">
        <span>
          Leverage <strong data-of-leverage-value>{draft.leverage}x</strong>
        </span>
        <Slider
          min={1}
          max={100}
          step={1}
          value={[draft.leverage]}
          onValueChange={(values: number[]) => onLeverage(values[0] ?? 1)}
          data-of-leverage
        />
      </div>

      <label className="of-field of-reduce-only">
        <input
          type="checkbox"
          checked={draft.reduceOnly}
          onChange={(e) => commit(setReduceOnly(draft, e.target.checked))}
        />
        <span>Reduce only</span>
      </label>

      <dl className="of-margin" data-of-margin>
        <div>
          <dt>Equity</dt>
          <dd data-of-equity>{account.equity}</dd>
        </div>
        <div>
          <dt>Used margin</dt>
          <dd data-of-used>{account.used}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd data-of-free>{account.free}</dd>
        </div>
      </dl>

      <button
        type="submit"
        className={`of-submit of-submit-${draft.side}`}
        data-of-submit
        disabled={!submittable}
      >
        {draft.side === "buy" ? "Buy" : "Sell"} {symbol}
      </button>

      {ack ? (
        <p className="of-ack" role="status" data-of-ack>
          {ack}
        </p>
      ) : null}
    </form>
  );
}
