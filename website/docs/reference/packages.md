# Packages

The 20 `packages/*` libraries and the 5 `domains/*` example packages, with their real export
surface. Every `packages/*` and `domains/*` directory also ships an `AGENT.md` whose examples are
executed by `pnpm docs:test`.

## Framework — `packages/*`

| Package | Subpaths | Key exports |
| --- | --- | --- |
| `@mvp/contracts` | `.` | 35 Zod schemas, 6 JSON Schemas, `parseFragmentRenderRequest/Response`, `toJsonSchema`, `loadDefaultBudget`, `mergeBudget`, `assertBudget`, `createBudgetReport` |
| `@mvp/runtime` | `.` `./react` `./seo` `./live` | see below |
| `@mvp/fragment-host` | `.` | `createFragmentServer`, `startFragmentServer`, `createFragmentObservability`, `configureFragmentTraceExport`, `renderFragmentServiceHome`, `isProcessEntry` |
| `@mvp/registry` | `.` | `resolveFragment`, `buildFragmentRegistry`, `fragmentEnvVarName`, `applyRegisterFragment`, `applyPromoteFragment`, `applyRollbackFragment`, `applyMountSlot`, `applyUnmountSlot`, `diffManifestAgainstRuntime`, `generateFragmentSlotsSource`, `checkFragmentSlotsGenFileFreshness`, `writeFileAtomic`, `loadFileWithHash`, `parseCliArgs`, `unknownFlagError`, compose helpers |
| `@mvp/routes` | `.` | `routeRegistry`, `buildRouteRegistry`, `matchRoute`, `matchesPathPattern`, `validateRouteRegistry` |
| `@mvp/data` | `.` | `createDataClient`, `defineDataSource`, `createDataKey`, `validateRuntimeFreshness`, `createMemorySubscriptionTransport`, `MemoryCacheAdapter`, `DataDependencyError` |
| `@mvp/request` | `.` | `createRequestClient`, `RequestContractError`, `RequestPolicyError`, `RequestTimeoutError` |
| `@mvp/request-context` | `.` | `createRequestContext`, `serializeContext`, `deserializeContext`, `getLocale/getTenant/getTraceId/getUser/getFeatureFlags/getContextExtension`, `CONTEXT_EXTENSION_HEADER_PREFIX` |
| `@mvp/islands` | `.` | `registerIsland`, `hydrateIslands`, `mountIsland`, `readIslandSnapshot`, `configureIslandRuntime`, `getIsland`, `clearIslandRegistry` |
| `@mvp/interaction` | `.` | `createInteractionBus`, `defineMutation`, `validateInteractionPayload`, `createBroadcastBridge`, `InteractionContractError`, `MutationContractError` |
| `@mvp/store` | `.` | `createSliceStore`, `useStoreSlice` |
| `@mvp/storage` | `.` | `createStorage` + cookie/local/session/memory/server-KV adapters, `assertStoragePolicy`, `validateStoragePolicy`, `resolveStoragePartition`, `requiredPartitionKeysForPrivacy`, `parseCookieHeader`, `StoragePolicyError` |
| `@mvp/observability` | `.` | `createRequestTrace`, `createTraceSpan`, `measureDuration`, `logEvent`, `createInMemoryLogSink`, metrics registry (`createHttpMetrics`, `recordWebVital`), trace export (`configureTraceExport`, `createOtlpJsonTraceExporter`, `createFileTraceExporter`, `createConsoleTraceExporter`, `createTraceSampler`, `flushTraceExport`) |
| `@mvp/optimizer` | `.` | `createOptimizationFindings`, `createOptimizationMarkdown`, `loadTraceSnapshots`, `formatEvidence`, `formatLocation` |
| `@mvp/assets` | `.` | `collectAssets`, `mergeAssetsWithPolicy`, `createAssetHtmlTags`, `createAssetKey` |
| `@mvp/design-tokens` | `.` | `tokens`, `createCssVariables` |
| `@mvp/design-system` | `.` | `tokens`, `cssVariableNames`, `TOKEN_PREFIX`, `themeColors`, `createThemeVariables`, `createAllThemeVariables`, `createBaseVariables`, `emitDeclarations`, `tailwindPreset`, `DARK_MODE_SELECTOR`, `baseResetCss` |
| `@mvp/ui` | `.` + 7 components + `./shadcn` + `./shadcn/globals.css` + `./tailwind.config` | `Button`, `Card`, `Image`, `Section`, `Skeleton`, `AppNav`, `ProductCardBase`, each with `metadata`/`budget`/`fixtures`; `./shadcn` adds 11 primitives (command, data-table, dialog, dropdown-menu, locale-switcher, select, slider, tabs, theme-toggle, toast, tooltip) plus `shadcnMetadata` and `cn` |
| `@mvp/workers` | `.` | `createBackgroundWorker`, `createWorkerHost`, `createWorkerClient`, `createScheduledJob`, `describeWorkerTask`, `validateWorkerManifest`, `WorkerManifestError`, `WorkerTaskCancelledError` |
| `@mvp/mcp` | `.` | `devxTools`, `SCRIPT_TOOLS`, `findSchemaViolation` |

### `@mvp/runtime` by subpath

| Subpath | Exports |
| --- | --- |
| `.` | `executeFragmentSlots`, `streamFragmentSlots`, `fetchFragmentSlots`, `fetchFragmentSlot`, `fetchFragment`, `resolveFragment`, `resolveRoute`, `createSlotDataExecutionPlan`, `createFragmentSlotExecutionPlan`, `createFallbackResponse`, `createFallbackHtml`, `isFallbackResponse`, `createFragmentCache` + `pruneFragmentCache` + `invalidateFragmentCacheByTag` + `createFragmentCacheKey`, `withTimeout`, `mergeAssets`, `readPageHealthFromHtml`, `failedRequiredSlotNames`, `PAGE_HEALTH_ATTR`, `PAGE_HEALTH_FAILED_ATTR`, `collectSlotDiagnostics`, `applySlotRequestOverrides`, plus `fragmentProxy` (`parseFragmentProxyPath`, `buildFragmentProxyUrl`, `resolveFragmentProxy`, `FRAGMENT_PROXY_PREFIX`) |
| `./react` | `FragmentSlot`, `FragmentSlotStream`, `PageHealthMeta`, `PageHealthMetaStream` |
| `./seo` | `createPageMetadata`, `resolveSiteOrigin`, `isDiagnosticsEnabled`, `SITE_LOCALES`, `SITE_NAME`, `DEFAULT_SITE_ORIGIN` |
| `./live` | `startLivePanels`, `templateParams`, `resolveSourceTemplate`, `panelDocument`, `setFieldText`, `fieldText`, `parseFieldNumber`, `cssEscapeAttr` |

## Domain examples — `domains/*`

Not framework. They exist to show what a product layer looks like on top of the framework, and to
give the audits something real to police.

| Package | Purpose |
| --- | --- |
| `@mvp/trade-contracts` | channel ids, payload schemas, the publisher/subscriber ACL, order-flow reducers, and `orderConstraints` (tick/lot/leverage-ladder validation with decimal-safe arithmetic) |
| `@mvp/trade-data` | the C5 source-id registry (`sourceIds`, `parseSourceId`, `normalizeSymbol`), `createTradeDataClient`, deterministic mock transports |
| `@mvp/trade-prefs` | persisted user preferences |
| `@mvp/trade-theme` | trade-scoped theme variables on top of `@mvp/design-system` |
| `@mvp/trade-chart` | chart rendering primitives |

## Publishing

`packages/*` are `private: false` except `@mvp/assets` and `@mvp/workers`. `apps/*`, `fragments/*`
and `domains/*` are private. `tools/create-component` is the one publishable tool. Releases go
through Changesets (`pnpm changeset`, `pnpm version-packages`, `pnpm release`).
