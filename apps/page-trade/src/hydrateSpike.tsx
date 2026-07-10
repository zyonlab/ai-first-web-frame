"use client";

import { useEffect, useRef } from "react";
import { getTradeStore } from "./tradeStore";

export type SpikeOrderFormLoaderProps = {
  /** order-form's real, registry-resolved browser island asset URL. */
  moduleUrl: string;
};

/** The shape `island.browser.ts`'s built module exports (see its own file). */
type OrderFormIslandBrowserModule = {
  mountOrderFormIsland: (
    el: Element,
    props: Record<string, unknown>,
  ) => () => void;
};

/**
 * C3 spike (docs/ARCHITECTURE_REFACTOR_PLAN.md §4.3.3) — parallel,
 * ADDITIVE loading path for the order-form island. `TradeHydrator`
 * (`./hydrate.tsx`) is untouched and stays the path the demo actually runs
 * on; this component proves an alternative mechanism works without
 * displacing it:
 *
 *  - genuinely resolves order-form's browser module at RUNTIME via a native
 *    browser `import()` (not a build-time static import Next/webpack could
 *    bundle — the `moduleUrl` argument is a variable, not a string literal,
 *    which webpack cannot statically analyze, so this stays a real runtime
 *    module fetch honoring the page's `<script type="importmap">`);
 *  - mounts into its OWN sandbox DOM node (`data-spike-order-form-mount`),
 *    never the production `data-island="orderForm"` node `TradeHydrator`
 *    already owns — so this path can be proven correct with zero risk to
 *    the production mount;
 *  - reads its initial props from the SAME SSR `data-island-props`
 *    snapshot the production island hydrates from, and mounts against the
 *    SAME shared page store (`getTradeStore()`) — so a real order-book
 *    price click (the signature C2/C3 cross-island flow) updates BOTH the
 *    production order-form AND this sandbox instance at once, which is the
 *    strongest available proof this loading path is not just "a script
 *    executed" but "the island genuinely participates in the app".
 */
export function SpikeOrderFormLoader({ moduleUrl }: SpikeOrderFormLoaderProps) {
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unmount: (() => void) | undefined;

    function setStatus(text: string) {
      if (statusRef.current) statusRef.current.textContent = text;
    }

    async function run() {
      const host = hostRef.current;
      if (!host) return;
      const snapshotEl = document.querySelector(
        'script[data-island-props="orderForm"]',
      );
      if (!snapshotEl?.textContent) {
        setStatus(
          'blocked: no SSR data-island-props="orderForm" snapshot found',
        );
        return;
      }
      let snapshot: { props: Record<string, unknown> };
      try {
        snapshot = JSON.parse(snapshotEl.textContent);
      } catch {
        setStatus("blocked: SSR snapshot JSON failed to parse");
        return;
      }

      setStatus(`loading ${moduleUrl} via import map ...`);
      try {
        // A fully dynamic, non-literal specifier: bundlers cannot statically
        // resolve/inline it, so this stays a genuine browser-native
        // `import()` at runtime — the mechanism the import map governs.
        const mod = (await import(
          /* webpackIgnore: true */ moduleUrl
        )) as OrderFormIslandBrowserModule;
        if (cancelled) return;
        const store = getTradeStore();
        unmount = mod.mountOrderFormIsland(host, {
          ...snapshot.props,
          deps: { store, userId: "demo-user-spike" },
        });
        setStatus("mounted via import map + runtime dynamic import()");
      } catch (error) {
        setStatus(
          `failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    void run();
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [moduleUrl]);

  return (
    <section
      data-spike-order-form-loader
      aria-label="C3 spike: order-form loaded via import map"
    >
      <p data-spike-status ref={statusRef}>
        initializing…
      </p>
      <div data-spike-order-form-mount ref={hostRef} />
    </section>
  );
}
