export type Product = {
  id: string;
  title: string;
  price: string;
  imageAlt: string;
  description: string;
};

export const products: Record<string, Product> = {
  "123": {
    id: "123",
    title: "Everyday Travel Pack",
    price: "$79",
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
      imageAlt: "MVP Product image",
      description:
        "A resilient product detail page with server-rendered commerce content.",
    }
  );
}
