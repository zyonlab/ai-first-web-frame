import { describe, expect, it } from "vitest";
import {
  addComposeService,
  hasComposeService,
  listComposeHostPorts,
  nextFragmentPort,
  renderComposeService,
} from "../src/compose";

const composeText = `services:
  shell-gateway:
    build:
      context: ../..
      dockerfile: apps/shell-gateway/Dockerfile
    ports:
      - "4100:4100"
    environment:
      PORT: "4100"

  promotion-banner:
    build:
      context: ../..
      dockerfile: fragments/promotion-banner/Dockerfile
    ports:
      - "4201:4201"
    environment:
      PORT: "4201"

  recommendation-widget:
    build:
      context: ../..
      dockerfile: fragments/recommendation-widget/Dockerfile
    ports:
      - "4202:4202"
    environment:
      PORT: "4202"
`;

describe("compose helpers", () => {
  it("lists host ports", () => {
    expect(listComposeHostPorts(composeText)).toEqual([4100, 4201, 4202]);
  });

  it("allocates the next free fragment port from 4201", () => {
    expect(nextFragmentPort(composeText)).toBe(4203);
    expect(nextFragmentPort("services: {}\n")).toBe(4201);
  });

  it("detects existing services", () => {
    expect(hasComposeService(composeText, "promotion-banner")).toBe(true);
    expect(hasComposeService(composeText, "price-panel")).toBe(false);
  });

  it("renders a fragment service block", () => {
    const block = renderComposeService("price-panel", 4203);
    expect(block).toContain("  price-panel:");
    expect(block).toContain("dockerfile: fragments/price-panel/Dockerfile");
    expect(block).toContain('- "4203:4203"');
    expect(block).toContain('PORT: "4203"');
  });

  it("appends a new service and is idempotent", () => {
    const first = addComposeService(composeText, {
      name: "price-panel",
      port: 4203,
    });
    expect(first.changed).toBe(true);
    expect(hasComposeService(first.text, "price-panel")).toBe(true);
    expect(listComposeHostPorts(first.text)).toContain(4203);

    const second = addComposeService(first.text, {
      name: "price-panel",
      port: 4203,
    });
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });
});
