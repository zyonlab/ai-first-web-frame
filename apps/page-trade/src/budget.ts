export const tradePageBudget = {
  scope: "page",
  name: "page-trade",
  // The old 180000 was the copied default-page number from before the gate
  // became real. audit:bundle now measures gzipped first-load JS from the
  // .next manifests: 202,009 bytes on 2026-07-12 — by D3 design this page
  // carries React + the shared vendor chunk + every trade island's hydration
  // glue (the fragments are charged only their own glue, see
  // fragments/*/src/budget.ts). Ceiling = measured baseline + ~9% headroom;
  // shrinking back toward 180KB means splitting the island runtime, not
  // editing this number.
  jsBytes: 220000,
  cssBytes: 50000,
  rscPayloadBytes: 120000,
  maxNetworkRequests: 20,
  maxTTFBMs: 800,
  maxLCPMs: 2500,
  maxINPMs: 200,
  maxCLS: 0.1,
} as const;
