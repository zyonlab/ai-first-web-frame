/**
 * Scoped CSS for the order-form fragment — single source of truth.
 *
 * This string is inlined once at the front of the fragment's SSR HTML (see
 * render), so the dense terminal styling reaches the browser even when the
 * composed page never fetches the standalone /assets/order-form.css file.
 *
 * Keep this in sync with assets/order-form.css (or src/order-form.css); the .css file
 * is retained so the css-budget audit still measures the fragment stylesheet.
 */
export const orderFormCss = `/* order-form scoped styles — token-backed, no hard-coded colors (spine §13). */
[data-fragment="order-form"] {
  display: block;
  font: inherit;
}
[data-fragment="order-form"] .of-form {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--mvp-border, #2a2e39);
  border-radius: 8px;
  background: var(--mvp-surface-1, #12151c);
}
[data-fragment="order-form"] .of-side,
[data-fragment="order-form"] .of-type {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
[data-fragment="order-form"] .of-side button,
[data-fragment="order-form"] .of-type button {
  padding: 8px 10px;
  border: 1px solid var(--mvp-border, #2a2e39);
  border-radius: 6px;
  background: var(--mvp-surface-2, #1a1e27);
  color: var(--mvp-text, #d7dae0);
  cursor: pointer;
}
[data-fragment="order-form"]
  .of-side
  button[aria-selected="true"][data-side="buy"] {
  background: var(--mvp-positive, #16a34a);
  color: var(--mvp-on-accent, #fff);
}
[data-fragment="order-form"]
  .of-side
  button[aria-selected="true"][data-side="sell"] {
  background: var(--mvp-negative, #dc2626);
  color: var(--mvp-on-accent, #fff);
}
[data-fragment="order-form"] .of-type button[aria-selected="true"] {
  border-color: var(--mvp-accent, #3b82f6);
}
[data-fragment="order-form"] .of-field {
  display: grid;
  gap: 4px;
  font-size: 13px;
}
[data-fragment="order-form"] .of-field input[type="number"] {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--mvp-border, #2a2e39);
  border-radius: 6px;
  background: var(--mvp-surface-2, #1a1e27);
  color: var(--mvp-text, #d7dae0);
}
[data-fragment="order-form"] .of-reduce-only {
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 8px;
}
[data-fragment="order-form"] .of-leverage-track {
  height: 4px;
  border-radius: 2px;
  background: var(--mvp-surface-2, #1a1e27);
}
[data-fragment="order-form"] .of-margin {
  display: grid;
  gap: 4px;
  margin: 0;
  font-size: 12px;
  color: var(--mvp-text-muted, #8b90a0);
}
[data-fragment="order-form"] .of-margin > div {
  display: flex;
  justify-content: space-between;
}
[data-fragment="order-form"] .of-margin dt,
[data-fragment="order-form"] .of-margin dd {
  margin: 0;
}
[data-fragment="order-form"] .of-submit {
  padding: 10px;
  border: 0;
  border-radius: 6px;
  font-weight: 600;
  color: var(--mvp-on-accent, #fff);
  cursor: pointer;
}
[data-fragment="order-form"] .of-submit-buy {
  background: var(--mvp-positive, #16a34a);
}
[data-fragment="order-form"] .of-submit-sell {
  background: var(--mvp-negative, #dc2626);
}
[data-fragment="order-form"] .of-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
[data-fragment="order-form"] .of-ack {
  margin: 0;
  font-size: 12px;
  color: var(--mvp-text-muted, #8b90a0);
}
[data-fragment="order-form"][data-fallback="true"] {
  padding: 12px;
  color: var(--mvp-text-muted, #8b90a0);
}`;
