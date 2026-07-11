export const vaultsPageBudget = {
  scope: "page",
  name: "page-vaults",
  // Static page: zero page-OWNED client JS. The old `jsBytes: 0` predates the
  // gate becoming real (audit:bundle now measures gzipped first-load JS from
  // the .next manifests): even a pure server-component page ships the Next
  // app-router runtime baseline, measured at 102,531 gzipped bytes on
  // 2026-07-12. Ceiling = that framework baseline + ~7KB headroom; adding any
  // real client island to this page should trip the gate.
  jsBytes: 110000,
  cssBytes: 50000,
  rscPayloadBytes: 120000,
  maxNetworkRequests: 5,
  maxTTFBMs: 800,
  maxLCPMs: 2500,
  maxINPMs: 200,
  maxCLS: 0.1,
} as const;
