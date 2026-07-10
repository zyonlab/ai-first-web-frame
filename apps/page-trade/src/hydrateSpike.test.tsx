import { act } from "@testing-library/react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SpikeOrderFormLoader } from "./hydrateSpike";
import { getTradeStore, resetTradeStore } from "./tradeStore";

/** Builds a `data:` URL ES module exporting a mock `mountOrderFormIsland`,
 * mirroring `fragments/order-form/src/island.browser.ts`'s real export. Lets
 * the test drive a genuine runtime `import()` (Node/happy-dom natively
 * support `data:` URL dynamic imports) without needing a real HTTP server. */
function dataModuleUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

const MOCK_MOUNT_CALLS: Array<{
  el: Element;
  props: Record<string, unknown>;
}> = [];
const MOCK_UNMOUNTS: Element[] = [];

/** Registered globally so the `data:` module (which cannot import test-file
 * scope) can report back what it was called with. */
(globalThis as Record<string, unknown>).__spikeMountCalls = MOCK_MOUNT_CALLS;
(globalThis as Record<string, unknown>).__spikeUnmounts = MOCK_UNMOUNTS;

const MOCK_MODULE_URL = dataModuleUrl(`
  export function mountOrderFormIsland(el, props) {
    globalThis.__spikeMountCalls.push({ el, props });
    el.setAttribute("data-mock-mounted", "true");
    return () => { globalThis.__spikeUnmounts.push(el); };
  }
`);

function buildSnapshotDom(): void {
  document.body.innerHTML = "";
  const script = document.createElement("script");
  script.setAttribute("type", "application/json");
  script.setAttribute("data-island-props", "orderForm");
  script.textContent = JSON.stringify({
    props: {
      symbol: "BTC",
      draft: { side: "buy", type: "market", leverage: 1, reduceOnly: false },
      account: { equity: 100, used: 10, free: 90, maintenance: 0 },
    },
    slice: "trade.order-draft",
  });
  document.body.appendChild(script);
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  MOCK_MOUNT_CALLS.length = 0;
  MOCK_UNMOUNTS.length = 0;
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  resetTradeStore();
});

describe("SpikeOrderFormLoader (C3 spike, §4.3.3)", () => {
  it("reports blocked when no SSR data-island-props snapshot is present", async () => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(SpikeOrderFormLoader, { moduleUrl: MOCK_MODULE_URL }),
      );
    });
    // Effects (including the async run()) have settled by now.
    await act(async () => {});

    const status = container.querySelector("[data-spike-status]");
    expect(status?.textContent).toMatch(/blocked/);
    expect(MOCK_MOUNT_CALLS).toHaveLength(0);
  });

  it("loads the module via a genuine runtime import(), mounts into its own sandbox node, and passes the SSR snapshot props + shared store", async () => {
    buildSnapshotDom();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(SpikeOrderFormLoader, { moduleUrl: MOCK_MODULE_URL }),
      );
    });
    // Let the dynamic import() + mount microtasks flush.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const status = container.querySelector("[data-spike-status]");
    expect(status?.textContent).toBe(
      "mounted via import map + runtime dynamic import()",
    );

    // Mounted into its OWN sandbox node — never the production
    // `data-island="orderForm"` node (there isn't one in this DOM at all).
    const mountNode = container.querySelector("[data-spike-order-form-mount]");
    expect(mountNode).not.toBeNull();
    expect(mountNode?.getAttribute("data-mock-mounted")).toBe("true");
    expect(document.querySelector('[data-island="orderForm"]')).toBeNull();

    expect(MOCK_MOUNT_CALLS).toHaveLength(1);
    const call = MOCK_MOUNT_CALLS[0];
    expect(call.el).toBe(mountNode);
    // Same props the SSR snapshot carried...
    expect(call.props.symbol).toBe("BTC");
    expect(call.props.account).toEqual({
      equity: 100,
      used: 10,
      free: 90,
      maintenance: 0,
    });
    // ...plus deps threading the SAME shared page store (the interaction
    // flow this loading path claims to preserve depends on this identity).
    const deps = call.props.deps as { store: unknown; userId: string };
    expect(deps.store).toBe(getTradeStore());
    expect(deps.userId).toBe("demo-user-spike");

    // Unmount cleanup runs the module's own teardown.
    await act(async () => {
      root?.unmount();
    });
    root = null;
    expect(MOCK_UNMOUNTS).toEqual([mountNode]);
  });
});
