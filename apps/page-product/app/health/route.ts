import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe for K8s and CI. */
export function GET() {
  return NextResponse.json({ status: "ok", service: "page-product" });
}
