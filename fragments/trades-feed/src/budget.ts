export const tradesFeedBudget = {
  scope: "fragment",
  name: "trades-feed",
  // Patch-only island: the fragment ships NO React. Its only browser JS is the
  // page-bundled shared runtime plus a small vanilla patch asset, so the
  // 30KB JS ceiling has generous headroom. Kept aligned with the doc 02 §3
  // draft (10KB) as the practical target; 30KB is the hard framework gate.
  jsBytes: 30000,
  cssBytes: 10000,
  // Realtime tape: strict latency budget (doc 02 §3 draft parity with order-book).
  maxFragmentLatencyMs: 120,
  maxRenderMs: 40,
  maxMemoryMB: 20,
} as const;
