/**
 * serve-docs — read `website/docs/` in a browser, with no build step.
 *
 * The pages are hand-authored HTML **content fragments** — no `<html>`, no
 * `<head>`, no navigation — and this script wraps each one in the shared chrome:
 * sidebar, language switch, on-page table of contents, and previous/next links.
 *
 * That split is the whole design. Authoring a page stays "write the article",
 * with full control over layout, cards and inline SVG figures, while the chrome
 * and the stylesheet live in exactly one place instead of being copy-pasted
 * across 70 files. A docs framework would also solve this, at the cost of a
 * large dependency and a build step for something no gate depends on;
 * `scripts/serve-reports.mts` already set the precedent for the cheap version,
 * and its path-safety logic is reused here rather than copied.
 *
 * URLs mirror file paths, so a relative `<a href="../x.html">` in a page works
 * in the browser with no rewriting.
 *
 * Usage:
 *   pnpm docs:serve                 # http://localhost:4301
 *   pnpm docs:serve --port 4310
 *   pnpm docs:serve --open
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveRequestPath } from "./serve-reports.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "website", "docs");

export const DEFAULT_DOCS_PORT = 4301;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type NavItem = { slug: string } & Record<string, string>;
export type NavSection = {
  dir?: string;
  file?: string;
  text: Record<string, string>;
  items?: NavItem[];
};
export type NavConfig = {
  languages: { code: string; label: string }[];
  nav: NavSection[];
};

export function readNav(baseDir: string = docsDir): NavConfig {
  const path = join(baseDir, "_nav.json");
  if (!existsSync(path)) return { languages: [], nav: [] };
  return JSON.parse(readFileSync(path, "utf8")) as NavConfig;
}

/** Every page in nav order, as `{href, label}` — also what drives prev/next. */
export function flattenNav(nav: NavSection[], lang: string) {
  const pages: { href: string; label: string }[] = [];
  for (const section of nav) {
    if (section.file) {
      pages.push({
        href: `${lang}/${section.file}.html`,
        label: section.text[lang] ?? section.file,
      });
      continue;
    }
    for (const item of section.items ?? []) {
      pages.push({
        href: `${lang}/${section.dir}/${item.slug}.html`,
        label: item[lang] ?? item.slug,
      });
    }
  }
  return pages;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSidebar(
  config: NavConfig,
  lang: string,
  current: string,
): string {
  const strings = lang === "zh" ? { home: "总览" } : { home: "Overview" };
  const link = (href: string, label: string) =>
    `<a class="${href === current ? "on" : ""}" href="/${href}">${escapeHtml(label)}</a>`;

  const langs = config.languages
    .map((entry) => {
      const target = current
        ? `/${current.replace(/^[a-z]{2}\//, `${entry.code}/`)}`
        : `/${entry.code}/index.html`;
      return `<a class="${entry.code === lang ? "on" : ""}" href="${target}">${entry.label}</a>`;
    })
    .join("");

  const sections = config.nav
    .map((section) => {
      if (section.file) {
        return `<div class="sec">${link(`${lang}/${section.file}.html`, section.text[lang] ?? "")}</div>`;
      }
      const items = (section.items ?? [])
        .map((item) =>
          link(
            `${lang}/${section.dir}/${item.slug}.html`,
            item[lang] ?? item.slug,
          ),
        )
        .join("");
      return `<div class="sec"><h4>${escapeHtml(section.text[lang] ?? "")}</h4>${items}</div>`;
    })
    .join("");

  return `<aside class="sidebar">
<a class="brand" href="/${lang}/index.html">ai-first-web-frame<small>${strings.home}</small></a>
<div class="langs">${langs}</div>
${sections}
</aside>`;
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/**
 * Expands `<!--@figure:name-->` into the inline SVG at `_diagrams/name.svg`.
 *
 * Inline, not `<img src>`, on purpose: the figures paint with the page's own CSS
 * variables, so one file serves light and dark themes and both languages. An
 * `<img>` would isolate them from that and force two exports per diagram.
 */
export function expandFigures(html: string, baseDir: string = docsDir): string {
  return html.replace(
    /<!--@figure:([a-z0-9-]+)-->/g,
    (_whole, name: string) => {
      const file = join(baseDir, "_diagrams", `${name}.svg`);
      if (!existsSync(file)) return `<!-- missing figure: ${name} -->`;
      return readFileSync(file, "utf8").trim();
    },
  );
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

/** Pulls `h2`/`h3` out of the authored content to build the right-hand TOC. */
export function extractToc(
  html: string,
): { id: string; text: string; level: number }[] {
  const out: { id: string; text: string; level: number }[] = [];
  const pattern = /<h([23])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  let match = pattern.exec(html);
  while (match !== null) {
    out.push({
      level: Number(match[1]),
      id: match[2] as string,
      text: (match[3] as string).replace(/<[^>]+>/g, "").trim(),
    });
    match = pattern.exec(html);
  }
  return out;
}

export function renderToc(
  entries: { id: string; text: string; level: number }[],
  lang: string,
): string {
  if (entries.length < 2) return '<nav class="toc"></nav>';
  const label = lang === "zh" ? "本页内容" : "On this page";
  // NOT escaped again: `entry.text` was lifted out of the authored HTML, so a
  // documented `<FRAGMENT>_URL` is already `&lt;FRAGMENT&gt;_URL` there. Escaping
  // a second time renders the entities themselves.
  const links = entries
    .map(
      (entry) =>
        `<a class="${entry.level === 3 ? "l3" : ""}" href="#${entry.id}">${entry.text}</a>`,
    )
    .join("");
  return `<nav class="toc"><h5>${label}</h5>${links}</nav>`;
}

export function renderPageNav(
  pages: { href: string; label: string }[],
  current: string,
  lang: string,
): string {
  const index = pages.findIndex((page) => page.href === current);
  if (index === -1) return "";
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const words = lang === "zh" ? ["上一页", "下一页"] : ["Previous", "Next"];
  const left = prev
    ? `<a href="/${prev.href}"><span>${words[0]}</span>${escapeHtml(prev.label)}</a>`
    : "<span></span>";
  const right = next
    ? `<a class="next" href="/${next.href}"><span>${words[1]}</span>${escapeHtml(next.label)}</a>`
    : "<span></span>";
  return `<div class="pagenav">${left}${right}</div>`;
}

export function renderShell(
  content: string,
  current: string,
  config: NavConfig,
): string {
  const lang = /^([a-z]{2})\//.exec(current)?.[1] ?? "en";
  const heading =
    /<h1[^>]*>([\s\S]*?)<\/h1>/
      .exec(content)?.[1]
      ?.replace(/<[^>]+>/g, "")
      .trim() ?? "Documentation";
  const toc = renderToc(extractToc(content), lang);
  const pagenav = renderPageNav(flattenNav(config.nav, lang), current, lang);
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading} · ai-first-web-frame</title>
<link rel="stylesheet" href="/assets/docs.css">
</head>
<body>
${renderSidebar(config, lang, current)}
<div class="wrap">
<article>${content}${pagenav}</article>
${toc}
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const STATIC_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function main(): void {
  const { port, open } = parseArgs(process.argv.slice(2));
  const listenPort = port === 4300 ? DEFAULT_DOCS_PORT : port;
  const config = readNav();
  const defaultLang = config.languages[0]?.code ?? "en";

  const server = createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const raw = request.url ?? "/";
    const urlPath = raw === "/" ? `/${defaultLang}/index.html` : raw;
    const file = resolveRequestPath(urlPath, docsDir);

    if (!file || !existsSync(file)) {
      response
        .writeHead(404, { "content-type": "text/html; charset=utf-8" })
        .end(renderShell("<h1>404</h1><p>No such page.</p>", "", config));
      return;
    }

    const ext = extname(file);
    if (ext !== ".html") {
      const type = STATIC_TYPES[ext];
      if (!type) {
        response.writeHead(415).end("unsupported");
        return;
      }
      response.writeHead(200, {
        "content-type": type,
        "cache-control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : readFileSync(file));
      return;
    }

    const current = relative(docsDir, file).split(/[\\/]/).join("/");
    const html = renderShell(
      expandFigures(readFileSync(file, "utf8")),
      current,
      config,
    );
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : html);
  });

  server.listen(listenPort, () => {
    const total = config.nav.reduce(
      (n, section) => n + (section.items?.length ?? (section.file ? 1 : 0)),
      0,
    );
    console.log(
      `docs: http://localhost:${listenPort}/  (${total + 1} pages x ${config.languages.length} languages)`,
    );
    if (open) {
      import("node:child_process").then(({ spawn }) => {
        const cmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        spawn(cmd, [`http://localhost:${listenPort}/`], {
          stdio: "ignore",
          detached: true,
        }).unref();
      });
    }
  });
}

if (process.argv[1]?.endsWith("serve-docs.mts")) main();
