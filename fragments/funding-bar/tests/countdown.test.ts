import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  formatFundingRate,
  fundingCountdownLabel,
  fundingCountdownMs,
  fundingRateDirection,
} from "../src/countdown";

describe("fundingCountdownMs (pure, deterministic given now)", () => {
  it("returns the remaining ms until next funding", () => {
    expect(fundingCountdownMs(1_000, 61_000)).toBe(60_000);
  });

  it("clamps to zero once the funding time has passed", () => {
    expect(fundingCountdownMs(100_000, 90_000)).toBe(0);
    expect(fundingCountdownMs(90_000, 90_000)).toBe(0);
  });
});

describe("formatCountdown", () => {
  it("formats ms as HH:MM:SS with zero padding", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(1_000)).toBe("00:00:01");
    expect(formatCountdown(61_000)).toBe("00:01:01");
    // 8h - 1s
    expect(formatCountdown(8 * 3_600_000 - 1_000)).toBe("07:59:59");
    // exactly 8h
    expect(formatCountdown(8 * 3_600_000)).toBe("08:00:00");
  });

  it("floors sub-second remainders (deterministic label)", () => {
    expect(formatCountdown(1_999)).toBe("00:00:01");
    expect(formatCountdown(999)).toBe("00:00:00");
  });

  it("never returns a negative label", () => {
    expect(formatCountdown(-5_000)).toBe("00:00:00");
  });
});

describe("fundingCountdownLabel (now + nextFundingTs -> label)", () => {
  it("composes clamp + format into a stable label", () => {
    const now = 1_700_000_000_000;
    const nextFundingTs = now + (2 * 3600 + 3 * 60 + 4) * 1000;
    expect(fundingCountdownLabel(now, nextFundingTs)).toBe("02:03:04");
  });

  it("is 00:00:00 when funding is already due", () => {
    expect(fundingCountdownLabel(1_000, 500)).toBe("00:00:00");
  });
});

describe("fundingRateDirection (semantic up/down/flat)", () => {
  it("maps sign to direction", () => {
    expect(fundingRateDirection(0.0001)).toBe("up");
    expect(fundingRateDirection(-0.0001)).toBe("down");
    expect(fundingRateDirection(0)).toBe("flat");
  });
});

describe("formatFundingRate", () => {
  it("renders a signed percentage with fixed decimals", () => {
    expect(formatFundingRate(0.0001)).toBe("+0.0100%");
    expect(formatFundingRate(-0.0001)).toBe("-0.0100%");
    expect(formatFundingRate(0)).toBe("0.0000%");
  });
});
