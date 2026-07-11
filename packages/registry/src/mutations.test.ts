import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileConflictError, MISSING_FILE_HASH } from "./atomic-file";
import {
  applyPromoteFragment,
  applyRegisterFragment,
  applyRollbackFragment,
  type FragmentRegistryData,
  loadRegistryData,
  loadReleases,
  type ReleaseRecord,
  saveRegistryData,
  saveReleases,
} from "./mutations";

const baseRegistry: FragmentRegistryData = {
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

  it("stays idempotent when an already-registered version is re-registered with identical values", () => {
    const input = {
      name: "promotion-banner",
      version: "0.1.0",
      serviceUrl: "http://localhost:4201",
      manifestUrl: "http://localhost:4201/manifest",
      channel: "stable" as const,
    };
    const first = applyRegisterFragment(baseRegistry, input);
    expect(
      first.registry.fragments["promotion-banner"].versions?.["0.1.0"],
    ).toMatchObject({ serviceUrl: "http://localhost:4201" });
    const second = applyRegisterFragment(first.registry, input);
    expect(second.changed).toBe(false);
    expect(second.action).toBe("unchanged");
    expect(second.registry).toEqual(first.registry);
  });

  it("refuses to overwrite an existing version with different values", () => {
    const registered = applyRegisterFragment(baseRegistry, {
      name: "price-panel",
      version: "0.1.0",
      serviceUrl: "http://localhost:4203",
      channel: "canary",
    });
    expect(() =>
      applyRegisterFragment(registered.registry, {
        name: "price-panel",
        version: "0.1.0",
        serviceUrl: "http://localhost:9999",
        channel: "canary",
      }),
    ).toThrow(/already registered.*different|version.*conflict/i);
  });

  it("refuses a conflicting rewrite even when it targets a different channel than the recorded version", () => {
    const registered = applyRegisterFragment(baseRegistry, {
      name: "price-panel",
      version: "0.1.0",
      serviceUrl: "http://localhost:4203",
      channel: "canary",
    });
    expect(() =>
      applyRegisterFragment(registered.registry, {
        name: "price-panel",
        version: "0.1.0",
        serviceUrl: "http://localhost:4203",
        manifestUrl: "http://localhost:4203/some-other-manifest",
        channel: "stable",
      }),
    ).toThrow(/already registered/i);
  });

  it("mentions bumping the version in the conflict error", () => {
    const registered = applyRegisterFragment(baseRegistry, {
      name: "price-panel",
      version: "0.1.0",
      serviceUrl: "http://localhost:4203",
      channel: "canary",
    });
    expect(() =>
      applyRegisterFragment(registered.registry, {
        name: "price-panel",
        version: "0.1.0",
        serviceUrl: "http://localhost:9999",
        channel: "canary",
      }),
    ).toThrow(/bump/i);
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

describe("registry persistence with optimistic concurrency", () => {
  function tempRegistryPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "mvp-registry-"));
    const path = join(dir, "registry.data.json");
    writeFileSync(path, `${JSON.stringify(baseRegistry, null, 2)}\n`);
    return path;
  }

  it("load returns data plus a content hash and save round-trips atomically", () => {
    const path = tempRegistryPath();
    const loaded = loadRegistryData(path);
    expect(loaded.data.fragments["promotion-banner"]).toBeDefined();
    expect(loaded.hash).not.toBe(MISSING_FILE_HASH);
    const mutated = applyRegisterFragment(loaded.data, {
      name: "price-panel",
      version: "0.1.0",
      serviceUrl: "http://localhost:4203",
      channel: "canary",
    });
    saveRegistryData(path, mutated.registry, loaded.hash);
    expect(loadRegistryData(path).data.fragments["price-panel"]).toBeDefined();
  });

  it("save refuses when another writer changed the registry since load", () => {
    const path = tempRegistryPath();
    const loaded = loadRegistryData(path);
    const other = applyRegisterFragment(loaded.data, {
      name: "other-panel",
      version: "0.1.0",
      serviceUrl: "http://localhost:4204",
    });
    writeFileSync(path, `${JSON.stringify(other.registry, null, 2)}\n`);
    const mine = applyRegisterFragment(loaded.data, {
      name: "price-panel",
      version: "0.1.0",
      serviceUrl: "http://localhost:4203",
    });
    expect(() => saveRegistryData(path, mine.registry, loaded.hash)).toThrow(
      FileConflictError,
    );
    // The concurrent writer's content survives untouched.
    const after = loadRegistryData(path);
    expect(after.data.fragments["other-panel"]).toBeDefined();
    expect(after.data.fragments["price-panel"]).toBeUndefined();
  });

  it("does not write the file when a conflicting version re-registration is refused", () => {
    const path = tempRegistryPath();
    const loaded = loadRegistryData(path);
    const registered = applyRegisterFragment(loaded.data, {
      name: "price-panel",
      version: "0.1.0",
      serviceUrl: "http://localhost:4203",
      channel: "canary",
    });
    saveRegistryData(path, registered.registry, loaded.hash);
    const reloaded = loadRegistryData(path);

    expect(() =>
      applyRegisterFragment(reloaded.data, {
        name: "price-panel",
        version: "0.1.0",
        serviceUrl: "http://localhost:9999",
        channel: "canary",
      }),
    ).toThrow(/already registered/i);

    // No save was attempted, so the file on disk must be unchanged.
    const after = loadRegistryData(path);
    expect(after.hash).toBe(reloaded.hash);
    expect(
      after.data.fragments["price-panel"]?.versions?.["0.1.0"],
    ).toMatchObject({ serviceUrl: "http://localhost:4203" });
  });

  it("loadReleases tolerates a missing file and its hash lets the first save create it", () => {
    const dir = mkdtempSync(join(tmpdir(), "mvp-releases-"));
    const path = join(dir, "releases.json");
    const loaded = loadReleases(path);
    expect(loaded.data).toEqual({ releases: [] });
    expect(loaded.hash).toBe(MISSING_FILE_HASH);
    const promoted = applyPromoteFragment(baseRegistry, "promotion-banner");
    saveReleases(
      path,
      { releases: [promoted.release as ReleaseRecord] },
      loaded.hash,
    );
    expect(loadReleases(path).data.releases).toHaveLength(1);
  });
});
