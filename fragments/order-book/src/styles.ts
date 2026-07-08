/**
 * Scoped CSS for the order-book fragment — single source of truth.
 *
 * This string is inlined once at the front of the fragment's SSR HTML (see
 * render), so the dense terminal styling reaches the browser even when the
 * composed page never fetches the standalone /assets/order-book.css file.
 *
 * Keep this in sync with assets/order-book.css (or src/order-book.css); the .css file
 * is retained so the css-budget audit still measures the fragment stylesheet.
 */
export const orderBookCss = `.ob {
  display: flex;
  flex-direction: column;
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

.ob-grouping {
  display: flex;
  gap: var(--mvp-spacing-xs, 4px);
  padding: var(--mvp-spacing-xs, 4px);
  border-bottom: 1px solid var(--trade-panel-border, #23262f);
}

.ob-chip {
  min-width: 28px;
  padding: 2px 6px;
  border: 1px solid var(--trade-panel-border, #23262f);
  border-radius: var(--mvp-radius-sm, 4px);
  background: transparent;
  color: var(--trade-text-muted, #8a8f9a);
  font: inherit;
  cursor: pointer;
}

.ob-chip.is-active {
  background: var(--trade-chip-active, #23262f);
  color: var(--trade-text, #d6d9e0);
}

.ob-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.ob-head th {
  padding: 2px 8px;
  color: var(--trade-text-muted, #8a8f9a);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  text-align: right;
}

.ob-head th:first-child {
  text-align: left;
}

.ob-row {
  position: relative;
  height: 20px;
  line-height: 20px;
  cursor: pointer;
}

.ob-row > td {
  position: relative;
  z-index: 1;
  padding: 0 8px;
  text-align: right;
  white-space: nowrap;
}

.ob-row .ob-price {
  text-align: left;
}

.ob-row::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--depth, 0%);
  z-index: 0;
  opacity: 0.18;
  pointer-events: none;
}

.ob-bid::before {
  left: 0;
  background: var(--trade-buy, #1ea97c);
}

.ob-ask::before {
  right: 0;
  background: var(--trade-sell, #e5504d);
}

.ob-bid .ob-price {
  color: var(--trade-buy, #1ea97c);
}

.ob-ask .ob-price {
  color: var(--trade-sell, #e5504d);
}

.ob-row:hover {
  background: var(--trade-row-hover, rgba(255, 255, 255, 0.04));
}

.ob-row.is-flash-bid {
  background: var(--trade-flash-buy, rgba(30, 169, 124, 0.28));
}

.ob-row.is-flash-ask {
  background: var(--trade-flash-sell, rgba(229, 80, 77, 0.28));
}

.ob-spread td {
  padding: 2px 8px;
  color: var(--trade-text-muted, #8a8f9a);
  text-align: center;
  border-top: 1px solid var(--trade-panel-border, #23262f);
  border-bottom: 1px solid var(--trade-panel-border, #23262f);
}

.ob-spread-label {
  text-transform: uppercase;
  font-size: 10px;
}

.ob-mid {
  margin-left: var(--mvp-spacing-sm, 8px);
}

.ob-num {
  color: var(--trade-text, #d6d9e0);
}`;
