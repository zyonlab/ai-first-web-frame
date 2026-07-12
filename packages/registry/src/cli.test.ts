import { describe, expect, it } from "vitest";
import { parseCliArgs, unknownFlagError } from "./cli";

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

describe("unknownFlagError", () => {
  const KNOWN = ["name", "version", "service-url", "channel", "with-compose"];

  it("returns undefined when every flag is known", () => {
    const args = parseCliArgs(["--name", "x", "--channel", "canary"]);
    expect(unknownFlagError(args, KNOWN)).toBeUndefined();
  });

  it("returns undefined for empty args and positionals-only args", () => {
    expect(unknownFlagError(parseCliArgs([]), KNOWN)).toBeUndefined();
    expect(
      unknownFlagError(parseCliArgs(["page-home"]), KNOWN),
    ).toBeUndefined();
  });

  it("rejects a typo'd flag with a did-you-mean suggestion", () => {
    const args = parseCliArgs(["--chanel", "canary", "--name", "x"]);
    expect(unknownFlagError(args, KNOWN)).toBe(
      "unknown flag --chanel (did you mean --channel?)",
    );
  });

  it("rejects an unknown boolean flag", () => {
    const args = parseCliArgs(["--name", "x", "--with-compose", "--forcee"]);
    expect(unknownFlagError(args, KNOWN)).toBe("unknown flag --forcee");
  });

  it("suggests via prefix match when no close-edit-distance flag exists", () => {
    const args = parseCliArgs(["--serv", "http://localhost:4203"]);
    expect(unknownFlagError(args, KNOWN)).toBe(
      "unknown flag --serv (did you mean --service-url?)",
    );
  });

  it("omits the suggestion when nothing is close", () => {
    const args = parseCliArgs(["--totally-unrelated", "1"]);
    expect(unknownFlagError(args, KNOWN)).toBe(
      "unknown flag --totally-unrelated",
    );
  });
});
