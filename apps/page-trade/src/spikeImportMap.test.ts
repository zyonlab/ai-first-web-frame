import { describe, expect, it } from "vitest";
import {
  resolveOrderFormSpikeModuleUrl,
  SPIKE_VENDOR_IMPORT_MAP,
} from "./spikeImportMap";

describe("SPIKE_VENDOR_IMPORT_MAP (C3 spike, §4.3.3)", () => {
  it("maps every bare specifier order-form's browser build actually imports", () => {
    // Confirmed by inspecting `fragments/order-form/dist-browser/island.browser.js`'s
    // real import statements — not assumed.
    expect(Object.keys(SPIKE_VENDOR_IMPORT_MAP).sort()).toEqual(
      [
        "react",
        "react-dom/client",
        "react/jsx-runtime",
        "@mvp/trade-contracts",
        "@mvp/ui/shadcn",
      ].sort(),
    );
  });

  it("points every entry at a same-origin /spike-vendor/ static asset (self-hosted, no CDN)", () => {
    for (const url of Object.values(SPIKE_VENDOR_IMPORT_MAP)) {
      expect(url).toMatch(/^\/spike-vendor\/[a-z-]+\.js$/);
    }
  });
});

describe("resolveOrderFormSpikeModuleUrl", () => {
  it("resolves order-form's real registry assetsUrl on the canary channel", () => {
    // Registered via `pnpm exec tsx scripts/register-fragment.mts --name
    // order-form ... --assets-url http://localhost:4205/assets/order-form.island.js`
    // — a real registry read, not a hardcoded URL.
    expect(resolveOrderFormSpikeModuleUrl()).toBe(
      "http://localhost:4205/assets/order-form.island.js",
    );
  });
});
