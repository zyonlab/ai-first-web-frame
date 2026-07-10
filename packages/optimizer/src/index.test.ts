import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DataDependency } from "@mvp/contracts";
import type { RequestTraceSnapshot, TraceNode } from "@mvp/observability";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOptimizationFindings,
  createOptimizationMarkdown,
  loadTraceSnapshots,
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

function traceWith(
  traceId: string,
  nodes: TraceNode[],
  edges: RequestTraceSnapshot["edges"] = [],
): RequestTraceSnapshot {
  return { traceId, startedAtMs: 0, endedAtMs: 100, nodes, edges };
}

function slotSpan(
  name: string,
  fragment: string,
  overrides: Partial<TraceNode> = {},
): TraceNode {
  return {
    id: `slot-${name}`,
    name: `slot:${name}`,
    kind: "fragment",
    startedAtMs: 0,
    endedAtMs: 100,
    status: "ok",
    attributes: { slot: name, fragment, strategy: "dynamic-ssr" },
    ...overrides,
  };
}

function networkSpan(
  id: string,
  parentId: string,
  startedAtMs: number,
  endedAtMs: number,
  url = `https://api.example.test/${id}`,
): TraceNode {
  return {
    id,
    name: `fragment.http:${id}`,
    kind: "network",
    parentId,
    startedAtMs,
    endedAtMs,
    durationMs: endedAtMs - startedAtMs,
    status: "ok",
    attributes: { url },
  };
}

/** Two independent slots whose network calls serialize with a small gap. */
function waterfallTrace(traceId: string): RequestTraceSnapshot {
  return traceWith(traceId, [
    slotSpan("promotion", "promotion-banner"),
    slotSpan("recommendations", "recommendation-widget"),
    networkSpan("net-promotion", "slot-promotion", 10, 60),
    networkSpan("net-recommendations", "slot-recommendations", 65, 120),
  ]);
}

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

  it("attaches location to every finding", () => {
    const findings = createOptimizationFindings({
      trace: duplicateTrace,
      dataDependencies: [publicRequestTimeDependency],
      slots: [
        {
          name: "promo",
          fragment: "promotion-banner",
          strategy: "dynamic-ssr",
          manifestPath: "apps/page-home/src/manifest.ts",
        },
      ],
    });
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(finding.location).toBeDefined();
    const dataDuplicate = findings.find(
      (finding) => finding.category === "data",
    );
    expect(dataDuplicate?.location?.dataKey).toBe("product:123");
    const slotFinding = findings.find(
      (finding) => finding.id === "static-slot-promo",
    );
    expect(slotFinding?.location).toEqual({
      slotName: "promo",
      fragmentName: "promotion-banner",
      manifestPath: "apps/page-home/src/manifest.ts",
    });
    const staticData = findings.find(
      (finding) => finding.id === "static-data-public-copy",
    );
    expect(staticData?.location?.dataKey).toBe("public-copy");
  });

  it("escalates duplicate severity when the duplicate repeats across traces", () => {
    const second: RequestTraceSnapshot = {
      ...duplicateTrace,
      traceId: "trace-optimizer-2",
    };
    const single = createOptimizationFindings({ traces: [duplicateTrace] });
    const aggregated = createOptimizationFindings({
      traces: [duplicateTrace, second],
    });
    expect(single[0].severity).toBe("medium");
    expect(aggregated[0].severity).toBe("high");
    expect(aggregated[0].traceEvidence).toHaveLength(2);
    expect(aggregated[0].traceEvidence?.map((entry) => entry.traceId)).toEqual([
      "trace-optimizer",
      "trace-optimizer-2",
    ]);
  });

  it("detects a network waterfall between independent slots", () => {
    const findings = createOptimizationFindings({
      traces: [waterfallTrace("trace-waterfall")],
    });
    const waterfall = findings.find((finding) =>
      finding.id.startsWith("waterfall-"),
    );
    expect(waterfall).toBeDefined();
    expect(waterfall?.severity).toBe("medium");
    expect(waterfall?.category).toBe("network");
    expect(waterfall?.location?.slotName).toBe("recommendations");
    expect(waterfall?.location?.fragmentName).toBe("recommendation-widget");
    expect(waterfall?.traceEvidence?.[0]).toMatchObject({
      traceId: "trace-waterfall",
      spanIds: ["net-promotion", "net-recommendations"],
    });
    expect(waterfall?.traceEvidence?.[0].measurements?.gapMs).toBe(5);
  });

  it("escalates waterfall severity when the pattern repeats across traces", () => {
    const findings = createOptimizationFindings({
      traces: [waterfallTrace("trace-w1"), waterfallTrace("trace-w2")],
    });
    const waterfall = findings.find((finding) =>
      finding.id.startsWith("waterfall-"),
    );
    expect(waterfall?.severity).toBe("high");
    expect(waterfall?.traceEvidence).toHaveLength(2);
  });

  it("does not report a waterfall when slots declare a dependency", () => {
    const viaAttribute = traceWith("trace-dependent", [
      slotSpan("promotion", "promotion-banner"),
      slotSpan("recommendations", "recommendation-widget", {
        attributes: {
          slot: "recommendations",
          fragment: "recommendation-widget",
          dependsOn: ["promotion"],
        },
      }),
      networkSpan("net-promotion", "slot-promotion", 10, 60),
      networkSpan("net-recommendations", "slot-recommendations", 65, 120),
    ]);
    const viaEdge = traceWith(
      "trace-edge",
      waterfallTrace("trace-edge").nodes,
      [
        {
          from: "slot:promotion",
          to: "slot-recommendations",
          type: "depends-on",
        },
      ],
    );
    for (const trace of [viaAttribute, viaEdge]) {
      const findings = createOptimizationFindings({ traces: [trace] });
      expect(
        findings.some((finding) => finding.id.startsWith("waterfall-")),
      ).toBe(false);
    }
  });

  it("does not report a waterfall for parallel or widely separated spans", () => {
    const parallel = traceWith("trace-parallel", [
      slotSpan("promotion", "promotion-banner"),
      slotSpan("recommendations", "recommendation-widget"),
      networkSpan("net-promotion", "slot-promotion", 10, 60),
      networkSpan("net-recommendations", "slot-recommendations", 12, 70),
    ]);
    const separated = traceWith("trace-separated", [
      slotSpan("promotion", "promotion-banner"),
      slotSpan("recommendations", "recommendation-widget"),
      networkSpan("net-promotion", "slot-promotion", 10, 60),
      networkSpan("net-recommendations", "slot-recommendations", 500, 560),
    ]);
    for (const trace of [parallel, separated]) {
      const findings = createOptimizationFindings({ traces: [trace] });
      expect(
        findings.some((finding) => finding.id.startsWith("waterfall-")),
      ).toBe(false);
    }
  });

  function dataSpan(
    id: string,
    key: string,
    source: "cache" | "loader",
  ): TraceNode {
    return {
      id,
      name: `data:${key}`,
      kind: "data",
      startedAtMs: 0,
      endedAtMs: 1,
      status: source === "cache" ? "cache" : "ok",
      attributes: { key, source },
    };
  }

  it("reports data keys with a high cache miss rate", () => {
    const traces = [
      traceWith("trace-c1", [
        dataSpan("d1", "catalog:list", "loader"),
        dataSpan("d2", "catalog:list", "loader"),
      ]),
      traceWith("trace-c2", [
        dataSpan("d3", "catalog:list", "loader"),
        dataSpan("d4", "catalog:list", "cache"),
      ]),
    ];
    const findings = createOptimizationFindings({ traces });
    const cacheFinding = findings.find((finding) =>
      finding.id.startsWith("cache-miss-"),
    );
    expect(cacheFinding).toBeDefined();
    expect(cacheFinding?.category).toBe("cache");
    expect(cacheFinding?.location?.dataKey).toBe("catalog:list");
    expect(cacheFinding?.message).toContain("75%");
    expect(cacheFinding?.traceEvidence?.map((entry) => entry.traceId)).toEqual([
      "trace-c1",
      "trace-c2",
    ]);
  });

  it("reports cached fragments that keep missing the cache", () => {
    const missSlot = (traceId: string) =>
      traceWith(traceId, [
        slotSpan("promotion", "promotion-banner", {
          id: `slot-promotion-${traceId}`,
          status: "ok",
          attributes: {
            slot: "promotion",
            fragment: "promotion-banner",
            strategy: "cached-ssr",
            source: "network",
          },
        }),
      ]);
    const findings = createOptimizationFindings({
      traces: [missSlot("t1"), missSlot("t2"), missSlot("t3")],
    });
    const cacheFinding = findings.find((finding) =>
      finding.id.startsWith("cache-miss-"),
    );
    expect(cacheFinding).toBeDefined();
    expect(cacheFinding?.severity).toBe("high");
    expect(cacheFinding?.location?.fragmentName).toBe("promotion-banner");
  });

  it("treats deprecated isr and canonical ttl-cache strategies as cacheable", () => {
    for (const strategy of ["isr", "ttl-cache"] as const) {
      const missSlot = (traceId: string) =>
        traceWith(traceId, [
          slotSpan("chart", "chart-panel", {
            id: `slot-chart-${traceId}`,
            status: "ok",
            attributes: {
              slot: "chart",
              fragment: "chart-panel",
              strategy,
              source: "network",
            },
          }),
        ]);
      const findings = createOptimizationFindings({
        traces: [missSlot("t1"), missSlot("t2"), missSlot("t3")],
      });
      const cacheFinding = findings.find((finding) =>
        finding.id.startsWith("cache-miss-"),
      );
      expect(cacheFinding).toBeDefined();
      expect(cacheFinding?.location?.fragmentName).toBe("chart-panel");
    }
  });

  it("stays silent when cache hit rate is healthy or samples are too few", () => {
    const healthy = [
      traceWith("trace-h1", [
        dataSpan("d1", "catalog:list", "cache"),
        dataSpan("d2", "catalog:list", "cache"),
        dataSpan("d3", "catalog:list", "loader"),
      ]),
    ];
    const sparse = [
      traceWith("trace-s1", [dataSpan("d1", "catalog:list", "loader")]),
    ];
    for (const traces of [healthy, sparse]) {
      const findings = createOptimizationFindings({ traces });
      expect(
        findings.some((finding) => finding.id.startsWith("cache-miss-")),
      ).toBe(false);
    }
  });

  it("renders markdown grouped by severity with location and evidence", () => {
    const findings = createOptimizationFindings({
      traces: [duplicateTrace, waterfallTrace("trace-md")],
      slots: [
        {
          name: "promo",
          fragment: "promotion-banner",
          strategy: "dynamic-ssr",
          manifestPath: "apps/page-home/src/manifest.ts",
        },
      ],
    });
    const markdown = createOptimizationMarkdown(findings);
    expect(markdown).toContain("## MEDIUM");
    expect(markdown).toContain("## INFO");
    expect(markdown.indexOf("## MEDIUM")).toBeLessThan(
      markdown.indexOf("## INFO"),
    );
    expect(markdown).toContain("manifestPath=apps/page-home/src/manifest.ts");
    expect(markdown).toContain("trace trace-optimizer spans");
    expect(markdown).toContain("gapMs=5");
  });

  describe("loadTraceSnapshots", () => {
    const dirs: string[] = [];
    function tempDir(): string {
      const dir = join(
        tmpdir(),
        `mvp-optimizer-traces-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      mkdirSync(dir, { recursive: true });
      dirs.push(dir);
      return dir;
    }
    afterEach(() => {
      for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reads snapshots from jsonl files and counts malformed lines", () => {
      const dir = tempDir();
      const good = JSON.stringify(duplicateTrace);
      writeFileSync(
        join(dir, "traces-a.jsonl"),
        `${good}\nnot-json\n{"traceId":"","nodes":[]}\n\n${JSON.stringify({
          ...duplicateTrace,
          traceId: "trace-b",
        })}\n`,
      );
      writeFileSync(join(dir, "ignored.json"), good);
      const result = loadTraceSnapshots(dir);
      expect(result.files).toHaveLength(1);
      expect(result.snapshots.map((snapshot) => snapshot.traceId)).toEqual([
        "trace-optimizer",
        "trace-b",
      ]);
      expect(result.skippedLines).toBe(2);
    });

    it("returns an empty result for a missing directory", () => {
      const result = loadTraceSnapshots(join(tmpdir(), "does-not-exist-xyz"));
      expect(result).toEqual({ snapshots: [], files: [], skippedLines: 0 });
    });
  });
});
