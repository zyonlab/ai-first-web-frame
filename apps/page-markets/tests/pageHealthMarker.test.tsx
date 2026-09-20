import {
  PAGE_HEALTH_ATTR,
  PAGE_HEALTH_FAILED_ATTR,
  readPageHealthFromHtml,
} from "@mvp/runtime";
import { PageHealthMeta, PageHealthMetaStream } from "@mvp/runtime/react";
import { Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/**
 * End-to-end for the health channel: the component must emit markup that the
 * gateway's own reader recognises. Both sides were previously tested in
 * isolation (pure reader against a hand-written string, component not at all),
 * which left the actual contract — "what the page renders is what the gateway
 * parses" — unverified.
 */
function execution(health: "ok" | "degraded" | "unhealthy", failed: string[]) {
  return {
    slots: Object.fromEntries(
      [
        ...failed.map((name) => [name, true, "fallback"] as const),
        ["healthy", true, "ok"] as const,
      ].map(([name, required, status]) => [
        name,
        {
          slot: { name, fragment: `${name}-fragment`, required },
          strategy: "dynamic-ssr" as const,
          source:
            status === "ok" ? ("network" as const) : ("fallback" as const),
          status,
          response: {
            html: "",
            assets: { js: [], css: [] },
            cache: { ttl: 5, tags: [] },
            metadata: { name, version: "0.1.0" },
          },
        },
      ]),
    ),
    data: {},
    health,
    hints: [],
  };
}

describe("page health marker round-trip", () => {
  it("renders markup the gateway's reader parses back", () => {
    const html = renderToStaticMarkup(
      <main data-page="markets">
        <PageHealthMeta execution={execution("unhealthy", ["marketsTable"])} />
      </main>,
    );
    // Valid where it renders: a hidden element in the body, not a <meta>.
    expect(html).toContain(`${PAGE_HEALTH_ATTR}="unhealthy"`);
    expect(html).toContain(`${PAGE_HEALTH_FAILED_ATTR}="marketsTable"`);
    expect(html).toContain("hidden");
    expect(html).not.toContain("<meta");

    expect(readPageHealthFromHtml(html)).toEqual({
      health: "unhealthy",
      failedSlots: ["marketsTable"],
    });
  });

  it("round-trips the streaming variant too", async () => {
    const element = await PageHealthMetaStream({
      execution: Promise.resolve(execution("degraded", [])),
    });
    const html = renderToStaticMarkup(
      <main>
        <Suspense fallback={null}>{element}</Suspense>
      </main>,
    );
    expect(readPageHealthFromHtml(html)).toEqual({
      health: "degraded",
      failedSlots: [],
    });
  });

  it("emits nothing visible (no text, no layout)", () => {
    const html = renderToStaticMarkup(
      <PageHealthMeta execution={execution("ok", [])} />,
    );
    // A self-closing hidden div with only data attributes: no text content.
    expect(html.replace(/<[^>]*>/g, "")).toBe("");
  });
});
