export const vaultsPageBudget = {
  scope: "page",
  name: "page-vaults",
  // Pure static page: zero client JS, a single injected token/layout stylesheet.
  jsBytes: 0,
  cssBytes: 50000,
  rscPayloadBytes: 120000,
  maxNetworkRequests: 5,
  maxTTFBMs: 800,
  maxLCPMs: 2500,
  maxINPMs: 200,
  maxCLS: 0.1,
} as const;
