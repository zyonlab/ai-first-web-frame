import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type CliOptions, parseArgs } from "../../_shared/args";
import { ensureDir, findWorkspaceRoot, writeText } from "../../_shared/fs";

export type CreateComponentResult = {
  status: "created" | "failed";
  type: "ui" | "fragment";
  name: string;
  files: string[];
  error?: string;
};

export function runCreateComponent(
  options: CliOptions = parseArgs(process.argv.slice(2)),
): CreateComponentResult {
  const root = options.root ?? findWorkspaceRoot();
  const name = options.positional[0];
  const type = options.type === "fragment" ? "fragment" : "ui";

  if (!name || !/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    return {
      status: "failed",
      type,
      name: name ?? "",
      files: [],
      error: "Component name must be PascalCase",
    };
  }

  return type === "fragment"
    ? createFragment(root, name, options.force)
    : createUiComponent(root, name, options.force);
}

function createUiComponent(
  root: string,
  name: string,
  force: boolean,
): CreateComponentResult {
  const dir = join(root, "packages", "ui", "src", name);
  const files = [
    join(dir, `${name}.tsx`),
    join(dir, "metadata.ts"),
    join(dir, "budget.ts"),
    join(dir, "fixtures.ts"),
    join(dir, `${name}.test.tsx`),
    join(dir, `${name}.module.css`),
    join(dir, "README.md"),
    join(dir, "index.ts"),
  ];
  const collision = files.find((file) => existsSync(file));
  if (collision && !force)
    return {
      status: "failed",
      type: "ui",
      name,
      files: [],
      error: `${collision} already exists`,
    };
  ensureDir(dir);
  writeText(
    files[0],
    `export type ${name}Props = { label: string };\n\nexport function ${name}({ label }: ${name}Props) {\n  return <span>{label}</span>;\n}\n`,
  );
  writeText(
    files[1],
    `import { metadata } from "../factory";\n\nexport const ${camel(name)}Metadata = metadata("${name}", "${name} UI component");\n`,
  );
  writeText(
    files[2],
    `import { componentBudget } from "../factory";\n\nexport const ${camel(name)}Budget = componentBudget("${name}");\n`,
  );
  writeText(
    files[3],
    `export const ${camel(name)}Fixtures = { basic: { label: "${name}" } };\n`,
  );
  writeText(
    files[4],
    `import { render, screen } from "@testing-library/react";\nimport { describe, expect, it } from "vitest";\nimport { ${name} } from "./${name}";\n\ndescribe("${name}", () => {\n  it("renders label", () => {\n    render(<${name} label="${name}" />);\n    expect(screen.getByText("${name}")).toBeTruthy();\n  });\n});\n`,
  );
  writeText(files[5], `.root {\n  display: inline-flex;\n}\n`);
  writeText(
    files[6],
    `# ${name}\n\nGenerated server-safe UI component skeleton.\n`,
  );
  writeText(
    files[7],
    `export { ${name}, type ${name}Props } from "./${name}";\nexport { ${camel(name)}Metadata } from "./metadata";\nexport { ${camel(name)}Budget } from "./budget";\nexport { ${camel(name)}Fixtures } from "./fixtures";\n`,
  );
  return { status: "created", type: "ui", name, files };
}

function createFragment(
  root: string,
  name: string,
  force: boolean,
): CreateComponentResult {
  const kebab = toKebab(name);
  const dir = join(root, "fragments", kebab);
  const files = [
    join(dir, "src", "server.ts"),
    join(dir, "src", "render.tsx"),
    join(dir, "src", "manifest.ts"),
    join(dir, "src", "budget.ts"),
    join(dir, "src", "fixtures.ts"),
    join(dir, "src", "render.test.tsx"),
    join(dir, "package.json"),
    join(dir, "Dockerfile"),
    join(dir, "README.md"),
  ];
  const collision = files.find((file) => existsSync(file));
  if (collision && !force)
    return {
      status: "failed",
      type: "fragment",
      name,
      files: [],
      error: `${collision} already exists`,
    };
  ensureDir(join(dir, "src"));
  writeText(
    files[0],
    `import { render${name} } from "./render";\n\nexport { render${name} };\n`,
  );
  writeText(
    files[1],
    `export function render${name}() {\n  return { html: "<section data-fragment=\\"${kebab}\\">${name}</section>", assets: { js: [], css: [] }, cache: { ttl: 60, tags: ["${kebab}"] }, metadata: { name: "${kebab}", version: "0.1.0" } };\n}\n`,
  );
  writeText(
    files[2],
    `import { loadDefaultBudget } from "@mvp/contracts";\n\nexport const manifest = {\n  name: "${kebab}",\n  version: "0.1.0",\n  owner: "generated",\n  renderMode: "ssr",\n  fallback: "<section>${name}</section>",\n  assets: { js: [], css: [] },\n  // Adjust shape/minHeight/fills to this fragment's real rendered geometry\n  // (shape: "bar" | "ladder" | "table" | "chart" | "panel"; see LayoutHint in tools/release-tools/src/unit-graph.ts).\n  layoutHint: { shape: "panel", minHeight: 120, fills: false },\n  budget: loadDefaultBudget("fragment", "${kebab}"),\n} as const;\n`,
  );
  writeText(
    files[3],
    `import { loadDefaultBudget } from "@mvp/contracts";\n\nexport const budget = loadDefaultBudget("fragment", "${kebab}");\n`,
  );
  writeText(
    files[4],
    `export const fixtures = { basic: { ctx: {}, props: {} } };\n`,
  );
  writeText(
    files[5],
    `import { describe, expect, it } from "vitest";\nimport { render${name} } from "./render";\n\ndescribe("${kebab}", () => {\n  it("renders HTML", () => {\n    expect(render${name}().html).toContain("${kebab}");\n  });\n});\n`,
  );
  writeText(
    files[6],
    `{"name":"@mvp/fragment-${kebab}","version":"0.1.0","type":"module","private":true,"scripts":{"test":"vitest run src","build":"tsdown src/server.ts --format esm --platform node --dts","start":"node dist/server.js"},"dependencies":{"@mvp/contracts":"workspace:*","fastify":"^4.28.1"},"devDependencies":{"tsdown":"^0.11.0"}}\n`,
  );
  writeText(
    files[7],
    `FROM node:22-alpine\nWORKDIR /app\nCMD ["node", "dist/server.js"]\n`,
  );
  writeText(files[8], `# ${name}\n\nGenerated SSR fragment skeleton.\n`);
  return { status: "created", type: "fragment", name, files };
}

function camel(name: string) {
  return `${name[0].toLowerCase()}${name.slice(1)}`;
}

function toKebab(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = runCreateComponent();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "created" ? 0 : 1;
}
