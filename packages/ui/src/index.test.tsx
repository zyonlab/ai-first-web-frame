import {
  ComponentMetadataSchema,
  PerformanceBudgetSchema,
} from "@mvp/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Button,
  buttonBudget,
  buttonMetadata,
  Card,
  cardBudget,
  cardMetadata,
  Image,
  imageBudget,
  imageMetadata,
  ProductCardBase,
  productCardBaseBudget,
  productCardBaseMetadata,
  Section,
  Skeleton,
  sectionBudget,
  sectionMetadata,
  skeletonBudget,
  skeletonMetadata,
} from "./index";

describe("@mvp/ui", () => {
  it("renders server-safe components", () => {
    render(<Button>Checkout</Button>);
    expect(screen.getByRole("button", { name: "Checkout" })).toBeTruthy();
    render(<Card>Card content</Card>);
    expect(screen.getByText("Card content")).toBeTruthy();
    render(<Image src="/x.png" />);
    expect(screen.getByAltText("Product image")).toBeTruthy();
    render(
      <ProductCardBase
        title="商品标题"
        price="$20"
        imageSrc="/p.png"
        imageAlt="商品图片 alt"
        description="商品描述"
      />,
    );
    expect(screen.getByText("商品标题")).toBeTruthy();
    expect(screen.getByText("$20")).toBeTruthy();
    expect(screen.getByAltText("商品图片 alt")).toBeTruthy();
    render(<Section heading="首页标题">首页核心业务文案</Section>);
    expect(screen.getByRole("heading", { name: "首页标题" })).toBeTruthy();
    render(<Skeleton />);
    expect(document.querySelector("[aria-hidden='true']")).toBeTruthy();
  });

  it("validates every metadata and budget", () => {
    for (const item of [
      buttonMetadata,
      cardMetadata,
      imageMetadata,
      productCardBaseMetadata,
      sectionMetadata,
      skeletonMetadata,
    ]) {
      expect(ComponentMetadataSchema.parse(item).serverSafe).toBe(true);
    }
    for (const item of [
      buttonBudget,
      cardBudget,
      imageBudget,
      productCardBaseBudget,
      sectionBudget,
      skeletonBudget,
    ]) {
      expect(PerformanceBudgetSchema.parse(item).scope).toBe("component");
    }
  });
});
