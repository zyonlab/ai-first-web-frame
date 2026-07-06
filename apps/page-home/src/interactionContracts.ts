import type { InteractionContract } from "@mvp/contracts";

/**
 * Cross-container interaction contracts used by the home page demo.
 *
 * The category filter control (published by the "recommendation-filter"
 * container) and the realtime insights island (a declared subscriber) both
 * operate over this single declared channel. Publishing to an undeclared
 * channel, or with an undeclared owner, throws in `@mvp/interaction` — that is
 * the contract guarantee we want to showcase.
 */
export const RECOMMENDATION_CATEGORY_CHANNEL =
  "home.recommendation-category" as const;

export const recommendationCategories = [
  "all",
  "bags",
  "audio",
  "desk",
] as const;

export type RecommendationCategory = (typeof recommendationCategories)[number];

export const RECOMMENDATION_FILTER_OWNER = "recommendation-filter" as const;
export const REALTIME_INSIGHTS_SUBSCRIBER = "realtime-insights" as const;

export const homeInteractionContracts: InteractionContract[] = [
  {
    channel: RECOMMENDATION_CATEGORY_CHANNEL,
    publisher: RECOMMENDATION_FILTER_OWNER,
    subscribers: [REALTIME_INSIGHTS_SUBSCRIBER],
    payloadSchema: {
      type: "object",
      required: ["category"],
      additionalProperties: false,
      properties: {
        category: {
          type: "string",
          enum: [...recommendationCategories],
        },
      },
    },
  },
];

export type RecommendationCategoryEvent = {
  category: RecommendationCategory;
};

export function isRecommendationCategory(
  value: unknown,
): value is RecommendationCategory {
  return (
    typeof value === "string" &&
    (recommendationCategories as readonly string[]).includes(value)
  );
}
