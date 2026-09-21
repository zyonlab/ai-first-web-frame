/**
 * Docker Compose smoke check logic.
 *
 * Pure and injectable so it can be unit tested: HTTP access and sleeping are
 * passed in as functions, and the check list is DERIVED from the fragment
 * registry (`registry/registry.data.json`) and the route registry
 * (`packages/routes/src/registry.ts`) instead of being hand-maintained —
 * adding a fragment or page automatically adds its smoke check. The pure
 * derivation lives in {@link deriveSmokeChecks} (registry/route data
 * injected); {@link createDefaultSmokeChecks} is the thin impure edge that
 * feeds it the repo's real registries. The CLI entry point lives in
 * scripts/docker-smoke.mts.
 *
 * Note on health endpoints: every unit exposes /health — the Fastify
 * fragment services natively, the Next.js page apps via their dedicated
 * `apps/page-<name>/app/health/route.ts` (static, dependency free).
 */

import { buildRouteRegistry } from "../../../packages/routes/src/registry";
import registryData from "../../../registry/registry.data.json";

export type SmokeCheck = {
  id: string;
  url: string;
  expectStatus: number;
  expectSubstrings: string[];
  /**
   * Response headers that must be present and non-empty. The shell gateway is a
   * transparent proxy — it returns the page's HTML verbatim and injects no
   * marker — so a header it stamps is the only body-independent proof that the
   * request went through it. Names are compared lowercase.
   */
  expectHeaders?: string[];
};

export type SmokeCheckResult = {
  id: string;
  url: string;
  ok: boolean;
  status?: number;
  missingSubstrings: string[];
  missingHeaders: string[];
  error?: string;
  attempts: number;
};

export type SmokeSuiteResult = {
  ok: boolean;
  elapsedMs: number;
  checks: SmokeCheckResult[];
};

export type HttpResponseLike = {
  status: number;
  body: string;
  /** Optional so existing fakes keep working; absent means "none observed". */
  headers?: Record<string, string>;
};
export type HttpFetcher = (url: string) => Promise<HttpResponseLike>;
export type SleepFn = (ms: number) => Promise<void>;

/** Minimal slice of a fragment registry entry the derivation needs. */
export type SmokeFragmentChannels = {
  stable?: { serviceUrl: string };
  canary?: { serviceUrl: string };
};

/** Minimal slice of `registry/registry.data.json` the derivation needs. */
export type SmokeFragmentRegistryData = {
  fragments: Record<string, SmokeFragmentChannels>;
};

/** Minimal slice of `@mvp/routes`'s RouteRegistry the derivation needs. */
export type SmokeRouteRegistryData = {
  routes: ReadonlyArray<{ id: string; serviceUrl: string }>;
};

/** The shell gateway is not a registry entry; its port is fixed. */
const SHELL_GATEWAY_PORT = 4100;

/** Rewrite a registry serviceUrl's hostname (keeps port), e.g. for CI hosts. */
function originWithHost(serviceUrl: string, host: string): string {
  const url = new URL(serviceUrl);
  url.hostname = host;
  return url.origin;
}

/**
 * Derive the full-fleet smoke check list. Pure: fragment and route registry
 * data are injected rather than read from disk here.
 *
 * - One /health check per registered fragment, from its stable (preferred)
 *   or canary serviceUrl.
 * - One /health check per routed page, from its route serviceUrl; the page
 *   health route echoes its service name (`page-<id>`), asserted as a marker.
 * - Shell gateway /health plus the composed home and product shell routes
 *   including their rendered HTML markers.
 */
export function deriveSmokeChecks(
  registry: SmokeFragmentRegistryData,
  routes: SmokeRouteRegistryData,
  host = "localhost",
): SmokeCheck[] {
  const checks: SmokeCheck[] = [
    {
      id: "shell-gateway-health",
      url: `http://${host}:${SHELL_GATEWAY_PORT}/health`,
      expectStatus: 200,
      expectSubstrings: ['"status":"ok"', "shell-gateway"],
    },
  ];
  for (const [name, channels] of Object.entries(registry.fragments)) {
    const version = channels.stable ?? channels.canary;
    if (!version) continue;
    checks.push({
      id: `${name}-health`,
      url: `${originWithHost(version.serviceUrl, host)}/health`,
      expectStatus: 200,
      expectSubstrings: ['"status":"ok"'],
    });
  }
  for (const route of routes.routes) {
    checks.push({
      id: `page-${route.id}-health`,
      url: `${originWithHost(route.serviceUrl, host)}/health`,
      expectStatus: 200,
      expectSubstrings: ['"status":"ok"', `page-${route.id}`],
    });
  }
  checks.push(
    // No `data-shell-gateway="true"` here: 058f13b made the gateway a
    // transparent proxy that returns the page's HTML verbatim and injects no
    // chrome wrapper. `apps/shell-gateway/tests/server.test.ts` and both
    // `e2e/shell-*.spec.ts` assert that marker is ABSENT, so requiring it made
    // this suite contradict the design — invisibly, because docker-smoke had
    // never run in CI. Passage through the gateway is proven the way the e2e
    // specs prove it: the trace header it stamps on the response.
    {
      id: "shell-home-composed",
      url: `http://${host}:${SHELL_GATEWAY_PORT}/`,
      expectStatus: 200,
      expectSubstrings: ['data-page="home"'],
      expectHeaders: ["x-trace-id"],
    },
    {
      id: "shell-product-composed",
      url: `http://${host}:${SHELL_GATEWAY_PORT}/product/123`,
      expectStatus: 200,
      expectSubstrings: ['data-page="product"'],
      expectHeaders: ["x-trace-id"],
    },
  );
  return checks;
}

/**
 * Default smoke checks against the local Docker Compose stack, derived from
 * the repo's real fragment and route registries. Route env overrides
 * (`PAGE_<NAME>_URL`) are intentionally NOT applied — they point at
 * in-network hostnames unreachable from the smoke host; the `host` parameter
 * is the remap knob instead.
 */
export function createDefaultSmokeChecks(host = "localhost"): SmokeCheck[] {
  return deriveSmokeChecks(registryData, buildRouteRegistry({}), host);
}

/** Evaluate one response against one check. Pure. */
export function evaluateCheck(
  check: SmokeCheck,
  response: HttpResponseLike,
): { ok: boolean; missingSubstrings: string[]; missingHeaders: string[] } {
  const expectHeaders = check.expectHeaders ?? [];
  if (response.status !== check.expectStatus) {
    return {
      ok: false,
      missingSubstrings: check.expectSubstrings,
      missingHeaders: expectHeaders,
    };
  }
  const missingSubstrings = check.expectSubstrings.filter(
    (substring) => !response.body.includes(substring),
  );
  const headers = response.headers ?? {};
  const missingHeaders = expectHeaders.filter(
    (name) => !(headers[name.toLowerCase()] ?? "").trim(),
  );
  return {
    ok: missingSubstrings.length === 0 && missingHeaders.length === 0,
    missingSubstrings,
    missingHeaders,
  };
}

/**
 * Poll all checks until every check passes or the deadline is reached.
 * Failing checks are retried on each poll round; passing checks are not
 * re-fetched.
 */
export async function runSmokeSuite(
  checks: SmokeCheck[],
  fetcher: HttpFetcher,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    sleep?: SleepFn;
    now?: () => number;
  } = {},
): Promise<SmokeSuiteResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  const startedAt = now();
  const results = new Map<string, SmokeCheckResult>(
    checks.map((check) => [
      check.id,
      {
        id: check.id,
        url: check.url,
        ok: false,
        missingSubstrings: check.expectSubstrings,
        missingHeaders: check.expectHeaders ?? [],
        attempts: 0,
      },
    ]),
  );

  const pending = new Set(checks.map((check) => check.id));
  const checkById = new Map(checks.map((check) => [check.id, check]));

  while (pending.size > 0) {
    const passed: string[] = [];
    for (const id of pending) {
      const check = checkById.get(id) as SmokeCheck;
      const current = results.get(id) as SmokeCheckResult;
      current.attempts += 1;
      try {
        const response = await fetcher(check.url);
        const evaluated = evaluateCheck(check, response);
        current.status = response.status;
        current.missingSubstrings = evaluated.missingSubstrings;
        current.missingHeaders = evaluated.missingHeaders;
        current.error = undefined;
        current.ok = evaluated.ok;
      } catch (error) {
        current.ok = false;
        current.status = undefined;
        current.error = error instanceof Error ? error.message : String(error);
      }
      if (current.ok) passed.push(id);
    }
    for (const id of passed) pending.delete(id);

    if (pending.size === 0) break;
    if (now() - startedAt + intervalMs > timeoutMs) break;
    await sleep(intervalMs);
  }

  const checkResults = checks.map(
    (check) => results.get(check.id) as SmokeCheckResult,
  );
  return {
    ok: checkResults.every((result) => result.ok),
    elapsedMs: now() - startedAt,
    checks: checkResults,
  };
}
