import { describe, expect, it } from "vitest";
import {
  applyPromoteFragment,
  applyRegisterFragment,
  applyRollbackFragment,
  type ReleaseRecord,
} from "../src/mutations";

const baseRegistry = {
  fragments: {
    "promotion-banner": {
      stable: {
        version: "0.1.0",
        serviceUrl: "http://localhost:4201",
        manifestUrl: "http://localhost:4201/manifest",
      },
      canary: {
        version: "0.2.0-beta.1",
        serviceUrl: "http://localhost:4201",
        manifestUrl: "http://localhost:4201/manifest",
      },
    },
  },
};

describe("applyRegisterFragment", () => {
  it("adds a new fragment entry with a derived manifest url", () => {
    const result = applyRegisterFragment(baseRegistry, {
      name: "price-panel",
      version: "0.1.0",
      serviceUrl: "http://localhost:4203",
      channel: "canary",
    });
    expect(result.changed).toBe(true);
    expect(result.action).toBe("added");
    expect(result.registry.fragments["price-panel"]).toMatchObject({
      canary: {
        version: "0.1.0",
        serviceUrl: "http://localhost:4203",
        manifestUrl: "http://localhost:4203/manifest",
      },
    });
    expect(
      result.registry.fragments["price-panel"].versions?.["0.1.0"],
    ).toMatchObject({ version: "0.1.0" });
  });

  it("does not mutate the input registry", () => {
    applyRegisterFragment(baseRegistry, {
      name: "price-panel",
      version: "0.1.0",
      serviceUrl: "http://localhost:4203",
    });
    expect(baseRegistry.fragments["price-panel"]).toBeUndefined();
  });

  it("updates an existing channel entry", () => {
    const result = applyRegisterFragment(baseRegistry, {
      name: "promotion-banner",
      version: "0.2.0-beta.2",
      serviceUrl: "http://localhost:4201",
      channel: "canary",
    });
    expect(result.action).toBe("updated");
    expect(result.registry.fragments["promotion-banner"].canary?.version).toBe(
      "0.2.0-beta.2",
    );
  });

  it("is idempotent when the entry already matches", () => {
    const input = {
      name: "promotion-banner",
      version: "0.1.0",
      serviceUrl: "http://localhost:4201",
      channel: "stable" as const,
    };
    const first = applyRegisterFragment(baseRegistry, input);
    const second = applyRegisterFragment(first.registry, input);
    expect(second.changed).toBe(false);
    expect(second.action).toBe("unchanged");
    expect(second.registry).toEqual(first.registry);
  });

  it("rejects invalid fragment names", () => {
    expect(() =>
      applyRegisterFragment(baseRegistry, {
        name: "PricePanel",
        version: "0.1.0",
        serviceUrl: "http://localhost:4203",
      }),
    ).toThrow(/kebab-case/);
  });

  it("rejects invalid service urls", () => {
    expect(() =>
      applyRegisterFragment(baseRegistry, {
        name: "price-panel",
        version: "0.1.0",
        serviceUrl: "localhost:4203",
      }),
    ).toThrow(/serviceUrl/);
  });

  it("rejects invalid channels", () => {
    expect(() =>
      applyRegisterFragment(baseRegistry, {
        name: "price-panel",
        version: "0.1.0",
        serviceUrl: "http://localhost:4203",
        channel: "beta" as never,
      }),
    ).toThrow(/channel/);
  });
});

describe("applyPromoteFragment", () => {
  it("promotes canary to stable and records history", () => {
    const result = applyPromoteFragment(baseRegistry, "promotion-banner");
    const entry = result.registry.fragments["promotion-banner"];
    expect(result.changed).toBe(true);
    expect(entry.stable?.version).toBe("0.2.0-beta.1");
    expect(entry.canary).toBeUndefined();
    expect(entry.versions?.["0.1.0"]?.version).toBe("0.1.0");
    expect(entry.versions?.["0.2.0-beta.1"]?.version).toBe("0.2.0-beta.1");
    expect(result.release).toMatchObject({
      unit: "fragment",
      name: "promotion-banner",
      version: "0.2.0-beta.1",
      channel: "stable",
      rollbackTo: "0.1.0",
    });
    expect(result.release?.releasedAt).toBeTruthy();
  });

  it("promotes a fragment without an existing stable", () => {
    const registry = {
      fragments: {
        "price-panel": {
          canary: {
            version: "0.1.0",
            serviceUrl: "http://localhost:4203",
            manifestUrl: "http://localhost:4203/manifest",
          },
        },
      },
    };
    const result = applyPromoteFragment(registry, "price-panel");
    expect(result.registry.fragments["price-panel"].stable?.version).toBe(
      "0.1.0",
    );
    expect(result.release?.rollbackTo).toBeUndefined();
  });

  it("throws when there is no canary channel", () => {
    const registry = {
      fragments: {
        "recommendation-widget": {
          stable: {
            version: "0.1.0",
            serviceUrl: "http://localhost:4202",
            manifestUrl: "http://localhost:4202/manifest",
          },
        },
      },
    };
    expect(() =>
      applyPromoteFragment(registry, "recommendation-widget"),
    ).toThrow(/canary/);
  });

  it("throws for unknown fragments", () => {
    expect(() => applyPromoteFragment(baseRegistry, "missing")).toThrow(
      /not registered/,
    );
  });
});

describe("applyRollbackFragment", () => {
  it("restores the previous stable recorded by promote", () => {
    const promoted = applyPromoteFragment(baseRegistry, "promotion-banner");
    const releases: ReleaseRecord[] = [promoted.release as ReleaseRecord];
    const result = applyRollbackFragment(
      promoted.registry,
      releases,
      "promotion-banner",
    );
    const entry = result.registry.fragments["promotion-banner"];
    expect(result.changed).toBe(true);
    expect(entry.stable?.version).toBe("0.1.0");
    expect(entry.versions?.["0.2.0-beta.1"]?.version).toBe("0.2.0-beta.1");
    expect(result.release).toMatchObject({
      unit: "fragment",
      name: "promotion-banner",
      version: "0.1.0",
      channel: "stable",
    });
  });

  it("supports rolling back to an explicit pinned version", () => {
    const promoted = applyPromoteFragment(baseRegistry, "promotion-banner");
    const result = applyRollbackFragment(
      promoted.registry,
      [promoted.release as ReleaseRecord],
      "promotion-banner",
      "0.1.0",
    );
    expect(result.registry.fragments["promotion-banner"].stable?.version).toBe(
      "0.1.0",
    );
  });

  it("throws when no rollback target is recorded", () => {
    expect(() =>
      applyRollbackFragment(baseRegistry, [], "promotion-banner"),
    ).toThrow(/rollback target/);
  });

  it("throws when the target version is not in the versions history", () => {
    const promoted = applyPromoteFragment(baseRegistry, "promotion-banner");
    expect(() =>
      applyRollbackFragment(
        promoted.registry,
        [promoted.release as ReleaseRecord],
        "promotion-banner",
        "9.9.9",
      ),
    ).toThrow(/9\.9\.9/);
  });
});
