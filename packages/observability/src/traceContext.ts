/**
 * W3C Trace Context — the interoperable form of "which request is this".
 *
 * The repository already propagated a trace id, but through a bespoke
 * `x-trace-id` header that nothing outside this codebase understands. Chrome
 * DevTools, OpenTelemetry collectors and every commercial APM speak
 * `traceparent`; emitting it is what lets a browser-side timeline and a
 * server-side span tree refer to the same request instead of merely happening
 * at the same time.
 *
 * Format (W3C Trace Context Level 1, the only version with `00`):
 *
 *     traceparent: 00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>
 *                  ^^  ^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^  ^^
 *                  ver trace            span              sampled=01
 *
 * Both ids are rejected when all-zero, which the spec requires and which also
 * happens to catch the exact bug this module was written to fix: a trace id
 * that was a hardcoded constant, so every request in the system shared one.
 */

const TRACE_ID_BYTES = 16;
const SPAN_ID_BYTES = 8;
const VERSION = "00";

/** `01` = sampled. The only flag Level 1 defines. */
export const TRACE_FLAG_SAMPLED = "01";
export const TRACE_FLAG_NONE = "00";

export type TraceParent = {
  traceId: string;
  spanId: string;
  sampled: boolean;
};

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(buffer);
  } else {
    // Node 18 without webcrypto on globalThis, and any exotic runtime. Weaker,
    // but a weak id still partitions requests; a constant one does not.
    for (let i = 0; i < bytes; i += 1)
      buffer[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function isAllZero(value: string): boolean {
  return /^0+$/.test(value);
}

/** A fresh 16-byte trace id as 32 lowercase hex characters. */
export function createTraceId(): string {
  let id = randomHex(TRACE_ID_BYTES);
  while (isAllZero(id)) id = randomHex(TRACE_ID_BYTES);
  return id;
}

/** A fresh 8-byte span id as 16 lowercase hex characters. */
export function createSpanId(): string {
  let id = randomHex(SPAN_ID_BYTES);
  while (isAllZero(id)) id = randomHex(SPAN_ID_BYTES);
  return id;
}

/** Serialises to a `traceparent` header value. */
export function formatTraceparent(parent: TraceParent): string {
  const flags = parent.sampled ? TRACE_FLAG_SAMPLED : TRACE_FLAG_NONE;
  return `${VERSION}-${parent.traceId}-${parent.spanId}-${flags}`;
}

/**
 * Parses a `traceparent` header, returning null for anything malformed.
 *
 * Null means "mint a new trace", never "carry on with a broken one": a caller
 * that accepted a partially valid parent would produce spans that attach to a
 * trace nobody can query. Unknown future versions are also rejected rather than
 * guessed at, because a later version may redefine the fields after the flags.
 */
export function parseTraceparent(
  value: string | undefined | null,
): TraceParent | null {
  if (!value) return null;
  const match =
    /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(
      value.trim().toLowerCase(),
    );
  if (!match) return null;
  const [, version, traceId, spanId, flags] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== VERSION) return null;
  if (isAllZero(traceId) || isAllZero(spanId)) return null;
  return {
    traceId,
    spanId,
    sampled: (Number.parseInt(flags, 16) & 1) === 1,
  };
}

/**
 * Continues an incoming trace, or starts one when there is nothing to continue.
 *
 * The returned `spanId` is always fresh — this process is a new span in the
 * trace, never a reuse of its caller's. `parentSpanId` is the caller's span, or
 * undefined at the root.
 */
export function continueTrace(incoming: string | undefined | null): {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
  traceparent: string;
} {
  const parent = parseTraceparent(incoming);
  const traceId = parent?.traceId ?? createTraceId();
  const spanId = createSpanId();
  const sampled = parent?.sampled ?? true;
  return {
    traceId,
    spanId,
    ...(parent ? { parentSpanId: parent.spanId } : {}),
    sampled,
    traceparent: formatTraceparent({ traceId, spanId, sampled }),
  };
}
