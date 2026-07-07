export const orderBookBudget = {
  scope: "fragment",
  name: "order-book",
  // Patch-only island: no React shipped from the fragment, only the small
  // vanilla patch client (declared as a shared @mvp/trade-client chunk +
  // the fragment's own patch asset). 30KB JS ceiling is the hard gate.
  jsBytes: 30000,
  cssBytes: 10000,
  // Realtime ladder: strict latency budget (doc 02 §3.1 draft = 120ms).
  maxFragmentLatencyMs: 120,
  maxRenderMs: 40,
  maxMemoryMB: 20,
} as const;
