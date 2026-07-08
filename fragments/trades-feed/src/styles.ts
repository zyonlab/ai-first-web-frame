/**
 * Scoped CSS for the trades-feed fragment — single source of truth.
 *
 * This string is inlined once at the front of the fragment's SSR HTML (see
 * render), so the dense terminal styling reaches the browser even when the
 * composed page never fetches the standalone /assets/trades-feed.css file.
 *
 * Keep this in sync with assets/trades-feed.css; the .css file is retained so
 * the css-budget audit still measures the fragment stylesheet.
 */
export const tradesFeedCss = `.trades-tape {
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
  overflow: hidden;
}

.trades-tape__head {
  border-bottom: 1px solid var(--trade-panel-border, #23262f);
}

.trades-tape__col {
  padding: 2px 8px;
  color: var(--trade-text-muted, #8a8f9a);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  text-align: right;
}

.trades-tape__col--time {
  text-align: left;
}

.trades-tape__row {
  height: 18px;
  line-height: 18px;
}

.trades-tape__row:hover {
  background: var(--trade-row-hover, rgba(255, 255, 255, 0.04));
}

.trades-tape__cell {
  padding: 0 8px;
  text-align: right;
  white-space: nowrap;
}

.trades-tape__cell--time {
  text-align: left;
  color: var(--trade-text-muted, #8a8f9a);
}

.trades-tape__cell--price {
  font-weight: 500;
}

.trades-tape__row--buy .trades-tape__cell--price {
  color: var(--trade-buy, #1ea97c);
}

.trades-tape__row--sell .trades-tape__cell--price {
  color: var(--trade-sell, #e5504d);
}`;
