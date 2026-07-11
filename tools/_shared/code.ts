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

/**
 * Replaces comment bodies and string-literal contents with spaces (newlines
 * and quote/backtick delimiters preserved) so word-boundary heuristics like
 * `browserGlobals` match only real code — the English word "window" in a doc
 * comment or a log message is not a browser-global usage. Template-literal
 * interpolations (`${...}`) are kept intact: they are code. Import specifiers
 * are string literals and get blanked too, so never feed the result to
 * `parseImports`. Regex literals are not modeled; a `//` sequence inside one
 * blanks the rest of that line (a conservative miss, never a false flag).
 */
export function stripCommentsAndStrings(source: string): string {
  type Frame = {
    state: "code" | "line" | "block" | "single" | "double" | "template";
    braceDepth: number;
  };
  const stack: Frame[] = [{ state: "code", braceDepth: 0 }];
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    const top = stack[stack.length - 1];
    if (top.state === "code") {
      if (ch === "/" && next === "/") {
        stack.push({ state: "line", braceDepth: 0 });
        out += "  ";
        i++;
      } else if (ch === "/" && next === "*") {
        stack.push({ state: "block", braceDepth: 0 });
        out += "  ";
        i++;
      } else if (ch === "'") {
        stack.push({ state: "single", braceDepth: 0 });
        out += ch;
      } else if (ch === '"') {
        stack.push({ state: "double", braceDepth: 0 });
        out += ch;
      } else if (ch === "`") {
        stack.push({ state: "template", braceDepth: 0 });
        out += ch;
      } else if (ch === "{") {
        top.braceDepth++;
        out += ch;
      } else if (ch === "}") {
        // A `}` at depth 0 inside a code frame opened by `${` closes the
        // interpolation and returns to the enclosing template literal.
        if (
          top.braceDepth === 0 &&
          stack.length > 1 &&
          stack[stack.length - 2].state === "template"
        ) {
          stack.pop();
        } else if (top.braceDepth > 0) {
          top.braceDepth--;
        }
        out += ch;
      } else {
        out += ch;
      }
      continue;
    }
    if (top.state === "line") {
      if (ch === "\n") {
        stack.pop();
        out += "\n";
      } else {
        out += " ";
      }
      continue;
    }
    if (top.state === "block") {
      if (ch === "*" && next === "/") {
        stack.pop();
        out += "  ";
        i++;
      } else {
        out += ch === "\n" ? "\n" : " ";
      }
      continue;
    }
    // String states: single | double | template.
    if (ch === "\\") {
      out += "  ";
      i++;
      continue;
    }
    if (
      (top.state === "single" && ch === "'") ||
      (top.state === "double" && ch === '"') ||
      (top.state === "template" && ch === "`")
    ) {
      stack.pop();
      out += ch;
      continue;
    }
    if (top.state === "template" && ch === "$" && next === "{") {
      stack.push({ state: "code", braceDepth: 0 });
      out += "${";
      i++;
      continue;
    }
    out += ch === "\n" ? "\n" : " ";
  }
  return out;
}

export function browserGlobals(source: string): string[] {
  const globals = ["window", "document", "localStorage"];
  const code = stripCommentsAndStrings(source);
  return globals.filter((name) => new RegExp(`\\b${name}\\b`).test(code));
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
