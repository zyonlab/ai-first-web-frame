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
 *     {"props":{...},"slice":"orderDraft"}
 *   </script>
 * </div>
 * ```
 *
 * `@mvp/islands` is the framework's generic island runtime: it reads the
 * snapshot, looks the island up in the registry, and hydrates it with
 * `react-dom/client`. Every fragment agent MUST emit matching markup; this
 * shape is frozen and consumed unchanged by the page/fragment agents.
 */
export interface IslandSnapshot<TProps = Record<string, unknown>> {
  /** SSR-serialized initial props handed to the island component on mount. */
  props: TProps;
  /** Optional store slice name this island reads/writes (README §7 slices). */
  slice?: string;
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

const registry = new Map<string, IslandComponent<never>>();

/** Registers an island component under a stable name (its `data-island` value). */
export function registerIsland<TProps>(
  name: string,
  component: IslandComponent<TProps>,
): void {
  registry.set(name, component as IslandComponent<never>);
}

/** Test/HMR helper: empties the island registry. */
export function clearIslandRegistry(): void {
  registry.clear();
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
      const record = parsed as { props?: unknown; slice?: unknown };
      return {
        props: (record.props ?? {}) as TProps,
        slice: typeof record.slice === "string" ? record.slice : undefined,
      };
    }
  } catch {
    // fall through to the empty snapshot
  }
  return { props: {} as TProps };
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
