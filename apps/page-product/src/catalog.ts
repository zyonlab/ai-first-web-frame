export type Product = {
  id: string;
  title: string;
  price: string;
  /**
   * Path to a file that actually ships in `public/`. It used to be derived from
   * the id as `/products/<id>.jpg`, and no such file existed for any id: Next's
   * image optimizer fetched it, got a 404, and answered the browser with 400.
   * The runtime gate saw that as a console error on every product page.
   */
  image: string;
  imageAlt: string;
  description: string;
};

/** The one image this demo ships. SVG would not work here — Next's optimizer
 * rejects SVG with 400 unless `dangerouslyAllowSVG` is set, which would put the
 * bug straight back. */
const PLACEHOLDER_IMAGE = "/products/placeholder.png";

export const products: Record<string, Product> = {
  "123": {
    id: "123",
    title: "Everyday Travel Pack",
    price: "$79",
    image: PLACEHOLDER_IMAGE,
    imageAlt: "Everyday Travel Pack in slate fabric",
    description:
      "A durable everyday bag with padded laptop storage and weather-resistant fabric.",
  },
};

export function getProduct(id: string): Product {
  return (
    products[id] ?? {
      id,
      title: "MVP Product",
      price: "$49",
      image: PLACEHOLDER_IMAGE,
      imageAlt: "MVP Product image",
      description:
        "A resilient product detail page with server-rendered commerce content.",
    }
  );
}
