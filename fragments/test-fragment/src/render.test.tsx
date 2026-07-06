import { describe, expect, it } from "vitest";
import { renderTestFragment } from "./render";

describe("test-fragment", () => {
  it("renders HTML", () => {
    expect(renderTestFragment().html).toContain("test-fragment");
  });
});
