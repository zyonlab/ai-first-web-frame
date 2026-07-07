/**
 * Patch-only vanilla client logic for the open (working) orders table (NO React).
 *
 * Everything here is a pure, deterministic function so it can be unit-tested
 * without a DOM: given the current orders state + a new orders frame it computes
 * (a) the next keyed state and (b) a declarative DOM patch instruction the thin
 * browser shim applies. The browser shim (the real `open-orders.patch.js`) is
 * the only DOM-touching code and is intentionally tiny — it just executes the
 * instructions this module produces.
 *
 * Two realtime flows are modeled as pure functions:
 *
 * 1. **Order frame → row upsert / fill removal.** A new `orders` frame is the
 *    full working set; diffing it against the current state yields per-row
 *    `upsert` (new / changed order) and `remove` (filled or cancelled → no
 *    longer working) instructions, keyed by `orderId`.
 * 2. **Cancel flow.** Clicking a row's cancel control runs `cancelOrderFlow`,
 *    which drives the frozen `cancelOrder` mutation (contract C3) through an
 *    injected mock `mutate` + `invalidate`. `execute` is called with NO
 *    `options.invalidates` (so the declared `["orders:{user}"]` templates are
 *    used); the `invalidate` handler resolves `{user}` via `resolveUserTags`
 *    before hitting the data client — proving the cancel only ever invalidates
 *    `orders:<user>` and nothing else.
 *
 * On a `TRADE_ACTIVE_SYMBOL` switch the table filters to the active symbol
 * (working orders are user-private and span symbols; the trade page shows the
 * active market's orders), clearing rows for other symbols.
 */

import {
  CANCEL_ORDER_INVALIDATES,
  type CancelOrderInput,
  type CancelOrderResult,
  cancelOrder,
  resolveUserTags,
  TRADE_ACTIVE_SYMBOL,
} from "@mvp/interaction";

/** Aggressor side of a working order. */
export type OrderSide = "buy" | "sell";

/** The minimal working-order shape the table renders/patches. */
export type OpenOrder = {
  orderId: string;
  symbol: string;
  side: OrderSide;
  type: "market" | "limit";
  price: number;
  size: number;
  /** Cumulative filled size (0 for an untouched resting order). */
  filled: number;
};

/** Re-export the channel the island resubscribes on, so consumers stay in lockstep. */
export { CANCEL_ORDER_INVALIDATES, TRADE_ACTIVE_SYMBOL };

// ---------------------------------------------------------------------------
// Formatting (shared by SSR render + client patch so a patched row is
// byte-identical to how SSR would have rendered it)
// ---------------------------------------------------------------------------

/** Formatted cells for a single order row (all strings). */
export type OrderRowCells = {
  side: string;
  type: string;
  price: string;
  size: string;
  filled: string;
};

/** Formats price with thousands separators + 2 decimals (mono, right-aligned). */
export function formatOrderPrice(price: number): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Formats a size/quantity with 4 decimals (mono, right-aligned). */
export function formatOrderSize(size: number): string {
  return size.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/** Normalizes an order into a fully-populated `OpenOrder` (defaulting `filled`). */
export function toOpenOrder(order: {
  orderId: string;
  symbol: string;
  side: OrderSide;
  type: "market" | "limit";
  price: number;
  size: number;
  filled?: number;
}): OpenOrder {
  return {
    orderId: order.orderId,
    symbol: order.symbol.toUpperCase(),
    side: order.side,
    type: order.type,
    price: order.price,
    size: order.size,
    filled: typeof order.filled === "number" ? order.filled : 0,
  };
}

/** Formats all cells of a working order for a table row. */
export function formatOrderRow(order: OpenOrder): OrderRowCells {
  return {
    side: order.side === "buy" ? "Buy" : "Sell",
    type: order.type === "limit" ? "Limit" : "Market",
    price: order.type === "market" ? "Market" : formatOrderPrice(order.price),
    size: formatOrderSize(order.size),
    filled: formatOrderSize(order.filled),
  };
}

// ---------------------------------------------------------------------------
// Pure orders reducer (keyed upsert / remove)
// ---------------------------------------------------------------------------

/** In-memory orders state the island keeps between frames (keyed by orderId). */
export type OrdersState = {
  /** The symbol the table is currently scoped to (active market). */
  symbol: string;
  /** Working orders for the active symbol, insertion order preserved. */
  orders: OpenOrder[];
};

/** A declarative DOM patch instruction for the browser shim to apply. */
export type OrdersPatch =
  | {
      /** Insert or replace a row keyed by orderId. */
      type: "upsert";
      orderId: string;
      side: OrderSide;
      cells: OrderRowCells;
    }
  | {
      /** Remove a row (order filled or cancelled → no longer working). */
      type: "remove";
      orderId: string;
      reason: "filled" | "cancelled" | "gone";
    }
  | {
      /** No visible change for this order (identical frame). */
      type: "noop";
      orderId: string;
    };

/** Builds the initial orders state from the SSR snapshot. */
export function createOrdersState(snapshot: {
  symbol: string;
  orders: Array<Parameters<typeof toOpenOrder>[0]>;
}): OrdersState {
  const symbol = snapshot.symbol.trim().toUpperCase();
  return {
    symbol,
    orders: snapshot.orders.map(toOpenOrder).filter((o) => o.symbol === symbol),
  };
}

/** True when two orders render identically (so no DOM patch is needed). */
function ordersEqual(a: OpenOrder, b: OpenOrder): boolean {
  return (
    a.side === b.side &&
    a.type === b.type &&
    a.price === b.price &&
    a.size === b.size &&
    a.filled === b.filled
  );
}

/**
 * Folds a single incoming order frame into the table. If the order is fully
 * filled (`filled >= size`) it is removed; otherwise the row is upserted (keyed
 * by `orderId`). An identical order yields a `noop`. Orders for a different
 * symbol than the active one are ignored (`noop` with the incoming id).
 */
export function applyOrderFrame(
  state: OrdersState,
  incoming: Parameters<typeof toOpenOrder>[0],
): { state: OrdersState; patch: OrdersPatch } {
  const order = toOpenOrder(incoming);
  if (order.symbol !== state.symbol) {
    return { state, patch: { type: "noop", orderId: order.orderId } };
  }

  const idx = state.orders.findIndex((o) => o.orderId === order.orderId);

  // Fully filled → drop the working row.
  if (order.filled >= order.size) {
    if (idx === -1) {
      return { state, patch: { type: "noop", orderId: order.orderId } };
    }
    const orders = state.orders.filter((o) => o.orderId !== order.orderId);
    return {
      state: { ...state, orders },
      patch: { type: "remove", orderId: order.orderId, reason: "filled" },
    };
  }

  if (idx === -1) {
    return {
      state: { ...state, orders: [...state.orders, order] },
      patch: {
        type: "upsert",
        orderId: order.orderId,
        side: order.side,
        cells: formatOrderRow(order),
      },
    };
  }

  if (ordersEqual(state.orders[idx], order)) {
    return { state, patch: { type: "noop", orderId: order.orderId } };
  }

  const orders = state.orders.slice();
  orders[idx] = order;
  return {
    state: { ...state, orders },
    patch: {
      type: "upsert",
      orderId: order.orderId,
      side: order.side,
      cells: formatOrderRow(order),
    },
  };
}

/**
 * Reconciles the whole working set from a full `orders` frame: upserts every
 * incoming order and removes any current row absent from the frame (it filled
 * or was cancelled server-side). Returns the next state plus the ordered patch
 * list the browser shim applies.
 */
export function reconcileOrders(
  state: OrdersState,
  frame: Array<Parameters<typeof toOpenOrder>[0]>,
): { state: OrdersState; patches: OrdersPatch[] } {
  const incoming = frame
    .map(toOpenOrder)
    .filter((o) => o.symbol === state.symbol);
  const incomingIds = new Set(incoming.map((o) => o.orderId));
  const patches: OrdersPatch[] = [];

  let next = state;
  for (const order of incoming) {
    const step = applyOrderFrame(next, order);
    next = step.state;
    if (step.patch.type !== "noop") patches.push(step.patch);
  }

  // Remove rows that vanished from the working set.
  const removed: OpenOrder[] = [];
  for (const current of state.orders) {
    if (!incomingIds.has(current.orderId)) {
      removed.push(current);
      patches.push({
        type: "remove",
        orderId: current.orderId,
        reason: "gone",
      });
    }
  }
  if (removed.length > 0) {
    const removedIds = new Set(removed.map((o) => o.orderId));
    next = {
      ...next,
      orders: next.orders.filter((o) => !removedIds.has(o.orderId)),
    };
  }

  return { state: next, patches };
}

// ---------------------------------------------------------------------------
// Cancel flow (drives the frozen cancelOrder mutation — contract C3)
// ---------------------------------------------------------------------------

/** What the cancel control needs to fire a cancel for a given row. */
export type CancelRequest = { orderId: string; symbol: string };

/** The injected server + cache side-effects the cancel flow drives. */
export type CancelFlowIo = {
  /** Mock deterministic matching-engine cancel (pure; from createMockMatchingEngine). */
  mutate: (
    input: CancelOrderInput,
  ) => CancelOrderResult | Promise<CancelOrderResult>;
  /**
   * Invalidates *resolved* cache tags. The flow calls this with tags already
   * mapped through `resolveUserTags`, so the handler wires straight to
   * `dataClient.mutateData(tags)`.
   */
  invalidate: (resolvedTags: string[]) => void | Promise<void>;
  /** The current user id used to resolve `{user}` placeholders (from ctx.user.id). */
  userId: string;
};

/** The result of a completed cancel flow (ack + the tags that were invalidated). */
export type CancelFlowResult = {
  ack: CancelOrderResult;
  /** The declared tag templates the mutation is allowed to invalidate. */
  declaredTags: string[];
  /** The concrete tags actually invalidated (`{user}` resolved). */
  resolvedTags: string[];
  /** The remove patch the shim applies once the cancel acks. */
  patch: Extract<OrdersPatch, { type: "remove" }>;
};

/**
 * Runs the cancel flow for one order: validates + executes the frozen
 * `cancelOrder` mutation against the injected mock engine, resolving `{user}`
 * tag placeholders inside the `invalidate` handler (NOT via
 * `options.invalidates`, which would be rejected by the undeclared-tag guard),
 * and produces a `remove` patch keyed by orderId.
 *
 * Contract points asserted by the tests:
 * - `execute` is called with NO `options.invalidates` → declared templates used.
 * - the mutation's declared/invalidated tags are exactly `["orders:{user}"]`.
 * - the `invalidate` handler receives `orders:<userId>` (resolved), nothing else.
 */
export async function cancelOrderFlow(
  request: CancelRequest,
  io: CancelFlowIo,
): Promise<CancelFlowResult> {
  let resolvedTags: string[] = [];
  const { result: ack, invalidated } = await cancelOrder.execute(
    { orderId: request.orderId, symbol: request.symbol },
    {
      mutate: io.mutate,
      invalidate: async (tags) => {
        // Resolve {user} → concrete id INSIDE the handler; the undeclared-tag
        // guard checks literal membership against the declared templates, so a
        // pre-resolved tag would be rejected.
        resolvedTags = resolveUserTags(tags, io.userId);
        await io.invalidate(resolvedTags);
      },
    },
    // No options.invalidates → the declared ["orders:{user}"] templates are used.
  );

  return {
    ack,
    declaredTags: invalidated,
    resolvedTags,
    patch: { type: "remove", orderId: request.orderId, reason: "cancelled" },
  };
}

// ---------------------------------------------------------------------------
// Symbol switch (filter to active market)
// ---------------------------------------------------------------------------

/**
 * On a `TRADE_ACTIVE_SYMBOL` change, re-scope the table to the new symbol:
 * keep only that symbol's working orders (from an optional full working set) and
 * emit `remove` patches for the rows leaving the view. Returns `undefined` for a
 * malformed payload or a no-op switch to the same symbol.
 */
export function onActiveSymbolChange(
  state: OrdersState,
  payload: unknown,
  workingSet: Array<Parameters<typeof toOpenOrder>[0]> = [],
):
  | { state: OrdersState; patches: OrdersPatch[]; nextSymbol: string }
  | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { symbol?: unknown }).symbol !== "string"
  ) {
    return undefined;
  }
  const nextSymbol = (payload as { symbol: string }).symbol
    .trim()
    .toUpperCase();
  if (nextSymbol === state.symbol) return undefined;

  const patches: OrdersPatch[] = state.orders.map((o) => ({
    type: "remove" as const,
    orderId: o.orderId,
    reason: "gone" as const,
  }));

  const scoped: OrdersState = { symbol: nextSymbol, orders: [] };
  const reconciled = reconcileOrders(scoped, workingSet);
  return {
    state: reconciled.state,
    patches: [...patches, ...reconciled.patches],
    nextSymbol,
  };
}

// ---------------------------------------------------------------------------
// Subscription wiring (side-effecting, but injectable so it is testable)
// ---------------------------------------------------------------------------

/** The subset of the trade data client the orders island needs. */
export type OrdersSubscribeClient = {
  subscribe: (
    id: string,
    handler: (event: { data: unknown }) => void,
  ) => () => void;
  sourceIds: { orders: string };
};

/**
 * Subscribes to the global `orders` feed, forwarding each full frame to
 * `onFrame`. Returns the unsubscribe handle. Pure wiring: the caller owns state
 * + DOM. `orders` is a global (non-symbol) id, so no symbol argument.
 */
export function subscribeOrders(
  client: OrdersSubscribeClient,
  onFrame: (orders: Array<Parameters<typeof toOpenOrder>[0]>) => void,
): () => void {
  return client.subscribe(client.sourceIds.orders, (event) => {
    const data = event.data as
      | Array<Parameters<typeof toOpenOrder>[0]>
      | undefined;
    if (!data) return;
    onFrame(Array.isArray(data) ? data : [data]);
  });
}
