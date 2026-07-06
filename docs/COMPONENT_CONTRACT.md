# Component Contract

Contracts live in `packages/contracts` and are implemented with Zod.

The shared contract set includes `RequestContext`, `ComponentMetadata`, `ComponentManifest`, `FragmentManifest`, `PageManifest`, `RouteManifest`, `FragmentRegistry`, `PerformanceBudget`, `FragmentRenderRequest`, `FragmentRenderResponse`, and `ReleaseChannel`.

All manifests must be schema-validated in tests. Page and fragment services must treat invalid manifests as release blockers.
