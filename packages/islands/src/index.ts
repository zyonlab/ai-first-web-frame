import { type ComponentType, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The frozen (C2 / README §14 D4) island mount markup + snapshot contract.
 *
 * A fragment emits, for each hydratable sub-part, a mount node plus an
 * adjacent inline JSON snapshot:
 *
 * ```html
 * <div data-island="<name>">
 *   <!-- server-rendered first paint (readable with JS disabled) -->
 *   <script type="application/json" data-island-props="<name>">
 *     {"props":{...},"slice":"orderDraft","fragment":"order-form","version":"0.1.0"}
 *   </script>
 * </div>
 * ```
 *
 * `@mvp/islands` is the framework's generic island runtime: it reads the
 * snapshot, looks the island up in the registry, and hydrates it with
 * `react-dom/client`. Every fragment agent MUST emit matching markup; this
 * shape is frozen and consumed unchanged by the page/fragment agents.
 *
 * `fragment`/`version`/`contractHash` are the C2 snapshot version handshake
 * (docs/ARCHITECTURE_REFACTOR_PLAN.md §4.3.1): a fragment service is
 * promoted/rolled-back independently of the page bundle that hydrates its
 * SSR output, so the live snapshot's shape can drift from what the
 * page-bundled island component was built against. Stamping the fragment's
 * own manifest `version` (and, optionally, a finer-grained `contractHash` of
 * the prop shape) lets {@link mountIsland} detect that drift and degrade
 * explicitly instead of silently mis-hydrating.
 */
export interface IslandSnapshot<TProps = Record<string, unknown>> {
  /** SSR-serialized initial props handed to the island component on mount. */
  props: TProps;
  /** Optional store slice name this island reads/writes (README §7 slices). */
  slice?: string;
  /**
   * The fragment name that produced this snapshot (e.g. `"market-header"`).
   * Optional so older/non-participating fragments keep working unchanged.
   */
  fragment?: string;
  /**
   * The fragment's own manifest `version` at render time. Compared against
   * the `expectedVersion` the page-bundled island declared via
   * {@link registerIsland}. Optional for backward compatibility: a fragment
   * that hasn't adopted the handshake yet simply omits it.
   */
  version?: string;
  /**
   * Optional finer-grained drift signal: a hash of the snapshot's prop shape
   * (e.g. its sorted top-level prop keys) a fragment MAY additionally stamp
   * for detection beyond a version bump (e.g. two deploys sharing a version
   * during a hotfix). When absent, version-only comparison applies.
   */
  contractHash?: string;
}

/** Handle returned by {@link mountIsland}; `unmount` tears the React root down. */
export interface IslandHandle {
  unmount(): void;
}

/** Options accepted by {@link mountIsland}. */
export interface MountIslandOptions<TProps = Record<string, unknown>> {
  /** Explicit props; when omitted they are read from the inline snapshot. */
  props?: TProps;
  /** Explicit slice; when omitted it is read from the inline snapshot. */
  slice?: string;
}

/** An island component receives the snapshot props (plus its declared slice). */
export type IslandComponent<TProps = Record<string, unknown>> = ComponentType<
  TProps & { slice?: string }
>;

/**
 * What the page-bundled island component was built against (C2 handshake).
 * Passed as the third argument to {@link registerIsland}. Both fields are
 * optional: a caller that doesn't pass this object (or omits `expectedVersion`)
 * opts the island out of the handshake entirely — `mountIsland` then hydrates
 * unconditionally, exactly as it did before this contract existed.
 */
export interface IslandVersionExpectation {
  /** The fragment manifest `version` this island component expects. */
  expectedVersion?: string;
  /** Optional finer-grained contract hash this island component expects. */
  expectedContractHash?: string;
}

/** Info handed to a {@link SnapshotMismatchHandler} on a C2 handshake failure. */
export interface SnapshotMismatchInfo {
  /** The `data-island` name that mismatched. */
  island: string;
  /** What the page-bundled component declared (via `registerIsland`). */
  expected: { version?: string; contractHash?: string };
  /** What the live SSR snapshot actually carried. */
  actual: { fragment?: string; version?: string; contractHash?: string };
  /** Which comparison failed. */
  reason: "version-mismatch" | "contract-hash-mismatch";
}

/**
 * Callback a consuming app can wire to real telemetry (`configureIslandRuntime`).
 * `@mvp/islands` is a browser-side package with no dependency on
 * `@mvp/observability` (whose `RequestTrace`/metrics APIs are server-side,
 * request-scoped, and don't fit a client mount event) — a lightweight
 * event-emission hook is the right shape here instead.
 */
export type SnapshotMismatchHandler = (info: SnapshotMismatchInfo) => void;

const registry = new Map<string, IslandComponent<never>>();
const expectations = new Map<string, IslandVersionExpectation>();
let mismatchHandler: SnapshotMismatchHandler | undefined;

/**
 * Registers an island component under a stable name (its `data-island` value).
 *
 * `expectation` is the optional C2 handshake declaration: pass
 * `{ expectedVersion }` (sourced from the fragment's own manifest, e.g.
 * `marketHeaderManifest.version`) to have {@link mountIsland} verify the live
 * snapshot's `version` matches before hydrating. Omitting it (or the whole
 * third argument) keeps today's unconditional-hydrate behavior.
 */
export function registerIsland<TProps>(
  name: string,
  component: IslandComponent<TProps>,
  expectation?: IslandVersionExpectation,
): void {
  registry.set(name, component as IslandComponent<never>);
  if (expectation) {
    expectations.set(name, expectation);
  } else {
    expectations.delete(name);
  }
}

/**
 * Sets the process-wide C2 mismatch hook. A consuming page calls this once
 * (e.g. alongside `registerTradeIslands`) to route snapshot-mismatch events to
 * real telemetry; `mountIsland` always also `console.warn`s so a mismatch is
 * never silent even when no hook is configured.
 */
export function configureIslandRuntime(config: {
  onSnapshotMismatch?: SnapshotMismatchHandler;
}): void {
  mismatchHandler = config.onSnapshotMismatch;
}

/** Test/HMR helper: empties the island registry (and its C2 expectations/hook). */
export function clearIslandRegistry(): void {
  registry.clear();
  expectations.clear();
  mismatchHandler = undefined;
}

/** Returns the component registered for `name`, or `undefined`. */
export function getIsland(name: string): IslandComponent<never> | undefined {
  return registry.get(name);
}

/**
 * Reads the inline `<script type="application/json">` snapshot adjacent to (a
 * child of) a mount node. Missing or malformed JSON degrades to an empty
 * snapshot so a broken snapshot never crashes hydration — the SSR first paint
 * simply stays static.
 */
export function readIslandSnapshot<TProps = Record<string, unknown>>(
  el: Element,
): IslandSnapshot<TProps> {
  const script = el.querySelector(
    'script[type="application/json"]',
  ) as HTMLScriptElement | null;
  if (!script?.textContent) {
    return { props: {} as TProps };
  }
  try {
    const parsed = JSON.parse(script.textContent) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as {
        props?: unknown;
        slice?: unknown;
        fragment?: unknown;
        version?: unknown;
        contractHash?: unknown;
      };
      return {
        props: (record.props ?? {}) as TProps,
        slice: typeof record.slice === "string" ? record.slice : undefined,
        fragment:
          typeof record.fragment === "string" ? record.fragment : undefined,
        version:
          typeof record.version === "string" ? record.version : undefined,
        contractHash:
          typeof record.contractHash === "string"
            ? record.contractHash
            : undefined,
      };
    }
  } catch {
    // fall through to the empty snapshot
  }
  return { props: {} as TProps };
}

/**
 * The C2 handshake check: compares a live snapshot against the expectation
 * (if any) registered for `name`. Returns `undefined` on a match (including
 * every backward-compatible "nothing to check" case) or a
 * {@link SnapshotMismatchInfo} describing the drift.
 *
 * Backward-compatibility choice: a snapshot with no `version` at all (an
 * old/non-participating fragment that hasn't adopted the handshake) is
 * treated as a MATCH, not a mismatch — hydration proceeds normally. Forcing
 * every fragment to stamp `version` immediately would be a breaking change
 * for fragments this phase doesn't touch; the safer default is to keep
 * today's unconditional-hydrate behavior until a fragment opts in by
 * emitting `version` in its snapshot.
 */
function detectSnapshotMismatch(
  name: string,
  snapshot: Pick<IslandSnapshot, "fragment" | "version" | "contractHash">,
): SnapshotMismatchInfo | undefined {
  const expectation = expectations.get(name);
  if (!expectation?.expectedVersion) {
    // The registered component declared no expected version (plain
    // `registerIsland(name, component)` call) -> opted out of the handshake.
    return undefined;
  }
  if (snapshot.version === undefined) {
    // See the backward-compatibility note above.
    return undefined;
  }
  const expected = {
    version: expectation.expectedVersion,
    contractHash: expectation.expectedContractHash,
  };
  const actual = {
    fragment: snapshot.fragment,
    version: snapshot.version,
    contractHash: snapshot.contractHash,
  };
  if (snapshot.version !== expectation.expectedVersion) {
    return { island: name, expected, actual, reason: "version-mismatch" };
  }
  if (
    expectation.expectedContractHash &&
    snapshot.contractHash !== undefined &&
    snapshot.contractHash !== expectation.expectedContractHash
  ) {
    return {
      island: name,
      expected,
      actual,
      reason: "contract-hash-mismatch",
    };
  }
  return undefined;
}

/**
 * Hydrates a single island mount node.
 *
 * Reads `<div data-island="<name>">`, resolves the component from the
 * registry, merges explicit options over the inline snapshot, and mounts with
 * `createRoot`. Returns a handle whose `unmount()` disposes the React root.
 *
 * Throws when the node has no `data-island` name or the name is unregistered —
 * both are authoring errors the fragment agent must fix (the markup contract is
 * frozen). `hydrateIslands` swallows the unregistered case for resilience.
 *
 * C2 version handshake: when the registered component declared an
 * `expectedVersion` (via `registerIsland`'s third argument) and the live
 * snapshot's `version` disagrees, this DOES NOT mount the React component —
 * no `createRoot` call happens at all, so the SSR HTML under `el` is left
 * exactly as rendered (the "degrade explicitly" behavior from goal C2). The
 * mismatch is reported via `console.warn` (always) and the
 * `configureIslandRuntime` hook (if set), then a no-op handle is returned so
 * callers never need to null-check.
 */
export function mountIsland<TProps = Record<string, unknown>>(
  el: HTMLElement,
  opts: MountIslandOptions<TProps> = {},
): IslandHandle {
  const name = el.getAttribute("data-island");
  if (!name) {
    throw new Error(
      "mountIsland: element is missing a data-island name attribute",
    );
  }
  const component = registry.get(name);
  if (!component) {
    throw new Error(`mountIsland: no registered island named "${name}"`);
  }
  const snapshot = readIslandSnapshot<TProps>(el);

  const mismatch = detectSnapshotMismatch(name, snapshot);
  if (mismatch) {
    console.warn(
      `[@mvp/islands] snapshot mismatch for island "${name}" (fragment ` +
        `"${mismatch.actual.fragment ?? "unknown"}"): expected version ` +
        `"${mismatch.expected.version}", got "${mismatch.actual.version}" ` +
        `(${mismatch.reason}). Skipping hydration; the SSR HTML remains the ` +
        "static final state.",
      mismatch,
    );
    mismatchHandler?.(mismatch);
    return {
      unmount() {
        // No React root was ever created for a mismatched/skipped island.
      },
    };
  }

  const props = opts.props ?? snapshot.props;
  const slice = opts.slice ?? snapshot.slice;

  const root: Root = createRoot(el);
  root.render(
    createElement(
      component as IslandComponent<TProps>,
      { ...(props as TProps), slice } as TProps & { slice?: string },
    ),
  );
  return {
    unmount() {
      root.unmount();
    },
  };
}

/**
 * Scans `root` (defaults to `document`) for every `[data-island]` node and
 * hydrates each one that has a registered component. Unregistered islands are
 * skipped (not thrown) so one missing island cannot break the whole page.
 * Returns the handles for all mounted islands.
 */
export function hydrateIslands(root?: ParentNode): IslandHandle[] {
  const scope: ParentNode | undefined =
    root ?? (typeof document !== "undefined" ? document : undefined);
  if (!scope) return [];
  const nodes = scope.querySelectorAll("[data-island]");
  const handles: IslandHandle[] = [];
  for (const node of Array.from(nodes)) {
    const name = node.getAttribute("data-island");
    if (!name || !registry.has(name)) continue;
    handles.push(mountIsland(node as HTMLElement));
  }
  return handles;
}
