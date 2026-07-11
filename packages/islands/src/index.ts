import { IslandSnapshotSchema } from "@mvp/contracts";
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
  /**
   * Which comparison failed. `"invalid-snapshot"` is the A2 case (README
   * goal "never silent fallback"): the inline snapshot JSON was unparseable
   * or failed `IslandSnapshotSchema` validation (`@mvp/contracts`) — it is
   * not a version disagreement, just a corrupted/malformed payload.
   */
  reason: "version-mismatch" | "contract-hash-mismatch" | "invalid-snapshot";
  /**
   * Present only when `reason` is `"invalid-snapshot"`: the JSON-parse error
   * or Zod validation issues that failed, for telemetry/debugging.
   */
  issues?: string[];
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

/** Reads the raw text of the inline JSON snapshot script, if any is present. */
function readSnapshotScriptText(el: Element): string | undefined {
  const script = el.querySelector(
    'script[type="application/json"]',
  ) as HTMLScriptElement | null;
  return script?.textContent ?? undefined;
}

/**
 * A2 (README goal "never silent fallback"): parses + validates raw inline
 * snapshot JSON against `IslandSnapshotSchema` (`@mvp/contracts`). Unlike
 * {@link readIslandSnapshot}, this reports WHY a snapshot is invalid instead
 * of silently degrading — {@link mountIsland} uses it to decide whether to
 * skip hydration entirely (mirroring the C2 version-mismatch path) rather
 * than hydrate a component with an unvalidated/empty prop shape.
 */
function parseIslandSnapshotText<TProps>(
  rawText: string,
):
  | { ok: true; snapshot: IslandSnapshot<TProps> }
  | { ok: false; issues: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return {
      ok: false,
      issues: [
        `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  const result = IslandSnapshotSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, snapshot: result.data as IslandSnapshot<TProps> };
}

/**
 * Reads the inline `<script type="application/json">` snapshot adjacent to (a
 * child of) a mount node. No script present, or a script whose JSON is
 * malformed/invalid, degrades to an empty snapshot — this function never
 * throws, matching its pre-A2 contract for callers that just want a
 * best-effort read.
 *
 * {@link mountIsland} does NOT rely on this lenient fallback for hydration
 * decisions: it calls {@link parseIslandSnapshotText} itself first and skips
 * hydration outright on an invalid snapshot (A2), only falling through to a
 * validated snapshot here once that check has passed.
 */
export function readIslandSnapshot<TProps = Record<string, unknown>>(
  el: Element,
): IslandSnapshot<TProps> {
  const rawText = readSnapshotScriptText(el);
  if (rawText === undefined) {
    return { props: {} as TProps };
  }
  const result = parseIslandSnapshotText<TProps>(rawText);
  return result.ok ? result.snapshot : { props: {} as TProps };
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
 *
 * A2 snapshot validation: before any of the above, the raw inline snapshot
 * JSON (if present) is parsed and validated against `IslandSnapshotSchema`
 * (`@mvp/contracts`). A snapshot that is unparseable JSON, not an object, or
 * has a field of the wrong type is reported via the SAME skip-hydration path
 * as a C2 mismatch (`reason: "invalid-snapshot"`) — never silently hydrated
 * with empty/garbage props. A snapshot that is simply missing optional
 * fields (e.g. no `version` — an old, non-participating fragment) is NOT
 * invalid and hydrates exactly as before.
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

  const skipHydration = (
    info: SnapshotMismatchInfo,
    message: string,
  ): IslandHandle => {
    console.warn(`[@mvp/islands] ${message}`, info);
    mismatchHandler?.(info);
    return {
      unmount() {
        // No React root was ever created for a mismatched/skipped island.
      },
    };
  };

  const rawText = readSnapshotScriptText(el);
  let snapshot: IslandSnapshot<TProps>;
  if (rawText === undefined) {
    snapshot = { props: {} as TProps };
  } else {
    const parsed = parseIslandSnapshotText<TProps>(rawText);
    if (!parsed.ok) {
      return skipHydration(
        {
          island: name,
          expected: {},
          actual: {},
          reason: "invalid-snapshot",
          issues: parsed.issues,
        },
        `invalid snapshot for island "${name}": ${parsed.issues.join("; ")}. ` +
          "Skipping hydration; the SSR HTML remains the static final state.",
      );
    }
    snapshot = parsed.snapshot;
  }

  const mismatch = detectSnapshotMismatch(name, snapshot);
  if (mismatch) {
    return skipHydration(
      mismatch,
      `snapshot mismatch for island "${name}" (fragment ` +
        `"${mismatch.actual.fragment ?? "unknown"}"): expected version ` +
        `"${mismatch.expected.version}", got "${mismatch.actual.version}" ` +
        `(${mismatch.reason}). Skipping hydration; the SSR HTML remains the ` +
        "static final state.",
    );
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
