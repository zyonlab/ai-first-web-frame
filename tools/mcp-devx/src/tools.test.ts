import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { devxTools, SCRIPT_TOOLS } from "./tools";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const script = (name: string) => {
  const tool = SCRIPT_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool;
};

describe("devxTools registry", () => {
  it("exposes query_registry plus every lifecycle tool", () => {
    const names = devxTools().map((t) => t.name);
    expect(names).toContain("query_registry");
    for (const t of SCRIPT_TOOLS) expect(names).toContain(t.name);
    // Every tool has a description + object input schema.
    for (const t of devxTools()) {
      expect(t.description.length).toBeGreaterThan(0);
      expect((t.inputSchema as { type?: string }).type).toBe("object");
    }
  });
});

describe("lifecycle arg mapping (pure)", () => {
  it("register_fragment maps input to the script's flags", () => {
    expect(
      script("register_fragment").args({
        name: "price-panel",
        version: "0.1.0",
        serviceUrl: "http://localhost:4203",
        channel: "canary",
        withCompose: true,
      }),
    ).toEqual([
      "--name",
      "price-panel",
      "--version",
      "0.1.0",
      "--service-url",
      "http://localhost:4203",
      "--channel",
      "canary",
      "--with-compose",
    ]);
  });

  it("mount_slot uses --fragment when mounting and --remove when removing", () => {
    expect(
      script("mount_slot").args({
        page: "page-home",
        slot: "pricePanel",
        fragment: "price-panel",
        strategy: "dynamic-ssr",
        timeoutMs: 200,
      }),
    ).toEqual([
      "--page",
      "page-home",
      "--slot",
      "pricePanel",
      "--fragment",
      "price-panel",
      "--strategy",
      "dynamic-ssr",
      "--timeout-ms",
      "200",
    ]);
    expect(
      script("mount_slot").args({
        page: "page-home",
        slot: "pricePanel",
        remove: true,
      }),
    ).toEqual(["--page", "page-home", "--slot", "pricePanel", "--remove"]);
  });

  it("rollback_fragment forwards an optional pinned version", () => {
    expect(script("rollback_fragment").args({ name: "order-book" })).toEqual([
      "--name",
      "order-book",
    ]);
    expect(
      script("rollback_fragment").args({ name: "order-book", to: "0.1.0" }),
    ).toEqual(["--name", "order-book", "--to", "0.1.0"]);
  });
});

describe("query_registry handler (in-process, real repo)", () => {
  it("returns the live unit graph and honors a dependents query", async () => {
    const tool = devxTools().find((t) => t.name === "query_registry");
    if (!tool) throw new Error("query_registry missing");
    const all = JSON.parse((await tool.handler({}, { root: ROOT })).text);
    expect(all.status).toBe("ok");
    expect(all.units.some((u: { id: string }) => u.id === "order-book")).toBe(
      true,
    );

    const deps = JSON.parse(
      (await tool.handler({ dependentsOf: "order-book" }, { root: ROOT })).text,
    );
    expect(deps.units.map((u: { id: string }) => u.id)).toContain("page-trade");
  });
});
