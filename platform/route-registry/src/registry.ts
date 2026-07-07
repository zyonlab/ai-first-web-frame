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

export const routeRegistry: RouteRegistry = {
  routes: [
    {
      id: "home",
      path: "/",
      page: "@mvp/page-home",
      serviceUrl: process.env.PAGE_HOME_URL ?? "http://localhost:4101",
      channel: "stable",
    },
    {
      id: "product",
      path: "/product/:id",
      page: "@mvp/page-product",
      serviceUrl: process.env.PAGE_PRODUCT_URL ?? "http://localhost:4102",
      channel: "stable",
    },
    {
      id: "trade",
      path: "/trade/:symbol",
      page: "@mvp/page-trade",
      serviceUrl: process.env.PAGE_TRADE_URL ?? "http://localhost:4103",
      channel: "stable",
    },
    {
      id: "markets",
      path: "/markets",
      page: "@mvp/page-markets",
      serviceUrl: process.env.PAGE_MARKETS_URL ?? "http://localhost:4104",
      channel: "stable",
    },
    {
      id: "portfolio",
      path: "/portfolio",
      page: "@mvp/page-portfolio",
      serviceUrl: process.env.PAGE_PORTFOLIO_URL ?? "http://localhost:4105",
      channel: "stable",
    },
  ],
};

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
