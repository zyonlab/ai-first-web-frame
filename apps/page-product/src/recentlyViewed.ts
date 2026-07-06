import type { RequestContext, StoragePolicy } from "@mvp/contracts";
import {
  createCookieStorageAdapter,
  createStorage,
  type StoragePartitionContext,
} from "@mvp/storage";
import { getProduct } from "./catalog";

/**
 * Secret used to HMAC-sign the recently-viewed cookie. Read from the
 * environment so deployments can rotate it; the demo ships a default so the
 * page renders locally without extra setup.
 */
export const RECENTLY_VIEWED_SECRET =
  process.env.RECENTLY_VIEWED_COOKIE_SECRET ??
  "page-product-recently-viewed-demo-secret";

export const RECENTLY_VIEWED_COOKIE = "pp_recent";
const RECENTLY_VIEWED_KEY = "ids";
const MAX_RECENTLY_VIEWED = 5;

/**
 * "Recently viewed products" is per-visitor data, so it is modelled as
 * `user-private` storage partitioned by tenant + user. Configuring it with a
 * `public` policy would throw in {@link createStorage}, which is exactly the
 * privacy guarantee we want to demonstrate.
 */
export const recentlyViewedPolicy: StoragePolicy = {
  id: "recently-viewed",
  adapter: "cookie",
  privacy: "user-private",
  ttl: 60 * 60 * 24 * 30,
  partitionBy: ["tenant", "user"],
  encrypted: false,
  ssr: true,
};

export type RecentlyViewedEntry = {
  id: string;
  title: string;
  price: string;
};

export type CookieWrite = {
  name: string;
  value: string;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict" | "lax" | "none";
  path: string;
};

export type RecentlyViewedResult = {
  entries: RecentlyViewedEntry[];
  /** `Set-Cookie` headers to write back onto the response. */
  setCookies: string[];
  /** Structured cookie writes for Next.js `cookies().set(...)`. */
  cookieWrites: CookieWrite[];
  /** Whether a signed cookie was present and verified on the way in. */
  verified: boolean;
};

/** Parses an emitted `Set-Cookie` header into a structured cookie write. */
function parseSetCookie(header: string): CookieWrite {
  const [nameValue, ...attributeParts] = header.split(";");
  const eq = nameValue.indexOf("=");
  const name = decodeURIComponent(nameValue.slice(0, eq).trim());
  const value = decodeURIComponent(nameValue.slice(eq + 1).trim());
  const write: CookieWrite = {
    name,
    value,
    httpOnly: false,
    secure: false,
    sameSite: "lax",
    path: "/",
  };
  for (const raw of attributeParts) {
    const attribute = raw.trim();
    const lower = attribute.toLowerCase();
    if (lower === "httponly") write.httpOnly = true;
    else if (lower === "secure") write.secure = true;
    else if (lower.startsWith("max-age="))
      write.maxAge = Number(attribute.slice("max-age=".length));
    else if (lower.startsWith("path="))
      write.path = attribute.slice("path=".length);
    else if (lower.startsWith("samesite="))
      write.sameSite = attribute
        .slice("samesite=".length)
        .toLowerCase() as CookieWrite["sameSite"];
  }
  return write;
}

export type TrackRecentlyViewedOptions = {
  ctx: RequestContext;
  productId: string;
  /** Raw incoming `Cookie` header (e.g. from Next.js `headers()`). */
  cookieHeader?: string;
};

/**
 * Partition context for the recently-viewed storage. Anonymous visitors have
 * no `ctx.user`, but `user-private` storage requires a user partition value, so
 * we fall back to a stable anonymous visitor id derived from the session or
 * tenant.
 */
function partitionContextFor(ctx: RequestContext): StoragePartitionContext {
  const user = ctx.user ?? { id: `anon:${ctx.session?.id ?? ctx.tenant}` };
  return {
    tenant: ctx.tenant,
    locale: ctx.locale,
    theme: ctx.theme,
    device: ctx.device,
    user,
  };
}

/**
 * Reads the signed recently-viewed cookie, appends the current product id
 * (most-recent-first, de-duplicated, capped), writes it back, and returns the
 * resolved product summaries plus the `Set-Cookie` headers to emit.
 *
 * The value is HMAC-signed and partitioned by tenant + user; a tampered cookie
 * fails verification and reads as absent.
 */
export async function trackRecentlyViewed({
  ctx,
  productId,
  cookieHeader = "",
}: TrackRecentlyViewedOptions): Promise<RecentlyViewedResult> {
  const adapter = createCookieStorageAdapter({
    cookieHeader,
    secret: RECENTLY_VIEWED_SECRET,
    attributes: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
  });
  const storage = createStorage(recentlyViewedPolicy, {
    ctx: partitionContextFor(ctx),
    adapter,
  });

  const stored = (await storage.getItem<string[]>(RECENTLY_VIEWED_KEY)) ?? [];
  const verified = cookieHeader.trim().length > 0 && stored.length > 0;
  const next = [productId, ...stored.filter((id) => id !== productId)].slice(
    0,
    MAX_RECENTLY_VIEWED,
  );
  await storage.setItem(RECENTLY_VIEWED_KEY, next);

  const setCookies = adapter.toSetCookieHeaders();
  return {
    entries: next.map((id) => {
      const product = getProduct(id);
      return { id: product.id, title: product.title, price: product.price };
    }),
    setCookies,
    cookieWrites: setCookies.map(parseSetCookie),
    verified,
  };
}
