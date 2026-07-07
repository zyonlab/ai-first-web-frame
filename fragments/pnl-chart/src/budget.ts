export const pnlChartBudget = {
  scope: "fragment",
  name: "pnl-chart",
  // Pure SSR inline SVG polyline: zero framework JS. Only an optional tiny
  // hover-readout enhancement could ship later as a built client asset, so we
  // keep a small headroom well under the 30KB hard gate; CSS under 10KB.
  jsBytes: 2000,
  cssBytes: 10000,
  maxFragmentLatencyMs: 200,
  maxRenderMs: 50,
  maxMemoryMB: 20,
} as const;
