"use client";

/**
 * Barrel for the vendored shadcn/ui island primitives (doc 04 §4.1).
 *
 * Every module re-exported here begins with `"use client"` — these are Radix /
 * cmdk client islands, never SSR-imported. They are restyled to
 * `@mvp/design-system` tokens via the Tailwind preset (`var(--mvp-*)`), with no
 * hard-coded colors. `cn` is the shared class-merge convention.
 *
 * The server-safe components (Button/Card/Image/ProductCardBase/Section/
 * Skeleton) live in `../index.ts` and are intentionally NOT re-exported here so
 * this client entry stays island-only.
 */

export { cn } from "./cn";
export * from "./command";
export * from "./data-table";
export * from "./dialog";
export * from "./dropdown-menu";
export * from "./locale-switcher";
export * from "./select";
export * from "./shadcnMetadata";
export * from "./slider";
export * from "./tabs";
export * from "./theme-toggle";
export * from "./toast";
export * from "./tooltip";
