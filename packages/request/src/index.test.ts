import { createRequestContext } from "@mvp/request-context";
import { describe, expect, it, vi } from "vitest";
import {
  createRequestClient,
  RequestPolicyError,
  RequestTimeoutError,
} from "./index";

const ctx = createRequestContext({
  headers: {
    "x-trace-id": "trace-request",
    "x-request-id": "req-request",
    "x-tenant": "tenant-a",
    "x-locale": "en-US",
  },
});

const policy = {
  endpoints: [
    {
      id: "catalog",
      baseUrl: "https://api.example.test/catalog",
      allowedMethods: ["GET", "POST"] as Array<"GET" | "POST">,
      timeoutMs: 50,
      retries: 1,
      privacy: "public" as const,
    },
  ],
  defaultTimeoutMs: 100,
  maxRetries: 2,
};

describe("@mvp/request", () => {
  it("allows configured endpoint requests and propagates context headers", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      expect((init?.headers as Record<string, string>)["x-trace-id"]).toBe(
        "trace-request",
      );
      expect((init?.headers as Record<string, string>)["x-tenant"]).toBe(
        "tenant-a",
      );
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    const client = createRequestClient({ ctx, policy, fetchImpl });
    const result = await client.requestJson<{ ok: boolean }>("catalog", {
      path: "/featured",
    });
    expect(result.data.ok).toBe(true);
    expect(result.url).toBe("https://api.example.test/catalog/featured");
  });

  it("rejects endpoints and methods outside policy", async () => {
    const client = createRequestClient({ ctx, policy, fetchImpl: fetch });
    await expect(client.requestJson("unknown")).rejects.toThrow(
      RequestPolicyError,
    );
    await expect(
      client.requestJson("catalog", { method: "DELETE" }),
    ).rejects.toThrow(RequestPolicyError);
  });

  it("retries transient failures within policy", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        Response.json({ ok: true }),
      ) as unknown as typeof fetch;
    const client = createRequestClient({ ctx, policy, fetchImpl });
    const result = await client.requestJson<{ ok: boolean }>("catalog");
    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("times out slow requests", async () => {
    const fetchImpl = vi.fn(
      () => new Promise<Response>((resolve) => setTimeout(resolve, 30)),
    ) as unknown as typeof fetch;
    const client = createRequestClient({ ctx, policy, fetchImpl });
    await expect(
      client.requestJson("catalog", { timeoutMs: 1, retries: 0 }),
    ).rejects.toThrow(RequestTimeoutError);
  });
});
