/**
 * Trade-demo interaction contracts (demo-specific, isolated from the generic
 * `@mvp/interaction` core). Freezes contract C3: store slice channels +
 * payloads + publisher/subscribers, plus the place-order / cancel-order
 * mutation contracts and the three canonical-flow reducers.
 */

export * from "./flows";
export * from "./mutations";
export * from "./slices";
