export const marketsTableBudget = {
  scope: "fragment",
  name: "markets-table",
  // Pure SSR: rows are plain anchors, no React island. The only JS is an
  // optional ~1KB vanilla price-tick patch. Well under the 30KB hard gate;
  // scoped CSS stays under 10KB.
  jsBytes: 2000,
  cssBytes: 10000,
  maxFragmentLatencyMs: 200,
  maxRenderMs: 50,
  maxMemoryMB: 20,
} as const;
