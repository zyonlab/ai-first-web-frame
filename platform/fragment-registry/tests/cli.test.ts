import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/cli";

describe("parseCliArgs", () => {
  it("parses --key value pairs", () => {
    const parsed = parseCliArgs([
      "--name",
      "price-panel",
      "--version",
      "0.1.0",
    ]);
    expect(parsed.flags).toEqual({ name: "price-panel", version: "0.1.0" });
    expect(parsed.positional).toEqual([]);
  });

  it("parses --key=value pairs", () => {
    const parsed = parseCliArgs(["--service-url=http://localhost:4203"]);
    expect(parsed.flags["service-url"]).toBe("http://localhost:4203");
  });

  it("parses boolean flags", () => {
    const parsed = parseCliArgs(["--with-compose", "--name", "x", "--remove"]);
    expect(parsed.flags["with-compose"]).toBe(true);
    expect(parsed.flags.remove).toBe(true);
    expect(parsed.flags.name).toBe("x");
  });

  it("collects positional arguments", () => {
    const parsed = parseCliArgs(["page-home", "--channel", "stable"]);
    expect(parsed.positional).toEqual(["page-home"]);
  });
});
