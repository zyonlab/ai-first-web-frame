/**
 * Scoped CSS for the account-bar fragment — single source of truth.
 *
 * This string is inlined once at the front of the fragment's SSR HTML (see
 * render), so the dense terminal styling reaches the browser even when the
 * composed page never fetches the standalone /assets/account-bar.css file.
 *
 * Keep this in sync with assets/account-bar.css (or src/account-bar.css); the .css file
 * is retained so the css-budget audit still measures the fragment stylesheet.
 */
export const accountBarCss = `/*
 * Scoped account-bar styles (served as /assets/account-bar.css).
 * The margin-usage meter is driven by a \`--usage\` custom property (0..1) so the
 * bar fills with zero JS at SSR time; the island rewrites \`--usage\` on a
 * leverage-driven preview. Numeric cells use the shared mono font token for
 * tabular alignment. No hard-coded hexes for semantic color — the meter fill
 * uses the design-system accent/down variables. Small footprint to hold the
 * fragment CSS budget (<= 10KB).
 */

.account-bar {
  border: 1px solid var(--trade-panel-border, rgba(128, 128, 128, 0.24));
  border-radius: var(--mvp-radius-sm, 4px);
  background: var(--mvp-color-surface, transparent);
}

.account-bar__row {
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

.account-bar__stat {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
}

.account-bar__caption {
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--mvp-color-muted, rgba(128, 128, 128, 0.9));
}

.account-bar__stat > b {
  font-weight: 600;
  font-style: normal;
}

.account-bar__meter {
  min-width: 120px;
}

.account-bar__meter-track {
  display: block;
  height: 4px;
  border-radius: 2px;
  background: var(--mvp-color-muted, rgba(128, 128, 128, 0.24));
  overflow: hidden;
}

.account-bar__meter-fill {
  display: block;
  height: 100%;
  /* --usage is a 0..1 ratio set inline by SSR and patched by the island. */
  width: calc(var(--usage, 0) * 100%);
  background: var(--mvp-color-accent, var(--trade-up, #12a150));
  transition: width 120ms ease-out;
}

/* High usage tips the meter into the "down"/warning color. */
.account-bar__meter[style*="--usage:0.9"] .account-bar__meter-fill,
.account-bar__meter[style*="--usage:1"] .account-bar__meter-fill {
  background: var(--trade-down, #d1363f);
}

@media (max-width: 768px) {
  .account-bar__row {
    gap: var(--mvp-spacing-sm, 8px);
    font-size: 11px;
  }
}`;
