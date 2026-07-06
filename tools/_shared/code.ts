export function parseImports(source: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
    /export\s+(?:type\s+)?[^'"]+\s+from\s+["']([^"']+)["']/g,
    /import\(["']([^"']+)["']\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.add(match[1]);
    }
  }
  return [...imports].sort();
}

export function hasUseClient(source: string): boolean {
  const firstStatements = source.trimStart().slice(0, 80);
  return /^["']use client["'];?/.test(firstStatements);
}

export function browserGlobals(source: string): string[] {
  const globals = ["window", "document", "localStorage"];
  return globals.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
}

export function jsxShape(source: string): string[] {
  const tags = [
    ...source.matchAll(/<([A-Z][A-Za-z0-9]*|[a-z][a-z0-9-]*)\b/g),
  ].map((match) => match[1]);
  return tags.filter((tag) => !tag.startsWith("/"));
}

export function classNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /className\s*=\s*(?:"([^"]+)"|'([^']+)'|{`([^`]+)`})/g,
  )) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    for (const name of value.split(/\s+/).filter(Boolean)) {
      names.add(name.replace(/\$\{[^}]+\}/g, ""));
    }
  }
  return [...names].filter(Boolean).sort();
}
