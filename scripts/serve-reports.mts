/**
 * serve-reports — serve `docs/reports/` over HTTP for local reading.
 *
 * The long-form reports in `docs/reports/` are plain HTML with no build step
 * and no dependencies; this is the ~100 lines needed to look at them without
 * pulling a static-server package into the workspace (and without `pnpm dlx`,
 * which the repo's pnpm-only rule and offline-friendly setup both discourage).
 *
 * Deliberately narrow: it serves ONE directory, read-only, GET/HEAD only, and
 * refuses any path that escapes that directory. It is a reading aid, not
 * infrastructure — nothing in `pnpm verify` depends on it.
 *
 * Usage:
 *   pnpm reports                 # http://localhost:4300
 *   pnpm reports --port 4310
 *   pnpm reports --open          # also open the default browser
 */

import { spawn } from "node:child_process";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportsDir = join(root, "docs", "reports");

export const DEFAULT_PORT = 4300;

/**
 * Content types for what this directory can hold. `charset=utf-8` on the HTML
 * type is what keeps the Chinese prose correct in every browser, regardless of
 * the reader's locale defaults.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export type ServeOptions = { port: number; open: boolean };

export function parseArgs(argv: string[]): ServeOptions {
  let port = DEFAULT_PORT;
  let open = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--port") port = Number(argv[++index]);
    else if (flag === "--open") open = true;
    else if (/^\d+$/.test(flag)) port = Number(flag);
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`--port must be an integer in 1024..65535 (got ${port})`);
  }
  return { port, open };
}

/**
 * Maps a request path to a file inside `docs/reports/`, or null when the path
 * is unusable. The guarantee callers rely on is the POSITIVE one: whatever this
 * returns is inside `baseDir`.
 *
 * Three things produce that, in order:
 *  1. a decode failure or a NUL byte (the classic poison-null-byte trick, which
 *     would otherwise reach `existsSync`) is rejected outright;
 *  2. `normalize()` on the always-absolute request path collapses `..` at the
 *     root, so `/../../package.json` becomes `/package.json` — traversal is
 *     NEUTRALIZED here, not by the check below. Worth stating because it is
 *     easy to assume the prefix check is doing that work;
 *  3. the prefix check is defence in depth for anything surviving (2) — it
 *     compares against `baseDir + sep`, so a sibling directory that merely
 *     shares the name prefix is not mistaken for a child.
 */
export function resolveRequestPath(
  urlPath: string,
  baseDir: string = reportsDir,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  if (decoded.endsWith("/")) decoded += "index.html";
  const base = resolve(baseDir);
  const candidate = resolve(base, `.${normalize(decoded)}`);
  if (candidate !== base && !candidate.startsWith(base + sep)) return null;
  return candidate;
}

/** The report pages available, for the startup banner. */
export function listReports(baseDir: string = reportsDir): string[] {
  if (!existsSync(baseDir)) return [];
  return readdirSync(baseDir)
    .filter((name) => name.endsWith(".html") && name !== "index.html")
    .sort();
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  spawn(command, [url], {
    stdio: "ignore",
    detached: true,
    shell: process.platform === "win32",
  }).unref();
}

export function createReportServer() {
  return createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end("method not allowed");
      return;
    }
    const filePath = resolveRequestPath(request.url ?? "/");
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response
        .writeHead(404, { "content-type": "text/plain; charset=utf-8" })
        .end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type":
        CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      // Local reading aid: never let a stale copy survive an edit.
      "cache-control": "no-store",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  });
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const { port, open } = parseArgs(process.argv.slice(2));
  if (!existsSync(reportsDir)) {
    console.error(`docs/reports/ does not exist at ${reportsDir}`);
    process.exit(1);
  }
  const server = createReportServer();
  server.listen(port, () => {
    const origin = `http://localhost:${port}`;
    console.log(`\n  docs/reports served at ${origin}\n`);
    for (const name of listReports()) console.log(`    ${origin}/${name}`);
    console.log("\n  Ctrl-C to stop.\n");
    if (open) openBrowser(origin);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `port ${port} is in use — try \`pnpm reports --port ${port + 1}\``,
      );
      process.exit(1);
    }
    throw error;
  });
}
