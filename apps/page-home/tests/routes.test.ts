import { describe, expect, it } from "vitest";
import { GET as healthGet } from "../app/health/route";

/**
 * The RUM ingestion tests that used to live here moved with the endpoint:
 * `POST /_shell/rum` is now served by the gateway, so every page reports to one
 * place and the samples aggregate. See `apps/shell-gateway/tests/server.test.ts`.
 */
describe("page-home route handlers", () => {
  it("/health returns an ok status envelope", async () => {
    const response = await healthGet();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "page-home",
    });
  });
});
