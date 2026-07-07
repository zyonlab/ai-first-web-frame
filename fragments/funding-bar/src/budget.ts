export const fundingBarBudget = {
  scope: "fragment",
  name: "funding-bar",
  // No React island: the only JS is an optional ~0.5KB vanilla countdown tick.
  // We keep a small headroom well under the 30KB hard gate; CSS under 10KB.
  jsBytes: 2000,
  cssBytes: 10000,
  maxFragmentLatencyMs: 200,
  maxRenderMs: 50,
  maxMemoryMB: 20,
} as const;
