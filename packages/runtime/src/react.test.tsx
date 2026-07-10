import type { FragmentRenderResponse } from "@mvp/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FragmentSlotResult, FragmentSlotsExecution } from "./index";
import { FragmentSlot } from "./react";

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
