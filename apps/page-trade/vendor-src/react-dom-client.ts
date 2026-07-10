// See react.ts's doc comment for why these are explicit named exports, not
// `export *` — the same CJS-interop limitation applies here.
// `react-dom/client` internally imports `react` as a bare specifier;
// rolldown's multi-entry build (see tsdown.vendor.config.ts) splits that
// shared code into a common chunk both this file and react.ts import via a
// relative path, so react-dom's internals resolve the SAME React module
// object as everything else in this vendor chunk — not a second copy. Only
// `createRoot` is listed: it's the only export `island.browser.ts` (the
// fragment's mount wrapper) actually imports.
export { createRoot } from "react-dom/client";
