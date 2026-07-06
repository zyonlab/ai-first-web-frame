import type { RecommendationCategory } from "./interactionContracts";

/**
 * A near-realtime "recommendation heat" sample. Values are the live popularity
 * score and remaining stock for the currently selected recommendation
 * category. Kept intentionally small and serializable so it can travel through
 * `@mvp/data`'s subscription channel and be embedded as an SSR initial value.
 */
export type RealtimeInsightsSnapshot = {
  category: RecommendationCategory;
  heat: number;
  stock: number;
  tick: number;
};

export type RealtimeInsightsState = {
  category: RecommendationCategory;
  snapshot: RealtimeInsightsSnapshot;
  updates: number;
};

export type RealtimeInsightsAction =
  | { type: "category-changed"; category: RecommendationCategory }
  | { type: "snapshot"; snapshot: RealtimeInsightsSnapshot };

/**
 * Deterministic, dependency-free snapshot generator. Real deployments would
 * back this with a subscription transport (WebSocket/SSE) or an `/api` poll;
 * a pure function keeps the client island tiny and the logic unit-testable.
 */
export function computeRealtimeSnapshot(
  category: RecommendationCategory,
  tick: number,
): RealtimeInsightsSnapshot {
  const seed = categorySeed(category);
  const heat = 40 + ((seed * 7 + tick * 13) % 60);
  const stock = 12 + ((seed * 5 + tick * 3) % 40);
  return { category, heat, stock, tick };
}

function categorySeed(category: RecommendationCategory): number {
  switch (category) {
    case "bags":
      return 3;
    case "audio":
      return 5;
    case "desk":
      return 7;
    default:
      return 1;
  }
}

export function initialRealtimeState(
  category: RecommendationCategory,
): RealtimeInsightsState {
  return {
    category,
    snapshot: computeRealtimeSnapshot(category, 0),
    updates: 0,
  };
}

/**
 * Pure reducer driving the realtime island. A category change resets the view
 * to that category's baseline; a snapshot only counts as an update when its
 * category matches the currently selected one (late snapshots from a previous
 * category are ignored, mirroring how the island re-subscribes on filter
 * change).
 */
export function realtimeInsightsReducer(
  state: RealtimeInsightsState,
  action: RealtimeInsightsAction,
): RealtimeInsightsState {
  switch (action.type) {
    case "category-changed": {
      if (action.category === state.category) return state;
      return initialRealtimeState(action.category);
    }
    case "snapshot": {
      if (action.snapshot.category !== state.category) return state;
      return {
        category: state.category,
        snapshot: action.snapshot,
        updates: state.updates + 1,
      };
    }
    default:
      return state;
  }
}
