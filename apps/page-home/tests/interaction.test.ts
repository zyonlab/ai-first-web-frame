import { createInteractionBus } from "@mvp/interaction";
import { describe, expect, it } from "vitest";
import {
  homeInteractionContracts,
  isRecommendationCategory,
  REALTIME_INSIGHTS_SUBSCRIBER,
  RECOMMENDATION_CATEGORY_CHANNEL,
  RECOMMENDATION_FILTER_OWNER,
} from "../src/interactionContracts";

describe("home interaction contracts", () => {
  it("delivers a published category to the declared subscriber", async () => {
    const bus = createInteractionBus({ contracts: homeInteractionContracts });
    const received: unknown[] = [];
    bus.subscribe(
      RECOMMENDATION_CATEGORY_CHANNEL,
      (payload) => {
        received.push(payload);
      },
      { subscriber: REALTIME_INSIGHTS_SUBSCRIBER },
    );

    const result = await bus.publish(
      RECOMMENDATION_CATEGORY_CHANNEL,
      { category: "audio" },
      { owner: RECOMMENDATION_FILTER_OWNER },
    );

    expect(result.subscriberCount).toBe(1);
    expect(received).toEqual([{ category: "audio" }]);
  });

  it("rejects an undeclared category value via the payload schema", async () => {
    const bus = createInteractionBus({ contracts: homeInteractionContracts });
    await expect(
      bus.publish(
        RECOMMENDATION_CATEGORY_CHANNEL,
        { category: "unknown" },
        { owner: RECOMMENDATION_FILTER_OWNER },
      ),
    ).rejects.toThrow();
  });

  it("rejects publishing from an undeclared owner", async () => {
    const bus = createInteractionBus({ contracts: homeInteractionContracts });
    await expect(
      bus.publish(
        RECOMMENDATION_CATEGORY_CHANNEL,
        { category: "all" },
        { owner: "impostor" },
      ),
    ).rejects.toThrow();
  });

  it("narrows recommendation categories", () => {
    expect(isRecommendationCategory("desk")).toBe(true);
    expect(isRecommendationCategory("nope")).toBe(false);
    expect(isRecommendationCategory(42)).toBe(false);
  });
});
