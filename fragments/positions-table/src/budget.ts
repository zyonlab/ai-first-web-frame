export const positionsTableBudget = {
  scope: "fragment",
  name: "positions-table",
  // Patch-only island: the fragment ships NO React. Its only browser JS is the
  // shared @mvp/trade-client chunk plus a small vanilla patch asset, so the
  // 30KB JS ceiling has generous headroom. Kept aligned with the doc 02 §3
  // draft (14KB) as the practical target; 30KB is the hard framework gate.
  jsBytes: 30000,
  cssBytes: 10000,
  // Realtime table: strict latency budget (doc 02 §3 draft parity with the
  // other realtime tables).
  maxFragmentLatencyMs: 120,
  maxRenderMs: 40,
  maxMemoryMB: 20,
} as const;
