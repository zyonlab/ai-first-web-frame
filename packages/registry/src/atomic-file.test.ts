import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileConflictError,
  FileLockTimeoutError,
  isRetryableWriteError,
  loadFileWithHash,
  MISSING_FILE_HASH,
  writeFileAtomic,
} from "./atomic-file";

function tempTarget(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "mvp-atomic-file-"));
  return { dir, path: join(dir, "data.json") };
}

function leftoverFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name !== "data.json");
}

describe("loadFileWithHash", () => {
  it("hashes existing content and marks missing files", () => {
    const { path } = tempTarget();
    expect(loadFileWithHash(path)).toEqual({
      content: null,
      hash: MISSING_FILE_HASH,
    });
    writeFileSync(path, "one");
    const loaded = loadFileWithHash(path);
    expect(loaded.content).toBe("one");
    expect(loaded.hash).not.toBe(MISSING_FILE_HASH);
    expect(loadFileWithHash(path).hash).toBe(loaded.hash);
  });
});

describe("writeFileAtomic", () => {
  it("writes the file and cleans up temp and lock files", () => {
    const { dir, path } = tempTarget();
    writeFileAtomic(path, "hello\n");
    expect(readFileSync(path, "utf8")).toBe("hello\n");
    expect(leftoverFiles(dir)).toEqual([]);
  });

  it("accepts a matching expected hash, including the missing-file hash for new files", () => {
    const { path } = tempTarget();
    writeFileAtomic(path, "v1\n", { expectedHash: MISSING_FILE_HASH });
    const loaded = loadFileWithHash(path);
    writeFileAtomic(path, "v2\n", { expectedHash: loaded.hash });
    expect(readFileSync(path, "utf8")).toBe("v2\n");
  });

  it("rewriting identical content with a matching hash still succeeds (idempotent reruns)", () => {
    const { dir, path } = tempTarget();
    writeFileSync(path, "same\n");
    const loaded = loadFileWithHash(path);
    writeFileAtomic(path, "same\n", { expectedHash: loaded.hash });
    expect(readFileSync(path, "utf8")).toBe("same\n");
    expect(leftoverFiles(dir)).toEqual([]);
  });

  it("detects a concurrent writer and refuses to clobber the file", () => {
    const { dir, path } = tempTarget();
    writeFileSync(path, "loaded\n");
    const loaded = loadFileWithHash(path);
    writeFileSync(path, "changed by another agent\n");
    expect(() =>
      writeFileAtomic(path, "stale write\n", { expectedHash: loaded.hash }),
    ).toThrow(FileConflictError);
    expect(readFileSync(path, "utf8")).toBe("changed by another agent\n");
    expect(leftoverFiles(dir)).toEqual([]);
  });

  it("releases the lock on failure so a corrected write succeeds", () => {
    const { dir, path } = tempTarget();
    writeFileSync(path, "current\n");
    expect(() =>
      writeFileAtomic(path, "stale\n", { expectedHash: "not-the-hash" }),
    ).toThrow(FileConflictError);
    const fresh = loadFileWithHash(path);
    writeFileAtomic(path, "recovered\n", { expectedHash: fresh.hash });
    expect(readFileSync(path, "utf8")).toBe("recovered\n");
    expect(leftoverFiles(dir)).toEqual([]);
  });

  it("times out on a held lock without touching the target", () => {
    const { path } = tempTarget();
    writeFileSync(path, "original\n");
    writeFileSync(`${path}.lock`, "held\n");
    expect(() =>
      writeFileAtomic(path, "blocked\n", {
        lockTimeoutMs: 60,
        retryDelayMs: 10,
        staleLockMs: 60_000,
      }),
    ).toThrow(FileLockTimeoutError);
    expect(readFileSync(path, "utf8")).toBe("original\n");
    // The lock belongs to the other writer; a timed-out attempt must not remove it.
    expect(existsSync(`${path}.lock`)).toBe(true);
  });

  it("steals a stale lock left behind by a crashed writer", () => {
    const { dir, path } = tempTarget();
    writeFileSync(`${path}.lock`, "crashed\n");
    const past = (Date.now() - 60_000) / 1000;
    utimesSync(`${path}.lock`, past, past);
    writeFileAtomic(path, "rescued\n", { staleLockMs: 10_000 });
    expect(readFileSync(path, "utf8")).toBe("rescued\n");
    expect(leftoverFiles(dir)).toEqual([]);
  });
});

describe("isRetryableWriteError", () => {
  it("flags conflict and lock-timeout errors, not generic ones", () => {
    expect(isRetryableWriteError(new FileConflictError("/x"))).toBe(true);
    expect(isRetryableWriteError(new FileLockTimeoutError("/x.lock", 5))).toBe(
      true,
    );
    expect(isRetryableWriteError(new Error("boom"))).toBe(false);
    expect(isRetryableWriteError("boom")).toBe(false);
  });
});
