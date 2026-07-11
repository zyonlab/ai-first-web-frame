/**
 * Scoped CSS for the market-header fragment — single source of truth.
 *
 * This string is inlined once at the front of the fragment's SSR HTML (see
 * render), so the dense terminal styling reaches the browser even when the
 * composed page never fetches the standalone /assets/market-header.css file.
 *
 * Keep this in sync with assets/market-header.css (or src/market-header.css); the .css file
 * is retained so the css-budget audit still measures the fragment stylesheet.
 */
export const marketHeaderCss = `/*
 * Scoped market-header styles (served as /assets/market-header.css).
 * Directional 24h change uses the design-system semantic color variables
 * (\`--trade-up\` / \`--trade-down\`); no hard-coded hexes. Numeric cells
 * use the shared mono font token for tabular alignment. Small footprint to hold
 * the fragment CSS budget (<= 10KB).
 */

.market-header {
  border: 1px solid var(--trade-panel-border, rgba(128, 128, 128, 0.24));
  border-radius: var(--mvp-radius-sm, 4px);
  background: var(--mvp-color-surface, transparent);
}

.market-header__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mvp-spacing-md, 16px);
  padding: var(--mvp-spacing-sm, 8px) var(--mvp-spacing-md, 16px);
  font-family: var(
    --trade-font-mono,
    ui-monospace,
    "SFMono-Regular",
    monospace
  );
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  line-height: 1.4;
}

.market-header__pair {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.02em;
}

.market-header__stat {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
}

.market-header__caption {
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--mvp-color-muted, rgba(128, 128, 128, 0.9));
}

.market-header__stat > b,
.market-header__stat > time {
  font-weight: 600;
  font-style: normal;
}

.market-header__change--up > b {
  color: var(--trade-up, #12a150);
}

.market-header__change--down > b {
  color: var(--trade-down, #d1363f);
}

.market-header__change--flat > b {
  color: var(--mvp-color-muted, rgba(128, 128, 128, 0.9));
}

.market-header__countdown > time {
  font-variant-numeric: tabular-nums;
}

@media (max-width: 768px) {
  .market-header__row {
    gap: var(--mvp-spacing-sm, 8px);
    font-size: 11px;
  }
}`;
