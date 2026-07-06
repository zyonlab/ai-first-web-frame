import { createRequestContext } from "@mvp/request-context";
import { type NextRequest, NextResponse } from "next/server";
import { trackRecentlyViewed } from "./src/recentlyViewed";

// Next.js App Router forbids mutating cookies during a Server Component render,
// so the signed recently-viewed cookie is written here in middleware instead.
// The page only reads the cookie for display. Middleware runs on the Node.js
// runtime (enabled in next.config) because @mvp/storage signs cookies with
// node:crypto, which is unavailable in the Edge runtime.
export const config = {
  matcher: "/product/:id*",
  runtime: "nodejs",
};

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next();
  const productId = request.nextUrl.pathname.split("/").filter(Boolean).at(1);
  if (!productId) {
    return response;
  }

  try {
    const ctx = createRequestContext({ headers: request.headers });
    const { setCookies } = await trackRecentlyViewed({
      ctx,
      productId,
      cookieHeader: request.headers.get("cookie") ?? "",
    });
    // Emit the adapter's already-encoded Set-Cookie headers verbatim. Re-setting
    // through NextResponse.cookies.set() would re-encode the partitioned storage
    // key used as the cookie name and corrupt it, so the strict browser/request
    // parser would then drop the cookie and recently-viewed would never persist.
    for (const setCookie of setCookies) {
      response.headers.append("set-cookie", setCookie);
    }
  } catch {
    // Recently-viewed tracking is best-effort; never block the product page.
  }
  return response;
}
