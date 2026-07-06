import { act } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearIslandRegistry,
  hydrateIslands,
  type IslandSnapshot,
  mountIsland,
  readIslandSnapshot,
  registerIsland,
} from "./island";

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
