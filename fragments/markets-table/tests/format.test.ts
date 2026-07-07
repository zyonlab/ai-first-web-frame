import { describe, expect, it } from "vitest";
import {
  changeDirection,
  formatChangePct,
  formatFundingRate,
  formatPrice,
  formatVolume,
  tradeHref,
} from "../src/format";

describe("changeDirection", () => {
  it("classifies sign into up/down/flat", () => {
    expect(changeDirection(0.01)).toBe("up");
    expect(changeDirection(-0.01)).toBe("down");
    expect(changeDirection(0)).toBe("flat");
  });
});

describe("formatPrice", () => {
  it("uses 2 decimals + grouping for large prices", () => {
    expect(formatPrice(64_117.5)).toBe("64,117.50");
  });
  it("uses 4 decimals for small prices", () => {
    expect(formatPrice(0.5)).toBe("0.5000");
  });
});

describe("formatChangePct", () => {
  it("signs a positive change", () => {
    expect(formatChangePct(0.0124)).toBe("+1.24%");
  });
  it("keeps the native minus for a negative change", () => {
    expect(formatChangePct(-0.0058)).toBe("-0.58%");
  });
  it("renders zero without a sign", () => {
    expect(formatChangePct(0)).toBe("0.00%");
  });
});

describe("formatFundingRate", () => {
  it("signs a funding rate to 4 decimals", () => {
    expect(formatFundingRate(0.000101)).toBe("+0.0101%");
    expect(formatFundingRate(-0.000044)).toBe("-0.0044%");
  });
});

describe("formatVolume", () => {
  it("compacts billions and millions", () => {
    expect(formatVolume(1_200_000_000)).toBe("1.20B");
    expect(formatVolume(640_000_000)).toBe("640.00M");
    expect(formatVolume(12_500)).toBe("12.50K");
    expect(formatVolume(42)).toBe("42.00");
  });
});

describe("tradeHref", () => {
  it("builds the deep link path with an uppercased symbol", () => {
    expect(tradeHref("btc")).toBe("/trade/BTC");
    expect(tradeHref(" eth ")).toBe("/trade/ETH");
  });
});
