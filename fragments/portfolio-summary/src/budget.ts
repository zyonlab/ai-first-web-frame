export const portfolioSummaryBudget = {
  scope: "fragment",
  name: "portfolio-summary",
  // Pure SSR, no React island: zero framework JS is shipped. We keep a small
  // headroom well under the 30KB hard gate; CSS under the 10KB gate.
  jsBytes: 0,
  cssBytes: 10000,
  maxFragmentLatencyMs: 200,
  maxRenderMs: 50,
  maxMemoryMB: 20,
} as const;
