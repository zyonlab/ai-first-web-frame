import { loadDefaultBudget } from "@mvp/contracts";

export const manifest = { name: "test-fragment", version: "0.1.0", owner: "generated", renderMode: "ssr", fallback: "<section>TestFragment</section>", assets: { js: [], css: [] }, budget: loadDefaultBudget("fragment", "test-fragment") } as const;
