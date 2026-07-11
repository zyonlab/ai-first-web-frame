import { act } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearIslandRegistry,
  configureIslandRuntime,
  hydrateIslands,
  type IslandSnapshot,
  mountIsland,
  readIslandSnapshot,
  registerIsland,
  type SnapshotMismatchInfo,
} from "./index";

/**
 * Builds a mount node `<div data-island="<name>">` with an adjacent inline
 * `<script type="application/json">` snapshot, exactly the frozen markup
 * contract (README §14 D4) that fragment agents must emit.
 */
function buildMountNode(
  name: string,
  snapshot: IslandSnapshot,
): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-island", name);
  const script = document.createElement("script");
  script.setAttribute("type", "application/json");
  script.setAttribute("data-island-props", name);
  script.textContent = JSON.stringify(snapshot);
  el.appendChild(script);
  return el;
}

afterEach(() => {
  clearIslandRegistry();
  document.body.innerHTML = "";
});

describe("readIslandSnapshot", () => {
  it("reads props + slice from the adjacent JSON script", () => {
    const snapshot: IslandSnapshot = {
      props: { symbol: "BTC", price: 42000 },
      slice: "orderDraft",
    };
    const el = buildMountNode("orderForm", snapshot);
    const read = readIslandSnapshot(el);
    expect(read).toEqual(snapshot);
  });

  it("reads fragment/version/contractHash (C2 handshake fields) when present", () => {
    const snapshot: IslandSnapshot = {
      props: { symbol: "BTC" },
      slice: "orderDraft",
      fragment: "order-form",
      version: "0.1.0",
      contractHash: "abc123",
    };
    const el = buildMountNode("orderForm", snapshot);
    expect(readIslandSnapshot(el)).toEqual(snapshot);
  });

  it("returns an empty snapshot when no script is present", () => {
    const el = document.createElement("div");
    el.setAttribute("data-island", "orderForm");
    expect(readIslandSnapshot(el)).toEqual({ props: {} });
  });

  it("returns an empty snapshot on malformed JSON", () => {
    const el = document.createElement("div");
    el.setAttribute("data-island", "orderForm");
    const script = document.createElement("script");
    script.setAttribute("type", "application/json");
    script.textContent = "{not json";
    el.appendChild(script);
    expect(readIslandSnapshot(el)).toEqual({ props: {} });
  });
});

describe("mountIsland", () => {
  it("mounts the registered island component with snapshot props", () => {
    registerIsland("orderForm", (props: { symbol?: string }) =>
      createElement("span", { "data-testid": "sym" }, props.symbol),
    );
    const el = buildMountNode("orderForm", { props: { symbol: "ETH" } });
    document.body.appendChild(el);

    let handle: { unmount(): void } | undefined;
    act(() => {
      handle = mountIsland(el, { props: { symbol: "ETH" } });
    });
    expect(el.querySelector("[data-testid='sym']")?.textContent).toBe("ETH");

    act(() => handle?.unmount());
    expect(el.querySelector("[data-testid='sym']")).toBeNull();
  });

  it("reads props from the inline snapshot when opts.props is omitted", () => {
    registerIsland("orderForm", (props: { symbol?: string }) =>
      createElement("span", { "data-testid": "sym" }, props.symbol),
    );
    const el = buildMountNode("orderForm", { props: { symbol: "SOL" } });
    document.body.appendChild(el);

    act(() => {
      mountIsland(el);
    });
    expect(el.querySelector("[data-testid='sym']")?.textContent).toBe("SOL");
  });

  it("throws when the island name is not registered", () => {
    const el = buildMountNode("missing", { props: {} });
    expect(() => mountIsland(el)).toThrow(/no registered island/i);
  });

  it("throws when the element carries no data-island name", () => {
    const el = document.createElement("div");
    expect(() => mountIsland(el)).toThrow(/data-island/i);
  });
});

describe("C2 snapshot version handshake", () => {
  it("hydrates normally when the snapshot version matches the registered expectation", () => {
    registerIsland(
      "orderForm",
      (props: { symbol?: string }) =>
        createElement("span", { "data-testid": "sym" }, props.symbol),
      { expectedVersion: "0.1.0" },
    );
    const el = buildMountNode("orderForm", {
      props: { symbol: "BTC" },
      fragment: "order-form",
      version: "0.1.0",
    });
    document.body.appendChild(el);

    act(() => {
      mountIsland(el);
    });
    expect(el.querySelector("[data-testid='sym']")?.textContent).toBe("BTC");
  });

  it("skips hydration and leaves the SSR DOM untouched on a version mismatch", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerIsland(
      "orderForm",
      (props: { symbol?: string }) =>
        createElement("span", { "data-testid": "sym" }, props.symbol),
      { expectedVersion: "2.0.0" },
    );
    const el = buildMountNode("orderForm", {
      props: { symbol: "BTC" },
      fragment: "order-form",
      version: "1.0.0",
    });
    // Snapshot the SSR-only markup (the mount node's original children) before
    // attempting to hydrate — a skipped hydration must leave it byte-identical.
    const ssrHtmlBefore = el.innerHTML;
    document.body.appendChild(el);

    let handle: { unmount(): void } | undefined;
    act(() => {
      handle = mountIsland(el);
    });

    // No React content was ever rendered into the node.
    expect(el.querySelector("[data-testid='sym']")).toBeNull();
    expect(el.innerHTML).toBe(ssrHtmlBefore);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/snapshot mismatch/i);

    // The returned handle is a safe no-op (callers never need to null-check).
    expect(() => handle?.unmount()).not.toThrow();
    warnSpy.mockRestore();
  });

  it("invokes the configureIslandRuntime mismatch callback with the expected/actual info", () => {
    const onSnapshotMismatch = vi.fn<(info: SnapshotMismatchInfo) => void>();
    configureIslandRuntime({ onSnapshotMismatch });
    registerIsland("orderForm", () => createElement("span"), {
      expectedVersion: "2.0.0",
      expectedContractHash: "expected-hash",
    });
    const el = buildMountNode("orderForm", {
      props: {},
      fragment: "order-form",
      version: "1.0.0",
      contractHash: "actual-hash",
    });
    document.body.appendChild(el);

    act(() => {
      mountIsland(el);
    });

    expect(onSnapshotMismatch).toHaveBeenCalledTimes(1);
    expect(onSnapshotMismatch).toHaveBeenCalledWith({
      island: "orderForm",
      expected: { version: "2.0.0", contractHash: "expected-hash" },
      actual: {
        fragment: "order-form",
        version: "1.0.0",
        contractHash: "actual-hash",
      },
      reason: "version-mismatch",
    });
  });

  it("flags a contract-hash mismatch even when the version matches", () => {
    const onSnapshotMismatch = vi.fn<(info: SnapshotMismatchInfo) => void>();
    configureIslandRuntime({ onSnapshotMismatch });
    registerIsland("orderForm", () => createElement("span"), {
      expectedVersion: "0.1.0",
      expectedContractHash: "expected-hash",
    });
    const el = buildMountNode("orderForm", {
      props: {},
      fragment: "order-form",
      version: "0.1.0",
      contractHash: "drifted-hash",
    });
    document.body.appendChild(el);

    act(() => {
      mountIsland(el);
    });

    expect(el.querySelector("span")).toBeNull();
    expect(onSnapshotMismatch).toHaveBeenCalledTimes(1);
    expect(onSnapshotMismatch.mock.calls[0]?.[0]?.reason).toBe(
      "contract-hash-mismatch",
    );
  });

  it("falls back to hydrating normally when the snapshot omits version (backward compat)", () => {
    // Old/non-participating fragment: it hasn't adopted the C2 handshake yet,
    // so its snapshot has no `version` at all. Forcing every fragment to opt
    // in immediately would be a breaking change, so the safer default is to
    // hydrate normally rather than treat "absent" as "mismatched" (see the
    // comment on `detectSnapshotMismatch` in ./index.ts).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerIsland(
      "orderForm",
      (props: { symbol?: string }) =>
        createElement("span", { "data-testid": "sym" }, props.symbol),
      { expectedVersion: "2.0.0" },
    );
    const el = buildMountNode("orderForm", { props: { symbol: "BTC" } });
    document.body.appendChild(el);

    act(() => {
      mountIsland(el);
    });

    expect(el.querySelector("[data-testid='sym']")?.textContent).toBe("BTC");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("hydrates unconditionally when registerIsland is called without an expectation", () => {
    // No third argument at all -> opted out of the handshake entirely,
    // preserving today's behavior for every island that doesn't pass one.
    registerIsland("orderForm", (props: { symbol?: string }) =>
      createElement("span", { "data-testid": "sym" }, props.symbol),
    );
    const el = buildMountNode("orderForm", {
      props: { symbol: "BTC" },
      version: "some-other-version-nobody-checks",
    });
    document.body.appendChild(el);

    act(() => {
      mountIsland(el);
    });
    expect(el.querySelector("[data-testid='sym']")?.textContent).toBe("BTC");
  });
});

describe("A2 island snapshot schema validation", () => {
  it("skips hydration and reports reason: invalid-snapshot on malformed JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onSnapshotMismatch = vi.fn<(info: SnapshotMismatchInfo) => void>();
    configureIslandRuntime({ onSnapshotMismatch });
    registerIsland("orderForm", (props: { symbol?: string }) =>
      createElement("span", { "data-testid": "sym" }, props.symbol),
    );
    const el = document.createElement("div");
    el.setAttribute("data-island", "orderForm");
    const script = document.createElement("script");
    script.setAttribute("type", "application/json");
    script.textContent = "{not json";
    el.appendChild(script);
    // Snapshot the SSR-only markup before attempting to hydrate — a skipped
    // hydration must leave it byte-identical, exactly like the C2 mismatch path.
    const ssrHtmlBefore = el.innerHTML;
    document.body.appendChild(el);

    let handle: { unmount(): void } | undefined;
    act(() => {
      handle = mountIsland(el);
    });

    expect(el.querySelector("[data-testid='sym']")).toBeNull();
    expect(el.innerHTML).toBe(ssrHtmlBefore);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/invalid snapshot/i);
    expect(onSnapshotMismatch).toHaveBeenCalledTimes(1);
    expect(onSnapshotMismatch.mock.calls[0]?.[0]?.reason).toBe(
      "invalid-snapshot",
    );
    expect(onSnapshotMismatch.mock.calls[0]?.[0]?.island).toBe("orderForm");

    // The returned handle is a safe no-op (callers never need to null-check).
    expect(() => handle?.unmount()).not.toThrow();
    warnSpy.mockRestore();
  });

  it("skips hydration when the snapshot is valid JSON but not an object (e.g. an array)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onSnapshotMismatch = vi.fn<(info: SnapshotMismatchInfo) => void>();
    configureIslandRuntime({ onSnapshotMismatch });
    registerIsland("orderForm", () =>
      createElement("span", { "data-testid": "sym" }),
    );
    const el = document.createElement("div");
    el.setAttribute("data-island", "orderForm");
    const script = document.createElement("script");
    script.setAttribute("type", "application/json");
    script.textContent = JSON.stringify([1, 2, 3]);
    el.appendChild(script);
    document.body.appendChild(el);

    act(() => {
      mountIsland(el);
    });

    expect(el.querySelector("[data-testid='sym']")).toBeNull();
    expect(onSnapshotMismatch).toHaveBeenCalledTimes(1);
    expect(onSnapshotMismatch.mock.calls[0]?.[0]?.reason).toBe(
      "invalid-snapshot",
    );
    warnSpy.mockRestore();
  });

  it("skips hydration when a typed field has the wrong type (e.g. version is a number)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onSnapshotMismatch = vi.fn<(info: SnapshotMismatchInfo) => void>();
    configureIslandRuntime({ onSnapshotMismatch });
    registerIsland("orderForm", () =>
      createElement("span", { "data-testid": "sym" }),
    );
    const el = document.createElement("div");
    el.setAttribute("data-island", "orderForm");
    const script = document.createElement("script");
    script.setAttribute("type", "application/json");
    script.textContent = JSON.stringify({ props: {}, version: 123 });
    el.appendChild(script);
    document.body.appendChild(el);

    act(() => {
      mountIsland(el);
    });

    expect(el.querySelector("[data-testid='sym']")).toBeNull();
    expect(onSnapshotMismatch.mock.calls[0]?.[0]?.reason).toBe(
      "invalid-snapshot",
    );
    warnSpy.mockRestore();
  });

  it("still hydrates normally for a snapshot missing every optional field (old fragment, no version)", () => {
    // A2's new validation must not regress the pre-existing backward-compat
    // guarantee: a snapshot that only carries `props` (no slice/fragment/
    // version/contractHash — an old, non-participating fragment) is a VALID
    // snapshot, not a malformed one, and still hydrates exactly as today.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerIsland("orderForm", (props: { symbol?: string }) =>
      createElement("span", { "data-testid": "sym" }, props.symbol),
    );
    const el = buildMountNode("orderForm", { props: { symbol: "BTC" } });
    document.body.appendChild(el);

    act(() => {
      mountIsland(el);
    });

    expect(el.querySelector("[data-testid='sym']")?.textContent).toBe("BTC");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("hydrateIslands", () => {
  it("mounts every data-island node under the root and returns handles", () => {
    registerIsland("a", () => createElement("i", { "data-mark": "a" }, "A"));
    registerIsland("b", () => createElement("i", { "data-mark": "b" }, "B"));
    const root = document.createElement("div");
    root.appendChild(buildMountNode("a", { props: {} }));
    root.appendChild(buildMountNode("b", { props: {} }));
    document.body.appendChild(root);

    let handles: Array<{ unmount(): void }> = [];
    act(() => {
      handles = hydrateIslands(root);
    });
    expect(handles).toHaveLength(2);
    expect(root.querySelector("[data-mark='a']")).not.toBeNull();
    expect(root.querySelector("[data-mark='b']")).not.toBeNull();

    act(() => {
      for (const h of handles) h.unmount();
    });
  });

  it("skips unregistered islands instead of throwing", () => {
    registerIsland("known", () => createElement("i", { "data-mark": "k" }));
    const root = document.createElement("div");
    root.appendChild(buildMountNode("known", { props: {} }));
    root.appendChild(buildMountNode("unknown", { props: {} }));
    document.body.appendChild(root);

    let handles: Array<{ unmount(): void }> = [];
    act(() => {
      handles = hydrateIslands(root);
    });
    expect(handles).toHaveLength(1);
  });

  it("defaults to document when no root is given", () => {
    registerIsland("doc", () => createElement("i", { "data-mark": "doc" }));
    document.body.appendChild(buildMountNode("doc", { props: {} }));
    let handles: Array<{ unmount(): void }> = [];
    act(() => {
      handles = hydrateIslands();
    });
    expect(handles).toHaveLength(1);
    act(() => {
      for (const h of handles) h.unmount();
    });
  });
});
