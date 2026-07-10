// Shared vendor chunk entry (C3 spike, docs/ARCHITECTURE_REFACTOR_PLAN.md
// §4.3.3): re-exports the exact `react` module this workspace already
// depends on, built once and served as a static asset so any dynamically
// `import()`-ed fragment island resolves the SAME react module instance as
// every other entry in this vendor chunk (React's single-instance
// invariant — two bundled copies of react would break hooks).
//
// REAL FINDING (only caught by loading this in an actual browser, not by
// curl or a unit test): `export * from "react"` does NOT reliably produce
// static named ESM exports here. `react` ships as CommonJS with a shape
// rolldown can't statically enumerate (it conditionally `require()`s a
// production/development build), so `export *` compiles to a runtime
// property-copy with no static `export {...}` declaration at all — nothing
// is actually importable by name from the built chunk, even though the
// build itself reports success with no error or warning. Named exports only
// become real, statically-declared ESM bindings when spelled out
// explicitly, so every name below is deliberately listed rather than
// wildcard-exported. Limited to what `island.browser.ts` actually imports
// (confirmed by inspecting its real build output) — a real rollout sharing
// this chunk across more islands would need to widen this list.
export { createElement, useEffect, useMemo, useState } from "react";

import React from "react";
export default React;
