import { referralsSeoCopy } from "../../src/metadata";
import {
  REFERRAL_CODE,
  REFERRALS_LAYOUT_CLASS,
  referralNotes,
  referralTiers,
} from "../../src/render";

/**
 * `/referrals` is a lightweight, fully server-rendered marketing page (spine
 * §4.5). It composes no fragment and ships no client JS; the content is static
 * so it renders as static HTML at build time.
 */
export const dynamic = "force-static";

export default function ReferralsPage() {
  return (
    <main data-page="referrals">
      <div className={REFERRALS_LAYOUT_CLASS}>
        <div data-area="referrals-head">
          <h1>{referralsSeoCopy.title}</h1>
          <p>{referralsSeoCopy.description}</p>
        </div>

        <dl data-area="referral-code">
          <dt>Your referral code</dt>
          <dd data-referral-code>{REFERRAL_CODE}</dd>
        </dl>

        <div data-area="referral-tiers">
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th>Referred volume</th>
                <th>Fee rebate</th>
              </tr>
            </thead>
            <tbody>
              {referralTiers.map((tier) => (
                <tr key={tier.tier} data-tier={tier.tier.toLowerCase()}>
                  <td>{tier.tier}</td>
                  <td>{tier.referredVolume}</td>
                  <td>{tier.rebate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul data-area="referral-notes">
          {referralNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
