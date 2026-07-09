import { describe, expect, it } from "vitest";
import { __placeholder } from "./index";

describe("@mvp/trade-theme", () => {
  it("exports a placeholder ahead of the P1 migration (see README.md)", () => {
    expect(__placeholder).toBe(true);
  });
});
