/**
 * serve-docs — read `website/docs/` in a browser, with no build step.
 *
 * The outward-facing documentation is Markdown, which is the right source form
 * (reviewable in a diff, greppable, and what a docs site would consume anyway)
 * and the wrong reading form. A real docs framework — VitePress, Rspress,
 * Docusaurus — would solve that and cost a large dependency plus a build step
 * for something nothing in `pnpm verify` depends on. This is the alternative:
 * one file, zero dependencies, render on request.
 *
 * Scope is deliberately the Markdown these docs actually use — headings,
 * paragraphs, fenced code, GFM pipe tables, lists, blockquotes, rules, links,
 * inline code, bold, strikethrough, and pass-through `<a id>` anchors. It is not
 * a CommonMark implementation and does not try to be; {@link renderMarkdown} is
 * exported so `e2e/unit/serve-docs.test.ts` can hold it to that subset.
 *
 * URLs mirror file paths **including** the `.md` suffix, so every relative link
 * inside the docs resolves in the browser with no rewriting.
 *
 * Path safety is not reimplemented here: `resolveRequestPath` from
 * `./serve-reports.mts` already owns it, and is reused rather than copied.
 *
 * Usage:
 *   pnpm docs:serve                 # http://localhost:4301
 *   pnpm docs:serve --port 4310
 *   pnpm docs:serve --open
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveRequestPath } from "./serve-reports.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "website", "docs");

export const DEFAULT_DOCS_PORT = 4301;

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const RAW_ANCHOR = /^<a id="[A-Za-z0-9_-]+"><\/a>$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/`|\*\*|~~/g, "")
    .replace(/[^\w一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Inline formatting for ONE already-block-classified line.
 *
 * Code spans are pulled out into placeholders before anything else runs, so
 * backtick content is never touched by the bold/link/strikethrough passes — a
 * table cell like `` `**a**` `` has to survive as literal asterisks. HTML is
 * escaped first, which is why a documented `<head>` inside backticks renders as
 * text rather than opening an element.
 */
export function renderInline(text: string): string {
  const codes: string[] = [];
  // Private-use sentinel rather than NUL: it is not a control character (which
  // biome rightly refuses in a regex) and cannot occur in the docs themselves.
  const mark = "\uE000";
  let out = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `${mark}${codes.length - 1}${mark}`;
  });
  out = escapeHtml(out);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // single-asterisk emphasis runs AFTER bold, so `**x**` has already been
  // consumed and cannot be mis-read as two emphasis markers around `x`
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label: string, href: string) =>
      `<a href="${href.replace(/"/g, "&quot;")}">${label}</a>`,
  );
  return out.replace(
    new RegExp(`${mark}(\\d+)${mark}`, "g"),
    (_m, i: string) => codes[Number(i)] as string,
  );
}

type TableRow = string[];

function splitRow(line: string): TableRow {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line);
}

/** Renders the Markdown subset these docs use. Returns a `<main>` body. */
export function renderMarkdown(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let index = 0;

  const closeList = (stack: string[]) => {
    while (stack.length > 0) out.push(`</${stack.pop()}>`);
  };
  const listStack: string[] = [];

  while (index < lines.length) {
    const line = lines[index] as string;

    // fenced code — emitted verbatim (escaped), never parsed
    const fence = /^```(\w[\w-]*)?\s*$/.exec(line);
    if (fence) {
      closeList(listStack);
      const lang = fence[1] ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] as string)) {
        body.push(lines[index] as string);
        index += 1;
      }
      index += 1;
      out.push(
        `<pre><code${lang ? ` class="lang-${lang}"` : ""}>${escapeHtml(
          body.join("\n"),
        )}</code></pre>`,
      );
      continue;
    }

    // GFM pipe table — needs the separator row on the next line to qualify
    if (
      line.trimStart().startsWith("|") &&
      isTableSeparator(lines[index + 1] ?? "")
    ) {
      closeList(listStack);
      const header = splitRow(line);
      index += 2;
      const rows: TableRow[] = [];
      while (
        index < lines.length &&
        (lines[index] as string).trimStart().startsWith("|")
      ) {
        rows.push(splitRow(lines[index] as string));
        index += 1;
      }
      const head = header.map((c) => `<th>${renderInline(c)}</th>`).join("");
      const body = rows
        .map(
          (row) =>
            `<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`,
        )
        .join("");
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      );
      continue;
    }

    // raw anchor target used by known-limitations.md
    if (RAW_ANCHOR.test(line.trim())) {
      out.push(line.trim());
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList(listStack);
      const level = (heading[1] as string).length;
      const text = heading[2] as string;
      out.push(
        `<h${level} id="${slugify(text)}">${renderInline(text)}</h${level}>`,
      );
      index += 1;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      closeList(listStack);
      out.push("<hr />");
      index += 1;
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeList(listStack);
      const body: string[] = [quote[1] as string];
      index += 1;
      while (index < lines.length && /^>\s?/.test(lines[index] as string)) {
        body.push((lines[index] as string).replace(/^>\s?/, ""));
        index += 1;
      }
      out.push(`<blockquote>${renderInline(body.join(" "))}</blockquote>`);
      continue;
    }

    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      const indent = (item[1] as string).length;
      const ordered = /\d/.test(item[2] as string);
      const depth = Math.floor(indent / 2) + 1;
      while (listStack.length > depth) out.push(`</${listStack.pop()}>`);
      if (listStack.length < depth) {
        const tag = ordered ? "ol" : "ul";
        out.push(`<${tag}>`);
        listStack.push(tag);
      }
      // continuation lines of the same item (the docs wrap prose inside bullets)
      const parts: string[] = [item[3] as string];
      index += 1;
      while (index < lines.length) {
        const next = lines[index] as string;
        if (next.trim() === "" || /^(\s*)([-*]|\d+\.)\s+/.test(next)) break;
        if (/^```/.test(next.trimStart()) || next.trimStart().startsWith("|"))
          break;
        parts.push(next.trim());
        index += 1;
      }
      out.push(`<li>${renderInline(parts.join(" "))}</li>`);
      continue;
    }

    if (line.trim() === "") {
      closeList(listStack);
      index += 1;
      continue;
    }

    // paragraph: consume until a blank line or a construct starts
    closeList(listStack);
    const parts: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] as string;
      if (
        next.trim() === "" ||
        /^(#{1,6})\s/.test(next) ||
        /^```/.test(next) ||
        /^\s*---+\s*$/.test(next) ||
        /^>/.test(next) ||
        /^(\s*)([-*]|\d+\.)\s+/.test(next) ||
        next.trimStart().startsWith("|") ||
        RAW_ANCHOR.test(next.trim())
      )
        break;
      parts.push(next.trim());
      index += 1;
    }
    out.push(`<p>${renderInline(parts.join(" "))}</p>`);
  }

  closeList(listStack);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Sidebar + page shell
// ---------------------------------------------------------------------------

type NavSection = {
  text: string;
  dir?: string;
  items?: string[];
  file?: string;
};

export function readNav(baseDir: string = docsDir): NavSection[] {
  const path = join(baseDir, "_nav.json");
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    nav?: NavSection[];
  };
  return parsed.nav ?? [];
}

/** Acronyms a naive capitalisation would mangle ("ai-setup" -> "Ai setup"). */
const ACRONYMS = new Set(["ai", "cli", "seo", "http", "ui", "ssr", "api"]);

function title(slug: string): string {
  return slug
    .split("-")
    .map((word, i) =>
      ACRONYMS.has(word)
        ? word.toUpperCase()
        : i === 0
          ? word.replace(/^./, (c) => c.toUpperCase())
          : word,
    )
    .join(" ");
}

export function renderSidebar(nav: NavSection[], current: string): string {
  const link = (href: string, label: string) =>
    `<a class="${href === current ? "active" : ""}" href="/${href}">${label}</a>`;
  const parts = [`<nav><a class="home" href="/index.md">Overview</a>`];
  for (const section of nav) {
    if (section.file) {
      parts.push(
        `<div class="section standalone">${link(`${section.file}.md`, section.text)}</div>`,
      );
      continue;
    }
    const items = (section.items ?? [])
      .map((item) => link(`${section.dir}/${item}.md`, title(item)))
      .join("");
    parts.push(`<div class="section"><h4>${section.text}</h4>${items}</div>`);
  }
  parts.push("</nav>");
  return parts.join("");
}

const STYLE = `
:root{--bg:#fff;--fg:#1a1c20;--muted:#5c6370;--line:#e3e5e9;--code-bg:#f5f6f8;--accent:#1f6feb}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#d6d9e0;--muted:#8b919c;--line:#262a32;--code-bg:#171a20;--accent:#58a6ff}}
*{box-sizing:border-box}
body{margin:0;display:flex;background:var(--bg);color:var(--fg);
font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
nav{width:270px;flex:0 0 270px;height:100vh;overflow-y:auto;padding:22px 14px;
border-right:1px solid var(--line);position:sticky;top:0;font-size:13.5px}
nav a{display:block;padding:4px 8px;color:var(--muted);text-decoration:none;border-radius:5px}
nav a:hover{background:var(--code-bg);color:var(--fg)}
nav a.active{background:var(--code-bg);color:var(--accent);font-weight:600}
nav a.home{color:var(--fg);font-weight:700;margin-bottom:14px}
nav .section{margin-bottom:16px}
nav .section h4{margin:0 0 4px 8px;font-size:11px;letter-spacing:.07em;
text-transform:uppercase;color:var(--muted)}
main{flex:1;min-width:0;max-width:900px;padding:40px 46px 120px}
h1,h2,h3,h4{line-height:1.3}
h1{font-size:30px;margin:0 0 20px}
h2{font-size:22px;margin:38px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:17px;margin:26px 0 8px}
h4{font-size:15px;margin:20px 0 6px}
p,li{margin:9px 0}
a{color:var(--accent)}
code{background:var(--code-bg);padding:1.5px 5px;border-radius:4px;
font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--code-bg);padding:14px 16px;border-radius:7px;overflow-x:auto;
border:1px solid var(--line)}
pre code{background:none;padding:0;font-size:12.5px;line-height:1.55}
.table-wrap{overflow-x:auto;margin:16px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
th{background:var(--code-bg);font-weight:600}
blockquote{margin:14px 0;padding:2px 16px;border-left:3px solid var(--line);color:var(--muted)}
hr{border:0;border-top:1px solid var(--line);margin:30px 0}
del{color:var(--muted)}
@media(max-width:860px){body{flex-direction:column}
nav{width:100%;flex:none;height:auto;position:static;border-right:0;border-bottom:1px solid var(--line)}
main{padding:24px 16px 80px}}
`;

export function renderPage(
  markdown: string,
  current: string,
  nav: NavSection[],
): string {
  const h1 = /^#\s+(.*)$/m.exec(markdown)?.[1] ?? current;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(h1)} · ai-first-web-frame docs</title>
<style>${STYLE}</style></head><body>
${renderSidebar(nav, current)}
<main>${renderMarkdown(markdown)}</main>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function main(): void {
  const { port, open } = parseArgs(process.argv.slice(2));
  const listenPort = port === 4300 ? DEFAULT_DOCS_PORT : port;
  const nav = readNav();

  const server = createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const urlPath = request.url === "/" ? "/index.md" : (request.url ?? "/");
    const file = resolveRequestPath(urlPath, docsDir);
    if (!file || !existsSync(file)) {
      response
        .writeHead(404, { "content-type": "text/html; charset=utf-8" })
        .end(renderPage("# 404\n\nNo such page.\n", "", nav));
      return;
    }
    if (!file.endsWith(".md")) {
      response.writeHead(415).end("only .md is served");
      return;
    }
    const current = relative(docsDir, file).split(/[\\/]/).join("/");
    const html = renderPage(readFileSync(file, "utf8"), current, nav);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : html);
  });

  server.listen(listenPort, () => {
    const url = `http://localhost:${listenPort}/`;
    const pages =
      nav.reduce((n, s) => n + (s.items?.length ?? (s.file ? 1 : 0)), 0) + 1;
    console.log(`docs: ${url}  (${pages} pages from website/docs/)`);
    if (open) {
      import("node:child_process").then(({ spawn }) => {
        const cmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
      });
    }
  });
}

if (process.argv[1]?.endsWith("serve-docs.mts")) main();
