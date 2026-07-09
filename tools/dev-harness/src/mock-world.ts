/**
 * Contract-mocked world for single-component development (docs/AI_NATIVE_DEVX.md
 * §4). From a fragment's manifest, derive exactly what an isolated harness must
 * provide so the component can run WITHOUT the rest of the stack:
 *
 *  - `seededSlices` — the C3 store/bus channels it consumes, pre-seeded with
 *    their contract initial values.
 *  - `mockDataSources` — the C5 sources it reads, to be driven by the
 *    deterministic `@mvp/data` mock transport.
 *  - `injectSlices` — channels you can publish to drive it (cross-component
 *    interaction, tested in isolation: "publish trade.active-symbol=ETH → does
 *    the component react?").
 *  - `observeSlices` — channels it emits, to assert on.
 *  - `layoutHint` — the pane size/shape the preview must honor.
 *
 * Pure (manifest in → spec out) so it is unit-tested; the harness runtime +
 * `dev:component` CLI consume it.
 */

import { initialTradeSlices } from "../../../packages/interaction/src/index.ts";
import type {
  FragmentManifestLike,
  LayoutHint,
} from "../../release-tools/src/unit-graph";

export type MockWorld = {
  component: string;
  /** channel → seeded initial value (from the C3 contracts). */
  seededSlices: Record<string, unknown>;
  /** C5 source ids to attach the deterministic mock transport to. */
  mockDataSources: string[];
  /** Channels a harness can publish to drive the component. */
  injectSlices: string[];
  /** Channels the component publishes (assert on these). */
  observeSlices: string[];
  layoutHint?: LayoutHint;
};

const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];

export function describeMockWorld(manifest: FragmentManifestLike): MockWorld {
  const initial = initialTradeSlices as Record<string, unknown>;
  const consumesSlices = manifest.consumes?.slices ?? [];
  return {
    component: manifest.name,
    seededSlices: Object.fromEntries(
      consumesSlices.map((channel) => [channel, initial[channel]]),
    ),
    mockDataSources: uniq([
      ...(manifest.dataDependencies ?? []),
      ...(manifest.consumes?.dataSources ?? []),
    ]),
    injectSlices: uniq(consumesSlices),
    observeSlices: uniq(manifest.produces?.slices ?? []),
    layoutHint: manifest.layoutHint,
  };
}
