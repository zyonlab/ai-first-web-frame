import type { RequestContext } from "@mvp/contracts";
import type { StoragePartitionContext } from "../index";

/**
 * Builds a {@link StoragePartitionContext} from a full {@link RequestContext}.
 *
 * `user-private` storage requires a `user` partition value, but anonymous
 * visitors have no `ctx.user`. Following the pattern proven in
 * `apps/page-product/src/recentlyViewed.ts`, we fall back to a stable anonymous
 * visitor id derived from the session (preferred) or tenant so the partition is
 * still deterministic and isolated per visitor.
 */
export function prefsPartitionContext(
  ctx: RequestContext,
): StoragePartitionContext {
  const user = ctx.user ?? { id: `anon:${ctx.session?.id ?? ctx.tenant}` };
  return {
    tenant: ctx.tenant,
    locale: ctx.locale,
    theme: ctx.theme,
    device: ctx.device,
    user,
  };
}
