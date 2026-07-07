import {
  type ComponentMetadata,
  loadDefaultBudget,
  type PerformanceBudget,
} from "@mvp/contracts";

/**
 * Metadata for the vendored shadcn island primitives.
 *
 * Unlike the server-safe factory (`../factory.ts`, `serverSafe: true`), these
 * are `"use client"` Radix/cmdk islands, so `serverSafe: false`. The category
 * is `island` so audits / manifests can distinguish them from SSR components.
 */
export function islandMetadata(
  name: string,
  description: string,
): ComponentMetadata {
  return {
    name,
    version: "0.1.0",
    owner: "platform",
    category: "island",
    serverSafe: false,
    propsSchema: {},
    description,
  };
}

export function islandBudget(name: string): PerformanceBudget {
  return loadDefaultBudget("component", name);
}

/** Metadata + budget for each vendored shadcn primitive (doc 04 §3.1). */
export const dialogMetadata = islandMetadata(
  "Dialog",
  "Radix dialog island (modals, confirmations)",
);
export const dialogBudget = islandBudget("Dialog");

export const tabsMetadata = islandMetadata(
  "Tabs",
  "Radix tabs island (panel / order-form switch)",
);
export const tabsBudget = islandBudget("Tabs");

export const tooltipMetadata = islandMetadata(
  "Tooltip",
  "Radix tooltip island (explainers, hovers)",
);
export const tooltipBudget = islandBudget("Tooltip");

export const sliderMetadata = islandMetadata(
  "Slider",
  "Radix slider island (leverage)",
);
export const sliderBudget = islandBudget("Slider");

export const toastMetadata = islandMetadata(
  "Toast",
  "Radix toast island (order notifications)",
);
export const toastBudget = islandBudget("Toast");

export const commandMetadata = islandMetadata(
  "Command",
  "cmdk command palette island (symbol switcher)",
);
export const commandBudget = islandBudget("Command");

export const dropdownMenuMetadata = islandMetadata(
  "DropdownMenu",
  "Radix dropdown-menu island (wallet / overflow menu)",
);
export const dropdownMenuBudget = islandBudget("DropdownMenu");

export const selectMetadata = islandMetadata(
  "Select",
  "Radix select island (grouping, interval, margin mode)",
);
export const selectBudget = islandBudget("Select");

export const dataTableMetadata = islandMetadata(
  "DataTable",
  "Lightweight token-styled table primitive",
);
export const dataTableBudget = islandBudget("DataTable");

export const themeToggleMetadata = islandMetadata(
  "ThemeToggle",
  "Token demo theme switch (callback props)",
);
export const themeToggleBudget = islandBudget("ThemeToggle");

export const localeSwitcherMetadata = islandMetadata(
  "LocaleSwitcher",
  "Token demo locale switch (callback props)",
);
export const localeSwitcherBudget = islandBudget("LocaleSwitcher");
