import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_PORT,
  listReports,
  parseArgs,
  resolveRequestPath,
} from "../../scripts/serve-reports.mts";

/**
 * `scripts/serve-reports.mts` is a reading aid, not infrastructure — but its
 * path resolution is the one part that must not be wrong, because it decides
 * which files a local HTTP server will hand out. `e2e/unit/` is the vitest
 * include glob provisioned for repo-level logic that has no owning package.
 */

const base = mkdtempSync(join(tmpdir(), "mvp-serve-reports-"));
mkdirSync(join(base, "nested"), { recursive: true });
writeFileSync(join(base, "index.html"), "<p>index</p>");
writeFileSync(join(base, "architecture-map.html"), "<p>a</p>");
writeFileSync(join(base, "cost-assessment.html"), "<p>c</p>");
writeFileSync(join(base, "notes.md"), "notes");

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("parseArgs", () => {
  it("defaults to the reports port", () => {
    expect(parseArgs([])).toEqual({ port: DEFAULT_PORT, open: false });
  });

  it("accepts --port, a bare port and --open", () => {
    expect(parseArgs(["--port", "4310"]).port).toBe(4310);
    expect(parseArgs(["4311"]).port).toBe(4311);
    expect(parseArgs(["--open"]).open).toBe(true);
  });

  it("rejects a port outside the usable range instead of failing later", () => {
    // A bogus port otherwise surfaces as an opaque listen error.
    expect(() => parseArgs(["--port", "99999"])).toThrow(/1024\.\.65535/);
    expect(() => parseArgs(["--port", "80"])).toThrow(/1024\.\.65535/);
    expect(() => parseArgs(["--port", "abc"])).toThrow(/1024\.\.65535/);
  });
});

describe("resolveRequestPath", () => {
  it("serves index.html for a directory request", () => {
    expect(resolveRequestPath("/", base)).toBe(join(base, "index.html"));
    expect(resolveRequestPath("/nested/", base)).toBe(
      join(base, "nested", "index.html"),
    );
  });

  it("resolves a plain file and ignores the query string", () => {
    expect(resolveRequestPath("/architecture-map.html", base)).toBe(
      join(base, "architecture-map.html"),
    );
    expect(resolveRequestPath("/architecture-map.html?v=2", base)).toBe(
      join(base, "architecture-map.html"),
    );
  });

  it("never resolves outside the served directory", () => {
    // The property that matters is positive: whatever comes back is inside
    // base. `normalize()` collapses `..` at the root, so these inputs are
    // neutralized rather than rejected — they land on a non-existent file
    // inside base and the server answers 404.
    for (const attempt of [
      "/../package.json",
      "/../../package.json",
      "/nested/../../package.json",
      "/%2e%2e/package.json",
      "/..%2fpackage.json",
      "/....//package.json",
      `/../${resolve(base).split("/").pop()}-evil/secret.html`,
    ]) {
      const resolved = resolveRequestPath(attempt, base);
      if (resolved === null) continue;
      // Inside base — the filename survives, but it is re-rooted, so the
      // sibling/parent file the request was aiming at stays unreachable.
      expect(resolved.startsWith(`${base}/`)).toBe(true);
      expect(resolved).not.toBe(resolve(base, "..", "package.json"));
    }
  });

  it("rejects a NUL byte before it can reach the filesystem", () => {
    expect(resolveRequestPath("/index.html%00.png", base)).toBeNull();
  });

  it("refuses malformed percent-encoding rather than throwing", () => {
    expect(resolveRequestPath("/%ZZ.html", base)).toBeNull();
  });
});

describe("listReports", () => {
  it("lists report pages and leaves out the index and non-HTML files", () => {
    expect(listReports(base)).toEqual([
      "architecture-map.html",
      "cost-assessment.html",
    ]);
  });

  it("returns nothing for a directory that does not exist", () => {
    expect(listReports(join(base, "missing"))).toEqual([]);
  });
});
