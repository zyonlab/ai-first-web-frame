export const accountBarBudget = {
  scope: "fragment",
  name: "account-bar",
  // Small island: React itself ships once via the shared @mvp/trade-client
  // chunk (C2) and is NOT counted against this fragment. Only the island glue
  // + inline snapshot are charged here, so the JS budget stays tiny.
  jsBytes: 8000,
  cssBytes: 6000,
  maxFragmentLatencyMs: 200,
  maxRenderMs: 50,
  maxMemoryMB: 20,
} as const;
