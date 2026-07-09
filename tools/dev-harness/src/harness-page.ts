/**
 * Renders the single-component dev harness page (docs/AI_NATIVE_DEVX.md §4):
 * the fragment's SSR in a themed, `layoutHint`-sized pane, next to a sidebar
 * that shows its contract-mocked world (seeded slices, mock data sources,
 * inject/observe channels). Pure string generation → unit-tested; the
 * `dev:component` CLI wires it to a running fragment service.
 */

import type { MockWorld } from "./mock-world";

export type HarnessPageOptions = {
  name: string;
  /** Design-system token CSS + trade alias bridge (dark theme). */
  themeCss: string;
  /** The fragment's SSR HTML (already carries its own inlined CSS). */
  fragmentHtml: string;
  world: MockWorld;
  serviceUrl?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** A realistic pane width for a layout shape. */
function paneWidth(shape: string | undefined): string {
  switch (shape) {
    case "ladder":
    case "panel":
      return "320px";
    case "bar":
    case "table":
      return "min(1100px, 100%)";
    default:
      return "min(760px, 100%)";
  }
}

function chip(label: string, value: string): string {
  return `<span class="dh-chip"><b>${escapeHtml(label)}</b> ${escapeHtml(value)}</span>`;
}

function list(items: string[], empty = "—"): string {
  if (items.length === 0) return `<li class="dh-muted">${empty}</li>`;
  return items.map((i) => `<li><code>${escapeHtml(i)}</code></li>`).join("");
}

export function renderHarnessPage(opts: HarnessPageOptions): string {
  const { name, themeCss, fragmentHtml, world, serviceUrl } = opts;
  const hint = world.layoutHint ?? {};
  const width = paneWidth(hint.shape);
  const minHeight = hint.minHeight ? `${hint.minHeight}px` : "120px";

  const injectRows = world.injectSlices
    .map((channel) => {
      const seeded = world.seededSlices[channel];
      const sample = JSON.stringify(seeded ?? {});
      return `<li><code>${escapeHtml(channel)}</code><span class="dh-muted"> seeded ${escapeHtml(sample)}</span></li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>dev:component — ${escapeHtml(name)}</title>
<style>${themeCss}</style>
<style>
  body { margin: 0; background: var(--mvp-color-surface-0); color: var(--mvp-color-ink);
    font-family: var(--mvp-font-control, system-ui, sans-serif); }
  .dh-bar { display:flex; align-items:baseline; gap:12px; padding:10px 16px;
    border-bottom:1px solid var(--mvp-color-border); position:sticky; top:0;
    background:var(--mvp-color-surface-1); }
  .dh-bar h1 { font-size:14px; margin:0; }
  .dh-bar .dh-muted { font-size:12px; }
  .dh-grid { display:grid; grid-template-columns: 1fr 340px; gap:16px; padding:16px; align-items:start; }
  .dh-pane-wrap { display:flex; }
  .dh-pane { width:${width}; min-height:${minHeight}; border:1px solid var(--mvp-color-border);
    border-radius:var(--mvp-radius-sm,4px); background:var(--mvp-color-surface-1); overflow:auto;
    display:flex; flex-direction:column; }
  .dh-pane > * { flex:${hint.fills ? "1 1 auto" : "0 0 auto"}; min-height:0; }
  .dh-side { font-size:12px; font-family:var(--mvp-font-mono, ui-monospace, monospace); }
  .dh-side section { border:1px solid var(--mvp-color-border); border-radius:4px; margin-bottom:12px; }
  .dh-side h2 { font-size:11px; text-transform:uppercase; letter-spacing:.05em;
    color:var(--mvp-color-text-muted); margin:0; padding:6px 10px; border-bottom:1px solid var(--mvp-color-border); }
  .dh-side ul { margin:0; padding:8px 10px 8px 24px; }
  .dh-side li { margin:2px 0; }
  .dh-chip { display:inline-block; margin:2px 6px 2px 0; padding:2px 8px; border-radius:999px;
    border:1px solid var(--mvp-color-border); }
  .dh-chip b { color:var(--mvp-color-text-muted); font-weight:600; }
  .dh-muted { color:var(--mvp-color-text-muted); }
  code { color:var(--mvp-color-accent); }
</style>
</head>
<body>
  <div class="dh-bar">
    <h1>dev:component — ${escapeHtml(name)}</h1>
    <span class="dh-muted">
      ${chip("shape", hint.shape ?? "panel")}
      ${chip("fills", String(Boolean(hint.fills)))}
      ${hint.minHeight ? chip("minHeight", `${hint.minHeight}px`) : ""}
      ${serviceUrl ? chip("service", serviceUrl) : ""}
    </span>
  </div>
  <div class="dh-grid">
    <div class="dh-pane-wrap">
      <div class="dh-pane" data-harness-pane>${fragmentHtml}</div>
    </div>
    <aside class="dh-side">
      <section>
        <h2>Consumes — slices (inject to drive)</h2>
        <ul>${injectRows || `<li class="dh-muted">—</li>`}</ul>
      </section>
      <section>
        <h2>Consumes — data sources (mock-fed)</h2>
        <ul>${list(world.mockDataSources)}</ul>
      </section>
      <section>
        <h2>Produces — slices (observe)</h2>
        <ul>${list(world.observeSlices)}</ul>
      </section>
    </aside>
  </div>
</body>
</html>`;
}
