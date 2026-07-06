# AI Component Guide

AI-generated UI components must include component source, metadata, budget, fixtures, tests, CSS Module styles, and a README.

AI-generated fragments must include server, render function, manifest, budget, fixtures, render tests, Dockerfile, and README.

Before adding a component, run the similarity check. Prefer extending an existing component when name, props, JSX shape, or CSS is highly similar.

Required review checklist:

- Server-safe by default.
- No default `"use client"`.
- No `window`, `document`, or `localStorage` in server-safe files.
- Metadata validates with `ComponentMetadataSchema`.
- Budget validates with `PerformanceBudgetSchema`.
- Tests assert meaningful behavior.
