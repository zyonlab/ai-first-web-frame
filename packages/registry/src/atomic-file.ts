/**
 * Shared atomic + concurrency-safe writer for every lifecycle mutation
 * (registry data, release history, page slot manifests, docker-compose).
 * Parallel agents are the normal case (refactor plan §4.2), so each save is:
 *
 * 1. guarded by an advisory `<file>.lock` sentinel (short retry/backoff,
 *    stale locks from crashed writers are stolen),
 * 2. checked optimistically against the content hash captured at load time,
 * 3. written to a temp file in the same directory and atomically renamed.
 *
 * A concurrent modification surfaces as a typed {@link FileConflictError};
 * lifecycle scripts translate it (via {@link isRetryableWriteError}) into
 * `{ status: "conflict", retry: true }` and exit 1 without writing.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

/** Hash sentinel for a file that does not exist yet. */
export const MISSING_FILE_HASH = "missing";

export type LoadedFile = {
  /** Raw file content, or null when the file does not exist. */
  content: string | null;
  /** sha256 of the content ({@link MISSING_FILE_HASH} when absent); pass to {@link writeFileAtomic}. */
  hash: string;
};

export class FileConflictError extends Error {
  readonly retry = true;
  constructor(path: string) {
    super(
      `concurrent modification detected: ${path} changed on disk since it was loaded; reload and retry`,
    );
    this.name = "FileConflictError";
  }
}

export class FileLockTimeoutError extends Error {
  readonly retry = true;
  constructor(lockPath: string, timeoutMs: number) {
    super(
      `could not acquire ${lockPath} within ${timeoutMs}ms; another writer holds it — retry shortly`,
    );
    this.name = "FileLockTimeoutError";
  }
}

/** True for errors a script should report as `{ status: "conflict", retry: true }`. */
export function isRetryableWriteError(
  error: unknown,
): error is FileConflictError | FileLockTimeoutError {
  return (
    error instanceof FileConflictError || error instanceof FileLockTimeoutError
  );
}

export function hashContent(content: string | null): string {
  if (content === null) return MISSING_FILE_HASH;
  return createHash("sha256").update(content).digest("hex");
}

export function loadFileWithHash(path: string): LoadedFile {
  if (!existsSync(path)) return { content: null, hash: MISSING_FILE_HASH };
  const content = readFileSync(path, "utf8");
  return { content, hash: hashContent(content) };
}

export type AtomicWriteOptions = {
  /** Hash captured at load time; a differing on-disk hash aborts with {@link FileConflictError}. */
  expectedHash?: string;
  /** How long to keep retrying the advisory lock before failing (default 2s). */
  lockTimeoutMs?: number;
  /** Locks older than this are treated as left by a crashed writer and stolen (default 10s). */
  staleLockMs?: number;
  /** Delay between lock acquisition attempts (default 25ms). */
  retryDelayMs?: number;
};

export function writeFileAtomic(
  path: string,
  content: string,
  options: AtomicWriteOptions = {},
): void {
  const {
    expectedHash,
    lockTimeoutMs = 2_000,
    staleLockMs = 10_000,
    retryDelayMs = 25,
  } = options;
  const lockPath = `${path}.lock`;
  acquireLock(lockPath, lockTimeoutMs, staleLockMs, retryDelayMs);
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`,
  );
  try {
    if (expectedHash !== undefined) {
      const current = loadFileWithHash(path);
      if (current.hash !== expectedHash) throw new FileConflictError(path);
    }
    writeFileSync(tempPath, content);
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  } finally {
    rmSync(lockPath, { force: true });
  }
}

function acquireLock(
  lockPath: string,
  lockTimeoutMs: number,
  staleLockMs: number,
  retryDelayMs: number,
): void {
  const deadline = Date.now() + lockTimeoutMs;
  for (;;) {
    try {
      writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx" });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (isStaleLock(lockPath, staleLockMs)) {
      rmSync(lockPath, { force: true });
      continue;
    }
    if (Date.now() >= deadline)
      throw new FileLockTimeoutError(lockPath, lockTimeoutMs);
    sleepSync(retryDelayMs);
  }
}

function isStaleLock(lockPath: string, staleLockMs: number): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > staleLockMs;
  } catch {
    // The holder released it between attempts; the next acquire settles it.
    return false;
  }
}

/** Synchronous sleep without busy-waiting — the lifecycle scripts are sync CLIs. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
