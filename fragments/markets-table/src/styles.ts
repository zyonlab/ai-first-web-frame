/**
 * Scoped CSS for the markets-table fragment — single source of truth.
 *
 * This string is inlined once at the front of the fragment's SSR HTML (see
 * render), so the dense terminal styling reaches the browser even when the
 * composed page never fetches the standalone /assets/markets-table.css file.
 *
 * Keep this in sync with assets/markets-table.css (or src/markets-table.css); the .css file
 * is retained so the css-budget audit still measures the fragment stylesheet.
 */
export const marketsTableCss = `/**
 * markets-table scoped styles.
 *
 * Pure SSR, no island: semantic up/down colors come from design tokens
 * (\`--mvp-color-up\` / \`--mvp-color-down\`) with token fallbacks only. Numeric
 * columns are equal-width tabular-nums monospace so prices align. Each row is a
 * deep-link anchor; the row highlights on hover/focus. All selectors are scoped
 * under \`[data-fragment="markets-table"]\`.
 */

[data-fragment="markets-table"] {
  display: block;
  width: 100%;
  border: 1px solid var(--trade-panel-border, rgba(128, 128, 128, 0.24));
  border-radius: var(--mvp-radius-sm, 4px);
  overflow-x: auto;
  background: var(--mvp-color-surface, transparent);
}

[data-fragment="markets-table"] .markets-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(
    --trade-font-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace
  );
  font-size: var(--mvp-font-size-sm, 13px);
}

[data-fragment="markets-table"] .markets-table__head .markets-table__col {
  text-align: right;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: var(--mvp-font-size-xs, 11px);
  font-weight: 600;
  color: var(--mvp-color-muted, rgba(128, 128, 128, 0.9));
  padding: var(--mvp-spacing-sm, 8px) var(--mvp-spacing-md, 16px);
  border-bottom: 1px solid var(--trade-panel-border, rgba(128, 128, 128, 0.24));
}

[data-fragment="markets-table"] .markets-table__col--symbol,
[data-fragment="markets-table"] .markets-table__cell--symbol {
  text-align: left;
}

[data-fragment="markets-table"] .markets-table__col--action,
[data-fragment="markets-table"] .markets-table__cell--action {
  text-align: center;
}

[data-fragment="markets-table"] .markets-table__row {
  border-bottom: 1px solid var(--trade-panel-border, rgba(128, 128, 128, 0.16));
}

[data-fragment="markets-table"] .markets-table__row:hover,
[data-fragment="markets-table"] .markets-table__row:focus-within {
  background: var(--trade-row-hover, rgba(128, 128, 128, 0.1));
}

[data-fragment="markets-table"] .markets-table__cell {
  padding: var(--mvp-spacing-sm, 8px) var(--mvp-spacing-md, 16px);
  color: var(--mvp-color-text, inherit);
  white-space: nowrap;
}

/* Equal-width tabular numeric columns so prices/percentages align. */
[data-fragment="markets-table"] .markets-table__cell--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

[data-fragment="markets-table"] .markets-table__cell--symbol {
  font-weight: 600;
}

[data-fragment="markets-table"] .markets-table__link {
  color: inherit;
  text-decoration: none;
}

[data-fragment="markets-table"] .markets-table__link:hover,
[data-fragment="markets-table"] .markets-table__link:focus-visible {
  text-decoration: underline;
}

[data-fragment="markets-table"] .markets-table__change--up {
  color: var(--mvp-color-up, #12a150);
}

[data-fragment="markets-table"] .markets-table__change--down {
  color: var(--mvp-color-down, #d1363f);
}

[data-fragment="markets-table"] .markets-table__change--flat {
  color: var(--mvp-color-muted, rgba(128, 128, 128, 0.9));
}

[data-fragment="markets-table"] .markets-table__trade {
  display: inline-block;
  min-width: 24px;
  padding: 0 var(--mvp-spacing-sm, 8px);
  color: var(--mvp-color-accent, inherit);
  text-decoration: none;
  font-weight: 600;
}

[data-fragment="markets-table"] .markets-table__trade:hover,
[data-fragment="markets-table"] .markets-table__trade:focus-visible {
  text-decoration: underline;
}

[data-fragment="markets-table"][data-fallback="true"] {
  padding: var(--mvp-spacing-md, 16px);
  color: var(--mvp-color-muted, rgba(128, 128, 128, 0.9));
}`;
