import type { FragmentRenderResponse } from "@mvp/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FragmentSlotResult, FragmentSlotsExecution } from "./index";
import { FragmentSlot, reserveFallbacks, reserveSlotHeight } from "./react";

const liveResponse: FragmentRenderResponse = {
  html: '<section data-fragment="promotion-banner">live copy</section>',
  assets: { js: [], css: [] },
  cache: { ttl: 60, tags: ["promotion-banner"] },
  metadata: { name: "promotion-banner", version: "0.1.0" },
};

function slotResult(response: FragmentRenderResponse): FragmentSlotResult {
  return {
    slot: { name: "promotion", fragment: "promotion-banner" },
    strategy: "cached-ssr",
    source: "network",
    status: "ok",
    response,
  };
}

describe("FragmentSlot", () => {
  it("renders slot html looked up by name from a FragmentSlotsExecution result", () => {
    const execution: FragmentSlotsExecution = {
      slots: { promotion: slotResult(liveResponse) },
      data: {},
      health: "ok",
      hints: [],
    };
    render(
      <FragmentSlot
        name="promotion"
        execution={execution}
        fallback={<p>fallback</p>}
      />,
    );
    expect(screen.getByText("live copy")).toBeTruthy();
    expect(
      document.querySelector('[data-fragment="promotion-banner"]'),
    ).toBeTruthy();
  });

  it("renders slot html looked up by name from a bare slots record", () => {
    render(
      <FragmentSlot
        name="promotion"
        execution={{ promotion: slotResult(liveResponse) }}
        fallback={<p>fallback</p>}
      />,
    );
    expect(screen.getByText("live copy")).toBeTruthy();
  });

  it("renders the fallback when the named slot is absent", () => {
    const execution: FragmentSlotsExecution = {
      slots: {},
      data: {},
      health: "ok",
      hints: [],
    };
    render(
      <FragmentSlot
        name="missing"
        execution={execution}
        fallback={<p data-testid="fallback">loading</p>}
      />,
    );
    expect(screen.getByTestId("fallback")).toBeTruthy();
  });

  it("renders a single already-resolved response directly", () => {
    render(<FragmentSlot response={liveResponse} fallback={<p>fallback</p>} />);
    expect(screen.getByText("live copy")).toBeTruthy();
  });

  it("renders the fallback for a null response", () => {
    render(
      <FragmentSlot response={null} fallback={<p data-testid="fb">x</p>} />,
    );
    expect(screen.getByTestId("fb")).toBeTruthy();
  });

  it("renders the fallback for an undefined response", () => {
    render(
      <FragmentSlot
        response={undefined}
        fallback={<p data-testid="fb2">x</p>}
      />,
    );
    expect(screen.getByTestId("fb2")).toBeTruthy();
  });

  it("renders the fallback when html is an empty string", () => {
    render(
      <FragmentSlot
        response={{ ...liveResponse, html: "" }}
        fallback={<p data-testid="fb3">x</p>}
      />,
    );
    expect(screen.getByTestId("fb3")).toBeTruthy();
  });
});

describe("slot height reservation", () => {
  const FALLBACK = (
    <section data-fragment="recommendation-widget" data-fallback="true">
      Recommendations are loading.
    </section>
  );

  it("holds the declared height on the fallback element itself", () => {
    render(reserveSlotHeight(FALLBACK, 262));
    const element = document.querySelector(
      '[data-fragment="recommendation-widget"]',
    ) as HTMLElement;
    expect(element.style.minHeight).toBe("262px");
  });

  it("returns the element untouched when the slot declares no height", () => {
    const untouched = reserveSlotHeight(FALLBACK, undefined);
    expect(untouched).toBe(FALLBACK);
    render(untouched);
    const element = document.querySelector(
      '[data-fragment="recommendation-widget"]',
    ) as HTMLElement;
    expect(element.style.minHeight).toBe("");
  });

  it("does not add a wrapper node, which layout-fit would read as a void", () => {
    const { container } = render(reserveSlotHeight(FALLBACK, 262));
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe("SECTION");
  });

  it("keeps a style the caller already set and lets it win", () => {
    const styled = (
      <section data-fragment="x" data-fallback="true" style={{ minHeight: 10 }}>
        x
      </section>
    );
    render(reserveSlotHeight(styled, 262));
    const element = document.querySelector(
      '[data-fragment="x"]',
    ) as HTMLElement;
    expect(element.style.minHeight).toBe("10px");
  });

  it("maps each fallback to its own slot's declared height", () => {
    const reserved = reserveFallbacks(
      [
        { name: "promotion", reserveHeightPx: 52 },
        { name: "recommendations", reserveHeightPx: 262 },
        { name: "unreserved" },
      ],
      {
        promotion: <section data-name="promotion">p</section>,
        recommendations: <section data-name="recommendations">r</section>,
        unreserved: <section data-name="unreserved">u</section>,
      },
    );
    render(
      <>
        {reserved.promotion}
        {reserved.recommendations}
        {reserved.unreserved}
      </>,
    );
    const heightOf = (name: string) =>
      (document.querySelector(`[data-name="${name}"]`) as HTMLElement).style
        .minHeight;
    expect(heightOf("promotion")).toBe("52px");
    expect(heightOf("recommendations")).toBe("262px");
    expect(heightOf("unreserved")).toBe("");
  });
});
