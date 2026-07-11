import { RouteManifestSchema } from "@mvp/contracts";

export type ReleaseChannel = "stable" | "canary" | "preview";

export type RouteEntry = {
  id: "home" | "product" | string;
  path: string;
  page: string;
  serviceUrl: string;
  channel: ReleaseChannel;
};

export type RouteRegistry = {
  routes: RouteEntry[];
};

/**
 * H3: a `PAGE_<NAME>_URL` env override is spliced into a route's serviceUrl
 * unvalidated, so garbage used to propagate silently into every proxied
 * request. Validate the override at build time (module load / boot) with the
 * same URL schema `RouteManifestSchema` uses for `serviceUrl`
 * (`z.string().url()`). An unset env var keeps the pre-existing default.
 */
const RouteServiceUrlSchema =
  RouteManifestSchema.shape.routes.element.shape.serviceUrl;

function pageServiceUrl(
  envVar: string,
  fallback: string,
  env: Record<string, string | undefined>,
): string {
  const override = env[envVar];
  if (override === undefined) return fallback;
  const result = RouteServiceUrlSchema.safeParse(override);
  if (!result.success)
    throw new Error(
      `RouteManifestSchema: env override ${envVar}="${override}" is not a valid serviceUrl (z.string().url()): ${
        result.error.issues[0]?.message ?? "invalid url"
      }`,
    );
  return override;
}

export function buildRouteRegistry(
  env: Record<string, string | undefined> = process.env,
): RouteRegistry {
  return {
    routes: [
      {
        id: "home",
        path: "/",
        page: "@mvp/page-home",
        serviceUrl: pageServiceUrl(
          "PAGE_HOME_URL",
          "http://localhost:4101",
          env,
        ),
        channel: "stable",
      },
      {
        id: "product",
        path: "/product/:id",
        page: "@mvp/page-product",
        serviceUrl: pageServiceUrl(
          "PAGE_PRODUCT_URL",
          "http://localhost:4102",
          env,
        ),
        channel: "stable",
      },
      {
        id: "trade",
        path: "/trade/:symbol",
        page: "@mvp/page-trade",
        serviceUrl: pageServiceUrl(
          "PAGE_TRADE_URL",
          "http://localhost:4103",
          env,
        ),
        channel: "stable",
      },
      {
        id: "markets",
        path: "/markets",
        page: "@mvp/page-markets",
        serviceUrl: pageServiceUrl(
          "PAGE_MARKETS_URL",
          "http://localhost:4104",
          env,
        ),
        channel: "stable",
      },
      {
        id: "portfolio",
        path: "/portfolio",
        page: "@mvp/page-portfolio",
        serviceUrl: pageServiceUrl(
          "PAGE_PORTFOLIO_URL",
          "http://localhost:4105",
          env,
        ),
        channel: "stable",
      },
      {
        id: "vaults",
        path: "/vaults",
        page: "@mvp/page-vaults",
        serviceUrl: pageServiceUrl(
          "PAGE_VAULTS_URL",
          "http://localhost:4106",
          env,
        ),
        channel: "stable",
      },
      {
        id: "referrals",
        path: "/referrals",
        page: "@mvp/page-referrals",
        serviceUrl: pageServiceUrl(
          "PAGE_REFERRALS_URL",
          "http://localhost:4107",
          env,
        ),
        channel: "stable",
      },
    ],
  };
}

export const routeRegistry: RouteRegistry = buildRouteRegistry();

export function matchRoute(
  pathname: string,
  registry: RouteRegistry = routeRegistry,
): RouteEntry | null {
  return (
    registry.routes.find(
      (route) =>
        route.path === pathname || matchesPathPattern(route.path, pathname),
    ) ?? null
  );
}

export function matchesPathPattern(pattern: string, pathname: string): boolean {
  if (!pattern.includes(":")) return pattern === pathname;
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;

  return patternParts.every(
    (part, index) => part.startsWith(":") || part === pathParts[index],
  );
}

export function validateRouteRegistry(registry: RouteRegistry): boolean {
  return (
    Array.isArray(registry.routes) &&
    registry.routes.every(
      (route) =>
        typeof route.id === "string" &&
        route.path.startsWith("/") &&
        route.page.startsWith("@mvp/") &&
        route.serviceUrl.startsWith("http") &&
        ["stable", "canary", "preview"].includes(route.channel),
    )
  );
}
