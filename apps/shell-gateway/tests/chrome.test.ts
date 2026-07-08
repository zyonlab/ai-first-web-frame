import { describe, expect, it } from "vitest";
import { localeToLang } from "../src/chrome";

describe("shell chrome — locale mapping", () => {
  it("maps short locales to BCP-47 tags", () => {
    expect(localeToLang("en")).toBe("en-US");
    expect(localeToLang("zh")).toBe("zh-CN");
  });
});
