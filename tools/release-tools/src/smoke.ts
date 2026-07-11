/**
 * Docker Compose smoke check logic.
 *
 * Pure and injectable so it can be unit tested: HTTP access and sleeping are
 * passed in as functions. The CLI entry point lives in
 * scripts/docker-smoke.mts.
 *
 * Note on health endpoints: shell-gateway, promotion-banner, and
 * recommendation-widget expose /health (Fastify services). The Next.js page
 * apps (page-home, page-product) do not expose /health yet (observability
 * gap), so their liveness is asserted through their rendered pages and page
 * markers instead.
 */

export type SmokeCheck = {
  id: string;
  url: string;
  expectStatus: number;
  expectSubstrings: string[];
};

export type SmokeCheckResult = {
  id: string;
  url: string;
  ok: boolean;
  status?: number;
  missingSubstrings: string[];
  error?: string;
  attempts: number;
};

export type SmokeSuiteResult = {
  ok: boolean;
  elapsedMs: number;
  checks: SmokeCheckResult[];
};

export type HttpResponseLike = { status: number; body: string };
export type HttpFetcher = (url: string) => Promise<HttpResponseLike>;
export type SleepFn = (ms: number) => Promise<void>;

/** Default smoke checks against the local Docker Compose stack. */
export function createDefaultSmokeChecks(host = "localhost"): SmokeCheck[] {
  return [
    {
      id: "shell-gateway-health",
      url: `http://${host}:4100/health`,
      expectStatus: 200,
      expectSubstrings: ['"status":"ok"', "shell-gateway"],
    },
    {
      id: "promotion-banner-health",
      url: `http://${host}:4201/health`,
      expectStatus: 200,
      expectSubstrings: ['"status":"ok"'],
    },
    {
      id: "recommendation-widget-health",
      url: `http://${host}:4202/health`,
      expectStatus: 200,
      expectSubstrings: ['"status":"ok"'],
    },
    {
      id: "page-home-health",
      url: `http://${host}:4101/health`,
      expectStatus: 200,
      expectSubstrings: ['"status":"ok"', "page-home"],
    },
    {
      id: "page-product-health",
      url: `http://${host}:4102/health`,
      expectStatus: 200,
      expectSubstrings: ['"status":"ok"', "page-product"],
    },
    {
      id: "shell-home-composed",
      url: `http://${host}:4100/`,
      expectStatus: 200,
      expectSubstrings: ['data-shell-gateway="true"', 'data-page="home"'],
    },
    {
      id: "shell-product-composed",
      url: `http://${host}:4100/product/123`,
      expectStatus: 200,
      expectSubstrings: ['data-shell-gateway="true"', 'data-page="product"'],
    },
  ];
}

/** Evaluate one response against one check. Pure. */
export function evaluateCheck(
  check: SmokeCheck,
  response: HttpResponseLike,
): { ok: boolean; missingSubstrings: string[] } {
  if (response.status !== check.expectStatus) {
    return { ok: false, missingSubstrings: check.expectSubstrings };
  }
  const missingSubstrings = check.expectSubstrings.filter(
    (substring) => !response.body.includes(substring),
  );
  return { ok: missingSubstrings.length === 0, missingSubstrings };
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
