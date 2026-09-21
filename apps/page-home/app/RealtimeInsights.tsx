"use client";

import { createDataClient, defineDataSource } from "@mvp/data";
import { createInteractionBus } from "@mvp/interaction";
import { createRequestContext } from "@mvp/request-context";
import { useEffect, useMemo, useReducer, useState } from "react";
import {
  homeInteractionContracts,
  isRecommendationCategory,
  REALTIME_INSIGHTS_SUBSCRIBER,
  RECOMMENDATION_CATEGORY_CHANNEL,
  RECOMMENDATION_FILTER_OWNER,
  type RecommendationCategory,
  recommendationCategories,
} from "../src/interactionContracts";
import {
  computeRealtimeSnapshot,
  initialRealtimeState,
  type RealtimeInsightsSnapshot,
  realtimeInsightsReducer,
} from "../src/realtimeInsights";

const SUBSCRIPTION_SOURCE_ID = "home-recommendation-heat";
const POLL_INTERVAL_MS = 2000;

/**
 * Near-realtime client island. Only this component re-renders on updates; the
 * server-rendered static blocks around it never re-run. It showcases three
 * framework capabilities at once:
 *   - `@mvp/data` `subscribeData` polling (value-changed callbacks only),
 *   - a contract-checked `@mvp/interaction` bus for cross-container filtering,
 *   - a client-side web-vitals beacon (RUM) via `navigator.sendBeacon`.
 *
 * `initialSnapshot` is the SSR first-paint value: with JavaScript disabled the
 * static markup below is still fully readable (verified by the no-js e2e).
 */
export function RealtimeInsights({
  initialSnapshot,
}: {
  initialSnapshot: RealtimeInsightsSnapshot;
}) {
  const [state, dispatch] = useReducer(
    realtimeInsightsReducer,
    initialSnapshot.category,
    initialRealtimeState,
  );
  const [category, setCategory] = useState<RecommendationCategory>(
    initialSnapshot.category,
  );

  // A client-local request context and data client, created once. The data
  // source is near-realtime and subscribable; its `load` is a pure generator
  // so the island stays tiny and free of third-party dependencies.
  const dataClient = useMemo(() => {
    const ctx = createRequestContext();
    let tick = 0;
    const source = defineDataSource<RealtimeInsightsSnapshot>({
      id: SUBSCRIPTION_SOURCE_ID,
      dependency: {
        id: SUBSCRIPTION_SOURCE_ID,
        owner: "client-island",
        source: "subscription",
        freshness: "realtime",
        privacy: "public",
        invalidationTags: [],
        dependsOn: [],
      },
      load: ({ params }) => {
        tick += 1;
        const selected = isRecommendationCategory(
          (params as { category?: unknown }).category,
        )
          ? (params as { category: RecommendationCategory }).category
          : "all";
        return computeRealtimeSnapshot(selected, tick);
      },
    });
    return createDataClient({ ctx, sources: [source] });
  }, []);

  const bus = useMemo(
    () => createInteractionBus({ contracts: homeInteractionContracts }),
    [],
  );

  // Cross-container interaction: the filter control publishes a category and
  // this island (a declared subscriber) reacts by re-subscribing its data.
  useEffect(() => {
    const unsubscribe = bus.subscribe(
      RECOMMENDATION_CATEGORY_CHANNEL,
      (payload) => {
        const next = (payload as { category?: unknown }).category;
        if (isRecommendationCategory(next)) {
          setCategory(next);
          dispatch({ type: "category-changed", category: next });
        }
      },
      { subscriber: REALTIME_INSIGHTS_SUBSCRIBER },
    );
    return unsubscribe;
  }, [bus]);

  // Realtime subscription, re-established whenever the category changes so the
  // stream is scoped to the selected filter.
  useEffect(() => {
    const unsubscribe = dataClient.subscribeData<RealtimeInsightsSnapshot>(
      SUBSCRIPTION_SOURCE_ID,
      (event) => dispatch({ type: "snapshot", snapshot: event.data }),
      { intervalMs: POLL_INTERVAL_MS, params: { category } },
    );
    return unsubscribe;
  }, [dataClient, category]);

  function onSelect(next: RecommendationCategory) {
    void bus.publish(
      RECOMMENDATION_CATEGORY_CHANNEL,
      { category: next },
      { owner: RECOMMENDATION_FILTER_OWNER },
    );
  }

  return (
    <section data-island="realtime-insights" data-category={state.category}>
      <h2>Realtime recommendation heat</h2>
      <div data-container="recommendation-filter">
        <span>Category:</span>
        {recommendationCategories.map((option) => (
          <button
            key={option}
            type="button"
            data-category-option={option}
            aria-pressed={option === state.category}
            onClick={() => onSelect(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <dl>
        <dt>Selected</dt>
        <dd data-field="category">{state.category}</dd>
        <dt>Heat</dt>
        <dd data-field="heat">{state.snapshot.heat}</dd>
        <dt>In stock</dt>
        <dd data-field="stock">{state.snapshot.stock}</dd>
        <dt>Live updates</dt>
        <dd data-field="updates">{state.updates}</dd>
      </dl>
      <p data-note="realtime">
        Only this island re-renders on each realtime tick; the surrounding
        server-rendered content is untouched.
      </p>
    </section>
  );
}
