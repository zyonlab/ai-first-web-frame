"use client";

import { createInteractionBus, type InteractionBus } from "@mvp/interaction";
import { createRequestContext } from "@mvp/request-context";
import {
  type LeveragePayload,
  TRADE_LEVERAGE,
  tradeSliceContracts,
} from "@mvp/trade-contracts";
import { type AccountMargin, createTradeDataClient } from "@mvp/trade-data";
import { useEffect, useMemo, useReducer } from "react";
import {
  type AccountBarView,
  computeMarginPreview,
  type MarginPreview,
  toAccountBarView,
} from "./data";
import type { AccountBarIslandProps } from "./render";

/** This island's declared subscriber identity on the interaction bus (C3). */
export const ACCOUNT_BAR_SUBSCRIBER = "account-bar" as const;

/**
 * Island reducer state: the current account view + the leverage-driven margin
 * preview. Pure and serializable so it can resume from the SSR snapshot with
 * zero flash.
 */
export type IslandState = {
  view: AccountBarView;
  leverage: number;
  preview: MarginPreview;
};

export type IslandAction =
  | { type: "leverage"; leverage: number }
  | { type: "account"; account: AccountMargin };

/**
 * Pure island reducer (unit-tested in `island.logic.test.ts`).
 *
 *  - `leverage`: recompute only the margin preview against the current view
 *    (C3 flow B — order-form broadcasts `TRADE_LEVERAGE`; the preview updates
 *    with no page re-render). A no-op leverage returns the same state ref.
 *  - `account`: a realtime margin patch replaces the view and re-derives the
 *    preview at the current leverage.
 */
export function islandReducer(
  state: IslandState,
  action: IslandAction,
): IslandState {
  switch (action.type) {
    case "leverage": {
      if (action.leverage === state.leverage) return state;
      return {
        ...state,
        leverage: action.leverage,
        preview: computeMarginPreview(state.view, action.leverage),
      };
    }
    case "account": {
      const view = toAccountBarView(action.account);
      return {
        ...state,
        view,
        preview: computeMarginPreview(view, state.leverage),
      };
    }
    default:
      return state;
  }
}

/** Builds the initial reducer state from the SSR snapshot props. */
export function initialIslandState(props: AccountBarIslandProps): IslandState {
  return {
    view: props.view,
    leverage: props.seededLeverage,
    preview: computeMarginPreview(props.view, props.seededLeverage),
  };
}

/**
 * The small account-bar island. Only this component re-renders on a leverage
 * change or a realtime margin patch; the surrounding SSR fragment stays static.
 * Mounts through `@mvp/islands`
 * (`registerIsland("accountBar", AccountBarIsland)`), reading its props from the
 * inline JSON snapshot.
 *
 * Behaviour:
 *  - subscribes to `TRADE_LEVERAGE` (C3): on a leverage change from the
 *    order-form it recomputes the margin preview (projected margin / withdrawable
 *    / usage) via the pure `computeMarginPreview`;
 *  - subscribes to `account` via the C4 client (realtime margin) and patches the
 *    committed equity / margin-used / withdrawable numbers. (P2 wires the pure
 *    logic; the live transport for `account` is a placeholder — the request-time
 *    seed stands in until P3 attaches the realtime margin feed.)
 */
export function AccountBarIsland(
  props: AccountBarIslandProps & { bus?: InteractionBus },
) {
  const [state, dispatch] = useReducer(
    islandReducer,
    props,
    initialIslandState,
  );

  const client = useMemo(() => {
    const ctx = createRequestContext();
    return createTradeDataClient({ ctx });
  }, []);

  // Prefer the page-injected shared bus so a cross-fragment leverage change
  // (order-form -> account-bar) reaches this island; fall back to a private
  // bus for standalone/test rendering. Mirrors market-header/chart-panel's
  // pattern exactly (docs/ARCHITECTURE_REFACTOR_PLAN.md §4.3.2).
  const injectedBus = props.bus;
  const bus = useMemo(
    () =>
      injectedBus ?? createInteractionBus({ contracts: tradeSliceContracts }),
    [injectedBus],
  );

  // Cross-component leverage change (C3 flow B): recompute the margin preview.
  useEffect(() => {
    const unsubscribe = bus.subscribe(
      TRADE_LEVERAGE,
      (payload) => {
        const next = (payload as LeveragePayload).leverage;
        if (typeof next === "number") {
          dispatch({ type: "leverage", leverage: next });
        }
      },
      { subscriber: ACCOUNT_BAR_SUBSCRIBER },
    );
    return unsubscribe;
  }, [bus]);

  // Realtime account-margin patch (placeholder feed in P2; P3 attaches the live
  // margin transport). The C4 `subscribe` sugar falls back to the poll loop for
  // the request-time `account` source (no mock transport), so this is inert
  // until a transport is wired — the SSR snapshot remains the source of truth.
  useEffect(() => {
    // `account` is a request-time source (not subscribable); attempting to
    // subscribe throws. Guard it so the island degrades to the SSR snapshot
    // until P3 wires a live margin transport, instead of erroring on mount.
    try {
      const unsubscribe = client.subscribe<AccountMargin>(
        client.sourceIds.account,
        (event) => dispatch({ type: "account", account: event.data }),
      );
      return unsubscribe;
    } catch {
      return undefined;
    }
  }, [client]);

  const { view, preview } = state;

  return (
    <div className="account-bar__row">
      <span className="account-bar__stat" data-field="equity">
        <small className="account-bar__caption">Equity</small>
        <b data-value="equity">{view.equity}</b>
      </span>
      <span className="account-bar__stat" data-field="marginUsed">
        <small className="account-bar__caption">Margin Used</small>
        <b data-value="marginUsed">{view.marginUsed}</b>
      </span>
      <span className="account-bar__stat" data-field="withdrawable">
        <small className="account-bar__caption">Withdrawable</small>
        <b data-value="withdrawable">{view.withdrawable}</b>
      </span>
      <span
        className="account-bar__stat account-bar__meter"
        data-field="marginUsage"
        style={
          { "--usage": preview.projectedUsageRatio.toFixed(4) } as Record<
            string,
            string
          >
        }
      >
        <small className="account-bar__caption">Margin Usage</small>
        <span className="account-bar__meter-track" aria-hidden="true">
          <span className="account-bar__meter-fill" />
        </span>
        <b data-value="marginUsagePct">{preview.projectedUsagePct}</b>
      </span>
    </div>
  );
}
