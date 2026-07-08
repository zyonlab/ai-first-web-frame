/**
 * Scoped CSS for the chart-panel fragment — single source of truth.
 *
 * This string is inlined once at the front of the fragment's SSR HTML (see
 * render), so the dense terminal styling reaches the browser even when the
 * composed page never fetches the standalone /assets/chart-panel.css file.
 *
 * Keep this in sync with assets/chart-panel.css (or src/chart-panel.css); the .css file
 * is retained so the css-budget audit still measures the fragment stylesheet.
 */
export const chartPanelCss = `/*
 * Scoped chart-panel styles (served as /assets/chart-panel.css).
 * Directional latest-candle close uses the design-system semantic color
 * variables (\`--mvp-color-up\` / \`--mvp-color-down\`); no hard-coded hexes.
 * Numeric cells use the shared mono font token for tabular alignment. Small
 * footprint to hold the fragment CSS budget (<= 10KB).
 */

.chart-panel {
  border: 1px solid var(--trade-panel-border, rgba(128, 128, 128, 0.24));
  border-radius: var(--mvp-radius-sm, 4px);
  background: var(--mvp-color-surface, transparent);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chart-panel__island {
  display: flex;
  flex-direction: column;
  gap: var(--mvp-spacing-sm, 8px);
  padding: var(--mvp-spacing-sm, 8px) var(--mvp-spacing-md, 16px);
}

.chart-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mvp-spacing-md, 16px);
  flex-wrap: wrap;
}

.chart-panel__pair {
  font-family: var(
    --trade-font-mono,
    ui-monospace,
    "SFMono-Regular",
    monospace
  );
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.02em;
}

.chart-panel__intervals {
  display: inline-flex;
  gap: var(--mvp-spacing-xs, 4px);
}

.chart-panel__interval-chip {
  appearance: none;
  border: 1px solid var(--trade-panel-border, rgba(128, 128, 128, 0.24));
  background: transparent;
  color: var(--mvp-color-muted, rgba(128, 128, 128, 0.9));
  border-radius: var(--mvp-radius-sm, 4px);
  padding: 2px 8px;
  font-family: var(
    --trade-font-mono,
    ui-monospace,
    "SFMono-Regular",
    monospace
  );
  font-size: 11px;
  line-height: 1.6;
  cursor: pointer;
}

.chart-panel__interval-chip[data-active="true"],
.chart-panel__interval-chip[aria-selected="true"] {
  color: var(--mvp-color-text, inherit);
  background: var(--mvp-color-surface-2, rgba(128, 128, 128, 0.12));
  border-color: var(--mvp-color-accent, currentColor);
  font-weight: 600;
}

.chart-panel__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mvp-spacing-md, 16px);
  font-family: var(
    --trade-font-mono,
    ui-monospace,
    "SFMono-Regular",
    monospace
  );
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.chart-panel__stat {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.chart-panel__caption {
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--mvp-color-muted, rgba(128, 128, 128, 0.9));
}

.chart-panel__stat > b {
  font-weight: 600;
  font-style: normal;
}

.chart-panel__close--up > b {
  color: var(--mvp-color-up, #12a150);
}

.chart-panel__close--down > b {
  color: var(--mvp-color-down, #d1363f);
}

.chart-panel__close--flat > b {
  color: var(--mvp-color-muted, rgba(128, 128, 128, 0.9));
}

.chart-panel__canvas-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chart-panel__canvas {
  width: 100%;
  height: auto;
  display: block;
}

.chart-panel__bootstrap {
  margin: 0;
  padding-top: 2px;
  font-size: 10px;
  color: var(--mvp-color-muted, rgba(128, 128, 128, 0.9));
}

@media (max-width: 768px) {
  .chart-panel__island {
    gap: var(--mvp-spacing-xs, 4px);
  }
  .chart-panel__summary {
    gap: var(--mvp-spacing-sm, 8px);
    font-size: 11px;
  }
}`;
