import { vaultsSeoCopy } from "./metadata";

/**
 * Vaults page CSS (contract source: docs/trade-demo/06-navigation-and-routing.md
 * §4.5 — "/vaults + /referrals — lightweight"). This is a pure static / ISR
 * content page: a title + intro above a grid of example vault cards. It composes
 * no fragment, ships no client JS, and has no interactive island.
 *
 * All colors come from the frozen `@mvp/design-system` semantic tokens
 * (`--mvp-color-*`) and all spacing/radius from the token scale — no hard-coded
 * hex colors and no raw pixels for spacing (spine §13 / CLAUDE.md hard rule).
 *
 * Emitted as a plain string so the RSC page injects it once via a `<style>` tag
 * and tests can assert the layout regions exist without a browser.
 */
export const VAULTS_LAYOUT_CLASS = "vaults-page" as const;

export const vaultsLayoutCss = `
.${VAULTS_LAYOUT_CLASS} {
  display: flex;
  flex-direction: column;
  gap: var(--mvp-spacing-lg);
  min-height: 100dvh;
  max-width: 1120px;
  margin: 0 auto;
  padding: var(--mvp-spacing-lg);
  box-sizing: border-box;
  background: var(--mvp-color-surface-0);
  color: var(--mvp-color-ink);
}
.${VAULTS_LAYOUT_CLASS} [data-area="vaults-head"] h1 {
  margin: 0 0 var(--mvp-spacing-sm);
  font-size: 1.75rem;
}
.${VAULTS_LAYOUT_CLASS} [data-area="vaults-head"] p {
  margin: 0;
  max-width: 60ch;
  color: var(--mvp-color-text-muted);
}
.${VAULTS_LAYOUT_CLASS} [data-area="vaults-grid"] {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--mvp-spacing-md);
}
.${VAULTS_LAYOUT_CLASS} [data-vault-card] {
  display: flex;
  flex-direction: column;
  gap: var(--mvp-spacing-sm);
  padding: var(--mvp-spacing-md);
  border: 1px solid var(--mvp-color-border);
  border-radius: var(--mvp-radius-md);
  background: var(--mvp-color-surface-1);
}
.${VAULTS_LAYOUT_CLASS} [data-vault-card] h2 {
  margin: 0;
  font-size: 1.125rem;
}
.${VAULTS_LAYOUT_CLASS} [data-vault-card] p {
  margin: 0;
  color: var(--mvp-color-text-muted);
}
.${VAULTS_LAYOUT_CLASS} [data-vault-stats] {
  display: flex;
  justify-content: space-between;
  gap: var(--mvp-spacing-md);
  margin-top: auto;
}
.${VAULTS_LAYOUT_CLASS} [data-stat] {
  display: flex;
  flex-direction: column;
}
.${VAULTS_LAYOUT_CLASS} [data-stat] dt {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--mvp-color-text-muted);
}
.${VAULTS_LAYOUT_CLASS} [data-stat] dd {
  margin: 0;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}
.${VAULTS_LAYOUT_CLASS} [data-stat="apy"] dd {
  color: var(--mvp-color-positive);
}

@media (max-width: 767px) {
  .${VAULTS_LAYOUT_CLASS} {
    padding: var(--mvp-spacing-md);
    gap: var(--mvp-spacing-md);
  }
}
`.trim();

/**
 * Static placeholder vault data. No realtime source (spine §4.5: "no realtime");
 * these are synthetic demo values to give the nav depth.
 */
export type VaultCard = {
  slug: string;
  name: string;
  strategy: string;
  apy: string;
  tvl: string;
};

export const vaultCards: readonly VaultCard[] = [
  {
    slug: "btc-basis",
    name: "BTC Basis",
    strategy: "Delta-neutral funding capture on BTC perps.",
    apy: "12.4%",
    tvl: "$18.2M",
  },
  {
    slug: "eth-mm",
    name: "ETH Market Maker",
    strategy: "Automated two-sided liquidity on the ETH book.",
    apy: "9.1%",
    tvl: "$11.7M",
  },
  {
    slug: "stable-yield",
    name: "Stable Yield",
    strategy: "Low-volatility carry across stablecoin pairs.",
    apy: "6.8%",
    tvl: "$24.9M",
  },
  {
    slug: "sol-momentum",
    name: "SOL Momentum",
    strategy: "Trend-following allocation on SOL perps.",
    apy: "15.3%",
    tvl: "$5.4M",
  },
] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function vaultCardHtml(vault: VaultCard): string {
  return `<article data-vault-card data-vault="${vault.slug}">
        <h2>${escapeHtml(vault.name)}</h2>
        <p>${escapeHtml(vault.strategy)}</p>
        <dl data-vault-stats>
          <div data-stat="apy"><dt>APY</dt><dd>${escapeHtml(vault.apy)}</dd></div>
          <div data-stat="tvl"><dt>TVL</dt><dd>${escapeHtml(vault.tvl)}</dd></div>
        </dl>
      </article>`;
}

/**
 * Assemble the vaults page as a pure HTML string. Used both for the no-JS SSR
 * baseline and for tests that assert layout regions / cards without a browser.
 * The RSC page (`app/vaults/page.tsx`) renders the same named regions via React.
 */
export function renderVaultsHtml(
  cards: readonly VaultCard[] = vaultCards,
): string {
  const cardsHtml = cards.map(vaultCardHtml).join("\n      ");

  return `<main data-page="vaults">
    <div class="${VAULTS_LAYOUT_CLASS}">
      <div data-area="vaults-head">
        <h1>${vaultsSeoCopy.title}</h1>
        <p>${vaultsSeoCopy.description}</p>
      </div>
      <div data-area="vaults-grid">
      ${cardsHtml}
      </div>
    </div>
  </main>`;
}
