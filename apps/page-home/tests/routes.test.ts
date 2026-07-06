import { describe, expect, it } from "vitest";
import { GET as rumGet, POST as rumPost } from "../app/api/rum/route";
import { GET as healthGet } from "../app/health/route";

describe("page-home route handlers", () => {
  it("/health returns an ok status envelope", async () => {
    const response = await healthGet();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "page-home",
    });
  });

  it("/api/rum records a valid web vital and exposes it as metrics", async () => {
    const post = await rumPost(
      new Request("http://localhost/api/rum", {
        method: "POST",
        body: JSON.stringify({ name: "LCP", value: 1800, route: "/" }),
      }),
    );
    expect(post.status).toBe(200);
    await expect(post.json()).resolves.toMatchObject({ status: "recorded" });

    const metrics = await rumGet();
    const text = await metrics.text();
    expect(text).toContain("web_vitals_lcp");
    expect(text).toContain('route="/"');
  });

  it("/api/rum rejects an unknown metric name", async () => {
    const response = await rumPost(
      new Request("http://localhost/api/rum", {
        method: "POST",
        body: JSON.stringify({ name: "BOGUS", value: 1 }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("/api/rum rejects invalid JSON", async () => {
    const response = await rumPost(
      new Request("http://localhost/api/rum", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(response.status).toBe(400);
  });
});
