import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TestComponent } from "./TestComponent";

describe("TestComponent", () => {
  it("renders label", () => {
    render(<TestComponent label="TestComponent" />);
    expect(screen.getByText("TestComponent")).toBeTruthy();
  });
});
