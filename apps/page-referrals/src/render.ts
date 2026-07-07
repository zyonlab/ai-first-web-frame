import { referralsSeoCopy } from "./metadata";

/**
 * Referrals page CSS (contract source:
 * docs/trade-demo/06-navigation-and-routing.md §4.5 — "/vaults + /referrals —
 * lightweight"). A static marketing-style page: intro copy, a mock referral
 * code, a rebate-tier table and program notes. It composes no fragment, ships
 * no client JS, and has no interactive island.
 *
 * All colors come from the frozen `@mvp/design-system` semantic tokens
 * (`--mvp-color-*`) and all spacing/radius from the token scale — no hard-coded
 * hex colors and no raw pixels for spacing (spine §13 / CLAUDE.md hard rule).
 *
 * Emitted as a plain string so the RSC page injects it once via a `<style>` tag
 * and tests can assert the layout regions exist without a browser.
 */
export const REFERRALS_LAYOUT_CLASS = "referrals-page" as const;

export const referralsLayoutCss = `
.${REFERRALS_LAYOUT_CLASS} {
  display: flex;
  flex-direction: column;
  gap: var(--mvp-spacing-lg);
  min-height: 100dvh;
  max-width: 880px;
  margin: 0 auto;
  padding: var(--mvp-spacing-lg);
  box-sizing: border-box;
  background: var(--mvp-color-surface-0);
  color: var(--mvp-color-ink);
}
.${REFERRALS_LAYOUT_CLASS} [data-area="referrals-head"] h1 {
  margin: 0 0 var(--mvp-spacing-sm);
  font-size: 1.75rem;
}
.${REFERRALS_LAYOUT_CLASS} [data-area="referrals-head"] p {
  margin: 0;
  max-width: 60ch;
  color: var(--mvp-color-text-muted);
}
.${REFERRALS_LAYOUT_CLASS} [data-area="referral-code"] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mvp-spacing-md);
  flex-wrap: wrap;
  padding: var(--mvp-spacing-md);
  border: 1px solid var(--mvp-color-border);
  border-radius: var(--mvp-radius-md);
  background: var(--mvp-color-surface-1);
}
.${REFERRALS_LAYOUT_CLASS} [data-area="referral-code"] dt {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--mvp-color-text-muted);
}
.${REFERRALS_LAYOUT_CLASS} [data-referral-code] {
  font-size: 1.25rem;
  font-family: var(--mvp-font-mono, monospace);
  letter-spacing: 0.08em;
  color: var(--mvp-color-accent);
}
.${REFERRALS_LAYOUT_CLASS} [data-area="referral-tiers"] {
  overflow-x: auto;
  min-width: 0;
  border: 1px solid var(--mvp-color-border);
  border-radius: var(--mvp-radius-md);
  background: var(--mvp-color-surface-1);
}
.${REFERRALS_LAYOUT_CLASS} table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.${REFERRALS_LAYOUT_CLASS} th,
.${REFERRALS_LAYOUT_CLASS} td {
  padding: var(--mvp-spacing-sm) var(--mvp-spacing-md);
  text-align: left;
  border-bottom: 1px solid var(--mvp-color-border);
}
.${REFERRALS_LAYOUT_CLASS} thead th {
  color: var(--mvp-color-text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.${REFERRALS_LAYOUT_CLASS} [data-area="referral-notes"] {
  margin: 0;
  padding-left: var(--mvp-spacing-lg);
  color: var(--mvp-color-text-muted);
  display: flex;
  flex-direction: column;
  gap: var(--mvp-spacing-xs, 0.25rem);
}

@media (max-width: 767px) {
  .${REFERRALS_LAYOUT_CLASS} {
    padding: var(--mvp-spacing-md);
    gap: var(--mvp-spacing-md);
  }
}
`.trim();

/** Mock referral code shown on the page (spine §4.5: "a mock referral code"). */
export const REFERRAL_CODE = "MVP-PERPS-7X4Q" as const;

/**
 * Static rebate-tier ladder. No realtime source; synthetic demo values that give
 * the referral program depth for the nav.
 */
export type ReferralTier = {
  tier: string;
  referredVolume: string;
  rebate: string;
};

export const referralTiers: readonly ReferralTier[] = [
  { tier: "Bronze", referredVolume: "$0 – $1M", rebate: "10%" },
  { tier: "Silver", referredVolume: "$1M – $10M", rebate: "20%" },
  { tier: "Gold", referredVolume: "$10M – $50M", rebate: "30%" },
  { tier: "Diamond", referredVolume: "$50M+", rebate: "40%" },
] as const;

export const referralNotes: readonly string[] = [
  "Rebates are paid daily in USDC from the fees your referrals generate.",
  "Your tier is recalculated from trailing 30-day referred volume.",
  "Self-referrals and wash trading are excluded from rebate accounting.",
] as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tierRowHtml(tier: ReferralTier): string {
  return `<tr data-tier="${tier.tier.toLowerCase()}"><td>${escapeHtml(tier.tier)}</td><td>${escapeHtml(tier.referredVolume)}</td><td>${escapeHtml(tier.rebate)}</td></tr>`;
}

/**
 * Assemble the referrals page as a pure HTML string. Used both for the no-JS SSR
 * baseline and for tests that assert the regions without a browser. The RSC page
 * (`app/referrals/page.tsx`) renders the same named regions via React.
 */
export function renderReferralsHtml(
  tiers: readonly ReferralTier[] = referralTiers,
  notes: readonly string[] = referralNotes,
): string {
  const rows = tiers.map(tierRowHtml).join("\n            ");
  const noteItems = notes
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("\n        ");

  return `<main data-page="referrals">
    <div class="${REFERRALS_LAYOUT_CLASS}">
      <div data-area="referrals-head">
        <h1>${referralsSeoCopy.title}</h1>
        <p>${referralsSeoCopy.description}</p>
      </div>

      <dl data-area="referral-code">
        <dt>Your referral code</dt>
        <dd data-referral-code>${REFERRAL_CODE}</dd>
      </dl>

      <div data-area="referral-tiers">
        <table>
          <thead>
            <tr><th>Tier</th><th>Referred volume</th><th>Fee rebate</th></tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>

      <ul data-area="referral-notes">
        ${noteItems}
      </ul>
    </div>
  </main>`;
}
