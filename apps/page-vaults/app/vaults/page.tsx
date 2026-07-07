import { vaultsSeoCopy } from "../../src/metadata";
import { VAULTS_LAYOUT_CLASS, vaultCards } from "../../src/render";

/**
 * `/vaults` is a lightweight, fully server-rendered content page (spine §4.5).
 * It composes no fragment and ships no client JS, so it is a good ISR
 * demonstration: rebuild the static HTML at most once an hour.
 */
export const revalidate = 3600;

export default function VaultsPage() {
  return (
    <main data-page="vaults">
      <div className={VAULTS_LAYOUT_CLASS}>
        <div data-area="vaults-head">
          <h1>{vaultsSeoCopy.title}</h1>
          <p>{vaultsSeoCopy.description}</p>
        </div>

        <div data-area="vaults-grid">
          {vaultCards.map((vault) => (
            <article key={vault.slug} data-vault-card data-vault={vault.slug}>
              <h2>{vault.name}</h2>
              <p>{vault.strategy}</p>
              <dl data-vault-stats>
                <div data-stat="apy">
                  <dt>APY</dt>
                  <dd>{vault.apy}</dd>
                </div>
                <div data-stat="tvl">
                  <dt>TVL</dt>
                  <dd>{vault.tvl}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
