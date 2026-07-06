import type { DataDependency } from "@mvp/contracts";
import type { RequestTraceSnapshot } from "@mvp/observability";
import { describe, expect, it } from "vitest";
import {
  createOptimizationFindings,
  createOptimizationMarkdown,
} from "./index";

const duplicateTrace: RequestTraceSnapshot = {
  traceId: "trace-optimizer",
  startedAtMs: 0,
  endedAtMs: 10,
  durationMs: 10,
  nodes: [
    {
      id: "request-a",
      name: "request:catalog",
      kind: "network",
      startedAtMs: 1,
      endedAtMs: 2,
      durationMs: 1,
      status: "ok",
      attributes: { url: "https://api.example.test/catalog" },
    },
    {
      id: "request-b",
      name: "request:catalog",
      kind: "network",
      startedAtMs: 3,
      endedAtMs: 4,
      durationMs: 1,
      status: "ok",
      attributes: { url: "https://api.example.test/catalog" },
    },
    {
      id: "data-a",
      name: "data:product",
      kind: "data",
      startedAtMs: 5,
      endedAtMs: 6,
      durationMs: 1,
      status: "ok",
      attributes: { key: "product:123" },
    },
    {
      id: "data-b",
      name: "data:product",
      kind: "data",
      startedAtMs: 7,
      endedAtMs: 8,
      durationMs: 1,
      status: "ok",
      attributes: { key: "product:123" },
    },
  ],
  edges: [],
};

const publicRequestTimeDependency: DataDependency = {
  id: "public-copy",
  owner: "page",
  source: "api",
  freshness: "request-time",
  privacy: "public",
  invalidationTags: [],
  dependsOn: [],
};

describe("@mvp/optimizer", () => {
  it("finds duplicate network and data trace spans", () => {
    const findings = createOptimizationFindings({ trace: duplicateTrace });
    expect(findings.map((finding) => finding.category)).toEqual([
      "network",
      "data",
    ]);
    expect(findings[0].message).toContain("2 network spans");
    expect(createOptimizationMarkdown(findings)).toContain(
      "Optimization Findings",
    );
  });

  it("finds static data and slot candidates", () => {
    const findings = createOptimizationFindings({
      dataDependencies: [publicRequestTimeDependency],
      slots: [
        {
          name: "promo",
          fragment: "promotion-banner",
          strategy: "dynamic-ssr",
        },
      ],
    });
    expect(findings.map((finding) => finding.id)).toEqual([
      "static-data-public-copy",
      "static-slot-promo",
    ]);
  });

  it("does not recommend static slots when private or realtime data exists", () => {
    const findings = createOptimizationFindings({
      dataDependencies: [
        {
          ...publicRequestTimeDependency,
          id: "ticker",
          freshness: "realtime",
          privacy: "public",
        },
      ],
      slots: [{ name: "ticker", fragment: "ticker-widget" }],
    });
    expect(
      findings.some((finding) => finding.id === "static-slot-ticker"),
    ).toBe(false);
  });
});
