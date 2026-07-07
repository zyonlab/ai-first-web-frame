/**
 * Liveness/readiness probe consumed by CI and Kubernetes. Static, dependency
 * free, and always cheap so probes never fan out into fragment calls.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ status: "ok", service: "page-referrals" });
}
