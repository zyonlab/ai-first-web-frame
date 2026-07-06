export function createShellFallback(
  pathname: string,
  traceId: string,
  reason: string,
) {
  return `<!doctype html><html lang="en"><head><title>Shell fallback</title></head><body><main data-shell-fallback="true"><h1>Experience temporarily unavailable</h1><p>Path ${escapeHtml(pathname)} could not be composed.</p><small data-trace-id="${escapeHtml(traceId)}">${escapeHtml(reason)}</small></main></body></html>`;
}

export function createNotFoundFallback(pathname: string) {
  return `<!doctype html><html lang="en"><head><title>Not found</title></head><body><main data-shell-404="true"><h1>Page not found</h1><p>No route matched ${escapeHtml(pathname)}.</p></main></body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
