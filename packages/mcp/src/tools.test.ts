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

  it("mount_slot appends --check for the manifest↔gen freshness check (refactor plan §3.2)", () => {
    // Minimal check call: just { page, check: true } is enough to verify
    // fragmentSlots.gen.ts, matching mount-slot.mts's own `!check &&
    // (!slotName || ...)` validation (slot/fragment aren't required in
    // check mode).
    expect(
      script("mount_slot").args({ page: "page-home", check: true }),
    ).toEqual(["--page", "page-home", "--check"]);

    // The same invocation shape used to mount a slot can be reused with
    // --check appended, per mount-slot.mts's documented reuse pattern; the
    // script ignores --slot/--fragment/etc. when --check is present.
    expect(
      script("mount_slot").args({
        page: "page-home",
        slot: "pricePanel",
        fragment: "price-panel",
        strategy: "dynamic-ssr",
        check: true,
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
      "--check",
    ]);

    // check: false (or omitted) never appends --check.
    expect(
      script("mount_slot").args({
        page: "page-home",
        slot: "pricePanel",
        fragment: "price-panel",
        check: false,
      }),
    ).toEqual([
      "--page",
      "page-home",
      "--slot",
      "pricePanel",
      "--fragment",
      "price-panel",
    ]);
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

  it("affected shells to the graph engine (scripts/affected-graph.mts), not the retired heuristic engine", () => {
    const tool = script("affected");
    expect(tool.command).toEqual([
      "exec",
      "tsx",
      "scripts/affected-graph.mts",
      "--json",
    ]);
    expect(tool.args({})).toEqual([]);
    expect(tool.args({ base: "origin/main" })).toEqual([
      "--base",
      "origin/main",
    ]);
    expect(tool.args({ base: "origin/main", head: "HEAD" })).toEqual([
      "--base",
      "origin/main",
      "--head",
      "HEAD",
    ]);
  });
});

describe("input validation against declared inputSchema (M5)", () => {
  const tool = (name: string) => {
    const found = devxTools().find((t) => t.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };
  const root = "/nonexistent-root-never-touched";

  it("rejects a wrong-typed argument with its path and expected type, before spawning", async () => {
    // A bogus root proves the handler short-circuits before any subprocess
    // or filesystem access — a spawn against this root would fail loudly.
    const result = await tool("mount_slot").handler({ page: 123 }, { root });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.text);
    expect(parsed.status).toBe("failed");
    expect(parsed.tool).toBe("mount_slot");
    expect(parsed.error).toBe(
      "invalid arguments: arguments.page must be of type string (got number)",
    );
  });

  it("rejects missing required properties", async () => {
    const result = await tool("register_fragment").handler(
      { name: "price-panel", version: "0.1.0" },
      { root },
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.text).error).toBe(
      'invalid arguments: arguments is missing required property "serviceUrl"',
    );
  });

  it("rejects enum violations (register_fragment channel)", async () => {
    const result = await tool("register_fragment").handler(
      {
        name: "price-panel",
        version: "0.1.0",
        serviceUrl: "http://localhost:4203",
        channel: "prod",
      },
      { root },
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.text).error).toContain(
      'arguments.channel must be one of: "canary", "stable"',
    );
  });

  it("rejects non-string scaffold names instead of passing an empty positional", async () => {
    const result = await tool("scaffold_component").handler(
      { name: 42 },
      { root },
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.text).error).toBe(
      "invalid arguments: arguments.name must be of type string (got number)",
    );
  });

  it("rejects a non-array / wrong-item-typed changed list on affected_units", async () => {
    const notArray = await tool("affected_units").handler(
      { changed: "order-book" },
      { root },
    );
    expect(notArray.isError).toBe(true);
    expect(JSON.parse(notArray.text).error).toBe(
      "invalid arguments: arguments.changed must be of type array (got string)",
    );

    const wrongItem = await tool("affected_units").handler(
      { changed: [1] },
      { root },
    );
    expect(wrongItem.isError).toBe(true);
    expect(JSON.parse(wrongItem.text).error).toBe(
      "invalid arguments: arguments.changed[0] must be of type string (got number)",
    );
  });

  it("allows extra keys (inputSchemas do not set additionalProperties: false)", async () => {
    const result = await tool("query_registry").handler(
      { kind: "component", somethingExtra: true },
      { root: ROOT },
    );
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text).status).toBe("ok");
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

  // Confirms the post-P1 layout is actually wired up end to end, not just
  // that the graph builder returns *some* fragment nodes from manifest.ts
  // files (which would pass even with a broken registry path): the
  // channel/version/serviceUrl on a fragment unit only get populated by
  // successfully reading `registry/registry.data.json` (moved there in P1;
  // formerly `platform/fragment-registry/src/registry.data.json`) via
  // `tools/release-tools/src/load-graph.ts`'s `loadRegistry()`. If that path
  // resolution were still broken by the P1 move, these fields would all be
  // `undefined` even though the fragment node itself would still exist.
  it("resolves real registry.data.json fields (channel/version/serviceUrl) for order-book", async () => {
    const tool = devxTools().find((t) => t.name === "query_registry");
    if (!tool) throw new Error("query_registry missing");
    const result = JSON.parse(
      (await tool.handler({ name: "order-book" }, { root: ROOT })).text,
    );
    const orderBook = result.units.find(
      (u: { id: string }) => u.id === "order-book",
    );
    expect(orderBook).toBeDefined();
    expect(orderBook.channel).toBe("canary");
    expect(orderBook.version).toBe("0.1.0");
    expect(orderBook.serviceUrl).toBe("http://localhost:4204");
  });
});

describe("mount_slot --check handler (real repo, spawns the script)", () => {
  // This is the one test here that leaves the process: the `mount_slot` handler
  // runs `pnpm exec tsx scripts/mount-slot.mts` through spawnSync, so its cost
  // is pnpm + tsx startup (~0.7s on an idle machine), not the check itself. Under
  // `pnpm test` the whole turbo graph builds and tests concurrently, and on a
  // contended CI runner that startup went past vitest's implicit 5s default and
  // failed the gate. The budget is explicit so a slow runner is not a red build,
  // while still being tight enough that a genuine hang surfaces quickly.
  it("reports page-home's generated fragmentSlots.gen.ts as fresh (checked into the repo, untouched by this test)", {
    timeout: 30_000,
  }, async () => {
    const tool = devxTools().find((t) => t.name === "mount_slot");
    if (!tool) throw new Error("mount_slot missing");
    const result = await tool.handler(
      { page: "page-home", check: true },
      { root: ROOT },
    );
    const parsed = JSON.parse(result.text);
    expect(result.isError).toBeFalsy();
    expect(parsed.status).toBe("fresh");
    expect(parsed.files).toEqual([]);
  });
});
