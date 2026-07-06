export type HomeFragments = {
  staticEditorial?: string | null;
  promotion?: string | null;
  recommendations?: string | null;
};

export const homeSeoCopy = {
  title: "MVP Storefront Home",
  description:
    "Discover curated offers and personalized recommendations in the MVP storefront.",
  body: "Shop the essentials with resilient server-rendered content, even when optional experiences are unavailable.",
};

export function renderHomeHtml(fragments: HomeFragments = {}) {
  const promotion =
    fragments.promotion ??
    `<section data-fragment="promotion-banner" data-fallback="true">Featured offers are loading.</section>`;
  const staticEditorial =
    fragments.staticEditorial ??
    `<section data-fragment="static-editorial-note" data-render-strategy="static">Static SSG sample</section>`;
  const recommendations =
    fragments.recommendations ??
    `<section data-fragment="recommendation-widget" data-fallback="true">Recommendations are loading.</section>`;

  return `<main data-page="home">
    <section>
      <h1>${homeSeoCopy.title}</h1>
      <p>${homeSeoCopy.description}</p>
      <p>${homeSeoCopy.body}</p>
    </section>
    ${staticEditorial}
    ${promotion}
    <section>
      <h2>No-JS readable collection</h2>
      <p>Browse durable bags, desk gear, audio essentials, and daily carry products without requiring client JavaScript.</p>
    </section>
    ${recommendations}
  </main>`;
}

export const usedUiComponents = [
  "Section",
  "Card",
  "Button",
  "Skeleton",
] as const;
