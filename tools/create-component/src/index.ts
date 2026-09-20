#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type CliOptions, parseArgs } from "../../_shared/args";
import { ensureDir, findWorkspaceRoot, writeText } from "../../_shared/fs";
import {
  type FragmentTemplateInput,
  fragmentBudget,
  fragmentDockerfile,
  fragmentFixtures,
  fragmentManifest,
  fragmentPackageJson,
  fragmentReadme,
  fragmentRender,
  fragmentRenderTest,
  fragmentServer,
  fragmentServerTest,
  fragmentTsconfig,
} from "./fragmentTemplate";

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

/**
 * Lowest fragment service port. `register-fragment --with-compose` allocates
 * from the same base, so a scaffold and its compose service agree by default.
 */
const FIRST_FRAGMENT_PORT = 4201;

/**
 * Next free fragment port: scans every existing `fragments/*\/src/server.ts`
 * for its `DEFAULT_PORT` and returns the first unused value from
 * {@link FIRST_FRAGMENT_PORT}. A scaffolded fragment is runnable immediately,
 * without the author having to discover which ports are taken.
 */
export function nextFragmentPort(root: string): number {
  const dir = join(root, "fragments");
  const used = new Set<number>();
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const server = join(dir, name, "src", "server.ts");
      if (!existsSync(server)) continue;
      const match = /DEFAULT_PORT\s*=\s*(\d{4,5})/.exec(
        readFileSync(server, "utf8"),
      );
      if (match) used.add(Number(match[1]));
    }
  }
  let port = FIRST_FRAGMENT_PORT;
  while (used.has(port)) port += 1;
  return port;
}

function createFragment(
  root: string,
  name: string,
  force: boolean,
): CreateComponentResult {
  const kebab = toKebab(name);
  const dir = join(root, "fragments", kebab);
  const input: FragmentTemplateInput = {
    name,
    kebab,
    camel: camel(name),
    port: nextFragmentPort(root),
  };
  // Every file a fragment needs to run, build, be typechecked and be tested —
  // the generated unit answers /render and produces an image as scaffolded.
  const generated: Array<[string, string]> = [
    [join(dir, "src", "server.ts"), fragmentServer(input)],
    [join(dir, "src", "render.ts"), fragmentRender(input)],
    [join(dir, "src", "manifest.ts"), fragmentManifest(input)],
    [join(dir, "src", "budget.ts"), fragmentBudget(input)],
    [join(dir, "src", "fixtures.ts"), fragmentFixtures(input)],
    [join(dir, "src", "render.test.ts"), fragmentRenderTest(input)],
    [join(dir, "tests", "server.test.ts"), fragmentServerTest(input)],
    [join(dir, "package.json"), fragmentPackageJson(input)],
    [join(dir, "tsconfig.json"), fragmentTsconfig()],
    [join(dir, "Dockerfile"), fragmentDockerfile(input)],
    [join(dir, "README.md"), fragmentReadme(input)],
  ];
  const files = generated.map(([file]) => file);
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
  ensureDir(join(dir, "tests"));
  for (const [file, content] of generated) writeText(file, content);
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
