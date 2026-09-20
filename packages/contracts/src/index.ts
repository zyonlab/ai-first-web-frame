import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const ReleaseChannelSchema = z.enum(["stable", "canary", "preview"]);
export type ReleaseChannel = z.infer<typeof ReleaseChannelSchema>;

// Note: "isr" was a deprecated alias for "ttl-cache" (it collided with
// Next.js ISR semantics, goal A4); the alias and its normalizeRenderStrategy
// shim were retired after the deprecation period — live manifests were
// codemodded in PR #9, and "isr" is now rejected by this enum.
export const RenderStrategySchema = z.enum([
  "static",
  "ttl-cache",
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
  /**
   * Open extension slot for context dimensions the FRAMEWORK must not know
   * about (A/B bucket, acquisition channel, membership tier).
   *
   * Without it this schema was closed: adding a dimension meant editing
   * `@mvp/contracts`, which is a framework package that the layering rule
   * forbids product code from touching — so the only legal move was to widen
   * the framework for a business need. `@podium/context` solves the same
   * problem with a `.register(name, parser)` extension point; this is the
   * schema-validated equivalent. Values are strings because they cross an
   * HTTP boundary (see `serializeContext`).
   */
  extensions: z.record(z.string()).default({}),
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
  /**
   * Backend endpoints this fragment's BROWSER-side code needs, as
   * `{ targetName: target }`, where a target is either an absolute
   * `http(s)` URL (a third-party or shared backend) or a **root-relative path**
   * resolved against this fragment's own `serviceUrl` from the registry.
   *
   * The composition gateway mounts each one at
   * `/_fragment/<fragment>/<target>/*` on the public origin, so an island can
   * call `/_fragment/order-form/account` — same-origin, no CORS, and the
   * fragment's real service address never reaches the browser.
   *
   * This closes a structural gap: a fragment could reach its backend during SSR
   * (through `@mvp/request`), but its hydrated island had no channel at all.
   * Modelled on `@podium/proxy`; the relative form is a deliberate departure
   * from it, because a fragment's own endpoint lives at a different host per
   * environment and an absolute self-target would have to be env-interpolated
   * into a static manifest.
   */
  proxy: z
    .record(
      z.union([
        z.string().url(),
        z.string().startsWith("/", "a relative proxy target must start with /"),
      ]),
    )
    .default({}),
  /**
   * Source-id **templates** this fragment's BROWSER panel keeps subscribed,
   * in the `<param>` placeholder vocabulary (`book.l2.<symbol>`). The page
   * binds the parameters at mount time and re-subscribes when one changes;
   * a template with no placeholder is a global source that survives a
   * parameter change untouched.
   *
   * Deliberately separate from the SSR-time `dataDependencies`: a fragment can
   * read a source once while rendering without holding it open in the browser,
   * and the two sets differ in practice (order-form reads `account` at render
   * time and subscribes to nothing).
   *
   * This is the declaration that lets a fragment become live — or change what
   * it listens to — without a page edit: `GET /manifest` publishes it, and
   * `@mvp/runtime/live` resolves and subscribes it generically.
   */
  subscriptions: z.array(z.string().min(1)).default([]),
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
  // Demo capability index (refactor plan §6): the short list of named
  // capabilities this page's composition actually proves (e.g.
  // "streaming:suspense-per-slot", "dag-scheduling"). Optional and
  // additive — every manifest that predates this field keeps parsing
  // unchanged. `docs/DEMOS.md` is the human/agent-facing index built from
  // these values; keep both in sync when a page's composition changes.
  demonstrates: z.array(z.string()).optional(),
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
      // ids referencing the page's data-source registry (mirrors
      // `@mvp/runtime`'s `FragmentSlotDefinition.dataDependencies`; refactor
      // plan §3.1 — manifest-driven composition needs this to codegen the
      // scheduler's data-dependency graph, not just the fragment slot list).
      dataDependencies: z.array(z.string()).default([]).optional(),
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
  /**
   * Optional URL to the fragment's browser-loadable island asset
   * (docs/ARCHITECTURE_REFACTOR_PLAN.md §4.3.3 C3 spike: "runtime island
   * assets"). When present, a page can dynamically `import()` this module at
   * runtime via an import map instead of statically bundling the island
   * component at build time. Optional and backward-compatible: every
   * existing registry entry (and every fragment the C3 spike didn't touch)
   * omits it and keeps resolving exactly as before.
   */
  assetsUrl: z.string().url().optional(),
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

/**
 * Lenient edge envelope for POST /render bodies: every part is optional but
 * type-checked. Fragments own graceful degradation for missing ctx/props, so
 * the edge only rejects structurally malformed envelopes.
 */
export const FragmentRenderRequestEnvelopeSchema = z.object({
  ctx: RequestContextSchema.partial().optional(),
  props: z.record(z.unknown()).optional(),
});
export type FragmentRenderRequestEnvelope = z.infer<
  typeof FragmentRenderRequestEnvelopeSchema
>;

export type ParseFragmentRenderRequestResult =
  | { ok: true; request: FragmentRenderRequestEnvelope; strict: boolean }
  | { ok: false; issues: z.ZodIssue[] };

/**
 * Parses a POST /render body at the fragment-service edge. A fully-formed
 * FragmentRenderRequest parses strictly; partial envelopes (missing props,
 * subset ctx) are accepted so fragments can degrade gracefully; anything
 * structurally malformed fails with the strict schema's issues.
 */
export function parseFragmentRenderRequest(
  body: unknown,
): ParseFragmentRenderRequestResult {
  const strict = FragmentRenderRequestSchema.safeParse(body);
  if (strict.success) return { ok: true, request: strict.data, strict: true };
  const lenient = FragmentRenderRequestEnvelopeSchema.safeParse(body ?? {});
  if (lenient.success)
    return { ok: true, request: lenient.data, strict: false };
  // Report the canonical schema's issues so the error names the contract.
  return { ok: false, issues: strict.error.issues };
}

export const FragmentRenderResponseSchema = z.object({
  html: z.string(),
  assets: z.object({ js: z.array(z.string()), css: z.array(z.string()) }),
  cache: z.object({
    ttl: z.number().int().nonnegative(),
    tags: z.array(z.string()),
  }),
  metadata: z.object({
    name: z.string(),
    version: z.string(),
    // True when this response is a degraded/fallback render. Absent = normal.
    fallback: z.boolean().optional(),
  }),
});
export type FragmentRenderResponse = z.infer<
  typeof FragmentRenderResponseSchema
>;

export type ParseFragmentRenderResponseResult =
  | { ok: true; response: FragmentRenderResponse }
  | { ok: false; issues: z.ZodIssue[] };

/**
 * Validates a fragment's POST /render response body at the page-runtime edge
 * (the consuming mirror of `parseFragmentRenderRequest`). Unlike the
 * request side there is no lenient tier: a fragment that cannot produce a
 * structurally valid FragmentRenderResponse is treated as failed, and the
 * composing page degrades that slot to its fallback instead of letting a
 * malformed body flow into composition.
 */
export function parseFragmentRenderResponse(
  body: unknown,
): ParseFragmentRenderResponseResult {
  const parsed = FragmentRenderResponseSchema.safeParse(body);
  if (parsed.success) return { ok: true, response: parsed.data };
  return { ok: false, issues: parsed.error.issues };
}

/**
 * Validates the inline `<script type="application/json" data-island-props>`
 * snapshot a fragment stamps next to a `@mvp/islands` mount node (the C2
 * handshake payload; see `packages/islands/src/index.ts`'s `IslandSnapshot`).
 * Only `props` is structurally required (and defaults to `{}` when the field
 * itself is absent, matching the pre-existing lenient behavior); every other
 * field is optional so a snapshot from an old/non-participating fragment
 * (no `version`/`slice`/`fragment`/`contractHash`) still validates — this
 * schema exists to reject genuinely malformed payloads (unparseable JSON,
 * wrong top-level shape, or a field present with the wrong type), not to
 * require the full C2 handshake.
 */
export const IslandSnapshotSchema = z.object({
  props: z.record(z.unknown()).default({}),
  slice: z.string().optional(),
  fragment: z.string().optional(),
  version: z.string().optional(),
  contractHash: z.string().optional(),
});
export type IslandSnapshot = z.infer<typeof IslandSnapshotSchema>;

/**
 * Converts a Zod schema into a plain JSON Schema object (draft-07 by
 * default, per `zod-to-json-schema`'s default target) so non-TypeScript
 * agents/tools that only speak JSON Schema can validate against the same
 * contracts TypeScript consumers get via `z.infer`
 * (docs/ARCHITECTURE_REFACTOR_PLAN.md §2.3: "contracts export both Zod
 * schemas and generated JSON Schema so non-TS agents can validate").
 *
 * @param schema - any Zod schema exported from this package.
 * @param name - optional schema name; when provided, the result is wrapped
 *   with a `$ref` pointing at a `definitions` entry named after it (the
 *   `zod-to-json-schema` "named schema" convention), which is useful when
 *   embedding the result inside a larger combined schema payload.
 */
export function toJsonSchema(schema: z.ZodTypeAny, name?: string): object {
  return zodToJsonSchema(schema, name);
}

// Ready-made JSON Schema exports for the schemas most relevant to non-TS
// agents validating framework boundaries (fragment manifests, page
// manifests, the fragment registry, /render request+response bodies, and
// the per-request context every framework boundary is stamped with).
export const FragmentManifestJsonSchema = toJsonSchema(
  FragmentManifestSchema,
  "FragmentManifest",
);
export const PageManifestJsonSchema = toJsonSchema(
  PageManifestSchema,
  "PageManifest",
);
export const FragmentRegistryJsonSchema = toJsonSchema(
  FragmentRegistrySchema,
  "FragmentRegistry",
);
export const FragmentRenderRequestJsonSchema = toJsonSchema(
  FragmentRenderRequestSchema,
  "FragmentRenderRequest",
);
export const FragmentRenderResponseJsonSchema = toJsonSchema(
  FragmentRenderResponseSchema,
  "FragmentRenderResponse",
);
export const RequestContextJsonSchema = toJsonSchema(
  RequestContextSchema,
  "RequestContext",
);

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
