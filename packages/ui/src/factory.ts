import {
  type ComponentMetadata,
  loadDefaultBudget,
  type PerformanceBudget,
} from "@mvp/contracts";

export function metadata(
  name: string,
  description: string,
  category = "ui",
): ComponentMetadata {
  return {
    name,
    version: "0.1.0",
    owner: "platform",
    category,
    serverSafe: true,
    propsSchema: {},
    description,
  };
}

export function componentBudget(name: string): PerformanceBudget {
  return loadDefaultBudget("component", name);
}
