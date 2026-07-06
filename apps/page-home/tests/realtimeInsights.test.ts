import { describe, expect, it } from "vitest";
import {
  computeRealtimeSnapshot,
  initialRealtimeState,
  realtimeInsightsReducer,
} from "../src/realtimeInsights";

describe("realtimeInsights reducer", () => {
  it("produces deterministic snapshots per category and tick", () => {
    const a = computeRealtimeSnapshot("bags", 3);
    const b = computeRealtimeSnapshot("bags", 3);
    expect(a).toEqual(b);
    expect(a.category).toBe("bags");
    expect(a.heat).toBeGreaterThanOrEqual(40);
    expect(a.stock).toBeGreaterThanOrEqual(12);
  });

  it("changes snapshots as ticks advance", () => {
    const first = computeRealtimeSnapshot("audio", 1);
    const second = computeRealtimeSnapshot("audio", 2);
    expect(second.tick).toBe(2);
    expect(second).not.toEqual(first);
  });

  it("counts a matching snapshot as a live update", () => {
    const state = initialRealtimeState("all");
    const next = realtimeInsightsReducer(state, {
      type: "snapshot",
      snapshot: computeRealtimeSnapshot("all", 5),
    });
    expect(next.updates).toBe(1);
    expect(next.snapshot.tick).toBe(5);
  });

  it("ignores snapshots for a stale category", () => {
    const state = initialRealtimeState("all");
    const next = realtimeInsightsReducer(state, {
      type: "snapshot",
      snapshot: computeRealtimeSnapshot("bags", 5),
    });
    expect(next).toBe(state);
    expect(next.updates).toBe(0);
  });

  it("resets to baseline on category change", () => {
    const state = realtimeInsightsReducer(initialRealtimeState("all"), {
      type: "snapshot",
      snapshot: computeRealtimeSnapshot("all", 4),
    });
    const changed = realtimeInsightsReducer(state, {
      type: "category-changed",
      category: "desk",
    });
    expect(changed.category).toBe("desk");
    expect(changed.updates).toBe(0);
    expect(changed.snapshot.category).toBe("desk");
  });

  it("no-ops when the category is unchanged", () => {
    const state = initialRealtimeState("audio");
    const same = realtimeInsightsReducer(state, {
      type: "category-changed",
      category: "audio",
    });
    expect(same).toBe(state);
  });
});
