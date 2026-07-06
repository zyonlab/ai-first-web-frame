import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type CookiePolicy,
  CookiePolicySchema,
  type DataPrivacy,
  type RequestContext,
  type StoragePolicy,
  StoragePolicySchema,
} from "@mvp/contracts";

export type StoragePartitionKey = StoragePolicy["partitionBy"][number];

export type StoragePartitionContext = Pick<
  RequestContext,
  "tenant" | "locale" | "theme" | "device"
> & {
  user?: RequestContext["user"];
};

export type StoragePolicyValidationResult =
  | { ok: true; policy: StoragePolicy; issues: [] }
  | { ok: false; issues: string[] };

const publicPartitionKeys = new Set<StoragePartitionKey>([
  "tenant",
  "locale",
  "theme",
  "device",
]);

export class StoragePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoragePolicyError";
  }
}

export function requiredPartitionKeysForPrivacy(
  privacy: DataPrivacy,
): StoragePartitionKey[] {
  if (privacy === "public") return [];
  if (privacy === "tenant") return ["tenant"];
  if (privacy === "user-segment") return ["tenant", "locale"];
  return ["tenant", "user"];
}

export function validateStoragePolicy(
  input: unknown,
): StoragePolicyValidationResult {
  const parsed = StoragePolicySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const required = requiredPartitionKeysForPrivacy(parsed.data.privacy);
  const missing = required.filter(
    (key) => !parsed.data.partitionBy.includes(key),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      issues: [
        `storage policy "${parsed.data.id}" must partition ${parsed.data.privacy} data by ${missing.join(", ")}`,
      ],
    };
  }

  return { ok: true, policy: parsed.data, issues: [] };
}

export function assertStoragePolicy(input: unknown): StoragePolicy {
  const result = validateStoragePolicy(input);
  if (!result.ok) throw new StoragePolicyError(result.issues.join("; "));
  return result.policy;
}

export function resolveStoragePartition(
  policyInput: unknown,
  ctx: StoragePartitionContext,
): Record<StoragePartitionKey, string> {
  const policy = assertStoragePolicy(policyInput);
  const partition = {} as Record<StoragePartitionKey, string>;

  for (const key of policy.partitionBy) {
    const value = valueForPartitionKey(key, ctx);
    if (!value) {
      throw new StoragePolicyError(
        `storage policy "${policy.id}" requires ${key} partition value`,
      );
    }
    partition[key] = value;
  }

  return partition;
}

export function createStorageKey(
  policyInput: unknown,
  logicalKey: string,
  ctx: StoragePartitionContext,
): string {
  const policy = assertStoragePolicy(policyInput);
  const partition = resolveStoragePartition(policy, ctx);
  const segments = [
    "mvp",
    encodeStorageKeySegment(policy.id),
    policy.adapter,
    policy.privacy,
    ...policy.partitionBy.map(
      (key) => `${key}:${encodeStorageKeySegment(partition[key])}`,
    ),
    encodeStorageKeySegment(logicalKey),
  ];
  return segments.join("|");
}

export function createCookiePolicy(
  name: string,
  overrides: Partial<Omit<CookiePolicy, "name">> = {},
): CookiePolicy {
  return CookiePolicySchema.parse({ name, ...overrides });
}

export function createCookiePolicyForStorage(
  policyInput: unknown,
  name: string,
  overrides: Partial<Omit<CookiePolicy, "name">> = {},
): CookiePolicy {
  const policy = assertStoragePolicy(policyInput);
  if (policy.adapter !== "cookie") {
    throw new StoragePolicyError(
      `storage policy "${policy.id}" uses ${policy.adapter}, not cookie`,
    );
  }

  return createCookiePolicy(name, {
    ...overrides,
    maxAge: policy.ttl && policy.ttl > 0 ? policy.ttl : overrides.maxAge,
    encrypted: policy.encrypted || overrides.encrypted === true,
    signed:
      policy.privacy === "user-private" ||
      policy.privacy === "tenant" ||
      overrides.signed === true,
    httpOnly: policy.ssr ? true : overrides.httpOnly,
  });
}

export function canUseSharedStorage(policyInput: unknown): boolean {
  const policy = assertStoragePolicy(policyInput);
  return policy.privacy === "public" && policy.partitionBy.length === 0;
}

function valueForPartitionKey(
  key: StoragePartitionKey,
  ctx: StoragePartitionContext,
) {
  if (key === "user") return ctx.user?.id;
  if (publicPartitionKeys.has(key)) return String(ctx[key]);
  return undefined;
}

function encodeStorageKeySegment(value: string) {
  return encodeURIComponent(value.trim()).replaceAll("%20", "+");
}

function decodeStorageKeySegment(value: string) {
  return decodeURIComponent(value.replaceAll("+", "%20"));
}

/**
 * Pluggable storage backend. All values are strings; the {@link createStorage}
 * facade handles JSON (de)serialization and policy-driven expiration, so
 * adapters stay thin wrappers over the underlying medium. `ttlSeconds` is a
 * hint for backends with native expiry (cookies via Max-Age, Redis-like KV);
 * adapters without native ttl may ignore it because the facade also embeds
 * the expiration in the stored envelope.
 */
export type StorageAdapter = {
  get: (key: string) => Promise<string | undefined>;
  set: (
    key: string,
    value: string,
    options?: { ttlSeconds?: number },
  ) => Promise<void>;
  delete: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
};

/** In-process adapter for the "memory" policy adapter. */
export function createMemoryStorageAdapter(
  store: Map<string, string> = new Map(),
): StorageAdapter {
  return {
    async get(key) {
      return store.get(key);
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async keys() {
      return [...store.keys()];
    },
  };
}

/**
 * In-memory reference implementation for the "server-kv" policy adapter.
 * A production Redis/edge-KV adapter implements the same {@link StorageAdapter}
 * contract and can honor `ttlSeconds` natively (e.g. Redis SET ... EX).
 */
export function createServerKvStorageAdapter(
  store: Map<string, string> = new Map(),
): StorageAdapter {
  return createMemoryStorageAdapter(store);
}

/** Minimal Web Storage surface so Node tests can inject an in-memory backend. */
export type WebStorageBackend = {
  readonly length: number;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  key: (index: number) => string | null;
};

export function createWebStorageAdapter(
  backend: WebStorageBackend,
): StorageAdapter {
  return {
    async get(key) {
      return backend.getItem(key) ?? undefined;
    },
    async set(key, value) {
      backend.setItem(key, value);
    },
    async delete(key) {
      backend.removeItem(key);
    },
    async keys() {
      const keys: string[] = [];
      for (let index = 0; index < backend.length; index += 1) {
        const key = backend.key(index);
        if (key !== null) keys.push(key);
      }
      return keys;
    },
  };
}

function requireGlobalWebStorage(name: "localStorage" | "sessionStorage") {
  const backend = (globalThis as Record<string, unknown>)[name] as
    | WebStorageBackend
    | undefined;
  if (!backend) {
    throw new StoragePolicyError(
      `${name} is not available in this runtime; inject a WebStorageBackend`,
    );
  }
  return backend;
}

export function createLocalStorageAdapter(
  backend: WebStorageBackend = requireGlobalWebStorage("localStorage"),
): StorageAdapter {
  return createWebStorageAdapter(backend);
}

export function createSessionStorageAdapter(
  backend: WebStorageBackend = requireGlobalWebStorage("sessionStorage"),
): StorageAdapter {
  return createWebStorageAdapter(backend);
}

export type CookieAttributes = Partial<
  Pick<
    CookiePolicy,
    "httpOnly" | "secure" | "sameSite" | "path" | "domain" | "maxAge"
  >
>;

export type CookieStorageAdapterOptions = {
  /** Incoming `Cookie` request header to seed the jar from. */
  cookieHeader?: string;
  /** Enables HMAC-SHA256 signed values when provided. */
  secret?: string;
  /** Attributes applied to every emitted `Set-Cookie` header. */
  attributes?: CookieAttributes;
};

export type CookieStorageAdapter = StorageAdapter & {
  /** `Set-Cookie` headers accumulated by set/delete calls, in order. */
  toSetCookieHeaders: () => string[];
  /** Serializes the current jar as a `Cookie` request header. */
  toCookieHeader: () => string;
};

export function parseCookieHeader(header: string): Map<string, string> {
  const jar = new Map<string, string>();
  for (const pair of header.split(";")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = decodeURIComponent(trimmed.slice(0, separator).trim());
    const value = decodeURIComponent(trimmed.slice(separator + 1).trim());
    jar.set(name, value);
  }
  return jar;
}

function signCookieValue(value: string, secret: string): string {
  const signature = createHmac("sha256", secret)
    .update(value)
    .digest("base64url");
  return `${value}.${signature}`;
}

function verifyCookieValue(
  signedValue: string,
  secret: string,
): string | undefined {
  const separator = signedValue.lastIndexOf(".");
  if (separator <= 0) return undefined;
  const value = signedValue.slice(0, separator);
  const signature = signedValue.slice(separator + 1);
  const expected = createHmac("sha256", secret)
    .update(value)
    .digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return undefined;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return undefined;
  return value;
}

function serializeSetCookie(
  name: string,
  value: string,
  attributes: CookieAttributes & { maxAge?: number },
): string {
  const segments = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  segments.push(`Path=${attributes.path ?? "/"}`);
  if (attributes.domain) segments.push(`Domain=${attributes.domain}`);
  if (attributes.maxAge !== undefined)
    segments.push(`Max-Age=${attributes.maxAge}`);
  if (attributes.httpOnly ?? true) segments.push("HttpOnly");
  if (attributes.secure ?? true) segments.push("Secure");
  const sameSite = attributes.sameSite ?? "lax";
  segments.push(
    `SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`,
  );
  return segments.join("; ");
}

/**
 * Server-side cookie adapter: parses an incoming `Cookie` header into a jar,
 * records `Set-Cookie` headers for every mutation, and optionally signs
 * values with HMAC-SHA256 (tampered cookies read as absent).
 */
export function createCookieStorageAdapter(
  options: CookieStorageAdapterOptions = {},
): CookieStorageAdapter {
  const jar = options.cookieHeader
    ? parseCookieHeader(options.cookieHeader)
    : new Map<string, string>();
  const setCookieHeaders: string[] = [];
  const attributes = options.attributes ?? {};

  return {
    async get(key) {
      const raw = jar.get(key);
      if (raw === undefined) return undefined;
      if (!options.secret) return raw;
      return verifyCookieValue(raw, options.secret);
    },
    async set(key, value, setOptions) {
      const stored = options.secret
        ? signCookieValue(value, options.secret)
        : value;
      jar.set(key, stored);
      setCookieHeaders.push(
        serializeSetCookie(key, stored, {
          ...attributes,
          maxAge: setOptions?.ttlSeconds ?? attributes.maxAge,
        }),
      );
    },
    async delete(key) {
      jar.delete(key);
      setCookieHeaders.push(
        serializeSetCookie(key, "", { ...attributes, maxAge: 0 }),
      );
    },
    async keys() {
      return [...jar.keys()];
    },
    toSetCookieHeaders() {
      return [...setCookieHeaders];
    },
    toCookieHeader() {
      return [...jar.entries()]
        .map(
          ([name, value]) =>
            `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
        )
        .join("; ");
    },
  };
}

type StorageEnvelope = {
  value: unknown;
  expiresAt?: number;
};

export type StorageInstanceOptions = {
  ctx: StoragePartitionContext;
  /** Custom backend; defaults are derived from `policy.adapter`. */
  adapter?: StorageAdapter;
  now?: () => number;
};

export type StorageInstance = {
  policy: StoragePolicy;
  getItem: <T = unknown>(logicalKey: string) => Promise<T | undefined>;
  setItem: <T = unknown>(logicalKey: string, value: T) => Promise<void>;
  removeItem: (logicalKey: string) => Promise<void>;
  /** Logical keys stored under this policy + partition. */
  keys: () => Promise<string[]>;
  clear: () => Promise<void>;
};

function defaultAdapterForPolicy(policy: StoragePolicy): StorageAdapter {
  if (policy.adapter === "memory") return createMemoryStorageAdapter();
  if (policy.adapter === "server-kv") return createServerKvStorageAdapter();
  if (policy.adapter === "cookie") return createCookieStorageAdapter();
  if (policy.adapter === "local-storage") return createLocalStorageAdapter();
  if (policy.adapter === "session-storage")
    return createSessionStorageAdapter();
  throw new StoragePolicyError(
    `storage policy "${policy.id}" adapter "${policy.adapter}" requires an injected StorageAdapter`,
  );
}

/**
 * Policy-enforcing storage facade. Every read/write goes through storage
 * policy validation (privacy vs partition keys), partitioned key derivation
 * via {@link createStorageKey}, and ttl-based expiration. Constructing a
 * user-private storage without a user partition (a "public" policy) throws.
 */
export function createStorage(
  policyInput: unknown,
  { ctx, adapter, now = Date.now }: StorageInstanceOptions,
): StorageInstance {
  const policy = assertStoragePolicy(policyInput);
  // Fails fast when the context cannot satisfy the partition requirements.
  resolveStoragePartition(policy, ctx);
  const backend = adapter ?? defaultAdapterForPolicy(policy);
  const keyFor = (logicalKey: string) =>
    createStorageKey(policy, logicalKey, ctx);
  const keyPrefix = keyFor("");

  async function getItem<T>(logicalKey: string): Promise<T | undefined> {
    const key = keyFor(logicalKey);
    const raw = await backend.get(key);
    if (raw === undefined) return undefined;
    let envelope: StorageEnvelope;
    try {
      envelope = JSON.parse(raw) as StorageEnvelope;
    } catch {
      await backend.delete(key);
      return undefined;
    }
    if (envelope.expiresAt !== undefined && envelope.expiresAt <= now()) {
      await backend.delete(key);
      return undefined;
    }
    return envelope.value as T;
  }

  async function ownKeys(): Promise<string[]> {
    const allKeys = await backend.keys();
    return allKeys
      .filter((key) => key.startsWith(keyPrefix))
      .map((key) => decodeStorageKeySegment(key.slice(keyPrefix.length)));
  }

  return {
    policy,
    getItem,
    async setItem(logicalKey, value) {
      const envelope: StorageEnvelope = { value };
      const ttlSeconds =
        policy.ttl !== undefined && policy.ttl > 0 ? policy.ttl : undefined;
      if (ttlSeconds !== undefined)
        envelope.expiresAt = now() + ttlSeconds * 1000;
      await backend.set(keyFor(logicalKey), JSON.stringify(envelope), {
        ttlSeconds,
      });
    },
    async removeItem(logicalKey) {
      await backend.delete(keyFor(logicalKey));
    },
    keys: ownKeys,
    async clear() {
      for (const logicalKey of await ownKeys()) {
        await backend.delete(keyFor(logicalKey));
      }
    },
  };
}
