import { z } from "zod";

export const ReleaseChannelSchema = z.enum(["stable", "canary", "preview"]);
export type ReleaseChannel = z.infer<typeof ReleaseChannelSchema>;

export const RenderStrategySchema = z.enum([
  "static",
  "isr",
  "cached-ssr",
  "dynamic-ssr",
]);
export type RenderStrategy = z.infer<typeof RenderStrategySchema>;

export const CachePolicySchema = z.object({
  ttl: z.number().int().nonnegative(),
  tags: z.array(z.string()).default([]),
  vary: z
    .array(z.enum(["tenant", "locale", "experiment", "device", "props"]))
    .default(["tenant", "locale", "experiment", "props"]),
});
export type CachePolicy = z.infer<typeof CachePolicySchema>;

export const DataFreshnessSchema = z.enum([
  "static",
  "build-time",
  "isr",
  "request-time",
  "near-realtime",
  "realtime",
  "client-local",
]);
export type DataFreshness = z.infer<typeof DataFreshnessSchema>;

export const DataPrivacySchema = z.enum([
  "public",
  "tenant",
  "user-segment",
  "user-private",
]);
export type DataPrivacy = z.infer<typeof DataPrivacySchema>;

export const DataDependencySchema = z
  .object({
    id: z.string().min(1),
    owner: z.enum(["shell", "page", "fragment", "client-island"]),
    source: z.enum([
      "context",
      "route",
      "api",
      "server-function",
      "worker",
      "storage",
      "subscription",
    ]),
    freshness: DataFreshnessSchema,
    privacy: DataPrivacySchema,
    cachePolicy: CachePolicySchema.optional(),
    invalidationTags: z.array(z.string()).default([]),
    dependsOn: z.array(z.string()).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.privacy === "user-private" && value.freshness === "static") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["freshness"],
        message: "user-private data cannot be static",
      });
    }
    if (value.freshness === "realtime" && value.cachePolicy?.ttl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cachePolicy"],
        message: "realtime data cannot use ttl cache",
      });
    }
    if (value.source === "subscription" && value.freshness !== "realtime") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["freshness"],
        message: "subscription sources must be realtime",
      });
    }
  });
export type DataDependency = z.infer<typeof DataDependencySchema>;

export const AssetResourceSchema = z.object({
  href: z.string().min(1),
  scope: z
    .enum(["global", "page", "fragment", "client-island"])
    .default("page"),
  priority: z.number().int().nonnegative().default(100),
  integrity: z.string().optional(),
  crossOrigin: z.enum(["anonymous", "use-credentials"]).optional(),
  nonce: z.string().optional(),
});
export type AssetResource = z.infer<typeof AssetResourceSchema>;

export const ScriptAssetSchema = AssetResourceSchema.extend({
  strategy: z
    .enum(["none", "module", "defer", "worker", "island"])
    .default("defer"),
});
export type ScriptAsset = z.infer<typeof ScriptAssetSchema>;

export const FontManifestSchema = z.object({
  family: z.string().min(1),
  href: z.string().min(1),
  preload: z.boolean().default(false),
  display: z
    .enum(["auto", "block", "swap", "fallback", "optional"])
    .default("swap"),
  weight: z.string().optional(),
});
export type FontManifest = z.infer<typeof FontManifestSchema>;

export const AssetManifestSchema = z.object({
  css: z.array(AssetResourceSchema).default([]),
  js: z.array(ScriptAssetSchema).default([]),
  fonts: z.array(FontManifestSchema).default([]),
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

export const ThemeManifestSchema = z.object({
  tokenVersion: z.string().min(1),
  cssVarPrefix: z.string().min(1).default("mvp"),
  supportedThemes: z.array(z.enum(["light", "dark", "system"])).min(1),
  defaultTheme: z.enum(["light", "dark", "system"]).default("system"),
});
export type ThemeManifest = z.infer<typeof ThemeManifestSchema>;

export const I18nManifestSchema = z.object({
  namespaces: z.array(z.string().min(1)).default([]),
  locales: z.array(z.string().min(2)).min(1),
  fallbackLocale: z.string().min(2),
  version: z.string().min(1),
});
export type I18nManifest = z.infer<typeof I18nManifestSchema>;

export const ApiEndpointPolicySchema = z.object({
  id: z.string().min(1),
  baseUrl: z.string().url(),
  allowedMethods: z
    .array(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]))
    .default(["GET"]),
  timeoutMs: z.number().int().positive().default(500),
  retries: z.number().int().nonnegative().default(0),
  privacy: DataPrivacySchema.default("public"),
});
export type ApiEndpointPolicy = z.infer<typeof ApiEndpointPolicySchema>;

export const RequestPolicySchema = z.object({
  endpoints: z.array(ApiEndpointPolicySchema).default([]),
  defaultTimeoutMs: z.number().int().positive().default(500),
  maxRetries: z.number().int().nonnegative().default(1),
});
export type RequestPolicy = z.infer<typeof RequestPolicySchema>;

export const StoragePolicySchema = z
  .object({
    id: z.string().min(1),
    adapter: z.enum([
      "memory",
      "cookie",
      "local-storage",
      "session-storage",
      "indexed-db",
      "cache-api",
      "server-kv",
    ]),
    privacy: DataPrivacySchema,
    ttl: z.number().int().nonnegative().optional(),
    partitionBy: z
      .array(z.enum(["tenant", "locale", "theme", "device", "user"]))
      .default(["tenant"]),
    encrypted: z.boolean().default(false),
    ssr: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (
      value.privacy === "user-private" &&
      !value.partitionBy.includes("user")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partitionBy"],
        message: "user-private storage must partition by user",
      });
    }
  });
export type StoragePolicy = z.infer<typeof StoragePolicySchema>;

export const CookiePolicySchema = z.object({
  name: z.string().min(1),
  httpOnly: z.boolean().default(true),
  secure: z.boolean().default(true),
  sameSite: z.enum(["strict", "lax", "none"]).default("lax"),
  path: z.string().default("/"),
  domain: z.string().optional(),
  maxAge: z.number().int().positive().optional(),
  signed: z.boolean().default(false),
  encrypted: z.boolean().default(false),
});
export type CookiePolicy = z.infer<typeof CookiePolicySchema>;

export const WorkerManifestSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "dedicated-worker",
    "shared-worker",
    "service-worker",
    "server-background",
    "queue-worker",
  ]),
  scope: z.string().optional(),
  privacy: DataPrivacySchema.default("public"),
  cachePolicy: CachePolicySchema.optional(),
});
export type WorkerManifest = z.infer<typeof WorkerManifestSchema>;

export const InteractionContractSchema = z.object({
  channel: z.string().min(1),
  publisher: z.string().min(1),
  subscribers: z.array(z.string().min(1)).default([]),
  payloadSchema: z.record(z.unknown()).default({}),
});
export type InteractionContract = z.infer<typeof InteractionContractSchema>;

export const ReleaseManifestSchema = z.object({
  unit: z.enum(["shell", "page", "fragment", "package", "tool"]),
  name: z.string().min(1),
  version: z.string().min(1),
  image: z.string().optional(),
  channel: ReleaseChannelSchema,
  rollbackTo: z.string().optional(),
  smokeTests: z.array(z.string()).default([]),
});
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

export const OptimizationFindingLocationSchema = z.object({
  filePath: z.string().min(1).optional(),
  manifestPath: z.string().min(1).optional(),
  slotName: z.string().min(1).optional(),
  dataKey: z.string().min(1).optional(),
  fragmentName: z.string().min(1).optional(),
});
export type OptimizationFindingLocation = z.infer<
  typeof OptimizationFindingLocationSchema
>;

export const OptimizationEvidenceSchema = z.object({
  traceId: z.string().min(1),
  spanIds: z.array(z.string()).default([]),
  measurements: z.record(z.number()).optional(),
});
export type OptimizationEvidence = z.infer<typeof OptimizationEvidenceSchema>;

export const OptimizationFindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  category: z.enum([
    "ssg",
    "isr",
    "cache",
    "network",
    "data",
    "asset",
    "dependency",
    "security",
  ]),
  message: z.string().min(1),
  target: z.string().min(1),
  evidence: z.record(z.unknown()).default({}),
  location: OptimizationFindingLocationSchema.optional(),
  traceEvidence: z.array(OptimizationEvidenceSchema).optional(),
  recommendation: z.string().min(1),
});
export type OptimizationFinding = z.infer<typeof OptimizationFindingSchema>;

export const RequestContextSchema = z.object({
  traceId: z.string().min(8),
  requestId: z.string().min(4),
  locale: z.string().min(2),
  tenant: z.string().min(1),
  user: z.object({ id: z.string(), role: z.string().optional() }).optional(),
  session: z.object({ id: z.string() }).optional(),
  featureFlags: z.record(z.union([z.boolean(), z.string(), z.number()])),
  experiment: z.record(z.string()).default({}),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  device: z
    .enum(["mobile", "tablet", "desktop", "bot", "unknown"])
    .default("unknown"),
  userAgent: z.string().default(""),
  ip: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type RequestContext = z.infer<typeof RequestContextSchema>;

export const PerformanceBudgetSchema = z.object({
  scope: z.enum(["component", "fragment", "page", "shell"]),
  name: z.string().min(1),
  jsBytes: z.number().int().nonnegative().optional(),
  cssBytes: z.number().int().nonnegative().optional(),
  rscPayloadBytes: z.number().int().nonnegative().optional(),
  htmlBytes: z.number().int().nonnegative().optional(),
  imageBytes: z.number().int().nonnegative().optional(),
  maxRenderMs: z.number().nonnegative().optional(),
  maxHydrationMs: z.number().nonnegative().optional(),
  maxMemoryMB: z.number().nonnegative().optional(),
  maxNetworkRequests: z.number().int().nonnegative().optional(),
  maxTTFBMs: z.number().nonnegative().optional(),
  maxLCPMs: z.number().nonnegative().optional(),
  maxINPMs: z.number().nonnegative().optional(),
  maxCLS: z.number().nonnegative().optional(),
  maxFragmentLatencyMs: z.number().nonnegative().optional(),
});
export type PerformanceBudget = z.infer<typeof PerformanceBudgetSchema>;

export const ComponentMetadataSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  owner: z.string().min(1),
  category: z.string().min(1),
  serverSafe: z.boolean(),
  propsSchema: z.record(z.unknown()).default({}),
  description: z.string().min(1),
});
export type ComponentMetadata = z.infer<typeof ComponentMetadataSchema>;

export const ComponentManifestSchema = z.object({
  metadata: ComponentMetadataSchema,
  budget: PerformanceBudgetSchema.refine(
    (value) => value.scope === "component",
    "component budget required",
  ),
  assets: z.object({ js: z.array(z.string()), css: z.array(z.string()) }),
});
export type ComponentManifest = z.infer<typeof ComponentManifestSchema>;

export const FragmentManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  owner: z.string().min(1),
  renderMode: z.enum(["ssr", "edge-ssr"]),
  renderStrategy: RenderStrategySchema.default("dynamic-ssr"),
  cachePolicy: CachePolicySchema.optional(),
  fallback: z.string().min(1),
  assets: z.object({ js: z.array(z.string()), css: z.array(z.string()) }),
  budget: PerformanceBudgetSchema.refine(
    (value) => value.scope === "fragment",
    "fragment budget required",
  ),
});
export type FragmentManifest = z.infer<typeof FragmentManifestSchema>;

export const PageManifestSchema = z.object({
  name: z.string().min(1),
  route: z.string().min(1),
  renderMode: z.enum(["ssr", "ssg", "isr", "hybrid"]),
  renderStrategy: RenderStrategySchema.or(z.literal("hybrid")).optional(),
  revalidateSeconds: z.number().int().nonnegative().optional(),
  seo: z.object({ title: z.string().min(1), description: z.string().min(1) }),
  budget: PerformanceBudgetSchema.refine(
    (value) => value.scope === "page",
    "page budget required",
  ),
  slots: z.array(
    z.object({
      name: z.string().min(1),
      fragment: z.string().min(1),
      channel: ReleaseChannelSchema.optional(),
      strategy: RenderStrategySchema.optional(),
      timeoutMs: z.number().int().nonnegative().optional(),
      props: z.record(z.unknown()).optional(),
      staticHtml: z.string().optional(),
      cachePolicy: CachePolicySchema.optional(),
      dependsOn: z.array(z.string()).default([]).optional(),
      required: z.boolean().optional(),
    }),
  ),
});
export type PageManifest = z.infer<typeof PageManifestSchema>;

export const RouteManifestSchema = z.object({
  routes: z.array(
    z.object({
      id: z.string().min(1),
      path: z.string().min(1),
      page: z.string().min(1),
      serviceUrl: z.string().url(),
      channel: ReleaseChannelSchema,
    }),
  ),
});
export type RouteManifest = z.infer<typeof RouteManifestSchema>;

export const FragmentRegistryEntrySchema = z.object({
  version: z.string().min(1),
  serviceUrl: z.string().url(),
  manifestUrl: z.string().url(),
});

export const FragmentRegistrySchema = z.object({
  fragments: z.record(
    z
      .object({
        stable: FragmentRegistryEntrySchema.optional(),
        canary: FragmentRegistryEntrySchema.optional(),
        preview: FragmentRegistryEntrySchema.optional(),
        versions: z.record(FragmentRegistryEntrySchema).optional(),
      })
      .refine(
        (value) =>
          value.stable || value.canary || value.preview || value.versions,
        "at least one channel or version is required",
      ),
  ),
});
export type FragmentRegistry = z.infer<typeof FragmentRegistrySchema>;

export const FragmentRenderRequestSchema = z.object({
  ctx: RequestContextSchema,
  props: z.record(z.unknown()),
});
export type FragmentRenderRequest = z.infer<typeof FragmentRenderRequestSchema>;

export const FragmentRenderResponseSchema = z.object({
  html: z.string(),
  assets: z.object({ js: z.array(z.string()), css: z.array(z.string()) }),
  cache: z.object({
    ttl: z.number().int().nonnegative(),
    tags: z.array(z.string()),
  }),
  metadata: z.object({ name: z.string(), version: z.string() }),
});
export type FragmentRenderResponse = z.infer<
  typeof FragmentRenderResponseSchema
>;

const defaultBudgets = {
  component: {
    scope: "component",
    name: "default-component",
    jsBytes: 15000,
    cssBytes: 5000,
    maxRenderMs: 16,
    maxHydrationMs: 30,
    maxMemoryMB: 5,
  },
  fragment: {
    scope: "fragment",
    name: "default-fragment",
    jsBytes: 30000,
    cssBytes: 10000,
    maxFragmentLatencyMs: 200,
    maxRenderMs: 50,
    maxMemoryMB: 20,
  },
  page: {
    scope: "page",
    name: "default-page",
    jsBytes: 180000,
    cssBytes: 50000,
    rscPayloadBytes: 120000,
    maxNetworkRequests: 20,
    maxTTFBMs: 800,
    maxLCPMs: 2500,
    maxINPMs: 200,
    maxCLS: 0.1,
  },
  shell: {
    scope: "shell",
    name: "default-shell",
    jsBytes: 80000,
    cssBytes: 20000,
    maxTTFBMs: 300,
    maxMemoryMB: 64,
  },
} satisfies Record<PerformanceBudget["scope"], PerformanceBudget>;

export function loadDefaultBudget(
  scope: PerformanceBudget["scope"],
  name = `default-${scope}`,
): PerformanceBudget {
  return { ...defaultBudgets[scope], name };
}

export function mergeBudget(
  defaultBudget: PerformanceBudget,
  customBudget: Partial<PerformanceBudget>,
): PerformanceBudget {
  return PerformanceBudgetSchema.parse({
    ...defaultBudget,
    ...customBudget,
    scope: defaultBudget.scope,
    name: customBudget.name ?? defaultBudget.name,
  });
}

export function assertBudget(
  actual: Partial<PerformanceBudget>,
  budget: PerformanceBudget,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const [key, budgetValue] of Object.entries(budget)) {
    if (key === "scope" || key === "name" || typeof budgetValue !== "number")
      continue;
    const actualValue = actual[key as keyof PerformanceBudget];
    if (typeof actualValue === "number" && actualValue > budgetValue)
      violations.push(`${key}: ${actualValue} > ${budgetValue}`);
  }
  return { ok: violations.length === 0, violations };
}

export function createBudgetReport(
  actual: Partial<PerformanceBudget>,
  budget: PerformanceBudget,
) {
  const result = assertBudget(actual, budget);
  return {
    scope: budget.scope,
    name: budget.name,
    actual,
    budget,
    status: result.ok ? "passed" : "failed",
    violations: result.violations,
  };
}
