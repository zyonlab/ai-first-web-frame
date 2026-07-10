// See react.ts's doc comment for why these are explicit named exports, not
// `export *` — the same CJS-interop limitation applies here. The order-form
// island's browser build (jsx: "react-jsx") emits
// `import { jsx, jsxs } from "react/jsx-runtime"`; `Fragment` is included too
// since it's a near-zero-cost, commonly-needed companion export even though
// `island.tsx` doesn't use `<>...</>` today.
export { Fragment, jsx, jsxs } from "react/jsx-runtime";
