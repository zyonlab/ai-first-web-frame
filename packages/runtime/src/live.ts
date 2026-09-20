"use client";

/**
 * Manifest-driven realtime panels.
 *
 * `"use client"`: this module is browser-only by nature — it queries the DOM
 * for fragment roots and hands panels live subscriptions. It is a separate
 * `@mvp/runtime/live` entry so a server bundle never pulls it in.
 *
 * A server-rendered, non-React panel (order book, trades tape, positions) stays
 * live in the browser by subscribing to a data source and folding each frame
 * into an in-place DOM patch. Before this module that wiring lived in the PAGE:
 * the page knew which fragments were live, which source each one needed, and
 * how to patch each one's DOM. A fragment therefore could not become live —
 * or change what it subscribes to — without editing the page, which breaks the
 * "a fragment is the minimum deployable unit" claim.
 *
 * Here the fragment owns both halves:
 *
 * - **What to subscribe to** is declared in its manifest as source-id
 *   *templates* in the existing `<param>` vocabulary (`book.l2.<symbol>`), so
 *   `GET /manifest` already publishes it and no page rebuild is needed to see it.
 * - **How to apply a frame** ships from the fragment as a {@link LivePanel}
 *   whose `mount` returns an `onFrame` handler.
 *
 * The page contributes only what it alone knows: the current parameter values
 * (which symbol is active) and a `subscribe` adapter onto its data client.
 *
 * ## Re-subscribe semantics
 *
 * When a parameter changes, every panel is torn down and re-mounted — the data
 * client is built per symbol set, so a partial swap would leave panels on a
 * stale client. What is NOT uniform is `remounted`: it is true only for panels
 * that actually bind a changed parameter. That is the flag a panel uses to
 * decide whether its SSR DOM is still trustworthy (seed the first diff from it)
 * or stale (rebuild from the first frame). A panel on a parameter-free source
 * such as `positions` keeps its rows across a symbol switch; the order book,
 * whose rows hold the previous symbol's prices, does not.
 */

/** A source-id template in the `<param>` vocabulary, e.g. `book.l2.<symbol>`. */
export type SourceTemplate = string;

const PARAM_PATTERN = /<([a-zA-Z][a-zA-Z0-9_]*)>/g;

/**
 * The parameter names a template binds, in first-appearance order and
 * de-duplicated. A template with no placeholders binds nothing, which is what
 * makes a global source (`positions`) survive a parameter change untouched.
 */
export function templateParams(template: SourceTemplate): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PARAM_PATTERN)) {
    const name = match[1] as string;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Substitutes `<param>` placeholders to produce a concrete source id. Throws
 * when a bound parameter is missing rather than subscribing to a source id with
 * a literal `<symbol>` in it, which would silently never deliver a frame.
 */
export function resolveSourceTemplate(
  template: SourceTemplate,
  params: Readonly<Record<string, string>>,
): string {
  return template.replace(PARAM_PATTERN, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value === "") {
      throw new Error(
        `live panel source "${template}" binds <${name}>, which is not in params`,
      );
    }
    return value;
  });
}

/** Context handed to a panel at mount time. */
export type LivePanelMountContext = {
  /** The fragment's SSR root node, already checked for `data-fallback`. */
  node: Element;
  /** Current parameter values (e.g. `{ symbol: "BTC" }`). */
  params: Readonly<Record<string, string>>;
  /**
   * `false` on the first mount — the SSR DOM holds this parameter set's data,
   * so a panel may seed its first diff from it. `true` when the panel is being
   * re-mounted because a parameter IT binds changed, which makes the rendered
   * rows stale.
   */
  remounted: boolean;
};

/** A mounted panel: receives resolved frames, releases resources on stop. */
export type LivePanelHandle = {
  /**
   * Called with the RESOLVED source id (`book.l2.BTC`) and the frame payload.
   * A panel that declares one subscription can ignore the first argument.
   */
  onFrame(source: string, data: unknown): void;
  /** Optional cleanup; subscriptions themselves are cancelled by the driver. */
  stop?(): void;
};

/** The browser half of a live fragment, shipped by the fragment itself. */
export type LivePanel = {
  /** Matches the SSR root's `data-fragment` attribute. */
  fragment: string;
  /** Source-id templates, normally passed straight from the fragment manifest. */
  subscriptions: readonly SourceTemplate[];
  mount(ctx: LivePanelMountContext): LivePanelHandle;
};

/** Cancels one subscription. */
export type LiveUnsubscribe = () => void;

export type StartLivePanelsOptions = {
  /** Where to look for `[data-fragment="..."]` roots. */
  root: ParentNode;
  /** The live panels available on this page. */
  panels: readonly LivePanel[];
  /** Initial parameter values. */
  params: Readonly<Record<string, string>>;
  /**
   * Opens one subscription. The page implements this over its own data client;
   * the driver never sees the client, only resolved source ids.
   */
  subscribe(source: string, onFrame: (data: unknown) => void): LiveUnsubscribe;
  /**
   * Called with the new parameters BEFORE panels re-subscribe, so the page can
   * rotate a client that is scoped to the old parameter set.
   */
  onParamsChange?(params: Readonly<Record<string, string>>): void;
  /**
   * Reports a panel that threw while mounting or handling a frame. The panel is
   * dropped, the rest of the page stays live. Defaults to a `console.warn`.
   */
  onError?(error: unknown, info: { fragment: string; phase: LivePhase }): void;
};

/** Where a panel failure happened. */
export type LivePhase = "mount" | "frame" | "stop";

export type LivePanelsController = {
  /** Fragment names currently mounted, in page order. */
  readonly mounted: readonly string[];
  /** Applies new parameter values, re-mounting the panels that bind them. */
  setParams(next: Readonly<Record<string, string>>): void;
  /** Tears everything down; safe to call twice. */
  stop(): void;
};

type MountedPanel = {
  panel: LivePanel;
  handle: LivePanelHandle;
  unsubscribes: LiveUnsubscribe[];
};

function defaultOnError(
  error: unknown,
  info: { fragment: string; phase: LivePhase },
): void {
  console.warn(
    `[live] ${info.fragment} failed during ${info.phase}`,
    error instanceof Error ? error.message : error,
  );
}

/**
 * Discovers every declared panel under `root`, subscribes it to its resolved
 * sources and keeps it live until `stop()`.
 *
 * A panel is skipped (not an error) when its fragment did not render on this
 * page or rendered its fallback — composition already degraded that slot, and
 * a live panel must not resurrect it.
 */
export function startLivePanels(
  options: StartLivePanelsOptions,
): LivePanelsController {
  const { root, panels, subscribe } = options;
  const onError = options.onError ?? defaultOnError;

  let params: Record<string, string> = { ...options.params };
  let mounted: MountedPanel[] = [];
  let stopped = false;

  const nodeFor = (fragment: string): Element | null => {
    const node = root.querySelector?.(
      `[data-fragment="${cssEscapeAttr(fragment)}"]`,
    );
    if (!node || node.hasAttribute("data-fallback")) return null;
    return node;
  };

  const mountPanel = (panel: LivePanel, remounted: boolean): void => {
    const node = nodeFor(panel.fragment);
    if (!node) return;

    let handle: LivePanelHandle;
    try {
      handle = panel.mount({ node, params, remounted });
    } catch (error) {
      onError(error, { fragment: panel.fragment, phase: "mount" });
      return;
    }

    const unsubscribes: LiveUnsubscribe[] = [];
    for (const template of panel.subscriptions) {
      let source: string;
      try {
        source = resolveSourceTemplate(template, params);
      } catch (error) {
        onError(error, { fragment: panel.fragment, phase: "mount" });
        continue;
      }
      unsubscribes.push(
        subscribe(source, (data) => {
          try {
            handle.onFrame(source, data);
          } catch (error) {
            onError(error, { fragment: panel.fragment, phase: "frame" });
          }
        }),
      );
    }

    mounted.push({ panel, handle, unsubscribes });
  };

  const unmountAll = (): void => {
    for (const entry of mounted) {
      for (const unsubscribe of entry.unsubscribes) unsubscribe();
      try {
        entry.handle.stop?.();
      } catch (error) {
        onError(error, { fragment: entry.panel.fragment, phase: "stop" });
      }
    }
    mounted = [];
  };

  for (const panel of panels) mountPanel(panel, false);

  return {
    get mounted() {
      return mounted.map((entry) => entry.panel.fragment);
    },

    setParams(next) {
      if (stopped) return;
      const changed = Object.keys({ ...params, ...next }).filter(
        (key) => params[key] !== next[key],
      );
      if (changed.length === 0) return;

      // Which panels' SSR DOM just went stale — computed BEFORE the swap so a
      // panel on a parameter-free source keeps its rendered rows.
      const staleFragments = new Set(
        panels
          .filter((panel) =>
            panel.subscriptions.some((template) =>
              templateParams(template).some((name) => changed.includes(name)),
            ),
          )
          .map((panel) => panel.fragment),
      );

      unmountAll();
      params = { ...next };
      options.onParamsChange?.(params);
      for (const panel of panels) {
        mountPanel(panel, staleFragments.has(panel.fragment));
      }
    },

    stop() {
      if (stopped) return;
      stopped = true;
      unmountAll();
    },
  };
}

// ---------------------------------------------------------------------------
// Panel DOM shim
//
// The whole point of a patch panel is that it never re-renders: a frame moves
// the few cells that changed and nothing else, so a patched cell stays
// byte-identical to how the server rendered it. These four helpers are the only
// DOM surface that needs, and they live here rather than in one fragment
// because every patch panel needs exactly the same four.
// ---------------------------------------------------------------------------

/** The ambient document, read lazily so this module imports cleanly on a server. */
export function panelDocument(): Document {
  return (globalThis as unknown as { document: Document }).document;
}

/** Writes a `[data-field]` cell's text, skipping the write when unchanged. */
export function setFieldText(
  scope: Element,
  field: string,
  text: string,
): void {
  const el = scope.querySelector(`[data-field="${cssEscapeAttr(field)}"]`);
  if (el && el.textContent !== text) el.textContent = text;
}

/** Reads a `[data-field]` cell's text, or `""` when the cell is absent. */
export function fieldText(scope: Element, field: string): string {
  return (
    scope.querySelector(`[data-field="${cssEscapeAttr(field)}"]`)
      ?.textContent ?? ""
  );
}

/** Parses a locale-formatted number string (thousands separators) back to a number. */
export function parseFieldNumber(text: string): number {
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Escapes the few characters that could break out of an attribute selector. */
export function cssEscapeAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
