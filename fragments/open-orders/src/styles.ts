/**
 * Scoped CSS for the open-orders fragment — single source of truth.
 *
 * This string is inlined once at the front of the fragment's SSR HTML (see
 * render), so the dense terminal styling reaches the browser even when the
 * composed page never fetches the standalone /assets/open-orders.css file.
 *
 * Keep this in sync with assets/open-orders.css (or src/open-orders.css); the .css file
 * is retained so the css-budget audit still measures the fragment stylesheet.
 */
export const openOrdersCss = `.oo-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1px solid var(--trade-panel-border, #23262f);
  border-radius: var(--mvp-radius-sm, 4px);
  background: var(--trade-panel-bg, #0e1015);
  color: var(--trade-text, #d6d9e0);
  font-family: var(
    --trade-font-mono,
    ui-monospace,
    "SFMono-Regular",
    monospace
  );
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}

.oo-head th {
  padding: 2px 8px;
  color: var(--trade-text-muted, #8a8f9a);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  text-align: right;
  border-bottom: 1px solid var(--trade-panel-border, #23262f);
}

.oo-head th:first-child,
.oo-col--action {
  text-align: left;
}

.oo-row {
  height: 24px;
  line-height: 24px;
}

.oo-row > td {
  padding: 0 8px;
  text-align: right;
  white-space: nowrap;
}

.oo-cell--symbol,
.oo-cell--side,
.oo-cell--type {
  text-align: left;
}

.oo-row--buy .oo-cell--side {
  color: var(--trade-buy, #1ea97c);
}

.oo-row--sell .oo-cell--side {
  color: var(--trade-sell, #e5504d);
}

.oo-row:hover {
  background: var(--trade-row-hover, rgba(255, 255, 255, 0.04));
}

.oo-cancel {
  padding: 1px 8px;
  border: 1px solid var(--trade-panel-border, #23262f);
  border-radius: var(--mvp-radius-sm, 4px);
  background: transparent;
  color: var(--trade-text-muted, #8a8f9a);
  font: inherit;
  cursor: pointer;
}

.oo-cancel:hover {
  border-color: var(--trade-sell, #e5504d);
  color: var(--trade-sell, #e5504d);
}

.oo-empty td {
  padding: 8px;
  color: var(--trade-text-muted, #8a8f9a);
  text-align: center;
}`;
